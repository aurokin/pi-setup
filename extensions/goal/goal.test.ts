import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  applyModelUpdate,
  createGoal,
  isLive,
  MODEL_STATUSES,
  pause,
  renderForPrompt,
  renderForUser,
  resume,
  type Goal,
} from "./src/goal.ts";
import { GOAL_ENTRY_TYPE, latestGoal, toPersisted } from "./src/persistence.ts";

const T0 = 1_000_000;

function goal(overrides: Partial<Goal> = {}): Goal {
  const created = createGoal("ship the auth migration", T0);
  assert.ok(!("error" in created));
  return { ...created, ...overrides };
}

function entry(g: Goal | undefined) {
  return { type: "custom", customType: GOAL_ENTRY_TYPE, data: toPersisted(g) };
}

// --- authority ----------------------------------------------------------------

test("the model may report complete or blocked", () => {
  for (const status of MODEL_STATUSES) {
    const result = applyModelUpdate(goal(), status, "done", T0 + 1);
    assert.ok(!("error" in result));
    assert.equal(result.goal.status, status);
    assert.equal(result.goal.text, "ship the auth migration");
  }
});

test("the model cannot reword, pause, clear, or reactivate a goal", () => {
  // This is the property the whole extension exists for. A goal the model can
  // edit is a note it keeps to itself; one it can clear is one that disappears
  // the moment the work gets hard.
  for (const status of ["active", "paused", "cleared", "", "COMPLETE"]) {
    const result = applyModelUpdate(goal(), status, "note", T0 + 1);
    assert.ok("error" in result, `"${status}" must be refused`);
    assert.match(result.error, /user/);
  }
});

test("the model cannot report against a goal the user paused", () => {
  // Pausing is the user saying "not now". Marking it complete anyway is the
  // model deciding the pause is over.
  const result = applyModelUpdate(pause(goal(), T0), "complete", "x", T0 + 1);
  assert.ok("error" in result);
});

test("reporting with no goal set is an error, not a new goal", () => {
  const result = applyModelUpdate(undefined, "complete", "x", T0);
  assert.ok("error" in result);
});

test("the tool schema and the allowed statuses cannot drift apart", () => {
  // The schema spells the two literals out, because deriving them from
  // MODEL_STATUSES widens to `string` and stops constraining anything. This is
  // the check that keeps the two in step.
  const source = readFileSync(join(import.meta.dirname, "index.ts"), "utf8");
  const literals = [...source.matchAll(/Type\.Literal\("(\w+)"\)/g)].map(
    (m) => m[1],
  );
  assert.deepEqual(literals, [...MODEL_STATUSES]);
});

// --- user transitions ---------------------------------------------------------

test("the user's transitions have no such restrictions", () => {
  const done = applyModelUpdate(goal(), "complete", "shipped", T0);
  assert.ok(!("error" in done));
  assert.equal(resume(done.goal, T0 + 1).status, "active");
  assert.equal(pause(goal(), T0 + 1).status, "paused");
});

test("resuming drops the note the model left", () => {
  // "Blocked on the staging credentials" is stale the moment the user reopens
  // the goal, and a stale blocker read as current is worse than none.
  const blocked = applyModelUpdate(goal(), "blocked", "need creds", T0);
  assert.ok(!("error" in blocked));
  assert.equal(resume(blocked.goal, T0 + 1).note, undefined);
});

// --- context ------------------------------------------------------------------

test("only an active goal reaches the model", () => {
  // A completed goal left in the system prompt is an instruction to do it
  // again; a paused one is an instruction the user explicitly suspended.
  assert.equal(isLive(goal()), true);
  assert.equal(isLive(goal({ status: "paused" })), false);
  assert.equal(isLive(goal({ status: "complete" })), false);
  assert.equal(isLive(goal({ status: "blocked" })), false);
  assert.equal(isLive(undefined), false);
});

test("the prompt carries the goal and the limits on changing it", () => {
  const text = renderForPrompt(goal());
  assert.match(text, /ship the auth migration/);
  assert.match(text, /goal_update/);
  assert.match(text, /cannot change/i);
});

test("the listing explains why a finished goal stopped mattering", () => {
  assert.match(renderForUser(undefined, T0), /No goal set/);
  assert.match(renderForUser(goal(), T0), /Active/);
  assert.match(renderForUser(goal({ status: "paused" }), T0), /resume/);
  assert.match(
    renderForUser(goal({ status: "complete", note: "shipped" }), T0),
    /shipped/,
  );
});

// --- persistence --------------------------------------------------------------

test("the last entry wins, so a session resumes where it left off", () => {
  const finished = applyModelUpdate(goal(), "complete", "shipped", T0 + 5);
  assert.ok(!("error" in finished));
  const restored = latestGoal([
    { type: "message" },
    entry(goal()),
    { type: "message" },
    entry(finished.goal),
  ]);
  assert.equal(restored?.status, "complete");
  assert.equal(restored?.note, "shipped");
});

test("clearing persists as an entry, not as an absence", () => {
  // Dropping the entry instead would leave the previous goal as the last one on
  // record, so a resume would resurrect a goal the user deleted.
  assert.equal(latestGoal([entry(goal()), entry(undefined)]), undefined);
});

test("a session with no goal entries has no goal", () => {
  assert.equal(latestGoal([]), undefined);
  assert.equal(latestGoal([{ type: "message" }]), undefined);
});

test("entries from another extension are not mistaken for goals", () => {
  assert.equal(
    latestGoal([
      { type: "custom", customType: "background-terminal", data: { goal: {} } },
    ]),
    undefined,
  );
});

test("a malformed or future entry yields no goal rather than a wrong one", () => {
  // Sessions get hand-edited, shared, and written by other versions of this
  // code. Half-reading one would put text in the system prompt that the user
  // never wrote.
  const cases: unknown[] = [
    { type: "custom", customType: GOAL_ENTRY_TYPE, data: undefined },
    { type: "custom", customType: GOAL_ENTRY_TYPE, data: { version: 2 } },
    {
      type: "custom",
      customType: GOAL_ENTRY_TYPE,
      data: { version: 1, goal: { text: "x", status: "invented" } },
    },
    {
      type: "custom",
      customType: GOAL_ENTRY_TYPE,
      data: { version: 1, goal: { status: "active" } },
    },
  ];
  for (const broken of cases) {
    assert.equal(latestGoal([entry(goal()), broken]), undefined);
  }
});

// --- creation -----------------------------------------------------------------

test("an empty goal is refused", () => {
  assert.ok("error" in createGoal("   ", T0));
});

test("a goal is stored trimmed", () => {
  const created = createGoal("  ship it  ", T0);
  assert.ok(!("error" in created));
  assert.equal(created.text, "ship it");
});

test("a newer goal supersedes an older entry this version cannot read", () => {
  // Stopping the scan at an unreadable entry would let one hand-edited or
  // downgraded line mask every goal set after it, forever.
  const restored = latestGoal([
    entry(goal()),
    { type: "custom", customType: GOAL_ENTRY_TYPE, data: { version: 99 } },
    entry(goal({ text: "the newer goal" })),
  ]);
  assert.equal(restored?.text, "the newer goal");
});

test("an unreadable entry still invalidates the goal it superseded", () => {
  // The state at that point is unknown, so the older goal is not trustworthy
  // either — it is only safe to trust an entry that comes after.
  assert.equal(
    latestGoal([
      entry(goal()),
      { type: "custom", customType: GOAL_ENTRY_TYPE, data: { version: 99 } },
    ]),
    undefined,
  );
});
