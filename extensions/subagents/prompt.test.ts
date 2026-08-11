import assert from "node:assert/strict";
import test from "node:test";
import {
  inSentence,
  subagentHarnessParameterDescription,
  subagentSpawnPromptGuidelines,
  subagentSpawnPromptSnippet,
  subagentSpawnToolDescription,
} from "./src/prompt.ts";
import { ALL_HARNESSES, DEFAULT_HARNESSES } from "./src/harnesses.ts";

/**
 * These strings sit beside an enum built from config, so the failure they
 * guard against is describing a different tool than the one the model can
 * call: naming a harness that is not offered, or omitting one that is.
 */

test("inSentence reads as English at every length", () => {
  assert.equal(inSentence([]), "none");
  assert.equal(inSentence(["a"]), "a");
  assert.equal(inSentence(["a", "b"]), "a or b");
  assert.equal(inSentence(["a", "b", "c"]), "a, b, or c");
});

test("the tool description names every offered harness and no other", () => {
  const text = subagentSpawnToolDescription(DEFAULT_HARNESSES);
  for (const name of DEFAULT_HARNESSES) assert.match(text, new RegExp(name));
  assert.doesNotMatch(text, /droid|cursor/);
});

test("enabling a harness puts it in the description and the enum's docs", () => {
  const offered = ["pi", "codex", "droid"] as const;
  for (const text of [
    subagentSpawnToolDescription(offered),
    subagentHarnessParameterDescription(offered),
    subagentSpawnPromptSnippet(offered),
  ]) {
    assert.match(text, /droid/);
    assert.doesNotMatch(text, /claude/i);
  }
});

test("the spawn guideline assumes delegation was already chosen", () => {
  const first = subagentSpawnPromptGuidelines(DEFAULT_HARNESSES)[0] ?? "";
  assert.match(first, /^When using subagent_spawn/);
  assert.doesNotMatch(first, /^Use subagent_spawn/);
});

test("a harness selectable on task fit is offered as such", () => {
  const lines = subagentSpawnPromptGuidelines(["pi", "claude", "codex"]);
  assert.ok(
    lines.some((line) => /prefer claude or codex/.test(line)),
    lines.join("\n"),
  );
  assert.ok(!lines.some((line) => /only when the user names/.test(line)));
});

test("a billed harness is opt-in only, in its own guideline", () => {
  const lines = subagentSpawnPromptGuidelines(["pi", "codex", "droid"]);
  const rule = lines.find((line) => /only when the user names/.test(line));
  assert.ok(rule, `no opt-in rule in:\n${lines.join("\n")}`);
  assert.match(rule!, /^droid /);
  // Task fit must not read as a reason to choose it.
  assert.doesNotMatch(
    lines.find((line) => /Pick the subagent harness/.test(line))!,
    /droid/,
  );
});

test("both billed harnesses share one rule, pluralised", () => {
  const rule = subagentSpawnPromptGuidelines(ALL_HARNESSES).find((line) =>
    /only when the user names/.test(line),
  );
  assert.match(rule!, /^droid or cursor are billed/);
  assert.match(rule!, /Use them only when the user names one/);
});

test("with pi alone there is no harness to choose between", () => {
  const lines = subagentSpawnPromptGuidelines(["pi"]);
  assert.ok(lines.some((line) => /Subagents run on pi, in-process/.test(line)));
  assert.ok(!lines.some((line) => /Pick the subagent harness/.test(line)));
  assert.ok(!lines.some((line) => /only when the user names/.test(line)));
});
