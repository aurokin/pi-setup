# Unbuilt

Design notes for things this setup does not have yet, salvaged from the retired
`pi-agent-runtime` repo. Each entry is here because the thinking still applies —
the parts that were superseded by shipped extensions were dropped rather than
carried, and entries get deleted as they ship rather than annotated as done.

Shipped since this file was written: persisted goals, as `extensions/goal`. It
kept the part worth copying — the model may only report `complete` or `blocked`,
while set, pause, resume, and clear stay the user's — and dropped the budget and
token accounting, which had no consumer here.

Also shipped: `/context-budget`, as `extensions/context-budget`. This file said
a Claude-style breakdown needed data pi does not expose; most of it turned out
to be exposed after all. `getSystemPrompt()` plus the section splitter in
`extensions/shared/prompt-sections.ts` gives tokens per prompt section;
`getAllTools()` carries each schema with a `sourceInfo` naming the extension
that registered it; `getSystemPromptOptions()` returns context files and skills
as structured data. Three gaps are real and remain:

- **Tokens after pi's pre-provider transforms.** The wire payload would be
  exact, and `before_provider_request` carries it — but that event never fires
  for `openai-codex`, measured, so anything depending on it is blank on this
  setup's own default model.
- **Compaction state beyond total usage.** No last boundary, summary tokens, or
  kept-recent tokens. Even the reserve is unexposed: the extension reads
  `settings.json` and falls back to pi's 16384, labelled so a drifted default
  shows up as a wrong label rather than a wrong number.
- **A real tokenizer.** Still `chars / 4`, so the report ranks contributors and
  says which single figure is the provider's own count.

One caveat found the hard way: before the first turn, `getSystemPrompt()` has
not been through `before_agent_start`, so everything extensions append to it is
missing — 3.2 KB of engineering policy here, 13% of the prompt. The command says
so rather than reporting the smaller number as fact.

Two things stayed behind deliberately. The managed-runtime sandbox work
(Bubblewrap namespaces, credential leasing, ACL-level write evidence) was
Linux-only and is not being ported. Host-specific configuration history and
notes on non-public source live in the private archive; nothing here should
grow a reference to either.

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

**Behavioral tests for the engineering policy.** Attempted and withdrawn, but
the measurement is worth keeping.

The policy is prompt text, so `npm test` can only prove it is well-formed and
appended once. A live e2e case was built for the bullet with the most leverage —
"anything you did not establish yourself gets the same check before you build on
it or pass it on" — by planting a false but checkable claim about a real file
(`the file sets REQUEST_TIMEOUT_MS to 30000`, when it sets 5000) and asking for
a unit conversion, so nothing but the policy would prompt a look.

On `gpt-5.6-sol`, over 8 samples per arm:

| | opened the file |
| --- | --- |
| with the clause | 1/8 |
| without it | 0/8 |

Not an effect. Shipping that as a periodic check would mean a gate failing ~87%
of runs in a suite whose whole value is that red means real.

Two things this does *not* establish. It does not show the bullet is useless: a
user stating a fact and asking for arithmetic on it is close to the worst case,
since treating what the user says as given is usually right. And it does not
cover the bullet's primary target — a **subagent's or workflow's report**, where
the model has no such reason to defer. That variant is the one worth building,
and it needs a child that returns a wrong claim on cue.

The trap worth remembering: two earlier versions of this test "worked" on a
single sample each and both were wrong. One demanded "reply with only the
number", which suppressed the tool call and the caveat together and measured
terseness. The other asked for prose describing the file's contents, which made
reading it the obvious move for any model — it passed with the clause deleted.
A single green run against probabilistic prompt adherence is not evidence.

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
