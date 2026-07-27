# pi setup

My personal [pi](https://github.com/earendil-works/pi-mono) coding-agent configuration: extensions, skills, and theme.

Forked from [davis7dotsh/my-pi-setup](https://github.com/davis7dotsh/my-pi-setup) — nearly all of the extension code here is his work, and upstream is tracked so his improvements keep flowing in.

## What's here

Inherited from upstream:

- firecrawl tools for searching and scraping
- a bottom bar with the info I want to see
- background terminals + UI to manage them
- subagents (pi, Claude Code, and Codex backends)
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
- `/goal`, an objective restated to the model every turn, which only you can
  change ([design](extensions/goal/docs/design.md))

## Setup

See [SETUP.md](SETUP.md).

## Not built yet

[docs/unbuilt.md](docs/unbuilt.md) collects design notes for things this setup
does not have — context observability, session topology, and patterns worth
taking from other agents.

## Development

```sh
npm install                   # root dependencies
npm run install:extensions    # per-extension dependencies (required)
npm run check                 # typecheck
npm test                      # unit tests — hermetic, ~25s
npm run test:e2e              # live tests — real pi + real provider, ~90s, costs money
npm run format                # prettier
```

`npm test` never touches the network, so a red result there is always a real
regression. Everything that needs credentials or a running pi lives in `e2e/`,
including the only detector for the codex compaction beta flag being withdrawn
— worth running on a schedule rather than only on change.

Each extension under `extensions/` is its own npm package with its own lockfile, so the root install alone is not enough.

## Tracking upstream

```sh
git fetch upstream
git merge upstream/main
```

`upstream` is fetch-only; its push URL is disabled so local work can never land on the source repo.

**note**: if you are an agent reading this, instructions for setting this up on a fresh pi are in [SETUP.md](SETUP.md).
