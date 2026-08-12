/**
 * droid backend — real implementation over the Factory droid SDK.
 *
 * `createSession()` spawns the local `droid` binary and speaks JSON-RPC over
 * its stdio, so this file owns the same two things the other subprocess
 * backends own: lifecycle guarantees, and the normalized view the manager
 * reads. Unlike the Claude Agent SDK there is no persistent streaming input —
 * `session.stream(prompt)` is one call per turn and its generator ends at the
 * turn's `result` — so a run here is a pumped generator, follow-ups queue while
 * one is active, and `steering` is false, exactly as for codex.
 *
 * Two decisions are specific to droid and worth stating up front.
 *
 * **The default model is open-weight.** droid's own default is a Claude model,
 * which would spend Factory credits on inference we can already buy directly.
 * A caller who names a model gets it; a caller who does not gets `glm-5.2`.
 *
 * **Roles are enforced in the tool list.** A read-only child has no mutating
 * tool for a prompt to talk it into, because the spawn denies every tool droid
 * itself categorises as editing or executing, reads the restriction back, and
 * refuses the session if it did not take. `droidDisabledToolIds` documents why
 * it has to be a denylist and why it has to be computed live.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  AutonomyLevel,
  createSession,
  DroidMessageType,
  ReasoningEffort as DroidReasoningEffort,
  ToolConfirmationOutcome,
  type DroidResultMessage,
  type DroidStreamEvent,
  type FactoryDroidMessage,
  type TokenUsage,
} from "@factory/droid-sdk";
import type { Cause, Scope } from "effect";
import { Effect, Queue, Stream } from "effect";
import type { SubagentBackend, SubagentSession } from "../backend.ts";
import type {
  ReasoningEffort,
  RunOutcome,
  SpawnTask,
  SubagentEvent,
  SubagentMeta,
  TranscriptPart,
} from "../domain.ts";
import { SendError, SpawnError } from "../domain.ts";
import { buildRolePrompt, roleProfile } from "../../../shared/roles.ts";
import { childEnv, PARENT_ONLY_SECRET_NAMES } from "../child-env.ts";

const INTERRUPT_FALLBACK_MS = 2_000;
const PREVIEW_MAX_LENGTH = 1_024;
const CONTEXT_STATS_TIMEOUT_MS = 5_000;

/**
 * Open-weight default. droid resolves `modelId` against its own catalog, so a
 * caller may name any id it offers (`kimi-k2.7-code`, `deepseek-v4-pro`, and
 * the gemini/grok/claude/gpt ids included); only the fallback is opinionated.
 */
export const DROID_DEFAULT_MODEL = "glm-5.2";

// --- Binary and credentials ---------------------------------------------------

let cachedDroidBinary: string | null | undefined;

function executable(file: string) {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Resolve once on first use; availability checks after that are allocation-only. */
function resolveDroidBinary() {
  if (cachedDroidBinary !== undefined) return cachedDroidBinary ?? undefined;
  const names =
    process.platform === "win32" ? ["droid.exe", "droid.cmd"] : ["droid"];
  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!directory) continue;
    for (const name of names) {
      const candidate = path.join(directory, name);
      if (executable(candidate)) {
        cachedDroidBinary = candidate;
        return candidate;
      }
    }
  }
  cachedDroidBinary = null;
  return undefined;
}

/**
 * The SDK requires an explicit key in 0.6.0 — it will not read the CLI's own
 * `~/.factory` login — so the environment is the only source. The value never
 * leaves this module: it is passed to `createSession` and scrubbed out of
 * every error before that error becomes an event (see `redactKey`).
 */
function factoryApiKey(env: NodeJS.ProcessEnv = process.env) {
  const key = env.FACTORY_API_KEY?.trim();
  return key ? key : undefined;
}

/**
 * `ProcessTransport` merges its `env` over `process.env` rather than replacing
 * it, so a key `childEnv()` deleted is still inherited unless it is explicitly
 * present and undefined — which is what Node's spawn drops.
 */
export function droidChildEnv(parentEnv: NodeJS.ProcessEnv = process.env) {
  const env: Record<string, string | undefined> = { ...childEnv(parentEnv) };
  for (const name of PARENT_ONLY_SECRET_NAMES) env[name] = undefined;
  return env as Record<string, string>;
}

// --- Model, effort, tools, autonomy -------------------------------------------

export function droidModelId(model: string | undefined) {
  return model?.trim() || DROID_DEFAULT_MODEL;
}

