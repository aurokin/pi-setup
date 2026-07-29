import assert from "node:assert/strict";
import test from "node:test";
import {
  byteLength,
  escapeHtml,
  readSkills,
  estimateTokens,
  formatBytes,
  instructionMessages,
  messageText,
  readMessages,
  readRolePrompts,
  readTools,
  renderReport,
  splitSections,
} from "./render.ts";
import { ownerOf } from "./skill-bodies.ts";

const meta = { capturedAt: "2026-07-27T00:00:00.000Z", promptText: "Hello" };

const payload = {
  model: "probe",
  messages: [
    { role: "developer", content: "You are pi.\n\n# Tools\nUse them.\n" },
    { role: "user", content: "Hello" },
  ],
  tools: [
    {
      type: "function",
      function: { name: "read", description: "Read a file", parameters: {} },
    },
    {
      type: "function",
      function: {
        name: "bash",
        description: "Run a command with a much longer description",
        parameters: { properties: { command: { type: "string" } } },
      },
    },
  ],
};

test("sizes are human-readable at each magnitude", () => {
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(2048), "2.0 KB");
  assert.equal(formatBytes(5 * 1024 * 1024), "5.00 MB");
});

test("token estimates round up, so nothing reads as free", () => {
  assert.equal(estimateTokens(""), 0);
  assert.equal(estimateTokens("abc"), 1);
  assert.equal(estimateTokens("a".repeat(400)), 100);
});

test("prompt text cannot break out of the page", () => {
  const escaped = escapeHtml(`<script>alert("x")</script> & 'quotes'`);
  assert.doesNotMatch(escaped, /<script>/);
  assert.match(escaped, /&lt;script&gt;/);
  assert.match(escaped, /&amp;/);
  assert.match(escaped, /&quot;/);
});

test("a payload containing markup is rendered inert", () => {
  const html = renderReport(
    {
      model: "m",
      messages: [{ role: "user", content: "</pre><script>x()</script>" }],
    },
    meta,
  );
  assert.doesNotMatch(html, /<script>x\(\)<\/script>/);
  assert.match(html, /&lt;script&gt;x\(\)/);
});

test("message content is flattened from every shape a provider uses", () => {
  assert.equal(messageText("plain"), "plain");
  assert.equal(messageText([{ text: "a" }, { text: "b" }]), "a\nb");
  assert.equal(messageText(["a", "b"]), "a\nb");
  assert.equal(messageText(undefined), "");
});

test("instructions are read from developer as well as system", () => {
  const messages = readMessages(payload);
  assert.deepEqual(
    instructionMessages(messages).map((m) => m.role),
    ["developer"],
  );
  // pi sends `developer`; treating only `system` as instructions would show an
  // empty prompt and quietly imply pi sends none.
  assert.equal(
    instructionMessages([{ role: "system", content: "s" }]).length,
    1,
  );
});

test("tools are listed largest first, so the expensive ones surface", () => {
  const tools = readTools(payload);
  assert.deepEqual(
    tools.map((t) => t.name),
    ["bash", "read"],
  );
  assert.ok(tools[0]!.bytes > tools[1]!.bytes);
});

test("sizes are UTF-8 bytes, not UTF-16 code units", () => {
  // The prompt is full of em dashes and arrows. Under `String.length` each is
  // one, on the wire each is three, and the column is headed "bytes".
  assert.equal(byteLength("abc"), 3);
  assert.equal(byteLength("—"), 3);
  assert.equal("—".length, 1);
  const [section] = splitSections("— — —");
  assert.equal(section!.bytes, 11);
});

test("a tool's cost includes its parameters schema, not just its blurb", () => {
  // Measuring the summary instead reported a large `parameters` schema as
  // nearly free — the exact thing this table exists to surface.
  const [tool] = readTools({
    tools: [
      {
        type: "function",
        function: {
          name: "workflow",
          description: "short",
          parameters: { properties: { script: { type: "string" } } },
        },
      },
    ],
  });
  assert.ok(tool!.text.includes("parameters"), tool!.text);
  assert.ok(
    estimateTokens(tool!.text) >
      estimateTokens(`${tool!.name}${tool!.description}`),
  );
  assert.equal(tool!.bytes, byteLength(tool!.text));
});

