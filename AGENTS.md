# AGENTS.md

This repo is a pi coding-agent configuration. It is cloned to `~/.pi/agent`, and
pi loads `extensions/`, `skills/`, and `themes/` from there at startup.

## Layout

- `extensions/<name>/` — one pi extension per directory, each its own npm package
  with its own `package.json` and lockfile. `index.ts` is the entry point; larger
  extensions keep implementation in `src/` and colocate `*.test.ts` at the root.
- `extensions/shared/` — cross-extension helpers. No package.json; imported by
  relative path.
- `skills/<name>/SKILL.md` — model-facing docs loaded on demand.

## Commands

```sh
npm install && npm run install:extensions   # both are required
npm run check                               # tsc --noEmit across the repo
npm test                                    # node:test + file-search vitest
npm run format                              # prettier
```

Run `check` and `format` before finishing a change.

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
