# /goal

One line saying what this session is for, restated to the model every turn and
persisted in the session file.

```
/goal ship the auth migration behind a flag
/goal            # show it
/goal pause      # /goal resume, /goal clear
```

Long sessions drift. Twenty turns after the goal was set the model is deep in a
test helper, and nothing left in its context says what the test helper was for.

## The authority split

Taken from codex (`codex-rs/ext/goal/`), and the reason this is a feature rather
than a note the user could type themselves:

| | |
| --- | --- |
| **User** | set, reword, pause, resume, clear |
| **Model** | report `complete` or `blocked` — nothing else |

A goal the model can edit is a note it keeps to itself, and it will edit it
toward whatever it just did. A goal it can clear is one that disappears the
moment the work gets hard. Both failures look like success from inside the
transcript, which is what makes the restriction worth enforcing in code rather
than asking for in a prompt.

It is enforced in `src/goal.ts`, not in the tool handler, so there is one place
where a transition can be allowed and the tool cannot route around it. The model
also cannot report against a *paused* goal: pausing is the user saying "not
now," and marking it complete anyway is the model deciding the pause is over.

Because the schema and the allowed statuses are declared in two places — TypeBox
literals need to be spelled out to stay literal — a test pins them together.

## Why the system prompt

A goal delivered as a message is history. It scrolls away, and compaction may
fold it into a summary weaker than what the user wrote. The system prompt is
reassembled every turn, so the goal is as present on turn fifty as on turn one,
and compaction cannot dilute it.

Only an *active* goal goes in. A completed goal left in the system prompt is an
instruction to do it again; a paused one is an instruction the user explicitly
suspended. Both stay in the session as a record.

## Persistence

Every change appends a `custom` session entry, last one wins — an event log,
which is what the session file already is. That means forking a session carries
the goal that branch had at the time, and `/tree` reloads whatever the branch
you moved to says.

Clearing writes an entry recording the clear rather than removing the previous
one. Dropping it would leave the old goal as the last on record, so a resume
would resurrect a goal the user deleted.

`custom` entries do not participate in LLM context, so the goal reaches the
model exactly once — through the system prompt — rather than twice with two
different histories.

Entries are read defensively: a malformed or future-versioned one yields *no*
goal rather than a partially-read one. Sessions get hand-edited, shared via
`/share`, and written by other versions of this code, and half-reading one would
put text in the system prompt that the user never wrote.

## Related

`/loop` (`extensions/loop`) schedules how often you check something; a goal says
what you are trying to achieve. A goal plus a loop is a plausible pairing —
"ship the migration" as the goal, "check the rollout every 20m" as the loop.
