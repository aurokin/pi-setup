/**
 * Live checks against the real Codex Responses service.
 *
 * These exist because every interesting failure mode of this extension is on
 * the wire: the beta flag is an undocumented server gate, the artifact is
 * opaque, and "did the context actually survive" cannot be asserted against a
 * mock. Unit tests cover the shapes; only these cover the claim.
 *
 * They skip rather than fail when codex auth is absent, so `npm test` stays
 * green on a machine that has never logged in.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { readCodexCredentials } from "./src/auth.ts";
import { requestCompaction } from "./src/client.ts";
import { swapArtifacts, markSummary } from "./src/artifact-swap.ts";

const MODEL = "gpt-5.6-sol";
const UNAVAILABLE = "openai-codex auth is not configured on this machine";

const credentials = readCodexCredentials();

/** A payload shaped exactly like the one pi emits, verified by live probe. */
function payload(input: unknown[]): Record<string, unknown> {
  return {
    model: MODEL,
    store: false,
    stream: true,
    instructions: "You are a helpful coding assistant.",
    input,
    include: ["reasoning.encrypted_content"],
    tool_choice: "auto",
    parallel_tool_calls: true,
    tools: [],
    reasoning: { effort: "medium", summary: "auto" },
  };
}

const user = (text: string) => ({
  type: "message",
  role: "user",
  content: [{ type: "input_text", text }],
});
const assistant = (text: string) => ({
  type: "message",
  role: "assistant",
  content: [{ type: "output_text", text }],
});

const FACTS = {
  "ALPHA-7731": "deploy key",
  "bront.internal": "staging host",
  Dana: "on-call",
};

const conversation = [
  user("My deploy key is ALPHA-7731 and the staging host is bront.internal."),
  assistant("Noted: deploy key ALPHA-7731, staging host bront.internal."),
  user("The on-call engineer is Dana."),
  assistant("Understood, on-call is Dana."),
];

/** One ordinary turn, used to read the answer back out. */
async function ask(input: unknown[]): Promise<string> {
  const response = await fetch(
    "https://chatgpt.com/backend-api/codex/responses",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${credentials!.access}`,
        "chatgpt-account-id": credentials!.accountId,
        originator: "pi",
        "OpenAI-Beta": "responses=experimental",
        accept: "text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify(payload(input)),
    },
  );
  assert.ok(response.ok, `ask failed: HTTP ${response.status}`);
  let text = "";
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const line = chunk.split("\n").find((l) => l.startsWith("data: "));
      if (!line || line.slice(6) === "[DONE]") continue;
      try {
        const event = JSON.parse(line.slice(6));
        if (
          event.type === "response.output_item.done" &&
          event.item?.type === "message"
        ) {
          text += (event.item.content ?? [])
            .map((c: { text?: string }) => c.text ?? "")
            .join("");
        }
      } catch {
        /* ignore */
      }
    }
  }
  return text;
}

test(
  "a real compaction returns exactly one usable artifact",
  { skip: credentials ? false : UNAVAILABLE, timeout: 120_000 },
  async () => {
    const { artifact, usage } = await requestCompaction({
      payload: payload(conversation),
      credentials: credentials!,
    });
    assert.equal(artifact.type, "compaction");
    assert.ok(
      artifact.encrypted_content.length > 100,
      `artifact suspiciously small: ${artifact.encrypted_content.length}`,
    );
    assert.ok((usage?.output_tokens ?? 0) > 0, "no usage reported");
  },
);

test(
  "the artifact carries the context that the raw request no longer does",
  { skip: credentials ? false : UNAVAILABLE, timeout: 180_000 },
  async () => {
    // The point of the whole extension. If this passes and pi's text summary
    // would not have, the extension is earning its keep; if it fails, nothing
    // else here matters.
    const { artifact } = await requestCompaction({
      payload: payload(conversation),
      credentials: credentials!,
    });

    const question = user(
      "From the earlier conversation, state the deploy key, the staging host, and the on-call name.",
    );

    // Exercise the real swap path rather than hand-placing the artifact: this
    // is what `before_provider_request` does on a post-compaction turn.
    const summaryItem = user(markSummary(artifact.id!, "Earlier context."));
    const { input, swapped } = swapArtifacts([summaryItem, question], (id) =>
      id === artifact.id ? artifact : undefined,
    );
    assert.equal(swapped, 1);

    const answered = await ask(input as unknown[]);
    const missing = Object.keys(FACTS).filter((f) => !answered.includes(f));
    assert.deepEqual(
      missing,
      [],
      `artifact lost ${missing.map((m) => FACTS[m as keyof typeof FACTS]).join(", ")}: ${answered.slice(0, 300)}`,
    );

    const blind = await ask([question]);
    assert.ok(
      Object.keys(FACTS).some((f) => !blind.includes(f)),
      "control turn knew the facts without the artifact; the test proves nothing",
    );
  },
);

test(
  "an unusable token is reported, not retried into a hang",
  { skip: credentials ? false : UNAVAILABLE, timeout: 60_000 },
  async () => {
    await assert.rejects(
      () =>
        requestCompaction({
          payload: payload(conversation),
          credentials: { ...credentials!, access: "not-a-token" },
        }),
      /compaction request failed: HTTP 4\d\d/,
    );
  },
);
