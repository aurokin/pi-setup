import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ENGINEERING_POLICY,
  ENGINEERING_POLICY_CHILD_NOTE,
} from "./engineering-policy.ts";
import {
  INTERNAL_ROLE_NAMES,
  ROLE_NAMES,
  ROLE_PROFILES,
  buildRolePrompt,
  getRoleProfile,
  roleProfile,
} from "./roles.ts";

const reader = getRoleProfile("reader");
const worker = getRoleProfile("worker");
const duck = getRoleProfile("rubber-duck");

test("every advertised role name resolves to a profile", () => {
  for (const name of ROLE_NAMES) assert.ok(getRoleProfile(name), name);
  assert.equal(
    ROLE_PROFILES.size,
    ROLE_NAMES.length + INTERNAL_ROLE_NAMES.length,
  );
});

test("internal roles are not offered to the model or reachable by name", () => {
  // The unrestricted role is safe only where this extension puts it. Offered
  // on the spawn enum it would be a generic subagent with no tool policy.
  for (const name of INTERNAL_ROLE_NAMES) {
    assert.ok(
      !(ROLE_NAMES as readonly string[]).includes(name),
      `${name} is advertised to the model`,
    );
    assert.equal(getRoleProfile(name), undefined, name);
    assert.ok(roleProfile(name), `${name} is unreachable internally too`);
  }
});

test("lookup is case-insensitive and rejects unknown names", () => {
  assert.ok(getRoleProfile("Reader"));
  assert.equal(getRoleProfile("planner"), undefined);
});

test("only worker and side can mutate anything", () => {
  const writers = [...ROLE_PROFILES.values()].filter((r) => r.writeCapable);
  assert.deepEqual(writers.map((r) => r.name).sort(), ["side", "worker"]);
});

test("side is the only role whose limits exist solely in the prompt", () => {
  // worker is write-capable by design and still loses orchestration tools;
  // side loses nothing, so its prompt is the entire restriction.
  const inheriting = [...ROLE_PROFILES.values()].filter(
    (r) => r.inheritsParentTools,
  );
  assert.deepEqual(
    inheriting.map((r) => r.name),
    ["side"],
  );
});

test("every read-only role says so in its own words", () => {
  // Enforcement is the tool policy's job, but a child told nothing about its
  // limits burns turns discovering them by calling tools that are not there.
  for (const role of ROLE_PROFILES.values()) {
    if (role.writeCapable) continue;
    assert.match(role.systemPrompt, /read tools only/, role.name);
  }
});

test("roles say nothing about which harness runs them", () => {
  // Function and backend are independent axes. Pinning advisor to Claude to
  // get an out-of-family opinion is wrong the moment the parent is Claude,
  // so the pairing is the caller's call and lives in the tool guidelines.
  for (const role of ROLE_PROFILES.values())
    for (const key of Object.keys(role))
      assert.ok(
        !/backend|harness|model/i.test(key),
        `${role.name} carries ${key}`,
      );
});

test("only the roles meant to run bare carry a default task", () => {
  assert.equal(reader?.defaultTask, undefined);
  assert.equal(worker?.defaultTask, undefined);
  assert.ok(duck?.defaultTask);
});

test("the built prompt leads with the role and ends with the task", () => {
  assert.ok(reader);
  const prompt = buildRolePrompt({
    role: reader,
    task: "Find the retry logic.",
    policy: "include",
  });
  assert.ok(prompt.startsWith(reader.systemPrompt));
  assert.ok(prompt.trimEnd().endsWith("Find the retry logic."));
});

test("a child always learns its final message is the deliverable", () => {
  for (const role of ROLE_PROFILES.values())
    for (const policy of ["include", "inherited"] as const)
      assert.ok(
        buildRolePrompt({ role, task: "x", policy }).includes(
          ENGINEERING_POLICY_CHILD_NOTE,
        ),
        `${role.name}/${policy}`,
      );
});

test("the policy is sent once, not twice", () => {
  assert.ok(reader);
  const included = buildRolePrompt({
    role: reader,
    task: "x",
    policy: "include",
  });
  const inherited = buildRolePrompt({
    role: reader,
    task: "x",
    policy: "inherited",
  });
  assert.ok(included.includes(ENGINEERING_POLICY));
  // A pi child already has it in its system prompt via the system-prompt
  // extension; repeating it here would pay for the same text twice.
  assert.ok(!inherited.includes(ENGINEERING_POLICY));
});

test("an empty task falls back to the role's default", () => {
  assert.ok(duck);
  const prompt = buildRolePrompt({
    role: duck,
    task: "   ",
    policy: "include",
  });
  assert.ok(duck.defaultTask);
  assert.ok(prompt.includes(duck.defaultTask));
});
