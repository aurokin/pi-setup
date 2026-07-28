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
import {
  DEFAULT_COMPACTION_SETTINGS,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import {
  buildReport,
  measureEntries,
  toolOwner,
  type BudgetInput,
  type ToolEntry,
} from "./src/report.ts";

/**
 * The compaction settings actually in force.
 *
 * Read through `SettingsManager` rather than by parsing the JSON, so the
 * global/project merge *and* the project-trust rules are pi's own. Reading
 * `<cwd>/.pi/settings.json` directly would report headroom against a reserve pi
 * is ignoring, in any repo the user has not trusted.
 */
function readCompactionSettings(ctx: ExtensionCommandContext) {
  // `CompactionSettings` types every field optional, so pi's own default table
  // needs a floor before it can stand in for a number.
  const defaultReserve = DEFAULT_COMPACTION_SETTINGS.reserveTokens ?? 0;
  try {
    const settings = SettingsManager.create(ctx.cwd, undefined, {
      projectTrusted: ctx.isProjectTrusted(),
    }).getCompactionSettings();
    return {
      reserveTokens: settings.reserveTokens,
      // Equality, not provenance — pi's resolver reports a number, not whether
      // it came from a file. A reserve set to exactly the default is labelled
      // as the default, which is the same figure either way.
      reserveIsDefault: settings.reserveTokens === defaultReserve,
      compactionEnabled: settings.enabled,
    };
  } catch {
    // Unreadable settings are pi's problem to report. A budget report that
    // throws is worse than one that states the defaults.
    return {
      reserveTokens: defaultReserve,
      reserveIsDefault: true,
      compactionEnabled: true,
    };
  }
}

function collect(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  promptIsComplete: boolean,
): BudgetInput {
  const usage = ctx.getContextUsage();
  const options = ctx.getSystemPromptOptions();
  const compaction = readCompactionSettings(ctx);

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
