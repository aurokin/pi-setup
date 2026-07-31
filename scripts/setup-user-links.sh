#!/usr/bin/env bash
# Install or verify pi-setup's user-level resource links.
#
# This script owns only links from Pi's agent directory into this checkout. It
# never replaces an existing path: conflicts are reported for manual review.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/setup-user-links.sh [--check]

Without arguments, create any missing pi-setup links after validating that no
conflicting paths exist. With --check, verify the links without changing them.

PI_CODING_AGENT_DIR overrides the default target (~/.pi/agent).
EOF
}

mode=apply
case "${1:-}" in
  "") ;;
  --check) mode=check ;;
  -h|--help) usage; exit 0 ;;
  *) usage >&2; exit 2 ;;
esac
[[ $# -le 1 ]] || { usage >&2; exit 2; }

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." >/dev/null 2>&1 && pwd -P)"
agent_dir="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"

names=(
  extensions
  themes
  node_modules
  skills/background-terminals
  skills/linearis
)
targets=(
  "$repo/extensions"
  "$repo/themes"
  "$repo/node_modules"
  "$repo/skills/background-terminals"
  "$repo/skills/linearis"
)

errors=0
for i in "${!names[@]}"; do
  name="${names[$i]}"
  target="${targets[$i]}"
  destination="$agent_dir/$name"

  if [[ ! -e "$target" ]]; then
    printf 'setup-user-links: missing source %s\n' "$target" >&2
    if [[ "$name" == node_modules ]]; then
      printf 'setup-user-links: run pnpm install in %s first\n' "$repo" >&2
    fi
    errors=1
    continue
  fi

  if [[ -L "$destination" ]]; then
    if [[ "$(readlink "$destination")" != "$target" ]]; then
      printf 'setup-user-links: conflicting symlink %s -> %s (expected %s)\n' \
        "$destination" "$(readlink "$destination")" "$target" >&2
      errors=1
    fi
  elif [[ -e "$destination" ]]; then
    printf 'setup-user-links: refusing existing non-symlink %s\n' "$destination" >&2
    errors=1
  elif [[ "$mode" == check ]]; then
    printf 'setup-user-links: missing link %s -> %s\n' "$destination" "$target" >&2
    errors=1
  fi
done

stale_subagents="$agent_dir/skills/subagents"
if [[ -e "$stale_subagents" || -L "$stale_subagents" ]]; then
  printf 'setup-user-links: stale static subagents skill exists at %s; review it before removal\n' \
    "$stale_subagents" >&2
  errors=1
fi

(( errors == 0 )) || exit 1

if [[ "$mode" == apply ]]; then
  mkdir -p "$agent_dir/skills"
  for i in "${!names[@]}"; do
    destination="$agent_dir/${names[$i]}"
    [[ -L "$destination" ]] || ln -s "${targets[$i]}" "$destination"
  done
fi

printf 'setup-user-links: %s %s\n' \
  "$([[ "$mode" == check ]] && printf verified || printf configured)" "$agent_dir"
