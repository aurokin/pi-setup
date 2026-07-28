/**
 * Effort clamping for the codex backend.
 *
 * pi's effort levels and Codex's are not the same set, and each Codex model
 * exposes its own subset — some use "none" where others use "minimal". A wrong
 * clamp is silent: the turn still runs, just at an effort nobody asked for, so
 * the only place it can be caught is here.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { supportedCodexEffort } from "./src/backends/codex.ts";

function modelList(
  efforts: string[],
  overrides: { id?: string; isDefault?: boolean } = {},
) {
  return {
    data: [
      {
        id: overrides.id ?? "gpt-5.6-sol",
        isDefault: overrides.isDefault ?? true,
        supportedReasoningEfforts: efforts.map((reasoningEffort) => ({
          reasoningEffort,
        })),
      },
    ],
  };
}

test("a supported effort passes through untouched", () => {
  assert.equal(
    supportedCodexEffort("high", "gpt-5.6-sol", modelList(["low", "high"])),
    "high",
  );
});

test("an equidistant choice biases toward more reasoning", () => {
  // "medium" sits exactly between "low" and "high". Rounding down would quietly
  // downgrade every turn on a model that skips the middle rung.
  assert.equal(
    supportedCodexEffort("medium", "gpt-5.6-sol", modelList(["low", "high"])),
    "high",
  );
});

test('but "off" biases down, because it asked for none', () => {
  // "off" maps to "minimal", which is equidistant from "none" and "low". The
  // general upward bias is wrong here: the user asked for as little as possible.
  assert.equal(
    supportedCodexEffort("off", "gpt-5.6-sol", modelList(["none", "low"])),
    "none",
  );
});

test("an unknown model clamps against the default one", () => {
  // The label comes from config and can name a model this Codex build has never
  // heard of. Falling back to the default model's rungs beats sending an effort
  // no model accepts.
  assert.equal(
    supportedCodexEffort(
      "medium",
      "gpt-9-imaginary",
      modelList(["none", "low"], { id: "gpt-5.6-sol", isDefault: true }),
    ),
    "low",
  );
});

test("with no model to clamp against, the preferred effort is sent as-is", () => {
  assert.equal(
    supportedCodexEffort("xhigh", "gpt-5.6-sol", undefined),
    "xhigh",
  );
  assert.equal(
    supportedCodexEffort("medium", "gpt-9-imaginary", { data: [] }),
    "medium",
  );
});

test("no effort asked for means no effort sent", () => {
  assert.equal(
    supportedCodexEffort(undefined, "gpt-5.6-sol", modelList(["low"])),
    undefined,
  );
});
