/**
 * Build the `/context-budget` report from what pi exposes at runtime.
 *
 * Pure: everything comes in as plain data so the whole report is testable
 * without a session. `index.ts` does the gathering, this does the arithmetic
 * and the layout.
 *
 * **This never emits prompt text, context-file contents, or tool descriptions.**
 * That is the point of the file, not an incidental property: the material it
 * measures is routinely private project instructions, and a budget report is
 * something you paste into a chat when asking why the window is full. Names,
 * paths, headings, counts and sizes only — enforced by a test.
 */

import {
  byteLength,
  CHARS_PER_TOKEN,
  estimateTokens,
  formatBytes,
  splitSections,
} from "../../shared/prompt-sections.ts";

/** A tool as pi reports it, reduced to what costs prompt space. */
export interface ToolEntry {
  readonly name: string;
  readonly description: string;
  readonly parameters: unknown;
  /** Who to blame, from `toolOwner` below. */
  readonly source: string;
  /**
   * Whether the tool is enabled for this session. A disabled tool's schema is
   * not sent, so counting it inflates both the total and the extension that
   * registered it — and the inflation is invisible, because the report would
   * still look internally consistent.
   */
  readonly active: boolean;
}

/**
 * Which extension a tool came from, as something a person can act on.
 *
 * `sourceInfo.source` is not the answer: it holds how the tool was *discovered*
 * — "builtin" or "auto" — so grouping on it collapses every extension in the
 * agent directory into one row and reports 25 tools as "built-in". The
 * directory name in `path` is the part that names a thing you can turn off.
 */
export function toolOwner(
  // Mirrors pi's `SourceInfo` without importing it, so this file stays pure
  // and testable with plain fixtures.
  info:
    | {
        path?: string;
        source?: string;
        origin?: string;
        scope?: string;
        baseDir?: string;
      }
    | undefined,
): string {
  const path = info?.path ?? "";
  if (info?.source === "builtin" || path.startsWith("<builtin:")) {
    return "built-in";
  }
  // A tool from an installed package is named by its package.
  if (info?.origin === "package" && info.source && info.source !== "auto") {
    return info.source;
  }
  const inExtensions = /(?:^|\/)extensions\/([^/]+)\//.exec(path);
  if (inExtensions) return inExtensions[1]!;
  const parent = /([^/]+)\/[^/]*$/.exec(path);
  return parent?.[1] ?? info?.source ?? "unknown";
}

export interface ContextFileEntry {
  readonly path: string;
  readonly content: string;
}

export interface BudgetInput {
  readonly model: string;
  readonly provider: string;
  readonly thinking: string;
  /** Live occupancy. `tokens` is null right after compaction, before the next response. */
  readonly tokens: number | null;
  readonly contextWindow: number;
  readonly percent: number | null;
  readonly maxTokens: number | null;
  /** Compaction reserve, and whether it came from settings or pi's default. */
  readonly reserveTokens: number;
  readonly reserveIsDefault: boolean;
  readonly compactionEnabled: boolean;
  readonly systemPrompt: string;
  /**
   * Whether the prompt has been assembled for a real turn yet. Until it has,
   * anything extensions append is missing from it. Reported, because the two
   * differ by kilobytes and the reader cannot tell which they are looking at.
   */
  readonly promptIsComplete: boolean;
  readonly tools: ReadonlyArray<ToolEntry>;
  readonly contextFiles: ReadonlyArray<ContextFileEntry>;
  readonly skills: ReadonlyArray<{ readonly name: string }>;
  /** Conversation messages, already reduced to a role and a character count. */
  readonly messages: ReadonlyArray<{
    readonly role: string;
    readonly chars: number;
  }>;
}

/** A tool's real prompt cost is its whole schema, not its name. */
export function toolBytes(tool: ToolEntry) {
  return byteLength(
    JSON.stringify({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }),
  );
}

/**
 * Tools grouped by what registered them, largest first.
 *
 * Grouping by source rather than listing 22 tools is the difference between
 * "the prompt is big" and "this extension costs 6 KB" — the second is
 * actionable, because an extension can be turned off.
 */
