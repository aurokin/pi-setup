/**
 * Primary runtime: Claude answers the session's prompts, pi keeps everything
 * else.
 *
 * pi stays the UI, the session tree, the command host, and the tool provider
 * for its own extensions; only the model turn is redirected. The transport is
 * the same Claude backend the subagent tools use, held open across turns as a
 * single `origin: "primary"` session — which keeps it out of `subagent_list`
 * and friends (`isModelVisible` admits only `"model"`) and out of the fan-out
 * concurrency cap, since the user's own conversation should never queue behind
 * four background agents.
 *
 * Deliberately absent, relative to the runtime this replaces: the bubblewrap
 * sandbox, ACL/xattr write-evidence capture, credential leasing, worktree
 * leases, and run-artifact retention. Claude Code runs with the permissions it
 * normally has.
 */

import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";
import type { SubagentManagerShape } from "../manager.ts";
import type { SubagentSnapshot } from "../domain.ts";
import {
  emptyPrimaryRuntimeState,
  PRIMARY_RUNTIME_CHANNEL,
  type PrimaryRuntimeState,
} from "../../../shared/dashboard-state.ts";
import {
  completeRuntimeArguments,
  parseRuntimeCommand,
  type RuntimeCommand,
} from "./args.ts";
import { decideInput } from "./routing.ts";
import {
  describeState,
  handoffSummary,
  initialState,
  planActivation,
  planSend,
} from "./state.ts";

export interface PrimaryRuntimeDeps {
  readonly getManager: () => Promise<SubagentManagerShape>;
  readonly spawn: (options: {
    readonly prompt: string;
    readonly model?: string;
    readonly effort?: string;
    readonly cwd: string;
  }) => Promise<SubagentSnapshot>;
  readonly send: (id: string, text: string) => Promise<void>;
  /** Fire-and-forget abort, for `/runtime interrupt`. */
  readonly abort: (id: string) => void;
  readonly ui: () => ExtensionUIContext | undefined;
}

