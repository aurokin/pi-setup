import { StringEnum } from "@earendil-works/pi-ai";
import { Type, type Static } from "typebox";

export const searchSchema = Type.Object({
  query: Type.String({ description: "The web search query." }),
  limit: Type.Optional(
    Type.Integer({
      description: "Maximum number of results. Defaults to 5.",
      minimum: 1,
      maximum: 20,
    }),
  ),
  kind: Type.Optional(
    StringEnum(["web", "news"] as const, {
      description: "Search ordinary web pages or news. Defaults to web.",
    }),
  ),
  includeContent: Type.Optional(
    Type.Boolean({
      description:
        "Include query-relevant page excerpts. Defaults to false. This may cost additional Firecrawl credits when search is routed there.",
    }),
  ),
  includeDomains: Type.Optional(
    Type.Array(Type.String(), {
      description: "Only return results from these domains or domain paths.",
      maxItems: 50,
    }),
  ),
  excludeDomains: Type.Optional(
    Type.Array(Type.String(), {
      description: "Exclude results from these domains or domain paths.",
      maxItems: 50,
    }),
  ),
  maxAgeHours: Type.Optional(
    Type.Number({
      description:
        "Maximum age of retrieved page content in hours. Zero forces a live fetch.",
      minimum: 0,
    }),
  ),
});

export type SearchInput = Static<typeof searchSchema>;

export const scrapeSchema = Type.Object({
  url: Type.String({ description: "The known URL to read." }),
  timeout: Type.Optional(
    Type.Integer({
      description: "Request timeout in milliseconds. Defaults to 30000.",
      minimum: 1,
      maximum: 120_000,
    }),
  ),
  maxAgeHours: Type.Optional(
    Type.Number({
      description:
        "Maximum acceptable cache age in hours. Zero forces a live fetch.",
      minimum: 0,
    }),
  ),
  includeMetadata: Type.Optional(
    Type.Boolean({
      description: "Append available page metadata. Defaults to false.",
    }),
  ),
});

export type ScrapeInput = Static<typeof scrapeSchema>;

export const exploreSiteSchema = Type.Object({
  url: Type.String({ description: "The root URL to explore." }),
  limit: Type.Optional(
    Type.Integer({
      description:
        "Maximum total pages, including the root. Defaults to 5; maximum 25.",
      minimum: 1,
      maximum: 25,
    }),
  ),
  targetTerms: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "Terms such as docs, API, pricing, or about that guide relevant subpage selection.",
      maxItems: 10,
    }),
  ),
  maxAgeHours: Type.Optional(
    Type.Number({
      description:
        "Maximum acceptable cache age in hours. Zero forces live fetches.",
      minimum: 0,
    }),
  ),
  maxCharacters: Type.Optional(
    Type.Integer({
      description:
        "Maximum text characters requested per page. Defaults to 5000.",
      minimum: 500,
      maximum: 50_000,
    }),
  ),
  timeout: Type.Optional(
    Type.Integer({
      description: "Maximum request time in seconds. Defaults to 60.",
      minimum: 1,
      maximum: 120,
    }),
  ),
});

export type ExploreSiteInput = Static<typeof exploreSiteSchema>;

export const crawlSchema = Type.Object({
  url: Type.String({ description: "The starting URL to crawl." }),
  limit: Type.Optional(
    Type.Integer({
      description:
        "Maximum pages to crawl, at 1 Firecrawl credit each. Defaults to 5; maximum 25.",
      minimum: 1,
      maximum: 25,
    }),
  ),
  maxDiscoveryDepth: Type.Optional(
    Type.Integer({
      description: "Maximum link-discovery depth from the starting URL.",
      minimum: 0,
    }),
  ),
  includePaths: Type.Optional(
    Type.Array(Type.String(), {
      description: "URL pathname regex patterns to include.",
    }),
  ),
  excludePaths: Type.Optional(
    Type.Array(Type.String(), {
      description: "URL pathname regex patterns to exclude.",
    }),
  ),
  crawlEntireDomain: Type.Optional(
    Type.Boolean({
      description: "Allow sibling and parent paths on the same domain.",
    }),
  ),
  allowSubdomains: Type.Optional(
    Type.Boolean({ description: "Allow crawling subdomains." }),
  ),
  sitemap: Type.Optional(StringEnum(["include", "skip", "only"] as const)),
  onlyMainContent: Type.Optional(
    Type.Boolean({
      description: "Extract only each page's main content. Defaults to true.",
    }),
  ),
  timeout: Type.Optional(
    Type.Integer({
      description: "Maximum crawl wait time in seconds. Defaults to 120.",
      minimum: 1,
      maximum: 600,
    }),
  ),
});

export type CrawlInput = Static<typeof crawlSchema>;

export const imageSearchSchema = Type.Object({
  query: Type.String({ description: "The image search query." }),
  limit: Type.Optional(
    Type.Integer({
      description: "Maximum number of image results. Defaults to 5.",
      minimum: 1,
      maximum: 20,
    }),
  ),
});

export type ImageSearchInput = Static<typeof imageSearchSchema>;
