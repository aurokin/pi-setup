/**
 * The one network call this extension makes.
 *
 * Kept apart from `protocol.ts` so the wire format stays testable without a
 * socket: everything here is I/O, everything there is pure.
 */

import type { CodexCredentials } from "./auth.ts";
import {
  buildCompactionRequest,
  collectCompaction,
  compactionHeaders,
  responsesUrl,
  sseEvents,
  type CompactionOutcome,
} from "./protocol.ts";

export const DEFAULT_BASE_URL = "https://chatgpt.com/backend-api";

export interface RequestCompactionOptions {
  readonly payload: Readonly<Record<string, unknown>>;
  readonly credentials: CodexCredentials;
  readonly baseUrl?: string;
  readonly signal?: AbortSignal;
  /** Injected in tests; defaults to global fetch. */
  readonly fetchImpl?: typeof fetch;
}

export async function requestCompaction(
  options: RequestCompactionOptions,
): Promise<CompactionOutcome> {
  const doFetch = options.fetchImpl ?? fetch;
  const response = await doFetch(
    responsesUrl(options.baseUrl ?? DEFAULT_BASE_URL),
    {
      method: "POST",
      headers: compactionHeaders(options.credentials),
      body: JSON.stringify(buildCompactionRequest(options.payload)),
      signal: options.signal,
    },
  );

  if (!response.ok || !response.body) {
    // Body text can echo request content, so surface only status and a short
    // prefix — enough to tell a revoked beta flag from an expired token.
    const detail = await response.text().catch(() => "");
    throw new Error(
      `compaction request failed: HTTP ${response.status} ${detail.slice(0, 200)}`,
    );
  }
  return collectCompaction(sseEvents(response.body));
}
