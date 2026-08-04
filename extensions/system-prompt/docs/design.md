# System prompt extension

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

- An earlier Claude instruction layer: concise behavioral guidance to think
  before coding, prefer simplicity, make surgical edits, and verify against
  explicit success criteria. This is the closest model for what we want and the
  direct ancestor of the current bullets.
- Codex's `codex-rs/protocol/src/prompts/base_instructions/default.md`: a full
  operating contract covering planning, editing constraints, worktree handling,
  validation, and response format.
- Codex model and collaboration-mode templates under `codex-rs/core/templates/`:
  pragmatic voice, response shaping, and mode-specific behavior.
- Pi's `packages/coding-agent/src/core/system-prompt.ts`: intentionally small.

## Implementation

`extensions/shared/engineering-policy.ts` owns the text. Two consumers share it:

1. This extension, appending it to the parent session prompt.
2. Subagent role prompts, so managed children inherit the same rules.

One source prevents the parent and child policies from drifting apart.

The append is idempotent because `before_agent_start` fires for every user
prompt and extension results are chained. An unconditional append could stack
copies.

## Verification

- `pnpm test` checks that the committed policy matches its TypeScript source and
  that parent and child prompts include it once.
- `pnpm prompt --open` shows the assembled parent prompt and rendered child-role
  prompts for manual review.
- Model adherence is not established by structural tests. The withdrawn
  behavioral experiment and its limits are recorded in `docs/unbuilt.md`.

## Deferred

- Mode-specific prompt profiles. Codex has explicit Default, Plan, and Execute
  modes; pi does not need that complexity yet.
- Frontend-specific design rules. Add only if pi becomes a primary
  frontend-building agent.
