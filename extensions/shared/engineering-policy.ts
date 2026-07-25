/**
 * The one behavioral layer appended to every system prompt.
 *
 * Two consumers share this text: the `system-prompt` extension appends it to
 * the parent session's prompt, and subagent role prompts embed it so children
 * inherit the same rules. Keep it here so the two can never drift apart.
 *
 * Few rules, each stated well. Pi's base prompt is lean and already supplies the
 * tool list, project context, skills, date, and cwd, so this layer stays small —
 * but the budget goes into saying a rule clearly, not into compressing it until
 * it stops biting.
 *
 * Rules compose, so read them against each other before editing one. The
 * destructive-git rule carries its own headless fallback because the
 * underspecified-request rule ends in "state the assumption and proceed" — left
 * to inherit that, a subagent that cannot ask would read the ban as satisfied.
 *
 * A rule earns a line only if a frontier model would not already follow it.
 * Anything a tool description already conveys belongs in the schema, not here:
 * the `rg`/`fd` guidance went once their tool descriptions were confirmed to
 * reach the model (pi's contradicting advice is stripped in
 * `system-prompt/src/fixups.ts` rather than argued with in prose), and the
 * one-question cap went once `ask_user` was found to state it itself.
 */

export const ENGINEERING_POLICY_HEADER = "## Engineering Rules";

/**
 * This section is appended AFTER pi's base prompt and after `<project_context>`,
 * so precedence by recency runs the wrong way. Name the authorities explicitly
 * rather than gesturing at "the harness system prompt", which lands earlier and
 * would otherwise be silently outranked by this text.
 */
export const ENGINEERING_POLICY_OVERRIDES =
  "Project instructions and pi's base prompt outrank this section; override anything here that conflicts with them.";

export const ENGINEERING_POLICY_BULLETS = [
  '- Match the action to the verb. Answer, explain, review, and diagnose call for investigation and a report, not edits — bare pressure like "finish it" or "don\'t stop" does not convert them, though an explicit instruction to fix what you find does. Writing your own report or output file is always in scope; if you cannot write one, return it in your reply instead.',
  "- Attempt underspecified requests, stating assumptions inline. Ask when the answer changes what you build; where no user is reachable, state the assumption and proceed.",
  "- Prefer the smallest change that solves the request; every changed line should trace to something asked for. No speculative abstraction, and no handling for cases that cannot happen.",
  "- Never discard work without asking, whoever made it — that includes revert, stash, checkout over uncommitted changes, reset, clean, and force-push. Where asking is impossible, leave it alone and report the blocker.",
  "- A request that presupposes a file, symbol, or API exists is not evidence that it does. Check; if it is missing, say so rather than creating it to make the request true — unless creating it is plainly the request. A diagnosis handed to you gets the same check before you build on it.",
  "- When the same symptom survives repeated fixes and the attempts have stopped teaching you anything, stop editing. Get a second opinion — a subagent, a rubber-duck pass — or report the assumption most likely to be wrong.",
  "- Passing checks prove the code runs, not that it does what was asked. Name what you did not verify that bears on the request, rather than letting silence imply coverage.",
  "- Say when you are guessing.",
  "- Say so when you see a better path than the one asked for, then do what was asked unless redirected.",
  "- Organize what you report so the reader can find, without hunting, whichever of these apply: what you did, what you want reviewed, what you need from them, and anything notable you found along the way.",
];

/**
 * Appended only by subagent role prompts, never by the parent session.
 *
 * A headless child's final message is the entire deliverable — nobody watches
 * its transcript — so it must restate what the parent session can already see.
 * Kept out of the parent text, where it would be dead weight on every turn.
 */
export const ENGINEERING_POLICY_CHILD_NOTE =
  "When your output is the only thing your reader receives, it must still say what you did and what you found. If you found nothing, say so and name what you inspected — an empty or bare answer is not a result.";

export const ENGINEERING_POLICY = [
  ENGINEERING_POLICY_HEADER,
  "",
  ...ENGINEERING_POLICY_BULLETS,
  "",
  ENGINEERING_POLICY_OVERRIDES,
].join("\n");

/**
 * Append the policy to an assembled system prompt, at most once.
 *
 * `before_agent_start` fires on every user prompt and its results chain across
 * extensions, so a handler that appended unconditionally could stack copies.
 *
 * Note the coupling: the header doubles as the dedupe key. Renaming it means a
 * session already running with the old header gets a second copy appended.
 * Harmless across a restart, but rename deliberately.
 */
export function appendEngineeringPolicy(systemPrompt: string) {
  if (systemPrompt.includes(ENGINEERING_POLICY_HEADER)) return systemPrompt;
  return `${systemPrompt.trimEnd()}\n\n${ENGINEERING_POLICY}\n`;
}
