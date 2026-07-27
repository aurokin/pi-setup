/**
 * All model-facing strings for the subagents tools.
 *
 * Anything that lists harnesses is built from the offered set rather than
 * written out: the `harness` enum already comes from config, so a hardcoded
 * list beside it describes a different tool than the one the model can call.
 */

import type { HarnessName } from "./harnesses.ts";
import { MAX_RUNNING } from "./manager.ts";

/** One clause per harness, for the enum's own documentation. */
const HARNESS_BLURBS: Record<HarnessName, string> = {
  pi: "pi (in-process pi session, inherits this environment's tools and config)",
  claude: "claude (Claude Code)",
  codex: "codex (Codex CLI)",
  droid:
    "droid (Factory, billed to the Factory subscription — only when asked for by name)",
  cursor:
    "cursor (Cursor, billed to the Cursor subscription — only when asked for by name; its read-only role is weaker than the others')",
};

/**
 * Harnesses the model may not choose on task fit alone.
 *
 * Both spend a subscription bought for something else, and neither reaches a
 * model pi cannot. "Suits the task" is a real reason to pick claude or codex;
 * for these it is only a reason to suggest one to the user.
 */
const NAMED_ONLY: ReadonlySet<HarnessName> = new Set<HarnessName>([
  "droid",
  "cursor",
]);

