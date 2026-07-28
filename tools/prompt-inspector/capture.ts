/**
 * Capture the exact payload pi sends to a provider, without sending it.
 *
 * Loaded explicitly with `-e` (never discovered), this registers one provider
 * whose baseUrl is a loopback listener inside pi's own process. Selecting its
 * model and sending a prompt makes pi assemble a real request — system prompt,
 * every tool schema, skills, context files, the lot — and hand it here instead
 * of to a model. The listener writes it to disk and answers with a canned
 * completion so the turn ends cleanly.
 *
 * Two things this buys over reading the prompt out of pi's source:
 *
 * - It is the *actual* payload, after every extension has contributed its
 *   tools and prompt guidelines, so it reflects this machine's configuration
 *   rather than the defaults.
 * - It costs nothing. No request leaves the process, so this can be run as
 *   often as you like, on any model id, without spending a token.
 *
 * Deliberately not an installed extension: it registers a fake provider, which
 * has no business in the model picker during normal work.
 */

import type {
  ExtensionAPI,
  ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Where the payload lands. The runner sets this; the default is for ad-hoc use. */
const OUT = process.env.PROMPT_INSPECTOR_OUT ?? "/tmp/pi-prompt-payload.json";

/**
 * Presented as a large, capable model on purpose. pi trims and shapes requests
 * to fit the selected model, so a small context window here would show a
 * smaller prompt than the one real work sees.
 */
const MODEL: ProviderModelConfig = {
  id: "probe",
  name: "Prompt inspector (captures, never sends)",
  contextWindow: 1_000_000,
  maxTokens: 64_000,
  reasoning: true,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  input: ["text"],
};

function cannedCompletion(streaming: boolean) {
  const body = {
    id: "prompt-inspector",
    object: "chat.completion",
    model: MODEL.id,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: "Captured." },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
  if (!streaming) return JSON.stringify(body);

  const frame = (delta: object, finish: string | null) =>
    `data: ${JSON.stringify({
      id: "prompt-inspector",
      object: "chat.completion.chunk",
      model: MODEL.id,
      choices: [{ index: 0, delta, finish_reason: finish }],
    })}\n\n`;
  return (
    frame({ role: "assistant", content: "Captured." }, null) +
    frame({}, "stop") +
    "data: [DONE]\n\n"
  );
}

export default async function (pi: ExtensionAPI) {
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString("utf8");

    try {
      mkdirSync(dirname(OUT), { recursive: true });
      // Written verbatim, pretty-printed: the renderer's job is presentation,
      // and keeping the capture faithful means a payload can be re-rendered
      // later without re-running pi.
      writeFileSync(OUT, `${JSON.stringify(JSON.parse(raw), null, 2)}\n`);
      console.error(
        `[prompt-inspector] captured ${raw.length} bytes -> ${OUT}`,
      );
    } catch (error) {
      console.error(
        `[prompt-inspector] could not write ${OUT}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const streaming = /"stream"\s*:\s*true/.test(raw);
    res.writeHead(200, {
      "content-type": streaming ? "text/event-stream" : "application/json",
    });
    res.end(cannedCompletion(streaming));
  });

  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") resolve(address.port);
      else reject(new Error("prompt-inspector: no port"));
    });
  });
  server.unref();

  pi.registerProvider("prompt-inspector", {
    name: "Prompt inspector",
    baseUrl: `http://127.0.0.1:${port}/v1`,
    // pi wants a key; nothing checks it, because nothing leaves the process.
    apiKey: "not-used",
    api: "openai-completions",
    models: [MODEL],
  });
}
