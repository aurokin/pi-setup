import {
  type AgentToolResult,
  type AgentToolUpdateCallback,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { Cause, Data, Effect, Exit } from "effect";
import {
  CRAWL_PROMPT_GUIDELINES,
  CRAWL_PROMPT_SNIPPET,
  CRAWL_TOOL_DESCRIPTION,
  EXPLORE_SITE_PROMPT_GUIDELINES,
  EXPLORE_SITE_PROMPT_SNIPPET,
  EXPLORE_SITE_TOOL_DESCRIPTION,
  IMAGE_SEARCH_PROMPT_GUIDELINES,
  IMAGE_SEARCH_PROMPT_SNIPPET,
  IMAGE_SEARCH_TOOL_DESCRIPTION,
  SCRAPE_PROMPT_GUIDELINES,
  SCRAPE_PROMPT_SNIPPET,
  SCRAPE_TOOL_DESCRIPTION,
  SEARCH_PROMPT_GUIDELINES,
  SEARCH_PROMPT_SNIPPET,
  SEARCH_TOOL_DESCRIPTION,
} from "./prompt.ts";
import {
  resolveWebToolsConfig,
  type WebToolsConfigOptions,
} from "./src/config.ts";
import { exaExploreSite, exaScrape, exaSearch } from "./src/providers/exa.ts";
import {
  firecrawlCrawl,
  firecrawlImageSearch,
  firecrawlScrape,
  firecrawlSearch,
} from "./src/providers/firecrawl.ts";
import {
  crawlSchema,
  exploreSiteSchema,
  imageSearchSchema,
  scrapeSchema,
  searchSchema,
} from "./src/schemas.ts";
import { truncateWebOutput } from "./src/output.ts";
import type {
  ProviderResult,
  WebBackend,
  WebToolDetails,
} from "./src/types.ts";

class OutputError extends Data.TaggedError("OutputError")<{
  readonly message: string;
  readonly cause: unknown;
}> {}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function backendLabel(backend: WebBackend) {
  return backend === "exa" ? "Exa" : "Firecrawl";
}

async function runWebTool(
  operation: string,
  backend: WebBackend,
  status: string,
  timeout: number,
  signal: AbortSignal | undefined,
  onUpdate: AgentToolUpdateCallback<WebToolDetails | undefined> | undefined,
  request: Effect.Effect<ProviderResult, unknown>,
) {
  const program = Effect.gen(function* () {
    yield* Effect.sync(() =>
      onUpdate?.({
        content: [{ type: "text", text: status }],
        details: undefined,
      }),
    );
    const result = yield* request.pipe(Effect.timeout(timeout));
    const output = yield* Effect.tryPromise({
      try: () => truncateWebOutput(result.output, operation),
      catch: (cause) =>
        new OutputError({ message: errorMessage(cause), cause }),
    });
    return {
      content: [{ type: "text" as const, text: output }],
      details: result.details,
    } satisfies AgentToolResult<WebToolDetails>;
  });

  const exit = await Effect.runPromiseExit(
    program,
    signal ? { signal } : undefined,
  );
  if (Exit.isSuccess(exit)) return exit.value;
  if (Cause.hasInterruptsOnly(exit.cause)) {
    throw new Error(`${backendLabel(backend)} ${operation} request cancelled`);
  }

  const cause = Cause.squash(exit.cause);
  throw new Error(
    `${backendLabel(backend)} ${operation} failed: ${errorMessage(cause)}`,
    { cause },
  );
}

function routedDescription(description: string, backend: WebBackend) {
  return `${description} Current route: ${backendLabel(backend)}.`;
}

export function registerWebTools(
  pi: ExtensionAPI,
  options: WebToolsConfigOptions = {},
) {
  const config = resolveWebToolsConfig(options);

  if (config.warnings.length > 0) {
    pi.on("session_start", (_event, ctx) => {
      for (const warning of config.warnings) {
        ctx.ui.notify(`[web-tools] ${warning}`, "warning");
      }
    });
  }

  const searchRoute = config.routes.search;
  if (searchRoute) {
    pi.registerTool({
      name: "search",
      label: "Search Web",
      description: routedDescription(
        SEARCH_TOOL_DESCRIPTION,
        searchRoute.backend,
      ),
      promptSnippet: SEARCH_PROMPT_SNIPPET,
      promptGuidelines: SEARCH_PROMPT_GUIDELINES,
      parameters: searchSchema,
      execute: (_toolCallId, params, signal, onUpdate) =>
        runWebTool(
          "search",
          searchRoute.backend,
          `Searching ${backendLabel(searchRoute.backend)} for: ${params.query}`,
          35_000,
          signal,
          onUpdate,
          searchRoute.backend === "exa"
            ? exaSearch(searchRoute.apiKey, params)
            : firecrawlSearch(searchRoute.apiKey, params),
        ),
    });
  }

  const scrapeRoute = config.routes.scrape;
  if (scrapeRoute) {
    pi.registerTool({
      name: "scrape",
      label: "Read Web Page",
      description: routedDescription(
        SCRAPE_TOOL_DESCRIPTION,
        scrapeRoute.backend,
      ),
      promptSnippet: SCRAPE_PROMPT_SNIPPET,
      promptGuidelines: SCRAPE_PROMPT_GUIDELINES,
      parameters: scrapeSchema,
      execute: (_toolCallId, params, signal, onUpdate) =>
        runWebTool(
          "scrape",
          scrapeRoute.backend,
          `Reading with ${backendLabel(scrapeRoute.backend)}: ${params.url}`,
          (params.timeout ?? 30_000) + 5_000,
          signal,
          onUpdate,
          scrapeRoute.backend === "exa"
            ? exaScrape(scrapeRoute.apiKey, params)
            : firecrawlScrape(scrapeRoute.apiKey, params),
        ),
    });
  }

  const exploreRoute = config.routes.explore_site;
  if (exploreRoute) {
    pi.registerTool({
      name: "explore_site",
      label: "Explore Website",
      description: routedDescription(
        EXPLORE_SITE_TOOL_DESCRIPTION,
        exploreRoute.backend,
      ),
      promptSnippet: EXPLORE_SITE_PROMPT_SNIPPET,
      promptGuidelines: EXPLORE_SITE_PROMPT_GUIDELINES,
      parameters: exploreSiteSchema,
      execute: (_toolCallId, params, signal, onUpdate) =>
        runWebTool(
          "explore_site",
          exploreRoute.backend,
          `Exploring up to ${params.limit ?? 5} relevant pages from: ${params.url}`,
          ((params.timeout ?? 60) + 5) * 1_000,
          signal,
          onUpdate,
          exaExploreSite(exploreRoute.apiKey, params),
        ),
    });
  }

  const crawlRoute = config.routes.crawl;
  if (crawlRoute) {
    pi.registerTool({
      name: "crawl",
      label: "Crawl Website",
      description: routedDescription(
        CRAWL_TOOL_DESCRIPTION,
        crawlRoute.backend,
      ),
      promptSnippet: CRAWL_PROMPT_SNIPPET,
      promptGuidelines: CRAWL_PROMPT_GUIDELINES,
      parameters: crawlSchema,
      execute: (_toolCallId, params, signal, onUpdate) =>
        runWebTool(
          "crawl",
          crawlRoute.backend,
          `Crawling up to ${params.limit ?? 5} pages from: ${params.url}`,
          ((params.timeout ?? 120) + 5) * 1_000,
          signal,
          onUpdate,
          firecrawlCrawl(crawlRoute.apiKey, params),
        ),
    });
  }

  const imageRoute = config.routes.image_search;
  if (imageRoute) {
    pi.registerTool({
      name: "image_search",
      label: "Search Images",
      description: routedDescription(
        IMAGE_SEARCH_TOOL_DESCRIPTION,
        imageRoute.backend,
      ),
      promptSnippet: IMAGE_SEARCH_PROMPT_SNIPPET,
      promptGuidelines: IMAGE_SEARCH_PROMPT_GUIDELINES,
      parameters: imageSearchSchema,
      execute: (_toolCallId, params, signal, onUpdate) =>
        runWebTool(
          "image_search",
          imageRoute.backend,
          `Searching Firecrawl images for: ${params.query}`,
          35_000,
          signal,
          onUpdate,
          firecrawlImageSearch(imageRoute.apiKey, params),
        ),
    });
  }

  return config;
}

export default function webTools(pi: ExtensionAPI) {
  registerWebTools(pi);
}