/**
 * droid's `ReasoningEffort` is a superset of the shared scale (it adds `none`
 * and `dynamic`), so the mapping is an identity. A model that does not support
 * the requested level is clamped by droid itself against its
 * `supportedReasoningEfforts`, which is why nothing is clamped here.
 */
const DROID_EFFORTS = {
  off: DroidReasoningEffort.Off,
  minimal: DroidReasoningEffort.Minimal,
  low: DroidReasoningEffort.Low,
  medium: DroidReasoningEffort.Medium,
  high: DroidReasoningEffort.High,
  xhigh: DroidReasoningEffort.ExtraHigh,
  max: DroidReasoningEffort.Max,
} satisfies Record<ReasoningEffort, DroidReasoningEffort>;

export function droidReasoningEffort(effort: ReasoningEffort | undefined) {
  return effort ? DROID_EFFORTS[effort] : undefined;
}

/**
 * Denied to every child regardless of role. `Task`/`TaskOutput`/`TaskStop` are
 * droid's own subagents and `StartMissionRun` launches worker sessions — both
 * are orchestration, which stays with the parent so one manager owns the
 * concurrency cap and the lifecycle. `AskUser` has nobody to ask in a headless
 * child, so it would block a turn until it timed out.
 *
 * `StartMissionRun` is here rather than with the acting-read tools below
 * because the role is not what makes it wrong: a write-capable child spawning
 * workers outside the manager's accounting is the same problem as a read-only
 * one doing it.
 */
export const DROID_ALWAYS_DISABLED_TOOL_IDS = [
  "Task",
  "TaskOutput",
  "TaskStop",
  "StartMissionRun",
  "AskUser",
] as const;

/**
 * Tools droid files under `read` that nonetheless change something outside the
 * session, so its own categorisation cannot be the whole read-only policy.
 * `ProposeMission` and `ConnectApp` write session and account state, and the
 * Slack pair posts to a workspace. (`StartMissionRun` belongs to this family
 * too, but is denied to every role — see above.)
 */
export const DROID_ACTING_READ_TOOL_IDS = [
  "ProposeMission",
  "ConnectApp",
  "slack_post_message",
  "slack_post_file",
] as const;

/**
 * Tools droid refuses to let go of, so asking is worse than not asking.
 *
 * `ToolSearch` is categorised `execute` but is a loader, not an executor: it
 * pages in the definitions of deferred tools. droid re-adds it unconditionally
 * whenever any allowed tool is deferred, so denying it produces a session that
 * reports the denial as ignored — verified against 0.179.0. Leaving it out is
 * not a hole: it only makes a definition visible, and a tool this policy
 * denied stays denied when the model tries to call it.
 */
export const DROID_UNDENIABLE_TOOL_IDS = ["ToolSearch"] as const;

/** The subset of `ExecToolInfo` this policy reads. */
export interface DroidToolInfo {
  readonly llmId: string;
  readonly category: string;
  readonly currentlyAllowed?: boolean;
}

/**
 * Tools droid already had switched off before this spawn touched anything.
 *
 * `updateSettings({ disabledToolIds })` replaces the disabled set rather than
 * adding to it, so anything the user's own droid config turned off has to be
 * carried into the new list or the spawn hands it back to the child — the
 * opposite of what a subagent policy is for. `ToolSearch` is excluded for the
 * same reason it is never denied: droid re-adds it and reports the denial as
 * ignored, which the read-back would then fail the spawn over.
 */
export function droidAlreadyDisabledToolIds(
  tools: ReadonlyArray<DroidToolInfo>,
) {
  return tools
    .filter(
      (tool) =>
        tool.currentlyAllowed === false &&
        !(DROID_UNDENIABLE_TOOL_IDS as readonly string[]).includes(tool.llmId),
    )
    .map((tool) => tool.llmId);
}

/**
 * The tools to deny, computed against the session's own live tool registry.
 *
 * The obvious shape — a static allowlist in `enabledToolIds` — does not work,
 * and the way it fails is silent. In the SDK's session path droid maps
 * `enabledToolIds` onto `additionalToolIds`: it *adds* to the default tool set
 * rather than replacing it, so a session created with the seven read tools
 * "allowed" was verified against droid 0.179.0 to still hold `Execute`, `Edit`,
 * and `Create`. Only `disabledToolIds` subtracts. The `restrictToolIds` field
 * that would give a true allowlist exists in droid's protocol but is not on the
 * SDK 0.6.0 option or `updateSettings` types, so it is unreachable from here.
 *
 * Denying by droid's own `category` rather than by a hardcoded list is what
 * keeps this honest as droid grows: a mutating tool added in a later release
 * arrives categorised `edit` or `execute` and is denied without anyone noticing
 * it. Intersecting with the live registry is what keeps it from breaking as
 * droid shrinks — droid rejects an unknown tool id outright, so a static list
 * naming a removed tool would fail every spawn.
 */
