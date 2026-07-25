import assert from "node:assert/strict";
import test from "node:test";
import {
  BTW_TITLE_MAX_LENGTH,
  deriveBtwTitle,
  forkableMessages,
  isModelVisible,
} from "./src/by-the-way.ts";

test("deriveBtwTitle uses the first non-empty line and bounds the title", () => {
  assert.equal(
    deriveBtwTitle("\n   Why   does this work?   \nignore me"),
    "Why does this work?",
  );
  assert.equal(deriveBtwTitle(" \n\t"), "by the way");

  const title = deriveBtwTitle("x".repeat(BTW_TITLE_MAX_LENGTH + 10));
  assert.equal(title.length, BTW_TITLE_MAX_LENGTH);
  assert.equal(title, `${"x".repeat(BTW_TITLE_MAX_LENGTH - 1)}…`);

  const emojiTitle = deriveBtwTitle(
    `${"x".repeat(BTW_TITLE_MAX_LENGTH - 2)}😀 more`,
  );
  assert.equal(emojiTitle, `${"x".repeat(BTW_TITLE_MAX_LENGTH - 2)}😀…`);
});

test("only model-origin snapshots are visible to model-facing tools", () => {
  assert.equal(isModelVisible({ origin: "model" }), true);
  assert.equal(isModelVisible({ origin: "btw" }), false);
});

// --- forkableMessages ---------------------------------------------------------

test("ordinary messages cross into the fork unchanged", () => {
  const messages = [
    { role: "user" as const, content: "hello", timestamp: 1 },
    { role: "user" as const, content: "again", timestamp: 2 },
  ];
  assert.deepEqual(forkableMessages(messages), messages);
});

test("a compaction summary crosses over as text rather than vanishing", () => {
  // On a long thread the summary IS the history before it. Dropping it would
  // hand the child a confident-looking fork of only the most recent messages.
  const [carried] = forkableMessages([
    {
      role: "compactionSummary" as const,
      summary: "we agreed to ship on friday",
      tokensBefore: 9000,
      timestamp: 7,
    },
  ]);
  assert.equal(carried?.role, "user");
  assert.match(String(carried?.content), /we agreed to ship on friday/);
  assert.match(String(carried?.content), /earlier conversation/i);
  assert.equal(carried?.timestamp, 7);
});

test("a branch summary is carried the same way", () => {
  const [carried] = forkableMessages([
    {
      role: "branchSummary" as const,
      summary: "branched off the auth work",
      fromId: "e1",
      timestamp: 3,
    },
  ]);
  assert.equal(carried?.role, "user");
  assert.match(String(carried?.content), /branched off the auth work/);
});
