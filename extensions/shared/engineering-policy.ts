/**
 * Pi-specific composition for the agent policy.
 *
 * `@aurokin/agent-policy` owns Pi's profile text, including its Workspace
 * section. The `system-prompt` extension adds the profile to normal pi
 * sessions, then this module applies child-role filtering.
 */
import {
  COMMUNICATION_STANDARDS,
  DELEGATION,
  ENGINEERING_POLICY_HEADER,
  PI_PROFILE,
  PI_WORKSPACE,
  SECOND_OPINIONS,
} from "@aurokin/agent-policy";

export * from "@aurokin/agent-policy";

/** Appended only by subagent role prompts, never by the parent session. */
export const ENGINEERING_POLICY_CHILD_NOTE =
  "When your final message is the only output the reader receives, include what you did and what you found. If you found nothing, say so and name what you inspected. Never return an empty or bare response.";

/**
 * Sections useful to the parent but irrelevant to a headless subagent. Second
 * Opinions is opt-in rather than part of `PI_PROFILE`; it stays here so a copy
 * the user enables is still kept from children.
 */
const SUBAGENT_OMITTED_SECTIONS = [
  DELEGATION,
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
  if (at === -1) return `${systemPrompt.trimEnd()}\n\n${PI_PROFILE}\n`;

  const before = systemPrompt.slice(0, at).trimEnd();
  const rest = systemPrompt.slice(at);
  return `${before}\n\n${PI_PROFILE}\n\n${rest}`;
}
