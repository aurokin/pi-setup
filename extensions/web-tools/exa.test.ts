import assert from "node:assert/strict";
import test from "node:test";
import { Effect } from "effect";
import { exaExploreSite, exaSearch } from "./src/providers/exa.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

test("Exa search sends the narrow request and reports normalized cost", async () => {
  let requestBody: unknown;
  const fetchImpl: typeof fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return Response.json({
      results: [
        {
          title: "Example",
          url: "https://example.com/article",
          publishedDate: "2026-01-02T00:00:00.000Z",
          highlights: ["Relevant evidence."],
        },
      ],
      costDollars: { total: 0.007 },
    });
  };

  const result = await Effect.runPromise(
    exaSearch(
      "secret",
      {
        query: "example query",
        limit: 3,
        kind: "news",
        includeContent: true,
        includeDomains: ["example.com"],
        maxAgeHours: 0,
      },
      fetchImpl,
    ),
  );

  assert.ok(isRecord(requestBody));
  assert.equal(requestBody.query, "example query");
  assert.equal(requestBody.numResults, 3);
  assert.equal(requestBody.category, "news");
  assert.deepEqual(requestBody.includeDomains, ["example.com"]);
  assert.deepEqual(requestBody.contents, {
    highlights: true,
    maxAgeHours: 0,
  });
  assert.match(result.output, /Relevant evidence\./);
  assert.match(result.output, /Backend: exa/);
  assert.match(result.output, /Reported request cost: \$0\.007000/);
  assert.equal(result.details.costDollars, 0.007);
});

test("Exa exploration returns the root and bounded relevance-selected subpages", async () => {
  let requestBody: unknown;
  const fetchImpl: typeof fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return Response.json({
      results: [
        {
          title: "Root",
          url: "https://example.com",
          text: "Root text",
          subpages: [
            {
              title: "API",
              url: "https://example.com/api",
              text: "API text",
            },
          ],
        },
      ],
    });
  };

  const result = await Effect.runPromise(
    exaExploreSite(
      "secret",
      {
        url: "https://example.com",
        limit: 2,
        targetTerms: ["api"],
      },
      fetchImpl,
    ),
  );

  assert.ok(isRecord(requestBody));
  assert.equal(requestBody.subpages, 1);
  assert.deepEqual(requestBody.subpageTarget, ["api"]);
  assert.match(result.output, /Root text/);
  assert.match(result.output, /API text/);
});

test("Effect interruption aborts the underlying Exa fetch", async () => {
  let requestSignal: AbortSignal | null | undefined;
  let started!: () => void;
  const requestStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  const fetchImpl: typeof fetch = (_input, init) => {
    requestSignal = init?.signal;
    started();
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => reject(new DOMException("Aborted", "AbortError")),
        { once: true },
      );
    });
  };

  const controller = new AbortController();
  const running = Effect.runPromise(
    exaSearch("secret", { query: "cancel me" }, fetchImpl),
    { signal: controller.signal },
  );
  const rejected = assert.rejects(running);

  await requestStarted;
  controller.abort();
  await rejected;
  assert.equal(requestSignal?.aborted, true);
});
