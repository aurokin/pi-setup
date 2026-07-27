import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  ALL_HARNESSES,
  ALWAYS_OFFERED,
  CONFIG_FILENAME,
  DEFAULT_HARNESSES,
  defaultConfigText,
  IMPLEMENTED_HARNESSES,
  loadHarnessSelection,
  parseHarnessConfig,
} from "./src/harnesses.ts";
import { BACKEND_NAMES } from "./src/domain.ts";

const offeredFor = (harnesses: unknown) =>
  parseHarnessConfig({ harnesses }).offered;

test("no config means the two sanctioned subscriptions plus pi", () => {
  assert.deepEqual(parseHarnessConfig(undefined).offered, [
    ...DEFAULT_HARNESSES,
  ]);
  assert.deepEqual(parseHarnessConfig({}).offered, [...DEFAULT_HARNESSES]);
});

test("a list offers exactly what it names", () => {
  assert.deepEqual(offeredFor(["pi", "codex"]), ["pi", "codex"]);
  assert.deepEqual(offeredFor(["claude"]), ["pi", "claude"]);
});

test("pi is offered whatever the config says", () => {
  // Leaving the model no way to delegate is a footgun, not a setting; drop the
  // extension to turn subagents off.
  assert.ok(offeredFor([]).includes(ALWAYS_OFFERED));
  assert.ok(offeredFor(["codex"]).includes(ALWAYS_OFFERED));
  assert.deepEqual(offeredFor([]), ["pi"]);
});

test("order follows the catalog, not the file", () => {
  assert.deepEqual(offeredFor(["codex", "claude"]), ["pi", "claude", "codex"]);
});

test("case and spacing are forgiven, duplicates collapse", () => {
  assert.deepEqual(offeredFor([" CODEX ", "codex", "Pi"]), ["pi", "codex"]);
});

test("a known harness with no backend yet is pending, not offered", () => {
  // Offering a harness that cannot spawn reads as a bug rather than as work
  // still in progress.
  const selection = parseHarnessConfig({ harnesses: ["pi", "droid"] });
  assert.deepEqual(selection.pending, ["droid"]);
  assert.ok(!selection.offered.includes("droid" as never));
});

test("an unknown name is reported rather than silently dropped", () => {
  const selection = parseHarnessConfig({ harnesses: ["pi", "clyde"] });
  assert.deepEqual(selection.unknown, ["clyde"]);
  assert.deepEqual(selection.offered, ["pi"]);
});

test("a malformed config costs the customization, not the extension", () => {
  for (const raw of [[], "pi", 7]) {
    const selection = parseHarnessConfig(raw);
    assert.equal(selection.problem, "expected a JSON object");
    assert.deepEqual(selection.offered, [...DEFAULT_HARNESSES]);
  }
  const wrongType = parseHarnessConfig({ harnesses: "pi" });
  assert.match(wrongType.problem ?? "", /array of strings/);
  assert.deepEqual(wrongType.offered, [...DEFAULT_HARNESSES]);

  const wrongElement = parseHarnessConfig({ harnesses: ["pi", 3] });
  assert.match(wrongElement.problem ?? "", /array of strings/);
});

test("an unreadable config reports instead of quietly reverting", () => {
  // A directory where the file should be: readFileSync fails with EISDIR, not
  // ENOENT. Falling back silently would re-offer harnesses the user removed.
  const dir = mkdtempSync(join(tmpdir(), "subagents-config-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  mkdirSync(join(dir, CONFIG_FILENAME));
  try {
    const selection = loadHarnessSelection();
    assert.match(selection.problem ?? "", /could not be read/);
    assert.deepEqual(selection.offered, [...DEFAULT_HARNESSES]);
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a first run writes the defaults where the config belongs", () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-config-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  try {
    const selection = loadHarnessSelection();
    assert.equal(selection.problem, undefined);
    assert.deepEqual(selection.offered, [...DEFAULT_HARNESSES]);
    const written = readFileSync(join(dir, CONFIG_FILENAME), "utf8");
    assert.deepEqual(JSON.parse(written).harnesses, [...DEFAULT_HARNESSES]);
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the generated file is valid JSON that parses to the defaults", () => {
  const parsed = JSON.parse(defaultConfigText());
  assert.deepEqual(parseHarnessConfig(parsed).offered, [...DEFAULT_HARNESSES]);
  // The note is what makes the options discoverable without reading source.
  assert.match(parsed["//"], /pi/);
  assert.match(parsed["//"], /cannot be removed/);
});

test("every implemented harness is a real backend name", () => {
  assert.deepEqual(BACKEND_NAMES, ALL_HARNESSES);
  for (const name of IMPLEMENTED_HARNESSES) {
    assert.ok((ALL_HARNESSES as readonly string[]).includes(name));
  }
});
