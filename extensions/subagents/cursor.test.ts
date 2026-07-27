import assert from "node:assert/strict";
import test from "node:test";
import type { ModelListItem, SDKMessage } from "@cursor/sdk";
import {
  catalogContextWindow,
  CursorFrameTranslator,
  cursorMode,
  cursorModelSelection,
  cursorOccupancyTokens,
} from "./src/backends/cursor.ts";

// Trimmed from a live `Cursor.models.list()` against SDK 1.0.24: the three
// parameter shapes that exist (effort, reasoning, boolean thinking) plus the
// parameterless Auto model.
const catalog: ModelListItem[] = [
  {
    id: "default",
    displayName: "Auto",
    aliases: ["auto"],
    variants: [{ params: [], displayName: "Auto", isDefault: true }],
  },
  {
    id: "grok-4.5",
    displayName: "Cursor Grok 4.5",
    parameters: [
      {
        id: "effort",
        values: [{ value: "low" }, { value: "medium" }, { value: "high" }],
      },
      { id: "fast", values: [{ value: "false" }, { value: "true" }] },
    ],
  },
  {
    id: "gpt-5.5",
    displayName: "GPT-5.5",
    aliases: ["gpt-5-5"],
    parameters: [
      {
        id: "context",
        values: [{ value: "272k" }, { value: "1m" }],
      },
      {
        id: "reasoning",
        values: [
          { value: "none" },
          { value: "low" },
          { value: "medium" },
          { value: "high" },
          { value: "extra-high" },
        ],
      },
    ],
    variants: [
      {
        params: [
          { id: "context", value: "272k" },
          { id: "reasoning", value: "medium" },
        ],
        displayName: "GPT-5.5",
        isDefault: true,
      },
    ],
  },
  {
    id: "claude-haiku-4-5",
    displayName: "Haiku 4.5",
    aliases: ["haiku"],
    parameters: [
      { id: "thinking", values: [{ value: "false" }, { value: "true" }] },
    ],
  },
];

// --- Mode ---------------------------------------------------------------------

test("read-only roles get plan mode; write-capable roles get agent mode", () => {
  assert.equal(cursorMode(false), "plan");
  assert.equal(cursorMode(true), "agent");
});

// --- Model selection ------------------------------------------------------------

test("no model and no effort selects Auto with no params", () => {
  assert.deepEqual(cursorModelSelection(undefined, undefined, catalog), {
    id: "default",
  });
});

test("aliases canonicalize to the catalog id", () => {
  assert.deepEqual(cursorModelSelection("gpt-5-5", undefined, catalog), {
    id: "gpt-5.5",
  });
});

test("effort maps onto the model's effort parameter, clamped to what it supports", () => {
  assert.deepEqual(cursorModelSelection("grok-4.5", "medium", catalog), {
    id: "grok-4.5",
    params: [{ id: "effort", value: "medium" }],
  });
  // grok tops out at high.
  assert.deepEqual(cursorModelSelection("grok-4.5", "max", catalog), {
    id: "grok-4.5",
    params: [{ id: "effort", value: "high" }],
  });
  // "off" biases down to the lowest supported value.
  assert.deepEqual(cursorModelSelection("grok-4.5", "off", catalog), {
    id: "grok-4.5",
    params: [{ id: "effort", value: "low" }],
  });
});

test("gpt models spell the scale as a reasoning parameter", () => {
  assert.deepEqual(cursorModelSelection("gpt-5.5", "off", catalog), {
    id: "gpt-5.5",
    params: [{ id: "reasoning", value: "none" }],
  });
  // xhigh matches gpt-5.5's "extra-high" spelling exactly.
  assert.deepEqual(cursorModelSelection("gpt-5.5", "xhigh", catalog), {
    id: "gpt-5.5",
    params: [{ id: "reasoning", value: "extra-high" }],
  });
});

test("models with only a boolean thinking parameter degrade to on/off", () => {
  assert.deepEqual(cursorModelSelection("haiku", "high", catalog), {
    id: "claude-haiku-4-5",
    params: [{ id: "thinking", value: "true" }],
  });
  assert.deepEqual(cursorModelSelection("haiku", "off", catalog), {
    id: "claude-haiku-4-5",
    params: [{ id: "thinking", value: "false" }],
  });
});

test("effort is dropped, never guessed, on Auto or without a catalog", () => {
  assert.deepEqual(cursorModelSelection(undefined, "high", catalog), {
    id: "default",
  });
  assert.deepEqual(cursorModelSelection("grok-4.5", "high", undefined), {
    id: "grok-4.5",
  });
});

// --- Context window ---------------------------------------------------------------

test("context window is read from the default variant's context parameter", () => {
  assert.equal(catalogContextWindow("gpt-5.5", catalog), 272_000);
  assert.equal(catalogContextWindow("default", catalog), undefined);
  assert.equal(catalogContextWindow("gpt-5.5", undefined), undefined);
});

// --- Usage -------------------------------------------------------------------------

