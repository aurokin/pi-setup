# AGENTS.md

This repo is a pi coding-agent configuration. It is checked out here, and
`extensions/` and `themes/` are symlinked into `~/.pi/agent`, so a committed
extension is live in the next session with nothing to install. Skills are linked
one at a time — `~/.pi/agent/skills` is a real directory — so a new
`skills/<name>/` does nothing until it is symlinked. SETUP.md has the commands.

## Layout

- `extensions/<name>/` — one pi extension per directory, usually its own npm
  package, with a lockfile once it has dependencies and none before that.
  `index.ts` is the entry point; larger extensions keep implementation in `src/`
  and colocate `*.test.ts` at the root.
- `extensions/shared/` and `extensions/workflows/` have no package.json at all.
  `shared/` is cross-extension helpers, imported by relative path.
- `skills/<name>/SKILL.md` — model-facing docs loaded on demand.
- An extension may also generate a skill: it renders one at startup and returns
  the path from `resources_discover`. `extensions/subagents/skill/` is the
  source for one — edit the markdown there, never the rendered copy under
  `~/.pi/agent/generated-skills/`.
- `tools/<name>/` — developer tooling for working on this repo, not loaded by
  pi. Same toolchain and conventions as extensions; `*.test.ts` runs under
  `npm test`. `tools/prompt-inspector/` reports what the model actually
  receives on a turn.

## Commands

```sh
npm install && npm run install:extensions   # both are required
npm run check                               # tsc --noEmit across the repo
npm test                                    # node:test + file-search vitest, hermetic, ~25s
npm run test:e2e                            # live: real pi, real provider, costs money
npm run format                              # prettier
npm run prompt -- --open                    # what the model receives on a turn; free
```

Run `check` and `format` before finishing a change.

## Verification cadence

`npm test` is hermetic — no network, no credentials — so a red result there is
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

The subagent backends each need their own, and each skips without it: codex and
claude need their CLI authenticated, `subagents-droid` needs `FACTORY_API_KEY`
and a `droid` on PATH, `subagents-cursor` needs `CURSOR_API_KEY`. So a bare
`npm run test:e2e` silently covers less than it looks like it does — reach them
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
- Add packages with an install command rather than editing `package.json` by hand,
  and install into the extension directory that needs them, not the root.

## Style

- Avoid explicit return types unless needed; lean on inference.
- `as any` is a last resort. Prefer real type safety over restating types.
- Match the surrounding extension's structure and comment density. Upstream code
  documents *why* at the top of each module — keep that habit.

## Upstream

Forked from `davis7dotsh/my-pi-setup`. `upstream` is fetch-only. Keep our
additions separable from inherited code so merges stay cheap; when changing an
inherited file, prefer the smallest edit that works over a restructure.
