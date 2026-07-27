/**
 * Hermetic tests for the droid backend's translation and policy layers.
 *
 * Nothing here spawns droid, reaches the network, or needs a credential: every
 * function under test is one of the pure halves the backend was split into, so
 * a native frame can be handed over as a literal and its normalized events
 * asserted directly.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AutonomyLevel,
  DroidErrorType,
  DroidWorkingState,
  ReasoningEffort as DroidReasoningEffort,
  type DroidResultMessage,
  type DroidStreamEvent,
  type FactoryDroidMessage,
} from "@factory/droid-sdk";
import { Effect } from "effect";
import { ROLE_NAMES, roleProfile } from "../shared/roles.ts";
import { REASONING_EFFORTS } from "./src/domain.ts";
import {
  assistantText,
  contextOccupancyTokens,
  createDeltaRedactor,
  DROID_ALWAYS_DISABLED_TOOL_IDS,
  DROID_DEFAULT_MODEL,
  droidAlreadyDisabledToolIds,
  droidAutonomyLevel,
  droidBackend,
  droidCwdDirectory,
  droidChildEnv,
  droidModelId,
  droidDisabledToolIds,
  droidReasoningEffort,
  droidRunOutcome,
  droidSessionFilePath,
  redactKey,
  type DroidToolInfo,
  translateDroidEvent,
  waitBounded,
} from "./src/backends/droid.ts";

// --- Model default -------------------------------------------------------------

test("an unspecified model defaults to an open-weight one", () => {
  // droid's own default is claude-opus-5, which would spend Factory credits on
  // a model we can already buy directly. That is the whole point of the
  // fallback, so it is asserted by name rather than by "is not undefined".
  assert.equal(DROID_DEFAULT_MODEL, "glm-5.2");
  assert.equal(droidModelId(undefined), "glm-5.2");
  assert.equal(droidModelId(""), "glm-5.2");
  assert.equal(droidModelId("   "), "glm-5.2");
  for (const family of ["claude", "gpt", "gemini", "grok"])
    assert.ok(
      !DROID_DEFAULT_MODEL.startsWith(family),
      `default routes to ${family}`,
    );
});

test("a named model is passed through untouched", () => {
  assert.equal(droidModelId("kimi-k2.7-code"), "kimi-k2.7-code");
  // Naming a paid model is the caller's call to make; only the default is
  // opinionated.
  assert.equal(droidModelId("claude-opus-5"), "claude-opus-5");
});

// --- Reasoning effort ----------------------------------------------------------

test("every shared effort level maps to a droid level", () => {
  for (const effort of REASONING_EFFORTS) {
    const mapped = droidReasoningEffort(effort);
    assert.ok(mapped !== undefined, `${effort} did not map`);
    assert.ok(
      Object.values(DroidReasoningEffort).includes(mapped),
      `${effort} mapped outside droid's enum`,
    );
  }
});

test("the effort mapping is the identity droid's superset allows", () => {
  assert.equal(droidReasoningEffort("off"), DroidReasoningEffort.Off);
  assert.equal(droidReasoningEffort("medium"), DroidReasoningEffort.Medium);
  assert.equal(droidReasoningEffort("xhigh"), DroidReasoningEffort.ExtraHigh);
  assert.equal(droidReasoningEffort("max"), DroidReasoningEffort.Max);
});

test("an omitted effort leaves droid's own default alone", () => {
  assert.equal(droidReasoningEffort(undefined), undefined);
});

// --- Tool policy ---------------------------------------------------------------

/**
 * droid 0.179.0's registry for glm-5.2, as returned by `listTools()` in the
 * live probe — the `read`/`edit`/`execute` categories are droid's own.
 */
