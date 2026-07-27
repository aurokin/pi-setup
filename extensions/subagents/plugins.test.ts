import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CORE_BACKENDS,
  describeDisabledPlugin,
  enabledBackendNames,
  IMPLEMENTED_PLUGINS,
  loadEnabledPlugins,
  parseEnabledPlugins,
  PLUGIN_BACKENDS,
  PLUGINS_ENV_VAR,
} from "./src/plugins.ts";
import { BACKEND_NAMES } from "./src/domain.ts";

test("plugins are off unless asked for", () => {
  // The default matters: a harness the model can see is one it will eventually
  // pick, and each plugin spends a different subscription.
  assert.deepEqual(parseEnabledPlugins(undefined).enabled, []);
  assert.deepEqual(parseEnabledPlugins("").enabled, []);
  assert.deepEqual(parseEnabledPlugins("   ").enabled, []);
});

test("a known name with no backend yet is pending, not enabled", () => {
  // Offering a harness that cannot spawn reads as a bug rather than as work
  // still in progress, so it stays out of the enum until its backend lands.
  const selection = parseEnabledPlugins("droid,cursor");
  const expected = ["droid", "cursor"].filter(
    (name) => !IMPLEMENTED_PLUGINS.includes(name as never),
  );
  assert.deepEqual(selection.pending, expected);
  assert.deepEqual(
    selection.enabled,
    ["droid", "cursor"].filter((name) =>
      IMPLEMENTED_PLUGINS.includes(name as never),
    ),
  );
});

test("spacing, case, and duplicates do not change the result", () => {
  const selection = parseEnabledPlugins(" DROID , cursor ,droid");
  assert.deepEqual(
    [...selection.enabled, ...selection.pending],
    ["droid", "cursor"],
  );
});

test("order follows the catalog, not what the user typed", () => {
  // So the harness enum is stable regardless of how the env var was written.
  assert.deepEqual(
    parseEnabledPlugins("cursor,droid").pending,
    parseEnabledPlugins("droid,cursor").pending,
  );
});

test("an unknown name is reported rather than silently dropped", () => {
  const selection = parseEnabledPlugins("droid,drooid");
  assert.deepEqual(selection.unknown, ["drooid"]);
  assert.ok(!selection.pending.includes("drooid" as never));
});

test("the offered harnesses are core plus whatever is on", () => {
  assert.deepEqual(enabledBackendNames(parseEnabledPlugins(undefined)), [
    ...CORE_BACKENDS,
  ]);
  // With no backends implemented yet, asking for one changes nothing.
  assert.deepEqual(enabledBackendNames(parseEnabledPlugins("cursor")), [
    ...CORE_BACKENDS,
    ...IMPLEMENTED_PLUGINS.filter((name) => name === "cursor"),
  ]);
});

test("the catalog is core plus plugins, with no overlap", () => {
  assert.deepEqual(BACKEND_NAMES, [...CORE_BACKENDS, ...PLUGIN_BACKENDS]);
  const overlap = CORE_BACKENDS.filter((name) =>
    (PLUGIN_BACKENDS as readonly string[]).includes(name),
  );
  assert.deepEqual(overlap, []);
});

test("an empty env var means none, and does not fall through to .env", () => {
  // The only way to turn everything off for one session. A truthiness check
  // here would silently re-enable whatever ~/.pi/agent/.env lists.
  const previous = process.env[PLUGINS_ENV_VAR];
  process.env[PLUGINS_ENV_VAR] = "";
  try {
    assert.deepEqual(loadEnabledPlugins().enabled, []);
    assert.deepEqual(loadEnabledPlugins().pending, []);
  } finally {
    if (previous === undefined) delete process.env[PLUGINS_ENV_VAR];
    else process.env[PLUGINS_ENV_VAR] = previous;
  }
});

test("the disabled message names the switch and the fix", () => {
  const message = describeDisabledPlugin("droid");
  assert.match(message, /PI_SUBAGENT_PLUGINS=droid/);
  assert.match(message, /restart pi/);
});
