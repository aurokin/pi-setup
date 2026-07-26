import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCodexCredentials } from "./src/auth.ts";
import {
  CompactionState,
  fromPersistedDetails,
  toPersistedDetails,
} from "./src/state.ts";

const artifact = {
  type: "compaction" as const,
  id: "cmp_1",
  encrypted_content: "blob",
};

// --- state --------------------------------------------------------------------

test("an artifact is only handed back to the model that produced it", () => {
  // The artifact is opaque and decrypted server-side. Replaying one model's
  // artifact into another model's request corrupts context without an error.
  const state = new CompactionState();
  state.remember("cmp_1", artifact, "gpt-5.6-sol");
  assert.deepEqual(state.lookup("cmp_1", "gpt-5.6-sol"), artifact);
  assert.equal(state.lookup("cmp_1", "gpt-5.6-luna"), undefined);
});

test("only payloads carrying a model are snapshotted", () => {
  // The snapshot's whole job is to supply the compaction request's model and
  // tools. One without a model would build a request that cannot be sent.
  const modelless = new CompactionState();
  modelless.recordPayload({ input: [] });
  assert.equal(modelless.snapshot, undefined);

  const state = new CompactionState();
  state.recordPayload({ model: "gpt-5.6-sol", input: [] });
  assert.equal(state.snapshot?.model, "gpt-5.6-sol");
});

test("shutdown drops everything", () => {
  const state = new CompactionState();
  state.recordPayload({ model: "m" });
  state.remember("cmp_1", artifact, "m");
  state.clear();
  assert.equal(state.size, 0);
  assert.equal(state.snapshot, undefined);
});

// --- persistence --------------------------------------------------------------

test("details survive a round trip", () => {
  const restored = fromPersistedDetails(
    toPersistedDetails("cmp_1", "m", artifact),
  );
  assert.equal(restored?.id, "cmp_1");
  assert.equal(restored?.model, "m");
  assert.deepEqual(restored?.artifact, artifact);
});

test("foreign or future details are ignored rather than half-read", () => {
  // Other extensions write to the same `details` field, and a future version of
  // this one will write a different shape. Both must be inert here.
  assert.equal(fromPersistedDetails(undefined), undefined);
  assert.equal(fromPersistedDetails({ artifactIndex: {} }), undefined);
  assert.equal(
    fromPersistedDetails({
      codexCompaction: { version: 2, id: "x", model: "m", artifact },
    }),
    undefined,
  );
  assert.equal(
    fromPersistedDetails({ codexCompaction: { version: 1, id: "x" } }),
    undefined,
  );
});

// --- credentials --------------------------------------------------------------

function authDir(contents: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "codex-compaction-"));
  writeFileSync(join(dir, "auth.json"), JSON.stringify(contents));
  return dir;
}

test("credentials are read from the codex entry", () => {
  const dir = authDir({
    "openai-codex": {
      access: "tok",
      accountId: "acct",
      expires: Date.now() + 60_000,
    },
  });
  const creds = readCodexCredentials({ env: { PI_CODING_AGENT_DIR: dir } });
  assert.equal(creds?.accountId, "acct");
});

test("every expected absence returns undefined instead of throwing", () => {
  // All three mean the same thing operationally: let pi compact normally. A
  // throw here would surface as a failed compaction on an overflowing context.
  const cases: [string, unknown][] = [
    ["no codex entry", { anthropic: {} }],
    ["missing token", { "openai-codex": { accountId: "acct" } }],
    ["missing account", { "openai-codex": { access: "tok" } }],
    [
      "expired",
      { "openai-codex": { access: "t", accountId: "a", expires: 1 } },
    ],
  ];
  for (const [label, contents] of cases) {
    const dir = authDir(contents);
    assert.equal(
      readCodexCredentials({ env: { PI_CODING_AGENT_DIR: dir } }),
      undefined,
      label,
    );
  }
  assert.equal(
    readCodexCredentials({
      env: { PI_CODING_AGENT_DIR: "/nonexistent-path-xyz" },
    }),
    undefined,
    "missing auth file",
  );
});

test("an entry with no expiry is used rather than refused", () => {
  // A 401 is a clearer failure than declining to try, and pi owns refresh.
  const dir = authDir({ "openai-codex": { access: "tok", accountId: "acct" } });
  assert.ok(readCodexCredentials({ env: { PI_CODING_AGENT_DIR: dir } }));
});