const REGISTRY: DroidToolInfo[] = [
  { llmId: "AskUser", category: "read" },
  { llmId: "Create", category: "edit" },
  { llmId: "CreateAutomation", category: "execute" },
  { llmId: "CronCreate", category: "execute" },
  { llmId: "CronDelete", category: "execute" },
  { llmId: "CronList", category: "read" },
  { llmId: "DeleteAutomation", category: "execute" },
  { llmId: "DismissHandoffItems", category: "read" },
  { llmId: "Edit", category: "edit" },
  { llmId: "EditAutomation", category: "execute" },
  { llmId: "EndFeatureRun", category: "read" },
  { llmId: "Execute", category: "execute" },
  { llmId: "ExitSpecMode", category: "read" },
  { llmId: "FetchUrl", category: "read" },
  { llmId: "GenerateDroid", category: "execute" },
  { llmId: "Glob", category: "read" },
  { llmId: "Grep", category: "read" },
  { llmId: "ListAutomations", category: "read" },
  { llmId: "LS", category: "read" },
  { llmId: "ProposeMission", category: "read" },
  { llmId: "Read", category: "read" },
  { llmId: "ReadAutomation", category: "read" },
  { llmId: "Skill", category: "execute" },
  { llmId: "StartMissionRun", category: "read" },
  { llmId: "Task", category: "execute" },
  { llmId: "TaskOutput", category: "execute" },
  { llmId: "TaskStop", category: "execute" },
  { llmId: "TodoWrite", category: "read" },
  { llmId: "ToolSearch", category: "execute" },
  { llmId: "WebSearch", category: "read" },
];

const readOnly = droidDisabledToolIds(REGISTRY, false);
const writeCapable = droidDisabledToolIds(REGISTRY, true);

test("read-only denies every tool droid categorises as mutating", () => {
  // Naming a shell is not enough on its own: Skill, ToolSearch and the
  // automation tools all reach a command, and category is what catches them.
  for (const tool of [
    "Edit",
    "Create",
    "Execute",
    "Skill",
    "GenerateDroid",
    "CreateAutomation",
    "CronCreate",
  ])
    assert.ok(readOnly.includes(tool), `${tool} was left enabled`);
});

test("the loader droid refuses to release is not asked for", () => {
  // ToolSearch is categorised execute but droid re-adds it whenever any
  // allowed tool is deferred, so denying it yields a session that reports the
  // denial as ignored -- and the spawn's read-back would then reject a
  // perfectly good child.
  assert.ok(!readOnly.includes("ToolSearch"));
  assert.ok(!writeCapable.includes("ToolSearch"));
});

test("read-only also denies the acting tools droid files under read", () => {
  // StartMissionRun launches worker sessions; droid's own category would let
  // it through.
  for (const tool of ["StartMissionRun", "ProposeMission"])
    assert.ok(readOnly.includes(tool), `${tool} was left enabled`);
});

test("read-only keeps the tools that make investigation possible", () => {
  for (const tool of ["Read", "LS", "Glob", "Grep", "WebSearch", "FetchUrl"])
    assert.ok(!readOnly.includes(tool), `${tool} was denied`);
});

test("orchestration stays with the parent for every role", () => {
  for (const denied of [readOnly, writeCapable])
    for (const tool of DROID_ALWAYS_DISABLED_TOOL_IDS)
      assert.ok(denied.includes(tool), `${tool} was left enabled`);
  // Task is the obvious one; StartMissionRun is the one that hides. Both
  // launch work outside the manager's concurrency cap, so a worker role is no
  // more entitled to them than a reader is.
  for (const tool of ["Task", "StartMissionRun"])
    assert.ok(writeCapable.includes(tool), `a worker could launch ${tool}`);
});

test("a write-capable role can still edit and run commands", () => {
  for (const tool of ["Edit", "Create", "Execute", "Skill"])
    assert.ok(!writeCapable.includes(tool), `${tool} was denied to a worker`);
});

test("read-only is strictly more restrictive than write-capable", () => {
  for (const tool of writeCapable)
    assert.ok(readOnly.includes(tool), `read-only dropped ${tool}`);
  assert.ok(readOnly.length > writeCapable.length);
});

