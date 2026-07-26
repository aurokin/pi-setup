import assert from "node:assert/strict";
import { test } from "node:test";
import { LoopRegistry } from "./src/registry.ts";
import {
  createLoop,
  describe,
  humanize,
  MAX_LIFETIME_MS,
  MIN_INTERVAL_MS,
  parseInterval,
  tick,
  type Loop,
} from "./src/schedule.ts";

const T0 = 1_000_000;

function loop(overrides: Partial<Loop> = {}): Loop {
  const created = createLoop({
    intervalMs: MIN_INTERVAL_MS,
    prompt: "check CI",
    now: T0,
  });
  assert.ok(!("error" in created));
  return { id: "loop-1", ...created, ...overrides };
}

// --- parsing ------------------------------------------------------------------

test("an interval and a prompt come off one line", () => {
  assert.deepEqual(parseInterval("10m check CI and report"), {
    ms: 600_000,
    rest: "check CI and report",
  });
  assert.deepEqual(parseInterval("2h  watch the canary"), {
    ms: 7_200_000,
    rest: "watch the canary",
  });
  assert.deepEqual(parseInterval("1d daily digest"), {
    ms: 86_400_000,
    rest: "daily digest",
  });
});

test("a number without a unit is refused, not guessed", () => {
  // "5" is five of something. Reading it as seconds turns a reasonable-looking
  // command into twelve model calls a minute; reading it as hours quietly does
  // nothing for the rest of the day. Neither is a guess worth making.
  const result = parseInterval("5 check the build");
  assert.ok("error" in result);
  assert.match(result.error, /5m/);
  assert.match(result.error, /5h/);
});

test("a line that does not start with an interval is refused", () => {
  assert.ok("error" in parseInterval("check CI every 10m"));
  assert.ok("error" in parseInterval(""));
});

test("a unit-like word is not mistaken for a unit", () => {
  // `/loop 3 minutes check CI` must not parse "3 m" out of "minutes" and then
  // run "inutes check CI" as the prompt.
  const result = parseInterval("3 minutes check CI");
  assert.ok("error" in result);
});

// --- creation -----------------------------------------------------------------

test("a loop below the floor is refused, and told where to go instead", () => {
  const result = createLoop({
    intervalMs: 5_000,
    prompt: "check CI",
    now: T0,
  });
  assert.ok("error" in result);
  assert.match(result.error, /sleep/);
});

test("a loop with no prompt is refused", () => {
  const result = createLoop({
    intervalMs: MIN_INTERVAL_MS,
    prompt: "",
    now: T0,
  });
  assert.ok("error" in result);
});

test("the first fire is one interval away, not immediate", () => {
  // `/loop 1h check the deploy` typed just before describing the deploy should
  // not fire while the user is still typing.
  assert.equal(loop().nextFireAt, T0 + MIN_INTERVAL_MS);
});

test("every loop is born with an expiry", () => {
  assert.equal(loop().expiresAt, T0 + MAX_LIFETIME_MS);
});

// --- ticking ------------------------------------------------------------------

test("nothing happens before the interval elapses", () => {
  assert.equal(tick(loop(), T0 + 1000, false).kind, "idle");
});

test("a due loop fires when the agent is free", () => {
  const action = tick(loop(), T0 + MIN_INTERVAL_MS, false);
  assert.equal(action.kind, "fire");
  assert.ok(action.kind === "fire");
  assert.equal(action.loop.fired, 1);
});

test("a tick that lands on a busy agent is dropped, not queued", () => {
  // Queueing is the tempting choice and the wrong one: a recurring prompt asks
  // about the state of something *now*, so a tick that waited out a ten-minute
  // turn would ask about a world that has moved on — and several stacked ticks
  // would ask about it several times.
  const action = tick(loop(), T0 + MIN_INTERVAL_MS, true);
  assert.equal(action.kind, "skip");
  assert.ok(action.kind === "skip");
  assert.equal(action.loop.fired, 0);
  assert.equal(action.loop.skipped, 1);
});

