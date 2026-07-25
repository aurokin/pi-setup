# System Prompt Extension Design

Goal: make pi behave more like our preferred coding agents while keeping pi's
prompt compact, provider-neutral, and cheap enough for local models.

## Design choice

Append one section to pi's existing prompt via `before_agent_start`. Do not
replace pi's default prompt, and do not import another agent's prompt wholesale.

Reasons:

- Pi already handles tool listings, project context, skills, date, cwd, and
  pi-specific documentation routing. Replacing the prompt throws that away.
- A concise behavioral layer is the right size for this job. Codex's base prompt
  is useful as policy inspiration, but much of it is Codex-specific:
  `apply_patch`, sandbox approvals, MCP rules, collaboration-mode tooling, and
  exact final-answer renderer behavior.
- Local and hosted models pay this prompt cost on every turn, so it stays short.
- This repo's other extensions each contribute their own tool-instruction
  prompts (`extensions/*/prompt.ts`). They share a context budget with this
  layer, which is a second reason to keep it tight.

## Sources compared

- Claude custom addition: `~/.dotfiles-private/claude/.claude/CLAUDE.md` — a
  concise behavioral layer. Think before coding, prefer simplicity, make surgical
  edits, verify against explicit success criteria. This is the closest model for
  what we want and the direct ancestor of the current bullets.
- Codex base prompt:
  `~/code/upstream/codex/codex-rs/protocol/src/prompts/base_instructions/default.md`
  — a full operating contract: terminal-agent role, progress updates, planning,
  editing constraints, dirty-worktree handling, validation, response formatting.
- Codex model/personality overlays and collaboration modes under
  `~/code/upstream/codex/codex-rs/core/templates/` and
  `collaboration-mode-templates/` — pragmatic voice, response shaping, and
  behavior split by Default/Plan/Execute mode.
- Pi default prompt:
  `~/code/upstream/pi-mono/packages/coding-agent/src/core/system-prompt.ts` —
  intentionally small.

## Implementation

`extensions/shared/engineering-policy.ts` owns the text. Two consumers share it:

1. This extension, appending it to the parent session prompt.
2. Subagent role prompts, so managed children inherit the same rules.

Keeping one source is the point. The previous standalone version of this work
had a live copy and a documented copy that drifted apart within a few edits.

The append is idempotent — `before_agent_start` fires per user prompt and its
results chain across extensions, so an unconditional append could stack copies.

## Adapted for this repo

The search bullet names the `fd` and `rg` **tools** registered by the
`file-search` extension, not the shell binaries. Telling the model to shell out
would route it around the tool this setup deliberately provides.

## Acceptance checks

- `PI_OFFLINE=1 pi --list-models` loads the extension without errors.
- The policy appears exactly once in the assembled system prompt.
- A cheap hosted model can answer a simple no-tools prompt without leaking
  policy text into its reply.
- An edit smoke test still favors scoped diffs and reports validation clearly.

## Deferred

- Mode-specific prompt profiles. Codex has explicit Default, Plan, and Execute
  modes; pi does not need that complexity yet.
- Frontend-specific design rules. Add only if pi becomes a primary
  frontend-building agent.
