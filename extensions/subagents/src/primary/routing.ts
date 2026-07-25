/**
 * What to do with a line of user input while the Claude runtime is active.
 *
 * Kept pure and separate from the extension so the interesting cases can be
 * tested without a live Claude session.
 *
 * pi dispatches extension commands *before* the input hook fires
 * (`core/agent-session.js`: `_tryExecuteExtensionCommand` runs first, and
 * returns early when it handles the text). So `/runtime pi`, `/subagents`, and
 * every other registered command keep working while Claude is the primary
 * model, and this file never sees them.
 *
 * What it does see is slash text pi did *not* recognize: a typo, a skill
 * (`/skill:name`), or a prompt template. Skills and templates expand after the
 * hook, so routing them to Claude would send the unexpanded literal — and a
 * typo'd command would silently become a Claude prompt instead of an error.
 * Both are worse than saying so, hence `reject`.
 */

export type InputDecision =
  | { readonly kind: "pass" }
  | { readonly kind: "route"; readonly text: string }
  | { readonly kind: "reject"; readonly reason: string };

/** Escape hatch: `//foo` sends a literal leading slash to Claude. */
const LITERAL_SLASH_PREFIX = "//";

export function decideInput(options: {
  readonly active: boolean;
  readonly text: string;
}): InputDecision {
  if (!options.active) return { kind: "pass" };

  const text = options.text;
  if (text.startsWith(LITERAL_SLASH_PREFIX)) {
    return { kind: "route", text: text.slice(1) };
  }
  if (text.startsWith("/")) {
    const name = text.slice(1).split(/\s/, 1)[0] ?? "";
    return {
      kind: "reject",
      reason: `"/${name}" is not a pi command, and skills and prompt templates do not expand while Claude is the primary runtime. Use "//${name}" to send it to Claude literally, or "/runtime pi" to switch back.`,
    };
  }
  return { kind: "route", text };
}
