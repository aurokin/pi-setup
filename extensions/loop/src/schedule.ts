/**
 * The bookkeeping behind `/loop`: what is scheduled, when it next fires, and
 * when it stops firing forever.
 *
 * Everything here is pure. The timer, the session, and the model live in
 * `index.ts`; this file only decides. That split is what makes the two
 * properties that matter — a loop always expires, and a tick never stacks on a
 * busy agent — testable without waiting for real minutes to pass.
 */

/**
 * A minute.
 *
 * A loop is a prompt that costs a model call every time it fires, unattended.
 * Anything faster is a poll, and a poll belongs inside one turn with `sleep`,
 * where the model can see what it already tried.
 */
export const MIN_INTERVAL_MS = 60_000;

/**
 * A week.
 *
 * Not a safety limit — the process rarely lives that long — but a statement
 * that a loop is a task with an end. A schedule with no expiry is a thing you
 * forget you started and discover in a bill.
 */
export const MAX_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

export interface Loop {
  readonly id: string;
  readonly prompt: string;
  readonly intervalMs: number;
  readonly startedAt: number;
  readonly expiresAt: number;
  readonly nextFireAt: number;
  readonly fired: number;
  /** Ticks dropped because the agent was still working. */
  readonly skipped: number;
}

export interface ParsedInterval {
  readonly ms: number;
  readonly rest: string;
}

const UNITS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/**
 * Read a leading `30s` / `5m` / `2h` / `1d` off a command line.
 *
 * A bare number is refused rather than guessed at: `/loop 5 check the build`
 * means five of something, and picking seconds or minutes on the user's behalf
 * is the difference between a reasonable schedule and sixty model calls an
 * hour.
 */
export function parseInterval(
  input: string,
): ParsedInterval | { error: string } {
  const trimmed = input.trim();
  const match = /^(\d+)\s*([smhd])\b\s*/i.exec(trimmed);
  if (!match) {
    const bare = /^(\d+)\s/.exec(trimmed);
    if (bare) {
      return {
        error: `"${bare[1]}" needs a unit — try ${bare[1]}m for minutes, or ${bare[1]}h for hours.`,
      };
    }
    return { error: "Expected an interval first, like `5m` or `2h`." };
  }
  const ms = Number(match[1]) * UNITS[match[2].toLowerCase()]!;
  return { ms, rest: trimmed.slice(match[0].length).trim() };
}

export interface CreateRequest {
  readonly intervalMs: number;
  readonly prompt: string;
  readonly now: number;
}

/**
 * Validate a request into everything but an id.
 *
 * The id is the caller's to attach, and deliberately not taken until this
 * succeeds: allocating one up front burns it on every rejected command, so a
 * user whose first attempt was `/loop 5s ...` ends up with a `loop-2` and no
 * `loop-1` anywhere.
 */
export function createLoop(
  request: CreateRequest,
): Omit<Loop, "id"> | { error: string } {
  if (request.prompt.length === 0) {
    return { error: "A loop needs a prompt: `/loop 10m check CI and report`." };
  }
  if (request.intervalMs < MIN_INTERVAL_MS) {
    return {
      error:
        "The shortest interval is 1m. For anything tighter, use the `sleep` tool inside a single turn — it costs one model call instead of one per attempt.",
    };
  }
  if (request.intervalMs > MAX_LIFETIME_MS) {
    return { error: "The longest interval is 7d." };
  }
  return {
    prompt: request.prompt,
    intervalMs: request.intervalMs,
    startedAt: request.now,
    expiresAt: request.now + MAX_LIFETIME_MS,
    // The first fire is one interval away, not immediate: `/loop 1h check the
    // deploy` from a user who is about to describe the deploy should not fire
    // before they finish typing.
    nextFireAt: request.now + request.intervalMs,
    fired: 0,
    skipped: 0,
  };
}

export type TickAction =
  | { readonly kind: "idle" }
  | { readonly kind: "expired"; readonly loop: Loop }
  | { readonly kind: "skip"; readonly loop: Loop }
  | { readonly kind: "fire"; readonly loop: Loop };

/**
 * Decide what a single loop should do at `now`.
 *
 * `busy` is the important input. A loop that fires while the agent is mid-turn
 * would queue its prompt behind whatever the user is doing, and a slow turn
 * plus a short interval would stack several. Skipping is right rather than
 * queueing: the point of a recurring prompt is the *current* state of the
 * thing, and a tick that waited ten minutes to run asks about a world that has
 * moved on.
 */
export function tick(loop: Loop, now: number, busy: boolean): TickAction {
  if (now >= loop.expiresAt) return { kind: "expired", loop };
  if (now < loop.nextFireAt) return { kind: "idle" };
  // The next fire is scheduled from now, not from the missed slot, so a
  // long-running turn cannot leave a backlog to catch up on.
  const next = { ...loop, nextFireAt: now + loop.intervalMs };
  if (busy) {
    return { kind: "skip", loop: { ...next, skipped: loop.skipped + 1 } };
  }
  return { kind: "fire", loop: { ...next, fired: loop.fired + 1 } };
}

export function describe(loop: Loop, now: number): string {
  const parts = [
    `${loop.id}  every ${humanize(loop.intervalMs)}`,
    `next in ${humanize(Math.max(0, loop.nextFireAt - now))}`,
    `fired ${loop.fired}`,
  ];
  if (loop.skipped > 0) parts.push(`skipped ${loop.skipped}`);
  parts.push(`expires in ${humanize(Math.max(0, loop.expiresAt - now))}`);
  return `${parts.join(", ")}\n    ${loop.prompt}`;
}

export function humanize(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours === 0 ? `${days}d` : `${days}d ${restHours}h`;
}
