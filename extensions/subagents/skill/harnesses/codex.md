- **`codex`** — GUI work that `agent-browser` cannot reach: native macOS
  applications, simulators, screenshots of arbitrary windows. Browsers and
  Electron apps (Slack, VS Code, Figma, Notion) are **not** in this category —
  the `agent-browser` skill covers them from inside pi and asks to be preferred
  over any other browser tooling.
<!-- section -->
## Codex Harness

**Harness:** `codex`
**Prompt nicknames:** "codex", "Codex CLI", "codex agent", "codex subagent"
**Best default:** `gpt-5.6-sol`. Do not use anything else unless the user asks for it.

| Model | Effort |
| --- | --- |
| `gpt-5.6-sol` | by difficulty; `high` for hard coding work |
| `gpt-5.6-luna` | `xhigh`, trivial precisely-specified tasks only |

**Thinking budgets accepted by the extension:** `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. Codex maps these to the nearest effort supported by the selected model; `off`/`minimal` become `minimal`, while `max` becomes the highest extension-supported Codex effort.

Requires the Codex CLI to be installed and authenticated.
