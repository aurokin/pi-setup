/**
 * Which harnesses `subagent_spawn` offers the model.
 *
 * Two different questions get conflated easily, so they are kept apart here:
 *
 * - **Registered** — the backend exists and the extension's own features can
 *   use it. `/btw` spawns a pi child (only pi can fork the parent's history),
 *   and `/runtime claude` spawns a claude one. Neither goes through the enum,
 *   so neither is affected by this config.
 * - **Offered** — the model sees it in the `harness` enum and may route to it.
 *   That is what this file controls, and only that.
 *
 * The distinction matters most for claude: wanting `/runtime claude` while the
 * model does *not* fan out to claude children is a reasonable position, and a
 * single on/off switch cannot express it.
 *
 * Config lives beside pi's own settings, in `<agent dir>/subagents.json`, and
 * is written with defaults the first time the extension loads so the options
 * are discoverable without reading this file. It is deliberately not a key in
 * pi's `settings.json`: that file is pi's, it rewrites it to persist last-used
 * model and thinking level, and squatting an unknown key in someone else's
 * file is a bet on their merge behaviour staying friendly.
 *
 * `pi` is always offered. It is the default harness, it costs nothing external,
 * and a config that can leave the model with no way to delegate is a footgun
 * rather than a feature — to turn subagents off, drop the extension.
 */

import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const ALL_HARNESSES = [
  "pi",
  "claude",
  "codex",
  "droid",
  "cursor",
] as const;
export type HarnessName = (typeof ALL_HARNESSES)[number];

/** Offered when the config says nothing: the two sanctioned subscriptions. */
export const DEFAULT_HARNESSES = ["pi", "claude", "codex"] as const;

/** Never removable — see the note at the top of this file. */
export const ALWAYS_OFFERED: HarnessName = "pi";

/**
 * Harnesses with a backend behind them. droid and cursor join this list when
 * theirs land; until then, asking for one is reported rather than silently
 * putting a harness in the enum that cannot spawn.
 */
export const IMPLEMENTED_HARNESSES: ReadonlyArray<HarnessName> = [
  "pi",
  "claude",
  "codex",
];

export const CONFIG_FILENAME = "subagents.json";

const CONFIG_NOTE =
  "Harnesses subagent_spawn offers the model. 'pi' is always offered and cannot be removed. Known: " +
  ALL_HARNESSES.join(", ") +
  ". Removing a harness here does not affect /btw or /runtime claude.";

export interface HarnessSelection {
  /** Offered to the model, in catalog order, always including `pi`. */
  readonly offered: ReadonlyArray<HarnessName>;
  /** Known but not yet implemented, so not offered. */
  readonly pending: ReadonlyArray<HarnessName>;
  /** Names matching no harness, kept so a typo is reported not ignored. */
  readonly unknown: ReadonlyArray<string>;
  /** Set when the file was unreadable or malformed and defaults were used. */
  readonly problem?: string;
}

function isHarnessName(value: string): value is HarnessName {
  return (ALL_HARNESSES as readonly string[]).includes(value);
}

function select(names: ReadonlyArray<string>): HarnessSelection {
  const wanted = new Set(names.map((name) => name.trim().toLowerCase()));
  wanted.add(ALWAYS_OFFERED);
  const known = ALL_HARNESSES.filter((name) => wanted.has(name));
  return {
    offered: known.filter((name) => IMPLEMENTED_HARNESSES.includes(name)),
    pending: known.filter((name) => !IMPLEMENTED_HARNESSES.includes(name)),
    unknown: [
      ...new Set([...wanted].filter((name) => !isHarnessName(name))),
    ].sort(),
  };
}

export function defaultSelection(): HarnessSelection {
  return select(DEFAULT_HARNESSES);
}

/**
 * Interpret the parsed file. Anything malformed falls back to the defaults
 * with a reason rather than throwing — a bad config should cost you the
 * customization, not the extension.
 */
export function parseHarnessConfig(raw: unknown): HarnessSelection {
  if (raw === undefined || raw === null) return defaultSelection();
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { ...defaultSelection(), problem: "expected a JSON object" };
  }

  const value = (raw as { harnesses?: unknown }).harnesses;
  if (value === undefined) return defaultSelection();
  if (!Array.isArray(value) || value.some((n) => typeof n !== "string")) {
    return {
      ...defaultSelection(),
      problem: '"harnesses" must be an array of strings',
    };
  }
  return select(value as string[]);
}

export function configPath() {
  return join(getAgentDir(), CONFIG_FILENAME);
}

export function defaultConfigText() {
  return `${JSON.stringify(
    { "//": CONFIG_NOTE, harnesses: DEFAULT_HARNESSES },
    null,
    2,
  )}\n`;
}

/**
 * Read the config, writing it with defaults if it is not there yet.
 *
 * A failed write is not worth surfacing: the defaults are exactly what the
 * file would have said, so the session behaves identically either way. `wx`
 * makes the create fail rather than clobber if another process wins the race.
 */
export function loadHarnessSelection(): HarnessSelection {
  const path = configPath();
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    // Only a genuinely absent file means "first run". A file that exists but
    // cannot be read is a config that silently stopped applying, and falling
    // back to defaults there re-offers paid harnesses the user removed — so
    // that case reports rather than passing quietly.
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      return {
        ...defaultSelection(),
        problem: `could not be read (${code ?? "unknown error"})`,
      };
    }
    try {
      writeFileSync(path, defaultConfigText(), { flag: "wx" });
    } catch {
      // Agent directory missing or read-only, or someone else won the race.
    }
    return defaultSelection();
  }

  try {
    return parseHarnessConfig(JSON.parse(text));
  } catch {
    // Never rewrite a file we could not parse: it is the user's, and the typo
    // they need to see is in it.
    return { ...defaultSelection(), problem: "file is not valid JSON" };
  }
}
