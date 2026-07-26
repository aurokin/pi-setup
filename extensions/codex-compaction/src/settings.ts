/**
 * The summary budget, resolved the way pi resolves it.
 *
 * `reserveTokens` is the one lever a user has over compaction cost and quality,
 * and it does two jobs at once: `shouldCompact` fires when the context passes
 * `contextWindow - reserveTokens`, and `generateSummaryWithUsage` caps the
 * summary at `0.8 * reserveTokens`. Raising it therefore buys a longer summary
 * *and* compacts sooner.
 *
 * That lever has to keep working with this extension installed. Hardcoding the
 * default would mean a user who raised `compaction.reserveTokens` got a longer
 * summary from pi and the stock 16k one from us — the setting silently doing
 * nothing on the path that replaced it.
 *
 * `SettingsManager` is pi's own loader, so the global/project merge and the
 * trust rules are pi's rather than a copy of them that drifts.
 */

import {
  DEFAULT_COMPACTION_SETTINGS,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

export interface ReserveTokensContext {
  readonly cwd: string;
  isProjectTrusted(): boolean;
}

export function resolveReserveTokens(ctx: ReserveTokensContext): number {
  try {
    const settings = SettingsManager.create(ctx.cwd, undefined, {
      projectTrusted: ctx.isProjectTrusted(),
    });
    const reserve = settings.getCompactionReserveTokens();
    // A zero or negative budget would ask for a zero-token summary, which is
    // worse than ignoring a malformed setting.
    if (Number.isFinite(reserve) && reserve > 0) return reserve;
  } catch {
    // Unreadable settings are pi's problem to report, not a reason to fail a
    // compaction that is already running because the context is nearly full.
  }
  return DEFAULT_COMPACTION_SETTINGS.reserveTokens;
}
