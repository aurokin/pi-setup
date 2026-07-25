/**
 * The environment a subagent child process receives.
 *
 * Children inherit the parent's environment so they can find their own
 * binaries and credentials — a Claude child needs Claude's auth, a Codex child
 * needs Codex's. What they must not inherit are secrets the *parent* holds for
 * its own tools: a subagent has no use for the Firecrawl key, and passing it
 * hands a third-party model a live credential it was never asked to hold.
 *
 * This matters because of how the key arrives. `with-secret firecrawl -- pi`
 * injects it per-invocation into pi's environment, which is the documented way
 * to consume a Proton Pass secret; without this filter that injection would
 * silently widen from "pi's firecrawl tools" to "every agent pi spawns".
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
