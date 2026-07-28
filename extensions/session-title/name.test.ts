import assert from "node:assert/strict";
import test from "node:test";
import { deriveSessionName, MAX_NAME_LENGTH } from "./src/name.ts";

test("a short prompt is the name", () => {
  assert.equal(
    deriveSessionName("fix the flaky auth test"),
    "fix the flaky auth test",
  );
});

test("only the first clause, because the rest is detail", () => {
  assert.equal(
    deriveSessionName(
      "Fix the login redirect. It 302s to /home instead of /app.",
    ),
    "Fix the login redirect.",
  );
  assert.equal(
    deriveSessionName("Rename the repo - it points at the wrong bundle"),
    "Rename the repo",
  );
});

test("newlines and markdown collapse rather than reaching the title", () => {
  assert.equal(
    deriveSessionName("- Update the parser\n  so it accepts tabs"),
    "Update the parser so it accepts tabs",
  );
});

test("pasted code does not become the name", () => {
  // A prompt is often prose plus a snippet. The prose is the title.
  assert.equal(
    deriveSessionName("Why does this hang?\n```ts\nawait forever()\n```"),
    "Why does this hang?",
  );
  assert.equal(
    deriveSessionName("Explain `Array.prototype.at`"),
    "Explain Array.prototype.at",
  );
});

test("a long prompt is cut at a word, with an ellipsis to say so", () => {
  const name = deriveSessionName(
    "Investigate why the compaction artifact stops carrying the deploy context after a fork",
  );
  assert.ok(name);
  assert.ok(name.length <= MAX_NAME_LENGTH + 1, name);
  assert.ok(name.endsWith("…"), name);
  assert.doesNotMatch(name, / …$/);
});

test("one very long token is cut mid-word rather than vanishing", () => {
  // Breaking on the last space would leave "check" from a 60-char path.
  const name = deriveSessionName(
    `check /Users/auro/code/${"a".repeat(60)}/index.ts`,
  );
  assert.ok(name);
  assert.ok(name.length <= MAX_NAME_LENGTH + 1, name);
  assert.ok(name.length > MAX_NAME_LENGTH * 0.6, name);
});

test("a prompt that says nothing about the work leaves the session unnamed", () => {
  // Unnamed keeps pi's plain `π - <cwd>`, which beats a title reading "..." or
  // "/context-budget" for the rest of the session.
  assert.equal(deriveSessionName(""), undefined);
  assert.equal(deriveSessionName("   \n  "), undefined);
  assert.equal(deriveSessionName("/context-budget"), undefined);
  assert.equal(deriveSessionName("???"), undefined);
  assert.equal(deriveSessionName("```\njust code\n```"), undefined);
});
