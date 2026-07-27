/**
 * The `subagents` skill, assembled from the harnesses actually offered.
 *
 * A skill that documents a harness the model cannot spawn is worse than no
 * documentation: the model reads a `droid` section, believes droid is on the
 * menu, and discovers otherwise only when the enum rejects it. The reverse —
 * an enabled harness the skill never mentions — leaves the model choosing
 * between names it has no basis to compare. Either way the fix is the same:
 * the skill is generated from `subagents.json`, not maintained beside it.
 *
 * The prose stays markdown. `skill/SKILL.md` is the base, with two
 * placeholders, and each `skill/harnesses/<name>.md` carries that harness's
 * two contributions separated by a marker: the bullet under "Choosing a
 * harness", then its full section. `pi.md` has an empty first part — "default
 * to pi" is in the base, so a bullet arguing for it would be arguing twice.
 *
 * pi discovers skills by path, so the rendered file is written to the agent dir
 * and handed back from `resources_discover`. The repo's copy is a source file,
 * not something to symlink into `~/.pi/agent/skills`.
 */

import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { ALL_HARNESSES, type HarnessName } from "./harnesses.ts";
import { inSentence } from "./prompt.ts";

/** Splits a harness file into its "Choosing a harness" bullet and its section. */
const SECTION_MARKER = /^<!-- section -->$/m;

const CHOICES_PLACEHOLDER = "{{harness-choices}}";
const SECTIONS_PLACEHOLDER = "{{harness-sections}}";
const EGRESS_PLACEHOLDER = "{{egress-harnesses}}";

/** Where the rendered skill lands: pi's own dir, beside `subagents.json`. */
export const GENERATED_SKILL_DIR = "generated-skills";

export interface SkillSources {
  readonly base: string;
  readonly harnesses: Readonly<Partial<Record<HarnessName, string>>>;
}

/**
 * Every child is an egress path, pi included: `model` takes a
 * `provider/model-id`, and the roster tells the caller to always pass one, so a
 * pi child routes wherever that names — not necessarily where the parent runs.
 * Saying otherwise would read as a guarantee the harness does not make.
 *
 * Built from the harnesses actually rendered, not from the offered list: a
 * warning about a harness the document never describes is a loose end the
 * reader cannot resolve.
 */
function egressSentence(rendered: ReadonlyArray<HarnessName>) {
  const external = rendered.filter((name) => name !== "pi");
  const pi =
    "whichever provider its `model` names, which need not be this session's";
  if (external.length === 0) {
    return `a pi child ships everything it reads to ${pi}`;
  }
  return `a ${inSentence(external.map((name) => `\`${name}\``))} child ships everything it reads to that provider, and a pi child to ${pi}`;
}

/**
 * Render the skill for exactly these harnesses.
 *
 * Order follows the harness catalog rather than the offered array, so the
 * document reads the same however the config happens to be written.
 */
export function renderSkill(
  offered: ReadonlyArray<HarnessName>,
  sources: SkillSources,
): string {
  const ordered = ALL_HARNESSES.filter((name) => offered.includes(name));
  const rendered: HarnessName[] = [];
  const choices: string[] = [];
  const sections: string[] = [];

  for (const name of ordered) {
    const source = sources.harnesses[name];
    // A harness with no markdown is a packaging bug, not a runtime condition:
    // skipping it keeps the skill coherent instead of emitting a stray marker.
    if (!source) continue;
    rendered.push(name);
    const [choice = "", section = ""] = source.split(SECTION_MARKER);
    if (choice.trim()) choices.push(choice.trim());
    if (section.trim()) sections.push(section.trim());
  }

  return (
    sources.base
      .replace(EGRESS_PLACEHOLDER, egressSentence(rendered))
      .replace(
        CHOICES_PLACEHOLDER,
        choices.length ? `${choices.join("\n")}\n` : "",
      )
      .replace(
        SECTIONS_PLACEHOLDER,
        sections.length ? `${sections.join("\n\n")}\n\n` : "",
      )
      // Whether a placeholder sits on its own line and whether it expanded to
      // anything are independent, so the seams collapse here rather than being
      // hand-tuned per placeholder.
      .replace(/\n{3,}/g, "\n\n")
  );
}

/** Read the markdown that ships with the extension. */
export function readSkillSources(skillDir: string): SkillSources {
  const harnesses: Partial<Record<HarnessName, string>> = {};
  for (const name of ALL_HARNESSES) {
    try {
      harnesses[name] = readFileSync(
        join(skillDir, "harnesses", `${name}.md`),
        "utf8",
      );
    } catch {
      // Left out of the render; see renderSkill.
    }
  }
  return { base: readFileSync(join(skillDir, "SKILL.md"), "utf8"), harnesses };
}

/**
 * Where a given harness selection's skill lives — one directory per selection,
 * named after it.
 *
 * Not a single shared file, because pi hands the model a *path* and the model
 * reads it whenever it invokes the skill, which can be long after startup. Two
 * sessions with different configs sharing one path means the second overwrites
 * what the first will read, and the older session's model gets a document
 * describing harnesses its enum rejects. Keyed this way, a session only ever
 * writes bytes identical to what is already there.
 *
 * There are at most as many directories as harness combinations ever used, so
 * nothing prunes them: deleting one is exactly the race this avoids.
 *
 * The key is the selection and not a hash of the rendered text, though that
 * would also stop an upgraded session from rewriting an older one's file. What
 * it would cost is a new directory for every edit to the source markdown,
 * forever, to prevent a live session from reading a *newer* copy of prose
 * describing the same harnesses its enum already offers. The write is atomic,
 * so the worst case is prose that improved underneath someone.
 */
export function generatedSkillPath(
  offered: ReadonlyArray<HarnessName>,
  agentDir: string,
) {
  const key = ALL_HARNESSES.filter((name) => offered.includes(name)).join("-");
  return join(agentDir, GENERATED_SKILL_DIR, `subagents-${key || "none"}`);
}

/**
 * Render and write the skill, returning the path for `resources_discover`.
 *
 * Rewritten on every startup rather than diffed: it is a few kilobytes, and a
 * stale skill that survives an edit to the source markdown is the failure this
 * file exists to prevent. Returns undefined if it could not be written — the
 * session is still fine, so this reports rather than throws.
 */
export function writeGeneratedSkill(
  offered: ReadonlyArray<HarnessName>,
  skillDir: string,
  agentDir: string = getAgentDir(),
): string | undefined {
  const directory = generatedSkillPath(offered, agentDir);
  try {
    const text = renderSkill(offered, readSkillSources(skillDir));
    mkdirSync(directory, { recursive: true });
    const path = join(directory, "SKILL.md");
    // Same-directory rename rather than a plain write: a session starting now
    // truncates the file a running session's model may be reading, and an
    // empty skill is worse than a slightly stale one. Identical bytes either
    // way — this is about never publishing a partial document.
    const temporary = `${path}.${process.pid}.tmp`;
    try {
      writeFileSync(temporary, text, "utf8");
      renameSync(temporary, path);
    } catch (error) {
      try {
        unlinkSync(temporary);
      } catch {
        // The original failure is the one worth reporting.
      }
      throw error;
    }
    return path;
  } catch (error) {
    console.warn(
      `[subagents] could not write the generated skill to ${directory}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return undefined;
  }
}
