import assert from "node:assert/strict";
import { test } from "node:test";
import {
  completeRuntimeArguments,
  parseRuntimeCommand,
} from "./src/primary/args.ts";
import { decideInput } from "./src/primary/routing.ts";
import {
  describeState,
  handoffSummary,
  initialState,
  planActivation,
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
    fresh: false,
  });
  assert.deepEqual(parseRuntimeCommand("claude --model opus --effort high"), {
    action: "claude",
    model: "opus",
    effort: "high",
    fresh: false,
  });
});

test("--new is valueless and does not eat the next flag", () => {
  // The parse loop used a fixed two-token stride; a valueless flag in the
  // middle would otherwise swallow "--model" as if it were --new's value.
  assert.deepEqual(parseRuntimeCommand("claude --new --model opus"), {
    action: "claude",
    model: "opus",
    effort: undefined,
    fresh: true,
  });
  assert.deepEqual(parseRuntimeCommand("claude --model opus --new"), {
    action: "claude",
    model: "opus",
    effort: undefined,
    fresh: true,
  });
});

test("bad arguments explain themselves instead of being ignored", () => {
  assert.equal(parseRuntimeCommand("claude --effort turbo").action, "error");
  assert.equal(parseRuntimeCommand("claude --model").action, "error");
  // Not a model named "--new": that would silently disarm both options.
  assert.equal(parseRuntimeCommand("claude --model --new").action, "error");
  assert.equal(parseRuntimeCommand("claude --effort --new").action, "error");
  assert.equal(parseRuntimeCommand("claude --wat x").action, "error");
  assert.equal(parseRuntimeCommand("sonnet").action, "error");
  // A silently-ignored option on `/runtime pi` would read as accepted.
  assert.equal(parseRuntimeCommand("pi --model opus").action, "error");
});

// --- Completion ------------------------------------------------------------

const values = (prefix: string) =>
  (completeRuntimeArguments(prefix) ?? []).map((item) => item.value);

test("bare /runtime offers the subcommands as a menu", () => {
  assert.deepEqual(values(""), ["claude", "pi", "status", "interrupt"]);
  assert.deepEqual(values("st"), ["status"]);
});

test("each completion is the whole argument string, not the typed token", () => {
  // pi replaces everything after the command name with the chosen value, so a
  // bare "opus" here would turn "claude --model op" into "opus".
  assert.deepEqual(values("claude --model o"), ["claude --model opus"]);
  assert.deepEqual(values("claude --effort xh"), ["claude --effort xhigh"]);
});

test("flags are offered after claude, and not offered twice", () => {
  assert.deepEqual(values("claude "), [
    "claude --model",
    "claude --effort",
    "claude --new",
  ]);
  // Whole-string replacement again: the already-typed flag has to be carried
  // forward or picking --effort would erase the model just chosen.
  assert.deepEqual(values("claude --model opus "), [
    "claude --model opus --effort",
    "claude --model opus --new",
  ]);
});

test("subcommands that take no options complete to nothing", () => {
  // Suggesting a flag for `/runtime pi` would be offering an error.
  assert.equal(completeRuntimeArguments("pi "), null);
  assert.equal(completeRuntimeArguments("status "), null);
});

test("a prefix matching nothing yields null rather than the full list", () => {
  assert.equal(completeRuntimeArguments("zzz"), null);
  assert.equal(completeRuntimeArguments("claude --model zzz"), null);
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

test("model and effort survive a later bare /runtime claude", () => {
  // Nobody types `/runtime claude` meaning "put me back on the CLI default".
  const state = initialState();
  planActivation(state, { model: "opus", effort: "high" });
  planActivation(state, {});
  assert.equal(state.model, "opus");
  assert.equal(state.effort, "high");
});

test("options at an open session are refused, not stored for later", () => {
  // Storing them would make /runtime status and the bar name a model the live
  // session is not using -- and without --new there is no later session anyway.
  const state = initialState();
  planActivation(state, { model: "opus", effort: "high" });
  state.sessionId = "sub-1";
  assert.equal(planActivation(state, { model: "sonnet" }).ignoredOptions, true);
  assert.equal(state.model, "opus");
  assert.equal(state.effort, "high");
  assert.equal(planActivation(state, {}).ignoredOptions, false);
});

test("--new hands back the session it discarded, so it can be stopped", () => {
  // Forgetting the handle of a running turn leaves Claude working invisibly.
  const state = initialState();
  state.sessionId = "sub-1";
  state.turns = 4;
  const effects = planActivation(state, { model: "sonnet", fresh: true });
  assert.equal(effects.abandonedSessionId, "sub-1");
  // --new is the remedy for ignored options, so it never also warns about them.
  assert.equal(effects.ignoredOptions, false);
  assert.equal(state.sessionId, undefined);
  assert.equal(state.turns, 0);
  assert.equal(state.model, "sonnet");
});

test("--new with no session open has nothing to abandon", () => {
  const state = initialState();
  assert.equal(
    planActivation(state, { fresh: true }).abandonedSessionId,
    undefined,
  );
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
