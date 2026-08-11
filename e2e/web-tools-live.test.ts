import assert from "node:assert/strict";
import test from "node:test";
import { Effect } from "effect";
import {
  exaExploreSite,
  exaScrape,
  exaSearch,
} from "../extensions/web-tools/src/providers/exa.ts";
import {
  firecrawlCrawl,
  firecrawlImageSearch,
  firecrawlScrape,
  firecrawlSearch,
} from "../extensions/web-tools/src/providers/firecrawl.ts";

const liveEnabled = process.env.WEB_TOOLS_LIVE_E2E === "1";
const exaKey = process.env.EXA_API_KEY;
const firecrawlKey = process.env.FIRECRAWL_API_KEY;

function runLive<A, E>(effect: Effect.Effect<A, E>, timeoutMs = 60_000) {
  return Effect.runPromise(effect, { signal: AbortSignal.timeout(timeoutMs) });
}

test(
  "Exa live adapters",
  {
    skip:
      liveEnabled && exaKey
        ? false
        : "set WEB_TOOLS_LIVE_E2E=1 and inject EXA_API_KEY",
    timeout: 180_000,
  },
  async () => {
    assert.ok(exaKey);

    const search = await runLive(
      exaSearch(exaKey, {
        query: "official Exa API documentation",
        limit: 1,
        includeDomains: ["exa.ai"],
        includeContent: true,
      }),
    );
    assert.equal(search.details.backend, "exa");
    assert.match(search.output, /https?:\/\//);

    const scrape = await runLive(
      exaScrape(exaKey, {
        url: "https://exa.ai/docs/reference/search-api-guide-for-coding-agents",
      }),
    );
    assert.equal(scrape.details.backend, "exa");
    assert.ok(scrape.output.length > 100);

    const explore = await runLive(
      exaExploreSite(exaKey, {
        url: "https://exa.ai/docs",
        limit: 2,
        targetTerms: ["API"],
        maxCharacters: 1_000,
      }),
      90_000,
    );
    assert.equal(explore.details.backend, "exa");
    assert.match(explore.output, /Backend: exa/);

    const reportedCost = [search, scrape, explore].reduce(
      (total, result) => total + (result.details.costDollars ?? 0),
      0,
    );
    console.log(`Exa reported E2E request cost: $${reportedCost.toFixed(6)}`);
  },
);

test(
  "Firecrawl live adapters use minimum result and crawl limits",
  {
    skip:
      liveEnabled && firecrawlKey
        ? false
        : "set WEB_TOOLS_LIVE_E2E=1 and inject FIRECRAWL_API_KEY",
    timeout: 300_000,
  },
  async () => {
    assert.ok(firecrawlKey);

    const search = await runLive(
      firecrawlSearch(firecrawlKey, {
        query: "Firecrawl official documentation",
        limit: 1,
        includeDomains: ["firecrawl.dev"],
      }),
    );
    assert.equal(search.details.backend, "firecrawl");

    const scrape = await runLive(
      firecrawlScrape(firecrawlKey, {
        url: "https://example.com",
      }),
    );
    assert.equal(scrape.details.backend, "firecrawl");
    assert.ok(scrape.output.length > 50);

    const images = await runLive(
      firecrawlImageSearch(firecrawlKey, {
        query: "Firecrawl logo",
        limit: 1,
      }),
    );
    assert.equal(images.details.backend, "firecrawl");

    const crawl = await runLive(
      firecrawlCrawl(firecrawlKey, {
        url: "https://example.com",
        limit: 1,
        maxDiscoveryDepth: 0,
      }),
      150_000,
    );
    assert.equal(crawl.details.backend, "firecrawl");
    assert.match(crawl.output, /Backend: firecrawl/);
    const raw = crawl.details.raw;
    const creditsUsed =
      typeof raw === "object" &&
      raw !== null &&
      "creditsUsed" in raw &&
      typeof raw.creditsUsed === "number"
        ? raw.creditsUsed
        : "not reported";
    console.log(`Firecrawl crawl E2E credits used: ${creditsUsed}`);
  },
);
