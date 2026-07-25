import assert from "node:assert/strict";
import { test } from "node:test";
import { stripContradictoryGuidelines } from "./src/fixups.ts";

/** Verbatim from a captured provider payload, including neighbours. */
const REAL_GUIDELINE_BLOCK = [
  "Guidelines:",
  "- Use bash for file operations like ls, rg, find",
  "- Use read to examine files",
  "",
].join("\n");

test("removes pi's bash-search guideline", () => {
  const result = stripContradictoryGuidelines(REAL_GUIDELINE_BLOCK);
  assert.ok(!result.includes("Use bash for file operations"));
});

test("leaves surrounding guidelines intact", () => {
  const result = stripContradictoryGuidelines(REAL_GUIDELINE_BLOCK);
  assert.ok(result.includes("Guidelines:"));
  assert.ok(result.includes("- Use read to examine files"));
});

test("is a no-op when pi did not emit the guideline", () => {
  const prompt = "Guidelines:\n- Use read to examine files\n";
  assert.equal(stripContradictoryGuidelines(prompt), prompt);
});

test("does not strip a similarly-worded line", () => {
  const prompt = "- Use bash for git operations like status, log\n";
  assert.equal(stripContradictoryGuidelines(prompt), prompt);
});
