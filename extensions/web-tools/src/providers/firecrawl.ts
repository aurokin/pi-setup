import { Data, Effect, Exit } from "effect";
import type { CrawlJob, CrawlOptions, Firecrawl, SearchData } from "firecrawl";
import type {
  CrawlInput,
  ImageSearchInput,
  ScrapeInput,
  SearchInput,
} from "../schemas.ts";
import {
  formatImageEntries,
  formatSearchEntries,
  providerResult,
} from "../output.ts";
import type { ImageEntry, ProviderResult, SearchEntry } from "../types.ts";

export class FirecrawlError extends Data.TaggedError("FirecrawlError")<{
  readonly message: string;
  readonly cause: unknown;
}> {}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function firecrawlRequest<T>(request: () => Promise<T>) {
  return Effect.tryPromise({
    try: request,
    catch: (cause) =>
      new FirecrawlError({ message: errorMessage(cause), cause }),
  });
}

function createClient(apiKey: string) {
  return Effect.tryPromise({
    try: async () => new (await import("firecrawl")).Firecrawl({ apiKey }),
    catch: (cause) =>
      new FirecrawlError({ message: errorMessage(cause), cause }),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function searchEntries(data: SearchData, kind: "web" | "news") {
  const values = data[kind] ?? [];
  const entries: SearchEntry[] = [];
  for (const value of values) {
    if (!isRecord(value) || typeof value.url !== "string") continue;
    const highlights = Array.isArray(value.highlights)
      ? value.highlights
          .filter((item): item is string => typeof item === "string")
          .join("\n\n")
      : optionalString(value.highlights);
    entries.push({
      url: value.url,
      title: optionalString(value.title),
      publishedDate:
        optionalString(value.publishedDate) ?? optionalString(value.date),
      author: optionalString(value.author),
      excerpt:
        highlights ??
        optionalString(value.markdown) ??
        optionalString(value.description) ??
        optionalString(value.snippet),
    });
  }
  return entries;
}

function imageEntries(data: SearchData) {
  const entries: ImageEntry[] = [];
  for (const value of data.images ?? []) {
    if (!isRecord(value) || typeof value.imageUrl !== "string") continue;
    entries.push({
      imageUrl: value.imageUrl,
      title: optionalString(value.title),
      sourceUrl: optionalString(value.url),
      width:
        typeof value.imageWidth === "number" ? value.imageWidth : undefined,
      height:
        typeof value.imageHeight === "number" ? value.imageHeight : undefined,
    });
  }
  return entries;
}

function maxAgeMilliseconds(maxAgeHours: number | undefined) {
  return maxAgeHours === undefined ? undefined : maxAgeHours * 60 * 60 * 1_000;
}

export function firecrawlSearch(apiKey: string, input: SearchInput) {
  return createClient(apiKey).pipe(
    Effect.flatMap((client) =>
      firecrawlRequest(() =>
        client.search(input.query, {
          limit: input.limit ?? 5,
          sources: [input.kind ?? "web"],
          includeDomains: input.includeDomains,
          excludeDomains: input.excludeDomains,
          highlights: input.includeContent ?? false,
          scrapeOptions: input.includeContent
            ? {
                formats: ["markdown"],
                maxAge: maxAgeMilliseconds(input.maxAgeHours),
              }
            : undefined,
          timeout: 30_000,
        }),
      ),
    ),
    Effect.map((result) =>
      providerResult(
        "firecrawl",
        formatSearchEntries(searchEntries(result, input.kind ?? "web")),
        result,
      ),
    ),
  );
}

export function firecrawlScrape(apiKey: string, input: ScrapeInput) {
  return createClient(apiKey).pipe(
    Effect.flatMap((client) =>
      firecrawlRequest(() =>
        client.scrape(input.url, {
          formats: ["markdown"],
          onlyMainContent: true,
          timeout: input.timeout ?? 30_000,
          maxAge: maxAgeMilliseconds(input.maxAgeHours),
        }),
      ),
    ),
    Effect.map((document) => {
      const markdown = document.markdown?.trim() || "No page content returned.";
      const metadata =
        input.includeMetadata && document.metadata
          ? `\n\nMetadata:\n${JSON.stringify(document.metadata, null, 2)}`
          : "";
      return providerResult("firecrawl", `${markdown}${metadata}`, document);
    }),
  );
}

export function firecrawlImageSearch(apiKey: string, input: ImageSearchInput) {
  return createClient(apiKey).pipe(
    Effect.flatMap((client) =>
      firecrawlRequest(() =>
        client.search(input.query, {
          limit: input.limit ?? 5,
          sources: ["images"],
          timeout: 30_000,
        }),
      ),
    ),
    Effect.map((result) =>
      providerResult(
        "firecrawl",
        formatImageEntries(imageEntries(result)),
        result,
      ),
    ),
  );
}

export type CrawlClient = Pick<
  Firecrawl,
  "startCrawl" | "getCrawlStatus" | "cancelCrawl"
>;

function pollCrawl(
  client: CrawlClient,
  jobId: string,
): Effect.Effect<CrawlJob, FirecrawlError> {
  return firecrawlRequest(() => client.getCrawlStatus(jobId)).pipe(
    Effect.flatMap((job) => {
      if (job.status === "scraping") {
        return Effect.sleep("2 seconds").pipe(
          Effect.flatMap(() => Effect.suspend(() => pollCrawl(client, jobId))),
        );
      }
      if (job.status === "completed") return Effect.succeed(job);
      return Effect.fail(
        new FirecrawlError({
          message: `Crawl ${jobId} ended with status ${job.status}`,
          cause: job,
        }),
      );
    }),
  );
}

/** Brackets the remote job so every non-successful exit attempts cancellation. */
export function crawlEffect(
  client: CrawlClient,
  url: string,
  options: CrawlOptions,
) {
  return Effect.acquireUseRelease(
    firecrawlRequest(() => client.startCrawl(url, options)),
    (job) => pollCrawl(client, job.id),
    (job, exit) =>
      Exit.isSuccess(exit)
        ? Effect.void
        : firecrawlRequest(() => client.cancelCrawl(job.id)).pipe(
            Effect.timeout("10 seconds"),
            Effect.ignore,
          ),
  );
}

export function firecrawlCrawl(
  apiKey: string,
  input: CrawlInput,
): Effect.Effect<ProviderResult, FirecrawlError> {
  return createClient(apiKey).pipe(
    Effect.flatMap((client) =>
      crawlEffect(client, input.url, {
        limit: input.limit ?? 5,
        maxDiscoveryDepth: input.maxDiscoveryDepth,
        includePaths: input.includePaths,
        excludePaths: input.excludePaths,
        crawlEntireDomain: input.crawlEntireDomain,
        allowSubdomains: input.allowSubdomains,
        sitemap: input.sitemap,
        scrapeOptions: {
          formats: ["markdown"],
          onlyMainContent: input.onlyMainContent ?? true,
        },
      }),
    ),
    Effect.map((result) =>
      providerResult("firecrawl", JSON.stringify(result, null, 2), result),
    ),
  );
}
