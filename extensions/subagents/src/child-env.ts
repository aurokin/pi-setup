/**
 * The environment a subagent child process receives.
 *
 * Children inherit the parent's environment so they can find their own
 * binaries and credentials — a Claude child needs Claude's auth, a Codex child
 * needs Codex's. What they must not inherit are secrets the *parent* holds for
 * its own tools: handing a third-party model a live credential it was never
 * asked to hold is how a key leaves the boundary it was scoped to.
 *
 * The Firecrawl key is stripped here because Claude and Codex children have
 * their own web search and do not need it. This deliberately does NOT extend
 * to pi subagents: Firecrawl *is* pi's web access, and a reader with no way to
 * reach the web is not much of a research subagent. They run in-process
 * anyway, so there is no child environment to filter — the exclusion would
 * have to be a tool-policy decision, and the decision was to allow it. Crawl
 * spend is bounded by the tool schema (default 5 pages, maximum 25), which
 * applies to children exactly as it does to the parent.
 *
 * Keep this list to secrets the parent consumes itself. Stripping by pattern
 * (`*_API_KEY`, `*_TOKEN`) would take the children's own credentials with it.
 */
const PARENT_ONLY_SECRETS = ["FIRECRAWL_API_KEY"] as const;

export function childEnv(
  parentEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env = { ...parentEnv };
  for (const name of PARENT_ONLY_SECRETS) delete env[name];
  return env;
}

/** Exposed for the test; not part of the runtime contract. */
export const PARENT_ONLY_SECRET_NAMES: readonly string[] = PARENT_ONLY_SECRETS;
