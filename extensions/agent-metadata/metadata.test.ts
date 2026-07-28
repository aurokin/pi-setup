import assert from "node:assert/strict";
import test from "node:test";
import {
  clearAllArgs,
  createRunState,
  isBlockingTool,
  normalizeLabel,
  normalizeValue,
  PUBLISHED_FIELDS,
  setOptionArgs,
  unsetOptionArgs,
} from "./src/metadata.ts";

test("a session with no turn running is idle", () => {
  assert.equal(createRunState().current(), "idle");
});

test("a turn is busy, and the end of it is idle again", () => {
  const state = createRunState();
  assert.equal(state.turnStarted(), "busy");
  assert.equal(state.turnEnded(), "idle");
});

test("a question outranks the turn that asked it", () => {
  // The whole point of publishing: a pi blocked on ask_user renders exactly
  // like a pi thinking hard, so no amount of pane scraping can tell them apart.
  const state = createRunState();
  state.turnStarted();
  assert.equal(state.blocked("call-1"), "waiting");
  assert.equal(state.unblocked("call-1"), "busy");
  assert.equal(state.turnEnded(), "idle");
});

test("parallel questions are tracked by id, not counted", () => {
  // An end event for a call we never saw start must not release a different
  // question's block.
  const state = createRunState();
  state.turnStarted();
  state.blocked("call-1");
  state.blocked("call-2");
  assert.equal(state.unblocked("call-2"), "waiting");
  assert.equal(state.unblocked("never-started"), "waiting");
  assert.equal(state.unblocked("call-1"), "busy");
});

test("an interrupted turn does not strand the pane on waiting", () => {
  // Interrupting mid-question means the tool never reports an end, so the
  // block has to be dropped with the turn or the pane looks blocked forever.
  const state = createRunState();
  state.turnStarted();
  state.blocked("call-1");
  assert.equal(state.turnEnded(), "idle");
});

test("only a question counts as blocked on a human", () => {
  assert.ok(isBlockingTool("ask_user"));
  assert.ok(!isBlockingTool("bash"));
  assert.ok(!isBlockingTool("read"));
});

test("an absent value clears the field rather than writing blank", () => {
  // An empty option means "absent" in the contract, and a session name is
  // whatever someone typed — including nothing.
  assert.equal(normalizeValue(undefined), undefined);
  assert.equal(normalizeValue(""), undefined);
  assert.equal(normalizeValue("   "), undefined);
  assert.equal(normalizeLabel(undefined), undefined);
  assert.equal(normalizeLabel("  "), undefined);
});

test("a path keeps its spacing; only a label is flattened", () => {
  // Collapsing whitespace in a cwd names a different directory. Labels are
  // prose and can carry the newlines of whatever was typed.
  assert.equal(
    normalizeValue("/Users/me/My  Project"),
    "/Users/me/My  Project",
  );
  assert.equal(normalizeLabel("fix the\nflaky  test"), "fix the flaky test");
});

test("writes name the pane explicitly rather than assuming the current one", () => {
  assert.deepEqual(setOptionArgs("%7", "state", "waiting"), [
    "set-option",
    "-p",
    "-t",
    "%7",
    "@agent.state",
    "waiting",
  ]);
  assert.deepEqual(unsetOptionArgs("%7", "label"), [
    "set-option",
    "-p",
    "-t",
    "%7",
    "-u",
    "@agent.label",
  ]);
});

test("every field we publish is one shutdown clears", () => {
  // A field written but not listed here outlives pi and mislabels whatever
  // runs in the pane next.
  assert.deepEqual([...PUBLISHED_FIELDS].sort(), [
    "cwd",
    "label",
    "model",
    "pid",
    "provider",
    "session_id",
    "state",
    "v",
  ]);
});

test("shutdown clears every field in one tmux call", () => {
  // One invocation because it runs synchronously while pi is exiting, and
  // eight of them would be eight process spawns on the way out.
  const args = clearAllArgs("%7");
  for (const field of PUBLISHED_FIELDS) {
    assert.ok(args.includes(`@agent.${field}`), field);
  }
  assert.equal(
    args.filter((arg) => arg === ";").length,
    PUBLISHED_FIELDS.length - 1,
  );
  assert.notEqual(args[0], ";");
  assert.notEqual(args.at(-1), ";");
});
