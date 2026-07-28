import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReport,
  headroom,
  measureEntries,
  messagesByRole,
  toolBytes,
  toolOwner,
  toolsBySource,
  type BudgetInput,
} from "./src/report.ts";

const SECRET = "ACME_INTERNAL_DEPLOY_KEY_ROTATION_POLICY";

function input(overrides: Partial<BudgetInput> = {}): BudgetInput {
  return {
    model: "gpt-5.6-sol",
    provider: "openai-codex",
    thinking: "medium",
    tokens: 40_000,
    contextWindow: 200_000,
    percent: 20,
    maxTokens: 64_000,
    reserveTokens: 16_384,
    reserveIsDefault: true,
    compactionEnabled: true,
    systemPrompt: [
      "You are pi.",
      "",
      "# Tools",
      "Use them.",
      "",
      "<project_context>",
      `# AGENTS.md`,
      SECRET,
      "</project_context>",
    ].join("\n"),
    promptIsComplete: true,
    tools: [
      {
        name: "bash",
        description: "Run a command",
        parameters: { properties: { command: { type: "string" } } },
        source: "built-in",
        active: true,
      },
      {
        name: "subagent_spawn",
        description: "Delegate",
        parameters: {
          properties: {
            prompt: { type: "string" },
            harness: { type: "string" },
          },
        },
        source: "subagents",
        active: true,
      },
    ],
    contextFiles: [{ path: "/repo/AGENTS.md", content: SECRET }],
    skills: [{ name: "subagents" }, { name: "linearis" }],
    messages: [
      { role: "user", chars: 400 },
      { role: "assistant", chars: 1200 },
      { role: "toolResult", chars: 8000 },
    ],
    ...overrides,
  };
}

test("the report never leaks prompt text or file contents", () => {
  // The whole reason this builder is pure and separate. A budget report is
  // something you paste into a chat to ask why the window is full, and the
  // material it measures is routinely private project instructions.
  const report = buildReport(input());
  assert.doesNotMatch(report, new RegExp(SECRET));
  assert.doesNotMatch(report, /You are pi\./);
  assert.doesNotMatch(report, /Use them\./);
  assert.doesNotMatch(report, /Run a command/);
  // Paths and headings are the point, and are not contents.
  assert.match(report, /\/repo\/AGENTS\.md/);
  assert.match(report, /<project_context>/);
});

test("a tool costs its whole schema, not its name", () => {
  const [bash, spawn] = input().tools;
  assert.ok(toolBytes(spawn!) > toolBytes(bash!));
  assert.ok(toolBytes(bash!) > bash!.name.length);
});

test("tools group by what registered them, largest first", () => {
  const groups = toolsBySource(input().tools);
  assert.deepEqual(
    groups.map((g) => g.source),
    ["subagents", "built-in"],
  );
  assert.equal(groups[0]!.count, 1);
});

test("tools are attributed to the extension you could turn off", () => {
  // Real sourceInfo values, captured from a live session. `source` holds how
  // the tool was discovered — "builtin" or "auto" — so grouping on it reported
  // all 25 tools as built-in and made the whole table useless.
  assert.equal(
    toolOwner({
      path: "<builtin:read>",
      source: "builtin",
      scope: "temporary",
      origin: "top-level",
    }),
    "built-in",
  );
  assert.equal(
    toolOwner({
      path: "/Users/auro/.pi/agent/extensions/subagents/index.ts",
      source: "auto",
      scope: "user",
      origin: "top-level",
    }),
    "subagents",
  );
  assert.equal(
    toolOwner({
      path: "/Users/auro/.pi/agent/extensions/file-search/index.ts",
      source: "auto",
      origin: "top-level",
    }),
    "file-search",
  );
});

test("a tool from an installed package is named by its package", () => {
  assert.equal(
    toolOwner({
      path: "/Users/auro/code/pi-opencode-bridge/index.ts",
      source: "pi-opencode-bridge",
      origin: "package",
    }),
    "pi-opencode-bridge",
  );
});

test("an unrecognised source degrades to something rather than throwing", () => {
  assert.equal(toolOwner(undefined), "unknown");
  assert.equal(toolOwner({}), "unknown");
});

test("a prompt measured before the first turn says it is incomplete", () => {
  // getSystemPrompt() has not been through before_agent_start yet, so it is
  // missing whatever extensions append — 3.2 KB of policy on this setup.
  // Reporting that as the figure would understate the prompt by 13%.
  assert.doesNotMatch(buildReport(input()), /before extensions append/);
  assert.match(
    buildReport(input({ promptIsComplete: false })),
    /before extensions append/,
  );
});

