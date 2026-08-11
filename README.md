# pi setup

My personal [pi](https://github.com/earendil-works/pi-mono) coding-agent configuration: extensions, skills, and theme.

Forked from [davis7dotsh/my-pi-setup](https://github.com/davis7dotsh/my-pi-setup). Upstream remains tracked, and local additions stay separate where practical so updates are easy to merge.

## What's here

Inherited from upstream:

- web tools for Exa-first search, scrape, site exploration, Firecrawl crawl,
  and image search ([routing and capability matrix](extensions/web-tools/README.md))
- a bottom bar with the info I want to see
- background terminals + UI to manage them
  ([design](extensions/background-terminals/docs/design.md))
- subagents (pi, Claude Code, and Codex backends)
  ([design](extensions/subagents/docs/design.md))
- workflows
- an ask-user tool, which lets the model ask multiple-choice questions
- first-class `fd` (file discovery) and `rg` (content search) tools

Ours:

- a tokyo night theme matching the `~/.dotfiles` palette — tokyonight-night, with
  the same `#101217` background the terminal config uses
- a system prompt layer appending our engineering preferences to every turn
  ([design](extensions/system-prompt/docs/design.md))
- codex server-side compaction: replaces pi's text summary with the opaque
  artifact OpenAI's Responses service returns, which restores context far more
  faithfully ([design](extensions/codex-compaction/docs/design.md))
- a `sleep` tool, so waiting for a deploy costs one tool call instead of a poll
  loop — and any input from you ends the wait
  ([design](extensions/sleep/docs/design.md))
- `/loop`, which re-runs one prompt on a cadence for watching a thing over hours
  ([design](extensions/loop/docs/design.md))
- `/goal`, an objective pursued across automatic continuation turns until an
  independently verified completion or blocker ([design](extensions/goal/docs/design.md))
- `/effort`, a menu for the thinking level, offering only what the current model
  supports — `shift+tab` cycles the same setting without one
- `/context-budget`, which attributes this session's context window to the
  prompt, tool schemas, context files, and history that are filling it
  ([design](extensions/context-budget/docs/design.md))
- agent metadata published to tmux (`@agent.*`), so tools reading the pane get
  ground truth — provider, model, session id, and a live `idle`/`busy`/`waiting`
  state — instead of scraping the rendered TUI. `waiting` is the one no
  heuristic can produce: a session sitting on a question
- a session title taken from the first prompt, so a pane reads
  `π - fix the flaky auth test - repo` rather than the directory six times over;
  `/rename` when the first prompt was not what the session became
- Droid and Cursor subagent backends on top of upstream's three, plus a
  `subagents` skill rendered at startup from the harnesses actually configured,
  so it can never list one that is not there

## Setup

See [SETUP.md](SETUP.md).

## Documentation

[docs/README.md](docs/README.md) maps setup, testing, current feature design,
historical research, and deferred work. [docs/unbuilt.md](docs/unbuilt.md)
collects the remaining gaps and experiments that did not ship.

## Development

```sh
pnpm install                  # root and every extension workspace
pnpm check                    # typecheck
pnpm test                     # hermetic unit tests
pnpm test:e2e                 # live integrations; may use providers or external CLIs
pnpm format                   # prettier
```

`pnpm test` never touches the network. Live tests may skip when a credential or
CLI is unavailable, and some are periodic canaries for external behavior rather
than change-triggered regression tests. See [docs/testing.md](docs/testing.md)
for scope and cadence.

Most directories under `extensions/` are pnpm workspaces, so one root install
covers them.

## Tracking upstream

```sh
git fetch upstream
git merge upstream/main
```

`upstream` is fetch-only; its push URL is disabled so local work can never land on the source repo.
