/**
 * The behavioral layer added to every system prompt.
 *
 * Two consumers share this text: the `system-prompt` extension adds it to the
 * parent session's prompt, and subagent role prompts embed it so children
 * inherit the same rules. Keep it here so the two can never drift apart.
 *
 * `ENGINEERING_POLICY` is deliberately harness-agnostic — it names no pi
 * binary, path, or environment variable — because the same rules are meant to
 * be carried to other coding agents unchanged. Anything that only makes sense
 * inside pi belongs in `PI_WORKSPACE` below, not in a bullet here. `PI_AGENT_RULES`
 * is the two together, and is what both consumers actually inject.
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
 * A rule earns a line only if a frontier model would not already follow it, and
 * only in the form that bites. Pi's base prompt already carries "Be concise in
 * your responses" (`core/system-prompt.js:70`), so the concision rule here does
 * not repeat it — it names the waste instead, which is the difference between
 * the two in every shipped prompt worth copying. It is also the one rule a
 * Claude Code or Codex child would otherwise never see, since neither runs pi's
 * base prompt.
 *
 * Two rules ride on existing bullets rather than earning their own line, because
 * they are the same rule extended rather than a new one. Checking a subagent's
 * report before relaying it is the presupposition rule applied to a claim that
 * arrived instead of one that was assumed. Refusing to chain second opinions is
 * part of how a second opinion is taken, not a separate obligation.
 *
 * The second-opinion bullet names the `advisor` and `rubber-duck` roles rather
 * than describing a mechanism, because `roles.ts` already implements them and
 * `subagents/src/prompt.ts` already says to prefer a different model family for
 * both. Restating either here would be a second source of truth.
 *
 * Anything a tool description already conveys belongs in the schema, not here:
 * the `rg`/`fd` guidance went once their tool descriptions were confirmed to
 * reach the model (pi's contradicting advice is stripped in
 * `system-prompt/src/fixups.ts` rather than argued with in prose), and the
 * one-question cap went once `ask_user` was found to state it itself.
 */

export const ENGINEERING_POLICY_HEADER = "## Engineering Rules";

export const ENGINEERING_POLICY_BULLETS = [
  '- Match the action to the verb. Answer, explain, review, and diagnose call for investigation and a report, not edits — bare pressure like "finish it" or "don\'t stop" does not convert them, though an explicit instruction to fix what you find does. Writing your own report or output file is always in scope; if you cannot write one, return it in your reply instead.',
  "- Attempt underspecified requests, stating assumptions inline. Ask when the answer changes what you build; where no user is reachable, state the assumption and proceed.",
  "- Prefer the smallest change that solves the request; every changed line should trace to something asked for. No speculative abstraction, and no handling for cases that cannot happen. However thorough the process was, the output stays as simple as solo work would have made it.",
  "- Never discard work without asking, whoever made it — that includes revert, stash, checkout over uncommitted changes, reset, clean, and force-push. Where asking is impossible, leave it alone and report the blocker.",
  "- A request that presupposes a file, symbol, or API exists is not evidence that it does. Check; if it is missing, say so rather than creating it to make the request true — unless creating it is plainly the request. Anything you did not establish yourself gets the same check before you build on it or pass it on: a diagnosis you were handed, a subagent's or workflow's report, a command someone gave you. Report what you confirmed and what you did not as different things.",
  "- Get a second opinion before committing to something expensive to unwind, and when the same symptom survives repeated fixes and the attempts have stopped teaching you anything — there, stop editing first. Use an advisor or rubber-duck subagent, or report the assumption most likely to be wrong. One pass, not a chain: no re-asking until you get the answer you wanted. What comes back is evidence, not orders — where your own evidence contradicts it, follow the evidence and say so.",
  "- Passing checks prove the code runs, not that it does what was asked. Name what you did not verify that bears on the request, rather than letting silence imply coverage.",
  "- Say when you are guessing.",
  "- Say so when you see a better path than the one asked for, then do what was asked unless redirected.",
  "- Organize what you report so the reader can find, without hunting, whichever of these apply: what you did, what you want reviewed, what you need from them, and anything notable you found along the way.",
  "- Cut the packaging, not the content: no preamble, no restating the request back, no recap of work the reader just watched, no closing offer of further help. Length should track what the reader does not already know — everything the rules above require you to say still gets said.",
];

