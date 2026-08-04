# /context-budget

`/context-budget` explains what is occupying the current model's context window
without printing prompt text, context-file contents, tool descriptions, or
conversation content.

The report combines one provider count with several estimates:

- total context usage comes from `ctx.getContextUsage()`;
- the effective system prompt comes from `ctx.getSystemPrompt()`;
- tool schemas and their `sourceInfo` come from `pi.getAllTools()`;
- context files and loaded skills come from `ctx.getSystemPromptOptions()`;
- history comes from `sessionManager.buildContextEntries()`, which respects
  compaction boundaries.

Tool costs include descriptions and parameter schemas, then group by the
extension or package that registered them. Disabled tools are excluded because
pi does not send their schemas. History includes compaction summaries, retained
tails, and branch summaries rather than counting raw branch entries that no
longer reach the provider.

## Estimates and privacy

Pi does not expose a tokenizer to extensions. Section-level figures use
`characters / 4` and are useful for ranking contributors, not billing. The
report labels the provider's total separately.

The report emits names, paths, headings, counts, and sizes only. This is a hard
privacy boundary because the output is likely to be pasted into another chat
when diagnosing a crowded window. Tests pin the absence of prompt text, file
contents, and tool descriptions.

Before the first turn, `getSystemPrompt()` has not passed through
`before_agent_start`, so extension-appended instructions are missing. The report
marks that state instead of presenting the smaller prompt as complete.

## Compaction headroom

Headroom is measured to pi's auto-compaction threshold, not to the model's full
window. The extension resolves compaction settings through `SettingsManager` so
project trust and global/project merging match pi. It reports no headroom when
usage is temporarily unknown after compaction or when auto-compaction is off.

## Limits

- The wire payload after provider transforms would be more exact, but
  `before_provider_request` does not fire for the default `openai-codex` path.
- Pi exposes total post-compaction usage but not the last boundary, summary
  tokens, or kept-recent token counts.
- Section estimates remain `characters / 4` until pi exposes a tokenizer.
