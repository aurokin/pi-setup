export type WebBackend = "exa" | "firecrawl";

export type WebToolName =
  "search" | "scrape" | "explore_site" | "crawl" | "image_search";

export interface WebToolDetails {
  readonly backend: WebBackend;
  readonly costDollars?: number;
  readonly raw: unknown;
}

export interface ProviderResult {
  readonly output: string;
  readonly details: WebToolDetails;
}

export interface SearchEntry {
  readonly title?: string;
  readonly url: string;
  readonly publishedDate?: string;
  readonly author?: string;
  readonly excerpt?: string;
}

export interface PageEntry extends SearchEntry {
  readonly text?: string;
}

export interface ImageEntry {
  readonly title?: string;
  readonly imageUrl: string;
  readonly sourceUrl?: string;
  readonly width?: number;
  readonly height?: number;
}
