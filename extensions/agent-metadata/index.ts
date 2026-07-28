/**
 * Publish this pane's agent metadata to tmux, so nothing has to guess.
 *
 * agentscan (and anything else reading tmux) otherwise infers what a pane is
 * doing by scraping the rendered TUI: match the provider from the title, then
 * `capture-pane` and pattern-match the footer. That works, but it is a ladder
 * of heuristics over a UI that changes whenever an extension adds a status row
 * — which is precisely what this setup does — and it cannot see the state that
 * matters most, a session sitting on a question.
 *
 * agentscan's `docs/metadata-contract.md` specifies the alternative: pane-local
 * tmux user options, `@agent.*`. Publishing `state` there does not merely
 * outrank the title, it suppresses the pane-output capture entirely for this
 * pane — the daemon subscribes to these options over control mode, so a write
 * is an event rather than a poll.
 *
 * Rules taken from that contract and worth not rediscovering:
 *
 * - Publish on transitions, never on a timer.
 * - `@agent.pid` is an all-or-nothing trust guard: if it does not parse, is
 *   dead, or is outside the pane's process tree, the *entire* block is
 *   discarded and the pane silently falls back to inference.
 * - An empty value means absent, so a label we do not have is simply not
 *   written.
 * - Publication must never break the agent. Every write is guarded on tmux
 *   being present and swallows its own failure.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { execFile, execFileSync } from "node:child_process";
import {
  clearAllArgs,
  CONTRACT_VERSION,
  createRunState,
  isBlockingTool,
  normalizeLabel,
  normalizeValue,
  PROVIDER_SLUG,
  setOptionArgs,
  unsetOptionArgs,
  type AgentState,
  type PublishedField,
} from "./src/metadata.ts";

export default function agentMetadata(pi: ExtensionAPI) {
  const pane = process.env.TMUX && process.env.TMUX_PANE;
  if (!pane) return;

  /**
   * Whether this process owns the pane's metadata right now.
   *
   * Gating only `session_start` on the mode is not enough: the other handlers
   * are registered regardless, so a `pi --print` run launched inside someone
   * else's agent pane would still publish its own state over theirs and then
   * clear their whole block on the way out. Nothing may touch the pane until a
   * TUI session claims it here.
   *
   * It is also the shutdown latch. `session_shutdown` is not only process exit
   * — switching sessions with `/new` fires shutdown then a fresh `session_start`
   * — so this flips both ways rather than latching once.
   */
  let owned = false;

  // Writes are serialized through one chain because they are ordered edges:
  // a busy→idle pair landing out of order leaves the pane permanently busy,
  // and tmux gives no ordering guarantee across concurrent invocations.
  let queue: Promise<void> = Promise.resolve();

  const run = (args: string[]) => {
    if (!owned) return;
    queue = queue.then(
      () =>
        new Promise<void>((resolve) => {
          // Checked again here, not only when enqueued: shutdown clears the
          // pane synchronously, and a write still sitting in this chain would
          // put a field back on a pane this process no longer owns.
          if (!owned) return resolve();
          // Failure is not reportable and not worth retrying: tmux may have
          // exited, the pane may be gone, and neither is pi's problem.
          execFile("tmux", args, () => resolve());
        }),
    );
  };

  const publish = (field: PublishedField, value: string | undefined) => {
    const normalized = normalizeValue(value);
    // Absent is a value: the contract reads an empty option as unset, so a
    // label that goes away has to be cleared rather than left behind. Clearing
    // a session name would otherwise leave the old one on the pane forever.
    run(
      normalized === undefined
        ? unsetOptionArgs(pane, field)
        : setOptionArgs(pane, field, normalized),
    );
  };

  const publishLabel = (value: string | undefined) => {
    const normalized = normalizeLabel(value);
    run(
      normalized === undefined
        ? unsetOptionArgs(pane, "label")
        : setOptionArgs(pane, "label", normalized),
    );
  };

  let state = createRunState();
  let published: AgentState | undefined;

  const publishState = (next: AgentState) => {
    // Tool calls fire in bursts; only edges are worth a write.
    if (next === published) return;
    published = next;
    run(setOptionArgs(pane, "state", next));
  };

  const publishIdentity = (ctx: ExtensionContext) => {
    publish("provider", PROVIDER_SLUG);
    publish("pid", String(process.pid));
    publish("v", CONTRACT_VERSION);
    publish("cwd", ctx.cwd);
    publish("session_id", ctx.sessionManager.getSessionId());
    publish("model", ctx.model?.id);
    publishLabel(pi.getSessionName());
  };

  pi.on("session_start", (_event, ctx) => {
    // Only the interactive TUI owns a pane.
    if (ctx.mode !== "tui") return;
    owned = true;
    // A switch cleared the pane on the way out of the previous session, so
    // nothing published before this point still exists. Forgetting the last
    // state is what makes it get written again rather than deduped away.
    state = createRunState();
    published = undefined;
    publishIdentity(ctx);
    publishState(state.current());
  });

  pi.on("agent_start", () => publishState(state.turnStarted()));
  pi.on("agent_end", () => publishState(state.turnEnded()));

  pi.on("tool_execution_start", (event) => {
    if (isBlockingTool(event.toolName)) {
      publishState(state.blocked(event.toolCallId));
    }
  });

  pi.on("tool_execution_end", (event) => {
    if (isBlockingTool(event.toolName)) {
      publishState(state.unblocked(event.toolCallId));
    }
  });

  // The label is the session name, which `session-title` sets from the first
  // prompt and `/rename` changes.
  pi.on("session_info_changed", (event) => publishLabel(event.name));
  pi.on("model_select", (_event, ctx) => publish("model", ctx.model?.id));

  pi.on("session_shutdown", () => {
    if (!owned) return;
    // Stop accepting writes before clearing, so nothing queued behind this
    // re-creates a field the clear just removed.
    owned = false;
    published = undefined;
    // Synchronous, unlike every other write here: pi is already exiting, and
    // an async spawn queued at this point may never run. A block left behind
    // is not fatal — `@agent.pid` is dead by then, and the contract says a
    // dead pid discards the whole block — but that costs every reader a
    // process probe, and only readers implementing the guard are protected.
    try {
      execFileSync("tmux", clearAllArgs(pane), { stdio: "ignore" });
    } catch {
      // tmux may already be gone. Nothing to report and nobody to report to.
    }
  });
}
