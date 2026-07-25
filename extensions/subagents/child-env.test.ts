import assert from "node:assert/strict";
import { test } from "node:test";
import { PARENT_ONLY_SECRET_NAMES, childEnv } from "./src/child-env.ts";

test("the parent's own tool secrets do not reach a child", () => {
  // `with-secret firecrawl -- pi` puts this in pi's environment. Without the
  // filter that injection widens to every agent pi spawns.
  const env = childEnv({ FIRECRAWL_API_KEY: "fc-secret", PATH: "/usr/bin" });
  assert.equal(env.FIRECRAWL_API_KEY, undefined);
  assert.equal(env.PATH, "/usr/bin");
});

test("the child keeps the credentials it needs for itself", () => {
  // Stripping by pattern would take these too, and a Claude or Codex child
  // without its own auth cannot run at all.
  const env = childEnv({
    ANTHROPIC_API_KEY: "a",
    OPENAI_API_KEY: "b",
    GITHUB_TOKEN: "c",
    HOME: "/Users/x",
  });
  assert.equal(env.ANTHROPIC_API_KEY, "a");
  assert.equal(env.OPENAI_API_KEY, "b");
  assert.equal(env.GITHUB_TOKEN, "c");
  assert.equal(env.HOME, "/Users/x");
});

test("the parent's own environment is not mutated", () => {
  const parent = { FIRECRAWL_API_KEY: "fc-secret" };
  childEnv(parent);
  assert.equal(parent.FIRECRAWL_API_KEY, "fc-secret");
});

test("every stripped name is one this repo's extensions actually read", () => {
  // A name added here without a reader is dead weight; one removed while a
  // reader remains is a leak.
  assert.deepEqual([...PARENT_ONLY_SECRET_NAMES], ["FIRECRAWL_API_KEY"]);
});
