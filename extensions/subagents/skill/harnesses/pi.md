<!-- section -->
## Pi Harness

**Harness:** `pi`
**Prompt nicknames:** "pi", "pi agent", "pi subagent"
**Best default:** Use when the user does not request another harness.

Pi can address any model shown by `pi --list-models`, which is far more than it should route to. Set both `model` and `reasoning_effort` explicitly; omitting them silently inherits the parent's. Prefer `provider/model-id` — a bare model id only works when unambiguous.

| Model | Effort |
| --- | --- |
| `openai-codex/gpt-5.6-sol` | by difficulty; the default for pi children |
| `openai-codex/gpt-5.6-luna` | `xhigh`, trivial precisely-specified tasks only |

Claude models appear on this menu through `opencode` and `openrouter`. Do not route to them: they spend credit meant for open-weight work on models the Claude Code subscription already covers.

**Thinking budgets:** `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. These map directly to pi thinking levels. Do not reach for `max` on your own.
