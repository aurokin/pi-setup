/**
 * Argument parsing for `/runtime`.
 *
 * `/runtime claude [--model <id>] [--effort <level>]` makes Claude the primary
 * model, `/runtime pi` gives the session back to pi, and `/runtime status`
 * reports which is active.
 */

import { REASONING_EFFORTS } from "../domain.ts";
import type { ReasoningEffort } from "../domain.ts";

export type RuntimeCommand =
  | {
      readonly action: "claude";
      readonly model?: string;
      readonly effort?: ReasoningEffort;
    }
  | { readonly action: "pi" }
  | { readonly action: "status" }
  | { readonly action: "interrupt" }
  | { readonly action: "error"; readonly message: string };

const USAGE =
  "Usage: /runtime claude [--model <id>] [--effort <level>] | /runtime pi | /runtime interrupt | /runtime status";

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
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i];
    const value = rest[i + 1];
    if (value === undefined) {
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
  }
  return { action: "claude", model, effort };
}
