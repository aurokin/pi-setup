/**
 * Codex subscription credentials, read from pi's own auth store.
 *
 * The compaction request goes to the same endpoint pi already calls, so it
 * needs the same bearer token. Pi does not hand it to extensions — the
 * `before_provider_headers` hook fires with an empty header map on this
 * provider (verified live), so there is nothing to borrow there.
 *
 * The token is read on demand and returned to the caller for one request. It is
 * never logged, cached to disk, or placed on a command line. Anything that
 * stringifies this module's output for humans is a bug.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface CodexCredentials {
  readonly access: string;
  readonly accountId: string;
  /** Epoch millis. Pi refreshes the token; we only refuse to use a dead one. */
  readonly expires: number;
}

/** Mirrors pi's own `PI_CODING_AGENT_DIR` override. */
export function agentDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * Read the `openai-codex` entry from `auth.json`.
 *
 * Returns undefined rather than throwing for every expected absence — no auth
 * file, no codex entry, an expired token — because the only sane response to
 * all three is to let pi compact normally.
 */
export function readCodexCredentials(options?: {
  env?: NodeJS.ProcessEnv;
  now?: number;
}): CodexCredentials | undefined {
  const now = options?.now ?? Date.now();
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      readFileSync(join(agentDir(options?.env), "auth.json"), "utf8"),
    );
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const entry = (parsed as Record<string, unknown>)["openai-codex"];
  if (typeof entry !== "object" || entry === null) return undefined;

  const { access, accountId, expires } = entry as Record<string, unknown>;
  if (!isNonEmptyString(access) || !isNonEmptyString(accountId))
    return undefined;
  // An absent expiry is treated as usable: pi wrote the entry, and a 401 is a
  // better failure than refusing to try.
  if (typeof expires === "number" && expires <= now) return undefined;

  return {
    access,
    accountId,
    expires: typeof expires === "number" ? expires : Number.POSITIVE_INFINITY,
  };
}
