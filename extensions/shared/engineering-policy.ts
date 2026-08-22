/**
 * Pi-specific composition for the portable agent policy.
 *
 * `@aurokin/agent-policy` owns the harness-neutral sections. The
 * `system-prompt` extension adds those sections to normal pi sessions, then
 * this module adds Pi's workspace guidance and applies child-role filtering.
 */
import {
  COMMUNICATION_STANDARDS,
  ENGINEERING_POLICY_HEADER,
  GLOBAL_INSTRUCTION_RULES,
  ORCHESTRATION,
  SECOND_OPINIONS,
} from "@aurokin/agent-policy";

export * from "@aurokin/agent-policy";

/** Appended only by subagent role prompts, never by the parent session. */
export const ENGINEERING_POLICY_CHILD_NOTE =
  "When your final message is the only output the reader receives, include what you did and what you found. If you found nothing, say so and name what you inspected. Never return an empty or bare response.";

/**
 * Pi-specific scratch-file guidance.
 *
 * The root spells the fallback `$HOME`, not `~`. Shells do not expand a tilde
 * inside double quotes, so `${PI_CODING_AGENT_DIR:-~/...}` could create a
 * literal `~` directory in the working tree.
 */
export const PI_WORKSPACE_HEADER = "## Workspace";

export const PI_WORKSPACE_BULLETS = [
  "- Keep agent-created scratch files out of the working tree. This includes plans, notes, and intermediate reports.",
  "- Store scratch files under `${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}/artifacts/` in a folder for the current session.",
  "- When `$PI_SESSION_FILE` is set, mirror its location under `sessions/` into the `artifacts/` directory.",
  "- If you cannot write outside the working tree, use `.tmp/` as a fallback and add it to `.gitignore` if needed.",
  "- A file the user asked you to create is a deliverable, not scratch. Write it where the user requested.",
];

export const PI_WORKSPACE = [
  PI_WORKSPACE_HEADER,
  "",
  ...PI_WORKSPACE_BULLETS,
].join("\n");

/** Global policy plus the Pi-specific workspace section. */
export const PI_AGENT_RULES = [GLOBAL_INSTRUCTION_RULES, PI_WORKSPACE].join(
  "\n\n",
);

/** Sections useful to the parent but irrelevant to a headless subagent. */
const SUBAGENT_OMITTED_SECTIONS = [
  ORCHESTRATION,
  SECOND_OPINIONS,
  COMMUNICATION_STANDARDS,
] as const;

/** Remove parent-only policy from a fully assembled pi child system prompt. */
export function withoutSubagentPolicy(
  systemPrompt: string,
  options: { includeWorkspace?: boolean } = {},
) {
  const omittedSections = options.includeWorkspace
    ? SUBAGENT_OMITTED_SECTIONS
    : [...SUBAGENT_OMITTED_SECTIONS, PI_WORKSPACE];
  return omittedSections
    .reduce((prompt, section) => prompt.replaceAll(section, ""), systemPrompt)
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
}

/** pi wraps project instructions in this block. */
const PROJECT_CONTEXT_OPEN = "<project_context>";

/**
 * Add the policy to an assembled system prompt at most once, ahead of project
 * instructions so the nearest project context retains precedence.
 */
export function withAgentRules(systemPrompt: string) {
  if (systemPrompt.includes(ENGINEERING_POLICY_HEADER)) return systemPrompt;

  const at = systemPrompt.indexOf(PROJECT_CONTEXT_OPEN);
  if (at === -1) return `${systemPrompt.trimEnd()}\n\n${PI_AGENT_RULES}\n`;

  const before = systemPrompt.slice(0, at).trimEnd();
  const rest = systemPrompt.slice(at);
  return `${before}\n\n${PI_AGENT_RULES}\n\n${rest}`;
}
