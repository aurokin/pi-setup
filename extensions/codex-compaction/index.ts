/**
 * Codex server-side compaction for pi.
 *
 * When pi compacts, it replaces old turns with an LLM-written text summary.
 * OpenAI's Responses service can instead return an opaque artifact that only it
 * can read, and replaying that artifact restores the compacted context far more
 * faithfully than prose does. Codex uses this; pi does not. This extension adds
 * it for `openai-codex/*` models and leaves everything else alone.
 *
 * Design notes in `docs/design.md`; the wire protocol is in `src/protocol.ts`.
 *
 * Two properties are worth stating up front because they shape every decision
 * here:
 *
 *  1. **It fails soft, always.** Every failure path — no credentials, expired
 *     token, revoked beta flag, unexpected stream — falls back to pi's normal
 *     compaction. A worse summary is an acceptable outcome; a failed compaction
 *     on an overflowing context is not.
 *
 *  2. **The text summary is still written.** We generate pi's portable summary
 *     alongside the artifact and store both. The artifact is an optimisation
 *     for compatible turns; the summary is what keeps the session readable,
 *     forkable, and usable after switching models.
 */

import {
  DEFAULT_COMPACTION_SETTINGS,
  generateSummaryWithUsage,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { readCodexCredentials } from "./src/auth.ts";
import { DEFAULT_BASE_URL, requestCompaction } from "./src/client.ts";
import { markSummary, swapArtifacts } from "./src/artifact-swap.ts";
import {
  backendKey,
  CompactionState,
  fromPersistedDetails,
  toPersistedDetails,
} from "./src/state.ts";

/** Only these models can produce or consume an artifact. */
const SUPPORTED_PROVIDER = "openai-codex";

const state = new CompactionState();

function isSupported(
  ctx: { model?: { provider?: string } } | undefined,
): boolean {
  return ctx?.model?.provider === SUPPORTED_PROVIDER;
}

function log(pi: ExtensionAPI, message: string): void {
  // Debug channel only; never carries credentials or conversation content.
  if (process.env.PI_CODEX_COMPACTION_DEBUG) {
    // eslint-disable-next-line no-console
    console.error(`[codex-compaction] ${message}`);
  }
  void pi;
}

export default function codexCompaction(pi: ExtensionAPI) {
  /**
   * Snapshot every outgoing request, and swap artifacts back in.
   *
   * The snapshot is what makes the compaction request cheap to build: it is
   * pi's own payload, with the same model, instructions, tools, and reasoning
   * config, so nothing has to be reconstructed and nothing can drift.
   */
  pi.on("before_provider_request", async (event, ctx) => {
    // This hook fires for every provider, so the guard has to be here. Without
    // it, switching to another provider that exposes the same model id would
    // still match a stored artifact by name and replace a good text summary
    // with ciphertext that provider cannot read.
    const provider = ctx.model?.provider;
    if (provider !== SUPPORTED_PROVIDER) return;
    // Needed here too: the key includes the account, so a swap cannot be
    // decided without knowing which account is currently signed in.
    const credentials = readCodexCredentials();
    if (!credentials) return;

    const payload = event.payload;
    if (typeof payload !== "object" || payload === null) return;
    const record = payload as Record<string, unknown>;
    if (!Array.isArray(record.input)) return;

    state.recordPayload(record, provider, credentials.accountId);

    const model = typeof record.model === "string" ? record.model : "";
    const backend = backendKey(provider, model, credentials.accountId);
    const { input, swapped } = swapArtifacts(record.input, (id) =>
      state.lookup(id, backend),
    );
    if (swapped > 0) {
      record.input = input as unknown[];
      log(pi, `swapped ${swapped} artifact(s) into the request`);
    }
  });

  /**
   * Produce the artifact and the portable summary together.
   *
   * Both are requested concurrently: the summary is a normal pi LLM call and
   * the artifact is one extra request, so running them in series would double
   * the wait at exactly the moment the user is already blocked on compaction.
   */
  pi.on("session_before_compact", async (event, ctx) => {
    if (!isSupported(ctx)) return;
    const snapshot = state.snapshot;
    if (!snapshot) return;

    const credentials = readCodexCredentials();
    if (!credentials) {
      log(pi, "no usable codex credentials; deferring to pi compaction");
      return;
    }

    const model = ctx.model;
    if (!model) return;
    if (
      backendKey(model.provider, model.id, credentials.accountId) !==
      snapshot.backend
    ) {
      log(
        pi,
        "snapshot belongs to another backend or account; deferring to pi",
      );
      return;
    }

    const { preparation, customInstructions, signal } = event;

    // The snapshot is a *request*, so it predates the response to it. When the
    // cut point falls after that response — a large final turn that will not
    // fit in the retained tail — the text summary covers it and an artifact
    // built from this snapshot does not. Replacing the summary with that
    // artifact would silently drop the newest turn from all future context, so
    // the artifact is skipped and the summary stands on its own.
    const newest = Math.max(
      0,
      ...preparation.messagesToSummarize.map((m) =>
        typeof (m as { timestamp?: unknown }).timestamp === "number"
          ? (m as { timestamp: number }).timestamp
          : 0,
      ),
    );
    const snapshotIsStale = newest > snapshot.capturedAt;
    // Pi resolves auth per model; the codex path also needs its headers, which
    // is why this is the registry call rather than a bare key lookup.
    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok) {
      log(pi, `provider auth unavailable, deferring to pi: ${auth.error}`);
      return;
    }
    const summaryPromise = generateSummaryWithUsage(
      preparation.messagesToSummarize,
      model,
      DEFAULT_COMPACTION_SETTINGS.reserveTokens,
      auth.apiKey,
      auth.headers,
      signal,
      customInstructions,
      preparation.previousSummary,
      ctx.thinkingLevel,
    );

    const artifactPromise = snapshotIsStale
      ? Promise.reject(
          new Error("snapshot predates the messages being summarized"),
        )
      : requestCompaction({
          payload: snapshot.payload,
          credentials,
          baseUrl: model.baseUrl ?? DEFAULT_BASE_URL,
          signal,
        });

    const [summaryResult, artifactResult] = await Promise.allSettled([
      summaryPromise,
      artifactPromise,
    ]);

    if (summaryResult.status === "rejected") {
      // Without a portable summary there is nothing safe to return: pi's own
      // path will produce one, so step aside entirely.
      log(pi, `summary failed, deferring to pi: ${summaryResult.reason}`);
      return;
    }

    const base = {
      summary: summaryResult.value.text,
      firstKeptEntryId: preparation.firstKeptEntryId,
      tokensBefore: preparation.tokensBefore,
      usage: summaryResult.value.usage,
    };

    if (artifactResult.status === "rejected") {
      log(
        pi,
        `artifact failed, keeping text summary: ${artifactResult.reason}`,
      );
      return { compaction: base };
    }

    const { artifact } = artifactResult.value;
    const id = artifact.id ?? `cmp-${Date.now()}-${state.size}`;
    state.remember(id, artifact, snapshot.backend);
    log(
      pi,
      `stored artifact ${id} (${artifact.encrypted_content.length} bytes)`,
    );

    return {
      compaction: {
        ...base,
        summary: markSummary(id, base.summary),
        details: toPersistedDetails(id, snapshot.backend, artifact),
      },
    };
  });

  /**
   * Restore artifacts from the session file.
   *
   * A reloaded, resumed, or forked session still carries its artifacts in the
   * compaction entries' `details`. Rehydrating means continuity survives a
   * restart; failing to would silently downgrade to text summaries with nothing
   * in the UI to explain why.
   */
  const rehydrate = (ctx: ExtensionContext) => {
    const entries = ctx.sessionManager?.getEntries?.() ?? [];
    let restored = 0;
    for (const entry of entries) {
      if ((entry as { type?: string }).type !== "compaction") continue;
      const stored = fromPersistedDetails(
        (entry as { details?: unknown }).details,
      );
      if (!stored) continue;
      if (state.has(stored.id)) continue;
      state.remember(stored.id, stored.artifact, stored.backend);
      restored += 1;
    }
    if (restored > 0)
      log(pi, `rehydrated ${restored} artifact(s) from the session`);
  };

  /**
   * Navigating away invalidates the captured request.
   *
   * The snapshot describes one branch of one conversation. After a reload,
   * resume, or `/tree` move, compacting before the next provider request would
   * otherwise send the *previous* branch's messages for compaction and then
   * substitute the result for this branch's summary — cross-branch corruption,
   * and a way for one branch's content to reach another's context.
   *
   * Artifacts survive, because the compaction entries referencing them do.
   */
  const onNavigate = (ctx: ExtensionContext) => {
    state.clearSnapshot();
    rehydrate(ctx);
  };

  pi.on("session_start", async (_event, ctx) => onNavigate(ctx));
  pi.on("session_compact", async (_event, ctx) => onNavigate(ctx));
  pi.on("session_tree", async (_event, ctx) => onNavigate(ctx));
  pi.on("session_shutdown", async () => state.clear());
}
