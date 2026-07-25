import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRuntimeCommand } from "./src/primary/args.ts";
import { decideInput } from "./src/primary/routing.ts";
import {
  describeState,
  handoffSummary,
  initialState,
  planSend,
} from "./src/primary/state.ts";

test("input passes through to pi when the runtime is off", () => {
  assert.deepEqual(decideInput({ active: false, text: "hello" }), {
    kind: "pass",
  });
  // Even slash text: pi owns it entirely when we are not active.
  assert.deepEqual(decideInput({ active: false, text: "/nope" }), {
    kind: "pass",
  });
});

test("ordinary input routes to Claude verbatim", () => {
  assert.deepEqual(decideInput({ active: true, text: "fix the parser" }), {
    kind: "route",
    text: "fix the parser",
  });
});

test("a double slash sends one literal slash to Claude", () => {
  assert.deepEqual(decideInput({ active: true, text: "//usr/bin/env" }), {
    kind: "route",
    text: "/usr/bin/env",
  });
});

test("unrecognized slash text is rejected, not silently prompted", () => {
  // pi dispatches real commands before the input hook, so anything slash-shaped
  // arriving here is a typo, a skill, or a template -- none of which should
  // become a Claude prompt by accident.
  const decision = decideInput({ active: true, text: "/susbagents" });
  assert.equal(decision.kind, "reject");
  assert.match(decision.reason, /susbagents/);
  assert.match(decision.reason, /\/\/susbagents/);
});

test("the rejection explains both ways out", () => {
  const decision = decideInput({ active: true, text: "/skill:review" });
  assert.equal(decision.kind, "reject");
  assert.match(decision.reason, /literally/);
  assert.match(decision.reason, /runtime pi/);
});

test("bare /runtime reports instead of toggling", () => {
  // Flipping the session's model from hidden state is a bad accident to allow.
  assert.deepEqual(parseRuntimeCommand(""), { action: "status" });
  assert.deepEqual(parseRuntimeCommand("  "), { action: "status" });
  assert.deepEqual(parseRuntimeCommand("status"), { action: "status" });
});

test("claude takes an optional model and effort", () => {
  assert.deepEqual(parseRuntimeCommand("claude"), {
    action: "claude",
    model: undefined,
    effort: undefined,
  });
  assert.deepEqual(parseRuntimeCommand("claude --model opus --effort high"), {
    action: "claude",
    model: "opus",
    effort: "high",
  });
});

test("bad arguments explain themselves instead of being ignored", () => {
  assert.equal(parseRuntimeCommand("claude --effort turbo").action, "error");
  assert.equal(parseRuntimeCommand("claude --model").action, "error");
  assert.equal(parseRuntimeCommand("claude --wat x").action, "error");
  assert.equal(parseRuntimeCommand("sonnet").action, "error");
  // A silently-ignored option on `/runtime pi` would read as accepted.
  assert.equal(parseRuntimeCommand("pi --model opus").action, "error");
});

// --- State machine ---------------------------------------------------------

test("the session is created lazily, on the first prompt", () => {
  // The claude backend spawns a session and submits an opening prompt in one
  // call, so there is nothing to create until the user says something.
  const state = initialState();
  state.active = true;
  assert.deepEqual(planSend(state), { kind: "spawn" });
  state.sessionId = "sub-1";
  assert.deepEqual(planSend(state), { kind: "send", sessionId: "sub-1" });
});

test("a prompt arriving mid-spawn is held, not raced", () => {
  // manager.send needs an id that does not exist yet during this window.
  const state = initialState();
  state.active = true;
  state.pendingSpawn = true;
  assert.deepEqual(planSend(state), { kind: "busy" });
});

test("status distinguishes activated from actually running", () => {
  const state = initialState();
  assert.match(describeState(state), /pi \(native\)/);
  state.active = true;
  assert.match(describeState(state), /no session yet/);
  state.sessionId = "sub-1";
  state.turns = 1;
  assert.match(describeState(state), /sub-1/);
  assert.match(describeState(state), /1 turn\b/);
});

test("the handoff tells pi that work happened outside its context", () => {
  // pi's model was idle throughout; without this it answers as though the
  // conversation never happened.
  const summary = handoffSummary({
    turns: 3,
    finalText: "Renamed the module.",
  });
  assert.match(summary, /3 turns/);
  assert.match(summary, /not in your context/);
  assert.match(summary, /Renamed the module\./);
});

test("a handoff with no turns says so instead of implying lost work", () => {
  const summary = handoffSummary({ turns: 0 });
  assert.match(summary, /ran no turns/);
  assert.doesNotMatch(summary, /not in your context/);
});

test("interrupt is a command because the interrupt key cannot reach us", () => {
  // Returning "handled" from the input hook means pi never starts a turn, so
  // its interrupt key has nothing to cancel, and the extension API exposes no
  // interrupt event. Verified live: Escape leaves the Claude turn running.
  assert.deepEqual(parseRuntimeCommand("interrupt"), { action: "interrupt" });
  assert.equal(parseRuntimeCommand("interrupt --all").action, "error");
});
