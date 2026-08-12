import {
  CustomEditor,
  type KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import type { SlashCommandInfo } from "@earendil-works/pi-coding-agent";
import type {
  AutocompleteItem,
  AutocompleteProvider,
  EditorTheme,
  TUI,
} from "@earendil-works/pi-tui";

/**
 * Pi intentionally reserves natural slash triggering for the draft's start.
 * Re-submit Tab internally while an inline slash token is being typed; once the
 * menu opens, the ordinary Editor owns updates, navigation, and completion.
 */
export class InlineSlashEditor extends CustomEditor {
  constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) {
    super(tui, theme, keybindings);
  }

  override handleInput(data: string) {
    super.handleInput(data);
    if (this.isShowingAutocomplete() || !/^[a-zA-Z0-9:._\-/]$/.test(data)) {
      return;
    }
    const cursor = this.getCursor();
    if (inlinePrefixAtCursor(this.getLines(), cursor.line, cursor.col)) {
      // Editor has no public "open autocomplete" method. Feeding its normal Tab
      // input takes the same public path a user pressing Tab would take.
      super.handleInput("\t");
    }
  }
}

export function wrapInlineAutocomplete(
  current: AutocompleteProvider,
  getCommands: () => readonly SlashCommandInfo[],
): AutocompleteProvider {
  return {
    triggerCharacters: [
      ...new Set([...(current.triggerCharacters ?? []), "/"]),
    ],
    async getSuggestions(lines, cursorLine, cursorCol, options) {
      const context = prefixContextAtCursor(lines, cursorLine, cursorCol);
      if (context.kind === "code") return null;
      if (context.kind !== "inline") {
        return current.getSuggestions(lines, cursorLine, cursorCol, options);
      }
      const prefix = context.prefix;

      const commands = getCommands();
      const items: AutocompleteItem[] = [
        ...(commands.some(
          (command) =>
            command.source === "extension" && command.name === "goal",
        )
          ? [
              {
                value: "goal",
                label: "goal",
                description: "Make this whole prompt the persistent goal",
              },
            ]
          : []),
        ...commands
          .filter(
            (command) =>
              command.source === "skill" || command.source === "prompt",
          )
          .map((command) => ({
            value: command.name,
            label: command.name,
            description: command.description,
          })),
      ];
      const query = prefix.slice(1).toLowerCase();
      const matches = items
        .filter((item) => fuzzyIncludes(item.label.toLowerCase(), query))
        .sort(
          (left, right) => score(left.label, query) - score(right.label, query),
        );
      // Keep the slash outside the completion prefix. Pi submits a completion
      // immediately when its prefix starts with "/"; inline commands must let
      // Enter choose an item and return to editing instead.
      return matches.length > 0
        ? { items: matches, prefix: prefix.slice(1) }
        : current.getSuggestions(lines, cursorLine, cursorCol, options);
    },
    applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
      const commands = getCommands();
      const inlineValues = new Set([
        ...(commands.some(
          (command) =>
            command.source === "extension" && command.name === "goal",
        )
          ? ["goal"]
          : []),
        ...commands
          .filter(
            (command) =>
              command.source === "skill" || command.source === "prompt",
          )
          .map((command) => command.name),
      ]);
      const slashColumn = cursorCol - prefix.length - 1;
      const currentLine = lines[cursorLine] ?? "";
      if (
        prefix.startsWith("/") ||
        currentLine[slashColumn] !== "/" ||
        !inlineValues.has(item.value)
      ) {
        return current.applyCompletion(
          lines,
          cursorLine,
          cursorCol,
          item,
          prefix,
        );
      }

      const before = currentLine.slice(0, cursorCol - prefix.length);
      const afterCursor = currentLine.slice(cursorCol);
      // Completion owns the whole slash token, not only the text left of the
      // cursor. This makes editing an existing command behave like replacement.
      const after = afterCursor.replace(/^[^\s]*/, "");
      const suffix = after.length === 0 || !/^\s/.test(after) ? " " : "";
      const nextLines = [...lines];
      nextLines[cursorLine] = before + item.value + suffix + after;
      return {
        lines: nextLines,
        cursorLine,
        cursorCol: before.length + item.value.length + suffix.length,
      };
    },
    shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
      return (
        current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ??
        true
      );
    },
  };
}

/** A slash token after existing draft text, outside Markdown code. */
export function inlinePrefixAtCursor(
  lines: readonly string[],
  cursorLine: number,
  cursorCol: number,
) {
  const context = prefixContextAtCursor(lines, cursorLine, cursorCol);
  return context.kind === "inline" ? context.prefix : undefined;
}

