import assert from "node:assert/strict";
import { test } from "node:test";
import { toolPolicy } from "./src/tool-policy.ts";

const read = toolPolicy(false);
const write = toolPolicy(true);

test("read-only denies the shell on every backend that names tools", () => {
  assert.ok(read.piExcludeTools.includes("bash"));
  assert.ok(read.claudeDisallowedTools.includes("Bash"));
});

test("read-only denies background terminals, not just bash", () => {
  // bg_start runs an arbitrary command, so denying bash while leaving it is a
  // read-only policy with a shell in it.
  assert.ok(read.piExcludeTools.includes("bg_start"));
});

test("read-only puts codex in the sandbox that actually enforces it", () => {
  assert.equal(read.codexSandbox, "read-only");
  assert.equal(write.codexSandbox, "danger-full-access");
});

test("write-capable can edit and run commands", () => {
  for (const tool of ["write", "edit", "bash"])
    assert.ok(!write.piExcludeTools.includes(tool), `${tool} was excluded`);
  for (const tool of ["Write", "Edit", "Bash"])
    assert.ok(
      !write.claudeDisallowedTools.includes(tool),
      `${tool} was disallowed`,
    );
});

test("read-only is strictly more restrictive than write-capable", () => {
  // The predecessor policy returned byte-identical deny lists for both modes,
  // differing only in a `mode` string, so the flag never reached enforcement.
  // These assertions fail if the two modes ever converge again.
  for (const tool of write.piExcludeTools)
    assert.ok(read.piExcludeTools.includes(tool), `read-only dropped ${tool}`);
  for (const tool of write.claudeDisallowedTools)
    assert.ok(
      read.claudeDisallowedTools.includes(tool),
      `read-only dropped ${tool}`,
    );
  assert.ok(read.piExcludeTools.length > write.piExcludeTools.length);
  assert.ok(
    read.claudeDisallowedTools.length > write.claudeDisallowedTools.length,
  );
});

test("read-only keeps the tools that make investigation possible", () => {
  // The predecessor denied read/grep/edit and preapproved bash -- exactly
  // inverted. A read-only child that cannot read is useless as well as unsafe.
  for (const tool of ["read", "ls", "grep", "find", "rg", "fd"])
    assert.ok(!read.piExcludeTools.includes(tool), `${tool} was excluded`);
  for (const tool of ["Read", "Glob", "Grep"])
    assert.ok(
      !read.claudeDisallowedTools.includes(tool),
      `${tool} was disallowed`,
    );
});

test("no child orchestrates or asks the user, in either mode", () => {
  for (const policy of [read, write]) {
    for (const tool of ["subagent_spawn", "workflow", "ask_user"])
      assert.ok(policy.piExcludeTools.includes(tool), `${tool} was allowed`);
    for (const tool of ["Agent", "Task"])
      assert.ok(
        policy.claudeDisallowedTools.includes(tool),
        `${tool} was allowed`,
      );
  }
});
