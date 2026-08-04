# Background terminals

Background terminals run long-lived shell commands without blocking the agent.
The extension exposes `bg_start`, `bg_status`, `bg_list`, and `bg_kill`, plus a
read-only `/ps` interface for people using the TUI.

## Process contract

Commands run through the platform shell with stdin disconnected. They are for
servers, watchers, and long builds, not interactive programs. Each process gets
its own process group where the platform supports it, so termination covers the
shell and its descendants rather than leaving grandchildren behind.

Termination first requests a graceful stop, then escalates after a bounded wait.
Natural exit races are preserved: a process that exits before the signal is
reported as exited, not killed. Session shutdown disposes the runtime and stops
all remaining process trees. Terminals do not survive reloads, forks, or process
exit.

## Output

Stdout and stderr remain separate. Each stream retains a bounded newest tail in
memory and writes the full capture to a private spill file with its own disk
limit. Truncation occurs on UTF-8 boundaries, and status output points to the
spill file when the in-memory head was dropped.

The manager keeps a bounded history of settled terminals. Running terminals are
never pruned to make room for history.

## Completion delivery

A settled terminal produces one follow-up message so the model can react without
polling. A result already consumed by `bg_kill` or another explicit status path
is removed from deferred delivery. The pending map is keyed by terminal id, so
the first consumer wins and duplicate completion messages cannot occur.

Follow-ups wait for the current agent run to settle rather than interrupting a
stream. If delivery fails during a session transition, the result remains
eligible for a later settled-boundary retry.

## UI boundary

The Effect service owns process state and cleanup. TUI components use a
synchronous read model for snapshots and subscriptions; they never reach into
the Effect runtime during rendering. A small widget appears only while processes
are running, and `/ps` provides list and per-terminal views.

## Source map

- `index.ts`: tools, lifecycle hooks, UI wiring, and completion delivery
- `src/manager.ts`: process ownership, limits, termination, and snapshots
- `src/output.ts`: bounded stream retention
- `src/result-delivery.ts`: one-shot completion handoff
- `src/ui/`: `/ps` and output rendering
- `*.test.ts`: process-tree, buffering, lifecycle, and delivery invariants

`implementation-guide.md` is the historical pre-implementation plan. Its pinned
versions and commands are not current guidance.
