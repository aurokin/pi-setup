/**
 * The `@agent.*` values this session publishes, and when they change.
 *
 * Pure: the tmux writes live in `index.ts`. What is worth testing here is the
 * state machine, because the states are not independent — a turn can be running
 * *and* blocked on a question at the same time, and only one of those is the
 * answer.
 */

/** Contract version implemented here (agentscan `docs/metadata-contract.md`). */
export const CONTRACT_VERSION = "1";

/** The provider slug agentscan already knows pi by. */
export const PROVIDER_SLUG = "pi";

/**
 * Every field we ever write, so shutdown can clear exactly what it set.
 *
 * tmux options outlive the process, and a stale block would mislabel whatever
 * runs in the pane next. `pid` guards that case for crashes; this list handles
 * the clean exit.
 */
export const PUBLISHED_FIELDS = [
  "provider",
  "state",
  "pid",
  "v",
  "label",
  "cwd",
  "session_id",
  "model",
] as const;

export type PublishedField = (typeof PUBLISHED_FIELDS)[number];

/**
 * `waiting` is the state the contract calls out as the one no heuristic can
 * produce, and the reason this extension is worth its weight: a pi sitting on
 * an `ask_user` question looks exactly like a pi thinking hard.
 */
export type AgentState = "idle" | "busy" | "waiting";

export interface RunState {
  turnStarted(): AgentState;
  turnEnded(): AgentState;
  blocked(toolCallId: string): AgentState;
  unblocked(toolCallId: string): AgentState;
  current(): AgentState;
}

export function createRunState(): RunState {
  let turnActive = false;
  // By id rather than a counter: pi can run tools in parallel, and an end event
  // for a call we never saw start must not decrement the wrong thing.
  const blocking = new Set<string>();

  const current = (): AgentState => {
    if (blocking.size > 0) return "waiting";
    return turnActive ? "busy" : "idle";
  };

  return {
    turnStarted() {
      turnActive = true;
      return current();
    },
    turnEnded() {
      turnActive = false;
      // A turn that was interrupted mid-question leaves no end event for the
      // tool, so the block has to be dropped here or the pane stays "waiting"
      // forever.
      blocking.clear();
      return current();
    },
    blocked(toolCallId) {
      blocking.add(toolCallId);
      return current();
    },
    unblocked(toolCallId) {
      blocking.delete(toolCallId);
      return current();
    },
    current,
  };
}

/** Tools whose execution means pi is blocked on a human, not on a model. */
export function isBlockingTool(toolName: string) {
  return toolName === "ask_user";
}

/**
 * tmux arguments for one field write.
 *
 * `-t` rather than relying on "current pane": the write is issued from pi's own
 * process, and `$TMUX_PANE` is the only thing that reliably names the pane it
 * is drawing in.
 */
export function setOptionArgs(
  pane: string,
  field: PublishedField,
  value: string,
) {
  return ["set-option", "-p", "-t", pane, `@agent.${field}`, value];
}

export function unsetOptionArgs(pane: string, field: PublishedField) {
  return ["set-option", "-p", "-t", pane, "-u", `@agent.${field}`];
}

/**
 * Every unset in one tmux invocation, so shutdown is a single blocking call.
 *
 * It has to be one call and it has to be synchronous: `session_shutdown` runs
 * while pi is already on its way out, and eight queued async spawns are eight
 * chances to lose the race with the process ending. `;` is tmux's own command
 * separator and is a distinct argv entry, never shell-interpreted.
 */
export function clearAllArgs(pane: string) {
  return PUBLISHED_FIELDS.flatMap((field, index) =>
    index === 0
      ? unsetOptionArgs(pane, field)
      : [";", ...unsetOptionArgs(pane, field)],
  );
}

/**
 * A value worth writing, or undefined meaning "clear this field".
 *
 * Trim only. An empty option means absent in the contract, so a field with
 * nothing in it is unset rather than written blank — but the value itself is
 * left alone, because most of these are identifiers: a cwd of
 * `/Users/me/My  Project` is a real directory, and collapsing its spaces names
 * a different one.
 */
export function normalizeValue(value: string | undefined) {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * The same, for the one field that is prose rather than an identifier.
 *
 * A label is a session name, which is whatever someone typed, so it can carry
 * newlines. A multi-line tmux option would put a broken row in every
 * consumer's list, and unlike a path there is nothing to preserve.
 */
export function normalizeLabel(value: string | undefined) {
  return normalizeValue(value?.replace(/\s+/g, " "));
}
