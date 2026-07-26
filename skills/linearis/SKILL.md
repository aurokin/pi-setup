---
name: linearis
description: >-
  Manage Linear.app work from the command line with the linearis CLI (bins
  linearis / linear), which outputs JSON: issues/tickets, projects, cycles
  (sprints), milestones, initiatives (roadmap), documents, labels, teams,
  users, and issue discussions/comments. Use when the user mentions Linear, a
  ticket identifier like ENG-42 or ABC-123, sprints, triage, or the roadmap, or
  asks to create, read, search, update, assign, comment on, or otherwise manage
  Linear issues and projects.
license: MIT
compatibility: Requires the linearis CLI (npm i -g linearis), Node >=22, and a `with-secret linear` wrapper that injects LINEAR_API_TOKEN.
allowed-tools: Bash(with-secret:*), Bash(linearis:*), Bash(linear:*), Bash(jq:*)
metadata:
  author: linearis-oss
  version: "1.0.0-pi"
---

# linearis

Drive [Linear.app](https://linear.app) from the shell via the `linearis` CLI (JSON-only output; `linear` is an alias). Do not guess the command surface — the CLI documents itself, and this skill teaches the protocol, not the flags.

## Running commands: always through `with-secret`

Every invocation is prefixed, because the API token lives in Proton Pass and is injected for one process only:

```
with-secret linear -- linearis <domain> <command> [flags]
```

Never run bare `linearis` — it has no token and will fail. Never run `linearis auth`; there is no stored credential file here by design, and that interactive flow is not how this host authenticates. Do not read, print, or copy the token.

If `with-secret` reports a missing or stale session, hand its own error text to the user — `secrets-bootstrap` is theirs to run, not yours.

## Preflight (reactive — branch on the CLI's own output; don't pre-run checks every turn)

- **Not installed** — if the shell reports command-not-found, say so and stop. Installing it is the user's call; never install it yourself.
- **Auth failure** — two distinct shapes, and the CLI is inconsistent about them:
  - Invalid or expired token: `{"error": "AUTHENTICATION_REQUIRED", ...}` with exit code 42.
  - No token reaching the process at all: `{"error": "Authentication required, not authenticated"}` — *not* exit 42.

  Either way the cause here is almost always a Proton Pass session problem rather than a bad key. Surface the error and stop; do not retry, and do not fall back to a bare `linearis` call.

## Discover, then act

1. Run `linearis usage` once for the list of domains (issues, projects, cycles, …).
2. Run `linearis <domain> usage` for a domain's full command and flag reference **before** acting.
3. Never invent flags or subcommands — `usage` is authoritative and always current.

## Output

Every command prints JSON on stdout. Shape it at the source with the global `--fields` and `--compact`.

**`--fields` does not traverse implicitly.** List commands wrap results in `nodes`, and a top-level field selection that matches nothing returns `{}` rather than erroring — a silent empty result that reads exactly like "no data". Select the full path:

```
--fields nodes.identifier,nodes.title        # list commands
--fields identifier,title                    # read/create (single object)
```

Reach for `jq` only for complex reshaping, and fall back to raw JSON if `jq` is absent.

## Issue relations

Verified against the live API: `--parent-ticket`, `--blocks`, and `--blocked-by` all work on `issues create`, in a single invocation, with `--blocked-by` correctly inverted.

```
with-secret linear -- linearis issues create "Title" --team ENG \
  --parent-ticket ENG-1 --blocks ENG-2,ENG-3
```

Two things to get right:

- **`relations list` is absolute, not relative to the issue you asked about.** Each entry names `issue` (the blocker) and `relatedIssue` (the blocked) regardless of which issue you queried. Read those fields; do not assume the queried issue is the subject, or you will invert every dependency.
- **Relation wiring is not transactional.** `issues create --blocks ...` prints its success JSON only after every relation succeeds, so a mid-loop failure leaves the issue created but its identifier unreported — a naive retry then duplicates it. When generating a set of issues, create them all first and record identifiers, then wire relations in a second, separately re-runnable pass.

`issues relations remove` takes a relation UUID, not an issue identifier, so removal needs a `relations list` first.

## Invariants worth knowing (everything else lives in `usage`)

- IDs are forgiving: pass a UUID, team key (`ENG`), issue identifier (`ABC-123`), or name interchangeably. Reference tickets by identifier.
- `issues create` requires `--team`; some filters need a scope flag — confirm in `usage` rather than memorizing.
- Threaded discussion lives under `issues discuss` / `discussions` / `replies` / `reply`. The top-level `comments` domain is a deprecated facade (still works) — prefer the `issues` discussion commands. Record non-trivial progress in a discussion thread and keep the description in sync on status changes.
- `files download <url>` only fetches Linear storage URLs (`uploads.linear.app`); `files upload` returns an `assetUrl` you can embed; `issues read --with-attachments` lists linked resources (PRs, docs, URLs) — references, not necessarily downloadable files.

For anything not covered here, `linearis <domain> usage` is the reference.
