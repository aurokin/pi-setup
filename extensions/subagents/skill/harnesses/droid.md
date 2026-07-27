- **`droid`** — Factory's harness, billed to the Factory subscription. It buys
  open-weight models on someone else's credit, not a capability pi lacks, so
  **only when the user names it**. Its read-only enforcement is real: the spawn
  denies every mutating tool and refuses the session if the denial did not take.
<!-- section -->
## Droid Harness

**Harness:** `droid`
**Prompt nicknames:** "droid", "Factory", "factory droid", "droid subagent"
**Best default:** `glm-5.2`, and only when the user asks for this harness.

droid's own default is a Claude model, which would spend Factory credits on
inference the Claude Code subscription already covers — so a child that names no
model gets `glm-5.2` instead. Any id in droid's catalog works if you name it:
`kimi-k2.7-code`, `deepseek-v4-pro`, and the gemini/grok/claude/gpt ids it
carries.

| Model | Effort |
| --- | --- |
| `glm-5.2` | the default here; by difficulty |
| `kimi-k2.7-code`, `deepseek-v4-pro` | by difficulty; open-weight, same billing |

**Thinking budgets:** `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`.
droid's own scale is a superset of these, so they pass through unchanged; a
model that does not support the level you asked for is clamped by droid, not by
the extension.

Requires the `droid` CLI installed and `FACTORY_API_KEY` in the environment —
the SDK will not read droid's own login.
