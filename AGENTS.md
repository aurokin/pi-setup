# Agent instructions

This repo is a live pi configuration. `extensions/` and `themes/` are symlinked
into `~/.pi/agent`; skills are linked individually. Setup and link ownership are
documented in `SETUP.md`.

## Layout

- `extensions/<name>/`: one extension per directory. Most are pnpm workspaces;
  `index.ts` is the entry point and larger extensions keep code in `src/`.
- `extensions/shared/`: cross-extension helpers imported by relative path.
- `extensions/workflows/`: workflow implementation, not a workspace.
- `skills/<name>/SKILL.md`: model-facing instructions loaded on demand.
- `tools/<name>/`: repository tooling that pi does not load as extensions.
- `e2e/`: live tests that may need credentials, installed CLIs, or a real pi.

The subagents extension generates its skill from `extensions/subagents/skill/`.
Edit that source, never `~/.pi/agent/generated-skills/`.

## Commands

| Task | Command |
| --- | --- |
| Install | `pnpm install` |
| Typecheck | `pnpm check` |
| Unit tests | `pnpm test` |
| Live tests | `pnpm test:e2e` |
| Format | `pnpm format` |
| Inspect model-facing prompts | `pnpm prompt --open` |

Run `pnpm test` for every code change. Run `pnpm check` and `pnpm format` before
finishing. See `docs/testing.md` before interpreting or running live tests.

## Key conventions

- Use pnpm. Add dependencies with `pnpm add --filter <workspace> <package>`;
  do not edit package manifests by hand.
- Use `.ts` extensions in relative imports. Tests use Node's native type
  stripping; `file-search` uses Vitest.
- Do not declare the pi SDK in an extension. Extensions must share the SDK from
  pi's process. The root `node_modules` link and dependency layout are explained
  in `docs/startup.md`.
- Effect v4 is beta. Check the installed version before using an example.
  `effect-tsgo patch` belongs only in the root `prepare` script.
- Avoid explicit return types unless needed. Treat `as any` as a last resort.
- Match the surrounding module's structure and comments. Keep changes to
  inherited files small so upstream merges remain reviewable.

## References

| Need | File |
| --- | --- |
| Install and links | `SETUP.md` |
| Documentation map | `docs/README.md` |
| Test scope and credentials | `docs/testing.md` |
| Dependency layout and startup decisions | `docs/startup.md` |
| Deferred work and rejected experiments | `docs/unbuilt.md` |

`upstream` is fetch-only. Never push to it.
