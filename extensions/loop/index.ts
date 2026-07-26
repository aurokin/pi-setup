/**
 * /loop - run the same prompt on a cadence.
 *
 * `sleep` waits inside a turn. This waits *between* turns: it takes a prompt
 * and a schedule, and re-asks it until you stop it or a week goes by. The shape
 * it fits is watching — a CI run, a canary deploy, a queue draining — where the
 * useful question is the same one every time and only the answer changes.
 *
 * Three properties keep an unattended prompt loop from becoming a runaway:
 *
 *  1. **It expires.** Every loop dies after 7 days, no exceptions.
 *  2. **It never stacks.** A tick that lands on a busy agent is dropped, not
 *     queued, so a slow turn cannot build a backlog of stale questions.
 *  3. **It dies with the session.** Nothing is persisted, so nothing survives
 *     to fire at a session that never asked for it. See `docs/design.md`.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { LoopRegistry } from "./src/registry.ts";
import {
  createLoop,
  describe,
  humanize,
  parseInterval,
  type Loop,
} from "./src/schedule.ts";

/**
 * How often the scheduler looks at the clock.
 *
 * Well under the 1m minimum interval, so the error it introduces on a fire time
 * is a rounding detail rather than a skipped slot.
 */
const SWEEP_INTERVAL_MS = 5_000;

export default function loopExtension(pi: ExtensionAPI) {
  const registry = new LoopRegistry();
  let timer: NodeJS.Timeout | undefined;
  let context: ExtensionContext | undefined;

  const stopSweeping = () => {
    if (!timer) return;
    clearInterval(timer);
    timer = undefined;
  };

  const sweep = () => {
    // No context yet means no session to prompt into. Nothing to do but wait
    // for one rather than fire into the void.
    if (!context) return;
    const { fire, expired } = registry.advance(Date.now(), !context.isIdle());
    for (const loop of expired) {
      pi.sendMessage({
        customType: "loop-expired",
        content: `${loop.id} expired after 7 days (fired ${loop.fired} times).`,
        display: true,
      });
    }
    for (const loop of fire) {
      // `sendUserMessage` always triggers a turn, and skips slash-command
      // expansion — so a loop prompt is text the model reads, never a command
      // it re-runs.
      pi.sendUserMessage(loop.prompt);
    }
    if (registry.size === 0) stopSweeping();
  };

  const startSweeping = () => {
    if (timer) return;
    timer = setInterval(sweep, SWEEP_INTERVAL_MS);
    // The sweep must never be the reason the process stays alive: a session
    // that is otherwise finished should exit, not linger for a loop.
    timer.unref?.();
  };

  /**
   * A loop belongs to the session that started it.
   *
   * `/new`, `/resume`, and `/fork` all keep the process alive, so without this
   * the old session's loops keep sweeping and eventually inject a prompt into a
   * conversation that never asked for it — the same failure that made
   * persisting loops a bad idea, reached from inside one process.
   *
   * `startup` has nothing to clear, and `reload` re-instantiates the extension
   * with fresh state anyway.
   */
  pi.on("session_start", async (event, ctx) => {
    context = ctx;
    if (event.reason === "startup" || event.reason === "reload") return;
    const abandoned = registry.clear();
    stopSweeping();
    if (abandoned > 0) {
      say(pi, `Stopped ${abandoned} loop(s) with the previous session.`);
    }
  });

  // Timers do not survive a process, and loops are not persisted, so shutdown
  // is the end of every loop. Clearing explicitly keeps a reload from leaving a
  // sweep running against a session that is gone.
  pi.on("session_shutdown", async () => {
    stopSweeping();
    registry.clear();
  });

  pi.registerCommand("loop", {
    description: "Re-run a prompt on a schedule (`/loop 10m check CI`)",
    async handler(args, ctx) {
      context = ctx;
      const input = args.trim();
      const now = Date.now();

      if (input.length === 0) return show(pi, registry, now);

      const [verb, ...rest] = input.split(/\s+/);
      if (verb === "stop" || verb === "cancel") {
        return stop(pi, registry, rest.join(" ").trim());
      }
      if (verb === "list") return show(pi, registry, now);

      const interval = parseInterval(input);
      if ("error" in interval) return say(pi, interval.error);

      const draft = createLoop({
        intervalMs: interval.ms,
        prompt: interval.rest,
        now,
      });
      if ("error" in draft) return say(pi, draft.error);
      const loop = { ...draft, id: registry.nextId() };

      registry.add(loop);
      startSweeping();
      return say(
        pi,
        `${loop.id} started: every ${humanize(loop.intervalMs)}, first in ${humanize(loop.intervalMs)}, expires in 7d.\n` +
          `  ${loop.prompt}\n` +
          `Stop it with \`/loop stop ${loop.id}\`.`,
      );
    },
    getArgumentCompletions(prefix) {
      if (prefix.startsWith("stop")) {
        return registry.list().map((loop) => ({
          value: `stop ${loop.id}`,
          label: loop.id,
          description: loop.prompt,
        }));
      }
      return null;
    },
  });
}

/**
 * Everything the command says goes through the session rather than straight to
 * the terminal, so the model can see it too. A model that watched the user
 * start a loop and then gets its prompt out of nowhere has no way to tell that
 * from the user typing it.
 */
function say(pi: ExtensionAPI, text: string): void {
  pi.sendMessage({ customType: "loop", content: text, display: true });
}

function show(pi: ExtensionAPI, registry: LoopRegistry, now: number): void {
  if (registry.size === 0) {
    return say(
      pi,
      "No loops running. Start one with `/loop 10m check CI and report`.",
    );
  }
  const lines = registry.list().map((loop: Loop) => `  ${describe(loop, now)}`);
  say(pi, `${registry.size} loop(s):\n${lines.join("\n")}`);
}

function stop(pi: ExtensionAPI, registry: LoopRegistry, target: string): void {
  if (target === "all") {
    const count = registry.clear();
    return say(pi, count === 0 ? "No loops to stop." : `Stopped ${count}.`);
  }
  if (target.length === 0) {
    return say(pi, "Which one? `/loop stop loop-1`, or `/loop stop all`.");
  }
  return say(
    pi,
    registry.remove(target)
      ? `Stopped ${target}.`
      : `No loop called ${target}. \`/loop\` lists them.`,
  );
}
