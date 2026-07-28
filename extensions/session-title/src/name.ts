/**
 * Turning a prompt into a session name.
 *
 * Pure, because the interesting part is entirely about text: what a pane title
 * should say when the only thing available is the first thing you typed. Kept
 * out of `index.ts` so the trimming rules are testable without a session.
 */

/**
 * Longest name we will set.
 *
 * pi renders the title as `π - <name> - <cwd>`, and that whole string competes
 * for a tmux status line shared with every other pane. Past roughly this width
 * the terminal truncates it, and truncation eats the *directory*, which is the
 * part that tells two panes apart.
 */
export const MAX_NAME_LENGTH = 48;

/** Fenced blocks, inline code, and pasted output make terrible titles. */
function stripCodeAndMarkup(prompt: string) {
  return prompt
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/^\s*[>#*-]+\s*/gm, " ");
}

/**
 * The first sentence-ish run of a prompt, as a name.
 *
 * Returns undefined rather than a bad name: a prompt that is only a slash
 * command, only a file path, or only punctuation says nothing about the work,
 * and leaving the session unnamed keeps pi's plain `π - <cwd>` title, which is
 * at least honest.
 */
export function deriveSessionName(prompt: string): string | undefined {
  const flattened = stripCodeAndMarkup(prompt).replace(/\s+/g, " ").trim();
  if (flattened.length === 0) return undefined;

  // A prompt that opens with a command is about the command, not the work, and
  // pi has already consumed it by the time this runs.
  if (flattened.startsWith("/")) return undefined;

  const firstClause = flattened.split(/(?<=[.!?])\s|\s[—–-]\s/)[0] ?? flattened;
  const name = truncateOnWordBoundary(firstClause.trim(), MAX_NAME_LENGTH);

  // Titles are compared and read at a glance; one that carries no letters or
  // digits is noise in the list.
  return /[\p{L}\p{N}]/u.test(name) ? name : undefined;
}

function truncateOnWordBoundary(text: string, limit: number) {
  if (text.length <= limit) return text;
  const clipped = text.slice(0, limit);
  const lastSpace = clipped.lastIndexOf(" ");
  // Only break on a word if doing so keeps most of the budget; otherwise a
  // single long token would collapse the name to almost nothing.
  const kept = lastSpace > limit * 0.6 ? clipped.slice(0, lastSpace) : clipped;
  return `${kept.trimEnd()}…`;
}
