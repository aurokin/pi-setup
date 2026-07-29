/**
 * Run pi, capture what it would send, and write the report.
 *
 *   node --experimental-strip-types tools/prompt-inspector/inspect.ts
 *   node --experimental-strip-types tools/prompt-inspector/inspect.ts "Hello" --open
 *
 * pi runs with its normal configuration — every installed extension, every
 * skill, the real AGENTS.md — because the point is what this machine's agent
 * actually receives, not what a clean install would. The only additions are
 * the capture extension and its model.
 */

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readMessages, readSkills, renderReport } from "./render.ts";
import { readSkillBodies } from "./skill-bodies.ts";

const args = process.argv.slice(2);
const open = args.includes("--open");
const prompt = args.filter((arg) => !arg.startsWith("--"))[0] ?? "Hello";

const workspace = mkdtempSync(join(tmpdir(), "prompt-inspector-"));
const payloadPath = join(workspace, "payload.json");
const reportPath =
  args.find((arg) => arg.startsWith("--out="))?.slice("--out=".length) ??
  join(process.cwd(), "prompt-report.html");

const extension = join(import.meta.dirname, "capture.ts");

// --no-session so a probe never lands in the session list; --print so it
// settles on its own. Everything else is left alone deliberately.
const child = spawn(
  "pi",
  [
    "--print",
    "--no-session",
    "--extension",
    extension,
    "--model",
    "prompt-inspector/probe",
    prompt,
  ],
  {
    env: { ...process.env, PROMPT_INSPECTOR_OUT: payloadPath },
    stdio: ["ignore", "ignore", "inherit"],
  },
);

const code: number = await new Promise((resolve) => {
  child.once("error", (error) => {
    console.error(`Could not run pi: ${error.message}`);
    resolve(1);
  });
  child.once("exit", (value) => resolve(value ?? 1));
});

let payload: unknown;
try {
  payload = JSON.parse(readFileSync(payloadPath, "utf8"));
  // The payload is the whole prompt — context files, every tool description.
  // The report is the artifact; leaving a second copy of the same private
  // material in a temp directory after each run is not worth the convenience.
  rmSync(workspace, { recursive: true, force: true });
} catch {
  console.error(
    `pi exited (${code}) without a captured payload.\n` +
      `Nothing was written to ${payloadPath}. If pi reported a provider or ` +
      `auth error above, the request never reached the capture listener.`,
  );
  process.exit(1);
}

// The advertised skills, resolved to bodies for the ones this repo owns. Done
// here rather than in the renderer so the renderer stays pure — see
// `skill-bodies.ts` for which skills count as ours and why the rest are not.
const repoRoot = resolve(import.meta.dirname, "..", "..");
const instructionText = readMessages(payload)
  .filter((m) => m.role === "system" || m.role === "developer")
  .map((m) => m.content)
  .join("\n\n");
const locations = readSkills(instructionText)
  .map((skill) => skill.location)
  .filter((location): location is string => Boolean(location));

writeFileSync(
  reportPath,
  renderReport(payload, {
    capturedAt: new Date().toISOString(),
    promptText: prompt,
    source: "pi --print",
    skillBodies: readSkillBodies(locations, repoRoot),
  }),
);

console.log(reportPath);
if (open) spawn("open", [reportPath], { stdio: "ignore", detached: true });
