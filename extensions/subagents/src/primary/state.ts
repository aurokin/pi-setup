/**
 * The primary-runtime state machine, kept free of pi and Effect so its
 * transitions can be tested directly.
 *
 * The runtime is "active" the moment `/runtime claude` is accepted, but the
 * Claude session is not created until the first prompt arrives: the backend
 * spawns a session *and* submits an opening prompt in one call, so there is
 * nothing to spawn until the user says something. `sessionId` therefore stays
 * undefined through the first turn, and `pendingSpawn` guards the window where
 * two fast inputs would otherwise each try to create the session.
 */

import type { ReasoningEffort } from "../domain.ts";

export interface PrimaryState {
  active: boolean;
  model?: string;
  effort?: ReasoningEffort;
  sessionId?: string;
  pendingSpawn: boolean;
  /** Turns completed since activation, for the handoff back to pi. */
  turns: number;
}

export function initialState(): PrimaryState {
  return { active: false, pendingSpawn: false, turns: 0 };
}

/** Work the extension must do outside the state machine after activating. */
export interface ActivationEffects {
  /**
   * A session `--new` discarded. It has to be aborted rather than merely
   * forgotten: dropping the handle of a running turn leaves Claude working
   * invisibly, with nothing left able to stop it.
   */
  readonly abandonedSessionId?: string;
  /** Model or effort was passed at a session that already fixed both. */
  readonly ignoredOptions: boolean;
}

/**
 * Apply `/runtime claude` to the state.
 *
 * Model and effort are sticky: assigning them unconditionally meant a later
 * bare `/runtime claude` silently reset the model you chose earlier, which is
 * not what anyone types that meaning.
 *
 * They are also fixed when the session spawns. Options aimed at an open session
 * are therefore refused outright rather than held for "the next one" — without
 * `--new` there is no next one in this pi run, and storing them would leave
 * `/runtime status` and the bar naming settings the live session is not using.
 */
export function planActivation(
  state: PrimaryState,
  command: {
    readonly model?: string;
    readonly effort?: ReasoningEffort;
    readonly fresh?: boolean;
  },
): ActivationEffects {
  state.active = true;

  const asked = command.model !== undefined || command.effort !== undefined;
  if (asked && state.sessionId !== undefined && !command.fresh) {
    return { ignoredOptions: true };
  }

  if (command.model !== undefined) state.model = command.model;
  if (command.effort !== undefined) state.effort = command.effort;

  if (command.fresh) {
    const abandoned = state.sessionId;
    state.sessionId = undefined;
    state.turns = 0;
    return {
      ...(abandoned ? { abandonedSessionId: abandoned } : {}),
      ignoredOptions: false,
    };
  }

  return { ignoredOptions: false };
}

export type SendPlan =
  | { readonly kind: "spawn" }
  | { readonly kind: "send"; readonly sessionId: string }
  | { readonly kind: "busy" };

/**
 * Decide how a routed prompt reaches Claude.
 *
 * A second prompt arriving while the first is still creating the session is
 * held rather than dropped or raced: `manager.send` needs an id that does not
 * exist yet.
 */
export function planSend(state: PrimaryState): SendPlan {
  if (state.pendingSpawn) return { kind: "busy" };
  if (state.sessionId) return { kind: "send", sessionId: state.sessionId };
  return { kind: "spawn" };
}

export function describeState(state: PrimaryState): string {
  if (!state.active) return "Primary runtime: pi (native).";
  const model = state.model ?? "default";
  const effort = state.effort ? `, ${state.effort} effort` : "";
  const session = state.sessionId
    ? `session ${state.sessionId}, ${state.turns} turn${state.turns === 1 ? "" : "s"}`
    : "no session yet — it starts on your next prompt";
  return `Primary runtime: Claude (${model}${effort}); ${session}.`;
}

/**
 * The note handed to pi's model when the session comes back to it.
 *
 * pi has been idle throughout and its context contains none of the work, so
 * without this its first native turn would answer as though the conversation
 * had not happened.
 */
export function handoffSummary(options: {
  readonly turns: number;
  readonly model?: string;
  readonly finalText?: string;
}): string {
  const model = options.model ?? "Claude";
  if (options.turns === 0) {
    return `Primary runtime returned to pi. ${model} was active but ran no turns, so nothing happened that you cannot see.`;
  }
  const lines = [
    `Primary runtime returned to pi after ${options.turns} turn${options.turns === 1 ? "" : "s"} on ${model}.`,
    "Those turns are not in your context: the work happened in a separate session, and the working tree may have changed. Check the tree rather than assuming what it contains.",
  ];
  if (options.finalText?.trim()) {
    lines.push("", `Its last message was:`, "", options.finalText.trim());
  }
  return lines.join("\n");
}
