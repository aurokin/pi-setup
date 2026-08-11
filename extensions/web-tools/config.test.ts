import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerWebTools } from "./index.ts";
import { resolveWebToolsConfig } from "./src/config.ts";

async function withAgentDir(run: (agentDir: string) => Promise<void> | void) {
  const agentDir = await mkdtemp(join(tmpdir(), "web-tools-test-"));
  try {
    await run(agentDir);
  } finally {
    await rm(agentDir, { recursive: true, force: true });
  }
}

async function writeConfig(agentDir: string, routes: Record<string, string>) {
  await writeFile(
    join(agentDir, "web-tools.json"),
    JSON.stringify({ schemaVersion: 1, routes }),
  );
}

test("no-config inference gives Exa precedence when both keys exist", async () => {
  await withAgentDir((agentDir) => {
    const config = resolveWebToolsConfig({
      agentDir,
      env: { EXA_API_KEY: "exa", FIRECRAWL_API_KEY: "firecrawl" },
    });

    assert.equal(config.source, "inferred");
    assert.deepEqual(Object.keys(config.routes), [
      "search",
      "scrape",
      "explore_site",
    ]);
    assert.equal(config.routes.search?.backend, "exa");
  });
});

test("no-config inference uses the Firecrawl capability set when it is the only key", async () => {
  await withAgentDir((agentDir) => {
    const config = resolveWebToolsConfig({
      agentDir,
      env: { FIRECRAWL_API_KEY: "firecrawl" },
    });

    assert.deepEqual(Object.keys(config.routes), [
      "search",
      "scrape",
      "crawl",
      "image_search",
    ]);
    assert.equal(config.routes.crawl?.backend, "firecrawl");
  });
});

test("an empty Exa template value does not outrank a configured Firecrawl key", async () => {
  await withAgentDir(async (agentDir) => {
    await writeFile(
      join(agentDir, ".env"),
      "EXA_API_KEY=\nFIRECRAWL_API_KEY=firecrawl\n",
    );
    const config = resolveWebToolsConfig({ agentDir, env: {} });

    assert.equal(config.routes.search?.backend, "firecrawl");
    assert.equal(config.routes.crawl?.backend, "firecrawl");
    assert.equal(config.routes.explore_site, undefined);
  });
});

test("an explicit config is an allowlist and disabled tools are absent", async () => {
  await withAgentDir(async (agentDir) => {
    await writeConfig(agentDir, {
      search: "exa",
      crawl: "disabled",
    });
    const config = resolveWebToolsConfig({
      agentDir,
      env: { EXA_API_KEY: "exa", FIRECRAWL_API_KEY: "firecrawl" },
    });

    assert.equal(config.source, "config");
    assert.deepEqual(Object.keys(config.routes), ["search"]);
  });
});

test("a configured route with no key is omitted with one warning", async () => {
  await withAgentDir(async (agentDir) => {
    await writeConfig(agentDir, { search: "exa" });
    const config = resolveWebToolsConfig({ agentDir, env: {} });

    assert.deepEqual(config.routes, {});
    assert.deepEqual(config.warnings, [
      "search was not registered because its configured backend (exa) is missing EXA_API_KEY",
    ]);
  });
});

test("unsupported backend and capability pairs fail validation", async () => {
  await withAgentDir(async (agentDir) => {
    await writeConfig(agentDir, { crawl: "exa" });
    assert.throws(
      () =>
        resolveWebToolsConfig({
          agentDir,
          env: { EXA_API_KEY: "exa" },
        }),
      /crawl cannot be routed to exa/,
    );
  });
});

test("only resolved tools are registered", async () => {
  await withAgentDir(async (agentDir) => {
    await writeConfig(agentDir, {
      search: "exa",
      scrape: "disabled",
      explore_site: "exa",
    });
    const names: string[] = [];
    const pi = {
      registerTool(tool: { name: string }) {
        names.push(tool.name);
      },
    } as unknown as ExtensionAPI;

    registerWebTools(pi, { agentDir, env: { EXA_API_KEY: "exa" } });
    assert.deepEqual(names, ["search", "explore_site"]);
  });
});
