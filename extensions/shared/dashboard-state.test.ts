import assert from "node:assert/strict";
import { test } from "node:test";
import {
  emptyModelInfoState,
  emptyPrimaryRuntimeState,
  isPrimaryRuntimeState,
  withPrimaryRuntime,
} from "./dashboard-state.ts";

function piState() {
  return {
    ...emptyModelInfoState(),
    provider: "openai-codex",
    modelId: "gpt-5.6-sol",
    modelName: "GPT-5.6 Sol",
    thinking: "medium",
    contextTokens: 40_000,
    contextWindow: 400_000,
    contextPercent: 10,
    cost: 1.25,
    tokensPerSecond: 55,
  };
}

test("an inactive runtime leaves the bar exactly as pi reported it", () => {
  const state = piState();
  assert.deepEqual(
    withPrimaryRuntime(state, emptyPrimaryRuntimeState()),
    state,
  );
});

test("an active runtime names Claude instead of pi's idle model", () => {
  // The whole point: pi's model does not change when the turn is redirected,
  // so the bar would otherwise name the model that is doing nothing.
  const shown = withPrimaryRuntime(piState(), {
    active: true,
    modelLabel: "claude-opus-5",
    effort: "high",
    contextTokens: 50_000,
    contextWindow: 200_000,
  });
  assert.equal(shown.provider, "claude");
  assert.equal(shown.modelId, "claude-opus-5");
  assert.equal(shown.thinking, "high");
});

test("the context gauge follows Claude's session, not pi's stale one", () => {
  const shown = withPrimaryRuntime(piState(), {
    active: true,
    modelLabel: "claude-opus-5",
    effort: "high",
    contextTokens: 50_000,
    contextWindow: 200_000,
  });
  assert.equal(shown.contextTokens, 50_000);
  assert.equal(shown.contextWindow, 200_000);
  assert.equal(shown.contextPercent, 25);
  // pi is receiving no stream, so its last measured rate describes nothing.
  assert.equal(shown.tokensPerSecond, null);
});

test("unknown usage blanks the gauge rather than dividing by zero", () => {
  const shown = withPrimaryRuntime(piState(), {
    ...emptyPrimaryRuntimeState(),
    active: true,
  });
  assert.equal(shown.contextPercent, null);
  assert.equal(shown.contextWindow, 0);
  // Before the first turn lands there is no CLI label; the bar still says who.
  assert.equal(shown.modelId, "default");
  assert.equal(shown.thinking, "default");
});

test("session cost survives, because it is pi's own and still real", () => {
  const shown = withPrimaryRuntime(piState(), {
    ...emptyPrimaryRuntimeState(),
    active: true,
  });
  assert.equal(shown.cost, 1.25);
});

test("a malformed payload is rejected rather than rendered", () => {
  assert.equal(isPrimaryRuntimeState(emptyPrimaryRuntimeState()), true);
  assert.equal(isPrimaryRuntimeState({ active: true }), false);
  assert.equal(isPrimaryRuntimeState(null), false);
});
