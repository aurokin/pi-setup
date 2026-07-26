# Provenance

`SKILL.md` here is a modified copy of upstream's, not a link to it.

| | |
| --- | --- |
| Upstream | [linearis-oss/linearis](https://github.com/linearis-oss/linearis), MIT |
| Vendored from | `skills/linearis/SKILL.md` at `66db24863e1669ac2dad88aa9fc60ca0cfdd0e31` (2026-07-03) |
| CLI version verified against | 2026.6.0 |

It is vendored rather than installed with `npx skills add` because that command
fans a skill out to every agent's skill directory. This one is for pi alone —
pi has no MCP, so it drives Linear through a CLI, while the other agents here
use the official Linear MCP.

## Why it diverges

One change can never be upstreamed: **auth**. Upstream tells the agent to
detect an auth failure and hand the user `linearis auth`, an interactive
browser flow. On this host the token is injected per-invocation from Proton
Pass via `with-secret linear`, there is deliberately no `~/.linearis/token`,
and `linearis auth` is never the right answer. The skill now teaches the
wrapper instead.

The rest are general corrections, all measured against the live API rather
than read off the README:

- Upstream documents only the exit-code-42 `AUTHENTICATION_REQUIRED` envelope,
  which fires for an invalid or expired token. A process with *no* token gets
  `{"error": "Authentication required, not authenticated"}` and no exit 42.
- `--fields` does not traverse into the `nodes` wrapper on list commands, and a
  selection matching nothing returns `{}` instead of erroring — indistinguishable
  from an empty result set.
- `relations list` reports `issue`/`relatedIssue` absolutely, not relative to the
  issue queried. Assuming otherwise inverts every dependency.
- Relation wiring is not transactional, so bulk issue generation needs a
  create-then-wire split to stay re-runnable.

The relation flags themselves (`--parent-ticket`, `--blocks`, `--blocked-by`,
including the inversion) were confirmed working end to end, and are documented
here with that confidence.

## Re-basing on a newer upstream

The base is reconstructable exactly, so a bump is a three-way diff rather than
a guess:

```sh
BASE=66db24863e1669ac2dad88aa9fc60ca0cfdd0e31
curl -sSL -o /tmp/base.md   "https://raw.githubusercontent.com/linearis-oss/linearis/$BASE/skills/linearis/SKILL.md"
curl -sSL -o /tmp/latest.md "https://raw.githubusercontent.com/linearis-oss/linearis/main/skills/linearis/SKILL.md"
diff -u /tmp/base.md /tmp/latest.md          # what upstream changed
diff -u /tmp/base.md SKILL.md                # what we changed
```

Re-apply our changes on top, then update the SHA in the table above. Check
whether upstream has fixed any of the general corrections; drop ours where it
has, and keep the auth section regardless.
