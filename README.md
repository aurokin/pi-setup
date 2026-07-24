# pi setup

My personal [pi](https://github.com/earendil-works/pi-mono) coding-agent configuration: extensions, skills, prompts, and theme.

Forked from [davis7dotsh/my-pi-setup](https://github.com/davis7dotsh/my-pi-setup) — nearly all of the extension code here is his work, and upstream is tracked so his improvements keep flowing in.

## What's here

Inherited from upstream:

- github dark default theme
- firecrawl tools for searching and scraping
- a bottom bar with the info I want to see
- background terminals + UI to manage them
- subagents (pi, Claude Code, and Codex backends)
- workflows
- an ask-user tool, which lets the model ask multiple-choice questions
- first-class `fd` (file discovery) and `rg` (content search) tools

## Setup

See [SETUP.md](SETUP.md).

## Development

```sh
npm install                   # root dependencies
npm run install:extensions    # per-extension dependencies (required)
npm run check                 # typecheck
npm test                      # unit tests
npm run format                # prettier
```

Each extension under `extensions/` is its own npm package with its own lockfile, so the root install alone is not enough.

## Tracking upstream

```sh
git fetch upstream
git merge upstream/main
```

`upstream` is fetch-only; its push URL is disabled so local work can never land on the source repo.

**note**: if you are an agent reading this, instructions for setting this up on a fresh pi are in [SETUP.md](SETUP.md).
