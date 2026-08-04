/**
 * End-to-end checks for `sleep`, `/loop`, and `/goal` against a real pi process.
 *
 * Unit tests cover every decision these three make; none of them can cover the
 * wiring. Whether a tool is actually registered, whether a slash command
 * reaches its handler, and above all whether a loop fires a turn with nobody
 * typing — those are properties of pi plus the extension, and only a running
 * session has an opinion about them.
 *
 * Costs money and takes about two minutes, most of it spent waiting out one
 * real 1m loop interval. That is the point: shortening it would test a
 * different thing.
 *
 * Skips rather than fails when the model is unavailable, so this stays runnable
 * on a machine without codex auth.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readCodexCredentials } from "../extensions/codex-compaction/src/auth.ts";

const MODEL = "openai-codex/gpt-5.6-sol";
const UNAVAILABLE = "openai-codex auth is not configured on this machine";
const available = readCodexCredentials() !== undefined;

/** One pi process shared by every test here; spawning one each would triple the cost. */
let pi: ChildProcessWithoutNullStreams | undefined;
let events: Record<string, unknown>[] = [];

before(() => {
  if (!available) return;
  pi = spawn("pi", ["--mode", "rpc", "--model", MODEL, "--approve"], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  let buffer = "";
  pi.stdout.on("data", (chunk: Buffer) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line) as Record<string, unknown>);
      } catch {
        // Non-JSON noise on stdout is not this suite's problem.
      }
    }
  });
});

after(() => pi?.kill());

const seen = () => JSON.stringify(events);
const send = (message: Record<string, unknown>) =>
  pi?.stdin.write(`${JSON.stringify(message)}\n`);

async function until(
  predicate: () => boolean,
  label: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline)
      throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/** A prompt runs a turn, so it settles. */
async function turn(text: string, timeoutMs = 120_000): Promise<string> {
  events = [];
  send({ type: "prompt", message: text });
  await until(
    () => events.some((e) => e.type === "agent_settled"),
    text.slice(0, 40),
    timeoutMs,
  );
  return seen();
}

/** Wait for a slash command's own output. An extension may then trigger a turn. */
async function command(text: string, expect: RegExp): Promise<string> {
  events = [];
  send({ type: "prompt", message: text });
  await until(() => expect.test(seen()), `${text} -> ${expect}`, 20_000).catch(
    () => {},
  );
  return seen();
}

test(
  "sleep waits and reports back",
  { skip: !available && UNAVAILABLE },
  async () => {
    const started = Date.now();
    const output = await turn(
      "Call the sleep tool for exactly 3000 milliseconds with reason 'e2e', then reply with only the word SLEPT.",
    );
    assert.match(output, /"sleep"/, "the tool was never called");
    assert.ok(Date.now() - started >= 3000, "it did not actually wait");
    assert.match(output, /Slept/);
  },
);

test(
  "a goal continues itself and independently verifies completion",
  { skip: !available && UNAVAILABLE },
  async () => {
    const started = await command(
      "/goal Verify that README.md exists in the current working directory, then report the goal complete.",
      /Goal set/,
    );
    assert.match(started, /Goal set/);

    // Nothing else is typed: the command starts the primary run, goal_update
    // records a provisional claim, and a same-model child verifies it.
    await until(
      () => /Goal complete confirmed/.test(seen()),
      "automatic goal completion and verification",
      180_000,
    );
    assert.match(
      seen(),
      /goal_update/,
      "the primary never reported completion",
    );
    assert.match(await command("/goal", /Complete/), /Complete/);

    const after = await turn(
      "Without using tools, is there a 'Current goal' section in your instructions right now? Answer only YES or NO.",
    );
    assert.match(after, /\bNO\b/, "a verified goal stayed in context");
    await command("/goal clear", /cleared/i);
  },
);

test(
  "a loop fires a turn with no user input",
  { skip: !available && UNAVAILABLE },
  async () => {
    assert.match(
      await command("/loop 5s check the build", /shortest interval/),
      /shortest interval/,
    );
    assert.match(
      await command("/loop 5 check the build", /needs a unit/),
      /needs a unit/,
    );

    const started = await command(
      "/loop 1m Reply with only the word KUMQUAT. Do not use any tools.",
      /loop-1 started/,
    );
    assert.match(started, /loop-1 started/, "a rejected loop consumed an id");
    assert.match(await command("/loop", /loop-1/), /KUMQUAT/);

    // The whole reason this suite exists: nothing below is typed by anyone.
    events = [];
    await until(
      () => /KUMQUAT/.test(seen()),
      "an unattended loop fire",
      100_000,
    );

    assert.match(
      await command("/loop stop loop-1", /Stopped loop-1/),
      /Stopped loop-1/,
    );
    assert.match(
      await command("/loop", /No loops running/),
      /No loops running/,
    );
  },
);
