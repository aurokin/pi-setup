import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/**
 * The inline-command router owns parsing; the goal extension owns goal state.
 * This synchronous request keeps those responsibilities separate without making
 * input-handler ordering observable.
 */
export const INLINE_GOAL_CHANNEL = "inline-commands:goal";

export interface InlineGoalRequest {
  readonly text: string;
  readonly ctx: ExtensionContext;
  handled: boolean;
  replaced?: boolean;
  error?: string;
}

export function isInlineGoalRequest(
  value: unknown,
): value is InlineGoalRequest {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<InlineGoalRequest>;
  return (
    typeof candidate.text === "string" &&
    typeof candidate.ctx === "object" &&
    candidate.ctx !== null &&
    typeof candidate.handled === "boolean"
  );
}
