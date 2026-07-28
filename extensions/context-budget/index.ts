/**
 * `/context-budget` — where this session's context window is actually going.
 *
 * pi reports total occupancy in the footer, which tells you that you are at 60%
 * but not what is holding it. This reads the running session's own structures —
 * the effective system prompt, the registered tool schemas with the package
 * that registered each, the loaded context files, the conversation so far — and
 * attributes the space.
 *
 * Everything here is a read. The command never mutates the session, and never
 * prints prompt text or file contents (see `src/report.ts`).
 *
 * One number is real and the rest are estimates: "context used" is the
 * provider's own count, carried by pi. The per-section figures are `chars / 4`,
 * because pi does not expose a tokenizer to extensions. They are good for
 * ranking contributors and should not be read as a bill.
 */

import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildReport,
  measureEntries,
  toolOwner,
  type BudgetInput,
  type ToolEntry,
} from "./src/report.ts";

/**
 * pi's own default when `compaction.reserveTokens` is unset.
 *
 * Duplicated rather than read, because the extension API exposes no compaction
 * settings. It is reported as "pi default" so a stale copy is visible as a
 * wrong label rather than a silently wrong number.
 */
const DEFAULT_RESERVE_TOKENS = 16_384;

function readCompactionFrom(path: string) {
  try {
    return JSON.parse(readFileSync(path, "utf8"))?.compaction as
      { reserveTokens?: unknown; enabled?: unknown } | undefined;
  } catch {
    return undefined;
  }
}

/**
 * The compaction settings actually in force.
 *
 * pi deep-merges `<cwd>/.pi/settings.json` over the agent-wide file, so a
 * project that sets its own reserve gets a different compaction line — and
 * reading only the global file would report headroom against the wrong one.
 */
function readCompactionSettings(cwd: string) {
  const global = readCompactionFrom(join(getAgentDir(), "settings.json"));
  const project = readCompactionFrom(join(cwd, ".pi", "settings.json"));
  const reserve = project?.reserveTokens ?? global?.reserveTokens;
  const enabled = project?.enabled ?? global?.enabled;
  return {
    reserveTokens:
      typeof reserve === "number" ? reserve : DEFAULT_RESERVE_TOKENS,
    reserveIsDefault: typeof reserve !== "number",
    compactionEnabled: enabled !== false,
  };
}

function collect(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  promptIsComplete: boolean,
): BudgetInput {
  const usage = ctx.getContextUsage();
  const options = ctx.getSystemPromptOptions();
  const compaction = readCompactionSettings(ctx.cwd);

  const active = new Set(pi.getActiveTools());
  const tools: ToolEntry[] = pi.getAllTools().map((tool) => ({
    name: tool.name,
    description: tool.description ?? "",
    parameters: tool.parameters,
    source: toolOwner(tool.sourceInfo),
    active: active.has(tool.name),
  }));

  // `buildContextEntries()`, not `getBranch()`. The branch is the raw tree
  // path, so after a compaction it still carries the messages the summary
  // replaced and would report history that is no longer sent — in a command
  // whose entire job is explaining what is sent. This list is the
  // compaction-aware one: superseded entries dropped, summary kept.
  const messages = measureEntries(ctx.sessionManager.buildContextEntries());

  return {
    model: ctx.model?.id ?? "no-model",
    provider: ctx.model?.provider ?? "?",
    thinking: ctx.model?.reasoning ? pi.getThinkingLevel() : "off",
    tokens: usage?.tokens ?? null,
    contextWindow: usage?.contextWindow ?? ctx.model?.contextWindow ?? 0,
    percent: usage?.percent ?? null,
    maxTokens: ctx.model?.maxTokens ?? null,
    ...compaction,
    systemPrompt: ctx.getSystemPrompt(),
    promptIsComplete,
    tools,
    contextFiles: options.contextFiles ?? [],
    skills: options.skills ?? [],
    messages,
  };
}

export default function contextBudget(pi: ExtensionAPI) {
  /**
   * Whether this process has assembled a prompt for a turn yet.
   *
   * Until it has, `getSystemPrompt()` has not been through
   * `before_agent_start` and is missing whatever extensions append to it —
   * 3.2 KB of engineering policy on this setup, 13% of the prompt.
   *
   * It has to be observed rather than inferred from the transcript: a resumed
   * session is full of assistant messages from a previous process that assembled
   * nothing here, so "there are replies" would report the short prompt as final.
   *
   * The wire payload would be exact, but `before_provider_request` never fires
   * for `openai-codex` (measured), so anything depending on it would be blank
   * on this setup's own default model.
   */
  let promptIsComplete = false;
  pi.on("before_agent_start", () => {
    promptIsComplete = true;
  });

  pi.registerCommand("context-budget", {
    description: "Show what is using this session's context window",
    handler: async (_args, ctx) => {
      const report = buildReport(collect(pi, ctx, promptIsComplete));
      // Notifications are a TUI surface and are dropped elsewhere, so `pi
      // --print` would silently produce nothing. `json` and `rpc` are left
      // alone deliberately: their stdout is a protocol, not a place for prose.
      if (ctx.mode === "print") console.log(report);
      else ctx.ui.notify(report, "info");
    },
  });
}
