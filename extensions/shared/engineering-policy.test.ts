import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  COMMENT_GUIDELINES,
  COMMENT_GUIDELINES_BULLETS,
  COMMENT_GUIDELINES_HEADER,
  COMMUNICATION_STANDARDS,
  COMMUNICATION_STANDARDS_BULLETS,
  COMMUNICATION_STANDARDS_HEADER,
  ENGINEERING_POLICY,
  ENGINEERING_POLICY_BULLETS,
  ENGINEERING_POLICY_CHILD_NOTE,
  ENGINEERING_POLICY_HEADER,
  KNOWN_PERFORMANCE_PITFALLS,
  KNOWN_PERFORMANCE_PITFALLS_BULLETS,
  KNOWN_PERFORMANCE_PITFALLS_HEADER,
  GLOBAL_INSTRUCTION_RULES,
  ORCHESTRATION,
  ORCHESTRATION_BULLETS,
  ORCHESTRATION_HEADER,
  PI_AGENT_RULES,
  PI_WORKSPACE,
  PI_WORKSPACE_BULLETS,
  SAFETY_RULES,
  SAFETY_RULES_BULLETS,
  SAFETY_RULES_HEADER,
  SECOND_OPINIONS,
  SECOND_OPINIONS_BULLETS,
  SECOND_OPINIONS_HEADER,
  TESTING_GUIDELINES,
  TESTING_GUIDELINES_BULLETS,
  TESTING_GUIDELINES_HEADER,
  TYPESCRIPT_GUIDELINES,
  TYPESCRIPT_GUIDELINES_BULLETS,
  TYPESCRIPT_GUIDELINES_HEADER,
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

test("the global instruction rules name no pi path, binary or variable", () => {
  // GLOBAL_INSTRUCTION_RULES is carried to other coding agents unchanged;
  // anything that only means something inside pi belongs in PI_WORKSPACE.
  assert.doesNotMatch(
    GLOBAL_INSTRUCTION_RULES,
    /PI_CODING_AGENT_DIR|PI_SESSION_FILE/,
  );
  assert.doesNotMatch(GLOBAL_INSTRUCTION_RULES, /\.pi\/agent/);
  assert.doesNotMatch(GLOBAL_INSTRUCTION_RULES, /\bpi\b/i);
});

