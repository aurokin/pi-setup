/**
 * Argument parsing and completion for `/runtime`.
 *
 * `/runtime claude [--model <id>] [--effort <level>] [--new]` makes Claude the
 * primary model, `/runtime pi` gives the session back to pi, and
 * `/runtime status` reports which is active. Model and effort are sticky across
 * activations and are fixed once a session spawns, which is what `--new` exists
 * to escape.
 */

import { REASONING_EFFORTS } from "../domain.ts";
import type { ReasoningEffort } from "../domain.ts";

export type RuntimeCommand =
  | {
      readonly action: "claude";
      readonly model?: string;
      readonly effort?: ReasoningEffort;
      /** Abandon the open Claude session so the next prompt starts a new one. */
      readonly fresh?: boolean;
    }
  | { readonly action: "pi" }
  | { readonly action: "status" }
  | { readonly action: "interrupt" }
  | { readonly action: "error"; readonly message: string };

const USAGE =
  "Usage: /runtime claude [--model <id>] [--effort <level>] [--new] | /runtime pi | /runtime interrupt | /runtime status";

function isEffort(value: string): value is ReasoningEffort {
  return (REASONING_EFFORTS as readonly string[]).includes(value);
}

export function parseRuntimeCommand(rawArgs: string): RuntimeCommand {
  const tokens = rawArgs.trim().split(/\s+/).filter(Boolean);
  // Bare `/runtime` reports rather than toggling: a command that flips the
  // session's model based on hidden state is a bad thing to type by accident.
  const [subcommand, ...rest] = tokens;
  if (!subcommand || subcommand === "status") return { action: "status" };
  if (subcommand === "pi" || subcommand === "interrupt") {
    if (rest.length > 0)
      return {
        action: "error",
        message: `"/runtime ${subcommand}" takes no options.`,
      };
    return { action: subcommand === "pi" ? "pi" : "interrupt" };
  }
  if (subcommand !== "claude") {
    return {
      action: "error",
      message: `Unknown runtime "${subcommand}". ${USAGE}`,
    };
  }

  let model: string | undefined;
  let effort: ReasoningEffort | undefined;
  let fresh = false;
  // Not a fixed stride: `--new` carries no value, so the cursor advances by one
  // or two depending on the flag.
  for (let i = 0; i < rest.length;) {
    const flag = rest[i];
    if (flag === "--new") {
      fresh = true;
      i += 1;
      continue;
    }
    const value = rest[i + 1];
    // A flag where a value belongs is a missing value, not a model named
    // "--new": `--model --new` would otherwise silently disarm both options.
    if (value === undefined || value.startsWith("--")) {
      return { action: "error", message: `${flag} needs a value. ${USAGE}` };
    }
    if (flag === "--model") {
      model = value;
    } else if (flag === "--effort") {
      if (!isEffort(value)) {
        return {
          action: "error",
          message: `Unknown effort "${value}". One of: ${REASONING_EFFORTS.join(", ")}.`,
        };
      }
      effort = value;
    } else {
      return { action: "error", message: `Unknown option "${flag}". ${USAGE}` };
    }
    i += 2;
  }
  return { action: "claude", model, effort, fresh };
}

/**
 * Structurally pi-tui's `AutocompleteItem`, declared here rather than imported:
 * the type lives in `@earendil-works/pi-tui`, which this extension does not
 * depend on and should not start depending on for three fields.
 */
export interface RuntimeCompletion {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
}

const SUBCOMMANDS: ReadonlyArray<{ name: string; description: string }> = [
  { name: "claude", description: "Route this session's prompts to Claude" },
  { name: "pi", description: "Hand the session back to pi" },
  { name: "status", description: "Report which runtime is active" },
  { name: "interrupt", description: "Stop the Claude turn in flight" },
];

/**
 * Model aliases the Claude CLI documents (`claude --help`): "an alias for the
 * latest model (e.g. 'fable', 'opus', or 'sonnet')". Deliberately not
 * exhaustive — a full model name still types fine, and haiku is off the roster.
 */
const MODEL_ALIASES: ReadonlyArray<{ name: string; description: string }> = [
  { name: "opus", description: "Latest Opus — the default choice" },
  { name: "sonnet", description: "Latest Sonnet — simple, bounded work only" },
  { name: "fable", description: "Latest Fable — best, slow, cost premium" },
];

const FLAGS: ReadonlyArray<{ name: string; description: string }> = [
  { name: "--model", description: "Model alias or full model name" },
  { name: "--effort", description: "Reasoning effort (thinking budget)" },
  {
    name: "--new",
    description: "Start a new Claude session, not the open one",
  },
];

/**
 * Complete `/runtime`'s arguments.
 *
 * pi replaces the *entire* argument text with the chosen `value`
 * (`pi-tui/autocomplete.js`: `prefix` is everything after the command name), so
 * each value has to be the whole argument string rather than the one token
 * being typed. Hence the `settled.join(" ")` prefix on every candidate.
 */
export function completeRuntimeArguments(
  argumentPrefix: string,
): RuntimeCompletion[] | null {
  const tokens = argumentPrefix.trim().split(/\s+/).filter(Boolean);
  // A trailing space means the last token is finished and a new one is starting.
  const typing = /\s$/.test(argumentPrefix) || tokens.length === 0;
  const partial = typing ? "" : (tokens[tokens.length - 1] ?? "");
  const settled = typing ? tokens : tokens.slice(0, -1);

  const offer = (
    candidates: ReadonlyArray<{ name: string; description?: string }>,
  ): RuntimeCompletion[] | null => {
    const hits = candidates.filter((candidate) =>
      candidate.name.startsWith(partial),
    );
    if (hits.length === 0) return null;
    const prefix = settled.length > 0 ? `${settled.join(" ")} ` : "";
    return hits.map((hit) => ({
      value: `${prefix}${hit.name}`,
      label: hit.name,
      ...(hit.description ? { description: hit.description } : {}),
    }));
  };

  if (settled.length === 0) return offer(SUBCOMMANDS);
  // Only `claude` takes options; the others error on any, so suggesting
  // something there would be offering a mistake.
  if (settled[0] !== "claude") return null;

  const previous = settled[settled.length - 1];
  if (previous === "--model") return offer(MODEL_ALIASES);
  if (previous === "--effort")
    return offer(REASONING_EFFORTS.map((name) => ({ name })));

  return offer(FLAGS.filter((flag) => !settled.includes(flag.name)));
}
