# Unbuilt

Design notes for things this setup does not have yet, salvaged from the retired
`pi-agent-runtime` repo. Each entry is here because the thinking still applies —
the parts that were superseded by shipped extensions were dropped rather than
carried, and entries get deleted as they ship rather than annotated as done.

Shipped since this file was written: persisted goals, as `extensions/goal`. It
kept the part worth copying — the model may only report `complete` or `blocked`,
while set, pause, resume, and clear stay the user's — and dropped the budget and
token accounting, which had no consumer here.

Two things stayed behind deliberately. The managed-runtime sandbox work
(Bubblewrap namespaces, credential leasing, ACL-level write evidence) was
Linux-only and is not being ported. Host-specific configuration history and
notes on non-public source live in the private archive; nothing here should
grow a reference to either.

## Context observability

A `/context-budget` command reporting what pi's extension API already exposes:
active model, current tokens and context window, percent used, tokens until
compaction, computed reserve and max output, system prompt size, loaded context
files, skills count, and active tool selection.

`extensions/shared/context-utilization.ts` already does the percent and
token formatting for child agents, so a command would reuse it rather than
start over.

What pi does not expose, and what a Claude-style `/context` breakdown would
need first:

- Tokens by system prompt section.
- Tokens by tool schema, separating built-ins from custom and MCP tools.
- Tokens by message category: user text, assistant text, tool calls, tool
  results, images, attachments.
- Tokens by source: project files, context files, skills, prompt templates.
- Tokens after pi's pre-provider transforms, not raw session history.
- Compaction state beyond total usage — last boundary, summary tokens, kept
  recent tokens, stale-trigger suppression.

Without those, estimates fall back to `chars / 4`, which is fine for a live
gut-check and not fine for a breakdown table that looks authoritative.

One constraint worth keeping: the command must not print context file contents
or prompt text. Both routinely carry private project instructions.

## Session topology

The retired extension added `/sessions [filter]` (select a project session by
name, id, cwd, or message text), `/side <name>` (switch to or create a named
child session), and `/handoff-lite <goal>` (create a linked fresh session and
load a handoff draft into the editor, carrying parent metadata, the latest
compaction summary, and recent turns).

**`/btw` means something else now.** In that extension it parked a private note
in the session JSONL as metadata that was never sent to the model. In this repo
it forks the conversation to a side agent that answers a question. Same name,
near-opposite behavior — worth knowing before reading any older note.

Two design rules held up well enough to reuse:

- Drafts load into the editor instead of auto-submitting a prompt. The user
  reviews before a turn starts.
- Session-switching commands refuse to run while the agent is busy.

## Patterns worth stealing

**Automatic rubber-duck triggering.** Copilot CLI runs its critic at
high-leverage moments — after planning, mid-implementation, after tests, after
repeated failures — rather than only on request, and uses a different model
family from the main session. We have the role; the trigger is what is missing.
The constraint that makes it tolerable is not slowing down trivial edits.

**Background jobs that outlive the process.** `background-terminals` already
does the wakeup half — it settles a job and delivers the result as a follow-up
rather than making the model poll. What is missing is durability: persist each
job with id, status, summary, output path, model, cwd, and timestamps, cap what
the model sees, keep the full output on disk. `/loop` declined the same problem
for the same reason (a revived job has no obviously correct session to report
into), so this needs an answer to that before it needs code.

**Plan mode.** Pi ships an upstream plan-mode extension for read-only planning
with an explicit execute handoff; adapting it beats writing one.

References that are public: `~/code/upstream/codex/codex-rs/ext/goal/`,
`~/code/upstream/pi-mono/packages/coding-agent/examples/extensions/`.

## Still-open questions

- Should advisor or side-agent output enter the main conversation as a visible
  message, a hidden context item, or a file-backed artifact referenced by path?
  (`/btw` currently answers this by keeping output out of the parent thread
  entirely, which is not obviously right for every role.)
- Should background jobs wake only the UI, or enqueue a model-visible message
  that can trigger automatic continuation? (`background-terminals` answers this
  with a follow-up message; whether that generalises to durable jobs is open.)
- Should `/handoff-lite` become `/handoff` if a model-generated version is
  built, or keep separate names for the cheap and the generated variants?
