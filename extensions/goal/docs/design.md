# /goal

One line saying what this session is for, persisted in the session file and
pursued in automatic continuation turns until completion or a blocker is
independently verified.

```
/goal ship the auth migration behind a flag
/goal            # show it
/goal pause      # /goal resume, /goal clear
```

Long sessions drift, and ordinary agent runs stop whether or not the work is
done. Twenty turns after the goal was set the model can be deep in a test helper
with nothing left in history saying what the helper was for. An active goal is
re-injected into the system prompt and starts another run whenever the agent
settles without making a terminal claim. Setting or resuming a goal starts the
first run immediately when the agent is idle; otherwise the current run's
settled boundary rechecks the goal.

## The authority split

Taken from codex (`codex-rs/ext/goal/`), and the reason this is a feature rather
than a note the user could type themselves:

| | |
| --- | --- |
| **User** | set, reword, pause, resume, clear |
| **Model** | submit `complete` or `blocked` for verification — nothing else |

A goal the model can edit is a note it keeps to itself, and it will edit it
toward whatever it just did. A goal it can clear is one that disappears the
moment the work gets hard. Both failures look like success from inside the
transcript, which is what makes the restriction worth enforcing in code rather
than asking for in a prompt.

It is enforced in `src/goal.ts`, not only in the tool handler, so there is one
place where a transition can be allowed and the tool cannot route around it.
`goal_update` accepts a report only from the run generation that started with an
active, unclaimed goal. Its description also says not to call speculatively when
there is no `Current goal`; the runtime check is the backstop for stale calls.

Because the schema and the allowed statuses are declared in two places — TypeBox
literals need to be spelled out to stay literal — a test pins them together.

## The continuation and verification loop

`agent_settled` is the idle boundary. If the goal is still active, the extension
sends a short hidden follow-up with `triggerTurn: true`; `before_agent_start`
then puts the full current goal in that new run's system prompt. A queued flag is
set before delivery so a synchronously-started run cannot create a duplicate.
The extension never queues a continuation behind a busy parent because pi cannot
retract it if the user pauses or clears the goal first; that parent's eventual
`agent_settled` event re-reads current state instead. A pause, clear, or
replacement also aborts any run already executing against the old goal, and
stop-command feedback is not queued back into that aborted run.

The primary continuation loop deliberately has no hidden turn or attempt cap
across successful runs. Persistent pursuit is the feature, and `/goal pause` and
`/goal clear` are its user-owned stop controls. Provider errors, cancellations,
and runs with no assistant response persist a stopped-continuation marker rather
than auto-retrying; the goal stays active and `/goal resume` explicitly retries
it, including after reload or tree navigation. Verification has a hard
ten-minute deadline. A timeout ends the verifier attempt and leaves the claim
pending for explicit resume rather than guessing at a verdict.

A `complete` or `blocked` report is persisted as a pending claim, not as a final
status. Once the primary run settles, a fresh in-process pi child checks the
claim against current read-only evidence. It receives the exact configured
model and thinking level captured from the claim-producing primary run. The
primary model's claim note and any prior verifier context are bounded, escaped,
and explicitly marked as untrusted data. It also receives a bounded,
XML-escaped transcript of recent primary tool calls and results, marked with the
same trust boundary. Byte limiting keeps the newest evidence, where terminal
checks normally appear. The verifier has no mutating shell and must return a
structured verdict. Its resource loader
disables extensions entirely, preventing lifecycle hooks from creating side
effects; only the built-in `read` tool and the custom structured-output tool are
available.

A confirmed claim becomes the terminal status and stops the loop. A rejected
claim leaves the user-owned objective untouched, stores the verifier's bounded
feedback as explicitly delimited, XML-escaped untrusted evidence in the system
prompt, and reactivates the goal. It starts the next run only if the
claim-producing run itself ended normally; an error or cancellation leaves the
goal active for explicit `/goal resume`. Provider errors, malformed verdicts,
and a ten-minute verification timeout leave the claim pending rather than
pretending it failed or starting an expensive retry loop.

Verification runs detached from the `agent_settled` handler because pi awaits
settled handlers serially. A generation fence and object identity check discard
results after pause, resume, clear, replacement, tree navigation, reload, or
shutdown, and those transitions abort the child as well. Starting any other
primary run also aborts verification: that run can change the worktree after the
child inspected it, so its next settled boundary retries the pending claim from
fresh evidence.

## Why the system prompt

A goal delivered as a message is history. It scrolls away, and compaction may
fold it into a summary weaker than what the user wrote. The system prompt is
reassembled every turn, so the goal is as present on turn fifty as on turn one,
and compaction cannot dilute it.

Only an active goal without a pending claim goes in. A completed goal left in
the system prompt is an instruction to do it again; a paused one is an
instruction the user explicitly suspended; a pending claim must be verified
before either continuing or stopping. All remain in the session as records.

## Persistence

Every change appends a versioned `custom` session entry, last one wins — an
event log, which is what the session file already is. Version 2 adds pending
claims and continuation context; the reader still migrates ordinary version 1
goals, while an older reader rejects v2 instead of mistaking an unverified claim
for active work. Pending claims include the configured provider/model, thinking
level, a runtime-unique source-run id, and a pending/succeeded/failed outcome for
that exact run. A process exit before `agent_end` therefore remains
conservatively pending. Reload preserves model fidelity and requires an explicit
resume when a non-successful run's claim is rejected. Forking carries the goal
for that branch, and `/tree` reloads only `getBranch()`, never a later entry from
an abandoned sibling.

Clearing writes an entry recording the clear rather than removing the previous
one. Dropping it would leave the old goal as the last on record, so a resume
would resurrect a goal the user deleted.

`custom` state entries do not participate in LLM context, so persistence does
not create a stale second copy beside the current system-prompt rendering. Short
custom messages trigger continuation runs and show command or verifier status,
but the full authoritative objective is rendered from current state.

Entries are read defensively: a malformed or future-versioned one yields *no*
goal rather than a partially-read one. Sessions get hand-edited, shared via
`/share`, and written by other versions of this code, and half-reading one would
put text in the system prompt that the user never wrote.

## Related

`/loop` (`extensions/loop`) schedules how often you check something; a goal says
what you are trying to achieve. A goal plus a loop is a plausible pairing —
"ship the migration" as the goal, "check the rollout every 20m" as the loop.