test("only tools droid actually registered are named", () => {
  // droid rejects an unknown tool id outright, so a denial list that outlives
  // the tool it names fails every spawn. Intersecting with the live registry
  // is what prevents that.
  const known = new Set(REGISTRY.map((tool) => tool.llmId));
  for (const tool of [...readOnly, ...writeCapable])
    assert.ok(known.has(tool), `${tool} is not in droid's registry`);
  assert.deepEqual(droidDisabledToolIds([], false), []);
});

test("side inherits the harness surface untouched", () => {
  // Same trade as the other backends: a byte-identical tool list is what lets
  // a forked child reuse the parent's cached prefix.
  assert.deepEqual(droidDisabledToolIds(REGISTRY, true, true), []);
});

test("every model-selectable role that cannot write is restricted in the tool list", () => {
  // The failure this guards is a role added to the enum whose read-only
  // promise lives only in its prompt.
  for (const name of ROLE_NAMES) {
    const role = roleProfile(name);
    if (role.writeCapable) continue;
    const denied = droidDisabledToolIds(
      REGISTRY,
      role.writeCapable,
      role.inheritsParentTools,
    );
    assert.ok(denied.includes("Execute"), `${name} kept a shell`);
    assert.ok(denied.includes("Edit"), `${name} kept an editor`);
  }
});

test("tools the user already switched off are carried into the new list", () => {
  // updateSettings replaces droid's disabled set. Sending only the policy's
  // denials would re-enable whatever the user had turned off themselves.
  const tools: DroidToolInfo[] = [
    { llmId: "Execute", category: "execute", currentlyAllowed: true },
    { llmId: "WebSearch", category: "read", currentlyAllowed: false },
    { llmId: "Read", category: "read", currentlyAllowed: true },
    { llmId: "ToolSearch", category: "execute", currentlyAllowed: false },
  ];
  const carried = droidAlreadyDisabledToolIds(tools);
  assert.deepEqual(carried, ["WebSearch"]);
  // ToolSearch is excluded: droid re-adds it, so naming it would fail the
  // spawn's read-back on a session that is otherwise correct.
  assert.ok(!carried.includes("ToolSearch"));
  // A list that says nothing about allowance is not read as "all disabled".
  assert.deepEqual(droidAlreadyDisabledToolIds(REGISTRY), []);
});

test("autonomy reflects the role without blocking the tools it does have", () => {
  // Off would route even a Read through a confirmation this headless child
  // cannot answer; Low permits read tools and nothing that edits or executes.
  assert.equal(droidAutonomyLevel(false), AutonomyLevel.Low);
  assert.equal(droidAutonomyLevel(true), AutonomyLevel.High);
  assert.equal(droidAutonomyLevel(true, true), AutonomyLevel.High);
});

// --- Credentials ---------------------------------------------------------------

test("the backend is unavailable without a key, whatever is on PATH", () => {
  const previous = process.env.FACTORY_API_KEY;
  try {
    delete process.env.FACTORY_API_KEY;
    assert.equal(Effect.runSync(droidBackend.available), false);
    process.env.FACTORY_API_KEY = "   ";
    assert.equal(Effect.runSync(droidBackend.available), false);
  } finally {
    if (previous === undefined) delete process.env.FACTORY_API_KEY;
    else process.env.FACTORY_API_KEY = previous;
  }
});

test("an untrusted checkout is refused, not spawned into", () => {
  // droid has no setting-source switch, so an untrusted project's Factory
  // config and hooks would load with the child. Refusing is the only way to
  // hold the boundary claude and cursor hold by restricting settings.
  const previous = process.env.FACTORY_API_KEY;
  process.env.FACTORY_API_KEY = "fk-test-key";
  try {
    assert.throws(
      () =>
        Effect.runSync(
          Effect.scoped(
            droidBackend.spawn({
              prompt: "anything",
              role: "reader",
              title: "untrusted",
              cwd: "/tmp",
              parent: { parentCwd: "/tmp", projectTrusted: false },
            }),
          ),
        ),
      /not trusted/,
    );
  } finally {
    if (previous === undefined) delete process.env.FACTORY_API_KEY;
    else process.env.FACTORY_API_KEY = previous;
  }
});

