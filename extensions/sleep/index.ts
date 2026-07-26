/**
 * sleep - lets the model wait for something instead of pretending it happened.
 *
 * Without a way to wait, an agent watching a deploy has two options: poll in a
 * tight loop, paying a model call per attempt, or guess that enough time has
 * passed. Codex added a sleep tool for this (`codex-rs/core/src/tools/handlers/
 * sleep.rs`); this is the same idea on pi's extension API.
 *
 * The property that makes it safe is that it yields: any input from the user
 * ends the sleep immediately, so "wait an hour" never means an hour of an
 * unresponsive session. See `src/wait.ts` for how that race is run, and
 * `docs/design.md` for why it is a poll rather than a channel.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { setTimeout as delay } from "node:timers/promises";
import { Type, type Static } from "typebox";
import {
  SLEEP_PARAMETER_DESCRIPTIONS,
  SLEEP_PROMPT_GUIDELINES,
  SLEEP_PROMPT_SNIPPET,
  SLEEP_TOOL_DESCRIPTION,
} from "./src/prompt.ts";
import {
  describeResult,
  MAX_DURATION_MS,
  MIN_DURATION_MS,
  waitOrWake,
} from "./src/wait.ts";

const SleepParams = Type.Object({
  duration_ms: Type.Integer({
    minimum: MIN_DURATION_MS,
    maximum: MAX_DURATION_MS,
    description: SLEEP_PARAMETER_DESCRIPTIONS.durationMs,
  }),
  reason: Type.Optional(
    Type.String({ description: SLEEP_PARAMETER_DESCRIPTIONS.reason }),
  ),
});

export type SleepInput = Static<typeof SleepParams>;

export interface SleepDetails {
  requestedMs: number;
  sleptMs: number;
  interrupted: boolean;
  reason?: string;
}

export default function sleepExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "sleep",
    label: "Sleep",
    description: SLEEP_TOOL_DESCRIPTION,
    promptSnippet: SLEEP_PROMPT_SNIPPET,
    promptGuidelines: SLEEP_PROMPT_GUIDELINES,
    parameters: SleepParams,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      // The schema bounds this, but a provider that ignores the schema would
      // otherwise be able to park the session indefinitely.
      const requested = Math.min(
        Math.max(params.duration_ms, MIN_DURATION_MS),
        MAX_DURATION_MS,
      );

      let result;
      try {
        result = await waitOrWake(
          requested,
          {
            now: () => Date.now(),
            delay: (ms, s) => delay(ms, undefined, { signal: s }),
            interrupted: () => ctx.hasPendingMessages(),
          },
          signal,
        );
      } catch {
        // The only way out of `delay` other than elapsing is the tool's abort
        // signal — the user interrupting. That is a normal outcome for a
        // sleep, not an error worth a stack trace.
        throw new Error("Sleep interrupted.");
      }

      const details: SleepDetails = {
        requestedMs: requested,
        sleptMs: result.sleptMs,
        interrupted: result.interrupted,
        reason: params.reason,
      };
      return {
        content: [{ type: "text", text: describeResult(result, requested) }],
        details,
      };
    },
  });
}