/**
 * Appended only by subagent role prompts, never by the parent session.
 *
 * A headless child's final message is the entire deliverable — nobody watches
 * its transcript — so it must restate what the parent session can already see.
 * Kept out of the parent text, where it would be dead weight on every turn.
 */
/**
 * The pi-specific half, kept out of `ENGINEERING_POLICY` so the rules above
 * stay portable to other coding agents.
 *
 * This rule exists because the first rule grants something without
 * naming a destination: "writing your own report or output file is always in
 * scope" sends a model that takes it seriously straight into the user's repo.
 * The destination mirrors pi's own layout — `sessions/<flattened-cwd>/<id>` has
 * an `artifacts/<flattened-cwd>/<id>` sibling — but the rule never asks a model
 * to reproduce that flattening, because pi already hands it the flattened path
 * in `$PI_SESSION_FILE`. It names the root as well so an ephemeral session,
 * where that variable is unset, still has somewhere to go.
 *
 * The root spells the fallback `$HOME`, not `~`, and that is load-bearing. No
 * shell tilde-expands inside double quotes, so `"${PI_CODING_AGENT_DIR:-~/...}"`
 * yields a literal `~/...`; `mkdir -p` then creates a directory named `~` in the
 * working tree — precisely the failure this rule exists to prevent, reached by a
 * model quoting its paths correctly. Verified in bash, zsh, and sh.
 *
 */
export const PI_WORKSPACE_HEADER = "## Workspace";

export const PI_WORKSPACE_BULLETS = [
  "- Keep your own scratch out of the working tree: plans, notes, and intermediate reports belong under `${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}/artifacts/`, in a folder for this session — mirror `$PI_SESSION_FILE`'s location under `sessions/` when it is set. A file the user asked for is not scratch; write that where they asked.",
];

export const PI_WORKSPACE = [
  PI_WORKSPACE_HEADER,
  "",
  ...PI_WORKSPACE_BULLETS,
].join("\n");

export const ENGINEERING_POLICY_CHILD_NOTE =
  "When your output is the only thing your reader receives, it must still say what you did and what you found. If you found nothing, say so and name what you inspected — an empty or bare answer is not a result.";

export const ENGINEERING_POLICY = [
  ENGINEERING_POLICY_HEADER,
  "",
  ...ENGINEERING_POLICY_BULLETS,
].join("\n");

/** Both sections, in the order they are injected. */
export const PI_AGENT_RULES = [ENGINEERING_POLICY, PI_WORKSPACE].join("\n\n");

/** pi wraps `AGENTS.md` in this; the rules go in front of it. */
const PROJECT_CONTEXT_OPEN = "<project_context>";

/**
 * Add the rules to an assembled system prompt, at most once, ahead of the
 * project's own instructions.
 *
 * Placement is the point. These rules used to be appended to the very end,
 * after both pi's base prompt and `<project_context>`, which put them last by
 * recency — so a project's `AGENTS.md` was the thing being overridden rather
 * than the thing overriding. Sitting them in front restores the order you would
 * expect: harness prompt, then our rules, then whatever this project says,
 * which wins because it is nearest the task.
 *
 * Falls back to appending when there is no project context — an ephemeral
 * session, or a repo with no `AGENTS.md` — where there is nothing to sit in
 * front of and last is the only place left.
 *
 * `before_agent_start` fires on every user prompt and its results chain across
 * extensions, so a handler that added unconditionally could stack copies.
 *
 * Note the coupling: the header doubles as the dedupe key. Renaming it means a
 * session already running with the old header gets a second copy added.
 * Harmless across a restart, but rename deliberately.
 */
export function withAgentRules(systemPrompt: string) {
  if (systemPrompt.includes(ENGINEERING_POLICY_HEADER)) return systemPrompt;

  const at = systemPrompt.indexOf(PROJECT_CONTEXT_OPEN);
  if (at === -1) return `${systemPrompt.trimEnd()}\n\n${PI_AGENT_RULES}\n`;

  const before = systemPrompt.slice(0, at).trimEnd();
  const rest = systemPrompt.slice(at);
  return `${before}\n\n${PI_AGENT_RULES}\n\n${rest}`;
}
