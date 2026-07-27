# Setup

Clone this repo somewhere of your own and install its dependencies:

```sh
git clone git@github.com:aurokin/pi-setup.git ~/code/pi-setup
cd ~/code/pi-setup
npm install
npm run install:extensions
```

Both installs are required. Every directory under `extensions/` is its own npm
package with its own lockfile, so the root `npm install` does not cover them —
skipping the second command leaves `effect` and the Claude Agent SDK missing and
`npm run check` fails.

## Linking it into pi

Pi looks for `extensions/`, `themes/`, and `skills/` under `~/.pi/agent`, so
each is pointed at this checkout:

```sh
ln -s ~/code/pi-setup/extensions ~/.pi/agent/extensions
ln -s ~/code/pi-setup/themes     ~/.pi/agent/themes
```

Skills are linked one at a time, because `~/.pi/agent/skills` is shared — it
also holds skills that came from elsewhere, so it cannot be a single symlink:

```sh
mkdir -p ~/.pi/agent/skills
ln -s ~/code/pi-setup/skills/background-terminals ~/.pi/agent/skills/
ln -s ~/code/pi-setup/skills/linearis             ~/.pi/agent/skills/
```

Nothing in `~/.agents/skills` needs linking: pi reads that directory on its own,
alongside `~/.pi/agent/skills`.

**Do not link a `subagents` skill.** It no longer exists as a static file: the
extension renders it from the harnesses `subagents.json` actually offers and
hands pi the path at startup, so a linked copy would only shadow it with a stale
list. If you linked one before, remove it:

```sh
rm -f ~/.pi/agent/skills/subagents
```

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

## Slim profile

The full setup assumes a frontier model: it registers 23 tools, several of them
orchestration a weaker model cannot supervise. `npm run profile:slim` writes a
second profile for locally served models:

```sh
npm run profile:slim
PI_CODING_AGENT_DIR=~/.pi/agent-slim pi
```

It loads seven extensions rather than all of them — the engineering rules, the
`fd`/`rg` tools, `ask_user`, `goal`, and the three that render the theme — and
no skills at all, since skill descriptions cost context on every turn. That
comes to 9 tools against the full profile's 23. Workflows, subagents,
background terminals, sleep, loop, firecrawl, and codex compaction are all left
out; `scripts/slim-profile.sh` says why beside each one.

The profile is one `settings.json` rather than a directory of symlinks, because
an agent directory with no `extensions/` of its own discovers nothing — so the
paths that file lists are the entire set. It carries no `auth.json`: a locally
served model authenticates to nothing. Point it at one by writing
`~/.pi/agent-slim/models.json`, which adds providers without disturbing the
built-in catalog.

Sessions and settings are separate from the main profile. The repo is shared,
so editing an extension changes both.

## Firecrawl

The search, scrape, and crawl tools require a Firecrawl API key. Follow [Firecrawl's Node.js getting-started guide](https://docs.firecrawl.dev/quickstarts/nodejs) to create one, then copy the example environment file:

```sh
cp ~/.pi/agent/.env.example ~/.pi/agent/.env
```

Replace the placeholder in `~/.pi/agent/.env` with your API key.

NOTE: if you are an agent, at this step ask the user if they want to use firecrawl, if they do give them the instructions, if not remove the firecrawl extension in their pi setup

## fd and rg tools

The `file-search` extension registers `fd` and `rg` as model tools. No setup is normally needed: at startup it silently uses a system-installed `fd` (or `fdfind` on Debian/Ubuntu) and `rg` when available, or an existing fallback binary in `~/.pi/agent/bin/`. Only when neither exists does it download an official release binary (macOS/Linux, arm64/x64, over HTTPS) into `~/.pi/agent/bin/` and show a one-time notification. If your platform is unsupported, install `fd` and `rg` with your package manager and restart pi.

## Theme

Add the included theme to `~/.pi/agent/settings.json` while keeping your existing settings:

```json
{
  "theme": "tokyo-night"
}
```

Pi will load the extensions, skills, and theme from their directories the next time it starts.