test("an error carrying the key is redacted before it becomes an event", () => {
  const key = "fk-secret-value";
  const redacted = redactKey(`auth failed for ${key} (${key})`, key);
  assert.ok(!redacted.includes(key));
  assert.equal(redacted, "auth failed for <redacted> (<redacted>)");
  assert.equal(redactKey("nothing to hide", undefined), "nothing to hide");
});

test("the child environment loses the parent's own secrets", () => {
  // ProcessTransport merges its env over process.env, so a deleted key has to
  // be explicitly undefined to actually be dropped from the spawned droid.
  const env = droidChildEnv({
    FIRECRAWL_API_KEY: "parent-only",
    FACTORY_API_KEY: "childs-own",
    PATH: "/usr/bin",
  }) as Record<string, string | undefined>;
  assert.ok("FIRECRAWL_API_KEY" in env);
  assert.equal(env.FIRECRAWL_API_KEY, undefined);
  assert.equal(env.FACTORY_API_KEY, "childs-own");
  assert.equal(env.PATH, "/usr/bin");
});

// --- Session file path ---------------------------------------------------------

test("the session transcript path follows droid's cwd escaping", () => {
  // droid 0.179.0 collapses slashes to dashes and keeps dots, unlike Claude
  // Code, which also escapes dots.
  const file = droidSessionFilePath("/private/tmp/scratch.abc", "sess-1");
  assert.ok(file.endsWith("/sessions/-private-tmp-scratch.abc/sess-1.jsonl"));
});

test("a Windows cwd escapes to a legal directory name", () => {
  // path.resolve cannot produce this shape on a POSIX host, so the escaping is
  // exercised directly. Backslashes and the drive colon would otherwise land
  // inside the joined filename.
  assert.equal(
    droidCwdDirectory("C:\\Users\\auro\\repo"),
    "-C-Users-auro-repo",
  );
  assert.equal(droidCwdDirectory("/private/tmp/x.y"), "-private-tmp-x.y");
});

// --- Bounded waiting -----------------------------------------------------------

test("a bounded wait gives up on time without failing", async () => {
  await waitBounded(new Promise(() => {}), 5);
});

test("a bounded wait still surfaces a request that failed", async () => {
  // Interrupt is the caller that cares: it reports a rejected request as a
  // BackendError, which a swallowed rejection would make unreachable.
  await assert.rejects(
    waitBounded(Promise.reject(new Error("rpc closed")), 1_000),
    /rpc closed/,
  );
});

// --- Usage ---------------------------------------------------------------------

test("occupancy counts the window, not the thinking breakdown", () => {
  // thinkingTokens is a subset of outputTokens; adding it double-counts.
  assert.equal(
    contextOccupancyTokens({
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 900,
      cacheCreationTokens: 10,
      thinkingTokens: 40,
    }),
    1_060,
  );
});

test("absent usage reports nothing rather than zero", () => {
  assert.equal(contextOccupancyTokens(null), undefined);
  assert.equal(contextOccupancyTokens(undefined), undefined);
  assert.equal(contextOccupancyTokens({ outputTokens: 5 }), undefined);
});

// --- Frame translation ---------------------------------------------------------

function assistantMessage(
  content: FactoryDroidMessage["content"],
): FactoryDroidMessage {
  return {
    id: "msg-1",
    role: "assistant",
    content,
    createdAt: 0,
    updatedAt: 0,
  };
}

function translate(event: DroidStreamEvent, tools = new Map<string, string>()) {
  return translateDroidEvent(event, tools);
}

test("partial text and thinking stream as deltas", () => {
  assert.deepEqual(
    translate({
      type: "assistant_text_delta",
      messageId: "m",
      blockIndex: 0,
      text: "hel",
    }),
    [{ _tag: "AssistantDelta", kind: "text", delta: "hel" }],
  );
  assert.deepEqual(
    translate({
      type: "thinking_text_delta",
      messageId: "m",
      blockIndex: 0,
      text: "hmm",
    }),
    [{ _tag: "AssistantDelta", kind: "thinking", delta: "hmm" }],
  );
});

