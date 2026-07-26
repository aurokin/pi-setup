# sleep

An agent that cannot wait has two ways to handle "check back in five minutes",
and both are bad. It can poll — a model call per attempt, each one re-reading a
context it already knows — or it can assume the time passed and act on a state
it never checked.

Codex added a sleep tool for this (`codex-rs/core/src/tools/handlers/sleep.rs`).
This is the same tool on pi's extension API.

```
sleep({ duration_ms: 120000, reason: "waiting for the canary to roll out" })
```

## The property that makes it safe

A sleep the user cannot get out of is worse than no sleep at all: they type, and
the session ignores them for the next eleven minutes.

So the wait is a race between the timer and new input, and input wins. Anything
the user sends ends the sleep immediately, and the model is told it was cut
short so it reads the message instead of resuming what it was doing.

Codex runs that race over a channel — `tokio::select!` on a timer and an
activity receiver. Pi exposes queued input as `ctx.hasPendingMessages()`, a
boolean with no event to await, so this races a poll instead. `POLL_INTERVAL_MS`
(250ms) is the resulting wake-up latency and the only behavioural difference
from the design it copies.

The pending check runs *before* the first wait, as codex's does. Input that
arrived while the model was deciding to sleep is exactly the input a sleep
should yield to, and checking only after the first delay would sit on it for a
poll interval — or, for a sleep shorter than one, for the entire duration.

## Bounds

`1ms` to `12h`, codex's range. The ceiling is enforced twice: in the schema, and
again in the handler, because a provider that ignores the schema would otherwise
be able to park the session for as long as it liked.

The reported duration is wall time, not the duration requested. An interrupted
sleep that claimed the full duration would have the model reasoning about time
that never passed.

## What it is not for

The prompt guidelines push against the failure mode that matters: sleeping in a
poll loop when a blocking command exists. `gh run watch`, `wait`, `--follow`,
and friends return the instant the thing happens and cost one tool call, where
five sleeps cost five model calls and still arrive late.

Sleeping is for when there is genuinely nothing to block on.

## Related

`/loop` (`extensions/loop`) is the between-turns version: same prompt, on a
cadence, over days. Sleep pauses inside one turn and keeps everything the model
has already worked out; a loop starts fresh each time. Watching something for
the next few minutes is a sleep. Watching something for the next two days is a
loop.
