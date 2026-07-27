---
name: subagents
description: How to delegate work to subagents — whether to delegate at all, which harness and model to pick, how to brief a child, and what to do with what it returns. Invoke before spawning a subagent, not only when the user asks for one by name.
---

# Subagents

Each subagent is headless, has its own context window, cannot see the parent conversation, cannot ask the user, and cannot spawn subagents or workflows. Give every child a self-contained prompt with paths, constraints, and the expected report.

## Delegate or not

- Don't delegate what is faster in context: a typecheck, a lint, one test, reading a normal-sized file. The spawn costs more than the work.
- Delegate concrete, bounded work that can run while you keep doing something useful. Keep work that is tightly coupled to your next step, urgent, or too hard to brief.
- **When heavy reading feeds a judgment, split it.** Delegate the reading, keep the judgment. Shipping out the whole decision because part of it was expensive is the most common delegation mistake.
- Match fan-out to payoff. A few well-briefed children beat a swarm, and every child has to earn its tokens.
- **Never tiebreak on convenience.** Doing it yourself because you are already here is not a reason; neither is spawning because spawning is easy.
- If the harness you need is unavailable, say so. Never silently do it solo and present the result as if the delegation happened.
- **Egress**: a `claude` or `codex` child ships everything it reads to that provider. Do not send credential-bearing or private content to a provider without the user's explicit agreement for that provider.

## Choosing a harness

**Default to pi.** It reaches every model in the menu, its children get their own
context window, and its roles enforce read-only in the tool list rather than in
prose. Leaving the harness costs a process spawn and a second copy of the
model's tooling; it buys a capability only in the two cases below.

- **`claude`** — Claude Code's own harness, authenticated by the Claude
  subscription rather than API credits. Note it is *not* the only way to reach a
  Claude model: `opencode` serves opus, sonnet, fable, and haiku to the pi
  harness directly. So this is a choice of harness and billing path, not of
  model family. Pick it when the user names Claude Code, or when its own tooling
  is the point.
- **`codex`** — GUI work that `agent-browser` cannot reach: native macOS
  applications, simulators, screenshots of arbitrary windows. Browsers and
  Electron apps (Slack, VS Code, Figma, Notion) are **not** in this category —
  the `agent-browser` skill covers them from inside pi and asks to be preferred
  over any other browser tooling.
- **`pi`** — everything else, including bulk implementation, long reading, and
  investigation. A pi child running `gpt-5.6-sol` is the same model a codex
  child would run; shelling out adds a process, not a capability.

One real difference, for the rare case it matters: pi children run in-process,
so a hung one does not surface as a failed exit — it simply never settles.
`claude` and `codex` children are separate processes. Needing that isolation is
a reason to leave the harness. Being able to leave it is not.

## Briefing a child

The child shares none of your context, so the prompt carries all of it: paths, constraints, what is already decided, and the exact shape of the report you want back.

When you are asking a child to weigh a decision rather than do a task, give it your current leaning **and the strongest case against it**. A brief that only argues for your leaning gets it ratified, not examined. Quote evidence verbatim — the actual error, the actual diff hunk — rather than your summary of it.

## Reading what comes back

A child's report is evidence, not a conclusion. Before you act on a claim or relay it to the user, check the cited code or behavior yourself, and separate what you confirmed from what you did not. A confident report of a command that does not exist reads exactly like a correct one.

## Model roster

**Stay on the session's configured provider unless the user names another.** The
model list here runs to hundreds of entries across several providers because it
is a menu, not a routing table — it exists so the user can pick, not so you can
shop. The roles below say what a model is *for* when one is chosen; they are
never a licence to move work to a provider the user did not ask for.

Durable roles. Effort runs `low`, `medium`, `high`, `xhigh` — pick by task difficulty, medium is the usual default. Never choose `max` yourself, even where a harness offers it. `max` is the user's to pick: fine when they ask for it, and fine when a pi child inherits it from a session already running there.

| Model | Role |
| --- | --- |
| `gpt-5.6-sol` | Co-equal to opus, different edge. Its edge is **determination** — it grinds a hard task down. Send work that simply has to get finished. |
| `opus` (5) | Co-equal to sol. Its edge is **taste** — design, APIs people like to consume, naming, copy. Send work that has to be *right*. |
| `sonnet` (5) | Simple tasks only, normally `low`. It may run one bounded step; it never plans or supervises other agents. |
| `gpt-5.6-luna` | Very simple, precisely specified tasks. Always `xhigh`. |
| `fable` (5) | Best taste, best planner and reviewer. It under-scopes — tell it how wide to read. Slow, with a cost premium: **only when the user names it**. |
| `gpt-5.6-terra` | Dormant; not in use. |
| Haiku, GPT-5.5 or older | Never. |

## Pi Harness

**Harness:** `pi`
**Prompt nicknames:** "pi", "pi agent", "pi subagent"
**Best default:** Use when the user does not request another harness. It inherits the parent model and thinking level when `model` or `reasoning_effort` is omitted.

Do not use models from the Anthropic provider even if one appears in the model list.

Pi can use any model shown by `pi --list-models`. Prefer `provider/model-id`; a bare model id only works when unambiguous. Common picks in this environment:

| Model | Effort |
| --- | --- |
| inherited parent model (default) | inherited |
| `openai-codex/gpt-5.6-sol` | by difficulty |
| `opencode/claude-fable-5` | `medium`, and only when the user names fable |

**Thinking budgets:** `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. These map directly to pi thinking levels. Do not reach for `max` on your own; asked for or inherited, it is fine.

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

## Spawn and Manage

Call `subagent_spawn` with a complete `prompt`, short `name`, chosen `harness`, and optional `working_dir`, `model`, and `reasoning_effort`. At most four subagents run concurrently.

- `subagent_check({ id })`: peek without blocking.
- `subagent_list()`: list all runs.
- `subagent_wait({ ids })`: block only when results are required to proceed.
- `subagent_cancel({ ids })`: stop runs while preserving partial transcripts.
- `/subagents`: inspect or take over a run interactively.

Results return automatically. After spawning, continue useful parent work instead of immediately waiting.