test("an empty delta emits nothing", () => {
  assert.deepEqual(
    translate({
      type: "assistant_text_delta",
      messageId: "m",
      blockIndex: 0,
      text: "",
    }),
    [],
  );
});

test("a finalized assistant message becomes transcript parts", () => {
  const events = translate({
    type: "assistant",
    text: "done",
    message: assistantMessage([
      { type: "text", text: "done" },
      { type: "thinking", thinking: "because", signature: "sig" },
      { type: "redacted_thinking", data: "opaque" },
      {
        type: "tool_use",
        id: "t1",
        name: "Read",
        input: { file_path: "a.ts" },
      },
    ]),
  });
  assert.deepEqual(events, [
    {
      _tag: "AssistantMessage",
      parts: [
        { type: "text", text: "done" },
        { type: "thinking", text: "because" },
        { type: "thinking", text: "", redacted: true },
        {
          type: "toolCall",
          toolId: "t1",
          name: "Read",
          argsPreview: '{"file_path":"a.ts"}',
        },
      ],
    },
  ]);
  assert.equal(
    assistantText(
      (events[0] as { parts: Parameters<typeof assistantText>[0] }).parts,
    ),
    "done",
  );
});

test("a message with no renderable blocks emits nothing", () => {
  assert.deepEqual(
    translate({ type: "assistant", text: "", message: assistantMessage([]) }),
    [],
  );
});

test("a tool call opens a live tool row and is remembered by id", () => {
  const tools = new Map<string, string>();
  assert.deepEqual(
    translate(
      {
        type: "tool_call",
        toolUse: {
          type: "tool_use",
          id: "t1",
          name: "Grep",
          input: { q: "x" },
        },
      },
      tools,
    ),
    [
      {
        _tag: "ToolStart",
        toolId: "t1",
        name: "Grep",
        argsPreview: '{"q":"x"}',
      },
    ],
  );
  assert.equal(tools.get("t1"), "Grep");
});

test("a tool result closes the row it opened, by remembered name", () => {
  const tools = new Map([["t1", "Grep"]]);
  assert.deepEqual(
    translate(
      {
        type: "tool_result",
        toolUseId: "t1",
        // droid only fills toolName for calls the SDK saw start, so the map is
        // the reliable side of this lookup.
        toolName: "",
        content: "three matches",
        isError: false,
      },
      tools,
    ),
    [
      {
        _tag: "ToolEnd",
        toolId: "t1",
        name: "Grep",
        isError: false,
        outputPreview: "three matches",
      },
    ],
  );
  assert.equal(tools.size, 0);
});

test("a tool result for an unseen call still names something", () => {
  assert.deepEqual(
    translate({
      type: "tool_result",
      toolUseId: "t9",
      toolName: "",
      content: "boom",
      isError: true,
    }),
    [
      {
        _tag: "ToolEnd",
        toolId: "t9",
        name: "Tool",
        isError: true,
        outputPreview: "boom",
      },
    ],
  );
});

test("tool progress updates the live row", () => {
  assert.deepEqual(
    translate({
      type: "tool_progress",
      toolUseId: "t1",
      toolName: "Execute",
      content: "line one\nline two",
      update: { type: "status", status: "running" },
    }),
    [{ _tag: "ToolUpdate", toolId: "t1", outputPreview: "line one line two" }],
  );
});

test("token usage becomes an occupancy report", () => {
  assert.deepEqual(
    translate({
      type: "token_usage_update",
      inputTokens: 10,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      thinkingTokens: 0,
    }),
    [{ _tag: "UsageChanged", tokens: 11 }],
  );
});

test("a settings change relabels the model", () => {
  assert.deepEqual(
    translate({ type: "settings_updated", settings: { modelId: "glm-5.1" } }),
    [{ _tag: "MetaChanged", meta: { modelLabel: "glm-5.1" } }],
  );
});

