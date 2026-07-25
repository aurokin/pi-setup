/**
 * Live checks for the primary-runtime transport.
 *
 * These exercise what the pure tests in primary.test.ts cannot: that a
 * long-lived `origin: "primary"` session actually completes turns on Claude,
 * keeps its conversation across them, stays out of the model-facing listing,
 * and is exempt from the fan-out cap. Skipped when Claude Code is unavailable.
 *
 * The pi `input` hook, the entry renderer, and interrupt behavior still need a
 * real TUI; they are not covered here.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { Effect } from "effect";
import { isModelVisible } from "./src/by-the-way.ts";
import { claudeBackend } from "./src/backends/claude.ts";
import type { ParentContext, SpawnTask } from "./src/domain.ts";
import { MAX_RUNNING, SubagentManager } from "./src/manager.ts";
import { createSubagentRuntime, runTool } from "./src/runtime.ts";

const parent: ParentContext = {
  parentCwd: process.cwd(),
  projectTrusted: false,
};

/** Opus at low effort: enough to follow a two-turn instruction, cheap to run. */
function primaryTask(prompt: string): SpawnTask {
  return {
    origin: "primary",
    prompt,
    role: "worker",
    title: "primary runtime",
    cwd: process.cwd(),
    model: "opus",
    reasoningEffort: "low",
    parent,
  };
}

function deadline<A>(operation: Promise<A>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () =>
        reject(new Error(`Live primary-runtime test exceeded ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  return Promise.race([operation, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

test(
  "the primary session completes turns and remembers the last one",
  { timeout: 180_000 },
  async (t) => {
    if (!(await Effect.runPromise(claudeBackend.available))) {
      t.skip("Claude Code executable is unavailable");
      return;
    }

    const runtime = createSubagentRuntime();
    try {
      const manager = await runtime.runPromise(SubagentManager);
      const started = await runTool(
        runtime,
        manager.spawn(
          "claude",
          primaryTask("Remember the word cormorant. Reply with exactly: ready"),
        ),
      );

      // Its own id namespace: an `sa-` id here would read as model fan-out.
      assert.match(started.id, /^pri-/);
      assert.equal(started.origin, "primary");
      assert.equal(isModelVisible(started), false);

      await deadline(runTool(runtime, manager.waitFor([started.id])), 80_000);
      const first = manager.view.get(started.id);
      assert.equal(first?.status, "done", first?.errorText ?? "");
      assert.match(first?.finalText ?? "", /ready/i);
      // view.get returns the *live* snapshot, so anything compared across
      // turns has to be copied out before the next one mutates it.
      const turnsAfterFirst = first?.turns ?? 0;

      // The point of a primary runtime: one conversation, not one-shot runs.
      await runTool(
        runtime,
        manager.send(
          started.id,
          "What word did I ask you to remember? Reply with just that word.",
        ),
      );
      await deadline(runTool(runtime, manager.waitFor([started.id])), 80_000);
      const second = manager.view.get(started.id);
      assert.equal(second?.status, "done", second?.errorText ?? "");
      assert.match(second?.finalText ?? "", /cormorant/i);
      assert.ok(
        (second?.turns ?? 0) > turnsAfterFirst,
        `turns did not advance past ${turnsAfterFirst}`,
      );
    } finally {
      await runtime.dispose();
    }
  },
);

test(
  "the user's prompt is not blocked by a full fan-out cap",
  { timeout: 240_000 },
  async (t) => {
    if (!(await Effect.runPromise(claudeBackend.available))) {
      t.skip("Claude Code executable is unavailable");
      return;
    }

    const runtime = createSubagentRuntime();
    try {
      const manager = await runtime.runPromise(SubagentManager);
      // Saturate the cap with model-origin subagents.
      const busy = await Promise.all(
        Array.from({ length: MAX_RUNNING }, (_, n) =>
          runTool(
            runtime,
            manager.spawn("claude", {
              prompt: `Count slowly to 40, then reply done ${n}.`,
              role: "reader",
              title: `filler ${n}`,
              cwd: process.cwd(),
              model: "opus",
              reasoningEffort: "low",
              parent,
            }),
          ),
        ),
      );
      assert.equal(busy.length, MAX_RUNNING);

      // One more model subagent must be refused...
      await assert.rejects(
        runTool(
          runtime,
          manager.spawn("claude", {
            prompt: "Reply with exactly: nope",
            role: "reader",
            title: "over cap",
            cwd: process.cwd(),
            model: "opus",
            reasoningEffort: "low",
            parent,
          }),
        ),
        new RegExp(`Max ${MAX_RUNNING} subagents`),
      );

      // ...while the user's own conversation still starts.
      const primary = await runTool(
        runtime,
        manager.spawn("claude", primaryTask("Reply with exactly: primary ok")),
      );
      assert.match(primary.id, /^pri-/);
      await deadline(runTool(runtime, manager.waitFor([primary.id])), 100_000);
      assert.equal(
        manager.view.get(primary.id)?.status,
        "done",
        manager.view.get(primary.id)?.errorText ?? "",
      );
    } finally {
      await runtime.dispose();
    }
  },
);
