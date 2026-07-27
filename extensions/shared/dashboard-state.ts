export const MODEL_INFO_CHANNEL = "dashboard:model-info";
export const GIT_INFO_CHANNEL = "dashboard:git-info";
export const REFRESH_CHANNEL = "dashboard:refresh";
export const PRIMARY_RUNTIME_CHANNEL = "dashboard:primary-runtime";

export interface ModelInfoState {
  provider: string;
  modelId: string;
  modelName: string;
  thinking: string;
  contextTokens: number | null;
  contextWindow: number;
  contextPercent: number | null;
  cost: number;
  tokensPerSecond: number | null;
  generating: boolean;
}

/**
 * What the subagents extension publishes while Claude is the primary runtime.
 *
 * The bar reads `ctx.model`, which is pi's model and does not change when the
 * turn is redirected — so without this it keeps naming pi's model, and shows a
 * context gauge for a session that is not accumulating anything, while Claude
 * answers. Two conflicting model readouts on one screen is worse than none.
 */
export interface PrimaryRuntimeState {
  active: boolean;
  /** Model as the CLI reports it once running; the requested alias before that. */
  modelLabel: string;
  /** Requested reasoning effort; empty when left to the CLI default. */
  effort: string;
  contextTokens: number | null;
  contextWindow: number;
}

export function emptyPrimaryRuntimeState(): PrimaryRuntimeState {
  return {
    active: false,
    modelLabel: "",
    effort: "",
    contextTokens: null,
    contextWindow: 0,
  };
}

export function isPrimaryRuntimeState(
  value: unknown,
): value is PrimaryRuntimeState {
  if (!isRecord(value)) return false;

  return (
    typeof value.active === "boolean" &&
    typeof value.modelLabel === "string" &&
    typeof value.effort === "string" &&
    isNullableNumber(value.contextTokens) &&
    typeof value.contextWindow === "number"
  );
}

/**
 * Overlay the active runtime onto the model info the bar renders.
 *
 * Everything pi measures about its own turn is blanked rather than carried
 * over: tokens/sec belongs to a stream pi is not receiving, and the context
 * gauge belongs to a conversation pi is not having. Session cost stays, because
 * it is pi's real accumulated cost and Claude Code bills a subscription rather
 * than tokens — it simply stops climbing while Claude answers.
 */
export function withPrimaryRuntime(
  state: ModelInfoState,
  primary: PrimaryRuntimeState,
): ModelInfoState {
  if (!primary.active) return state;

  const tokens = primary.contextTokens;
  const window = primary.contextWindow;
  const percent =
    tokens !== null && window > 0 ? (tokens / window) * 100 : null;

  return {
    ...state,
    provider: "claude",
    modelId: primary.modelLabel || "default",
    modelName: primary.modelLabel || "Claude",
    thinking: primary.effort || "default",
    contextTokens: tokens,
    contextWindow: window,
    contextPercent: percent,
    tokensPerSecond: null,
  };
}

export interface PullRequestInfo {
  number: number;
  url: string;
  isDraft: boolean;
}

export interface GitInfoState {
  isRepository: boolean;
  branch: string | null;
  changedFiles: number;
  pullRequest: PullRequestInfo | null;
}

export function emptyModelInfoState(): ModelInfoState {
  return {
    provider: "",
    modelId: "no-model",
    modelName: "No model",
    thinking: "off",
    contextTokens: null,
    contextWindow: 0,
    contextPercent: null,
    cost: 0,
    tokensPerSecond: null,
    generating: false,
  };
}

export function emptyGitInfoState(): GitInfoState {
  return {
    isRepository: false,
    branch: null,
    changedFiles: 0,
    pullRequest: null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNullableNumber(value: unknown) {
  return value === null || typeof value === "number";
}

export function isModelInfoState(value: unknown): value is ModelInfoState {
  if (!isRecord(value)) return false;

  return (
    typeof value.provider === "string" &&
    typeof value.modelId === "string" &&
    typeof value.modelName === "string" &&
    typeof value.thinking === "string" &&
    isNullableNumber(value.contextTokens) &&
    typeof value.contextWindow === "number" &&
    isNullableNumber(value.contextPercent) &&
    typeof value.cost === "number" &&
    isNullableNumber(value.tokensPerSecond) &&
    typeof value.generating === "boolean"
  );
}

function isPullRequestInfo(value: unknown): value is PullRequestInfo {
  if (!isRecord(value)) return false;

  return (
    typeof value.number === "number" &&
    typeof value.url === "string" &&
    typeof value.isDraft === "boolean"
  );
}

export function isGitInfoState(value: unknown): value is GitInfoState {
  if (!isRecord(value)) return false;

  return (
    typeof value.isRepository === "boolean" &&
    (value.branch === null || typeof value.branch === "string") &&
    typeof value.changedFiles === "number" &&
    (value.pullRequest === null || isPullRequestInfo(value.pullRequest))
  );
}
