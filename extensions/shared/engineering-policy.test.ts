import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ENGINEERING_POLICY,
  ENGINEERING_POLICY_BULLETS,
  ENGINEERING_POLICY_CHILD_NOTE,
  ENGINEERING_POLICY_HEADER,
  ENGINEERING_POLICY_OVERRIDES,
  appendEngineeringPolicy,
} from "./engineering-policy.ts";

test("appends the policy to a prompt that lacks it", () => {
  const result = appendEngineeringPolicy("You are pi.");
  assert.ok(result.startsWith("You are pi."));
  assert.ok(result.includes(ENGINEERING_POLICY));
});

test("appending is idempotent across repeated turns", () => {
  const once = appendEngineeringPolicy("You are pi.");
  const twice = appendEngineeringPolicy(once);
  assert.equal(twice, once);
});

test("does not re-append when another extension moved the section", () => {
  const reordered = `${ENGINEERING_POLICY}\n\nYou are pi.`;
  assert.equal(appendEngineeringPolicy(reordered), reordered);
});

test("policy leads with its header, then bullets, then the override clause", () => {
  const lines = ENGINEERING_POLICY.split("\n");
  assert.equal(lines[0], ENGINEERING_POLICY_HEADER);
  assert.equal(lines[1], "");
  assert.ok(ENGINEERING_POLICY_BULLETS.length > 0);
  for (const bullet of ENGINEERING_POLICY_BULLETS)
    assert.match(bullet, /^- \S/);
  assert.equal(lines.at(-1), ENGINEERING_POLICY_OVERRIDES);
});

test("the override clause is prose, so rules are not read as absolute", () => {
  assert.doesNotMatch(ENGINEERING_POLICY_OVERRIDES, /^- /);
  assert.match(ENGINEERING_POLICY_OVERRIDES, /[Oo]verride/);
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

test("the override clause names the authorities that actually outrank us", () => {
  // We are appended after both, so "the harness system prompt" pointed at text
  // that recency would have let this section silently outrank.
  assert.match(ENGINEERING_POLICY_OVERRIDES, /[Pp]roject instructions/);
  assert.match(ENGINEERING_POLICY_OVERRIDES, /base prompt/);
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
  const rule = ENGINEERING_POLICY_BULLETS.find((b) => b.includes("scratch"));
  assert.ok(rule);
  assert.match(rule, /PI_CODING_AGENT_DIR:-~\/\.pi\/agent/);
  assert.match(rule, /not scratch/);
  // Never a repo-relative path: that is the failure this rule exists to prevent.
  assert.doesNotMatch(rule, /\.\/|\bdocs\/|\bplans\//);
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
