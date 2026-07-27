/**
 * Live droid backend, against a real `droid` process and real inference.
 *
 * Everything the hermetic droid.test.ts covers is a pure function handed a
 * literal frame. What only a live run can show is whether the SDK session
 * actually starts, whether the tool denials the backend sends are accepted,
 * and whether a turn settles — which is where the other backends' surprises
 * have been.
 *
 * Costs Factory subscription credit. Kept to short prompts on the open-weight
 * default for that reason.
 */

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Effect } from "effect";
import { droidBackend } from "../extensions/subagents/src/backends/droid.ts";
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
 * tested from. Trusted because droid refuses to start in a directory pi has not
 * trusted — it cannot be confined to user-level settings the way codex can.
 */
const cwd = mkdtempSync(join(tmpdir(), "droid-live-"));

const parent: ParentContext = {
  parentCwd: cwd,
  projectTrusted: true,
};

function task(prompt: string, role: RoleName = "reader"): SpawnTask {
  return {
    prompt,
    role,
    title: "live droid test",
    cwd,
    parent,
  };
}

function deadline<A>(operation: Promise<A>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Live droid test exceeded ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  return Promise.race([operation, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function droidAvailable() {
  return Effect.runPromise(droidBackend.available);
}

test(
  "droid backend completes a live manager run",
  { timeout: 120_000 },
  async (t) => {
    if (!(await droidAvailable())) {
      t.skip("droid is unavailable or FACTORY_API_KEY is unset");
      return;
    }

    const runtime = createSubagentRuntime();
    try {
      const manager = await runtime.runPromise(SubagentManager);
      const spawned = await runTool(
        runtime,
        manager.spawn("droid", task("Reply with exactly: hello droid")),
      );

      await deadline(runTool(runtime, manager.waitFor([spawned.id])), 100_000);
      const done = manager.view.get(spawned.id);
      assert.equal(done?.status, "done", done?.errorText ?? "");
      assert.match(done?.finalText ?? "", /hello droid/i);
      assert.equal(done?.meta.backend, "droid");
      assert.ok(done?.meta.sessionFilePath);
    } finally {
      await runtime.dispose();
    }
  },
);

test(
  "droid backend runs the open-weight default, not droid's own",
  { timeout: 120_000 },
  async (t) => {
    if (!(await droidAvailable())) {
      t.skip("droid is unavailable or FACTORY_API_KEY is unset");
      return;
    }

    const runtime = createSubagentRuntime();
    try {
      const manager = await runtime.runPromise(SubagentManager);
      const spawned = await runTool(
        runtime,
        // No model named: the point is what the backend picks on the caller's
        // behalf, since droid's own default would bill Claude to Factory.
        manager.spawn("droid", task("Reply with exactly: ok")),
      );
      await deadline(runTool(runtime, manager.waitFor([spawned.id])), 100_000);
      const done = manager.view.get(spawned.id);
      assert.equal(done?.status, "done", done?.errorText ?? "");
      assert.match(done?.meta.modelLabel ?? "", /glm/i);
    } finally {
      await runtime.dispose();
    }
  },
);

test(
  "droid backend cancel settles a live run",
  { timeout: 60_000 },
  async (t) => {
    if (!(await droidAvailable())) {
      t.skip("droid is unavailable or FACTORY_API_KEY is unset");
      return;
    }

    const runtime = createSubagentRuntime();
    try {
      const manager = await runtime.runPromise(SubagentManager);
      const spawned = await runTool(
        runtime,
        manager.spawn(
          "droid",
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
