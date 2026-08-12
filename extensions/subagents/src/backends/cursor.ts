/**
 * Cursor backend — real implementation over `@cursor/sdk` local agents.
 *
 * One scoped `Agent.create()` owns one persistent Cursor conversation; the
 * SDK runs the agent loop in-process (it does not spawn the `cursor-agent`
 * CLI). Each turn is an `agent.send()` returning a `Run` whose `stream()` is
 * pumped and translated into normalized SubagentEvents; a busy agent rejects
 * a second send, so follow-ups queue locally like the codex backend's.
 *
 * KNOWN LIMITATION — read-only is weaker here than on every other backend.
 * SDK 1.0.24 has no tool allow/deny list (`AgentOptions` and `SendOptions`
 * were checked: nothing like `disallowedTools` exists) and no system-prompt
 * option. The only subtractive lever is `mode: "plan"`, which this file uses
 * for read-only roles. That is Cursor's own plan mode, not a tool policy we
 * control: what it withholds is decided by Cursor and can change under us,
 * and nothing here can verify it. Do not treat a cursor `reader` as
 * OS-enforced read-only the way a codex one is.
 *
 * SECOND LIMITATION — a write-capable cursor child sees the parent's whole
 * environment. Every backend's children inherit it by design (see
 * `child-env.ts`: they need their own credentials), but the others get that
 * environment filtered on the way into a subprocess. This agent has no
 * subprocess: it runs here, so its shell tools read *this* process's env, and
 * the only way to withhold a variable would be to unset it in pi itself.
 * `redactCursorKey` therefore scrubs the credential this backend introduces,
 * and everything else the parent holds is exactly as exposed to a cursor
 * worker as it is to the parent's own shell. Spawn write-capable cursor
 * children with that in mind.
 *
 * Model ids are the SDK catalog's plain ids (`default`, `composer-2.5`,
 * `gpt-5.6-sol`, …) — NOT the `cursor-grok-4.5-low` names the CLI prints.
 * Reasoning effort rides on `model.params`: the catalog describes an
 * `effort`/`reasoning`/`thinking` parameter per model, and the shared scale
 * is clamped onto whatever the chosen model actually supports.
 */

import type {
  ModelListItem,
  ModelSelection,
  Run,
  RunResult,
  SDKAssistantMessage,
  SDKMessage,
  SDKToolUseMessage,
  TokenUsage,
} from "@cursor/sdk";
// `Agent` and `Cursor` are imported dynamically at spawn time rather than here.
// The SDK's module graph is loaded in every session, and almost none of them
// spawn a cursor child. Both uses already sit inside `Effect.tryPromise`, so a
// missing or broken SDK still surfaces as a SpawnError — the catalog lookup
// additionally falls back to dropping the effort, which is its existing
// behaviour for a slow or failing catalog.
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

const MODEL_LIST_TIMEOUT_MS = 5_000;
const RESULT_WAIT_TIMEOUT_MS = 5_000;
const INTERRUPT_FALLBACK_MS = 2_000;
const PREVIEW_MAX_LENGTH = 4_096;

// --- Small helpers -------------------------------------------------------------

/**
 * Scrub the Cursor key out of anything on its way to an event.
 *
 * Unlike the subprocess backends there is no child environment to filter: the
 * agent runs in this process, so its shell tools inherit `CURSOR_API_KEY`
 * directly and a write-capable child that runs `env` — or is talked into
 * echoing it — puts the credential in ordinary tool output. The key is read
 * from the environment by default so every call site is a bare `redact(...)`;
 * the parameter exists for the tests.
 *
 * There is no delta equivalent of droid's stream redactor because Cursor
 * emits no text deltas at all: every textual frame is a complete message, so
 * a value cannot be split across two of them.
 */
export function redactCursorKey(
  text: string,
  apiKey: string | undefined = process.env.CURSOR_API_KEY,
) {
  return apiKey ? text.split(apiKey).join("<redacted>") : text;
}

function boundedError(error: unknown) {
  return redactCursorKey(
    error instanceof Error ? error.message : String(error),
  ).slice(0, 4_096);
}

