/**
 * Reading the goal back out of the session file.
 *
 * A goal that vanishes on `/resume` is not a persisted goal, it is a variable.
 * Every change appends a `custom` entry, and the last one wins — an event log
 * rather than a mutable record, which is what the session file already is and
 * what makes forking a session carry the goal that branch had at the time.
 *
 * `custom` entries deliberately do not participate in LLM context, so the goal
 * reaches the model exactly once, through the system prompt, rather than twice
 * with two different histories.
 */

import type { Goal, GoalStatus } from "./goal.ts";

export const GOAL_ENTRY_TYPE = "goal";

const VERSION = 1;

export interface PersistedGoal {
  readonly version: number;
  /** Absent means cleared: the log records the removal rather than losing it. */
  readonly goal?: Goal;
}

export function toPersisted(goal: Goal | undefined): PersistedGoal {
  return { version: VERSION, goal };
}

const STATUSES: readonly GoalStatus[] = [
  "active",
  "paused",
  "complete",
  "blocked",
];

/**
 * The last goal state in a session's entries, or undefined.
 *
 * Reads defensively rather than trusting the file: sessions are hand-edited,
 * shared, and written by older versions of this extension, and a malformed
 * entry should mean "no goal" rather than a crash on startup.
 */
export function latestGoal(entries: readonly unknown[]): Goal | undefined {
  let found: Goal | undefined;
  for (const entry of entries) {
    const record = entry as {
      type?: unknown;
      customType?: unknown;
      data?: unknown;
    };
    if (record.type !== "custom" || record.customType !== GOAL_ENTRY_TYPE) {
      continue;
    }
    const parsed = parse(record.data);
    // An entry this version cannot read means the state at that point is
    // unknown, so the older goal it superseded is not trustworthy either — but
    // the scan continues, because a *newer* entry it can read supersedes the
    // unreadable one in turn. Stopping here would let one hand-edited or
    // downgraded entry mask every goal set after it, forever.
    found = parsed === "unknown" ? undefined : parsed;
  }
  return found;
}

function parse(data: unknown): Goal | undefined | "unknown" {
  if (typeof data !== "object" || data === null) return "unknown";
  const record = data as Record<string, unknown>;
  if (record.version !== VERSION) return "unknown";
  const goal = record.goal;
  if (goal === undefined) return undefined;
  if (typeof goal !== "object" || goal === null) return "unknown";
  const candidate = goal as Record<string, unknown>;
  if (typeof candidate.text !== "string" || candidate.text.length === 0) {
    return "unknown";
  }
  if (!STATUSES.includes(candidate.status as GoalStatus)) return "unknown";
  return {
    text: candidate.text,
    status: candidate.status as GoalStatus,
    setAt: typeof candidate.setAt === "number" ? candidate.setAt : 0,
    updatedAt:
      typeof candidate.updatedAt === "number" ? candidate.updatedAt : 0,
    note: typeof candidate.note === "string" ? candidate.note : undefined,
  };
}
