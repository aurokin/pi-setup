import assert from "node:assert/strict";
import { test } from "node:test";
import {
  artifactMarker,
  extractMarkerId,
  markSummary,
  stripMarker,
  swapArtifacts,
} from "./src/artifact-swap.ts";

const artifact = {
  type: "compaction" as const,
  id: "cmp_1",
  encrypted_content: "blob",
};
const always = () => artifact;
const never = () => undefined;

test("the readable summary survives marking", () => {
  // The text summary is the fallback for every case the artifact cannot serve.
  // A marker that ate it would make those cases silently worse.
  const marked = markSummary("cmp_1", "We agreed to ship on Friday.");
  assert.match(marked, /We agreed to ship on Friday\./);
  assert.equal(extractMarkerId(marked), "cmp_1");
  assert.equal(stripMarker(marked), "We agreed to ship on Friday.");
});

test("prose cannot be mistaken for a marker", () => {
  assert.equal(
    extractMarkerId("we discussed codex-compaction: at length"),
    undefined,
  );
  assert.equal(extractMarkerId(""), undefined);
  assert.equal(extractMarkerId(artifactMarker("")), undefined);
});

test("the marked item is replaced wherever the provider put the text", () => {
  // Pi owns how a compactionSummary becomes an input item, and that mapping is
  // private. Searching nested strings is what keeps this working when it moves.
  const shapes = [
    { role: "user", content: markSummary("cmp_1", "s") },
    {
      role: "developer",
      content: [{ type: "input_text", text: markSummary("cmp_1", "s") }],
    },
    {
      type: "message",
      role: "user",
      content: [{ text: markSummary("cmp_1", "s") }],
    },
  ];
  for (const shape of shapes) {
    const { input, swapped } = swapArtifacts([shape], always);
    assert.equal(swapped, 1);
    assert.deepEqual(input[0], artifact);
  }
});

test("unmarked items are passed through untouched", () => {
  const input = [
    { role: "user", content: "hello" },
    { role: "assistant", content: "hi" },
  ];
  const result = swapArtifacts(input, always);
  assert.equal(result.swapped, 0);
  assert.deepEqual(result.input, input);
});

test("a marker with no available artifact keeps the text summary", () => {
  // This is the model-switch and fresh-machine case. Leaving the text in place
  // is the whole reason it is still written.
  const marked = {
    role: "user",
    content: markSummary("cmp_1", "portable summary"),
  };
  const { input, swapped, seen } = swapArtifacts([marked], never);
  assert.equal(swapped, 0);
  assert.deepEqual(seen, ["cmp_1"]);
  assert.deepEqual(input[0], marked);
});

test("a lookup returning something that is not an artifact is refused", () => {
  const marked = { role: "user", content: markSummary("cmp_1", "s") };
  const { swapped, input } = swapArtifacts(
    [marked],
    () => ({ type: "compaction" }) as never,
  );
  assert.equal(swapped, 0);
  assert.deepEqual(input[0], marked);
});

test("several compactions in one session each swap independently", () => {
  const first = { role: "user", content: markSummary("cmp_1", "a") };
  const second = { role: "user", content: markSummary("cmp_2", "b") };
  const store = new Map([["cmp_2", { ...artifact, id: "cmp_2" }]]);
  const { input, swapped } = swapArtifacts([first, second], (id) =>
    store.get(id),
  );
  assert.equal(swapped, 1);
  assert.deepEqual(input[0], first);
  assert.deepEqual(input[1], { ...artifact, id: "cmp_2" });
});

test("deeply nested text does not send the walker into a loop", () => {
  const deep = { a: { b: { c: { d: { e: markSummary("cmp_1", "s") } } } } };
  assert.doesNotThrow(() => swapArtifacts([deep], always));
});