/** "a, b, or c" — the Oxford comma matters here, these are read as a list. */
export function inSentence(items: ReadonlyArray<string>) {
  if (items.length === 0) return "none";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} or ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, or ${items[items.length - 1]}`;
}

function blurbs(offered: ReadonlyArray<HarnessName>) {
  return inSentence(offered.map((name) => HARNESS_BLURBS[name]));
}

/** Describes subagent_spawn, including harnesses and the fixed concurrency cap. */
export function subagentSpawnToolDescription(
  offered: ReadonlyArray<HarnessName>,
) {
  return `Spawn a background subagent: a fully autonomous, headless agent with its own context window and the selected harness's normal host permissions. You choose the harness it runs on: ${blurbs(offered)}. Fire-and-forget: this returns immediately with an id. The subagent's final output is queued back to you as a message when it settles, or collect it explicitly with subagent_wait. Children cannot orchestrate more agents/workflows or ask the user, and cannot see this conversation, so the prompt must be self-contained. Only use trusted working directories. Max ${MAX_RUNNING} subagents can be running at once across all harnesses.`;
}

/** Adds background subagent delegation to the parent model's available-tools prompt. */
export function subagentSpawnPromptSnippet(
  offered: ReadonlyArray<HarnessName>,
) {
  return `Spawn a background subagent on a chosen harness (${inSentence(offered)}; own context, normal tools) for a self-contained task`;
}

/** Guides the parent model to delegate standalone tasks and avoid unnecessary blocking waits. */
export function subagentSpawnPromptGuidelines(
  offered: ReadonlyArray<HarnessName>,
) {
  const alternatives = offered.filter((name) => name !== "pi");
  const onFit = alternatives.filter((name) => !NAMED_ONLY.has(name));
  const onRequest = alternatives.filter((name) => NAMED_ONLY.has(name));
  return [
    "Use subagent_spawn to delegate self-contained tasks that can run in the background; give it a complete, standalone prompt.",
    onFit.length
      ? `Pick the subagent harness deliberately: pi unless you have a reason to prefer ${inSentence(onFit)} (e.g. the user asked for one, or the task suits that harness).`
      : "Subagents run on pi, in-process, inheriting this environment's tools and config.",
    // Kept as its own line: folding it into the sentence above turns an
    // absolute rule into one more consideration to weigh.
    ...(onRequest.length
      ? [
          `${inSentence(onRequest)} ${onRequest.length === 1 ? "is" : "are"} billed to a separate subscription and reach no model pi cannot. Use ${onRequest.length === 1 ? "it" : "them"} only when the user names ${onRequest.length === 1 ? "it" : "one"}; suggest, do not select.`,
        ]
      : []),
    "Give a subagent the least role its task needs: reader unless it genuinely has to change something. Only worker can edit files or run commands.",
    "For advisor and rubber-duck, prefer a harness whose model family differs from this session's — a second opinion from the same family is worth less.",
    "After subagent_spawn, keep working; results arrive automatically. Only call subagent_wait when you cannot proceed without the result.",
  ];
}

/** Model-facing description of the `harness` enum, matching the offered set. */
export function subagentHarnessParameterDescription(
  offered: ReadonlyArray<HarnessName>,
) {
  return `Harness to run the subagent on: ${blurbs(offered)}. Independent of the role — every role runs on every harness. Choose deliberately per task.`;
}

/** Model-facing schema descriptions for subagent_spawn task and execution options. */
export const SUBAGENT_SPAWN_PARAMETER_DESCRIPTIONS = {
  prompt:
    "Task prompt for the subagent. Must be self-contained: include all needed context, file paths, and what to report back.",
  name: "Short human-readable name for this subagent, shown in listings and the UI",
  role: 'What the subagent may do. "reader": read-only investigation of any kind — exploration, review, planning; it cannot edit files or run commands, so your prompt supplies the framing. "worker": the only role that can edit files and run commands. "advisor": a read-only second opinion on risks, assumptions, and the next action. "rubber-duck": read-only, and questions the approach rather than solving it. Pick reader unless the task genuinely needs to change something.',
  workingDir:
    "Trusted working directory for the autonomous child (default: current working directory)",
  model:
    'Model hint, interpreted by the chosen harness (pi: "provider/model-id" or model id; claude: model alias like "sonnet"/"opus"; codex: model slug). Omit for the harness default (pi inherits the current model).',
  reasoningEffort:
    "Reasoning effort on a shared scale; the harness maps it to its nearest native equivalent (pi thinking level, codex reasoning effort, claude thinking budget). Omit for the harness default (pi inherits the current level).",
};

/** Builds the subagent_spawn result that tells the parent model how to continue or inspect the child. */
export function buildSubagentSpawnResult(options: {
  id: string;
  title: string;
  harness: string;
  modelLabel: string;
  cwd: string;
}) {
  return (
    `Spawned subagent ${options.id} "${options.title}" (${options.harness}: ${options.modelLabel}, ${options.cwd}).\n` +
    `It runs in the background. Its result will be delivered to you when it finishes, ` +
    `or use subagent_wait(ids: ["${options.id}"]) to block for it, subagent_cancel to stop it, subagent_check to peek, subagent_list to see all.`
  );
}

/** Describes explicit blocking collection of one or more subagent results. */
export const SUBAGENT_WAIT_TOOL_DESCRIPTION =
  "Block until all listed subagents have settled, then return their final outputs. Prefer letting results arrive automatically; use this only when you need a result before continuing.";

/** Model-facing schema description for the subagent ids to await. */
export const SUBAGENT_WAIT_PARAMETER_DESCRIPTIONS = {
  ids: 'Subagent ids to wait for, e.g. ["sa-1", "sa-2"]',
};

/** Describes aborting running subagents while retaining their partial transcripts. */
export const SUBAGENT_CANCEL_TOOL_DESCRIPTION =
  "Cancel one or more running subagents. This aborts their active work but preserves their partial session transcripts on disk.";

/** Model-facing schema description for the subagent ids to cancel. */
export const SUBAGENT_CANCEL_PARAMETER_DESCRIPTIONS = {
  ids: 'Subagent ids to cancel, e.g. ["sa-1", "sa-2"]',
};

/** Describes nonblocking inspection of a subagent without consuming its result. */
export const SUBAGENT_CHECK_TOOL_DESCRIPTION =
  "Peek at a subagent's status and recent activity without blocking. Does not consume its result.";

/** Model-facing schema description for the subagent id to inspect. */
export const SUBAGENT_CHECK_PARAMETER_DESCRIPTIONS = {
  id: "Subagent id",
};

/** Describes listing all tracked running and settled subagents. */
export const SUBAGENT_LIST_TOOL_DESCRIPTION =
  "List all subagents (running and finished) with their harness and status.";

/** Builds the child completion/failure wrapper injected into the parent model's context. */
export function buildSubagentResultMessage(options: {
  id: string;
  title: string;
  status: "running" | "done" | "error";
  errorText?: string;
  output: string;
}) {
  const verb = options.status === "error" ? "failed" : "finished";
  let text = `Subagent ${options.id} "${options.title}" ${verb}.`;
  if (options.errorText) text += `\nError: ${options.errorText}`;
  text += `\n\n${options.output}`;
  return text;
}