function prefixContextAtCursor(
  lines: readonly string[],
  cursorLine: number,
  cursorCol: number,
): { kind: "other" } | { kind: "code" } | { kind: "inline"; prefix: string } {
  const currentLine = lines[cursorLine] ?? "";
  const beforeCursor = currentLine.slice(0, cursorCol);
  const match = beforeCursor.match(/(?:^|\s)(\/[^\s]*)$/);
  if (!match) return { kind: "other" };

  const prefix = match[1]!;
  const prefixColumn = cursorCol - prefix.length;
  const absoluteBefore = lines
    .slice(0, cursorLine)
    .reduce((length, line) => length + line.length + 1, 0);
  const absolutePrefix = absoluteBefore + prefixColumn;
  const draftBeforePrefix =
    lines.slice(0, cursorLine).join("\n") +
    (cursorLine > 0 ? "\n" : "") +
    currentLine.slice(0, prefixColumn);

  // The built-in provider owns the true beginning of the draft, where all
  // standalone commands remain available.
  if (draftBeforePrefix.trim().length === 0) return { kind: "other" };
  const throughCursor =
    lines.slice(0, cursorLine).join("\n") +
    (cursorLine > 0 ? "\n" : "") +
    beforeCursor;
  if (isInsideCode(throughCursor, absolutePrefix)) return { kind: "code" };
  return { kind: "inline", prefix };
}

function isInsideCode(text: string, offset: number) {
  const currentLineStart = text.lastIndexOf("\n", offset - 1) + 1;
  if (/^(?: {4}| {0,3}\t)/.test(text.slice(currentLineStart, offset)))
    return true;

  let delimiter:
    { character: "`" | "~"; length: number; fenced: boolean } | undefined;
  let lineHasContent = false;
  let lineStart = 0;
  for (let index = 0; index < offset;) {
    const character = text[index]!;
    if (character === "\n") {
      lineHasContent = false;
      lineStart = index + 1;
      index++;
      continue;
    }
    if (delimiter) {
      if (character === delimiter.character) {
        const length = runLength(text, index, character);
        const exactInlineCloser =
          !delimiter.fenced && length === delimiter.length;
        const validFenceCloser =
          delimiter.fenced &&
          length >= delimiter.length &&
          isFenceLine(text, lineStart, index, length);
        if (exactInlineCloser || validFenceCloser) delimiter = undefined;
        index += length;
      } else index++;
      continue;
    }
    if (
      index === lineStart &&
      /^(?: {4}| {0,3}\t)/.test(text.slice(lineStart))
    ) {
      const newline = text.indexOf("\n", lineStart);
      index = newline === -1 ? offset : Math.min(offset, newline);
      continue;
    }
    if (character === "`" && !isEscaped(text, index)) {
      const length = runLength(text, index, character);
      const fenced =
        length >= 3 && /^ {0,3}$/.test(text.slice(lineStart, index));
      delimiter = { character, length, fenced };
      lineHasContent = true;
      index += length;
      continue;
    }
    if (character === "~" && !lineHasContent) {
      const length = runLength(text, index, character);
      if (length >= 3) {
        delimiter = { character, length, fenced: true };
        lineHasContent = true;
        index += length;
        continue;
      }
    }
    if (!/\s/.test(character)) lineHasContent = true;
    index++;
  }
  return delimiter !== undefined;
}

function isEscaped(text: string, offset: number) {
  let backslashes = 0;
  for (let index = offset - 1; index >= 0 && text[index] === "\\"; index--) {
    backslashes++;
  }
  return backslashes % 2 === 1;
}

function isFenceLine(
  text: string,
  lineStart: number,
  delimiterStart: number,
  delimiterLength: number,
) {
  if (!/^ {0,3}$/.test(text.slice(lineStart, delimiterStart))) return false;
  const newline = text.indexOf("\n", delimiterStart + delimiterLength);
  const lineEnd = newline === -1 ? text.length : newline;
  return /^[ \t]*$/.test(text.slice(delimiterStart + delimiterLength, lineEnd));
}

function runLength(text: string, start: number, character: string) {
  let end = start;
  while (text[end] === character) end++;
  return end - start;
}

function fuzzyIncludes(value: string, query: string) {
  let queryIndex = 0;
  for (const character of value) {
    if (character === query[queryIndex]) queryIndex++;
    if (queryIndex === query.length) return true;
  }
  return query.length === 0;
}

function score(value: string, query: string) {
  if (value === query) return 0;
  if (value.startsWith(query)) return 1;
  if (value.includes(query)) return 2;
  return 3;
}
