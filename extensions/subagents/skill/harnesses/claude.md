- **`claude`** — Claude Code's own harness, authenticated by the Claude
  subscription rather than API credits. **Every Anthropic model goes here
  unless the user says otherwise.** It is not the only route to one —
  `opencode` and `openrouter` serve opus, sonnet, fable, and haiku to the pi
  harness directly — but those spend open-weight credit on inference the
  subscription already covers. Knowing the other routes exist is for when the
  user names one; the default is this harness.
<!-- section -->
## Claude Code Harness

**Harness:** `claude`
**Prompt nicknames:** "claude", "Claude Code", "claude agent", "claude subagent", "cc"
**Best default:** `opus`. Reach for fable only when the user names it.

| Model hint | Model | Effort |
| --- | --- | --- |
| `opus` | latest Claude Opus | by difficulty |
| `sonnet` | latest Claude Sonnet | `low`, simple steps only |
| `fable` | latest Claude Fable | `high`, only when named |

**Thinking budgets:** `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. The extension maps these to Claude thinking-token budgets: 0, 1,024, 4,096, 10,000, 16,000, 32,000, and 63,999 tokens respectively.

Requires Claude Code to be installed and authenticated.