test("a disabled tool costs nothing and is not counted as if it did", () => {
  // Its schema is never serialized into the request, so charging the prompt
  // for it overstates both the total and whichever extension registered it.
  const withAll = input();
  const disabled = input({
    tools: withAll.tools.map((tool) =>
      tool.name === "subagent_spawn" ? { ...tool, active: false } : tool,
    ),
  });
  assert.match(buildReport(withAll), /across 2 enabled tools/);
  assert.match(buildReport(disabled), /across 1 enabled tools/);
  assert.match(buildReport(disabled), /1 disabled, not counted/);
  // And the extension that registered it stops being blamed for the bytes.
  assert.doesNotMatch(buildReport(disabled), /subagents \(1\)/);
});

test("headroom measures to the compaction line, not the window", () => {
  // pi compacts when tokens > contextWindow - reserveTokens, so the number a
  // user cares about is distance to that line.
  assert.equal(headroom(input()), 200_000 - 16_384 - 40_000);
});

test("headroom is unknown rather than guessed", () => {
  assert.equal(headroom(input({ tokens: null })), null);
  assert.equal(headroom(input({ compactionEnabled: false })), null);
});

test("a just-compacted session says so instead of showing a wrong total", () => {
  const report = buildReport(input({ tokens: null, percent: null }));
  assert.match(report, /just compacted/);
  assert.doesNotMatch(report, /NaN/);
});

test("disabled auto-compaction is stated, not reported as headroom", () => {
  assert.match(
    buildReport(input({ compactionEnabled: false })),
    /auto-compaction off/,
  );
});

test("the reserve says whether it is configured or assumed", () => {
  assert.match(buildReport(input()), /pi default/);
  assert.match(
    buildReport(input({ reserveIsDefault: false, reserveTokens: 32_000 })),
    /from settings/,
  );
});

test("a compaction summary counts as history, because pi sends it", () => {
  // Counting only type === "message" reported a freshly compacted session as
  // having almost no history, when the summary it was replaced with is usually
  // the largest single thing in the context.
  const measured = measureEntries([
    { type: "compaction", summary: "x".repeat(5000) },
    { type: "message", message: { role: "user", content: "hello" } },
  ]);
  assert.deepEqual(
    measured.map((entry) => entry.role),
    ["summary", "user"],
  );
  assert.equal(measured[0]!.chars, 5000);
});

test("a compaction's retained tail is counted too", () => {
  const measured = measureEntries([
    {
      type: "compaction",
      summary: "s",
      retainedTail: [
        { role: "user", content: "kept" },
        { role: "assistant", content: [{ type: "text", text: "reply" }] },
      ],
    },
  ]);
  assert.deepEqual(
    measured.map((entry) => entry.role),
    ["summary", "user", "assistant"],
  );
});

test("an older compaction without a retained tail still measures", () => {
  // `retainedTail` is optional for backward compatibility with older sessions.
  const measured = measureEntries([{ type: "compaction", summary: "abc" }]);
  assert.deepEqual(measured, [{ role: "summary", chars: 3 }]);
});

test("branch summaries count, and unknown entry types are ignored", () => {
  assert.deepEqual(
    measureEntries([{ type: "branch_summary", summary: "ab" }]),
    [{ role: "summary", chars: 2 }],
  );
  assert.deepEqual(measureEntries([{ type: "label" }, { type: "custom" }]), []);
});

test("a message with no content is measured rather than dropped", () => {
  // A bash execution entry carries no `content`; dropping it would understate
  // history that is still replayed.
  const [measured] = measureEntries([
    { type: "message", message: { role: "bashExecution" } },
  ]);
  assert.equal(measured!.role, "bashExecution");
  assert.ok(measured!.chars > 0);
});

test("history is grouped by role, heaviest first", () => {
  const byRole = messagesByRole(input().messages);
  assert.deepEqual(
    byRole.map((entry) => entry.role),
    ["toolResult", "assistant", "user"],
  );
  assert.equal(byRole[0]!.count, 1);
});

test("a truncated list says what it dropped", () => {
  // Silent truncation reads as "this is everything", and the tail is exactly
  // where unnoticed growth accumulates.
  const many = Array.from({ length: 12 }, (_, i) => ({
    name: `tool${i}`,
    description: "d",
    parameters: {},
    source: `pkg${i}`,
    active: true,
  }));
  const report = buildReport(input({ tools: many }), 3);
  assert.match(report, /… and 9 more/);
});

test("the estimate is labelled, and the real number distinguished", () => {
  const report = buildReport(input());
  assert.match(report, /characters ÷ 4/);
  assert.match(report, /provider's own count/);
});

test("an empty session renders rather than throwing", () => {
  const report = buildReport(
    input({
      messages: [],
      tools: [],
      contextFiles: [],
      skills: [],
      systemPrompt: "",
    }),
  );
  assert.match(report, /gpt-5\.6-sol/);
  assert.doesNotMatch(report, /NaN|undefined/);
});