test("a payload with no tools renders rather than throwing", () => {
  assert.deepEqual(readTools({ messages: [] }), []);
  assert.match(
    renderReport({ messages: [] }, meta),
    /No tools in this payload/,
  );
});

test("sections split on headings and keep the text before the first one", () => {
  const sections = splitSections(
    "base rules\n\n# Tools\nuse them\n## Bash\nrun it",
  );
  assert.deepEqual(
    sections.map((s) => s.heading),
    ["(preamble)", "Tools", "Bash"],
  );
  assert.match(sections[0]!.body, /base rules/);
  assert.match(sections[2]!.body, /run it/);
});

test("section sizes account for the whole prompt, headings included", () => {
  // Sections that skip their own heading line never sum to the instruction
  // total, so a reader cannot tell whether the gap is a missing section.
  const text =
    "base rules\n\n# Tools\nuse them\n## A very long heading\nrun it";
  const sections = splitSections(text);
  const summed = sections.reduce((total, s) => total + s.bytes, 0);
  const joined = sections.map((s) => s.body).join("\n");
  assert.equal(joined, text);
  assert.equal(
    summed + byteLength("\n") * (sections.length - 1),
    byteLength(text),
  );
  assert.match(sections[2]!.body, /## A very long heading/);
});

test("an empty prompt yields no sections instead of one empty one", () => {
  assert.deepEqual(splitSections("   "), []);
});

test("the report includes the prompt, the totals, and every message", () => {
  const html = renderReport(payload, meta);
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /What pi sends when you say/);
  assert.match(html, /Hello/);
  assert.match(html, /You are pi\./);
  assert.match(html, /Use them\./);
  assert.match(html, /bash/);
  assert.match(html, /Raw payload/);
  // Self-contained: no network references, so it opens anywhere.
  assert.doesNotMatch(html, /https?:\/\//);
});

test("the estimate is labelled as one", () => {
  assert.match(renderReport(payload, meta), /characters ÷ 4/);
});

test("a wrapped block is one section, not spliced into the heading before it", () => {
  // The bug this guards: markdown headings run straight through a closing
  // tag, so the last heading inside a context file was charged with every
  // byte that followed it, from other sources entirely.
  const sections = splitSections(
    [
      "base rules",
      "",
      "<project_context>",
      "# AGENTS.md",
      "## Upstream",
      "keep merges cheap",
      "</project_context>",
      "",
      "trailing pi text",
    ].join("\n"),
  );
  const headings = sections.map((s) => s.heading);
  assert.ok(headings.includes("<project_context>"), headings.join(", "));
  assert.ok(!headings.includes("Upstream"), "block contents were split open");
  const block = sections.find((s) => s.heading === "<project_context>")!;
  assert.match(block.body, /keep merges cheap/);
  assert.doesNotMatch(block.body, /trailing pi text/);
  assert.ok(sections.some((s) => /trailing pi text/.test(s.body)));
});

test("skills are read from the catalogue with what each costs", () => {
  const skills = readSkills(
    [
      // Indented exactly as pi emits it: a parser written against the
      // unindented shape silently matched nothing on the real prompt.
      "<available_skills>",
      "  <skill>",
      "    <name>subagents</name>",
      "    <description>How to delegate work, at some length indeed</description>",
      "  </skill>",
      "  <skill>",
      "    <name>linearis</name>",
      "    <description>Linear</description>",
      "  </skill>",
      "</available_skills>",
    ].join("\n"),
  );
  assert.deepEqual(
    skills.map((s) => s.name),
    ["subagents", "linearis"],
  );
  assert.ok(skills[0]!.bytes > skills[1]!.bytes);
});

test("a prompt with no skills catalogue reports none rather than failing", () => {
  assert.deepEqual(readSkills("just prose"), []);
  assert.match(
    renderReport({ messages: [{ role: "developer", content: "hi" }] }, meta),
    /No skills catalogue in this prompt/,
  );
});

// A tool description, a skill body and a role prompt are all prompting we
// wrote. The report exists so they can be read; these guard the reading, not
// the counting.

test("a tool's description is shown in full, not truncated to a preview", () => {
  // The first version cut descriptions at 160 characters, which made the page
  // useless for the thing it is now for: reviewing the exact wording.
  const long = `Use this when ${"x".repeat(400)} and never otherwise.`;
  const html = renderReport(
    {
      messages: [{ role: "developer", content: "hi" }],
      tools: [
        {
          function: {
            name: "workflow",
            description: long,
            parameters: { properties: { step: { description: "which step" } } },
          },
        },
      ],
    },
    meta,
  );
  assert.ok(html.includes(escapeHtml(long)), "description was truncated");
  // The parameter descriptions are prompting too, and only reachable via the
  // serialized schema.
  assert.match(html, /which step/);
});

test("our own skills carry their body; other people's carry only the entry", () => {
  const catalogue = [
    "<available_skills>",
    "  <skill>",
    "    <name>subagents</name>",
    "    <description>How to delegate</description>",
    "    <location>/gen/subagents/SKILL.md</location>",
    "  </skill>",
    "  <skill>",
    "    <name>humanizer</name>",
    "    <description>Someone else's</description>",
    "    <location>/elsewhere/humanizer/SKILL.md</location>",
    "  </skill>",
    "</available_skills>",
  ].join("\n");
  const skills = readSkills(catalogue, {
    "/gen/subagents/SKILL.md": {
      text: "# subagents\nSpawn a rubber-duck when stuck.",
      bytes: 42,
      origin: "generated",
    },
  });
  const byName = new Map(skills.map((s) => [s.name, s]));
  assert.equal(byName.get("subagents")!.body?.origin, "generated");
  assert.equal(byName.get("humanizer")!.body, undefined);
  assert.equal(
    byName.get("humanizer")!.location,
    "/elsewhere/humanizer/SKILL.md",
  );

  const html = renderReport(
    { messages: [{ role: "developer", content: catalogue }] },
    {
      ...meta,
      skillBodies: {
        "/gen/subagents/SKILL.md": {
          text: "duck!",
          bytes: 5,
          origin: "generated",
        },
      },
    },
  );
  assert.match(html, /duck!/);
  // And it is labelled, because a body is not part of the turn being measured.
  assert.match(html, /read on demand, not sent on this turn/);
});

test("every subagent role prompt is rendered, internal ones marked", () => {
  const roles = readRolePrompts();
  const names = roles.map((role) => role.name);
  for (const expected of ["reader", "worker", "advisor", "rubber-duck"])
    assert.ok(names.includes(expected), `${expected} missing from ${names}`);
  assert.ok(
    names.includes("side (internal)"),
    "side is spawnable only by us, and the page should say so",
  );
  // The assembled prompt, not just the role's own framing: the shared rules
  // and the child note are what a child actually reads.
  const duck = roles.find((role) => role.name === "rubber-duck")!;
  assert.match(duck.text, /rubber duck/);
  assert.match(duck.text, /## Engineering Rules/);
  assert.match(duck.text, /## Task/);

  const html = renderReport({ messages: [] }, meta);
  assert.match(html, /Subagent role prompts/);
  assert.match(html, /rubber duck/);
});

test("ownership follows the real path, not where the symlink sits", () => {
  // Everything is linked into ~/.pi/agent/skills, ours and other people's
  // alike, so the link location cannot decide this.
  assert.equal(
    ownerOf(
      "/home/me/code/pi-setup/skills/x/SKILL.md",
      "/home/me/code/pi-setup",
    ),
    "checked in",
  );
  assert.equal(
    ownerOf(
      "/home/me/.pi/agent/generated-skills/subagents/SKILL.md",
      "/home/me/code/pi-setup",
    ),
    "generated",
  );
  assert.equal(
    ownerOf(
      "/home/me/.agents/skills/humanizer/SKILL.md",
      "/home/me/code/pi-setup",
    ),
    null,
  );
  // A sibling checkout sharing our prefix is not us.
  assert.equal(
    ownerOf(
      "/home/me/code/pi-setup-old/skills/x/SKILL.md",
      "/home/me/code/pi-setup",
    ),
    null,
  );
});
