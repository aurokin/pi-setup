# Vendored skill

`SKILL.md` and `LICENSE` are copied verbatim from
[ayghri/i-have-adhd](https://github.com/ayghri/i-have-adhd) (MIT).

- Source: `skills/i-have-adhd/SKILL.md`
- Commit: `16a42a01f7783e29db8557dfc46226baf8015618` (2026-07-23)
- Local clone for diffing: `~/code/upstream/i-have-adhd`

Copied rather than symlinked so this repo stays self-contained and publicly
cloneable. To check for upstream changes:

```sh
git -C ~/code/upstream/i-have-adhd pull
diff ~/code/upstream/i-have-adhd/skills/i-have-adhd/SKILL.md skills/i-have-adhd/SKILL.md
```

## Why it needs no changes for pi

Pi's `SkillFrontmatter` supports `disable-model-invocation`
(`@earendil-works/pi-coding-agent/dist/core/skills.d.ts`), which is what keeps
this skill user-invoked only. The file loads as-is.

Upstream's always-on mode is a Claude Code `SessionStart` hook plus a flag file
at `~/.claude/.i-have-adhd-always`. That mechanism does not apply to pi. The
pi-native equivalent would be a toggle in the `system-prompt` extension, which
already appends to the prompt via `before_agent_start`. Not built yet.

## Upstream also ships an eval harness

`evals/` in the source repo compares response quality between conditions
(weighted rubric: correctness 35%, autonomy 25%, actionability 20%, safety 10%,
concision 10%) with blind judging and a release gate. It is a reusable way to
measure whether a prompt change helps, including for our own
`extensions/shared/engineering-policy.ts`.
