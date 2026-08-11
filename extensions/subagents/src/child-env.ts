/**
 * The environment a subagent child process receives.
 *
 * Children inherit the parent's environment so they can find their own
 * binaries and credentials — a Claude child needs Claude's auth, a Codex child
 * needs Codex's. What they must not inherit are secrets the *parent* holds for
 * its own tools: handing a third-party model a live credential it was never
 * asked to hold is how a key leaves the boundary it was scoped to.
 *
 * Exa and Firecrawl keys are stripped here because external Claude, Codex,
 * and Droid children have their own web access and do not need them. Cursor's
 * SDK runs in-process and cannot receive a filtered subprocess environment;
 * that backend's documented environment limitation still applies.
 * This deliberately does NOT extend to pi subagents: the configured web tools
 * are pi's web access, and a reader with no way to reach the web is not much of
 * a research subagent. They run in-process anyway, so there is no child
 * environment to filter. Provider selection and spend remain bounded by the
 * web-tools routing config and tool schemas exactly as they are for the parent.
 *
 * Keep this list to secrets the parent consumes itself. Stripping by pattern
 * (`*_API_KEY`, `*_TOKEN`) would take the children's own credentials with it.
 */
const PARENT_ONLY_SECRETS = ["EXA_API_KEY", "FIRECRAWL_API_KEY"] as const;

export function childEnv(
  parentEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env = { ...parentEnv };
  for (const name of PARENT_ONLY_SECRETS) delete env[name];
  return env;
}

/** Exposed for the test; not part of the runtime contract. */
export const PARENT_ONLY_SECRET_NAMES: readonly string[] = PARENT_ONLY_SECRETS;
