/**
 * Choosing a thinking level, separated from showing a menu.
 *
 * pi calls this "thinking level"; people call it effort, which is why this
 * command exists under a name the built-in UI never uses. The two words mean
 * the same thing here and the command says so, rather than inventing a third
 * scale that would have to be mapped.
 *
 * What is worth testing is the choosing, not the widget: which levels a model
 * actually offers, what a typed argument resolves to, and what happens when the
 * level in force is not one the current model supports. That last case is the
 * real one — switching models can strand the session on a level the new model
 * never offered, and a picker that opened with nothing selected would hide it.
 */

import type { ModelThinkingLevel } from "@earendil-works/pi-ai";

export type Resolution =
  | { readonly kind: "set"; readonly level: ModelThinkingLevel }
  | { readonly kind: "menu" }
  | { readonly kind: "error"; readonly message: string };

/**
 * What a `/effort` argument means.
 *
 * No argument opens the menu. Anything else must name a level this model
 * offers: a level it does not support would be silently clamped by
 * `setThinkingLevel`, and a command that reports a change it did not make is
 * worse than one that refuses.
 */
export function resolveArgument(
  args: string,
  supported: ReadonlyArray<ModelThinkingLevel>,
): Resolution {
  const wanted = args.trim().toLowerCase();
  if (!wanted) return { kind: "menu" };

  if (supported.length === 0)
    return { kind: "error", message: "This model has no thinking levels." };

  const match = supported.find((level) => level === wanted);
  if (match) return { kind: "set", level: match };

  return {
    kind: "error",
    message: `Unknown level "${wanted}". This model offers: ${supported.join(", ")}.`,
  };
}

/**
 * Where the menu should open.
 *
 * The level in force wins when the model offers it. When it does not — the
 * session was set to `xhigh` and then switched to a model that stops at
 * `high` — fall back to the highest level this model does offer rather than
 * the first, because the level in force was a request for more thinking and
 * the nearest honest answer to it is the most this model can do.
 */
export function initialSelection(
  current: ModelThinkingLevel | undefined,
  supported: ReadonlyArray<ModelThinkingLevel>,
): ModelThinkingLevel | undefined {
  if (supported.length === 0) return undefined;
  if (current && supported.includes(current)) return current;
  return supported[supported.length - 1];
}

/** One line naming the level in force, and flagging it when the model cannot honour it. */
export function describe(
  model: string,
  current: ModelThinkingLevel | undefined,
  supported: ReadonlyArray<ModelThinkingLevel>,
) {
  if (supported.length === 0) return `${model} has no thinking levels.`;
  const stranded = current && !supported.includes(current);
  return (
    `${model}: ${current ?? "unset"}` +
    (stranded ? " — not offered by this model" : "") +
    ` · offers ${supported.join(", ")}`
  );
}
