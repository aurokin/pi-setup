import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { WebBackend, WebToolName } from "./types.ts";

const TOOL_NAMES = [
  "search",
  "scrape",
  "explore_site",
  "crawl",
  "image_search",
] as const satisfies readonly WebToolName[];

const ROUTE_VALUES = ["exa", "firecrawl", "disabled"] as const;
type RouteValue = (typeof ROUTE_VALUES)[number];

const CAPABILITIES = {
  search: ["exa", "firecrawl"],
  scrape: ["exa", "firecrawl"],
  explore_site: ["exa"],
  crawl: ["firecrawl"],
  image_search: ["firecrawl"],
} as const satisfies Record<WebToolName, readonly WebBackend[]>;

function isWebToolName(value: string): value is WebToolName {
  return TOOL_NAMES.some((toolName) => toolName === value);
}

function isRouteValue(value: unknown): value is RouteValue {
  return ROUTE_VALUES.some((route) => route === value);
}

function supportsBackend(toolName: WebToolName, backend: WebBackend) {
  return CAPABILITIES[toolName].some((supported) => supported === backend);
}

export interface ResolvedRoute {
  readonly backend: WebBackend;
  readonly apiKey: string;
}

export interface ResolvedWebToolsConfig {
  readonly routes: Partial<Record<WebToolName, ResolvedRoute>>;
  readonly warnings: readonly string[];
  readonly source: "config" | "inferred";
  readonly configPath: string;
}

export interface WebToolsConfigOptions {
  readonly agentDir?: string;
  readonly env?: NodeJS.ProcessEnv;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseEnvValue(text: string, name: string) {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const match = trimmed.match(
      /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/,
    );
    if (!match || match[1] !== name) continue;

    const value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      return value.slice(1, -1);
    }

    return value.replace(/\s+#.*$/, "");
  }
  return undefined;
}

function readApiKey(
  name: "EXA_API_KEY" | "FIRECRAWL_API_KEY",
  env: NodeJS.ProcessEnv,
  agentDir: string,
) {
  if (env[name]) return env[name];

  try {
    return parseEnvValue(readFileSync(join(agentDir, ".env"), "utf8"), name);
  } catch (error) {
    const code = isRecord(error) ? error.code : undefined;
    if (code === "ENOENT") return undefined;
    throw error;
  }
}

function readConfig(configPath: string) {
  let text: string;
  try {
    text = readFileSync(configPath, "utf8");
  } catch (error) {
    const code = isRecord(error) ? error.code : undefined;
    if (code === "ENOENT") return undefined;
    throw error;
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`[web-tools] Invalid JSON in ${configPath}`, {
      cause: error,
    });
  }

  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new Error(
      `[web-tools] ${configPath} must be an object with schemaVersion 1`,
    );
  }
  if (!isRecord(value.routes)) {
    throw new Error(`[web-tools] ${configPath} must contain a routes object`);
  }

  const routes: Partial<Record<WebToolName, RouteValue>> = {};
  for (const [name, route] of Object.entries(value.routes)) {
    if (!isWebToolName(name)) {
      throw new Error(
        `[web-tools] Unknown route name in ${configPath}: ${name}`,
      );
    }
    if (!isRouteValue(route)) {
      throw new Error(
        `[web-tools] Route ${name} must be exa, firecrawl, or disabled`,
      );
    }
    if (route !== "disabled" && !supportsBackend(name, route)) {
      throw new Error(`[web-tools] ${name} cannot be routed to ${route}`);
    }
    routes[name] = route;
  }

  return routes;
}

function keyFor(
  backend: WebBackend,
  keys: Readonly<Record<WebBackend, string | undefined>>,
) {
  return keys[backend];
}

export function resolveWebToolsConfig(
  options: WebToolsConfigOptions = {},
): ResolvedWebToolsConfig {
  const env = options.env ?? process.env;
  const agentDir =
    options.agentDir ??
    env.PI_CODING_AGENT_DIR ??
    join(homedir(), ".pi", "agent");
  const configPath = join(agentDir, "web-tools.json");
  const keys = {
    exa: readApiKey("EXA_API_KEY", env, agentDir),
    firecrawl: readApiKey("FIRECRAWL_API_KEY", env, agentDir),
  } satisfies Record<WebBackend, string | undefined>;
  const configured = readConfig(configPath);

  if (!configured) {
    if (keys.exa) {
      return {
        configPath,
        source: "inferred",
        warnings: [],
        routes: {
          search: { backend: "exa", apiKey: keys.exa },
          scrape: { backend: "exa", apiKey: keys.exa },
          explore_site: { backend: "exa", apiKey: keys.exa },
        },
      };
    }
    if (keys.firecrawl) {
      return {
        configPath,
        source: "inferred",
        warnings: [],
        routes: {
          search: { backend: "firecrawl", apiKey: keys.firecrawl },
          scrape: { backend: "firecrawl", apiKey: keys.firecrawl },
          crawl: { backend: "firecrawl", apiKey: keys.firecrawl },
          image_search: { backend: "firecrawl", apiKey: keys.firecrawl },
        },
      };
    }
    return {
      configPath,
      source: "inferred",
      warnings: [],
      routes: {},
    };
  }

  const routes: Partial<Record<WebToolName, ResolvedRoute>> = {};
  const warnings: string[] = [];
  for (const toolName of TOOL_NAMES) {
    const backend = configured[toolName];
    if (!backend || backend === "disabled") continue;

    const apiKey = keyFor(backend, keys);
    if (!apiKey) {
      const keyName = backend === "exa" ? "EXA_API_KEY" : "FIRECRAWL_API_KEY";
      warnings.push(
        `${toolName} was not registered because its configured backend (${backend}) is missing ${keyName}`,
      );
      continue;
    }
    routes[toolName] = { backend, apiKey };
  }

  return { configPath, source: "config", routes, warnings };
}
