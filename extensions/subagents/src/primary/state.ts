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
