import assert from "node:assert/strict";
import test from "node:test";
import {
  COMMUNICATION_STANDARDS,
  DELEGATION,
  SECOND_OPINIONS,
  PI_PROFILE,
  PI_WORKSPACE,
} from "../../extensions/shared/engineering-policy.ts";
import {
  buildRolePrompt,
  roleProfile,
  rolePromptContributions,
} from "../../extensions/shared/roles.ts";
import {
  assembledPiSurface,
  capturedSurface,
  extensionSurfaces,
  groupVariants,
  type PiPromptAssembly,
} from "./surfaces.ts";
import { renderReport } from "./render.ts";

const task = "Inspect this example";
const assembly: PiPromptAssembly = {
  systemPrompt: [
    "You are Pi.",
    PI_PROFILE,
    "<project_context>\n# AGENTS.md\nProject instruction\n</project_context>",
    "<available_skills>\n<skill><name>example</name></skill>\n</available_skills>",
  ].join("\n\n"),
  tools: ["read", "bash", "edit", "workflow", "ask_user"].map((name) => ({
    name,
    description: `${name} description`,
    parameters: { type: "object" },
  })),
  history: [
    { role: "user", content: "Earlier task" },
    { role: "assistant", content: "Earlier answer" },
  ],
  sources: ["test production composition"],
  limitations: ["Test assembly; not captured"],
};

const pi = (role: Parameters<typeof roleProfile>[0]) =>
  assembledPiSurface(roleProfile(role), task, assembly);
const instructionText = (surface: ReturnType<typeof pi>) =>
  surface.contributions
    .filter((part) =>
      ["system", "global", "workspace", "skills"].includes(part.kind),
    )
    .map((part) => part.content)
    .join("\n");

test("captured, assembled and partial surfaces have distinct fidelity labels", () => {
  const payload = {
    messages: [{ role: "developer", content: "Captured system" }],
  };
  const html = renderReport(payload, {
    capturedAt: "test",
    promptText: task,
    surfaces: [pi("reader"), ...extensionSurfaces(task)],
  });
  assert.equal(capturedSurface(payload).fidelity, "captured");
  assert.equal(pi("reader").fidelity, "assembled");
  for (const label of [
    "Captured request",
    "Assembled prompt",
    "Extension message only",
  ])
    assert.ok(html.includes(label));
  assert.match(html, /not captured at a provider boundary/);
  assert.match(html, /Only the message owned by pi-setup/);
});

test("contributions preserve instruction and conversation order with tools separate", () => {
  const surface = capturedSurface({
    messages: [
      { role: "developer", content: assembly.systemPrompt },
      ...assembly.history,
      { role: "user", content: task },
    ],
    tools: assembly.tools,
  });
  const kinds = surface.contributions.map((part) => part.kind);
  assert.equal(kinds[0], "system");
  assert.ok(kinds.indexOf("global") < kinds.indexOf("workspace"));
  assert.ok(kinds.indexOf("workspace") < kinds.indexOf("skills"));
  assert.deepEqual(
    surface.contributions
      .filter((part) => part.kind === "history")
      .map((part) => part.content),
    ["Earlier task", "Earlier answer"],
  );
  assert.equal(kinds.at(-2), "task");
  assert.equal(kinds.at(-1), "tools");
  assert.deepEqual(
    pi("reader")
      .contributions.slice(-4)
      .map((part) => part.kind),
    ["role", "contract", "task", "tools"],
  );
});

test("Pi policy filtering keeps worker workspace guidance and /btw parent policy", () => {
  for (const role of ["reader", "advisor", "rubber-duck", "worker"] as const) {
    const text = instructionText(pi(role));
    for (const omitted of [
      DELEGATION,
      SECOND_OPINIONS,
      COMMUNICATION_STANDARDS,
    ])
      assert.ok(!text.includes(omitted), `${role} retains parent-only policy`);
    assert.equal(text.includes(PI_WORKSPACE), role === "worker");
    assert.match(text, /Project instruction/);
    assert.match(text, /<available_skills>/);
  }
  const side = instructionText(pi("side"));
  for (const retained of [DELEGATION, COMMUNICATION_STANDARDS, PI_WORKSPACE])
    assert.ok(side.includes(retained));
});

