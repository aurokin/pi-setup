- **`cursor`** — Cursor's agent, billed to the Cursor subscription. Like droid
  it buys billing, not capability, so **only when the user names it** — and read
  it twice before sending a `reader` there: what it withholds is Cursor's plan
  mode, not a tool policy this extension controls.
<!-- section -->
## Cursor Harness

**Harness:** `cursor`
**Prompt nicknames:** "cursor", "cursor agent", "cursor subagent"
**Best default:** `default` (Cursor's own pick), and only when the user asks for
this harness.

Model ids are the SDK catalog's plain ids — `default`, `composer-2.5`,
`gpt-5.6-sol` — **not** the `cursor-grok-4.5-low` names the CLI prints.

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
or when the catalog is unreachable, the effort is dropped rather than guessed.

Requires `CURSOR_API_KEY` in the environment.
