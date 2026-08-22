# Setup

Clone the shared agent policy beside this repo, then install both:

```sh
git clone git@github.com:aurokin/agent-policy.git ~/code/agent-policy
git clone git@github.com:aurokin/pi-setup.git ~/code/pi-setup
cd ~/code/agent-policy
pnpm install --frozen-lockfile
cd ~/code/pi-setup
pnpm install --frozen-lockfile
./scripts/setup-user-links.sh
```

`pi-setup` links `@aurokin/agent-policy` from the sibling checkout. That repo
owns the portable policy used by Pi, Codex, and Claude; Pi-specific prompt
composition remains here.

One Pi install covers every extension. Most directories under `extensions/`
are their own package, and each is a pnpm workspace matched by
`pnpm-workspace.yaml`, so `pnpm install` resolves them together and installs the
shared dependencies once rather than once per extension.

## Linking it into pi

Pi looks for `extensions/`, `themes/`, and `skills/` under `~/.pi/agent`.
`scripts/setup-user-links.sh` points the resources owned by this checkout there:

- `extensions/`
- `themes/`
- the root `node_modules/`
- the `background-terminals` and `linearis` skills

The script is idempotent and refuses to replace an existing path. Use its
read-only mode to diagnose a host:

```sh
./scripts/setup-user-links.sh --check
```

The `node_modules` link is not optional. Pi loads an extension through the
symlink path without resolving it to the checkout first, so Node searches up
from `~/.pi/agent/extensions/<name>/`. The link at `~/.pi/agent/node_modules`
is how those extensions reach the dependencies installed once at the repo
root. Without it, every extension importing `effect` or the Claude Agent SDK
fails to load with `Cannot find module`, and Pi carries on without them.

Skills remain individual links because `~/.pi/agent/skills` is shared with
skills installed from other sources.

Nothing in `~/.agents/skills` needs linking: pi reads that directory on its own,
alongside `~/.pi/agent/skills`.

**Do not link a `subagents` skill.** It no longer exists as a static file: the
extension renders it from the harnesses `subagents.json` actually offers and
hands Pi the path at startup, so a linked copy would only shadow it with a stale
list. The setup script reports an existing static copy but never removes it;
review that path before deleting anything.

`skills/linearis` is a modified copy of
[linearis-oss/linearis](https://github.com/linearis-oss/linearis)'
`skills/linearis/SKILL.md`, linked here rather than installed with
`npx skills add`. That command fans a skill out to every agent's skill
directory, and this one is wanted for pi alone — pi has no MCP, so it drives
Linear through a CLI. See `skills/linearis/PROVENANCE.md` for what was changed
and how to re-base it on a newer upstream.

Install the CLI with `npm install -g linearis` (Node >= 22), or pin it through
whatever version manager you already use.

**This skill assumes a secret wrapper that is not in this repo.** It tells the
agent to run every command as `with-secret linear -- linearis …`, which injects
`LINEAR_API_TOKEN` for one process from a password manager. If you have no such
wrapper, edit the "Running commands" section of `SKILL.md` to drop the prefix
and export `LINEAR_API_TOKEN` yourself — the rest of the skill is
host-independent.

This is symlinks rather than cloning straight into `~/.pi/agent` because the
agent directory is not only config — `auth.json`, `sessions/`, and
`models-store.json` live there too, and none of them belong in a public repo.

## Faster startup (optional)

Node can cache compiled bytecode between runs instead of recompiling every
module on every start. It is not pi configuration and it lives outside this
checkout, so it is easy to forget it exists:

```sh
export NODE_COMPILE_CACHE="$HOME/.cache/node-compile-cache"
```

Measured here: 569 ms to 528 ms. The first run after a node or pi version
change pays the compile cost once to repopulate. An unwritable or stale cache
is ignored rather than fatal, so the worst case is a slow start. It reaches
roughly 12 MB per version and is never cleaned up on its own — delete the
directory whenever you want it back.

## Slim profile

The full setup assumes a model capable of supervising orchestration tools.
`pnpm profile:slim` writes a smaller profile for locally served models:

```sh
pnpm profile:slim
PI_CODING_AGENT_DIR=~/.pi/agent-slim pi
```

It loads only the engineering rules, file search, `ask_user`, `goal`, and the
extensions that render the theme. It loads no skills because skill descriptions
cost context on every turn. Workflows, subagents, background terminals, sleep,
loop, credentialed web tools, and codex compaction are omitted;
`scripts/slim-profile.sh` is the source of truth for the current list and the
reason for each exclusion.

The profile is one `settings.json` rather than a directory of symlinks, because
an agent directory with no `extensions/` of its own discovers nothing — so the
paths that file lists are the entire set. It carries no `auth.json`: a locally
served model authenticates to nothing. Point it at one by writing
`~/.pi/agent-slim/models.json`, which adds providers without disturbing the
built-in catalog.

Sessions and settings are separate from the main profile. The repo is shared,
so editing an extension changes both.

## Web tools

`extensions/web-tools` provides one public tool surface backed by Exa and
Firecrawl. Exa handles search, scrape, and relevance-selected site exploration.
Firecrawl can also handle search and scrape, and uniquely provides deterministic
crawl and image search.

Create either or both provider keys, then copy the environment template:

```sh
cp .env.example ~/.pi/agent/.env
```

Set one or both empty values in the copied file: `EXA_API_KEY` for Exa and
`FIRECRAWL_API_KEY` for Firecrawl. Leave an unused provider empty. Environment
variables take precedence over the file, so a secret manager can inject them
for one pi process without persisting them.

Routing is optional. With no `~/.pi/agent/web-tools.json`, Exa wins whenever
its key is present and only `search`, `scrape`, and `explore_site` are
registered. If only the Firecrawl key exists, `search`, `scrape`, `crawl`, and
`image_search` are registered through Firecrawl. No key means no web tools.

For explicit routing, copy the safe example:

```sh
cp web-tools.example.json ~/.pi/agent/web-tools.json
```

An existing config is an allowlist. Omitted tools and tools set to
`"disabled"` are not registered, so their schemas and guidance are absent from
the model prompt. A configured route whose key is missing is also omitted and
produces a startup warning; it never falls back to another provider. Run
`/reload` after changing routes. See
[`extensions/web-tools/README.md`](extensions/web-tools/README.md) for the
capability matrix and full routing rules.

## fd and rg tools

The `file-search` extension registers `fd` and `rg` as model tools. No setup is normally needed: at startup it silently uses a system-installed `fd` (or `fdfind` on Debian/Ubuntu) and `rg` when available, or an existing fallback binary in this checkout's `bin/`. Only when neither exists does it download an official release binary (macOS/Linux, arm64/x64, over HTTPS) into that same `bin/` and show a one-time notification. If your platform is unsupported, install `fd` and `rg` with your package manager and restart pi.

## Theme

Add the included theme to `~/.pi/agent/settings.json` while keeping your existing settings:

```json
{
  "theme": "tokyo-night"
}
```

Pi will load the extensions, skills, and theme from their directories the next time it starts.
