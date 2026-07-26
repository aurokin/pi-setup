import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildCompactionRequest,
  collectCompaction,
  compactionHeaders,
  isCompactionArtifact,
  REMOTE_COMPACTION_FEATURE,
  responsesUrl,
  sseEvents,
} from "./src/protocol.ts";

const artifact = { type: "compaction", id: "cmp_1", encrypted_content: "blob" };

async function* events(...items: Record<string, unknown>[]) {
  for (const item of items) yield item;
}
const done = (item: unknown) => ({ type: "response.output_item.done", item });
const completed = (usage?: unknown) => ({
  type: "response.completed",
  response: { usage },
});

test("the trigger is appended, never substituted", () => {
  // The history has to survive: the server compacts what it is sent, so a
  // request that replaced the input would compact an empty conversation.
  const body = buildCompactionRequest({
    model: "gpt-5.6-sol",
    input: [{ role: "user" }, { role: "assistant" }],
    tools: [1, 2],
  });
  assert.equal((body.input as unknown[]).length, 3);
  assert.deepEqual((body.input as unknown[]).at(-1), {
    type: "compaction_trigger",
  });
  assert.deepEqual(body.tools, [1, 2]);
});

test("streaming is forced on, because the artifact only arrives as an event", () => {
  const body = buildCompactionRequest({ model: "m", input: [], stream: false });
  assert.equal(body.stream, true);
});

test("a payload with no input still produces a valid trigger-only request", () => {
  const body = buildCompactionRequest({ model: "m" });
  assert.deepEqual(body.input, [{ type: "compaction_trigger" }]);
});

test("the beta feature flag is sent, since nothing works without it", () => {
  const headers = compactionHeaders({ access: "tok", accountId: "acct" });
  assert.equal(headers["x-codex-beta-features"], REMOTE_COMPACTION_FEATURE);
  assert.equal(headers["chatgpt-account-id"], "acct");
  assert.equal(headers.accept, "text/event-stream");
});

test("the url is built once, whether or not the base already ends in /codex", () => {
  assert.equal(
    responsesUrl("https://chatgpt.com/backend-api"),
    "https://chatgpt.com/backend-api/codex/responses",
  );
  assert.equal(
    responsesUrl("https://chatgpt.com/backend-api/codex/"),
    "https://chatgpt.com/backend-api/codex/responses",
  );
});

test("an artifact needs actual content to count", () => {
  assert.ok(isCompactionArtifact(artifact));
  assert.ok(
    !isCompactionArtifact({ type: "compaction", encrypted_content: "" }),
  );
  assert.ok(!isCompactionArtifact({ type: "message", encrypted_content: "x" }));
  assert.ok(!isCompactionArtifact(null));
});

test("the artifact is collected from a well-formed stream", async () => {
  const result = await collectCompaction(
    events(
      done({ type: "reasoning" }),
      done(artifact),
      completed({ output_tokens: 9 }),
    ),
  );
  assert.equal(result.artifact.encrypted_content, "blob");
  assert.equal(result.usage?.output_tokens, 9);
});

test("a stream cut short of response.completed is an error, not a partial result", async () => {
  // A truncated stream can still carry a syntactically valid artifact. Trusting
  // it would persist an artifact the server never finished producing.
  await assert.rejects(
    () => collectCompaction(events(done(artifact))),
    /before response.completed/,
  );
});

test("more than one artifact is refused rather than guessed at", async () => {
  await assert.rejects(
    () =>
      collectCompaction(
        events(done(artifact), done({ ...artifact, id: "cmp_2" }), completed()),
      ),
    /exactly one compaction item, got 2/,
  );
});

test("zero artifacts is refused", async () => {
  await assert.rejects(
    () => collectCompaction(events(done({ type: "message" }), completed())),
    /got 0/,
  );
});

test("an error frame aborts instead of waiting for a completion that never comes", async () => {
  await assert.rejects(
    () => collectCompaction(events({ type: "response.failed", error: "nope" })),
    /compaction stream failed/,
  );
});

// --- SSE parsing --------------------------------------------------------------

function bodyOf(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({
    start(controller) {
      // One byte at a time: frames split across chunk boundaries are the normal
      // case on a real socket, not an edge case.
      for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
      controller.close();
    },
  });
}

test("frames split across chunk boundaries are reassembled", async () => {
  const seen: unknown[] = [];
  for await (const event of sseEvents(
    bodyOf('data: {"type":"a"}\n\ndata: {"type":"b"}\n\n'),
  )) {
    seen.push(event.type);
  }
  assert.deepEqual(seen, ["a", "b"]);
});

test("a malformed frame is skipped rather than failing the compaction", async () => {
  const seen: unknown[] = [];
  for await (const event of sseEvents(
    bodyOf('data: {oops\n\ndata: {"type":"ok"}\n\n'),
  )) {
    seen.push(event.type);
  }
  assert.deepEqual(seen, ["ok"]);
});

test("[DONE] ends the stream", async () => {
  const seen: unknown[] = [];
  for await (const event of sseEvents(
    bodyOf('data: {"type":"a"}\n\ndata: [DONE]\n\ndata: {"type":"never"}\n\n'),
  )) {
    seen.push(event.type);
  }
  assert.deepEqual(seen, ["a"]);
});

test("CRLF-delimited frames parse, since proxies emit them", () => {
  // SSE permits \r\n\r\n. Splitting on "\n\n" alone yielded zero events, which
  // would silently downgrade every compaction to the text summary.
  return (async () => {
    const seen: unknown[] = [];
    for await (const event of sseEvents(
      bodyOf('data: {"type":"a"}\r\n\r\ndata: {"type":"b"}\r\n\r\n'),
    )) {
      seen.push(event.type);
    }
    assert.deepEqual(seen, ["a", "b"]);
  })();
});

test("a data: field with no space still parses", () => {
  return (async () => {
    const seen: unknown[] = [];
    for await (const event of sseEvents(bodyOf('data:{"type":"a"}\n\n'))) {
      seen.push(event.type);
    }
    assert.deepEqual(seen, ["a"]);
  })();
});
