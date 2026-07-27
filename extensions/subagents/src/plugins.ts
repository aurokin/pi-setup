/**
 * Optional backends, and how they get turned on.
 *
 * `pi`, `claude`, and `codex` are core: always registered, gated only by
 * whether their binary or SDK is actually present. `droid` and `cursor` are
 * plugins — off unless asked for. They are not core because each one spends a
 * different subscription, and a harness the model can see is a harness it will
 * eventually pick. Defaulting them off keeps routing to the two subscriptions
 * the roster names, and makes reaching past that a deliberate act.
 *
 * Enabled through `PI_SUBAGENT_PLUGINS`, read from the environment or from
 * `~/.pi/agent/.env` — the same lookup the firecrawl extension uses for its key,
 * rather than a second config format:
 *
 *     PI_SUBAGENT_PLUGINS=droid,cursor
 *
 * A disabled plugin is absent from the `harness` enum entirely, so the model
 * never sees it and cannot spend a turn discovering it is off.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const CORE_BACKENDS = ["pi", "claude", "codex"] as const;
export const PLUGIN_BACKENDS = ["droid", "cursor"] as const;

/**
 * Plugins with a backend behind them. Empty while the droid and cursor
 * backends are being written: enabling one before it exists would put a
 * harness in the model's enum that cannot spawn, which reads as a bug rather
 * than as unfinished work. Add the name here when its backend lands.
 */
export const IMPLEMENTED_PLUGINS: ReadonlyArray<PluginBackendName> = [];

export type CoreBackendName = (typeof CORE_BACKENDS)[number];
export type PluginBackendName = (typeof PLUGIN_BACKENDS)[number];

export const PLUGINS_ENV_VAR = "PI_SUBAGENT_PLUGINS";

export interface PluginSelection {
  /** Asked for, known, and backed by an implementation. */
  readonly enabled: ReadonlyArray<PluginBackendName>;
  /** Asked for and known, but no backend exists yet. */
  readonly pending: ReadonlyArray<PluginBackendName>;
  /** Names that matched no plugin, kept so a typo can be reported not ignored. */
  readonly unknown: ReadonlyArray<string>;
}

function isPluginName(value: string): value is PluginBackendName {
  return (PLUGIN_BACKENDS as readonly string[]).includes(value);
}

/**
 * Parse the env var. Order in the list is not honoured — the result follows
 * `PLUGIN_BACKENDS`, so the harness enum reads the same whatever order the
 * user typed, and duplicates collapse.
 */
export function parseEnabledPlugins(raw: string | undefined): PluginSelection {
  const requested = (raw ?? "")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);

  const wanted = new Set(requested);
  const known = PLUGIN_BACKENDS.filter((name) => wanted.has(name));
  return {
    enabled: known.filter((name) => IMPLEMENTED_PLUGINS.includes(name)),
    pending: known.filter((name) => !IMPLEMENTED_PLUGINS.includes(name)),
    unknown: [...new Set(requested.filter((name) => !isPluginName(name)))],
  };
}

/**
 * `process.env` first, then `~/.pi/agent/.env` — the firecrawl-search lookup,
 * with one deliberate difference: presence rather than truthiness. An empty
 * `PI_SUBAGENT_PLUGINS=` is a real answer here ("none, this run"), and the
 * truthiness check would fall through to the file and re-enable whatever it
 * lists. For firecrawl an empty key means nothing; for an opt-in guard over
 * paid subscriptions, it is the way to turn everything off for one session.
 */
function readEnvValue(name: string) {
  if (process.env[name] !== undefined) return process.env[name];

  let envText = "";
  try {
    envText = readFileSync(join(homedir(), ".pi", "agent", ".env"), "utf8");
  } catch {
    return undefined;
  }

  for (const line of envText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(
      /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/,
    );
    if (!match || match[1] !== name) continue;
    return match[2].trim().replace(/^["']|["']$/g, "");
  }
  return undefined;
}

export function loadEnabledPlugins(): PluginSelection {
  return parseEnabledPlugins(readEnvValue(PLUGINS_ENV_VAR));
}

/**
 * The harnesses the model may ask for: core plus whatever is switched on.
 * This is what the `harness` enum is built from, so a disabled plugin is not
 * merely refused at spawn — it is not offered.
 */
export function enabledBackendNames(
  selection: PluginSelection,
): ReadonlyArray<CoreBackendName | PluginBackendName> {
  return [...CORE_BACKENDS, ...selection.enabled];
}

/**
 * Why a plugin backend is missing, for the spawn error. "Not built" and "built
 * but switched off" are different problems with different fixes, and a single
 * "unavailable" message sends you looking for the wrong one.
 */
export function describeDisabledPlugin(name: PluginBackendName): string {
  return `The "${name}" harness is a plugin and is not enabled. Set ${PLUGINS_ENV_VAR}=${name} in your environment or ~/.pi/agent/.env (comma-separate to enable several), then restart pi.`;
}