test("a droid error is a non-fatal diagnostic, not a settled run", () => {
  assert.deepEqual(
    translate({
      type: "error",
      message: "rate limited",
      errorType: DroidErrorType.SESSION_ERROR,
      timestamp: "now",
    }),
    [{ _tag: "BackendError", message: "rate limited" }],
  );
});

test("frames the manager has no view for translate to nothing", () => {
  // Including the user echo of the prompt this session sent -- emitting it
  // would duplicate the transcript row submit() already wrote.
  assert.deepEqual(
    translate({ type: "user", message: assistantMessage([]) }),
    [],
  );
  assert.deepEqual(
    translate({
      type: "working_state_changed",
      state: DroidWorkingState.Idle,
    }),
    [],
  );
  assert.deepEqual(
    translate({ type: "session_title_updated", title: "whatever" }),
    [],
  );
  assert.deepEqual(
    translate({
      type: "assistant_text_complete",
      messageId: "m",
      blockIndex: 0,
    }),
    [],
  );
});

// --- Run outcome ---------------------------------------------------------------

const resultBase = {
  type: "result" as const,
  sessionId: "s1",
  durationMs: 10,
  numTurns: 1,
  messages: [],
  tokenUsage: null,
  turnCount: 1,
};

function successResult(result: string): DroidResultMessage {
  return {
    ...resultBase,
    subtype: "success",
    isError: false,
    success: true,
    error: null,
    result,
    text: result,
  };
}

test("a successful turn completes with droid's own final text", () => {
  assert.deepEqual(droidRunOutcome(successResult("the answer"), "partial"), {
    _tag: "Completed",
    finalText: "the answer",
  });
});

test("a successful turn with no final text falls back to the streamed text", () => {
  assert.deepEqual(droidRunOutcome(successResult("  "), "streamed"), {
    _tag: "Completed",
    finalText: "streamed",
  });
});

test("a key split across deltas is caught when the halves rejoin", () => {
  // The manager concatenates deltas into its live view, so per-frame
  // redaction alone lets a split key through and the consumer reassembles it.
  const key = "fk-live-abcdef123456";
  const redactor = createDeltaRedactor(key);
  const halves = [`the key is ${key.slice(0, 7)}`, `${key.slice(7)} — done`];
  const streamed =
    halves.map((half) => redactor.push(half)).join("") + redactor.flush();
  assert.ok(!streamed.includes(key));
  assert.equal(streamed, "the key is <redacted> — done");
});

test("a delta stream without the key arrives whole", () => {
  const redactor = createDeltaRedactor("fk-live-abcdef123456");
  const streamed =
    ["Hello", " ", "world"].map((part) => redactor.push(part)).join("") +
    redactor.flush();
  assert.equal(streamed, "Hello world");
  // No key, no buffering at all: the stream passes straight through.
  const open = createDeltaRedactor(undefined);
  assert.equal(open.push("anything"), "anything");
  assert.equal(open.flush(), "");
});

test("tool output and assistant text are redacted, not just errors", () => {
  // The child keeps FACTORY_API_KEY — droid needs its own key — so a
  // write-capable one that runs `env` puts the credential in ordinary tool
  // output. Every textual path out of the translator has to scrub it.
  const key = "fk-live-abcdef123456";
  const redact = (text: string) => redactKey(text, key);
  const frames: DroidStreamEvent[] = [
    {
      type: "tool_result",
      toolUseId: "t1",
      toolName: "Execute",
      content: `FACTORY_API_KEY=${key}`,
      isError: false,
    },
    {
      type: "tool_progress",
      toolUseId: "t1",
      content: `reading ${key}`,
    },
    { type: "assistant_text_delta", text: `your key is ${key}` },
    { type: "thinking_text_delta", text: `the key ${key} was in the env` },
    {
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: key }] },
    },
  ] as unknown as DroidStreamEvent[];

  for (const frame of frames) {
    const events = translateDroidEvent(frame, new Map(), redact);
    assert.ok(events.length > 0, `${frame.type} emitted nothing to check`);
    const serialized = JSON.stringify(events);
    assert.ok(!serialized.includes(key), `${frame.type} leaked the key`);
    assert.match(serialized, /<redacted>/);
  }
});

