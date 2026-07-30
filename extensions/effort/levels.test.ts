import assert from "node:assert/strict";
import test from "node:test";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import { describe, initialSelection, resolveArgument } from "./src/levels.ts";

const FULL: ModelThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];
// A real shape: plenty of models stop well short of the full scale.
const SHORT: ModelThinkingLevel[] = ["off", "low", "high"];

test("no argument opens the menu", () => {
  assert.deepEqual(resolveArgument("", FULL), { kind: "menu" });
  assert.deepEqual(resolveArgument("   ", FULL), { kind: "menu" });
});

test("a named level is set, case and spacing forgiven", () => {
  assert.deepEqual(resolveArgument("high", FULL), {
    kind: "set",
    level: "high",
  });
  assert.deepEqual(resolveArgument("  XHigh ", FULL), {
    kind: "set",
    level: "xhigh",
  });
});

test("a level this model does not offer is refused, not silently clamped", () => {
  // setThinkingLevel clamps to model capabilities, so accepting `max` here
  // would report a change that did not happen — the one outcome worse than
  // refusing.
  const result = resolveArgument("max", SHORT);
  assert.equal(result.kind, "error");
  assert.match(result.kind === "error" ? result.message : "", /off, low, high/);
});

test("a model with no thinking levels says so rather than offering a menu", () => {
  const result = resolveArgument("high", []);
  assert.equal(result.kind, "error");
  assert.match(
    result.kind === "error" ? result.message : "",
    /no thinking levels/,
  );
});

test("the menu opens on the level in force", () => {
  assert.equal(initialSelection("medium", FULL), "medium");
  assert.equal(initialSelection("off", FULL), "off");
});

test("a level stranded by a model switch falls back to the highest offered", () => {
  // Set xhigh, then switch to a model that stops at high: the request was for
  // more thinking, so the nearest honest answer is the most this model can do —
  // not `off`, which is what taking the first entry would give.
  assert.equal(initialSelection("xhigh", SHORT), "high");
  assert.equal(initialSelection(undefined, SHORT), "high");
});

test("no levels means nothing to select", () => {
  assert.equal(initialSelection("high", []), undefined);
});

test("the summary line flags a level the model cannot honour", () => {
  assert.match(describe("p/m", "xhigh", SHORT), /not offered by this model/);
  assert.doesNotMatch(describe("p/m", "high", SHORT), /not offered/);
  assert.match(describe("p/m", "high", SHORT), /offers off, low, high/);
  assert.match(describe("p/m", undefined, []), /no thinking levels/);
});
