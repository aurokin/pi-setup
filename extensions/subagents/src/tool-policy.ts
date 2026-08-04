/**
 * Translates a role's `writeCapable` flag into each backend's native mechanism.
 *
 * The backends handled here restrict tools differently:
 *
 * - codex: `sandbox: "read-only"` is enforced by the OS, so it covers shell
 *   commands too. This is the only real read-only guarantee of the three.
 * - claude: `disallowedTools` removes tools by name. Sound as long as every
 *   shell-bearing tool is named, which is why `Bash` is on the list — a child
 *   with `Bash` is write-capable no matter what the prompt says.
 * - pi: `excludeTools` removes tools by name, same reasoning, same caveat.
 *
 * Keeping these policies in one function makes cross-backend drift visible.
 * Droid and Cursor map roles in their backend-specific policy modules because
 * their SDKs expose different control surfaces.
 */

/**
 * Tools every child loses regardless of role.
 *
 * Orchestration stays with the parent so one manager owns the concurrency cap,
 * and a headless child has nobody to ask.
 */
const PI_ALWAYS_EXCLUDED = [
  "subagent_spawn",
  "subagent_wait",
  "subagent_cancel",
  "subagent_check",
  "subagent_list",
  "workflow",
  "ask_user",
] as const;

/**
 * Every pi tool that can change something, including indirectly.
 *
 * `bash` is the obvious one. The `bg_*` background-terminal tools are the
 * non-obvious one: `bg_start` runs an arbitrary command, so leaving them while
 * denying `bash` would be a read-only policy with a shell in it. The read-only
 * siblings go too — there is nothing to inspect once nothing can be started.
 */
const PI_MUTATING_TOOLS = [
  "write",
  "edit",
  "bash",
  "bg_start",
  "bg_kill",
  "bg_list",
  "bg_status",
] as const;

/** Claude Code's own orchestration, kept inside this extension's manager. */
const CLAUDE_ALWAYS_DISALLOWED = ["Agent", "Task"] as const;

/**
 * Claude Code's mutating tools. `BashOutput` and `KillShell` are listed because
 * they are handles on a shell session; `MultiEdit` because older and newer
 * builds disagree on whether it exists, and naming an absent tool is free.
 */
const CLAUDE_MUTATING_TOOLS = [
  "Bash",
  "BashOutput",
  "KillShell",
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
] as const;

export interface BackendToolPolicy {
  /** Passed to `createAgentSession({ excludeTools })`. */
  readonly piExcludeTools: readonly string[];
  /** Passed to the Claude Agent SDK `query({ options: { disallowedTools } })`. */
  readonly claudeDisallowedTools: readonly string[];
  /** Passed to `codex app-server` when starting the conversation. */
  readonly codexSandbox: "read-only" | "danger-full-access";
}

/**
 * The parent's surface, untouched.
 *
 * Only the `side` role takes this, and only to keep the cached prefix
 * identical to the parent's — see the role's comment. It is restricted by
 * instruction instead, which is a real downgrade in guarantee: nothing here
 * stops a side child from writing except the prompt telling it not to.
 */
const UNRESTRICTED: BackendToolPolicy = {
  piExcludeTools: [],
  claudeDisallowedTools: [],
  codexSandbox: "danger-full-access",
};

export function toolPolicy(
  writeCapable: boolean,
  inheritsParentTools = false,
): BackendToolPolicy {
  if (inheritsParentTools) return UNRESTRICTED;
  if (writeCapable) {
    return {
      piExcludeTools: [...PI_ALWAYS_EXCLUDED],
      claudeDisallowedTools: [...CLAUDE_ALWAYS_DISALLOWED],
      codexSandbox: "danger-full-access",
    };
  }
  return {
    piExcludeTools: [...PI_ALWAYS_EXCLUDED, ...PI_MUTATING_TOOLS],
    claudeDisallowedTools: [
      ...CLAUDE_ALWAYS_DISALLOWED,
      ...CLAUDE_MUTATING_TOOLS,
    ],
    codexSandbox: "read-only",
  };
}
