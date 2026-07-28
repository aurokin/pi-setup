/**
 * End-to-end checks for `agent-metadata` and `session-title` against a real pi
 * in a real tmux pane.
 *
 * Everything these two extensions decide is unit-tested; nothing about that
 * proves the wiring, and the wiring is where they have actually broken. Both
 * bugs found while building them were invisible to unit tests and to reading:
 * a `--print` run clearing another agent's metadata because only one handler
 * checked the mode, and a session switch leaving the pane with no `state` at
 * all because the last published value was remembered across a clear.
 *
 * They live in `e2e/` because they need a running pi, but unlike the rest of
 * this directory **they cost nothing**: no turn is taken, so no provider is
 * called. What they need is a `tmux` binary and `pi` on PATH, and they skip
 * rather than fail without them.
 *
 * The one thing deliberately not covered is the busy/waiting cycle, which needs
 * a real turn and therefore real money. `metadata.test.ts` covers the state
 * machine that produces those transitions.
 */

import assert from "node:assert/strict";
import { after, test } from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { basename } from "node:path";

const SESSION = `pi-metadata-e2e-${process.pid}`;
const CWD = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

const haveTmux = spawnSync("tmux", ["-V"], { stdio: "ignore" }).status === 0;
const havePi = spawnSync("which", ["pi"], { stdio: "ignore" }).status === 0;
const UNAVAILABLE = !haveTmux ? "tmux is not installed" : "pi is not on PATH";

function tmux(...args: string[]) {
  return execFileSync("tmux", args, { encoding: "utf8" }).trim();
}

function option(pane: string, field: string) {
  // An unset option makes tmux exit non-zero and complain on stderr; that is
  // the "absent" the contract describes, not an error, so it is swallowed.
  try {
    return execFileSync(
      "tmux",
      ["show-options", "-p", "-t", pane, "-v", `@agent.${field}`],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
  } catch {
    return "";
  }
}

/** Poll rather than sleep: startup time is a property of the machine. */
async function waitFor<T>(
  describe: string,
  read: () => T,
  done: (value: T) => boolean,
  timeoutMs = 30_000,
) {
  const deadline = Date.now() + timeoutMs;
  let last: T = read();
  while (Date.now() < deadline) {
    last = read();
    if (done(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `timed out waiting for ${describe}; last value: ${JSON.stringify(last)}`,
  );
}

let pane: string | undefined;

after(() => {
  if (!pane) return;
  try {
    tmux("kill-session", "-t", SESSION);
  } catch {
    // Already gone, which is the outcome we wanted anyway.
  }
});

test(
  "a pi pane publishes its identity and an idle state",
  { skip: haveTmux && havePi ? false : UNAVAILABLE, timeout: 60_000 },
  async () => {
    tmux(
      "new-session",
      "-d",
      "-s",
      SESSION,
      "-c",
      CWD,
      "-x",
      "200",
      "-y",
      "50",
    );
    pane = tmux("list-panes", "-t", SESSION, "-F", "#{pane_id}");
    tmux("send-keys", "-t", SESSION, "pi", "Enter");

    // Waits on `state`, not `provider`: identity is published first and state
    // last, so a wait on the first field would race the rest of the block.
    await waitFor(
      "@agent.state",
      () => option(pane!, "state"),
      (value) => value === "idle",
    );

    assert.equal(option(pane!, "provider"), "pi");
    assert.equal(option(pane!, "v"), "1", "contract version");
    assert.equal(option(pane!, "cwd"), CWD);
    assert.ok(option(pane!, "session_id").length > 0, "session id");
    assert.ok(option(pane!, "model").length > 0, "model");

    // The pid is the contract's staleness guard: a block whose pid is dead or
    // outside the pane's process tree is discarded wholesale, so publishing a
    // wrong one silently disables the entire block.
    const pid = Number(option(pane!, "pid"));
    assert.ok(
      Number.isInteger(pid) && pid > 0,
      `pid should be an integer: ${pid}`,
    );
    assert.doesNotThrow(
      () => process.kill(pid, 0),
      "published pid should be a live process",
    );
  },
);

test(
  "/rename retitles the pane and republishes the label",
  { skip: haveTmux && havePi ? false : UNAVAILABLE, timeout: 60_000 },
  async () => {
    // No turn is taken here, which is the point: this is the whole cross-
    // extension path — session-title sets the session name, pi core rebuilds
    // its terminal title from it, and agent-metadata republishes the label —
    // and none of it needs a model.
    assert.ok(pane, "the first test must have started a pane");
    tmux("send-keys", "-t", SESSION, "/rename ship the title fix", "Enter");

    await waitFor(
      "@agent.label",
      () => option(pane!, "label"),
      (value) => value === "ship the title fix",
    );

    const title = await waitFor(
      "pane title",
      () => tmux("list-panes", "-t", SESSION, "-F", "#{pane_title}"),
      (value) => value.includes("ship the title fix"),
    );
    // pi builds `π - <name> - <cwd basename>`; the directory is what tells two
    // panes apart once both are named, so it has to survive the rename.
    assert.match(title, /^π - ship the title fix - /);
    assert.ok(title.endsWith(basename(CWD)), title);
  },
);

test(
  "quitting clears every field it published",
  { skip: haveTmux && havePi ? false : UNAVAILABLE, timeout: 60_000 },
  async () => {
    // tmux options outlive the process that wrote them. A block left behind
    // would describe pi to every reader of a pane now running a shell.
    assert.ok(pane, "the first test must have started a pane");
    tmux("send-keys", "-t", SESSION, "C-d");

    await waitFor(
      "the metadata block to clear",
      () => option(pane!, "provider"),
      (value) => value === "",
    );

    for (const field of [
      "state",
      "pid",
      "v",
      "label",
      "cwd",
      "session_id",
      "model",
    ]) {
      assert.equal(
        option(pane!, field),
        "",
        `@agent.${field} should be cleared`,
      );
    }
  },
);
