# Documentation map

Start with the smallest document that answers the question. Design records are
kept close to the code they describe; historical research is labelled so it is
not mistaken for current setup guidance.

## Using and changing the setup

| Need | File |
| --- | --- |
| Features and development entry point | `README.md` |
| Install, links, profiles, and credentials | `SETUP.md` |
| Coding-agent instructions | `AGENTS.md` |
| Test scope, live dependencies, and cadence | `docs/testing.md` |
| Dependency layout and startup measurements | `docs/startup.md` |
| Inspect the prompts models receive | `tools/prompt-inspector/README.md` |

## Current feature design

Each shipped feature keeps its design beside its implementation:

- `extensions/background-terminals/docs/design.md`
- `extensions/codex-compaction/docs/design.md`
- `extensions/context-budget/docs/design.md`
- `extensions/goal/docs/design.md`
- `extensions/loop/docs/design.md`
- `extensions/sleep/docs/design.md`
- `extensions/subagents/docs/design.md`
- `extensions/system-prompt/docs/design.md`

These documents explain contracts and decisions. Source and tests remain the
authority for exact APIs and constants.

## Deferred work

- `docs/unbuilt.md` records ideas, rejected experiments, and open questions.
- `docs/to-issues-pi-handoff.md` is an implementation handoff, not a shipped
  capability.

## Historical references

The following files capture point-in-time implementation research. They are
useful for rationale and API archaeology, but their package versions and
commands are not current instructions:

- `extensions/background-terminals/docs/implementation-guide.md`
- `extensions/subagents/docs/design-plan.md`
- `extensions/subagents/docs/effect-v4-extension-guide.md`
- `extensions/subagents/docs/effect-v4-notes.md`

Model-facing skill files under `skills/` and `extensions/subagents/skill/` are
runtime instructions, not contributor documentation. Edit them only when the
corresponding tool or workflow changes.