export function droidDisabledToolIds(
  tools: ReadonlyArray<DroidToolInfo>,
  writeCapable: boolean,
  inheritsParentTools = false,
): string[] {
  // `side` takes the harness's surface untouched; see the role's comment.
  if (inheritsParentTools) return [];
  const denied = new Set<string>();
  for (const tool of tools) {
    if ((DROID_UNDENIABLE_TOOL_IDS as readonly string[]).includes(tool.llmId))
      continue;
    const always = (
      DROID_ALWAYS_DISABLED_TOOL_IDS as readonly string[]
    ).includes(tool.llmId);
    const mutating =
      tool.category === "edit" ||
      tool.category === "execute" ||
      (DROID_ACTING_READ_TOOL_IDS as readonly string[]).includes(tool.llmId);
    if (always || (!writeCapable && mutating)) denied.add(tool.llmId);
  }
  return [...denied];
}

/**
 * Autonomy is the second lock, not the first: the tool list above is what makes
 * a read-only child read-only. `Low` allows file edits and read-only commands,
 * which for a child holding only read tools means "run what you have without
 * asking"; `Off` would instead route every read through a confirmation this
 * headless child cannot answer. Write-capable children get `High` for the same
 * reason claude's get `bypassPermissions` — the caller already chose to launch
 * an autonomous subagent.
 */
export function droidAutonomyLevel(
  writeCapable: boolean,
  inheritsParentTools = false,
) {
  return writeCapable || inheritsParentTools
    ? AutonomyLevel.High
    : AutonomyLevel.Low;
}

// --- Text helpers -------------------------------------------------------------

/** Exposed for the test; the key must never reach an event or a log line. */
export function redactKey(text: string, apiKey: string | undefined) {
  if (!apiKey) return text;
  return text.split(apiKey).join("<redacted>");
}

/**
 * Redaction across a stream of deltas rather than within one.
 *
 * Scrubbing each frame on its own is not enough here, because nothing
 * downstream keeps the frames apart: the manager concatenates deltas into its
 * live view, and this backend concatenates them into the run's partial text.
 * A key the SDK happens to split across two frames therefore passes both
 * checks and is reassembled intact. The emitter holds back the last
 * `key.length - 1` characters — the longest tail that could still be the head
 * of a split key — until the next frame lets it be judged, and `flush`
 * releases whatever is left when the stream ends.
 */
export function createDeltaRedactor(apiKey: string | undefined) {
  if (!apiKey) return { push: (text: string) => text, flush: () => "" };
  const keep = apiKey.length - 1;
  let carry = "";
  return {
    push(text: string) {
      const cleaned = redactKey(carry + text, apiKey);
      const emitted = cleaned.slice(0, Math.max(0, cleaned.length - keep));
      carry = cleaned.slice(emitted.length);
      return emitted;
    },
    flush() {
      const rest = redactKey(carry, apiKey);
      carry = "";
      return rest;
    },
  };
}

function boundedError(error: unknown, apiKey?: string) {
  const message = error instanceof Error ? error.message : String(error);
  return redactKey(message, apiKey).slice(0, 4_096);
}

/**
 * Every preview funnels through here, which is why the key is scrubbed at this
 * point rather than at the call sites: truncating first can cut a key in half,
 * and half a key no longer matches an exact-match redactor — it just leaks as
 * a prefix. Redact, then bound.
 */
function singleLine(text: string) {
  const flattened = redactKey(text, factoryApiKey())
    .replace(/\s+/g, " ")
    .trim();
  return flattened ? flattened.slice(0, PREVIEW_MAX_LENGTH) : undefined;
}

function safeJson(value: unknown) {
  try {
    const text = JSON.stringify(value);
    if (!text || text === "{}") return undefined;
    return singleLine(text);
  } catch {
    return undefined;
  }
}

function outputPreview(value: unknown): string | undefined {
  if (typeof value === "string") return singleLine(value);
  if (Array.isArray(value)) {
    const text = value
      .flatMap((part) => {
        if (!part || typeof part !== "object") return [];
        const record = part as { type?: unknown; text?: unknown };
        return record.type === "text" && typeof record.text === "string"
          ? [record.text]
          : [];
      })
      .join(" ");
    return singleLine(text) ?? safeJson(value);
  }
  return safeJson(value);
}