test("a key straddling the preview boundary is scrubbed, not cut in half", () => {
  // Previews are bounded at 1,024 characters. Truncating first would leave a
  // key prefix that no longer matches the exact-match redactor, so the bound
  // has to be applied after the scrub — which means the scrub happens where
  // the truncation does, not at the call site.
  const key = "fk-live-abcdef123456";
  const previous = process.env.FACTORY_API_KEY;
  process.env.FACTORY_API_KEY = key;
  try {
    const events = translateDroidEvent(
      {
        type: "tool_result",
        toolUseId: "t9",
        toolName: "Execute",
        content: `${"x".repeat(1_015)}${key}${"y".repeat(50)}`,
        isError: false,
      } as unknown as DroidStreamEvent,
      new Map(),
    );
    const preview = (events[0] as { outputPreview: string }).outputPreview;
    assert.ok(!preview.includes(key.slice(0, 9)), "leaked a key prefix");
    // The placeholder itself is what the bound clips here, which is the point:
    // the truncation now falls on `<redacted>`, not on the key.
    assert.match(preview, /<redacted/);
  } finally {
    if (previous === undefined) delete process.env.FACTORY_API_KEY;
    else process.env.FACTORY_API_KEY = previous;
  }
});

test("a streamed error frame is redacted on the way to the event", () => {
  // The helper being correct is not the guarantee — the guarantee is that the
  // paths carrying provider text actually call it. This one did not.
  const key = "fk-live-abcdef123456";
  const events = translateDroidEvent(
    {
      type: "error",
      message: `bad key ${key}`,
      errorType: DroidErrorType.SESSION_ERROR,
      timestamp: "now",
    },
    new Map(),
    (text) => redactKey(text, key),
  );
  assert.equal(events.length, 1);
  const message = (events[0] as { message: string }).message;
  assert.ok(!message.includes(key));
  assert.match(message, /<redacted>/);
});

test("a terminal error is redacted on the way to the outcome", () => {
  const key = "fk-live-abcdef123456";
  const failure: DroidResultMessage = {
    ...resultBase,
    subtype: "error_during_execution",
    isError: true,
    success: false,
    errors: [`auth rejected ${key}`],
    error: null,
    result: "",
    text: "",
  };
  const outcome = droidRunOutcome(failure, "", undefined, (text) =>
    redactKey(text, key),
  );
  const errorText = (outcome as { errorText: string }).errorText;
  assert.ok(!errorText.includes(key));
  assert.match(errorText, /<redacted>/);
});

test("a failed turn reports droid's errors and keeps the partial text", () => {
  const failure: DroidResultMessage = {
    ...resultBase,
    subtype: "error_during_execution",
    isError: true,
    success: false,
    errors: ["", "model refused"],
    error: null,
    result: "",
    text: "",
  };
  assert.deepEqual(droidRunOutcome(failure, "half an answer"), {
    _tag: "Failed",
    errorText: "model refused",
    partialText: "half an answer",
  });
});

test("a failed turn with no errors falls back to the streamed diagnostic", () => {
  const failure: DroidResultMessage = {
    ...resultBase,
    subtype: "error_during_execution",
    isError: true,
    success: false,
    errors: [],
    error: null,
    result: "",
    text: "",
  };
  assert.deepEqual(droidRunOutcome(failure, "", "rate limited"), {
    _tag: "Failed",
    errorText: "rate limited",
    partialText: undefined,
  });
  // ...and to something nameable when even that is absent.
  assert.equal(
    (droidRunOutcome(failure, "") as { errorText: string }).errorText,
    "droid ended with error_during_execution",
  );
});
