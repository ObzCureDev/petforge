import { unlockAchievement } from "../achievements.js";
import type { AchievementId, State } from "../schema.js";

const TEN_K = 10_000;
const HUNDRED_K = 100_000;
const ONE_MILLION = 1_000_000;
const CACHE_VOLUME_MIN = 100_000;
const CACHE_RATIO_MIN = 0.8;
const FRUGAL_PROMPTS = 100;
const FRUGAL_MAX_CENTS = 100;
const BIG_SPENDER_CENTS = 10_000;
const PR_THRESHOLD = 50;
const REJECT_THRESHOLD = 50;

/**
 * Check OTel-gated achievements. Returns the IDs that newly unlocked.
 * Mutates state.achievements.unlocked + pendingUnlocks + progress.xp.
 *
 * Gates on `state.counters.otel.lastUpdate > 0` — without that the
 * collector has never run and OTel-derived data is suspect.
 */
export function checkOtelAchievements(state: State): AchievementId[] {
  const otel = state.counters.otel;
  if (!otel || otel.lastUpdate === 0) return [];

  const newly: AchievementId[] = [];
  const tryUnlock = (id: AchievementId, condition: boolean): void => {
    if (condition && unlockAchievement(state, id)) newly.push(id);
  };

  tryUnlock("code_architect", otel.linesAdded >= TEN_K);
  tryUnlock("code_titan", otel.linesAdded >= HUNDRED_K);
  tryUnlock("token_whisperer_v2", otel.tokensIn + otel.tokensOut >= ONE_MILLION);

  const cacheVolume = otel.tokensIn + otel.tokensCacheRead;
  const cacheRatio = cacheVolume > 0 ? otel.tokensCacheRead / cacheVolume : 0;
  tryUnlock("cache_lord", cacheVolume >= CACHE_VOLUME_MIN && cacheRatio >= CACHE_RATIO_MIN);

  tryUnlock(
    "frugal_coder",
    state.counters.promptsTotal >= FRUGAL_PROMPTS && otel.costUsdCents <= FRUGAL_MAX_CENTS,
  );

  tryUnlock("big_spender", otel.costUsdCents >= BIG_SPENDER_CENTS);
  tryUnlock("pr_machine", otel.prCount >= PR_THRESHOLD);
  tryUnlock("picky_reviewer", otel.editsRejected >= REJECT_THRESHOLD);

  return newly;
}
