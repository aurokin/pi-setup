# /loop

Re-run one prompt on a cadence.

```
/loop 10m check the deploy status and tell me only if something changed
/loop                      # what is running
/loop stop loop-1          # or: /loop stop all
```

The shape it fits is watching: a CI run, a canary, a queue draining, a migration
grinding through rows. The question is the same every time and only the answer
moves.

## Why a fresh turn each time, not a long one

A loop fires `sendUserMessage`, which starts a turn as if the user had typed the
prompt. The alternative — one turn that sleeps between checks — keeps everything
the model already worked out, and that is exactly the problem over hours: the
context grows monotonically with observations that stopped mattering, and by the
tenth check most of it is noise about the first nine.

A fresh turn costs the model its memory of the previous checks, which is why the
prompt should ask for something self-contained ("tell me only if something
changed") rather than something relative ("has it changed since last time?").

For short waits where continuity is the point, `sleep` is the right tool. The
two are complements, not alternatives.

## Three things keep it from running away

**It expires.** Every loop dies after 7 days. Not a safety limit — the process
rarely lives that long — but a statement that a loop is a task with an end.
Expiry beats a fire that is due at the same instant, so a loop cannot outlive
its deadline by a turn.

**It never stacks.** A tick that lands while the agent is mid-turn is *dropped*,
not queued, and the next fire is scheduled from now rather than from the missed
slot. Queueing is the tempting choice and the wrong one: a recurring prompt asks
about the state of something now, so a tick that waited out a ten-minute turn
would ask about a world that has moved on — and several stacked ticks would ask
about it several times, in a row, at cost.

**One minute is the floor.** Anything faster is a poll, and a poll belongs
inside one turn with `sleep`, where the model can see what it already tried.
`/loop 5 check the build` is refused rather than guessed at: five of *something*
is either twelve model calls a minute or a quiet afternoon, and neither is a
guess worth making on the user's behalf.

## Nothing is persisted

Loops live in memory and die with the session. This is a deliberate limit, not
an oversight.

A persisted loop would have to answer "fire into which session?" — and every
answer is wrong. Reviving it in a resumed session means a prompt arriving in a
conversation that has moved on to something else entirely. Reviving it in a new
one means a session that starts by asking a question nobody in it has heard.

The honest scope is: a loop watches something for as long as you are around to
watch it. For work that must outlive the session, a real scheduler
(`cron`, `launchd`, a CI job) is the right tool, and pi is not it.

## The prompt is text, never a command

`sendUserMessage` skips slash-command expansion. `/loop 1h /compact` therefore
sends the literal string to the model rather than compacting every hour — the
prompt is something the model reads, not something the session executes.

## Related

`sleep` (`extensions/sleep`) waits inside a turn. `/goal` (`extensions/goal`)
persists an objective rather than a schedule — what you are trying to achieve,
where a loop is how often you check.
