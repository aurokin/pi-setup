import assert from "node:assert/strict";
import test from "node:test";
import { Effect } from "effect";
import { SubagentManager } from "../extensions/subagents/src/manager.ts";
import { claudeBackend } from "../extensions/subagents/src/backends/claude.ts";
import type {
  ParentContext,
  SpawnTask,
} from "../extensions/subagents/src/domain.ts";
import {
  createSubagentRuntime,
  runTool,
} from "../extensions/subagents/src/runtime.ts";

const parent: ParentContext = {
  parentCwd: process.cwd(),
  projectTrusted: false,
};

function task(prompt: string): SpawnTask {
  return {
    prompt,
    role: "reader",
    title: "live Claude test",
    cwd: process.cwd(),
    model: "haiku",
    reasoningEffort: "off",
    parent,
  };
}

async function claudeAvailable() {
  return Effect.runPromise(claudeBackend.available);
}

/** Rejecting deadline so a hung wait still reaches finally() and disposes. */
function deadline<A>(operation: Promise<A>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Live Claude test exceeded ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  return Promise.race([operation, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

test(
  "Claude backend completes a live manager run",
  { timeout: 60_000 },
  async (t) => {
    if (!(await claudeAvailable())) {
      t.skip("Claude Code executable is unavailable");
      return;
    }

    const runtime = createSubagentRuntime();
    try {
      const manager = await runtime.runPromise(SubagentManager);
      const started = await runTool(
        runtime,
        manager.spawn("claude", task("Reply with exactly: hello claude")),
      );
      await deadline(runTool(runtime, manager.waitFor([started.id])), 45_000);

      const done = manager.view.get(started.id);
      assert.equal(done?.status, "done");
      assert.match(done?.finalText ?? "", /hello claude/i);
      assert.ok(done?.meta.nativeSessionId);
      assert.ok(done?.meta.sessionFilePath?.endsWith(".jsonl"));
    } finally {
      await runtime.dispose();
    }
  },
);

test(
  "Claude backend send continues the conversation across turns",
  { timeout: 180_000 },
  async (t) => {
    if (!(await claudeAvailable())) {
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
          task("Remember the word cormorant. Reply with exactly: ready"),
        ),
      );
      await deadline(runTool(runtime, manager.waitFor([started.id])), 80_000);
      const first = manager.view.get(started.id);
      assert.equal(first?.status, "done", first?.errorText ?? "");
      assert.match(first?.finalText ?? "", /ready/i);
      // view.get returns the *live* snapshot, so anything compared across
      // turns has to be copied out before the next one mutates it.
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
  "Claude backend interrupt settles a live run as aborted",
  { timeout: 60_000 },
  async (t) => {
    if (!(await claudeAvailable())) {
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
          task(
            "Write a detailed 10,000-word essay about the history of computing.",
          ),
        ),
      );

      // Wait for streamed output so cancellation definitely lands mid-run and
      // exercises the SDK's normal interrupt receipt/result path.
      const streamDeadline = Date.now() + 15_000;
      while (
        manager.view.get(started.id)?.status === "running" &&
        !manager.view.get(started.id)?.liveAssistant?.text &&
        Date.now() < streamDeadline
      ) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.equal(manager.view.get(started.id)?.status, "running");
      assert.ok(manager.view.get(started.id)?.liveAssistant?.text);

      const report = await deadline(
        runTool(runtime, manager.cancel([started.id])),
        20_000,
      );

      assert.equal(report[0]?.cancelled, true);
      assert.equal(manager.view.get(started.id)?.status, "error");
      assert.equal(manager.view.get(started.id)?.errorText, "Run was aborted");
    } finally {
      await runtime.dispose();
    }
  },
);
