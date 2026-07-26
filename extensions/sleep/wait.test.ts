import assert from "node:assert/strict";
import { test } from "node:test";
import {
  describeResult,
  formatDuration,
  MAX_DURATION_MS,
  POLL_INTERVAL_MS,
  waitOrWake,
  type WaitDeps,
} from "./src/wait.ts";

/**
 * A fake clock. Real timers would make these tests either slow or flaky, and
 * the thing under test is a race, which is exactly what a fake clock is for.
 */
function clock(options: { interruptAt?: number } = {}) {
  let time = 0;
  const slept: number[] = [];
  const deps: WaitDeps = {
    now: () => time,
    delay: async (ms) => {
      slept.push(ms);
      time += ms;
    },
    interrupted: () =>
      options.interruptAt !== undefined && time >= options.interruptAt,
  };
  return { deps, slept, at: () => time };
}

test("a sleep that runs to completion reports the time it asked for", async () => {
  const { deps } = clock();
  assert.deepEqual(await waitOrWake(1000, deps), {
    sleptMs: 1000,
    interrupted: false,
  });
});

test("input already queued is not made to wait for the sleep", async () => {
  // The window matters: a message that arrived while the model was deciding to
  // sleep is precisely the message a sleep should yield to. Checking only after
  // the first delay would sit on it for a poll interval — or, for a sleep
  // shorter than one, for the whole duration.
  const { deps, slept } = clock({ interruptAt: 0 });
  assert.deepEqual(await waitOrWake(60_000, deps), {
    sleptMs: 0,
    interrupted: true,
  });
  assert.deepEqual(slept, [], "it must not wait at all");
});

test("new input ends a long sleep instead of parking the session", async () => {
  const { deps } = clock({ interruptAt: 1000 });
  const result = await waitOrWake(MAX_DURATION_MS, deps);
  assert.equal(result.interrupted, true);
  assert.ok(
    result.sleptMs < 2000,
    `woke after ${result.sleptMs}ms, which is not promptly`,
  );
});

test("the reported duration is wall time, not the duration requested", async () => {
  // An interrupted sleep that claimed the full duration would have the model
  // reasoning about elapsed time that never elapsed.
  const { deps } = clock({ interruptAt: 500 });
  const result = await waitOrWake(60_000, deps);
  assert.ok(result.sleptMs < 60_000);
  assert.ok(result.sleptMs >= 500);
});

test("a short sleep is not rounded up to the poll interval", async () => {
  // Polling is an implementation detail of the wake-up race. Letting it set a
  // floor on the duration would make `sleep(5)` mean something else.
  const { deps, at } = clock();
  await waitOrWake(5, deps);
  assert.equal(at(), 5);
});

test("a long sleep polls rather than spinning", async () => {
  const { deps, slept } = clock();
  await waitOrWake(POLL_INTERVAL_MS * 4, deps);
  assert.equal(slept.length, 4);
  assert.ok(slept.every((ms) => ms === POLL_INTERVAL_MS));
});

test("durations read as durations", () => {
  assert.equal(formatDuration(500), "500ms");
  assert.equal(formatDuration(1500), "1.5s");
  assert.equal(formatDuration(3000), "3s");
  assert.equal(formatDuration(45_000), "45s");
  assert.equal(formatDuration(120_000), "2m");
  assert.equal(formatDuration(150_000), "2m 30s");
  assert.equal(formatDuration(3_600_000), "1h");
  assert.equal(formatDuration(MAX_DURATION_MS), "12h");
});

test("waking early tells the model why, not just that", () => {
  // "Slept 3s" after asking for 60 looks like a bug. The model needs to know
  // the sleep was cut short by input it has not read yet.
  const early = describeResult({ sleptMs: 3000, interrupted: true }, 60_000);
  assert.match(early, /new input/i);
  assert.match(early, /\b3s\b/);
  assert.match(early, /\b1m\b/);
  assert.doesNotMatch(
    describeResult({ sleptMs: 60_000, interrupted: false }, 60_000),
    /new input/i,
  );
});