export function registerPrimaryRuntime(
  pi: ExtensionAPI,
  deps: PrimaryRuntimeDeps,
) {
  const state = initialState();
  let unsubscribe: (() => void) | undefined;
  /** Live snapshot of the primary session, for the indicator and the bar. */
  let snapshot = (): SubagentSnapshot | undefined => undefined;
  const isRunning = () => snapshot()?.status === "running";

  /**
   * Tell the dashboard who is actually answering. pi's own model never changes
   * while the runtime is active, so the bar would otherwise keep naming it.
   */
  const publishRuntime = () => {
    const snap = snapshot();
    const runtime: PrimaryRuntimeState = state.active
      ? {
          active: true,
          // The CLI's own label once a turn has landed; until then, whatever
          // was asked for, so the bar is never blank when it knows something.
          modelLabel: snap?.meta.modelLabel ?? state.model ?? "",
          effort: state.effort ?? "",
          contextTokens: snap?.usage.tokens ?? null,
          contextWindow:
            snap?.usage.contextWindow ?? snap?.meta.contextWindow ?? 0,
        }
      : emptyPrimaryRuntimeState();
    pi.events.emit(PRIMARY_RUNTIME_CHANNEL, runtime);
  };

  const setStatus = () => {
    publishRuntime();
    const ui = deps.ui();
    if (!ui) return;
    if (!state.active) {
      ui.setStatus("primary-runtime", undefined);
      return;
    }
    // pi shows no spinner for a turn it never started, so without this the
    // screen looks identical whether Claude is thinking or idle.
    const label = `claude/${state.model ?? "default"}`;
    ui.setStatus(
      "primary-runtime",
      isRunning()
        ? ui.theme.fg("accent", `${label} · working… (/runtime interrupt)`)
        : ui.theme.fg("accent", label),
    );
  };

  /** Mirror the live session's replies into pi's transcript as entries. */
  const watch = async (id: string) => {
    const manager = await deps.getManager();
    unsubscribe?.();
    snapshot = () => manager.view.get(id);
    let lastSeen = "";
    unsubscribe = manager.view.subscribeTo(id, () => {
      const snap = manager.view.get(id);
      // Every change refreshes the indicator, including the run starting.
      setStatus();
      if (!snap || snap.status === "running") return;
      const text = snap.finalText ?? "";
      if (!text || text === lastSeen) return;
      lastSeen = text;
      state.turns += 1;
      pi.appendEntry("runtime-turn", {
        id,
        status: snap.status,
        errorText: snap.errorText,
        text,
        model: snap.meta.modelLabel,
      });
      setStatus();
    });
  };

  const activate = async (
    command: Extract<RuntimeCommand, { action: "claude" }>,
    ctx: ExtensionCommandContext,
  ) => {
    // The same window `planSend` calls busy: the spawn in flight has no id yet,
    // so there is nothing for --new to abandon and the resolving spawn would
    // install the session it was told to replace.
    if (command.fresh && state.pendingSpawn) {
      ctx.ui?.notify(
        "The Claude session is still starting. Run that again in a moment.",
        "warning",
      );
      return;
    }

    const wasRunning = isRunning();
    const effects = planActivation(state, command);

    if (effects.abandonedSessionId) {
      // Abort before forgetting: a turn still in flight would otherwise keep
      // working with its handle gone, unreachable by `/runtime interrupt` and
      // running alongside whatever the next prompt spawns.
      if (wasRunning) deps.abort(effects.abandonedSessionId);
      unsubscribe?.();
      unsubscribe = undefined;
      snapshot = () => undefined;
    }
    setStatus();

    if (effects.ignoredOptions) {
      ctx.ui?.notify(
        `That Claude session fixed its model and effort when it started, so these were not applied. Add "--new" to start a fresh session on them.`,
        "warning",
      );
      return;
    }
    ctx.ui?.notify(
      `Claude is now the primary runtime. pi commands still work; "/runtime pi" switches back. The session starts on your next prompt.`,
      "info",
    );
  };

  const deactivate = async (ctx: ExtensionCommandContext) => {
    if (!state.active) {
      ctx.ui?.notify("pi is already the primary runtime.", "info");
      return;
    }
    let finalText: string | undefined;
    if (state.sessionId) {
      const manager = await deps.getManager();
      finalText = manager.view.get(state.sessionId)?.finalText;
    }
    const summary = handoffSummary({
      turns: state.turns,
      model: state.model ? `Claude (${state.model})` : "Claude",
      finalText,
    });
    unsubscribe?.();
    unsubscribe = undefined;
    state.active = false;
    setStatus();
    // A custom message, not an entry: this one must reach pi's model, which
    // has been idle and has none of the work in its context.
    pi.sendMessage(
      { customType: "runtime-handoff", content: summary, display: true },
      { deliverAs: "nextTurn", triggerTurn: false },
    );
    ctx.ui?.notify("pi is the primary runtime again.", "info");
    // The Claude session stays alive and resumable until session shutdown, so
    // switching back and forth does not throw away the conversation.
  };

  pi.registerCommand("runtime", {
    description: "Route this session's prompts to Claude, or back to pi",
    getArgumentCompletions: completeRuntimeArguments,
    handler: async (rawArgs, ctx) => {
      const command = parseRuntimeCommand(rawArgs);
      switch (command.action) {
        case "error":
          ctx.ui?.notify(command.message, "error");
          return;
        case "status":
          ctx.ui?.notify(describeState(state), "info");
          return;
        case "interrupt": {
          // pi's own interrupt key cannot reach here: returning "handled" from
          // the input hook means pi never started a turn to cancel, and its
          // extension API exposes no interrupt event. A command is the only
          // path, and commands keep working while Claude is primary.
          if (!state.sessionId || !isRunning()) {
            ctx.ui?.notify("Nothing is running to interrupt.", "info");
            return;
          }
          deps.abort(state.sessionId);
          ctx.ui?.notify("Interrupting the Claude turn…", "info");
          return;
        }
        case "pi":
          await deactivate(ctx);
          return;
        case "claude":
          await activate(command, ctx);
          return;
      }
    },
  });

  pi.on("input", async (event, ctx) => {
    const decision = decideInput({ active: state.active, text: event.text });
    if (decision.kind === "pass") return { action: "continue" as const };
    if (decision.kind === "reject") {
      deps.ui()?.notify(decision.reason, "error");
      return { action: "handled" as const };
    }

    const plan = planSend(state);
    if (plan.kind === "busy") {
      deps
        .ui()
        ?.notify(
          "The Claude session is still starting. Send that again in a moment.",
          "warning",
        );
      return { action: "handled" as const };
    }

    try {
      if (plan.kind === "send") {
        await deps.send(plan.sessionId, decision.text);
      } else {
        state.pendingSpawn = true;
        try {
          const snap = await deps.spawn({
            prompt: decision.text,
            model: state.model,
            effort: state.effort,
            cwd: ctx.cwd,
          });
          state.sessionId = snap.id;
          await watch(snap.id);
        } finally {
          state.pendingSpawn = false;
        }
      }
    } catch (error) {
      deps
        .ui()
        ?.notify(
          error instanceof Error ? error.message : String(error),
          "error",
        );
    }
    return { action: "handled" as const };
  });

  return {
    /** Cleared on session shutdown so a closing runtime stops listening. */
    dispose: () => {
      unsubscribe?.();
      unsubscribe = undefined;
      state.active = false;
      publishRuntime();
    },
  };
}
