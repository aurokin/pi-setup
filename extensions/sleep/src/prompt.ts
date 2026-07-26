/**
 * What the model is told about sleeping.
 *
 * The risk with a sleep tool is not that the model never uses it — it is that
 * the model reaches for it as a substitute for thinking, polling a thing every
 * two seconds instead of waiting on it properly. So the description leads with
 * the cases where waiting is the correct move, and names the cheaper
 * alternatives for the cases where it is not.
 */

import { formatDuration, MAX_DURATION_MS } from "./wait.ts";

export const SLEEP_TOOL_DESCRIPTION = `Pause for a fixed duration, then continue the same turn.

Use this when the next useful thing to do is genuinely later: a deploy that takes a few minutes to go live, a rate limit that clears at a known time, a log that only gets interesting after a build finishes.

Returns early the moment the user sends anything, so a long sleep does not make the session unresponsive. Maximum ${formatDuration(MAX_DURATION_MS)}.`;

export const SLEEP_PROMPT_SNIPPET =
  "sleep: wait a fixed duration before continuing, waking early on new input";

export const SLEEP_PROMPT_GUIDELINES = [
  "Prefer a command that blocks over sleeping in a poll loop: `wait`, `--follow`, `gh run watch`, and friends return the instant the thing happens, where a poll costs a model call per attempt and still adds latency.",
  "When you do sleep, sleep for about as long as the thing actually takes. Ten short sleeps cost ten times what one right-sized sleep does.",
  "Say what you are waiting for before sleeping. A silent pause is indistinguishable from a hang.",
  "Waking early means the user sent something. Read it and reconsider the plan rather than resuming what you were doing.",
];

export const SLEEP_PARAMETER_DESCRIPTIONS = {
  durationMs: `How long to pause, in milliseconds. Capped at ${formatDuration(MAX_DURATION_MS)}.`,
  reason:
    "What you are waiting for, in a few words. Shown to the user while the sleep runs.",
} as const;
