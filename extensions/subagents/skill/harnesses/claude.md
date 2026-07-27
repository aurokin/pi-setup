- **`claude`** — Claude Code's own harness, authenticated by the Claude
  subscription rather than API credits. Note it is *not* the only way to reach a
  Claude model: `opencode` serves opus, sonnet, fable, and haiku to the pi
  harness directly. So this is a choice of harness and billing path, not of
  model family. Pick it when the user names Claude Code, or when its own tooling
  is the point.
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