test("pi adds only its workspace section to the global preamble", () => {
  assert.equal(
    PI_AGENT_RULES,
    `${GLOBAL_INSTRUCTION_RULES}\n\n${PI_WORKSPACE}`,
  );
  const rule = PI_WORKSPACE_BULLETS.find((b) => b.includes("scratch"));
  assert.ok(rule, "the scratch rule moved into the global preamble");
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

test("global instruction sections are their header, then nothing but bullets", () => {
  // Nothing trails the bullets: a stray closing clause could quietly weaken
  // the rules above it.
  for (const [section, header, bullets] of [
    [ENGINEERING_POLICY, ENGINEERING_POLICY_HEADER, ENGINEERING_POLICY_BULLETS],
    [ORCHESTRATION, ORCHESTRATION_HEADER, ORCHESTRATION_BULLETS],
    [SECOND_OPINIONS, SECOND_OPINIONS_HEADER, SECOND_OPINIONS_BULLETS],
    [SAFETY_RULES, SAFETY_RULES_HEADER, SAFETY_RULES_BULLETS],
    [TESTING_GUIDELINES, TESTING_GUIDELINES_HEADER, TESTING_GUIDELINES_BULLETS],
    [
      COMMUNICATION_STANDARDS,
      COMMUNICATION_STANDARDS_HEADER,
      COMMUNICATION_STANDARDS_BULLETS,
    ],
    [
      TYPESCRIPT_GUIDELINES,
      TYPESCRIPT_GUIDELINES_HEADER,
      TYPESCRIPT_GUIDELINES_BULLETS,
    ],
    [COMMENT_GUIDELINES, COMMENT_GUIDELINES_HEADER, COMMENT_GUIDELINES_BULLETS],
    [
      KNOWN_PERFORMANCE_PITFALLS,
      KNOWN_PERFORMANCE_PITFALLS_HEADER,
      KNOWN_PERFORMANCE_PITFALLS_BULLETS,
    ],
  ] as const) {
    const lines = section.split("\n");
    assert.equal(lines[0], header);
    assert.equal(lines[1], "");
    assert.ok(bullets.length > 0);
    for (const bullet of bullets) assert.match(bullet, /^- \S/);
    assert.equal(lines.at(-1), bullets.at(-1));
  }
});

test("says nothing the tool schema already conveys", () => {
  // rg/fd descriptions reach the model and pi's contradicting advice is stripped
  // in system-prompt/src/fixups.ts; ask_user's own description already caps it at
  // one question per call. Restating any of it here would be dead weight.
  assert.ok(!ENGINEERING_POLICY.includes("`rg` tool"));
  assert.ok(!ENGINEERING_POLICY.includes("`fd` tool"));
  assert.ok(!ENGINEERING_POLICY.includes("ask_user"));
});

test("the global preamble carries all nine sections in order", () => {
  assert.equal(
    GLOBAL_INSTRUCTION_RULES,
    [
      ENGINEERING_POLICY,
      ORCHESTRATION,
      SECOND_OPINIONS,
      SAFETY_RULES,
      TESTING_GUIDELINES,
      COMMUNICATION_STANDARDS,
      TYPESCRIPT_GUIDELINES,
      COMMENT_GUIDELINES,
      KNOWN_PERFORMANCE_PITFALLS,
    ].join("\n\n"),
  );
  assert.ok(!GLOBAL_INSTRUCTION_RULES.includes(PI_WORKSPACE));
});

test("orchestration advice is global and keeps solo work as the default", () => {
  assert.match(ORCHESTRATION_BULLETS[0] ?? "", /Work solo by default/);
  assert.match(ORCHESTRATION, /workflow tool is available/);
  assert.match(ORCHESTRATION, /non-overlapping ownership/);
  assert.match(ORCHESTRATION, /explicit approval for that provider/);
  assert.ok(GLOBAL_INSTRUCTION_RULES.includes(ORCHESTRATION));
  assert.doesNotMatch(GLOBAL_INSTRUCTION_RULES, /diffwarden/i);
});

test("verification effort follows the decisions it can affect", () => {
  assert.match(ENGINEERING_POLICY, /decision or change/);
  assert.match(ENGINEERING_POLICY, /Do not verify every result by default/);
  assert.match(ENGINEERING_POLICY, /label it as unverified/);
});

test("second-opinion advice lives in one reviewable section", () => {
  assert.doesNotMatch(ENGINEERING_POLICY, /second opinion/i);
  assert.equal(
    new Set(SECOND_OPINIONS_BULLETS).size,
    SECOND_OPINIONS_BULLETS.length,
  );
  assert.ok(
    SECOND_OPINIONS_BULLETS.includes(
      "- Report the assumption most likely to be wrong.",
    ),
  );
});

test("the child note refuses an empty result", () => {
  assert.match(ENGINEERING_POLICY_CHILD_NOTE, /found nothing/);
  assert.match(ENGINEERING_POLICY_CHILD_NOTE, /name what you inspected/);
});

test("the destructive-git rules hold for a child that cannot ask", () => {
  // Without its own fallback this rule inherits "state the assumption and
  // proceed" from the underspecified-request rule, and a headless subagent
  // reads a ban conditioned on asking as satisfied when asking is impossible.
  const rules = SAFETY_RULES_BULLETS.join("\n");
  assert.match(rules, /cannot ask for permission/);
  for (const verb of [
    "revert",
    "stash",
    "reset",
    "clean",
    "force-push",
    "check out",
  ])
    assert.ok(rules.includes(verb), `missing ${verb}`);
});

test("scratch has a destination, and deliverables are carved out of it", () => {
  const rules = PI_WORKSPACE_BULLETS.join("\n");
  assert.match(rules, /PI_CODING_AGENT_DIR:-\$HOME\/\.pi\/agent/);
  assert.match(rules, /deliverable, not scratch/);
  // Never a repo-relative path: that is the failure these rules exist to prevent.
  assert.doesNotMatch(rules, /\.\/|\bdocs\/|\bplans\//);
});

test("the scratch root survives being quoted", () => {
  // No shell tilde-expands inside double quotes, so a `~` fallback hands a
  // correctly-quoting model the literal string `~/.pi/agent` and `mkdir -p`
  // makes a directory named `~` in the working tree. $HOME expands either way.
  const rules = PI_WORKSPACE_BULLETS.join("\n");
  assert.doesNotMatch(rules, /:-~/);
});

test("the communication rules name specific waste instead of asking for less", () => {
  // Pi's base prompt already says "Be concise in your responses" and it does
  // not bite; a second copy would be dead weight under this file's own rule.
  assert.doesNotMatch(COMMUNICATION_STANDARDS, /be concise/i);
  assert.match(COMMUNICATION_STANDARDS, /preamble/);
  assert.match(COMMUNICATION_STANDARDS, /restate the user's request/);
});

test("the request-restatement rule closes the communication section", () => {
  assert.match(COMMUNICATION_STANDARDS_BULLETS.at(-1) ?? "", /restate/);
});

test("the TypeScript guidelines preserve the supplied wording", () => {
  assert.deepEqual(TYPESCRIPT_GUIDELINES_BULLETS, [
    "- `any` is the enemy. Inferred types are our friend. Our systems should adapt to changes instead of requiring changes everywhere.",
    "- If your TypeScript code looks like a Python developer wrote it, it is bad TypeScript.",
    "- Avoid one-line functions that are just casting wrappers.",
  ]);
});

test("the committed fragment matches the policy byte for byte", () => {
  // engineering-policy.md is what fleet-config-sync carries to other agents'
  // GLOBAL instruction files (~/.claude/CLAUDE.md, ~/.codex/AGENTS.md) as a
  // managed block. Canonical byte form: GLOBAL_INSTRUCTION_RULES plus one
  // trailing newline — the downstream comparisons (intent diff, block conflict
  // detection) all assume exactly this form, so a drifting fragment reads as
  // fleet-wide false drift. Regenerate with `pnpm render:policy`.
  //
  // Renaming the header is a fleet event, not a routine edit: beyond the
  // running-session hazard noted on withAgentRules, the header is the dedupe
  // key that keeps a placed copy in a pi-read context file from stacking —
  // the fragment must never land in ~/AGENTS.md, ~/CLAUDE.md, or a project
  // file, where it would suppress pi's own Workspace section.
  const fragment = readFileSync(
    new URL("./engineering-policy.md", import.meta.url),
    "utf8",
  );
  assert.equal(fragment, `${GLOBAL_INSTRUCTION_RULES}\n`);
});

test("the child note is not carried by the global preamble", () => {
  assert.ok(!GLOBAL_INSTRUCTION_RULES.includes(ENGINEERING_POLICY_CHILD_NOTE));
  assert.ok(ENGINEERING_POLICY_CHILD_NOTE.length > 0);
});
