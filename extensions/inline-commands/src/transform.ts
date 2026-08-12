import { dirname } from "node:path";
import {
  stripFrontmatter,
  type SlashCommandInfo,
} from "@earendil-works/pi-coding-agent";

interface SlashToken {
  readonly value: string;
  readonly start: number;
  readonly end: number;
}

interface Replacement {
  readonly start: number;
  readonly end: number;
  readonly value: string;
}

export interface InlineCatalog {
  readonly skills: ReadonlyMap<string, SlashCommandInfo>;
  readonly templates: ReadonlyMap<string, SlashCommandInfo>;
}

export interface PreparedInlineText {
  /** Template-expanded prompt with inline /goal markers removed. */
  readonly text: string;
  /** Template-expanded prompt with /goal left literal if goal handling fails. */
  readonly textWithGoal: string;
  /** Effective objective after templates, but before large skill bodies. */
  readonly goalText?: string;
  readonly skills: readonly SlashCommandInfo[];
  readonly skillReferenceCount: number;
  readonly templateExpanded: boolean;
  readonly errors: readonly string[];
  readonly changed: boolean;
}

export type ReadResource = (path: string) => string;

export function buildCatalog(
  commands: readonly SlashCommandInfo[],
): InlineCatalog {
  const skills = new Map<string, SlashCommandInfo>();
  const templates = new Map<string, SlashCommandInfo>();
  for (const command of commands) {
    const token = `/${command.name}`;
    if (command.source === "skill") skills.set(token, command);
    else if (command.source === "prompt") templates.set(token, command);
  }
  return { skills, templates };
}

/**
 * Expand compositional slash commands from one user-authored prompt.
 *
 * A prompt template at the start of a non-code line owns the rest of that line
 * as arguments. Elsewhere, an exact template token expands with no arguments.
 * Skill tokens stay visible in the request and their bodies are injected later.
 */
