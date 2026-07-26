# Handoff: a pi variant of `to-issues`

For whoever picks up skills-manager. This is a spec, not an implementation —
nothing here has been built.

## The problem

`to-issues` breaks a plan into vertical slices and creates them "directly in
the user's connected tracker (e.g. the Linear MCP), using the tracker's native
blocking and parent relations so later issues reference real identifiers. If no
tracker is connected, write numbered markdown files."

**Pi has no MCP, deliberately.** Its README: "No MCP. Build CLI tools with
READMEs, or build an extension that adds MCP support." So on pi that skill finds
no tracker, takes the fallback branch, and writes markdown files.

That fallback is not a failure anyone sees. The user asks for issues, gets a
directory of numbered files, and the dependency graph the skill spent its whole
quiz step establishing exists only as prose. Every other agent here has the
Linear MCP and does the right thing, which is what makes this easy to miss.

The capability is already installed and verified — `linearis`, plus
`skills/linearis/SKILL.md` in this repo. Nothing new needs building at the CLI
layer. What is missing is a variant of `to-issues` whose create step drives it.

## What the variant changes

Only the **Create the issues** section. The slicing rules, the HITL/AFK split,
and the quiz step are harness-independent and should be copied unchanged —
divergence there is drift, not adaptation.

### Auth and invocation

Every command runs through the secret wrapper; the token is injected per
process and never stored:

```sh
with-secret linear -- linearis <domain> <command> [flags]
```

Bare `linearis` has no token and fails. `skills/linearis/SKILL.md` is the
contract for this; read it rather than restating it.

### Creating issues and relations

Verified live against a real workspace (2026-07-26, linearis 2026.6.0):

```sh
with-secret linear -- linearis issues create "Title" --team ENG \
  --parent-ticket ENG-1 --blocks ENG-2,ENG-3 --fields identifier,id --compact
```

`--parent-ticket`, `--blocks`, and `--blocked-by` all work on `create`, in one
invocation, and `--blocked-by` is correctly inverted. `--blocks` takes a
comma-separated list.

**Do not create-and-wire in one pass.** Relation wiring is not transactional:
`issues create --blocks …` prints its success JSON only after every relation
succeeds, so a mid-loop failure leaves the issue created in Linear with its
identifier never reported. A naive retry then duplicates it — and this skill
creates in dependency order, so it is exactly the loop where that bites.

Instead:

1. Create every issue first, recording each returned `identifier`.
2. Wire relations in a second pass, which is separately re-runnable.

### Reading the graph back

`issues relations list <ID>` reports **absolutely, not relative to the issue you
queried**: each entry names `issue` (the blocker) and `relatedIssue` (the
blocked) regardless of which one you asked about. Verifying the graph by
assuming the queried issue is the subject inverts every dependency.

`--fields` does not traverse implicitly. On list commands results are wrapped in
`nodes`, and a selection that matches nothing returns `{}` rather than erroring
— a silent empty result indistinguishable from "no data". Use
`--fields nodes.identifier,nodes.title`.

### Not verified — check before writing

The skill also wants the source plan to become "the milestone or project
description". `linearis` has `projects`, `milestones`, and `documents` domains,
but **none of their commands have been exercised here.** Run
`linearis projects usage` and `linearis milestones usage` and follow those
rather than inferring flags from the issues domain; its surface is not uniform
(`relations remove` takes a relation UUID, not an issue identifier, and
`relations add` has no `--blocked-by` even though `issues update` does).

## Placement — needs a decision

`to-issues` currently lives at `~/.pi/agent/skills/to-issues/` as a plain
directory: not a symlink into this repo, not in `~/.agents/skills`, and there is
a separate copy under `~/.claude/skills/to-issues/`. So there is no single
source of truth to edit.

Options:

- **Vendor into this repo** as `skills/to-issues/`, symlinked to
  `~/.pi/agent/skills/`, the way `skills/linearis` is. Consistent with how this
  repo handles a modified upstream skill, and it gets provenance and review.
  Costs a fork to re-base.
- **Keep one skill, branch inside it** on whether a tracker CLI is present.
  Avoids the fork, but puts pi-specific commands in a skill every agent loads.
- **Let skills-manager own it** and generate the pi variant during host sync.
  The best fit long-term, and the reason this is a handoff rather than a patch.

If it is vendored, follow `skills/linearis/PROVENANCE.md`: record the upstream
source and commit, state what diverged and why, and give the re-base recipe.

## Done means

A plan broken into slices on pi produces real Linear issues with real parent
and blocking relations — not a directory of markdown files — and
`issues relations list` on a created child reports the blocker direction the
quiz step agreed with the user.
