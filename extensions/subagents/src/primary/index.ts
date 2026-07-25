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
import { parseRuntimeCommand } from "./args.ts";
import { decideInput } from "./routing.ts";
import {
  describeState,
  handoffSummary,
  initialState,
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
  readonly ui: () => ExtensionUIContext | undefined;
}

export function registerPrimaryRuntime(
  pi: ExtensionAPI,
  deps: PrimaryRuntimeDeps,
) {
  const state = initialState();
  let unsubscribe: (() => void) | undefined;

  const setStatus = () => {
    const ui = deps.ui();
    if (!ui) return;
    if (!state.active) {
      ui.setStatus("primary-runtime", undefined);
      return;
    }
    ui.setStatus(
      "primary-runtime",
      ui.theme.fg("accent", `claude/${state.model ?? "default"}`),
    );
  };

  /** Mirror the live session's replies into pi's transcript as entries. */
  const watch = async (id: string) => {
    const manager = await deps.getManager();
    unsubscribe?.();
    let lastSeen = "";
    unsubscribe = manager.view.subscribeTo(id, () => {
      const snap = manager.view.get(id);
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
    command: { model?: string; effort?: string },
    ctx: ExtensionCommandContext,
  ) => {
    state.active = true;
    state.model = command.model;
    state.effort = command.effort as never;
    setStatus();
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
    handler: async (rawArgs, ctx) => {
      const command = parseRuntimeCommand(rawArgs);
      switch (command.action) {
        case "error":
          ctx.ui?.notify(command.message, "error");
          return;
        case "status":
          ctx.ui?.notify(describeState(state), "info");
          return;
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
    },
  };
}