/** Every preview funnels through here, which is what makes it the chokepoint. */
function singleLine(text: string) {
  const flattened = redactCursorKey(text).replace(/\s+/g, " ").trim();
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

export function outputPreview(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return singleLine(value);
  return safeJson(value);
}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  return Promise.race([operation, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

// --- Mode, model, and effort mapping -------------------------------------------

/**
 * The whole role translation: Cursor has no tool allow/deny list, so
 * `mode: "plan"` is the only thing a read-only role gets — see the module
 * header for why that guarantee is weaker than the other backends'.
 */
export function cursorMode(writeCapable: boolean) {
  return writeCapable ? ("agent" as const) : ("plan" as const);
}

/**
 * The shared scale plus Cursor's parameter-value spellings. `extra-high` is
 * gpt-5.5's spelling of xhigh; `none` is the reasoning parameter's off.
 */
const EFFORT_SCALE = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

const EFFORT_VALUE_ALIASES: Record<string, (typeof EFFORT_SCALE)[number]> = {
  "extra-high": "xhigh",
  off: "none",
};

function effortScaleIndex(value: string) {
  const canonical =
    EFFORT_VALUE_ALIASES[value] ?? (value as (typeof EFFORT_SCALE)[number]);
  return EFFORT_SCALE.indexOf(canonical);
}

/** Nearest supported parameter value; "off" biases down, everything else up. */
function nearestEffortValue(
  effort: ReasoningEffort,
  values: readonly string[],
) {
  const target = effortScaleIndex(effort);
  const candidates = values
    .map((value) => ({ value, index: effortScaleIndex(value) }))
    .filter((candidate) => candidate.index >= 0)
    .sort((a, b) => {
      const distance = Math.abs(a.index - target) - Math.abs(b.index - target);
      if (distance !== 0) return distance;
      return effort === "off" ? a.index - b.index : b.index - a.index;
    });
  return candidates[0]?.value;
}

function catalogEntry(
  catalog: readonly ModelListItem[] | undefined,
  id: string,
) {
  return catalog?.find(
    (model) => model.id === id || model.aliases?.includes(id) === true,
  );
}

/**
 * Build the `ModelSelection` Cursor requires for local agents. Verified
 * against the live 1.0.24 catalog: effort lives in a per-model parameter
 * (`effort` on grok/claude models, `reasoning` on gpt models, boolean
 * `thinking` on older claude models), and `default` (Auto) has no parameters
 * at all — so an effort on Auto, or without a reachable catalog, is dropped
 * rather than guessed, because an invented parameter id fails the run.
 */
export function cursorModelSelection(
  model: string | undefined,
  effort: ReasoningEffort | undefined,
  catalog: readonly ModelListItem[] | undefined,
): ModelSelection {
  const requested = model?.trim();
  const entry = requested ? catalogEntry(catalog, requested) : undefined;
  const id = entry?.id ?? (requested || "default");
  if (!effort) return { id };
  const definition =
    entry?.parameters?.find((parameter) => parameter.id === "effort") ??
    entry?.parameters?.find((parameter) => parameter.id === "reasoning");
  if (definition) {
    const value = nearestEffortValue(
      effort,
      definition.values.map((option) => option.value),
    );
    return value ? { id, params: [{ id: definition.id, value }] } : { id };
  }
  const thinking = entry?.parameters?.find(
    (parameter) => parameter.id === "thinking",
  );
  if (thinking) {
    return {
      id,
      params: [{ id: "thinking", value: effort === "off" ? "false" : "true" }],
    };
  }
  return { id };
}

/**
 * Context capacity from the catalog's `context` parameter ("300k", "272k",
 * "1m"), read off the model's default variant. The SDK reports no capacity
 * at run time, so this is the only source; absent means unknown, which the
 * snapshot tolerates.
 */
export function catalogContextWindow(
  modelId: string,
  catalog: readonly ModelListItem[] | undefined,
) {
  const entry = catalogEntry(catalog, modelId);
  if (!entry) return undefined;
  const fromVariant = entry.variants
    ?.find((variant) => variant.isDefault === true)
    ?.params.find((parameter) => parameter.id === "context")?.value;
  const definition = entry.parameters?.find(
    (parameter) => parameter.id === "context",
  );
  const value =
    fromVariant ??
    (definition?.values.length === 1 ? definition.values[0]?.value : undefined);
  const match = value?.match(/^(\d+(?:\.\d+)?)([km])$/i);
  if (!match?.[1] || !match[2]) return undefined;
  const scale = match[2].toLowerCase() === "k" ? 1_000 : 1_000_000;
  return Math.round(Number(match[1]) * scale);
}

/**
 * Context occupancy from a per-turn `usage` frame. `totalTokens` documents
 * itself as excluding reasoning tokens, so the explicit fields are summed
 * instead. Caveat carried over from claude.ts: a usage that aggregates
 * several requests over a cached prompt overstates occupancy; the SDK emits
 * one usage per turn and nothing finer-grained, so this is the best
 * available figure, not a guarantee.
 */
export function cursorOccupancyTokens(usage: TokenUsage | undefined) {
  if (!usage) return undefined;
  const count = (value: number | undefined) =>
    typeof value === "number" && Number.isFinite(value) ? value : 0;
  return (
    count(usage.inputTokens) +
    count(usage.cacheReadTokens) +
    count(usage.cacheWriteTokens) +
    count(usage.outputTokens)
  );
}

// --- Frame translation ----------------------------------------------------------

/**
 * Translates one run's native frames into SubagentEvents. Per-run state on
 * purpose: tool ids and assistant text must not leak across turns, so the
 * session creates a fresh translator for every run.
 *
 * Frame realities this encodes (observed against a live 1.0.24 run):
 * - `thinking` frames carry whole completed thoughts, not deltas — they land
 *   in the transcript like codex reasoning items, and there is no streaming
 *   text delta at all on `run.stream()`.
 * - `assistant` frames are finalized messages whose `tool_use` blocks are
 *   also announced by separate `tool_call` frames, so tool starts dedupe on
 *   the call id.
 * - `status: ERROR` carries the failure message; the run's terminal outcome
 *   still arrives via `run.wait()`, which is where the session settles.
 */
export class CursorFrameTranslator {
  lastAssistantText = "";
  runErrorText: string | undefined;
  private startedTools = new Map<string, string>();

  translate(frame: SDKMessage): SubagentEvent[] {
    switch (frame.type) {
      case "system":
        return frame.model
          ? [{ _tag: "MetaChanged", meta: { modelLabel: frame.model.id } }]
          : [];
      case "assistant":
        return this.assistant(frame);
      case "thinking":
        return frame.text
          ? [
              {
                _tag: "AssistantMessage",
                parts: [
                  { type: "thinking", text: redactCursorKey(frame.text) },
                ],
              },
            ]
          : [];
      case "tool_call":
        return this.toolCall(frame);
      case "usage": {
        const tokens = cursorOccupancyTokens(frame.usage);
        return tokens === undefined ? [] : [{ _tag: "UsageChanged", tokens }];
      }
      case "status":
        if (frame.status === "ERROR" && frame.message) {
          this.runErrorText = redactCursorKey(frame.message);
        }
        return [];
      // `user` echoes the prompt this session already emitted at submit;
      // `request`/`task` carry nothing the normalized transcript renders.
      default:
        return [];
    }
  }

  private assistant(frame: SDKAssistantMessage): SubagentEvent[] {
    const events: SubagentEvent[] = [];
    const parts: TranscriptPart[] = [];
    const texts: string[] = [];
    for (const block of frame.message.content) {
      if (block.type === "text") {
        const text = redactCursorKey(block.text);
        parts.push({ type: "text", text });
        texts.push(text);
      } else if (block.type === "tool_use") {
        const argsPreview = safeJson(block.input);
        parts.push({
          type: "toolCall",
          toolId: block.id,
          name: block.name,
          argsPreview,
        });
        if (!this.startedTools.has(block.id)) {
          this.startedTools.set(block.id, block.name);
          events.push({
            _tag: "ToolStart",
            toolId: block.id,
            name: block.name,
            argsPreview,
          });
        }
      }
    }
    const text = texts.join("\n").trim();
    if (text) this.lastAssistantText = text;
    if (parts.length > 0) events.unshift({ _tag: "AssistantMessage", parts });
    return events;
  }

  private toolCall(frame: SDKToolUseMessage): SubagentEvent[] {
    const events: SubagentEvent[] = [];
    if (!this.startedTools.has(frame.call_id)) {
      this.startedTools.set(frame.call_id, frame.name);
      events.push({
        _tag: "ToolStart",
        toolId: frame.call_id,
        name: frame.name,
        argsPreview: safeJson(frame.args),
      });
    }
    if (frame.status === "running") return events;
    const name = this.startedTools.get(frame.call_id) ?? frame.name;
    this.startedTools.delete(frame.call_id);
    events.push({
      _tag: "ToolEnd",
      toolId: frame.call_id,
      name,
      isError: frame.status === "error",
      outputPreview: outputPreview(frame.result),
    });
    return events;
  }
}

// --- The session -----------------------------------------------------------------

const makeCursorSession = (
  task: SpawnTask,
): Effect.Effect<SubagentSession, SpawnError, Scope.Scope> =>
  Effect.gen(function* () {
    const role = roleProfile(task.role);
    const mode = cursorMode(role.writeCapable);
    const events = yield* Queue.make<SubagentEvent, Cause.Done>();
    const emit = (event: SubagentEvent) => {
      Queue.offerUnsafe(events, event);
    };

    // Optional capability probe, mirroring codex's model/list: only an
    // explicit effort needs the catalog, and a slow or failing catalog must
    // not hold up the spawn — without it the effort is dropped, not guessed.
    const catalog = task.reasoningEffort
      ? yield* Effect.tryPromise(async () =>
          withTimeout(
            // Same explicit key as the agent below, for the same reason.
            (await import("@cursor/sdk")).Cursor.models.list({
              apiKey: process.env.CURSOR_API_KEY,
            }),
            MODEL_LIST_TIMEOUT_MS,
          ),
        ).pipe(Effect.orElseSucceed(() => undefined))
      : undefined;
    const selection = cursorModelSelection(
      task.model,
      task.reasoningEffort,
      catalog,
    );

    const agent = yield* Effect.tryPromise({
      try: async () =>
        (await import("@cursor/sdk")).Agent.create({
          // Passed explicitly, never left to the SDK's fallback. With the key
          // only in the environment the SDK authenticates a run as something
          // else — verified: `Agent.create({model, local})` with a valid
          // CURSOR_API_KEY set fails every run with "Invalid User API Key",
          // while the same key passed here succeeds. It reads as a revoked
          // credential rather than as a wiring mistake, which is what makes it
          // worth a comment.
          apiKey: process.env.CURSOR_API_KEY,
          model: selection,
          name: task.title,
          // Initial conversation mode; re-asserted on every send below.
          mode,
          local: {
            cwd: task.cwd,
            // For cwds pi marked untrusted, restrict ambient Cursor settings
            // to user-level layers so an untrusted project's config cannot
            // reconfigure the child.
            ...(task.parent.projectTrusted
              ? {}
              : { settingSources: ["user" as const] }),
          },
        }),
      catch: (error) => new SpawnError({ message: boundedError(error) }),
    });

    const state = {
      closed: false,
      /**
       * The in-flight close, when one of the fallbacks started it. The
       * finalizer awaits it rather than returning on `closed` alone: `closed`
       * is set partway through the close, so a scope release landing in that
       * window would otherwise report teardown complete — freeing the
       * manager's concurrency slot — while the native run was still being
       * cancelled and the agent not yet closed.
       */
      closingPromise: undefined as Promise<void> | undefined,
      activeRun: false,
      interruptRequested: false,
      runSerial: 0,
      currentRun: undefined as Run | undefined,
      translator: new CursorFrameTranslator(),
      pendingPrompts: [] as string[],
      interruptTimer: undefined as ReturnType<typeof setTimeout> | undefined,
      meta: {
        backend: "cursor",
        modelLabel: selection.id,
        contextWindow: catalogContextWindow(selection.id, catalog),
        nativeSessionId: agent.agentId,
      } satisfies SubagentMeta as SubagentMeta,
    };

    const queuedView = () =>
      state.pendingPrompts.map((text) => ({
        text,
        kind: "follow-up" as const,
      }));

    const updateMeta = (patch: Partial<SubagentMeta>) => {
      state.meta = { ...state.meta, ...patch };
      emit({ _tag: "MetaChanged", meta: patch });
    };

    const partialText = () => state.translator.lastAssistantText || undefined;

    const startNextQueued = () => {
      if (state.closed || state.activeRun) return;
      const next = state.pendingPrompts.shift();
      if (next === undefined) return;
      emit({ _tag: "QueueChanged", queued: queuedView() });
      startRun(next);
    };

    const settleRun = (outcome: RunOutcome, serial: number) => {
      if (!state.activeRun || serial !== state.runSerial) return;
      if (state.interruptTimer) clearTimeout(state.interruptTimer);
      state.interruptTimer = undefined;
      // Retire the serial as part of settling, not just when the next run
      // starts. The interrupt fallback settles a run that is still streaming,
      // and every guard downstream is written against the serial — without
      // this, an ignored cancel keeps emitting frames after its own
      // RunSettled, and the stale run is never cancelled when its send finally
      // resolves. On the normal paths the stream has already ended, so this is
      // only ever a no-op there.
      state.runSerial += 1;
      state.activeRun = false;
      state.currentRun = undefined;
      state.interruptRequested = false;
      emit({ _tag: "RunSettled", outcome });
      queueMicrotask(startNextQueued);
    };

    const handleFrame = (frame: SDKMessage) => {
      for (const event of state.translator.translate(frame)) {
        if (event._tag === "MetaChanged") updateMeta(event.meta);
        else if (event._tag === "UsageChanged") {
          emit({ ...event, contextWindow: state.meta.contextWindow });
        } else emit(event);
      }
    };

    /**
     * `run.wait()` should resolve immediately once the stream has ended;
     * the bound covers an SDK that never delivers the terminal record, and
     * the fallback reads the same fields off the run handle itself.
     */
    const runResult = async (run: Run): Promise<Partial<RunResult>> => {
      try {
        return await withTimeout(run.wait(), RESULT_WAIT_TIMEOUT_MS);
      } catch {
        // The handle carries the same terminal fields, so a run that did
        // finish is still reported as finished; only "running" has no verdict
        // to read yet.
        const status = run.status === "running" ? undefined : run.status;
        return { status, result: run.result, error: run.error };
      }
    };

    const outcomeForResult = (result: Partial<RunResult>): RunOutcome => {
      if (state.interruptRequested || result.status === "cancelled") {
        return { _tag: "Interrupted", partialText: partialText() };
      }
      if (result.status === "finished") {
        return {
          _tag: "Completed",
          finalText:
            redactCursorKey(result.result?.trim() ?? "") ||
            state.translator.lastAssistantText,
        };
      }
      return {
        _tag: "Failed",
        errorText: boundedError(
          result.error?.message ??
            state.translator.runErrorText ??
            "Cursor run ended without a result",
        ),
        partialText: partialText(),
      };
    };

    function startRun(text: string) {
      if (state.closed || state.activeRun) return;
      const serial = ++state.runSerial;
      state.activeRun = true;
      state.interruptRequested = false;
      state.translator = new CursorFrameTranslator();
      emit({ _tag: "UserMessage", text });
      emit({ _tag: "RunStarted" });

      void (async () => {
        try {
          const run = await agent.send(text, { mode });
          if (state.closed || serial !== state.runSerial || !state.activeRun) {
            // Settled locally (interrupt fallback or teardown) before the
            // send resolved — whatever this run does is invisible; stop it.
            void run.cancel().catch(() => undefined);
            return;
          }
          state.currentRun = run;
          if (state.interruptRequested)
            void run.cancel().catch(() => undefined);
          for await (const frame of run.stream()) {
            if (state.closed || serial !== state.runSerial) return;
            handleFrame(frame);
          }
          if (state.closed || serial !== state.runSerial) return;
          const result = await runResult(run);
          settleRun(outcomeForResult(result), serial);
          // The stream ended but the terminal record never arrived and Cursor
          // still calls the run active. Settling alone would start queued work
          // against a busy Agent — the same trap as an unacknowledged cancel,
          // so the same answer: close rather than let invisible work continue
          // behind a settled run.
          if (result.status === undefined && run.status === "running") {
            closeDetached();
          }
        } catch (error) {
          if (state.closed || serial !== state.runSerial) return;
          settleRun(
            state.interruptRequested
              ? { _tag: "Interrupted", partialText: partialText() }
              : {
                  _tag: "Failed",
                  errorText: boundedError(error),
                  partialText: partialText(),
                },
            serial,
          );
        }
      })();
    }

    const closeSession = async () => {
      if (state.interruptTimer) clearTimeout(state.interruptTimer);
      // Captured before settling: settleRun clears currentRun, so reading it
      // afterwards always found undefined and the cancel below never ran —
      // closing the scope left the Cursor run going.
      const run = state.currentRun;
      // Settle before marking closed so the run gets a proper Interrupted
      // outcome; every run must end in a RunSettled.
      if (state.activeRun) {
        settleRun(
          { _tag: "Interrupted", partialText: partialText() },
          state.runSerial,
        );
      }
      state.closed = true;
      if (run) {
        await withTimeout(run.cancel(), INTERRUPT_FALLBACK_MS).catch(
          () => undefined,
        );
      }
      agent.close();
      Queue.endUnsafe(events);
    };

    /** Start a close without waiting for it, at most once. */
    const closeDetached = () => {
      state.closingPromise ??= closeSession();
      void state.closingPromise;
    };

    yield* Effect.addFinalizer(() =>
      Effect.promise(async () => {
        if (state.closed || state.closingPromise) {
          await state.closingPromise;
          return;
        }
        await closeSession();
      }),
    );

    emit({ _tag: "MetaChanged", meta: state.meta });
    // Cursor runs its own harness prompt (there is no system-prompt option),
    // so this child gets the role framing and task only as a first user
    // message, never as enforcement. Cursor supplies its global instructions.
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
            // A busy Cursor agent rejects a concurrent send (AgentBusyError),
            // so follow-ups queue here and start when the run settles.
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
        const run = state.currentRun;
        if (run) {
          void run.cancel().catch((error) => {
            if (!state.closed && serial === state.runSerial) {
              emit({ _tag: "BackendError", message: boundedError(error) });
            }
          });
        }
        if (state.interruptTimer) clearTimeout(state.interruptTimer);
        state.interruptTimer = setTimeout(() => {
          // The SDK never acknowledged the cancel (or the send has not even
          // resolved into a run yet), so the native run may still be working.
          // Settling alone would report the run finished while leaving an
          // Agent that rejects the next send with AgentBusyError — so close
          // the session, exactly as droid does in the same spot. closeSession
          // settles the run itself, and the serial guard keeps any late native
          // frames invisible.
          if (state.activeRun && serial === state.runSerial) {
            closeDetached();
          }
        }, INTERRUPT_FALLBACK_MS);
      }),
    } satisfies SubagentSession;
  });

// --- Backend ---------------------------------------------------------------------

export const cursorBackend: SubagentBackend = {
  name: "cursor",
  capabilities: {
    steering: false,
    modelSelection: true,
    reasoningEffort: true,
  },
  // The SDK runs in-process and authenticates with CURSOR_API_KEY only —
  // it does not read the cursor-agent CLI's login state.
  available: Effect.sync(
    () => (process.env.CURSOR_API_KEY ?? "").trim().length > 0,
  ),
  spawn: makeCursorSession,
};
