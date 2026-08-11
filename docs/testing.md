# Testing

Use the narrowest check that proves the change, then run the repository checks
before finishing.

| Scope | Command | Network or credentials |
| --- | --- | --- |
| Typecheck | `pnpm check` | No |
| Unit suite | `pnpm test` | No |
| One Node test file | `node --test --experimental-strip-types path/to/file.test.ts` | No |
| File-search tests | `pnpm --filter file-search test` | No |
| Full live suite | `pnpm test:e2e` | Usually |
| Prompt review | `pnpm prompt --open` | No |

`pnpm test` is hermetic. It does not use the network or credentials, so a failure
is a code regression rather than an unavailable service. Run it for every code
change.

## Live tests

Tests under `e2e/` exercise real pi wiring, providers, and external CLIs. Most
skip when their credential or executable is unavailable. A successful
`pnpm test:e2e` therefore means every runnable case passed, not that every case
ran. Read the skip output when coverage matters.

`e2e/pane-metadata.test.ts` is the exception: it starts pi in tmux but never
takes a model turn. It is free to run and covers the integration between
`agent-metadata` and `session-title`.

The subagent suites need the backend they exercise:

- Claude subagent tests need an authenticated Claude Code CLI.
- Codex subagent tests need an authenticated Codex CLI.
- Compaction and feature tests use pi's configured `openai-codex` credential.
- Pi-backend tests need their configured provider model.
- Droid tests need `droid` and `FACTORY_API_KEY`.
- Cursor tests need `CURSOR_API_KEY`.

The secret-backed suites can be run directly:

```sh
with-secret factory -- node --test --experimental-strip-types e2e/subagents-droid.test.ts
with-secret cursor -- node --test --experimental-strip-types e2e/subagents-cursor.test.ts
```

`e2e/web-tools-live.test.ts` has an additional
`WEB_TOOLS_LIVE_E2E=1` gate because every runnable case spends provider credits.
Inject `EXA_API_KEY` and `FIRECRAWL_API_KEY` with `pass-cli run`; do not print or
persist them. The test uses one result per search and a Firecrawl crawl limit of
one.

Write-capable live subagent tests use scratch directories. Keep that property
when adding a worker case: several backends bypass permission prompts, so
pointing one at this checkout would let the test edit what it is testing.

## Periodic checks

Some live tests watch external behavior rather than repository behavior. The
codex compaction canary detects withdrawal or renaming of the undocumented
`remote_compaction_v2` flag. Run the full live suite periodically, before a pi
upgrade, and before relying on compaction recall in a long session. A skip in
that test means Codex credentials are absent; it does not validate the flag.

The unit suite proves that the engineering policy is assembled correctly, not
that a model follows it. The attempted behavioral test did not show a measurable
effect and was withdrawn. `docs/unbuilt.md` records the experiment and its
limits.
