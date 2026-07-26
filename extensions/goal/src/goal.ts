/**
 * A goal, and the rules about who may change it.
 *
 * The whole point of a persisted goal is that it outlives the model's opinion
 * of it. A goal the model can rewrite is just a note it keeps to itself, and a
 * goal the model can clear is one it will clear the moment the work gets hard.
 *
 * So the authority is split, exactly as codex splits it (`codex-rs/ext/goal/`):
 *
 * - **The user** sets the text, pauses, resumes, and clears.
 * - **The model** may say `complete` or `blocked`, and nothing else.
 *
 * `applyModelUpdate` is where that split is enforced, and it is the reason
 * every transition lives in this file rather than in the tool handler.
 */

export type GoalStatus = "active" | "paused" | "complete" | "blocked";

/** The two the model is allowed to report. */
export type ModelStatus = Extract<GoalStatus, "complete" | "blocked">;

export const MODEL_STATUSES: readonly ModelStatus[] = ["complete", "blocked"];

export interface Goal {
  readonly text: string;
  readonly status: GoalStatus;
  readonly setAt: number;
  readonly updatedAt: number;
  /** The model's last word on why, when it reported complete or blocked. */
  readonly note?: string;
}

export function createGoal(
  text: string,
  now: number,
): Goal | { error: string } {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return { error: "A goal needs text: `/goal ship the auth migration`." };
  }
  return { text: trimmed, status: "active", setAt: now, updatedAt: now };
}

export function isModelStatus(value: unknown): value is ModelStatus {
  return MODEL_STATUSES.includes(value as ModelStatus);
}

/**
 * Apply the model's report.
 *
 * Refusing on a paused goal is deliberate. Pausing is the user saying "not
 * now"; a model that marks a paused goal complete has decided the pause is
 * over, which is not its call.
 */
export function applyModelUpdate(
  goal: Goal | undefined,
  status: string,
  note: string | undefined,
  now: number,
): { goal: Goal } | { error: string } {
  if (!goal) {
    return { error: "There is no goal set. Nothing to update." };
  }
  if (!isModelStatus(status)) {
    return {
      error: `A goal can only be reported as ${MODEL_STATUSES.join(" or ")}. Setting, pausing, resuming, and clearing are the user's to do.`,
    };
  }
  if (goal.status === "paused") {
    return {
      error:
        "This goal is paused. Resuming it is the user's call, so report against it once they do.",
    };
  }
  return { goal: { ...goal, status, note, updatedAt: now } };
}

/** The user's transitions, which have no such restrictions. */
export function pause(goal: Goal, now: number): Goal {
  return { ...goal, status: "paused", updatedAt: now };
}

export function resume(goal: Goal, now: number): Goal {
  return { ...goal, status: "active", updatedAt: now, note: undefined };
}

/**
 * Whether this goal should still be in the model's context.
 *
 * A finished goal stays in the session as a record but stops being an
 * instruction: leaving "ship the auth migration" in the system prompt after it
 * shipped is how a model ends up re-shipping it.
 */
export function isLive(goal: Goal | undefined): goal is Goal {
  return goal?.status === "active";
}

export function renderForPrompt(goal: Goal): string {
  return [
    "## Current goal",
    "",
    goal.text,
    "",
    "This was set by the user and persists across turns. Keep it in view: when you finish a step, ask whether it moved this forward. Do not treat it as done until it is.",
    "",
    "When the goal is met, or when you are genuinely blocked on something only the user can resolve, call `goal_update`. You cannot change the goal itself, pause it, or clear it — say so and ask if you think it should change.",
  ].join("\n");
}

export function renderForUser(goal: Goal | undefined, now: number): string {
  if (!goal) {
    return "No goal set. `/goal <text>` sets one; it then rides along in every turn until you clear it.";
  }
  const age = Math.max(0, now - goal.setAt);
  const lines = [
    `${STATUS_LABEL[goal.status]}  (set ${humanizeAge(age)} ago)`,
    "",
    goal.text,
  ];
  if (goal.note) lines.push("", `Model's note: ${goal.note}`);
  if (goal.status !== "active") {
    lines.push(
      "",
      goal.status === "paused"
        ? "Paused, so it is out of the model's context. `/goal resume` puts it back."
        : "Finished, so it is out of the model's context. `/goal clear` removes it, or `/goal resume` reopens it.",
    );
  }
  return lines.join("\n");
}

const STATUS_LABEL: Record<GoalStatus, string> = {
  active: "Active",
  paused: "Paused",
  complete: "Complete",
  blocked: "Blocked",
};

function humanizeAge(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
