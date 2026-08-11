#!/usr/bin/env bash
#
# Generate a slim pi profile for models that cannot drive the full setup.
#
# Pi reads its resources from whatever `PI_CODING_AGENT_DIR` points at. An agent
# directory with no `extensions/` of its own discovers nothing, so the paths
# listed in its settings.json are the entire set — which is why this writes one
# file instead of building a directory of symlinks.
#
# No auth.json is created. This profile is for locally served models, which
# authenticate to nothing. Add a provider by writing a models.json beside the
# settings file; ModelConfig only ever adds providers, so a local endpoint slots
# in without disturbing anything.
#
# Idempotent. An existing settings.json is moved aside, never overwritten in
# place.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${PI_SLIM_DIR:-$HOME/.pi/agent-slim}"
SETTINGS="$TARGET/settings.json"

# Loaded. Kept to what helps a weaker model rather than what is available:
# the engineering rules, the search tools, a way to ask instead of guess, a way
# to hold a goal, and the dashboard trio that renders the theme.
EXTENSIONS=(
  system-prompt
  file-search
  ask-user
  goal
  ui-customization
  git-info
  model-info
)

# Deliberately absent, and why:
#   workflows, subagents        orchestration a weak model cannot supervise
#   codex-compaction            codex-only, inert against a local endpoint
#   web-tools, summaries       need credentials this profile does not have
#   loop, sleep                 unattended turns
#   background-terminals        process management
# Skills are absent entirely: their descriptions cost context on every turn.

for name in "${EXTENSIONS[@]}"; do
  [ -d "$REPO/extensions/$name" ] || { echo "missing extension: $name" >&2; exit 1; }
done

mkdir -p "$TARGET"

# Build the whole file before touching anything that exists, then move it into
# place in one step. An earlier version moved the old settings aside first and
# wrote afterwards, which left the profile with no settings at all when the
# write did not happen — a closed pipe was enough to do it.
tmp="$(mktemp "$TARGET/.settings.json.XXXXXX")"
trap 'rm -f "$tmp"' EXIT

# Serialized by node rather than printf: a repo path may legally contain a
# quote or a backslash, and hand-rolled JSON silently produces either a broken
# file or a different path than the one intended.
REPO="$REPO" EXTENSIONS="${EXTENSIONS[*]}" node -e '
  const repo = process.env.REPO;
  const names = process.env.EXTENSIONS.split(" ").filter(Boolean);
  process.stdout.write(JSON.stringify({
    theme: "tokyo-night",
    themes: [`${repo}/themes`],
    skills: [],
    extensions: names.map((n) => `${repo}/extensions/${n}`),
  }, null, 2) + "\n");
' > "$tmp"

if [ -f "$SETTINGS" ]; then
  # mktemp rather than a timestamp: two runs inside the same second would
  # otherwise share a backup name, and the second would overwrite the only
  # copy of the settings this is meant to preserve.
  backup="$(mktemp "$SETTINGS.bak.XXXXXX")"
  cp "$SETTINGS" "$backup"
  echo "previous settings kept at $backup"
fi

mv "$tmp" "$SETTINGS"
trap - EXIT

echo "wrote $SETTINGS (${#EXTENSIONS[@]} extensions, 0 skills)"
echo
echo "Launch it with:"
echo "  PI_CODING_AGENT_DIR=$TARGET pi"
echo
echo "No models are configured. Add a local provider by writing $TARGET/models.json."
