/**
 * The Codex server-side compaction wire protocol.
 *
 * There is no compaction endpoint. A compaction request is an ordinary
 * streaming Responses request with three differences, all verified against
 * codex's source and then live against the real service:
 *
 *  1. `input` ends with `{"type":"compaction_trigger"}`
 *     (codex `protocol/src/models.rs` serde test `serializes_compaction_trigger_without_payload`)
 *  2. the request carries `x-codex-beta-features: remote_compaction_v2`
 *  3. the stream returns exactly one output item of `{"type":"compaction",
 *     "encrypted_content": "..."}`, then `response.completed`
 *
 * The returned artifact is opaque — only the server can read it. Replaying it
 * as an input item restores the compacted context. In a live check, six facts
 * spread over six messages came back 6/6 from a 1,508-byte artifact, against
 * 0/6 with no artifact.
 *
 * The beta-features flag is the fragile part. It is NOT in codex's source —
 * codex takes `beta_features_header` from config — so it is a server-side gate
 * that can be renamed or withdrawn without warning. Everything here fails soft
 * for that reason: any error means pi compacts the way it always did.
 */

export const REMOTE_COMPACTION_FEATURE = "remote_compaction_v2";

/** Marks the one input item that turns a normal request into a compaction. */
export const COMPACTION_TRIGGER = { type: "compaction_trigger" } as const;

export interface CompactionArtifact {
  readonly type: "compaction";
  readonly id?: string;
  readonly encrypted_content: string;
}

export interface CompactionOutcome {
  readonly artifact: CompactionArtifact;
  readonly usage?: {
    readonly input_tokens?: number;
    readonly output_tokens?: number;
    readonly total_tokens?: number;
  };
}

export function isCompactionArtifact(
  value: unknown,
): value is CompactionArtifact {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    item.type === "compaction" &&
    typeof item.encrypted_content === "string" &&
    item.encrypted_content.length > 0
  );
}

/**
 * Turn a captured provider payload into its compaction counterpart.
 *
 * The payload is pi's own, snapshotted from `before_provider_request`, so the
 * model, instructions, tools, and reasoning config already match the session
 * exactly. Rebuilding them here would be a second source of truth that drifts.
 *
 * `stream` is forced on because the artifact only arrives as a stream event.
 */
export function buildCompactionRequest(
  payload: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const input = Array.isArray(payload.input) ? payload.input : [];
  return {
    ...payload,
    stream: true,
    input: [...input, COMPACTION_TRIGGER],
  };
}

export function compactionHeaders(credentials: {
  access: string;
  accountId: string;
}): Record<string, string> {
  return {
    authorization: `Bearer ${credentials.access}`,
    "chatgpt-account-id": credentials.accountId,
    originator: "pi",
    "OpenAI-Beta": "responses=experimental",
    "x-codex-beta-features": REMOTE_COMPACTION_FEATURE,
    accept: "text/event-stream",
    "content-type": "application/json",
  };
}

/** `https://chatgpt.com/backend-api` + `/codex/responses`, as pi builds it. */
export function responsesUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, "");
  return normalized.endsWith("/codex")
    ? `${normalized}/responses`
    : `${normalized}/codex/responses`;
}

/** Yield each `data:` payload of an SSE body as parsed JSON. */
export async function* sseEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<Record<string, unknown>> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE permits CRLF, and proxies inject it. Splitting on "\n\n" alone
      // parses zero events from a CRLF stream, which would make every
      // compaction fall back to the text summary with nothing to show why.
      const chunks = buffer.split(/\r?\n\r?\n/);
      buffer = chunks.pop() ?? "";
      for (const chunk of chunks) {
        const line = chunk.split(/\r?\n/).find((l) => l.startsWith("data:"));
        if (!line) continue;
        const data = line.slice(5).trimStart();
        if (data === "[DONE]") return;
        try {
          const parsed: unknown = JSON.parse(data);
          if (typeof parsed === "object" && parsed !== null) {
            yield parsed as Record<string, unknown>;
          }
        } catch {
          // A malformed frame is not worth failing a whole compaction over.
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

/**
 * Collect the one artifact out of a compaction stream.
 *
 * Codex requires exactly one and treats any other count as fatal
 * (`compact_remote_v2.rs::collect_compaction_output`); so do we. More than one
 * means the server changed its contract, and guessing which to keep would
 * silently corrupt the session's context.
 */
export async function collectCompaction(
  events: AsyncIterable<Record<string, unknown>>,
): Promise<CompactionOutcome> {
  let artifact: CompactionArtifact | undefined;
  let seen = 0;
  let usage: CompactionOutcome["usage"];
  let completed = false;

  for await (const event of events) {
    if (
      event.type === "response.output_item.done" &&
      isCompactionArtifact(event.item)
    ) {
      seen += 1;
      artifact ??= event.item;
    }
    if (event.type === "response.completed") {
      completed = true;
      const response = event.response;
      if (typeof response === "object" && response !== null) {
        usage = (response as Record<string, unknown>)
          .usage as CompactionOutcome["usage"];
      }
      break;
    }
    if (event.type === "response.failed" || event.type === "error") {
      throw new Error(
        `compaction stream failed: ${JSON.stringify(event).slice(0, 300)}`,
      );
    }
  }

  if (!completed)
    throw new Error("compaction stream closed before response.completed");
  if (seen !== 1)
    throw new Error(`expected exactly one compaction item, got ${seen}`);
  if (!artifact) throw new Error("compaction item missing after count check");
  return { artifact, usage };
}
