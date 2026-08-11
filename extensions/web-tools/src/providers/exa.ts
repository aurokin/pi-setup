import { Data, Effect } from "effect";
import type { ExploreSiteInput, ScrapeInput, SearchInput } from "../schemas.ts";
import {
  formatPageEntries,
  formatSearchEntries,
  providerResult,
} from "../output.ts";
import type { PageEntry, ProviderResult, SearchEntry } from "../types.ts";

const EXA_API_URL = "https://api.exa.ai";

type Fetch = typeof globalThis.fetch;

interface ExaDocument {
  readonly title?: string;
  readonly url: string;
  readonly publishedDate?: string;
  readonly author?: string;
  readonly text?: string;
  readonly highlights?: readonly string[];
  readonly subpages?: readonly ExaDocument[];
}

interface ExaResponse {
  readonly results: readonly ExaDocument[];
  readonly costDollars?: number;
  readonly raw: unknown;
}

export class ExaError extends Data.TaggedError("ExaError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function decodeDocument(value: unknown, context: string): ExaDocument {
  if (!isRecord(value) || typeof value.url !== "string") {
    throw new Error(`Invalid Exa ${context}: expected an object with a URL`);
  }

  const highlights = Array.isArray(value.highlights)
    ? value.highlights.filter(
        (item): item is string => typeof item === "string",
      )
    : undefined;
  const subpages = Array.isArray(value.subpages)
    ? value.subpages.map((item, index) =>
        decodeDocument(item, `${context} subpage ${index + 1}`),
      )
    : undefined;

  return {
    url: value.url,
    title: optionalString(value.title),
    publishedDate: optionalString(value.publishedDate),
    author: optionalString(value.author),
    text: optionalString(value.text),
    highlights,
    subpages,
  };
}

function decodeResponse(value: unknown): ExaResponse {
  if (!isRecord(value) || !Array.isArray(value.results)) {
    throw new Error("Invalid Exa response: expected a results array");
  }

  const costDollars = isRecord(value.costDollars)
    ? typeof value.costDollars.total === "number"
      ? value.costDollars.total
      : undefined
    : undefined;

  return {
    results: value.results.map((item, index) =>
      decodeDocument(item, `result ${index + 1}`),
    ),
    costDollars,
    raw: value,
  };
}

export class ExaClient {
  private readonly apiKey: string;
  private readonly fetchImpl: Fetch;
  private readonly baseUrl: string;

  constructor(
    apiKey: string,
    fetchImpl: Fetch = globalThis.fetch,
    baseUrl = EXA_API_URL,
  ) {
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
    this.baseUrl = baseUrl;
  }

  private async post(
    path: "/search" | "/contents",
    body: Record<string, unknown>,
    signal: AbortSignal,
  ) {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const responseText = (await response.text()).slice(0, 500);
      throw new Error(
        `Exa HTTP ${response.status}${responseText ? `: ${responseText}` : ""}`,
      );
    }

    const payload: unknown = await response.json();
    return decodeResponse(payload);
  }

  search(body: Record<string, unknown>, signal: AbortSignal) {
    return this.post("/search", body, signal);
  }

  contents(body: Record<string, unknown>, signal: AbortSignal) {
    return this.post("/contents", body, signal);
  }
}

function exaRequest(request: (signal: AbortSignal) => Promise<ProviderResult>) {
  return Effect.tryPromise({
    try: request,
    catch: (cause) =>
      new ExaError({
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });
}

function searchEntry(document: ExaDocument): SearchEntry {
  return {
    title: document.title,
    url: document.url,
    publishedDate: document.publishedDate,
    author: document.author,
    excerpt: document.highlights?.join("\n\n"),
  };
}

function pageEntry(document: ExaDocument): PageEntry {
  return {
    title: document.title,
    url: document.url,
    publishedDate: document.publishedDate,
    author: document.author,
    text: document.text,
  };
}

export function exaSearch(
  apiKey: string,
  input: SearchInput,
  fetchImpl?: Fetch,
) {
  const client = new ExaClient(apiKey, fetchImpl);
  return exaRequest(async (signal) => {
    const includeContent = input.includeContent ?? false;
    const response = await client.search(
      {
        query: input.query,
        type: "auto",
        numResults: input.limit ?? 5,
        category: input.kind === "news" ? "news" : undefined,
        includeDomains: input.includeDomains,
        excludeDomains: input.excludeDomains,
        contents: includeContent
          ? {
              highlights: true,
              maxAgeHours: input.maxAgeHours,
            }
          : undefined,
      },
      signal,
    );
    const entries = response.results.map(searchEntry);
    return providerResult(
      "exa",
      formatSearchEntries(entries),
      response.raw,
      response.costDollars,
    );
  });
}

export function exaScrape(
  apiKey: string,
  input: ScrapeInput,
  fetchImpl?: Fetch,
) {
  const client = new ExaClient(apiKey, fetchImpl);
  return exaRequest(async (signal) => {
    const response = await client.contents(
      {
        urls: [input.url],
        text: { maxCharacters: 50_000 },
        maxAgeHours: input.maxAgeHours,
      },
      signal,
    );
    const document = response.results[0];
    if (!document) throw new Error(`Exa returned no content for ${input.url}`);

    const entry = pageEntry(document);
    const metadata = input.includeMetadata
      ? formatPageEntries([entry])
      : document.text?.trim() || "No page content returned.";
    return providerResult("exa", metadata, response.raw, response.costDollars);
  });
}

export function exaExploreSite(
  apiKey: string,
  input: ExploreSiteInput,
  fetchImpl?: Fetch,
) {
  const client = new ExaClient(apiKey, fetchImpl);
  return exaRequest(async (signal) => {
    const limit = input.limit ?? 5;
    const response = await client.contents(
      {
        urls: [input.url],
        text: { maxCharacters: input.maxCharacters ?? 5_000 },
        subpages: Math.max(0, limit - 1),
        subpageTarget: input.targetTerms,
        maxAgeHours: input.maxAgeHours,
      },
      signal,
    );
    const root = response.results[0];
    if (!root) throw new Error(`Exa returned no content for ${input.url}`);

    const documents = [root, ...(root.subpages ?? [])].slice(0, limit);
    return providerResult(
      "exa",
      formatPageEntries(documents.map(pageEntry)),
      response.raw,
      response.costDollars,
    );
  });
}
