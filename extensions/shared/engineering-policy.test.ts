import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ENGINEERING_POLICY,
  ENGINEERING_POLICY_HEADER,
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

test("policy leads with its header and is all bullets", () => {
  const [header, blank, ...bullets] = ENGINEERING_POLICY.split("\n");
  assert.equal(header, ENGINEERING_POLICY_HEADER);
  assert.equal(blank, "");
  assert.ok(bullets.length > 0);
  for (const bullet of bullets) assert.match(bullet, /^- \S/);
});

test("search guidance names the registered fd and rg tools", () => {
  assert.ok(ENGINEERING_POLICY.includes("`rg` tool"));
  assert.ok(ENGINEERING_POLICY.includes("`fd` tool"));
});