export function toolsBySource(tools: ReadonlyArray<ToolEntry>) {
  const groups = new Map<string, { bytes: number; names: string[] }>();
  for (const tool of tools) {
    const group = groups.get(tool.source) ?? { bytes: 0, names: [] };
    group.bytes += toolBytes(tool);
    group.names.push(tool.name);
    groups.set(tool.source, group);
  }
  return [...groups.entries()]
    .map(([source, group]) => ({
      source,
      bytes: group.bytes,
      count: group.names.length,
    }))
    .sort((a, b) => b.bytes - a.bytes);
}

/** A session entry, as loosely as this file needs to read one. */
export interface ContextEntry {
  readonly type: string;
  readonly message?: { role?: unknown; content?: unknown };
  readonly summary?: unknown;
  readonly retainedTail?: unknown;
}

function textLength(value: unknown) {
  return typeof value === "string" ? value.length : 0;
}

function messageChars(message: { role?: unknown; content?: unknown }) {
  // Not every message in pi's union carries `content` — a bash execution entry
  // does not — so measure the whole message when it does not.
  const measured = "content" in message ? message.content : message;
  return JSON.stringify(measured ?? "").length;
}

/**
 * Reduce the entries pi will actually send to roles and sizes.
 *
 * Compactions and branch summaries are not messages, but pi converts them into
 * ones: a summary, plus any retained tail. Counting only `type === "message"`
 * reports a freshly compacted session as having almost no history, when the
 * summary is usually the largest single thing in it.
 */
export function measureEntries(
  entries: ReadonlyArray<ContextEntry>,
): Array<{ role: string; chars: number }> {
  return entries.flatMap((entry) => {
    if (entry.type === "message" && entry.message) {
      return [
        {
          role: String(entry.message.role ?? "unknown"),
          chars: messageChars(entry.message),
        },
      ];
    }
    if (entry.type === "compaction") {
      const tail = Array.isArray(entry.retainedTail) ? entry.retainedTail : [];
      return [
        { role: "summary", chars: textLength(entry.summary) },
        ...tail.map((message: unknown) => {
          const shape = (message ?? {}) as {
            role?: unknown;
            content?: unknown;
          };
          return {
            role: String(shape.role ?? "unknown"),
            chars: messageChars(shape),
          };
        }),
      ];
    }
    if (entry.type === "branch_summary") {
      return [{ role: "summary", chars: textLength(entry.summary) }];
    }
    return [];
  });
}

export function messagesByRole(
  messages: BudgetInput["messages"],
): Array<{ role: string; count: number; chars: number }> {
  const roles = new Map<string, { count: number; chars: number }>();
  for (const message of messages) {
    const seen = roles.get(message.role) ?? { count: 0, chars: 0 };
    seen.count += 1;
    seen.chars += message.chars;
    roles.set(message.role, seen);
  }
  return [...roles.entries()]
    .map(([role, seen]) => ({ role, ...seen }))
    .sort((a, b) => b.chars - a.chars);
}

/**
 * Tokens that may still be spent before auto-compaction triggers.
 *
 * pi compacts when `tokens > contextWindow - reserveTokens`, so the headroom is
 * measured against that line and not against the window. Null when occupancy is
 * unknown or compaction is off, because a number there would be a guess.
 */
export function headroom(input: BudgetInput) {
  if (!input.compactionEnabled || input.tokens === null) return null;
  return input.contextWindow - input.reserveTokens - input.tokens;
}

function pad(value: string, width: number) {
  return value.length >= width
    ? value
    : " ".repeat(width - value.length) + value;
}

function row(label: string, value: string) {
  return `  ${label.padEnd(22)}${value}`;
}

function bar(value: number, max: number, width = 18) {
  if (max <= 0) return "";
  const filled = Math.max(1, Math.round((value / max) * width));
  return "█".repeat(Math.min(width, filled));
}

function sizedRows(
  entries: ReadonlyArray<{ label: string; bytes: number }>,
  limit: number,
) {
  const shown = entries.slice(0, limit);
  const max = Math.max(1, ...shown.map((entry) => entry.bytes));
  const lines = shown.map(
    (entry) =>
      `  ${pad(formatBytes(entry.bytes), 8)}  ${bar(entry.bytes, max).padEnd(18)}  ${entry.label}`,
  );
  if (entries.length > shown.length) {
    const rest = entries
      .slice(limit)
      .reduce((total, entry) => total + entry.bytes, 0);
    // Say what was dropped. A truncated list with no note reads as the whole
    // list, and the tail is exactly where unnoticed growth accumulates.
    lines.push(
      `  ${pad(formatBytes(rest), 8)}  ${" ".repeat(18)}  … and ${entries.length - shown.length} more`,
    );
  }
  return lines;
}

