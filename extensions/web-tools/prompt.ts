export const SEARCH_TOOL_DESCRIPTION =
  "Search the web using the configured backend and return normalized web or news results. Can include query-relevant excerpts. Output is limited to 50KB or 2000 lines; complete truncated output is saved to a temporary file.";

export const SEARCH_PROMPT_SNIPPET =
  "Search the web for current information, discovery, or external sources.";

export const SEARCH_PROMPT_GUIDELINES = [
  "Use search when the user asks for current web information, discovery, or sources beyond the local workspace.",
  "Set search includeContent only when excerpts are useful; it can add Firecrawl scrape credits when search is routed there.",
];

export const SCRAPE_TOOL_DESCRIPTION =
  "Read one known URL as clean markdown using the configured backend. Output is limited to 50KB or 2000 lines; complete truncated output is saved to a temporary file.";

export const SCRAPE_PROMPT_SNIPPET =
  "Read one known URL as clean markdown with the configured web backend.";

export const SCRAPE_PROMPT_GUIDELINES = [
  "Use scrape when you need the full readable content of one known URL.",
  "Prefer scrape over bash or raw HTTP fetching for normal web pages because scrape returns cleaned content.",
];

export const EXPLORE_SITE_TOOL_DESCRIPTION =
  "Use Exa to retrieve a root URL and relevance-selected linked subpages. This is not a deterministic crawl: target terms guide which pages are chosen. Defaults to 5 total pages and never accepts more than 25. Output is limited to 50KB or 2000 lines; complete truncated output is saved to a temporary file.";

export const EXPLORE_SITE_PROMPT_SNIPPET =
  "Explore a site through relevance-selected root and subpage content.";

export const EXPLORE_SITE_PROMPT_GUIDELINES = [
  "Use explore_site when you need relevant pages from one site and deterministic path coverage is unnecessary.",
  "Give explore_site focused targetTerms such as docs, API, pricing, or about when the desired section is known.",
  "Do not describe explore_site as a crawl; Exa selects linked pages by relevance.",
];

export const CRAWL_TOOL_DESCRIPTION =
  "Crawl multiple pages of a website with Firecrawl and return markdown documents. Costs 1 Firecrawl credit per page. Defaults to 5 pages and never accepts more than 25. Output is limited to 50KB or 2000 lines; complete truncated output is saved to a temporary file.";

export const CRAWL_PROMPT_SNIPPET =
  "Crawl multiple related pages with deterministic path and domain controls.";

export const CRAWL_PROMPT_GUIDELINES = [
  "Use crawl only when deterministic multi-page traversal or path controls are required.",
  "Set crawl limit to the number of pages actually needed; each page costs 1 Firecrawl credit.",
];

export const IMAGE_SEARCH_TOOL_DESCRIPTION =
  "Search for images with Firecrawl. Returns image and source URLs with available dimensions. Output is limited to 50KB or 2000 lines; complete truncated output is saved to a temporary file.";

export const IMAGE_SEARCH_PROMPT_SNIPPET =
  "Search the web for images through the configured Firecrawl capability.";

export const IMAGE_SEARCH_PROMPT_GUIDELINES = [
  "Use image_search only when the user needs image discovery rather than ordinary web results.",
];