test("a missed slot does not become a backlog", () => {
  // Scheduling the next fire from the missed slot rather than from now would
  // leave a loop that was blocked for an hour firing every sweep until it
  // caught up.
  const late = T0 + MIN_INTERVAL_MS * 10;
  const action = tick(loop(), late, false);
  assert.ok(action.kind === "fire");
  assert.equal(action.loop.nextFireAt, late + MIN_INTERVAL_MS);
});

test("an expired loop expires instead of firing", () => {
  const action = tick(loop(), T0 + MAX_LIFETIME_MS, false);
  assert.equal(action.kind, "expired");
});

test("expiry wins over a fire that is also due", () => {
  // Both conditions hold at the deadline of a loop whose interval divides the
  // lifetime. Firing first would let a loop outlive its expiry by one turn.
  const expiring = loop({ nextFireAt: T0 + MAX_LIFETIME_MS });
  assert.equal(tick(expiring, T0 + MAX_LIFETIME_MS, false).kind, "expired");
});

// --- registry -----------------------------------------------------------------

test("ids are not reused after a loop is stopped", () => {
  // Between reading `/loop` and typing `/loop stop loop-2`, a reused id would
  // cancel a loop the user never saw.
  const registry = new LoopRegistry();
  const first = registry.nextId();
  registry.add(loop({ id: first }));
  registry.remove(first);
  assert.notEqual(registry.nextId(), first);
});

test("advancing fires the due loops and forgets the expired ones", () => {
  const registry = new LoopRegistry();
  registry.add(loop({ id: "loop-1" }));
  registry.add(loop({ id: "loop-2", nextFireAt: T0 + MAX_LIFETIME_MS * 2 }));
  registry.add(loop({ id: "loop-3", expiresAt: T0 + 1 }));

  const { fire, expired } = registry.advance(T0 + MIN_INTERVAL_MS, false);
  assert.deepEqual(
    fire.map((l) => l.id),
    ["loop-1"],
  );
  assert.deepEqual(
    expired.map((l) => l.id),
    ["loop-3"],
  );
  assert.equal(registry.size, 2, "the expired loop is gone");
  assert.equal(registry.get("loop-3"), undefined);
});

test("an expired loop cannot fire on a later sweep", () => {
  const registry = new LoopRegistry();
  registry.add(loop({ expiresAt: T0 + 1 }));
  registry.advance(T0 + MIN_INTERVAL_MS, false);
  assert.deepEqual(registry.advance(T0 + MIN_INTERVAL_MS * 2, false).fire, []);
});

test("stopping all reports how many there were", () => {
  const registry = new LoopRegistry();
  registry.add(loop({ id: "loop-1" }));
  registry.add(loop({ id: "loop-2" }));
  assert.equal(registry.clear(), 2);
  assert.equal(registry.clear(), 0);
});

// --- display ------------------------------------------------------------------

test("the listing says when it next fires and when it gives up", () => {
  const text = describe(loop(), T0);
  assert.match(text, /loop-1/);
  assert.match(text, /check CI/);
  assert.match(text, /next in 1m/);
  assert.match(text, /expires in 7d/);
});

test("skips are shown only when there are some", () => {
  assert.doesNotMatch(describe(loop(), T0), /skipped/);
  assert.match(describe(loop({ skipped: 3 }), T0), /skipped 3/);
});

test("intervals read as intervals", () => {
  assert.equal(humanize(60_000), "1m");
  assert.equal(humanize(5_400_000), "1h 30m");
  assert.equal(humanize(MAX_LIFETIME_MS), "7d");
});

test("a rejected loop does not consume an id", () => {
  // Otherwise a user whose first attempt was `/loop 5s ...` gets a `loop-2`
  // with no `loop-1` anywhere and no explanation.
  const registry = new LoopRegistry();
  const rejected = createLoop({ intervalMs: 5_000, prompt: "x", now: T0 });
  assert.ok("error" in rejected);
  assert.equal(registry.nextId(), "loop-1");
});