test("Pi roles change tool restrictions and inherited context", () => {
  const toolNames = (role: Parameters<typeof pi>[0]) => {
    const content = pi(role).contributions.find(
      (part) => part.kind === "tools",
    )!.content;
    return (JSON.parse(content) as { name: string }[]).map((tool) => tool.name);
  };
  assert.deepEqual(toolNames("reader"), ["read"]);
  assert.deepEqual(toolNames("worker"), ["read", "bash", "edit"]);
  assert.deepEqual(
    toolNames("side"),
    assembly.tools.map((tool) => tool.name),
  );
  assert.equal(
    pi("reader").contributions.some((part) => part.kind === "history"),
    false,
  );
  const side = pi("side");
  assert.deepEqual(
    side.contributions
      .filter((part) => part.kind === "history")
      .map((part) => part.content),
    ["Earlier task", "Earlier answer"],
  );
  assert.ok(
    side.contributions.findIndex((part) => part.kind === "history") <
      side.contributions.findIndex((part) => part.kind === "role"),
  );
});

test("equivalent prompts group their dimensions without merging different context or fidelity", () => {
  const original = pi("reader");
  const equivalent = {
    ...original,
    id: "alias",
    title: "Another selection",
    dimensions: [{ ...original.dimensions[0]!, harness: "another selection" }],
  };
  const grouped = groupVariants([
    original,
    equivalent,
    pi("worker"),
    pi("side"),
  ]);
  assert.equal(grouped.length, 3);
  assert.deepEqual(
    grouped[0]!.dimensions.map((d) => d.harness),
    ["pi", "another selection"],
  );
  assert.equal(
    groupVariants([original, { ...equivalent, fidelity: "captured" }]).length,
    2,
  );
  assert.equal(
    groupVariants([
      original,
      {
        ...equivalent,
        dimensions: [
          { ...equivalent.dimensions[0]!, tools: "Different tool restriction" },
        ],
      },
    ]).length,
    2,
  );
  assert.equal(
    groupVariants([
      original,
      {
        ...equivalent,
        contributions: [
          ...equivalent.contributions,
          {
            kind: "history",
            label: "History",
            source: "test",
            content: "Another turn",
          },
        ],
      },
    ]).length,
    2,
  );
});

test("shared messages group harnesses while retaining native restriction differences", () => {
  const variants = extensionSurfaces(task);
  assert.equal(variants.length, 5);
  const reader = variants.find((variant) => variant.id === "message-reader")!;
  assert.deepEqual(
    reader.dimensions.map((d) => d.harness),
    ["pi", "claude", "codex", "droid", "cursor"],
  );
  assert.match(
    reader.dimensions.find((d) => d.harness === "claude")!.tools,
    /Bash/,
  );
  assert.match(
    reader.dimensions.find((d) => d.harness === "codex")!.tools,
    /read-only/,
  );
  assert.match(
    reader.dimensions.find((d) => d.harness === "cursor")!.tools,
    /plan/,
  );
  assert.equal(reader.fidelity, "extension-message");
  assert.equal(
    reader.extensionMessage,
    buildRolePrompt({ role: roleProfile("reader"), task }),
  );
});

test("role contributions preserve production composition and default task resolution", () => {
  const role = roleProfile("advisor");
  const parts = rolePromptContributions({ role, task: "  " });
  assert.match(parts[2].content, /Review the work described/);
  assert.equal(
    parts.map((part) => part.content).join("\n\n---\n\n"),
    buildRolePrompt({ role, task: "  " }),
  );
});

test("project headings cannot masquerade as global policy attribution", () => {
  const surface = capturedSurface({
    messages: [
      {
        role: "developer",
        content:
          "<project_context>\n## Engineering Rules\nProject-specific text\n</project_context>",
      },
    ],
  });
  assert.equal(surface.contributions.length, 1);
  assert.equal(surface.contributions[0]!.kind, "workspace");
});

test("grouping depends on content, not source labels, and retains both sources", () => {
  const original = pi("reader");
  const other = {
    ...original,
    id: "other-source",
    contributions: original.contributions.map((part) => ({
      ...part,
      source: "another production path",
      label: "Another label",
    })),
    limitations: ["Another source limitation"],
  };
  const grouped = groupVariants([original, other]);
  assert.equal(grouped.length, 1);
  assert.match(
    grouped[0]!.contributions[0]!.source,
    /test production composition; another production path/,
  );
  assert.deepEqual(grouped[0]!.limitations, [
    "Test assembly; not captured",
    "Another source limitation",
  ]);
});
