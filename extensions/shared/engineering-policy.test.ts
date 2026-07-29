import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ENGINEERING_POLICY,
  ENGINEERING_POLICY_BULLETS,
  ENGINEERING_POLICY_CHILD_NOTE,
  ENGINEERING_POLICY_HEADER,
  PI_AGENT_RULES,
  PI_WORKSPACE_BULLETS,
  withAgentRules,
} from "./engineering-policy.ts";

test("adds the rules to a prompt that lacks them", () => {
  const result = withAgentRules("You are pi.");
  assert.ok(result.startsWith("You are pi."));
  assert.ok(result.includes(PI_AGENT_RULES));
});

test("the rules go in front of the project's own instructions", () => {
  // Appended last, these outranked AGENTS.md by recency — backwards, since the
  // project is nearest the task and should win. Placement is the whole fix.
  const prompt =
    "You are pi.\n\n<project_context>\nRepo rules.\n</project_context>";
  const result = withAgentRules(prompt);
  assert.ok(
    result.indexOf(ENGINEERING_POLICY_HEADER) <
      result.indexOf("<project_context>"),
    result,
  );
  assert.ok(result.startsWith("You are pi."));
  assert.ok(
    result.includes("<project_context>\nRepo rules.\n</project_context>"),
  );
});

test("with no project context there is nothing to sit in front of", () => {
  const result = withAgentRules("You are pi.");
  assert.ok(result.trimEnd().endsWith(PI_AGENT_RULES.trimEnd()));
});

test("the portable rules name no pi path, binary or variable", () => {
  // ENGINEERING_POLICY is carried to other coding agents unchanged; anything
  // that only means something inside pi belongs in PI_WORKSPACE.
  assert.doesNotMatch(
    ENGINEERING_POLICY,
    /PI_CODING_AGENT_DIR|PI_SESSION_FILE/,
  );
  assert.doesNotMatch(ENGINEERING_POLICY, /\.pi\/agent/);
  assert.doesNotMatch(ENGINEERING_POLICY, /\bpi\b/i);
});

test("the workspace section carries the pi-specific rule", () => {
  assert.ok(PI_AGENT_RULES.includes(ENGINEERING_POLICY));
  const rule = PI_WORKSPACE_BULLETS.find((b) => b.includes("scratch"));
  assert.ok(rule, "the scratch rule moved out of the portable bullets");
});

test("appending is idempotent across repeated turns", () => {
  const once = withAgentRules("You are pi.");
  const twice = withAgentRules(once);
  assert.equal(twice, once);
});

test("does not re-append when another extension moved the section", () => {
  const reordered = `${ENGINEERING_POLICY}\n\nYou are pi.`;
  assert.equal(withAgentRules(reordered), reordered);
});

test("policy is its header, then nothing but bullets", () => {
  // Nothing trails the bullets any more: the closing clause that told the
  // model to override this section on conflict was removed deliberately, and
  // a stray line reappearing at the end is the way that would come back.
  const lines = ENGINEERING_POLICY.split("\n");
  assert.equal(lines[0], ENGINEERING_POLICY_HEADER);
  assert.equal(lines[1], "");
  assert.ok(ENGINEERING_POLICY_BULLETS.length > 0);
  for (const bullet of ENGINEERING_POLICY_BULLETS)
    assert.match(bullet, /^- \S/);
  assert.equal(lines.at(-1), ENGINEERING_POLICY_BULLETS.at(-1));
});

test("says nothing the tool schema already conveys", () => {
  // rg/fd descriptions reach the model and pi's contradicting advice is stripped
  // in system-prompt/src/fixups.ts; ask_user's own description already caps it at
  // one question per call. Restating any of it here would be dead weight.
  assert.ok(!ENGINEERING_POLICY.includes("`rg` tool"));
  assert.ok(!ENGINEERING_POLICY.includes("`fd` tool"));
  assert.ok(!ENGINEERING_POLICY.includes("ask_user"));
});

test("the child note refuses an empty result", () => {
  assert.match(ENGINEERING_POLICY_CHILD_NOTE, /found nothing/);
  assert.match(ENGINEERING_POLICY_CHILD_NOTE, /name what you inspected/);
});

test("the destructive-git rule holds for a child that cannot ask", () => {
  // Without its own fallback this rule inherits "state the assumption and
  // proceed" from the underspecified-request rule, and a headless subagent
  // reads a ban conditioned on asking as satisfied when asking is impossible.
  const rule = ENGINEERING_POLICY_BULLETS.find((b) =>
    b.includes("discard work"),
  );
  assert.ok(rule);
  assert.match(rule, /asking is impossible/);
  for (const verb of [
    "revert",
    "stash",
    "checkout",
    "reset",
    "clean",
    "force-push",
  ])
    assert.ok(rule.includes(verb), `missing ${verb}`);
});

test("scratch has a destination, and deliverables are carved out of it", () => {
  // Rule 1 grants "writing your own report or output file is always in scope"
  // without saying where, which lands the file in the user's repo. This rule is
  // that grant's destination, so it has to name a root that always resolves and
  // it has to exclude the file the user actually asked for.
  const rule = PI_WORKSPACE_BULLETS.find((b) => b.includes("scratch"));
  assert.ok(rule);
  assert.match(rule, /PI_CODING_AGENT_DIR:-\$HOME\/\.pi\/agent/);
  assert.match(rule, /not scratch/);
  // Never a repo-relative path: that is the failure this rule exists to prevent.
  assert.doesNotMatch(rule, /\.\/|\bdocs\/|\bplans\//);
});

test("the scratch root survives being quoted", () => {
  // No shell tilde-expands inside double quotes, so a `~` fallback hands a
  // correctly-quoting model the literal string `~/.pi/agent` and `mkdir -p`
  // makes a directory named `~` in the working tree. $HOME expands either way.
  const rule = PI_WORKSPACE_BULLETS.find((b) => b.includes("scratch"));
  assert.ok(rule);
  assert.doesNotMatch(rule, /:-~/);
});

test("the concision rule names the waste rather than asking for less", () => {
  // Pi's base prompt already says "Be concise in your responses" and it does
  // not bite; a second copy would be dead weight under this file's own rule.
  // What earns the line is naming the specific waste, so pin those.
  assert.doesNotMatch(ENGINEERING_POLICY, /be concise/i);
  const rule = ENGINEERING_POLICY_BULLETS.find((b) => b.includes("packaging"));
  assert.ok(rule);
  for (const waste of ["preamble", "restating the request", "recap"])
    assert.ok(rule.includes(waste), `missing ${waste}`);
});

test("brevity does not undercut the rules that require disclosure", () => {
  // Read against each other, "say when you are guessing" and "name what you did
  // not verify" are exactly the text a brevity rule tempts a model to drop.
  const rule = ENGINEERING_POLICY_BULLETS.find((b) => b.includes("packaging"));
  assert.ok(rule);
  assert.match(rule, /rules above require you to say still gets said/);
  assert.ok(
    ENGINEERING_POLICY_BULLETS.indexOf(rule) ===
      ENGINEERING_POLICY_BULLETS.length - 1,
    "the carve-out says 'above', so this rule has to be last",
  );
});

test("the child note is not carried by the parent policy", () => {
  assert.ok(!ENGINEERING_POLICY.includes(ENGINEERING_POLICY_CHILD_NOTE));
  assert.ok(ENGINEERING_POLICY_CHILD_NOTE.length > 0);
});
