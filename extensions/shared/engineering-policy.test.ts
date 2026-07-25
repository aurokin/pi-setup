import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ENGINEERING_POLICY,
  ENGINEERING_POLICY_BULLETS,
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

test("search guidance names the registered fd and rg tools", () => {
  assert.ok(ENGINEERING_POLICY.includes("`rg` tool"));
  assert.ok(ENGINEERING_POLICY.includes("`fd` tool"));
});
