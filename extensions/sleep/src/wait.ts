/**
 * Waiting that gives up the moment there is something better to do.
 *
 * A sleep the agent cannot be pulled out of is a trap: the user types, and
 * nothing happens for the next eleven minutes. So the wait is really a race
 * between a timer and the arrival of new input.
 *
 * Codex runs that race on a channel (`tools/handlers/sleep.rs` selects over a
 * timer and an activity receiver). Pi exposes queued input as a boolean —
 * `ctx.hasPendingMessages()` — with no event to wait on, so the race here is a
 * poll. `POLL_INTERVAL_MS` is the resulting wake-up latency, and it is the one
 * behavioural difference from the design this is modelled on.
 */

export const MIN_DURATION_MS = 1;

/** Codex's ceiling. Long enough for any real wait, short enough to be a bug. */
export const MAX_DURATION_MS = 12 * 60 * 60 * 1000;

/**
 * How stale `interrupted()` may be.
 *
 * Small enough that a person does not notice it, large enough that a
 * twelve-hour sleep is not 170,000 wake-ups.
 */
export const POLL_INTERVAL_MS = 250;

export interface WaitDeps {
  now(): number;
  delay(ms: number, signal?: AbortSignal): Promise<void>;
  /** True when there is queued input worth waking up for. */
  interrupted(): boolean;
}

export interface WaitResult {
  /** Wall-clock time actually spent, which is the honest number to report. */
  readonly sleptMs: number;
  readonly interrupted: boolean;
}

export async function waitOrWake(
  durationMs: number,
  deps: WaitDeps,
  signal?: AbortSignal,
): Promise<WaitResult> {
  const started = deps.now();

  // Checked before waiting at all, as codex does. Input that arrived while the
  // model was deciding to sleep is exactly the input a sleep should yield to,
  // and sleeping first would sit on it for the full duration.
  if (deps.interrupted()) return { sleptMs: 0, interrupted: true };

  for (;;) {
    const elapsed = deps.now() - started;
    const remaining = durationMs - elapsed;
    if (remaining <= 0) return { sleptMs: elapsed, interrupted: false };
    // Never overshoot the request: a 5ms sleep must not become a 250ms one.
    await deps.delay(Math.min(POLL_INTERVAL_MS, remaining), signal);
    if (deps.interrupted()) {
      return { sleptMs: deps.now() - started, interrupted: true };
    }
  }
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) {
    // A decimal only where it says something: "1.5s", but "3s" not "3.0s".
    const rounded = Math.round(seconds * 10) / 10;
    return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  if (minutes < 60) return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes === 0 ? `${hours}h` : `${hours}h ${restMinutes}m`;
}

export function describeResult(result: WaitResult, requested: number): string {
  if (result.interrupted) {
    return `Woke early after ${formatDuration(result.sleptMs)} of ${formatDuration(requested)}: there is new input waiting. Read it before continuing.`;
  }
  return `Slept ${formatDuration(result.sleptMs)}.`;
}
