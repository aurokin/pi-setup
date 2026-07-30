# Startup cost

Startup went from **1111 ms to ~519 ms** over three rounds. This records what
was measured, what was rejected, and why the effort stopped — so nobody
re-derives it, and so the rejected ideas stay rejected for their actual reasons.

## Where it stands

| | ms |
| --- | --- |
| full startup | ~519 |
| pi's own floor (no extensions, no skills) | ~331 |
| extension loading | ~188 |

Measure with `pi --offline --list-models`, and the floor by adding
`--no-extensions --no-skills`. Take a median of at least six runs: absolute
timings on this machine drift ±50 ms between sessions, so **any comparison must
interleave the two variants in one run** rather than compare against a number
written down earlier. Every figure here came from an interleaved A/B.

## What was done

1. **One shared dependency install.** Seven extensions each had their own 47 MB
   copy of Effect and node built a separate module graph per copy. Extensions
   became pnpm workspaces. 1111 → ~760 ms, tree ~3.4 GB → ~750 MB.
2. **Subpath imports for `@effect/platform-node`** in `file-search` and
   `git-info`. The package barrel re-exports 25 modules and costs ~135 ms to
   load; the one module actually used costs ~62 ms. Static imports, so a
   resolution failure is still loud at startup. −51 ms.
   *Both extensions or neither:* they share the graph, so only the first loader
   pays and fixing one alone saves nothing.
3. **Deferred vendor SDKs.** `@anthropic-ai/claude-agent-sdk` and `@cursor/sdk`
   in `subagents`, and `firecrawl` in `firecrawl-search`, moved behind
   `await import()` at the point of use. Every one already sat inside an
   `Effect.tryPromise`, so an unavailable SDK still reads as a spawn or request
   failure rather than a defect. −135 ms.
4. **`NODE_COMPILE_CACHE`.** Node caches compiled bytecode between runs.
   Worth 71 ms before (3) and 41 ms after, because the two overlap — which is
   why it was landed last and measured rather than assumed. SETUP.md documents
   it; it is machine-local state outside the checkout.

## What was measured and rejected

- **Deferring the Factory droid SDK** (~45 ms). Its API uses nominal
  `declare enum`s at module scope, so deferring means mirroring them as string
  literals with casts. Those drift silently when the SDK renames a value and
  typecheck cannot catch it. Not worth 45 ms on a daily driver.
- **Bun as the runtime.** 107 ms faster on an empty floor, 120 ms *slower* on
  real startup. The floor number is a trap.
- **Changing the pnpm layout.** A fully flattened, real-directory clone of all
  323 packages measured within noise of the symlinked layout (761 vs 764 ms).
  `node-linker` buys nothing here.
- **Deferring `effect` itself, or shaving the small extensions.** Their
  isolation deltas are the shared Effect graph, parsed once and needed at
  registration time. Marginal saving ~0.
- **pi's own ~331 ms floor.** Only ~38 ms is runtime work; the rest is pi's own
  2616-module unbundled ESM graph with eager `jiti`, `typebox` and
  `highlight.js`. Fixable upstream, not here. V8 snapshots do not apply to ESM.
- **Skills, `AGENTS.md`/context files, startup network.** Each measured ~0 in
  two independent passes. `--offline` saves nothing.

## Verifying a change here

`--list-models` **does not surface extension load failures.** It has reported
success twice while extensions were silently failing to load, which is the worst
outcome available: pi carries on without them. Always confirm with a real turn
through the free capture provider:

```sh
PROMPT_INSPECTOR_OUT=/dev/null pi --print --no-session --offline \
  -e tools/prompt-inspector/capture.ts --model prompt-inspector/probe "hi" \
  2>&1 | grep -c "Failed to load"     # expect 0
```

That check cannot reach a deferred import, because the code path only runs on
use. A deferral in a subagent backend needs a real spawn — `e2e/subagents-*.test.ts`
covers cursor and droid; the claude path needs one manual `subagent_spawn`.
Typecheck is not sufficient either way, but it is not nothing: it caught a named
import of a subpath module that would have been `undefined` at runtime, because
the barrel wraps each module in a namespace and the subpath *is* the module.

## Why this stopped

Below roughly 500 ms the remaining cost is structural: the shared Effect graph
needed at extension registration, and pi's own module graph. The next 300 ms is
in pi upstream. A pi release that bundles its dist or lazy-loads `jiti` would
move this more than anything left in this repo.