export function prepareInlineText(
  source: string,
  catalog: InlineCatalog,
  readResource: ReadResource,
): PreparedInlineText {
  const tokens = scanSlashTokens(source);
  const errors: string[] = [];
  const templateReplacements: Replacement[] = [];
  const templateOwnedRanges: Array<{ start: number; end: number }> = [];

  for (const token of tokens) {
    const template = catalog.templates.get(token.value);
    if (!template) continue;

    const { start: lineStart, end: lineEnd } = lineBounds(source, token.start);
    const ownsLine = source.slice(lineStart, token.start).trim().length === 0;
    const range = ownsLine
      ? { start: lineStart, end: lineEnd }
      : { start: token.start, end: token.end };
    if (templateOwnedRanges.some((owned) => overlaps(range, owned))) continue;
    // A recognized template owns its argument line even if its file cannot be
    // read. Failure leaves that entire invocation inert rather than promoting
    // slash-looking arguments into independent directives.
    templateOwnedRanges.push(range);

    try {
      const content = stripFrontmatter(readResource(template.sourceInfo.path));
      const args = ownsLine
        ? parseCommandArgs(source.slice(token.end, lineEnd).trim())
        : [];
      templateReplacements.push({
        ...range,
        value: substituteTemplateArgs(content, args).trim(),
      });
    } catch (error) {
      errors.push(
        `Could not expand ${token.value}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const isOwnedByTemplate = (token: SlashToken) =>
    templateOwnedRanges.some(
      (range) => token.start >= range.start && token.end <= range.end,
    );

  const skillCommands: SlashCommandInfo[] = [];
  let skillReferenceCount = 0;
  const seenSkills = new Set<string>();
  const goalTokens: SlashToken[] = [];
  for (const token of tokens) {
    if (isOwnedByTemplate(token)) continue;
    const skill = catalog.skills.get(token.value);
    if (skill) {
      skillReferenceCount++;
      if (!seenSkills.has(skill.name)) {
        seenSkills.add(skill.name);
        skillCommands.push(skill);
      }
    }
    if (token.value === "/goal") goalTokens.push(token);
  }

  const goalReplacements = goalTokens.map((token) =>
    goalRemoval(source, token),
  );
  const textWithGoal = applyReplacements(source, templateReplacements).trim();
  const text = applyReplacements(source, [
    ...templateReplacements,
    ...goalReplacements,
  ]).trim();
  const goalText = goalTokens.length > 0 ? text : undefined;

  return {
    text,
    textWithGoal,
    goalText,
    skills: skillCommands,
    skillReferenceCount,
    templateExpanded: templateReplacements.length > 0,
    errors,
    changed:
      templateReplacements.length > 0 ||
      goalReplacements.length > 0 ||
      skillCommands.length > 0,
  };
}

export interface LoadedSkill {
  readonly name: string;
  readonly filePath: string;
  readonly baseDir: string;
  readonly body: string;
}

export function loadSkills(
  commands: readonly SlashCommandInfo[],
  readResource: ReadResource,
): { skills: LoadedSkill[]; errors: string[] } {
  const skills: LoadedSkill[] = [];
  const errors: string[] = [];
  for (const command of commands) {
    try {
      const filePath = command.sourceInfo.path;
      skills.push({
        name: command.name.slice("skill:".length),
        filePath,
        // Skill references resolve beside SKILL.md. sourceInfo.baseDir is the
        // discovery/provenance root and may be one or more directories above it.
        baseDir: dirname(filePath),
        body: stripFrontmatter(readResource(filePath)).trim(),
      });
    } catch (error) {
      errors.push(
        `Could not load /${command.name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return { skills, errors };
}

/** Keep Pi's existing collapsible skill rendering for one or many skills. */
export function renderSkillInvocation(
  skills: readonly LoadedSkill[],
  userText: string,
) {
  if (skills.length === 0) return userText;
  if (skills.length === 1) {
    const skill = skills[0]!;
    return `${openSkill(skill.name, skill.filePath)}\nReferences are relative to ${skill.baseDir}.\n\n${skill.body}\n</skill>\n\n${userText}`;
  }

  const names = skills.map((skill) => skill.name).join(" + ");
  const sections = skills
    .map(
      (skill) =>
        `<skill-section name="${escapeAttribute(skill.name)}" location="${escapeAttribute(skill.filePath)}">\n` +
        `References are relative to ${skill.baseDir}.\n\n${skill.body}\n</skill-section>`,
    )
    .join("\n\n");
  return `${openSkill(names, "multiple skills")}\nThis invocation combines multiple skills. Follow every skill section that applies.\n\n${sections}\n</skill>\n\n${userText}`;
}

function openSkill(name: string, location: string) {
  return `<skill name="${escapeAttribute(name)}" location="${escapeAttribute(location)}">`;
}

function escapeAttribute(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function parseCommandArgs(value: string) {
  const args: string[] = [];
  let current = "";
  let started = false;
  let quote: "'" | '"' | undefined;
  for (const character of value) {
    if (quote) {
      if (character === quote) quote = undefined;
      else current += character;
    } else if (character === "'" || character === '"') {
      quote = character;
      started = true;
    } else if (/\s/.test(character)) {
      if (started) {
        args.push(current);
        current = "";
        started = false;
      }
    } else {
      current += character;
      started = true;
    }
  }
  if (started) args.push(current);
  return args;
}

export function substituteTemplateArgs(
  content: string,
  args: readonly string[],
) {
  const allArgs = args.join(" ");
  return content.replace(
    /\$\{(\d+|ARGUMENTS|@):-([^}]*)\}|\$\{@:(\d+)(?::(\d+))?\}|\$(ARGUMENTS|@|\d+)/g,
    (_match, defaultTarget, defaultValue, sliceStart, sliceLength, simple) => {
      if (defaultTarget) {
        const value =
          defaultTarget === "@" || defaultTarget === "ARGUMENTS"
            ? allArgs
            : args[Number.parseInt(defaultTarget, 10) - 1];
        return value || defaultValue;
      }
      if (sliceStart) {
        const start = Math.max(0, Number.parseInt(sliceStart, 10) - 1);
        const selected = sliceLength
          ? args.slice(start, start + Number.parseInt(sliceLength, 10))
          : args.slice(start);
        return selected.join(" ");
      }
      if (simple === "ARGUMENTS" || simple === "@") return allArgs;
      return args[Number.parseInt(simple, 10) - 1] ?? "";
    },
  );
}

function scanSlashTokens(text: string) {
  const tokens: SlashToken[] = [];
  let codeDelimiter:
    { character: "`" | "~"; length: number; fenced: boolean } | undefined;
  let lineHasContent = false;
  let lineStart = 0;

  for (let index = 0; index < text.length;) {
    const character = text[index]!;
    if (character === "\n") {
      lineHasContent = false;
      lineStart = index + 1;
      index++;
      continue;
    }

    if (codeDelimiter) {
      if (character === codeDelimiter.character) {
        const length = runLength(text, index, character);
        const exactInlineCloser =
          !codeDelimiter.fenced && length === codeDelimiter.length;
        const validFenceCloser =
          codeDelimiter.fenced &&
          length >= codeDelimiter.length &&
          isFenceLine(text, lineStart, index, length);
        if (exactInlineCloser || validFenceCloser) codeDelimiter = undefined;
        index += length;
      } else {
        index++;
      }
      continue;
    }

    // Four-space and tab-indented Markdown code is code even without fences.
    if (
      index === lineStart &&
      /^(?: {4}| {0,3}\t)/.test(text.slice(lineStart))
    ) {
      const newline = text.indexOf("\n", lineStart);
      index = newline === -1 ? text.length : newline;
      continue;
    }

    if (character === "`" && !isEscaped(text, index)) {
      const length = runLength(text, index, character);
      const fenced =
        length >= 3 && /^ {0,3}$/.test(text.slice(lineStart, index));
      codeDelimiter = { character, length, fenced };
      lineHasContent = true;
      index += length;
      continue;
    }
    if (character === "~" && !lineHasContent) {
      const length = runLength(text, index, character);
      if (length >= 3) {
        codeDelimiter = { character, length, fenced: true };
        lineHasContent = true;
        index += length;
        continue;
      }
    }

    if (!/\s/.test(character)) lineHasContent = true;
    const boundary = index === 0 || /\s/.test(text[index - 1]!);
    if (character === "/" && boundary) {
      let end = index + 1;
      while (end < text.length && !/\s/.test(text[end]!)) end++;
      tokens.push({ value: text.slice(index, end), start: index, end });
      index = end;
      continue;
    }
    index++;
  }
  return tokens;
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

function lineBounds(text: string, offset: number) {
  const precedingNewline = text.lastIndexOf("\n", offset - 1);
  const followingNewline = text.indexOf("\n", offset);
  return {
    start: precedingNewline === -1 ? 0 : precedingNewline + 1,
    end: followingNewline === -1 ? text.length : followingNewline,
  };
}

function goalRemoval(text: string, token: SlashToken): Replacement {
  const line = lineBounds(text, token.start);
  const before = text.slice(line.start, token.start);
  const after = text.slice(token.end, line.end);
  if (before.trim() === "" && after.trim() === "") {
    if (line.end < text.length) {
      return { start: line.start, end: line.end + 1, value: "" };
    }
    const start = line.start > 0 ? line.start - 1 : line.start;
    return { start, end: line.end, value: "" };
  }

  let start = token.start;
  let end = token.end;
  const hasSpaceBefore = start > line.start && /[ \t]/.test(text[start - 1]!);
  const hasSpaceAfter = end < line.end && /[ \t]/.test(text[end]!);
  if (hasSpaceBefore && hasSpaceAfter) {
    while (end < line.end && /[ \t]/.test(text[end]!)) end++;
  } else if (hasSpaceBefore && end === line.end) {
    while (start > line.start && /[ \t]/.test(text[start - 1]!)) start--;
  } else if (!hasSpaceBefore && hasSpaceAfter) {
    while (end < line.end && /[ \t]/.test(text[end]!)) end++;
  }
  return { start, end, value: "" };
}

function applyReplacements(
  source: string,
  replacements: readonly Replacement[],
) {
  let result = source;
  for (const replacement of [...replacements].sort(
    (a, b) => b.start - a.start,
  )) {
    result =
      result.slice(0, replacement.start) +
      replacement.value +
      result.slice(replacement.end);
  }
  return result;
}

function overlaps(
  left: { start: number; end: number },
  right: { start: number; end: number },
) {
  return left.start < right.end && right.start < left.end;
}
