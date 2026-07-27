import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  generatedSkillPath,
  readSkillSources,
  renderSkill,
  writeGeneratedSkill,
  type SkillSources,
} from "./src/skill.ts";
import { ALL_HARNESSES, DEFAULT_HARNESSES } from "./src/harnesses.ts";

const SKILL_DIR = join(import.meta.dirname, "skill");

/** Small stand-in so the assertions are about assembly, not about the prose. */
const sources: SkillSources = {
  base: [
    "# Subagents",
    "egress: {{egress-harnesses}}.",
    "",
    "{{harness-choices}}tail paragraph",
    "",
    "{{harness-sections}}## Spawn and Manage",
  ].join("\n"),
  harnesses: {
    pi: "<!-- section -->\n## Pi Harness\npi body",
    claude: "- claude bullet\n<!-- section -->\n## Claude Harness\nclaude body",
    codex: "- codex bullet\n<!-- section -->\n## Codex Harness\ncodex body",
    droid: "- droid bullet\n<!-- section -->\n## Droid Harness\ndroid body",
    cursor: "- cursor bullet\n<!-- section -->\n## Cursor Harness\ncursor body",
  },
};

test("renders only the harnesses that are offered", () => {
  const text = renderSkill(["pi", "claude"], sources);
  assert.match(text, /## Claude Harness/);
  assert.match(text, /- claude bullet/);
  assert.doesNotMatch(text, /codex/i);
  assert.doesNotMatch(text, /droid/i);
  assert.doesNotMatch(text, /cursor/i);
});

test("an enabled harness appears in both the choices and the sections", () => {
  const text = renderSkill(["pi", "droid"], sources);
  assert.match(text, /- droid bullet/);
  assert.match(text, /## Droid Harness\ndroid body/);
});

test("order follows the catalog, not the order the config lists", () => {
  const text = renderSkill(["cursor", "codex", "pi", "claude"], sources);
  const order = [
    "Pi Harness",
    "Claude Harness",
    "Codex Harness",
    "Cursor Harness",
  ].map((heading) => text.indexOf(heading));
  assert.ok(
    order.every((index, i) => index >= 0 && (i === 0 || index > order[i - 1])),
    `sections out of catalog order: ${order.join(", ")}`,
  );
});

test("pi contributes a section but no bullet — the base already argues for it", () => {
  const text = renderSkill(["pi"], sources);
  assert.match(text, /## Pi Harness/);
  // Nothing between the placeholder's line and the paragraph that follows it.
  assert.match(text, /\ntail paragraph/);
  assert.doesNotMatch(text, /^- /m);
});

test("no placeholder survives, for any selection", () => {
  for (const offered of [
    ["pi"],
    ["pi", "claude"],
    [...ALL_HARNESSES],
  ] as const) {
    const text = renderSkill(offered, sources);
    assert.doesNotMatch(
      text,
      /\{\{/,
      `placeholder left for ${offered.join(",")}`,
    );
  }
});

test("no seam is left where a placeholder expanded to nothing", () => {
  for (const offered of [
    ["pi"],
    ["pi", "claude"],
    [...ALL_HARNESSES],
  ] as const) {
    assert.doesNotMatch(
      renderSkill(offered, readSkillSources(SKILL_DIR)),
      /\n{3,}/,
      `blank-line run for ${offered.join(",")}`,
    );
  }
});

test("the egress warning names the external harnesses, and not pi", () => {
  assert.match(
    renderSkill(["pi", "claude", "codex"], sources),
    /a `claude` or `codex` child ships everything it reads/,
  );
  assert.match(
    renderSkill(["pi", "claude", "codex", "droid"], sources),
    /a `claude`, `codex`, or `droid` child ships/,
  );
  assert.match(renderSkill(["pi", "droid"], sources), /a `droid` child ships/);
});

test("pi is named as an egress path too — `model` can route it elsewhere", () => {
  // A pi child takes a provider/model-id, so "same provider as the parent" is
  // a guarantee the harness does not make.
  for (const offered of [["pi"], ["pi", "claude"]] as const) {
    assert.match(
      renderSkill(offered, sources),
      /pi child .*whichever provider its `model` names/,
    );
  }
});

test("a harness with no markdown file is skipped, not half-rendered", () => {
  const text = renderSkill(["pi", "claude"], {
    ...sources,
    harnesses: { pi: sources.harnesses.pi },
  });
  assert.doesNotMatch(text, /claude/i);
  assert.doesNotMatch(text, /<!-- section -->/);
});

test("the shipped markdown renders a skill for the default harnesses", () => {
  const text = renderSkill(DEFAULT_HARNESSES, readSkillSources(SKILL_DIR));
  assert.match(text, /^---\nname: subagents\n/);
  assert.doesNotMatch(text, /\{\{/);
  assert.match(text, /## Pi Harness/);
  assert.match(text, /## Claude Code Harness/);
  assert.match(text, /## Codex Harness/);
  // Off by default, so nothing may describe them.
  assert.doesNotMatch(text, /## Droid Harness/);
  assert.doesNotMatch(text, /## Cursor Harness/);
});

test("every harness in the catalog has markdown that renders", () => {
  const text = renderSkill(ALL_HARNESSES, readSkillSources(SKILL_DIR));
  for (const heading of [
    "## Pi Harness",
    "## Claude Code Harness",
    "## Codex Harness",
    "## Droid Harness",
    "## Cursor Harness",
  ]) {
    assert.ok(text.includes(heading), `missing ${heading}`);
  }
  assert.doesNotMatch(text, /\{\{/);
  assert.doesNotMatch(text, /<!-- section -->/);
});

test("writes the rendered skill under the agent dir and returns its path", () => {
  const agentDir = mkdtempSync(join(tmpdir(), "subagents-skill-"));
  try {
    const path = writeGeneratedSkill(["pi", "droid"], SKILL_DIR, agentDir);
    // Spelled out rather than built with generatedSkillPath: asserting the
    // shape against the function that produces it would assert nothing.
    assert.equal(
      path,
      join(agentDir, "generated-skills", "subagents-pi-droid", "SKILL.md"),
    );
    const text = readFileSync(path!, "utf8");
    assert.match(text, /## Droid Harness/);
    assert.doesNotMatch(text, /## Codex Harness/);
  } finally {
    rmSync(agentDir, { recursive: true, force: true });
  }
});

test("a second session with a different config cannot rewrite the first's skill", () => {
  const agentDir = mkdtempSync(join(tmpdir(), "subagents-skill-"));
  try {
    const first = writeGeneratedSkill(["pi", "codex"], SKILL_DIR, agentDir);
    const second = writeGeneratedSkill(["pi", "droid"], SKILL_DIR, agentDir);
    assert.notEqual(first, second);
    // The first session's model reads its path later; it must still be its own.
    assert.match(readFileSync(first!, "utf8"), /## Codex Harness/);
    assert.doesNotMatch(readFileSync(first!, "utf8"), /## Droid Harness/);
  } finally {
    rmSync(agentDir, { recursive: true, force: true });
  }
});

test("the path depends on the selection, not on how it was ordered", () => {
  const agentDir = "/tmp/does-not-matter";
  assert.equal(
    generatedSkillPath(["droid", "pi"], agentDir),
    generatedSkillPath(["pi", "droid"], agentDir),
  );
});

test("an unwritable agent dir costs the skill, not the session", () => {
  const path = writeGeneratedSkill(
    ["pi"],
    join(SKILL_DIR, "does-not-exist"),
    mkdtempSync(join(tmpdir(), "subagents-skill-")),
  );
  assert.equal(path, undefined);
});
