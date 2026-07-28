import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Effect } from "effect";
import { codexBackend } from "../extensions/subagents/src/backends/codex.ts";
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

// A scratch directory rather than this checkout: these spawn a live agent, and
// a permission-bypassed one pointed at the repo can edit the very files the
// suite is testing.
const cwd = mkdtempSync(join(tmpdir(), "codex-live-"));

const parent: ParentContext = {
  parentCwd: cwd,
  projectTrusted: false,
};

function task(prompt: string, role: RoleName = "reader"): SpawnTask {
  return {
    prompt,
    role,
    title: "live Codex test",
    cwd,
    parent,
  };
}

function deadline<A>(operation: Promise<A>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Live Codex test exceeded ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  return Promise.race([operation, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function codexAvailable() {
  return Effect.runPromise(codexBackend.available);
}

test(
  "Codex backend completes a live manager run",
  { timeout: 75_000 },
  async (t) => {
    if (!(await codexAvailable())) {
      t.skip("codex executable is unavailable");
      return;
    }

    const runtime = createSubagentRuntime();
    try {
      const manager = await runtime.runPromise(SubagentManager);
      const spawned = await runTool(
        runtime,
        manager.spawn("codex", task("Reply with exactly: hello codex")),
      );

      await deadline(runTool(runtime, manager.waitFor([spawned.id])), 60_000);
      const done = manager.view.get(spawned.id);
      assert.equal(done?.status, "done");
      assert.match(done?.finalText ?? "", /hello codex/i);
      assert.equal(done?.meta.backend, "codex");
      assert.ok(done?.meta.nativeSessionId);
      assert.ok(done?.meta.sessionFilePath);
    } finally {
      await runtime.dispose();
    }
  },
);

test(
  "Codex backend interrupt settles a live manager run",
  { timeout: 30_000 },
  async (t) => {
    if (!(await codexAvailable())) {
      t.skip("codex executable is unavailable");
      return;
    }

    const runtime = createSubagentRuntime();
    try {
      const manager = await runtime.runPromise(SubagentManager);
      const spawned = await runTool(
        runtime,
        manager.spawn(
          "codex",
          // worker: this exercises interrupting a live shell command, which a
          // read-only sandbox would not let the child start in the first place.
          task("Run `sleep 30`, then reply with the word finished.", "worker"),
        ),
      );

      await new Promise((resolve) => setTimeout(resolve, 250));
      const result = await deadline(
        runTool(runtime, manager.cancel([spawned.id])),
        10_000,
      );
      assert.equal(result[0]?.cancelled, true);
      assert.equal(manager.view.get(spawned.id)?.status, "error");
      assert.equal(manager.view.get(spawned.id)?.errorText, "Run was aborted");
    } finally {
      await runtime.dispose();
    }
  },
);

test(
  "Codex backend keeps its thread across a follow-up send",
  { timeout: 180_000 },
  async (t) => {
    if (!(await codexAvailable())) {
      t.skip("codex executable is unavailable");
      return;
    }

    const runtime = createSubagentRuntime();
    try {
      const manager = await runtime.runPromise(SubagentManager);
      const started = await runTool(
        runtime,
        manager.spawn(
          "codex",
          task("Remember the word albatross. Reply with exactly: ready"),
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
