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
ln -s ~/code/pi-setup/skills/subagents            ~/.pi/agent/skills/
```

Nothing in `~/.agents/skills` needs linking: pi reads that directory on its own,
alongside `~/.pi/agent/skills`.

This is symlinks rather than cloning straight into `~/.pi/agent` because the
agent directory is not only config — `auth.json`, `sessions/`, and
`models-store.json` live there too, and none of them belong in a public repo.

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
