# AGENTS.md

This repo is a pi coding-agent configuration. It is checked out here, and
`extensions/` and `themes/` are symlinked into `~/.pi/agent`, so a committed
extension is live in the next session with nothing to install. Skills are linked
one at a time — `~/.pi/agent/skills` is a real directory — so a new
`skills/<name>/` does nothing until it is symlinked. SETUP.md has the commands.

## Layout

- `extensions/<name>/` — one pi extension per directory, usually its own npm
  package. `index.ts` is the entry point; larger extensions keep implementation
  in `src/` and colocate `*.test.ts` at the root. Each is a pnpm **workspace**,
  matched by the `extensions/*` glob in `pnpm-workspace.yaml`: it declares its
  own dependencies, and pnpm installs them once at the root.
- `extensions/shared/` and `extensions/workflows/` have no package.json at all,
  so they are not workspaces. `shared/` is cross-extension helpers, imported by
  relative path.
- `skills/<name>/SKILL.md` — model-facing docs loaded on demand.
- An extension may also generate a skill: it renders one at startup and returns
  the path from `resources_discover`. `extensions/subagents/skill/` is the
  source for one — edit the markdown there, never the rendered copy under
  `~/.pi/agent/generated-skills/`.
- `tools/<name>/` — developer tooling for working on this repo, not loaded by
  pi. Same toolchain and conventions as extensions; `*.test.ts` runs under
  `pnpm test`. `tools/prompt-inspector/` reports what the model actually
  receives on a turn, and is the review surface for prompting we wrote: full
  tool schemas, the bodies of our own skills, and the subagent role prompts.

## Commands

```sh
pnpm install                                # root + every extension workspace
pnpm check                                  # tsc --noEmit across the repo
pnpm test                                   # node:test + file-search vitest, hermetic, ~25s
pnpm test:e2e                               # live: real pi, real provider, costs money
pnpm format                                 # prettier
pnpm prompt --open                          # what the model receives on a turn; free
```

Run `check` and `format` before finishing a change.

## Verification cadence

`pnpm test` is hermetic — no network, no credentials — so a red result there is
always a real regression, and it is cheap enough to run on every change.

`e2e/` is different, and not only because it costs money. Some of it watches
things that change on someone else's schedule rather than on ours, so running it
only when this repo changes is the wrong trigger — a green suite after an
untouched month says nothing. `codex-compaction.test.ts` is the clearest case:
it is the only detector for the undocumented `remote_compaction_v2` beta flag
being withdrawn, and that failure is invisible everywhere else, because
compaction just falls back to text summaries and recall quietly gets worse.

Run the whole e2e suite periodically, before trusting recall on a long session,
and before a pi version bump. Skips rather than failures mean a credential is
absent, not that anything is wrong.

`pane-metadata.test.ts` is the exception to "costs money": it drives a real pi
in a real tmux pane but never takes a turn, so it calls no provider. It needs
`tmux` and `pi` on PATH and skips without them. Run it freely — it is two
seconds, and it covers the wiring in `agent-metadata` and `session-title` that
unit tests structurally cannot.

The subagent backends each need their own, and each skips without it: codex and
claude need their CLI authenticated, `subagents-droid` needs `FACTORY_API_KEY`
and a `droid` on PATH, `subagents-cursor` needs `CURSOR_API_KEY`. So a bare
`pnpm test:e2e` silently covers less than it looks like it does — reach them
with the secret wrapper:

```sh
with-secret factory -- node --test --experimental-strip-types e2e/subagents-droid.test.ts
with-secret cursor  -- node --test --experimental-strip-types e2e/subagents-cursor.test.ts
```

Every subagent suite spawns a live, permission-bypassed agent, so all four —
codex, claude/primary, droid, cursor — run in a scratch directory rather than
this checkout.

What e2e does **not** cover is whether the engineering policy in
`extensions/shared/engineering-policy.ts` actually changes model behavior. That
was attempted and withdrawn; `docs/unbuilt.md` records the measurement and why.
Treat those rules as unverified against any given model.

## Toolchain

- Node's native type stripping (`node --test --experimental-strip-types`). Use
  `.ts` extensions in relative imports — that is required, not a style choice.
- TypeScript 7, Effect v4 (beta). Effect APIs move between betas; check the
  installed version before trusting an example.
- pnpm, not npm. Add packages with an install command rather than editing
  `package.json` by hand, and name the workspace that needs them:
  `pnpm add --filter <name> <pkg>`. The dependency is declared there; pnpm
  decides where it physically lands.

  This used to say to install *into* the extension directory. That gave seven
  extensions their own 47 MB copy of Effect, and node built a separate module
  graph for each at every startup: 1111 ms to start, of which 749 ms was
  extension loading, and every extension costing over 50 ms was one with its
  own copy. One shared install took startup to ~730 ms (extension load 749 →
  ~385 ms) and the tree from ~3.4 GB to ~750 MB.

  Three things about this layout are load-bearing.

  `.npmrc` sets `node-linker=hoisted`, and that is not habit. Extensions are
  loaded into pi's own process, so they must use the same `@earendil-works/*`
  instance pi is running; pnpm's default isolated layout would have each
  extension resolve its own copy of the SDK, which is the version skew that
  would break them. Disk is shared either way — pnpm hardlinks from its global
  store. This is also why no extension declares the pi SDK: exactly one copy,
  at the root, is the point.

  `~/.pi/agent/extensions` is a symlink to this checkout, and pi loads an
  extension by that path without resolving it, so node's module walk starts in
  `~/.pi/agent/` and never reaches here. A `~/.pi/agent/node_modules` symlink
  supplies the missing step — SETUP.md has it. Do not drop it: without it,
  every extension importing `effect` fails to load and pi continues silently
  without them. `--list-models` does not surface those failures; run a real
  turn to check.

  `effect-tsgo patch` rewrites the TypeScript binary, and with one shared
  binary it must run once, from the root. It is a root `prepare` script — do
  not add it back to a workspace, where several would race on the same file.

## Style

- Avoid explicit return types unless needed; lean on inference.
- `as any` is a last resort. Prefer real type safety over restating types.
- Match the surrounding extension's structure and comment density. Upstream code
  documents *why* at the top of each module — keep that habit.

## Upstream

Forked from `davis7dotsh/my-pi-setup`. `upstream` is fetch-only. Keep our
additions separable from inherited code so merges stay cheap; when changing an
inherited file, prefer the smallest edit that works over a restructure.
