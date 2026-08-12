import assert from "node:assert/strict";
import { test } from "node:test";
import {
  COMMUNICATION_STANDARDS,
  ENGINEERING_POLICY,
  ORCHESTRATION,
  PI_WORKSPACE,
  SAFETY_RULES,
  SECOND_OPINIONS,
} from "../shared/engineering-policy.ts";
import { withoutSubagentPolicyFromPayload } from "./src/backends/pi.ts";

test("read-only pi child payloads omit parent-only system-prompt sections", () => {
  const systemPrompt = [
    "You are pi.",
    ENGINEERING_POLICY,
    ORCHESTRATION,
    SECOND_OPINIONS,
    SAFETY_RULES,
    COMMUNICATION_STANDARDS,
    PI_WORKSPACE,
    "<project_context>Repo rules.</project_context>",
  ].join("\n\n");
  const payload = {
    model: "example",
    messages: [
      { role: "developer", content: systemPrompt },
      { role: "user", content: [{ type: "text", text: "Task" }] },
    ],
  };

  const filtered = withoutSubagentPolicyFromPayload(payload) as {
    model: string;
    messages: Array<{ role: string; content: unknown }>;
  };
  const prompt = filtered.messages[0]?.content;
  assert.equal(typeof prompt, "string");
  if (typeof prompt !== "string") throw new Error("system prompt was not text");
  for (const omitted of [
    ORCHESTRATION,
    SECOND_OPINIONS,
    COMMUNICATION_STANDARDS,
    PI_WORKSPACE,
  ]) {
    assert.ok(!prompt.includes(omitted), omitted.split("\n", 1)[0]);
  }
  for (const retained of [ENGINEERING_POLICY, SAFETY_RULES]) {
    assert.ok(prompt.includes(retained), retained.split("\n", 1)[0]);
  }
  assert.match(prompt, /<project_context>Repo rules\.<\/project_context>/);
  assert.deepEqual(filtered.messages[1], payload.messages[1]);
  assert.equal(filtered.model, payload.model);
});

test("worker pi child payloads retain workspace guidance", () => {
  const payload = {
    messages: [
      {
        role: "developer",
        content: [
          "Base",
          ORCHESTRATION,
          SECOND_OPINIONS,
          COMMUNICATION_STANDARDS,
          PI_WORKSPACE,
        ].join("\n\n"),
      },
    ],
  };
  const filtered = withoutSubagentPolicyFromPayload(payload, {
    includeWorkspace: true,
  }) as typeof payload;
  const prompt = filtered.messages[0]?.content ?? "";

  assert.ok(prompt.includes(PI_WORKSPACE));
  for (const omitted of [
    ORCHESTRATION,
    SECOND_OPINIONS,
    COMMUNICATION_STANDARDS,
  ]) {
    assert.ok(!prompt.includes(omitted), omitted.split("\n", 1)[0]);
  }
});

test("pi child payload filtering supports system-role providers", () => {
  const payload = {
    messages: [{ role: "system", content: `Base\n\n${ORCHESTRATION}` }],
  };
  const filtered = withoutSubagentPolicyFromPayload(payload) as typeof payload;
  assert.equal(filtered.messages[0]?.content, "Base");
});

test("pi child payload filtering supports provider-native system fields", () => {
  const prompt = `Base\n\n${ORCHESTRATION}`;
  const cases = [
    { instructions: prompt },
    { input: [{ role: "developer", content: prompt }] },
    { input: [{ role: "system", content: prompt }] },
    { systemInstruction: prompt },
    { systemInstruction: { parts: [{ text: prompt }], role: "system" } },
    { config: { systemInstruction: prompt, temperature: 1 } },
    {
      config: {
        systemInstruction: { parts: [{ text: prompt }], role: "system" },
      },
    },
    { system: prompt },
    {
      system: [
        { type: "text", text: "Provider identity", cache_control: {} },
        { type: "text", text: prompt, cache_control: {} },
      ],
    },
    { system: [{ text: prompt }, { cachePoint: { type: "default" } }] },
    { context: { systemPrompt: prompt, messages: [] } },
  ];

  for (const payload of cases) {
    const filtered = withoutSubagentPolicyFromPayload(payload);
    assert.doesNotMatch(JSON.stringify(filtered), /## Orchestration/);
    assert.match(JSON.stringify(filtered), /Base/);
  }
});

test("pi child payload filtering leaves unrelated payloads untouched", () => {
  const payload = {
    messages: [
      { role: "developer", content: "Base" },
      { role: "user", content: "Task" },
    ],
  };
  assert.equal(withoutSubagentPolicyFromPayload(payload), payload);
  const other = { input: [] };
  assert.equal(withoutSubagentPolicyFromPayload(other), other);
});