/** Text of an assistant message, for the finalText of a completed run. */
export function assistantText(parts: ReadonlyArray<TranscriptPart>) {
  return parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function assistantParts(
  message: FactoryDroidMessage,
  redact: (text: string) => string,
): TranscriptPart[] {
  const parts: TranscriptPart[] = [];
  for (const block of message.content) {
    if (block.type === "text") {
      parts.push({ type: "text", text: redact(block.text) });
    } else if (block.type === "thinking") {
      parts.push({ type: "thinking", text: redact(block.thinking) });
    } else if (block.type === "redacted_thinking") {
      parts.push({ type: "thinking", text: "", redacted: true });
    } else if (block.type === "tool_use") {
      parts.push({
        type: "toolCall",
        toolId: block.id,
        name: block.name,
        argsPreview: scrub(safeJson(block.input), redact),
      });
    }
  }
  return parts;
}

/** Redaction over an optional preview, so the call sites stay one line. */
function scrub(text: string | undefined, redact: (text: string) => string) {
  return text === undefined ? undefined : redact(text);
}

/**
 * droid writes one JSONL transcript per session, under a directory derived
 * from the resolved cwd. Verified against droid 0.179.0 on POSIX, whose
 * escaping is "-" + the absolute realpath with every run of "/" collapsed to
 * "-" and the leading one dropped — note that dots survive, unlike Claude
 * Code's.
 *
 * The win32 branch is unverified: droid's own escaping there was never
 * observed, so separators and the drive colon are folded the same way purely
 * so the result is a legal path rather than one carrying `C:\` in the middle
 * of a filename. Treat a Windows result as a best guess at the transcript, not
 * a promise.
 *
 * The escaping is its own function because the win32 shape cannot be produced
 * by `path.resolve` on a POSIX host, so it is only testable directly.
 */
export function droidCwdDirectory(resolved: string) {
  return `-${resolved
    .replace(/[\\/]+$/, "")
    .replace(/^([A-Za-z]):/, "$1")
    .replace(/^[\\/]+/, "")
    .replace(/[\\/]+/g, "-")}`;
}

export function droidSessionFilePath(cwd: string, sessionId: string) {
  let resolved = path.resolve(cwd);
  try {
    resolved = fs.realpathSync(resolved);
  } catch {
    // Not yet on disk, or unreadable; the unresolved path is the best guess.
  }
  const directory = droidCwdDirectory(resolved);
  return path.join(
    os.homedir(),
    ".factory",
    "sessions",
    directory,
    `${sessionId}.jsonl`,
  );
}

/**
 * Context occupancy from a droid `TokenUsage`.
 *
 * The four prompt/response counters describe what is sitting in the window:
 * fresh input, both halves of the cache, and the response. `thinkingTokens` is
 * deliberately excluded — it is a breakdown of output tokens, not a fifth
 * bucket, so adding it double-counts. Whether droid's counters are per-request
 * or cumulative across the session is *not* established here; the authoritative
 * capacity and occupancy come from `getContextStats()`, and this sum is the
 * live approximation between those.
 */
export function contextOccupancyTokens(
  usage: Partial<TokenUsage> | null | undefined,
) {
  if (!usage || typeof usage.inputTokens !== "number") return undefined;
  const count = (value: number | undefined) =>
    typeof value === "number" && Number.isFinite(value) ? value : 0;
  return (
    count(usage.inputTokens) +
    count(usage.cacheReadTokens) +
    count(usage.cacheCreationTokens) +
    count(usage.outputTokens)
  );
}

// --- Stream translation --------------------------------------------------------

/**
 * One native frame to zero or more normalized events.
 *
 * `tools` carries tool-use ids to names across the two frames that need it
 * (droid's `tool_result` does carry a `toolName`, but only for calls the SDK
 * saw start, so the map is the reliable side). Everything stateful beyond that
 * — run lifecycle, final text, queueing — is the session's, which is what
 * makes this function testable against a recorded frame.
 *
 * The `result` frame is deliberately absent: it settles a run, so it is the
 * session's to handle via `droidRunOutcome`.
 */
/**
 * `redact` is threaded in rather than applied at the emit sites because every
 * free-form string this function forwards can carry the credential, and the
 * riskiest ones are not the obvious ones. `droidChildEnv()` deliberately
 * leaves `FACTORY_API_KEY` in the child — droid needs its own key — so a
 * write-capable child that runs `env`, greps a shell profile, or simply
 * mentions the value puts it in a tool result or an assistant message, not
 * just in an error. Everything textual that leaves here passes through
 * `redact`, so a new frame type cannot quietly skip it.
 */
export function translateDroidEvent(
  event: DroidStreamEvent,
  tools: Map<string, string>,
  redact: (text: string) => string = (text) => text,
): SubagentEvent[] {
  switch (event.type) {
    case DroidMessageType.AssistantTextDelta:
      return event.text
        ? [{ _tag: "AssistantDelta", kind: "text", delta: redact(event.text) }]
        : [];
    case DroidMessageType.ThinkingTextDelta:
      return event.text
        ? [
            {
              _tag: "AssistantDelta",
              kind: "thinking",
              delta: redact(event.text),
            },
          ]
        : [];
    case DroidMessageType.Assistant: {
      const parts = assistantParts(event.message, redact);
      return parts.length > 0 ? [{ _tag: "AssistantMessage", parts }] : [];
    }
    case DroidMessageType.ToolCall: {
      // The finalized assistant message carries the same call as a toolCall
      // part, so this event only opens the live tool row.
      tools.set(event.toolUse.id, event.toolUse.name);
      return [
        {
          _tag: "ToolStart",
          toolId: event.toolUse.id,
          name: event.toolUse.name,
          argsPreview: scrub(safeJson(event.toolUse.input), redact),
        },
      ];
    }
    case DroidMessageType.ToolProgress:
      return [
        {
          _tag: "ToolUpdate",
          toolId: event.toolUseId,
          outputPreview: scrub(singleLine(event.content), redact),
        },
      ];
    case DroidMessageType.ToolResult: {
      const name = tools.get(event.toolUseId) ?? (event.toolName || "Tool");
      tools.delete(event.toolUseId);
      return [
        {
          _tag: "ToolEnd",
          toolId: event.toolUseId,
          name,
          isError: event.isError,
          outputPreview: scrub(outputPreview(event.content), redact),
        },
      ];
    }
    case DroidMessageType.TokenUsageUpdate: {
      const tokens = contextOccupancyTokens(event);
      return tokens === undefined ? [] : [{ _tag: "UsageChanged", tokens }];
    }
    case DroidMessageType.SettingsUpdated: {
      const modelLabel = event.settings.modelId;
      return modelLabel ? [{ _tag: "MetaChanged", meta: { modelLabel } }] : [];
    }
    case DroidMessageType.Error:
      return [{ _tag: "BackendError", message: redact(event.message) }];
    default:
      // user echoes (the prompt this session sent), text/thinking completions,
      // working-state changes (the SDK folds those into `result`), and the
      // mcp/mission/hook/permission channels the manager has no view for.
      return [];
  }
}

/** The terminal frame's own verdict, with this run's text as the fallback. */
export function droidRunOutcome(
  result: DroidResultMessage,
  partialText: string,
  errorText?: string,
  redact: (text: string) => string = (text) => text,
): RunOutcome {
  // droid's own final text is provider text like any other: a child that was
  // asked to echo its environment ends its turn holding the key.
  const finalText = redact(
    (result.result || result.text || "").trim() || partialText,
  );
  if (!result.isError && result.success !== false) {
    return { _tag: "Completed", finalText };
  }
  const details =
    (result.isError ? result.errors.filter((line) => line.trim()) : [])
      .join("\n")
      .trim() ||
    result.error?.message ||
    errorText ||
    `droid ended with ${result.subtype}`;
  return {
    _tag: "Failed",
    errorText: redact(details).slice(0, 4_096),
    partialText: finalText || undefined,
  };
}

/**
 * Wait for `operation`, giving up after `timeoutMs`. A timeout resolves — the
 * point is to stop waiting, not to fail — but a rejection propagates, so a
 * caller that cares whether the request itself failed can catch it. Callers
 * that do not care swallow it at the call site, where that choice is visible.
 */
export function waitBounded(operation: Promise<unknown>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  return Promise.race([operation.then(() => undefined), timeout]).finally(
    () => {
      if (timer) clearTimeout(timer);
    },
  );
}

// --- The session ---------------------------------------------------------------

const makeDroidSession = (
  task: SpawnTask,
): Effect.Effect<SubagentSession, SpawnError, Scope.Scope> =>
  Effect.gen(function* () {
    const role = roleProfile(task.role);
    const apiKey = factoryApiKey();
    if (!apiKey) {
      return yield* new SpawnError({
        message: "FACTORY_API_KEY is not set, so droid cannot authenticate.",
      });
    }
    const redact = (text: string) => redactKey(text, apiKey);
    const binary = resolveDroidBinary();
    if (!binary) {
      return yield* new SpawnError({
        message: "droid executable was not found on PATH.",
      });
    }
    // claude and cursor answer an untrusted cwd by restricting their setting
    // sources to user level. droid 0.6.0 has no equivalent — `CreateSessionOptions`
    // carries no setting-source or project-config switch — so its child would
    // load repository-scoped Factory settings and hooks from a checkout pi has
    // marked untrusted, which can act before or around the tool restriction
    // below. With no way to disable that, the boundary is kept by refusing.
    if (!task.parent.projectTrusted) {
      return yield* new SpawnError({
        message:
          "droid cannot be restricted to user-level settings, so it will not " +
          "run in a directory pi has not trusted.",
      });
    }

    const events = yield* Queue.make<SubagentEvent, Cause.Done>();
    const emit = (event: SubagentEvent) => {
      Queue.offerUnsafe(events, event);
    };
    const abortController = new AbortController();
    const modelId = droidModelId(task.model);
    const writeCapable = role.writeCapable;
    const inherits = role.inheritsParentTools;
    const reasoningEffort = droidReasoningEffort(task.reasoningEffort);

    const session = yield* Effect.tryPromise({
      try: () =>
        createSession({
          apiKey,
          cwd: task.cwd,
          // Point the SDK at the user's installed CLI rather than letting it
          // search PATH itself, so a session's droid version matches the one
          // their terminal runs.
          execPath: binary,
          // The SDK spawns the droid binary, which would otherwise inherit
          // every secret the parent holds for its own tools.
          env: droidChildEnv(),
          modelId,
          autonomyLevel: droidAutonomyLevel(writeCapable, inherits),
          // Tool restriction is applied below rather than here, because it
          // needs the session's own tool registry to be computed at all.
          ...(reasoningEffort ? { reasoningEffort } : {}),
          // A headless child has nobody to ask. Write-capable children run at
          // High autonomy so this should never fire; if it does, the answer
          // follows the role rather than defaulting to yes.
          permissionHandler: () =>
            writeCapable || inherits
              ? ToolConfirmationOutcome.ProceedOnce
              : ToolConfirmationOutcome.Cancel,
          abortSignal: abortController.signal,
        }),
      catch: (error) =>
        new SpawnError({ message: boundedError(error, apiKey) }),
    });

    const state = {
      closed: false,
      closing: false,
      /**
       * The in-flight close, when the interrupt fallback started one. The
       * finalizer awaits it rather than returning on `closing` alone: without
       * that, releasing the scope in the second or two the close takes would
       * report teardown complete — freeing the manager's concurrency slot —
       * while droid was still being shut down.
       */
      closingPromise: undefined as Promise<void> | undefined,
      activeRun: false,
      interruptRequested: false,
      runSerial: 0,
      runError: undefined as string | undefined,
      liveText: "",
      lastAssistantText: "",
      pendingPrompts: [] as string[],
      interruptTimer: undefined as ReturnType<typeof setTimeout> | undefined,
      meta: {
        backend: "droid",
        modelLabel: session.initResult.settings.modelId || modelId,
        nativeSessionId: session.sessionId,
        sessionFilePath: droidSessionFilePath(task.cwd, session.sessionId),
      } satisfies SubagentMeta as SubagentMeta,
    };
    const tools = new Map<string, string>();

    const partialText = () => state.liveText || state.lastAssistantText;

    const closeSession = async () => {
      state.closed = true;
      if (state.interruptTimer) clearTimeout(state.interruptTimer);
      state.interruptTimer = undefined;
      await waitBounded(
        session.close().catch(() => undefined),
        INTERRUPT_FALLBACK_MS,
      );
      abortController.abort();
      Queue.endUnsafe(events);
    };

    yield* Effect.addFinalizer(() =>
      Effect.promise(async () => {
        if (state.closing) {
          await state.closingPromise;
          return;
        }
        state.closing = true;
        // Settle before marking closed: every run must end in a RunSettled
        // even when the scope closes mid-run. Flush first — the pump cannot
        // recover the held-back tail once this settles and ends the queue.
        if (state.activeRun) {
          flushDeltas();
          settle(
            { _tag: "Interrupted", partialText: partialText() || undefined },
            state.runSerial,
          );
        }
        await closeSession();
      }),
    );

    /**
     * Restrict the tool surface before a single word of the task is sent.
     *
     * This is the whole role guarantee, so it fails the spawn rather than
     * degrading: read it back and refuse the session if droid still reports a
     * denied tool as allowed. The alternative — trusting the write — is how a
     * "reader" ends up holding a shell, and the additive `enabledToolIds`
     * behaviour documented on `droidDisabledToolIds` is exactly that failure
     * happening quietly once already.
     */
    yield* Effect.tryPromise({
      try: async () => {
        const listed = await session.listTools();
        const policyDenied = droidDisabledToolIds(
          listed.tools,
          writeCapable,
          inherits,
        );
        if (policyDenied.length === 0) return;
        // The write replaces droid's disabled set, so the user's own choices
        // have to ride along with the policy's — see
        // `droidAlreadyDisabledToolIds`.
        const disabledToolIds = [
          ...new Set([
            ...droidAlreadyDisabledToolIds(listed.tools),
            ...policyDenied,
          ]),
        ];
        await session.updateSettings({ disabledToolIds });
        const applied = await session.listTools();
        const escaped = applied.tools
          .filter(
            (tool) =>
              tool.currentlyAllowed && disabledToolIds.includes(tool.llmId),
          )
          .map((tool) => tool.llmId);
        if (escaped.length > 0) {
          throw new Error(
            `droid kept ${escaped.join(", ")} enabled for a ${task.role}.`,
          );
        }
      },
      catch: (error) =>
        new SpawnError({
          message: `Could not restrict droid's tools: ${boundedError(error, apiKey)}`,
        }),
    });

    const queuedView = () =>
      state.pendingPrompts.map((text) => ({
        text,
        kind: "follow-up" as const,
      }));

    const startNextQueued = () => {
      if (state.closed || state.activeRun) return;
      const next = state.pendingPrompts.shift();
      if (next === undefined) return;
      emit({ _tag: "QueueChanged", queued: queuedView() });
      startRun(next);
    };

    function settle(outcome: RunOutcome, serial: number) {
      if (!state.activeRun || serial !== state.runSerial) return;
      if (state.interruptTimer) clearTimeout(state.interruptTimer);
      state.interruptTimer = undefined;
      state.activeRun = false;
      state.interruptRequested = false;
      state.liveText = "";
      tools.clear();
      emit({ _tag: "RunSettled", outcome });
      queueMicrotask(startNextQueued);
    }

    const handleResult = (result: DroidResultMessage, serial: number) => {
      const tokens = contextOccupancyTokens(result.tokenUsage);
      if (tokens !== undefined) {
        emit({
          _tag: "UsageChanged",
          tokens,
          contextWindow: state.meta.contextWindow,
        });
      }
      settle(
        state.interruptRequested
          ? { _tag: "Interrupted", partialText: partialText() || undefined }
          : droidRunOutcome(result, partialText(), state.runError, redact),
        serial,
      );
    };

    let deltaRedactors = {
      text: createDeltaRedactor(apiKey),
      thinking: createDeltaRedactor(apiKey),
    };

    /**
     * Release the held-back tails once nothing more will join them, and start
     * the next stream clean. Without the reset a run that ends early — an
     * interrupt, an abort, a broken droid — leaves up to `key.length - 1`
     * characters buffered, which then arrive prepended to the *next* run's
     * first delta.
     */
    const flushDeltas = () => {
      for (const kind of ["text", "thinking"] as const) {
        const rest = deltaRedactors[kind].flush();
        if (!rest) continue;
        if (kind === "text") state.liveText += rest;
        emit({ _tag: "AssistantDelta", kind, delta: rest });
      }
      deltaRedactors = {
        text: createDeltaRedactor(apiKey),
        thinking: createDeltaRedactor(apiKey),
      };
    };

    const handleEvent = (event: DroidStreamEvent, serial: number) => {
      if (event.type === DroidMessageType.Result) {
        flushDeltas();
        handleResult(event, serial);
        return;
      }
      for (const translated of translateDroidEvent(event, tools, redact)) {
        if (translated._tag === "AssistantMessage") {
          flushDeltas();
          const text = assistantText(translated.parts);
          if (text) state.lastAssistantText = text;
          state.liveText = "";
        } else if (translated._tag === "AssistantDelta") {
          const delta = deltaRedactors[translated.kind].push(translated.delta);
          if (!delta) continue;
          if (translated.kind === "text") state.liveText += delta;
          emit({ ...translated, delta });
          continue;
        } else if (translated._tag === "BackendError") {
          state.runError = translated.message;
        } else if (translated._tag === "MetaChanged") {
          state.meta = { ...state.meta, ...translated.meta };
        }
        emit(translated);
      }
    };

    const pump = async (text: string, serial: number) => {
      let failure: string | undefined;
      try {
        for await (const event of session.stream(text, {
          includePartialMessages: true,
          abortSignal: abortController.signal,
        })) {
          if (state.closed || serial !== state.runSerial) break;
          handleEvent(event, serial);
        }
      } catch (error) {
        if (!state.closed && !abortController.signal.aborted) {
          failure = boundedError(error, apiKey);
        }
      } finally {
        if (state.activeRun && serial === state.runSerial && !state.closed) {
          // The generator ends at `result`, so reaching here still active means
          // it ended early: an interrupt, an abort, or a broken droid process.
          // Flush first — the held-back delta tail belongs to this run's
          // partial text, not to whatever runs next.
          flushDeltas();
          settle(
            state.interruptRequested
              ? { _tag: "Interrupted", partialText: partialText() || undefined }
              : {
                  _tag: "Failed",
                  errorText:
                    failure ??
                    state.runError ??
                    "droid stream ended without a result.",
                  partialText: partialText() || undefined,
                },
            serial,
          );
        } else if (failure && !state.closed) {
          emit({ _tag: "BackendError", message: failure });
        }
      }
    };

    function startRun(text: string) {
      if (state.closed || state.activeRun) return;
      const serial = ++state.runSerial;
      state.activeRun = true;
      state.interruptRequested = false;
      state.runError = undefined;
      state.liveText = "";
      state.lastAssistantText = "";
      tools.clear();
      emit({ _tag: "UserMessage", text });
      emit({ _tag: "RunStarted" });
      void pump(text, serial);
    }

    // Optional capability probe: droid reports occupancy and capacity together
    // and this is the only source for the capacity, but a slow or unsupported
    // call must not hold up the spawn (and its concurrency reservation).
    const contextStats = yield* Effect.tryPromise(() =>
      waitBounded(
        session.getContextStats().then((stats) => {
          if (stats.limit > 0) {
            state.meta = { ...state.meta, contextWindow: stats.limit };
          }
        }),
        CONTEXT_STATS_TIMEOUT_MS,
      ),
    ).pipe(Effect.orElseSucceed(() => undefined));
    void contextStats;

    emit({ _tag: "MetaChanged", meta: state.meta });
    if (state.meta.contextWindow !== undefined) {
      emit({ _tag: "UsageChanged", contextWindow: state.meta.contextWindow });
    }
    // Droid supplies its own system prompt and global instructions. This
    // initial message contributes only role framing and the assigned task.
    startRun(buildRolePrompt({ role, task: task.prompt }));

    return {
      meta: Effect.sync(() => state.meta),
      events: Stream.fromQueue(events),
      send: (text) =>
        Effect.suspend((): Effect.Effect<void, SendError> => {
          if (state.closed) {
            return new SendError({ message: "Subagent session is closed." });
          }
          if (state.activeRun) {
            state.pendingPrompts.push(text);
            emit({ _tag: "QueueChanged", queued: queuedView() });
            return Effect.void;
          }
          return Effect.sync(() => startRun(text));
        }),
      interrupt: Effect.promise(async () => {
        if (state.closed || !state.activeRun) return;
        const serial = state.runSerial;
        state.pendingPrompts = [];
        emit({ _tag: "QueueChanged", queued: [] });
        state.interruptRequested = true;
        try {
          await waitBounded(session.interrupt(), INTERRUPT_FALLBACK_MS);
        } catch (error) {
          if (!state.closed) {
            emit({
              _tag: "BackendError",
              message: boundedError(error, apiKey),
            });
          }
        }
        if (state.interruptTimer) clearTimeout(state.interruptTimer);
        state.interruptTimer = setTimeout(() => {
          if (state.closed || !state.activeRun || serial !== state.runSerial)
            return;
          // droid acknowledged nothing, so its turn may still be executing
          // tools. A session that ignores interrupts cannot be trusted with
          // further work — settle, then close it rather than let invisible
          // work continue behind a "settled" run. Flush first: the closing
          // session means the pump will never get to do it, and the held-back
          // delta tail is part of this run's partial text.
          flushDeltas();
          settle(
            { _tag: "Interrupted", partialText: partialText() || undefined },
            serial,
          );
          state.closing = true;
          // Kept so a scope release landing mid-close waits for it.
          state.closingPromise = closeSession();
          void state.closingPromise;
        }, INTERRUPT_FALLBACK_MS);
      }),
    } satisfies SubagentSession;
  });

// --- Backend --------------------------------------------------------------------

export const droidBackend: SubagentBackend = {
  name: "droid",
  capabilities: {
    // stream() is one call per turn, so a send() while busy queues a follow-up
    // rather than steering the live run.
    steering: false,
    modelSelection: true,
    reasoningEffort: true,
  },
  // Both halves matter: the SDK drives the local binary, and 0.6.0 will not
  // fall back to the CLI's own stored login for the key.
  available: Effect.sync(
    () => resolveDroidBinary() !== undefined && factoryApiKey() !== undefined,
  ),
  spawn: makeDroidSession,
};
