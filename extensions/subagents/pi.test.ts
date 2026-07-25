/**
 * Live checks for the pi backend.
 *
 * The pi backend is the only one that runs in-process rather than as a child
 * process, so it is also the only one whose failures cannot surface as a
 * non-zero exit: a broken session just never settles. These cover the two
 * things that has to do — finish a run, and keep the conversation across a
 * follow-up send — plus the tool restriction that makes the reader role mean
 * anything.
 *
 * `piBackend.available` is unconditionally true (there is no executable to
 * find), so these do not skip; they need a working parent model configuration
 * the same way the session itself does.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  ModelRegistry,
  ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import type { RoleName } from "../shared/roles.ts";
import type { ParentContext, SpawnTask } from "./src/domain.ts";
import { SubagentManager } from "./src/manager.ts";
import { createSubagentRuntime, runTool } from "./src/runtime.ts";

/** Cheap, and the one the session itself defaults to. */
const MODEL = "openai-codex/gpt-5.4-mini";

/**
 * The pi backend resolves models through the parent session's registry, so a
 * test outside a session has to build one. Defaults throughout: the same
 * on-disk credentials and model catalog the session itself reads.
 */
async function parentContext(): Promise<ParentContext> {
  const modelRegistry = new ModelRegistry(await ModelRuntime.create());
  await modelRegistry.refresh();
  return {
    parentCwd: process.cwd(),
    projectTrusted: false,
    modelRegistry,
  };
}

function task(
  parent: ParentContext,
  prompt: string,
  role: RoleName = "reader",
): SpawnTask {
  return {
    prompt,
    role,
    title: "live pi test",
    cwd: process.cwd(),
    model: MODEL,
    parent,
  };
}

function deadline<A>(operation: Promise<A>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Live pi test exceeded ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  return Promise.race([operation, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

test(
  "pi backend completes a live manager run",
  { timeout: 120_000 },
  async () => {
    const runtime = createSubagentRuntime();
    try {
      const parent = await parentContext();
      const manager = await runtime.runPromise(SubagentManager);
      const started = await runTool(
        runtime,
        manager.spawn("pi", task(parent, "Reply with exactly: hello pi")),
      );
      await deadline(runTool(runtime, manager.waitFor([started.id])), 90_000);

      const done = manager.view.get(started.id);
      assert.equal(done?.status, "done", done?.errorText ?? "");
      assert.match(done?.finalText ?? "", /hello pi/i);
    } finally {
      await runtime.dispose();
    }
  },
);

test(
  "pi backend keeps its session across a follow-up send",
  { timeout: 180_000 },
  async () => {
    const runtime = createSubagentRuntime();
    try {
      const parent = await parentContext();
      const manager = await runtime.runPromise(SubagentManager);
      const started = await runTool(
        runtime,
        manager.spawn(
          "pi",
          task(parent, "Remember the word kestrel. Reply with exactly: ready"),
        ),
      );
      await deadline(runTool(runtime, manager.waitFor([started.id])), 90_000);
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
      await deadline(runTool(runtime, manager.waitFor([started.id])), 90_000);
      const second = manager.view.get(started.id);
      assert.equal(second?.status, "done", second?.errorText ?? "");
      assert.match(second?.finalText ?? "", /kestrel/i);
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
  "a reader-role pi child is not given the tools it would need to write",
  { timeout: 120_000 },
  async () => {
    const runtime = createSubagentRuntime();
    try {
      const parent = await parentContext();
      const manager = await runtime.runPromise(SubagentManager);
      const started = await runTool(
        runtime,
        manager.spawn(
          "pi",
          task(
            parent,
            "List the exact names of every tool available to you, one per line, and nothing else.",
          ),
        ),
      );
      await deadline(runTool(runtime, manager.waitFor([started.id])), 90_000);

      const done = manager.view.get(started.id);
      assert.equal(done?.status, "done", done?.errorText ?? "");
      const listed = (done?.finalText ?? "").toLowerCase();
      // Asking the child what it holds is the only check that fails when the
      // denylist silently stops being applied; a refusal to write proves only
      // that the prompt was persuasive.
      for (const denied of ["write", "edit", "bash"]) {
        assert.ok(
          !new RegExp(`(^|\\W)${denied}(\\W|$)`).test(listed),
          `reader child listed a mutating tool "${denied}": ${done?.finalText}`,
        );
      }
      assert.match(listed, /read/);
    } finally {
      await runtime.dispose();
    }
  },
);