export function buildReport(input: BudgetInput, limit = 8): string {
  const sections = splitSections(input.systemPrompt);
  const promptBytes = byteLength(input.systemPrompt);
  // Only enabled tools are serialized into the request, so only those are a
  // cost. Disabled ones are counted separately rather than dropped silently.
  const sentTools = input.tools.filter((tool) => tool.active);
  const toolGroups = toolsBySource(sentTools);
  const toolTotal = sentTools.reduce((sum, tool) => sum + toolBytes(tool), 0);
  const disabled = input.tools.length - sentTools.length;
  const contextTotal = input.contextFiles.reduce(
    (sum, file) => sum + byteLength(file.content),
    0,
  );
  const left = headroom(input);
  const lines: string[] = [];

  lines.push(`${input.provider}/${input.model} · thinking ${input.thinking}`);
  lines.push("");

  lines.push("Conversation");
  lines.push(
    row(
      "context used",
      input.tokens === null
        ? `unknown of ${input.contextWindow.toLocaleString()} (just compacted)`
        : `${input.tokens.toLocaleString()} of ${input.contextWindow.toLocaleString()} tokens` +
            (input.percent === null ? "" : ` (${Math.round(input.percent)}%)`),
    ),
  );
  lines.push(
    row(
      "until compaction",
      !input.compactionEnabled
        ? "auto-compaction off"
        : left === null
          ? "unknown"
          : `~${left.toLocaleString()} tokens` +
            ` (reserve ${input.reserveTokens.toLocaleString()}${input.reserveIsDefault ? ", pi default" : ", from settings"})`,
    ),
  );
  if (input.maxTokens !== null) {
    lines.push(row("max output", `${input.maxTokens.toLocaleString()} tokens`));
  }
  const byRole = messagesByRole(input.messages);
  if (byRole.length > 0) {
    lines.push(
      row(
        "history",
        byRole
          .map(
            (entry) =>
              `${entry.count} ${entry.role} (~${Math.ceil(entry.chars / CHARS_PER_TOKEN).toLocaleString()} tok)`,
          )
          .join(", "),
      ),
    );
  }
  lines.push("");

  lines.push(
    `System prompt — ${formatBytes(promptBytes)}, ~${estimateTokens(input.systemPrompt).toLocaleString()} tokens` +
      (input.promptIsComplete
        ? ""
        : " (before extensions append — send a turn for the real figure)"),
  );
  lines.push(
    ...sizedRows(
      sections
        .map((section) => ({ label: section.heading, bytes: section.bytes }))
        .sort((a, b) => b.bytes - a.bytes),
      limit,
    ),
  );
  lines.push("");

  lines.push(
    `Tool schemas — ${formatBytes(toolTotal)} across ${sentTools.length} enabled tools` +
      (disabled === 0 ? "" : ` (${disabled} disabled, not counted)`),
  );
  lines.push(
    ...sizedRows(
      toolGroups.map((group) => ({
        label: `${group.source} (${group.count})`,
        bytes: group.bytes,
      })),
      limit,
    ),
  );
  lines.push("");

  if (input.contextFiles.length > 0) {
    lines.push(`Context files — ${formatBytes(contextTotal)}`);
    lines.push(
      ...sizedRows(
        input.contextFiles
          .map((file) => ({
            label: file.path,
            bytes: byteLength(file.content),
          }))
          .sort((a, b) => b.bytes - a.bytes),
        limit,
      ),
    );
    lines.push("");
  }

  lines.push(
    `Skills — ${input.skills.length} advertised, bodies loaded on demand`,
  );
  lines.push("");
  lines.push(
    `Sizes are bytes; token figures are characters ÷ ${CHARS_PER_TOKEN}, except` +
      ` "context used", which is the provider's own count.`,
  );

  return lines.join("\n");
}
