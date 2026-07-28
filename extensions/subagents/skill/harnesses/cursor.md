- **`cursor`** — Cursor's agent, billed to the Cursor subscription. Like droid
  it buys billing, not capability, so **only when the user names it** — and read
  it twice before sending a `reader` there: what it withholds is Cursor's plan
  mode, not a tool policy this extension controls.
<!-- section -->
## Cursor Harness

**Harness:** `cursor`
**Prompt nicknames:** "cursor", "cursor agent", "cursor subagent"
**Best default:** `default`, and only when the user asks for this harness.
`default` is Cursor's Auto, which **currently resolves to Grok 4.5** — Cursor's
choice, not a fixed id, so it can move without notice. Name a model explicitly
if which one you get matters.

Model ids are the SDK catalog's plain ids — `default`, `composer-2.5`,
`gpt-5.6-sol` — **not** the `cursor-grok-4.5-low` names the CLI prints.

One consequence worth using: Grok is a different model family from both the
Claude and GPT routes above, so a cursor `advisor` or `rubber-duck` is a
genuinely independent second opinion rather than the same family re-asked.
That is the one role where this harness buys something the roster cannot.

**Two limitations that change what you may send here.**

- **Read-only is weaker than on every other harness.** The SDK has no tool
  allow/deny list, so a read-only role runs in Cursor's `plan` mode instead.
  What that withholds is Cursor's decision, it can change without notice, and
  nothing here can verify it held. Do not treat a cursor `reader` as enforced
  read-only.
- **A write-capable cursor child sees this process's whole environment.** It
  runs in-process rather than as a subprocess, so unlike the other harnesses
  there is no filtered environment between it and the parent's credentials.

**Thinking budgets:** `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`,
clamped onto whatever parameter the chosen model actually exposes. On `default`,
or when the catalog is unreachable, the effort is dropped rather than guessed —
which is not the same as running cheap: Grok 4.5's own default is `high`, so a
`default` child omitting an effort is a high-effort one. Name the model if you
want a low-effort run.

Requires `CURSOR_API_KEY` in the environment.