test("occupancy sums input, cache, and output tokens", () => {
  assert.equal(
    cursorOccupancyTokens({
      inputTokens: 500,
      outputTokens: 400,
      cacheReadTokens: 60_000,
      cacheWriteTokens: 3_000,
      totalTokens: 63_900,
      reasoningTokens: 120,
    }),
    63_900,
  );
  assert.equal(cursorOccupancyTokens(undefined), undefined);
});

// --- Frame translation ---------------------------------------------------------------

const ids = { agent_id: "agent-1", run_id: "run-1" };

test("a live run's frame sequence translates to the normalized events", () => {
  const translator = new CursorFrameTranslator();
  const frames: SDKMessage[] = [
    { type: "status", ...ids, status: "RUNNING" },
    { type: "system", ...ids, subtype: "init", model: { id: "composer-2.5" } },
    { type: "thinking", ...ids, text: "Considering.", thinking_duration_ms: 5 },
    {
      type: "assistant",
      ...ids,
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Reading the file." },
          {
            type: "tool_use",
            id: "call-1",
            name: "read",
            input: { path: "a" },
          },
        ],
      },
    },
    {
      type: "tool_call",
      ...ids,
      call_id: "call-1",
      name: "read",
      status: "running",
    },
    {
      type: "tool_call",
      ...ids,
      call_id: "call-1",
      name: "read",
      status: "completed",
      result: "line one\nline two",
    },
    {
      type: "user",
      ...ids,
      message: { role: "user", content: [{ type: "text", text: "echo" }] },
    },
    {
      type: "usage",
      ...ids,
      usage: {
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 150,
      },
    },
    { type: "status", ...ids, status: "FINISHED" },
  ];
  const events = frames.flatMap((frame) => translator.translate(frame));
  assert.deepEqual(events, [
    { _tag: "MetaChanged", meta: { modelLabel: "composer-2.5" } },
    {
      _tag: "AssistantMessage",
      parts: [{ type: "thinking", text: "Considering." }],
    },
    {
      _tag: "AssistantMessage",
      parts: [
        { type: "text", text: "Reading the file." },
        {
          type: "toolCall",
          toolId: "call-1",
          name: "read",
          argsPreview: '{"path":"a"}',
        },
      ],
    },
    {
      _tag: "ToolStart",
      toolId: "call-1",
      name: "read",
      argsPreview: '{"path":"a"}',
    },
    {
      _tag: "ToolEnd",
      toolId: "call-1",
      name: "read",
      isError: false,
      outputPreview: "line one line two",
    },
    { _tag: "UsageChanged", tokens: 150 },
  ]);
  assert.equal(translator.lastAssistantText, "Reading the file.");
  assert.equal(translator.runErrorText, undefined);
});

test("a completed tool_call with no prior start still opens and closes the tool", () => {
  const translator = new CursorFrameTranslator();
  const events = translator.translate({
    type: "tool_call",
    ...ids,
    call_id: "call-2",
    name: "shell",
    status: "error",
    args: { command: "ls" },
    result: { error: "boom" },
  });
  assert.deepEqual(
    events.map((event) => event._tag),
    ["ToolStart", "ToolEnd"],
  );
  assert.deepEqual(events[1], {
    _tag: "ToolEnd",
    toolId: "call-2",
    name: "shell",
    isError: true,
    outputPreview: '{"error":"boom"}',
  });
});

test("a status ERROR frame is captured for the settlement, not rendered", () => {
  const translator = new CursorFrameTranslator();
  const events = translator.translate({
    type: "status",
    ...ids,
    status: "ERROR",
    message: "[unknown] Invalid User API Key",
  });
  assert.deepEqual(events, []);
  assert.equal(translator.runErrorText, "[unknown] Invalid User API Key");
});

test("the key never reaches an event, whichever frame carries it", () => {
  // The agent runs in this process, so its shell tools inherit CURSOR_API_KEY
  // and a write-capable child can put it in ordinary output. Every textual
  // frame is a complete message here — Cursor emits no deltas — so redacting
  // per frame is sufficient, unlike droid.
  const key = "key_live_abcdef0123456789";
  const translator = new CursorFrameTranslator();
  const frames: SDKMessage[] = [
    {
      type: "assistant",
      ...ids,
      message: {
        role: "assistant",
        content: [{ type: "text", text: `it is ${key}` }],
      },
    },
    {
      type: "thinking",
      ...ids,
      text: `the key ${key}`,
      thinking_duration_ms: 1,
    },
    {
      type: "tool_call",
      ...ids,
      call_id: "call-9",
      name: "shell",
      status: "completed",
      args: { command: "env" },
      result: { stdout: `CURSOR_API_KEY=${key}` },
    },
  ] as SDKMessage[];

  const previous = process.env.CURSOR_API_KEY;
  process.env.CURSOR_API_KEY = key;
  try {
    for (const frame of frames) {
      const serialized = JSON.stringify(translator.translate(frame));
      assert.ok(!serialized.includes(key), `${frame.type} leaked the key`);
      assert.match(serialized, /<redacted>/);
    }
    assert.ok(!translator.lastAssistantText.includes(key));
  } finally {
    if (previous === undefined) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = previous;
  }
});
