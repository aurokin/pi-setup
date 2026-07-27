/**
 * Live cursor backend, against the real Cursor SDK.
 *
 * Unlike the other backends this one runs the agent loop in *this* process, so
 * a live run is the only thing that exercises the scoped Agent lifecycle, the
 * frame translation against a real stream, and whether a busy agent's queued
 * follow-up is delivered.
 *
 * Costs Cursor subscription credit. Read-only roles get Cursor's plan mode,
 * which is not a tool policy this repo controls — see the header of
 * `src/backends/cursor.ts`.
 */

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Effect } from "effect";
import { cursorBackend } from "../extensions/subagents/src/backends/cursor.ts";
import type { RoleName } from "../extensions/shared/roles.ts";
import type {
  ParentContext,
  SpawnTask,
} from "../extensions/subagents/src/domain.ts";
import { SubagentManager } from "../extensions/subagents/src/manager.ts";
import {
  createSubagentRuntime,
  runTool,
} from "../extensions/subagents/src/runtime.ts";

/**
 * A scratch directory, not this checkout: these runs include a `worker`, and a
 * live agent with write access should not be pointed at the repo it is being
 * tested from.
 *
 * Trusted, unlike the codex tests, because the point here is the backend's
 * normal path — cursor does not refuse an untrusted directory (verified: these
 * pass either way), so leaving it untrusted would only test something the
 * backend does not branch on.
 */
const cwd = mkdtempSync(join(tmpdir(), "cursor-live-"));

const parent: ParentContext = {
  parentCwd: cwd,
  projectTrusted: true,
};

function task(prompt: string, role: RoleName = "reader"): SpawnTask {
  return {
    prompt,
    role,
    title: "live cursor test",
    cwd,
    parent,
  };
}

function deadline<A>(operation: Promise<A>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Live cursor test exceeded ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  return Promise.race([operation, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function cursorAvailable() {
  return Effect.runPromise(cursorBackend.available);
}

test(
  "cursor backend completes a live manager run",
  { timeout: 120_000 },
  async (t) => {
    if (!(await cursorAvailable())) {
      t.skip("CURSOR_API_KEY is unset");
      return;
    }

    const runtime = createSubagentRuntime();
    try {
      const manager = await runtime.runPromise(SubagentManager);
      const spawned = await runTool(
        runtime,
        manager.spawn("cursor", task("Reply with exactly: hello cursor")),
      );

      await deadline(runTool(runtime, manager.waitFor([spawned.id])), 100_000);
      const done = manager.view.get(spawned.id);
      assert.equal(done?.status, "done", done?.errorText ?? "");
      assert.match(done?.finalText ?? "", /hello cursor/i);
      assert.equal(done?.meta.backend, "cursor");
    } finally {
      await runtime.dispose();
    }
  },
);

test(
  "cursor backend keeps its conversation across a follow-up send",
  { timeout: 180_000 },
  async (t) => {
    if (!(await cursorAvailable())) {
      t.skip("CURSOR_API_KEY is unset");
      return;
    }

    const runtime = createSubagentRuntime();
    try {
      const manager = await runtime.runPromise(SubagentManager);
      const started = await runTool(
        runtime,
        manager.spawn(
          "cursor",
          task("Remember the word albatross. Reply with exactly: ready"),
        ),
      );
      await deadline(runTool(runtime, manager.waitFor([started.id])), 80_000);
      const first = manager.view.get(started.id);
      assert.equal(first?.status, "done", first?.errorText ?? "");
      const turnsAfterFirst = first?.turns ?? 0;

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
      assert.match(second?.finalText ?? "", /albatross/i);
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
  "cursor backend does not lose a follow-up sent while the agent is busy",
  { timeout: 180_000 },
  async (t) => {
    if (!(await cursorAvailable())) {
      t.skip("CURSOR_API_KEY is unset");
      return;
    }

    const runtime = createSubagentRuntime();
    try {
      const manager = await runtime.runPromise(SubagentManager);
      const started = await runTool(
        runtime,
        manager.spawn(
          "cursor",
          task("Count from 1 to 40, one number per line, then reply: counted."),
        ),
      );

      // Sent immediately: spawn has already started the run, so this is the
      // path where the SDK would reject a second send and the backend's own
      // queue is the only thing holding the message.
      await runTool(
        runtime,
        manager.send(started.id, "Now reply with exactly: pelican"),
      );

      // What is asserted is only that the message survives, because that is
      // the part that does not depend on timing. Whether waitFor returns
      // before or after the queued turn depends on exactly when the first one
      // settles — and it currently returns early, which is a real wart
      // documented on SubagentManager.waitFor rather than pinned here, where
      // asserting it would make this test fail on a fast first turn.
      await deadline(runTool(runtime, manager.waitFor([started.id])), 45_000);

      // The message is queued, not lost: the second turn does run.
      const deadlineAt = Date.now() + 45_000;
      while (
        (manager.view.get(started.id)?.turns ?? 0) < 2 &&
        Date.now() < deadlineAt
      ) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      const done = manager.view.get(started.id);
      assert.ok(
        (done?.turns ?? 0) >= 2,
        `queued follow-up never ran (turns: ${done?.turns})`,
      );
      // Needed, not belt-and-braces: `turns` increments on an assistant
      // message, so two turns does not imply the run has settled and
      // finalText may not be written yet. Safe to call when it already has —
      // waitFor filters on status, so a settled entry returns at once.
      await deadline(runTool(runtime, manager.waitFor([started.id])), 45_000);
      assert.match(manager.view.get(started.id)?.finalText ?? "", /pelican/i);
    } finally {
      await runtime.dispose();
    }
  },
);

test(
  "cursor backend cancel settles a live run",
  { timeout: 60_000 },
  async (t) => {
    if (!(await cursorAvailable())) {
      t.skip("CURSOR_API_KEY is unset");
      return;
    }

    const runtime = createSubagentRuntime();
    try {
      const manager = await runtime.runPromise(SubagentManager);
      const spawned = await runTool(
        runtime,
        manager.spawn(
          "cursor",
          // worker running a shell command, as the codex test does: a
          // prompt the model merely answers can finish inside the delay
          // below, and then cancel legitimately reports nothing to cancel.
          task("Run `sleep 45`, then reply with the word finished.", "worker"),
        ),
      );

      // Wait for the run to actually be active rather than assuming it is.
      const activeBy = Date.now() + 30_000;
      while (
        manager.view.get(spawned.id)?.status !== "running" &&
        Date.now() < activeBy
      ) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.equal(
        manager.view.get(spawned.id)?.status,
        "running",
        "run never became active, so there was nothing to cancel",
      );
      const result = await deadline(
        runTool(runtime, manager.cancel([spawned.id])),
        20_000,
      );
      assert.equal(result[0]?.cancelled, true);
      assert.equal(manager.view.get(spawned.id)?.status, "error");
    } finally {
      await runtime.dispose();
    }
  },
);
