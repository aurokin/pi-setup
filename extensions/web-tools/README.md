# Web tools

One extension owns the public web tool names and routes each capability to one
provider. Routing is static for the loaded extension instance; provider errors
never trigger another backend.

## Capability matrix

| Tool | Exa | Firecrawl | Contract |
| --- | --- | --- | --- |
| `search` | yes | yes | Normalized web or news results, with optional excerpts |
| `scrape` | yes | yes | Clean content from one known URL |
| `explore_site` | yes | no | Root plus relevance-selected linked subpages |
| `crawl` | no | yes | Deterministic path, depth, sitemap, and domain controls |
| `image_search` | no | yes | Image and source URL discovery |

`explore_site` is not a crawl. Exa chooses linked pages by relevance and optional
target terms. Use `crawl` when coverage and traversal controls matter.

## Routing

Routes live in `~/.pi/agent/web-tools.json`, or in the directory selected by
`PI_CODING_AGENT_DIR`. Copy the safe starting point from
[`web-tools.example.json`](../../web-tools.example.json).

```json
{
  "schemaVersion": 1,
  "routes": {
    "search": "exa",
    "scrape": "exa",
    "explore_site": "exa",
    "crawl": "disabled",
    "image_search": "disabled"
  }
}
```

When this file exists it is an allowlist:

- An omitted or `"disabled"` tool is not registered. Its schema, description,
  prompt snippet, and guidelines are absent from the agent.
- An unsupported pair, such as `crawl: "exa"`, is a configuration error.
- A selected backend with no key omits that tool and emits one startup warning.
- Changing the file takes effect after `/reload`.

With no config file, routes are inferred from available keys:

| Keys | Registered tools |
| --- | --- |
| `EXA_API_KEY`, with or without Firecrawl | `search`, `scrape`, `explore_site` through Exa |
| Only `FIRECRAWL_API_KEY` | `search`, `scrape`, `crawl`, `image_search` through Firecrawl |
| Neither | none |

Exa therefore wins precedence. Mixed-provider operation is explicit.

## Spend and output invariants

- No automatic fallback exists. An Exa failure remains an Exa failure.
- Search defaults to five results and crawl/exploration default to five pages.
- Crawl costs one Firecrawl credit per page and is capped at 25 pages.
- `search.includeContent` defaults false and may add Firecrawl scrape credits
  when that route is selected.
- Every result identifies its backend and includes Exa's reported request cost
  when available.
- Model-visible output is capped at 50 KB or 2,000 lines. The full result is
  written to a temporary file when truncated.

## Exa transport decision

The Exa adapter intentionally uses a narrow typed client around Node's built-in
`fetch` for `/search` and `/contents`. The reviewed official SDK version,
`exa-js@2.17.0`, did not forward `AbortSignal`, while the direct client lets
Effect interruption cancel the underlying request. The SDK also brought a much
broader dependency graph for two endpoints.

Request bodies have local TypeScript types, responses are validated at runtime,
and the router depends only on the adapter contract. Reconsider `exa-js` when
it supports cancellation or this extension needs several more Exa APIs.

## Credentials and tests

Keys may come from process environment or the agent directory's `.env` file.
External Claude, Codex, and Droid child processes have both web-provider keys
removed. Pi children run in-process and retain configured web tools. Cursor's
SDK also runs in-process, so its existing documented environment limitation
still applies.

Normal tests mock both provider boundaries and use no credits:

```sh
pnpm --filter web-tools test
```

Live E2E should inject keys with `pass-cli run`, never print or persist them,
and use the smallest request limits. Firecrawl crawl verification uses a page
limit of one.
