import { unlockAchievement } from "../achievements.js";
import type { AchievementId, State } from "../schema.js";

const TEN_K = 10_000;
const FIFTY_K = 50_000;
const TWO_HUNDRED_K = 200_000;

const ONE_M_TOKENS = 1_000_000;
const TEN_M_TOKENS = 10_000_000;
const HUNDRED_M_TOKENS = 100_000_000;

const CACHE_VOL_BRONZE = 100_000;
const CACHE_VOL_SILVER = 1_000_000;
const CACHE_VOL_GOLD = 10_000_000;
const CACHE_RATIO_80 = 0.8;
const CACHE_RATIO_90 = 0.9;

const FRUGAL_BRONZE_PROMPTS = 100;
const FRUGAL_SILVER_PROMPTS = 500;
const FRUGAL_GOLD_PROMPTS = 2_000;
// V3.5.2: bumped 10× from V3.4 values ($1/$5/$20). Original threshold of
// $0.01/prompt was unreachable for any real Claude Code usage — even
// cache-heavy mixed-model sessions land around $0.05-0.15/prompt. New
// $0.10/prompt target is achievable for the majority of users while
// still rewarding economy (anyone doing pure Opus-no-cache will fail).
const FRUGAL_BRONZE_MAX_CENTS = 1_000; // $10
const FRUGAL_SILVER_MAX_CENTS = 5_000; // $50
const FRUGAL_GOLD_MAX_CENTS = 20_000; // $200

const SPENDER_BRONZE_CENTS = 10_000; // $100
const SPENDER_SILVER_CENTS = 50_000; // $500
const SPENDER_GOLD_CENTS = 200_000; // $2,000

const PR_BRONZE = 50;
const PR_SILVER = 200;
const PR_GOLD = 500;

const PICKY_BRONZE = 50;
const PICKY_SILVER = 250;
const PICKY_GOLD = 1_000;

/**
 * Check OTel-gated achievements. Returns the IDs that newly unlocked.
 * Mutates state.achievements.unlocked + pendingUnlocks + progress.xp.
 *
 * Gates on `state.counters.otel.lastUpdate > 0` - without that the
 * collector has never run and OTel-derived data is suspect.
 */
export function checkOtelAchievements(state: State): AchievementId[] {
  const otel = state.counters.otel;
  if (!otel || otel.lastUpdate === 0) return [];

  const newly: AchievementId[] = [];
  const tryUnlock = (id: AchievementId, condition: boolean): void => {
    if (condition && unlockAchievement(state, id)) newly.push(id);
  };

  // Code lines
  tryUnlock("code_10k", otel.linesAdded >= TEN_K);
  tryUnlock("code_50k", otel.linesAdded >= FIFTY_K);
  tryUnlock("code_200k", otel.linesAdded >= TWO_HUNDRED_K);

  // Tokens (in + out)
  const tokens = otel.tokensIn + otel.tokensOut;
  tryUnlock("token_1m", tokens >= ONE_M_TOKENS);
  tryUnlock("token_10m", tokens >= TEN_M_TOKENS);
  tryUnlock("token_100m", tokens >= HUNDRED_M_TOKENS);

  // Cache: volume + ratio compound
  const cacheVolume = otel.tokensIn + otel.tokensCacheRead;
  const cacheRatio = cacheVolume > 0 ? otel.tokensCacheRead / cacheVolume : 0;
  tryUnlock("cache_100k", cacheVolume >= CACHE_VOL_BRONZE && cacheRatio >= CACHE_RATIO_80);
  tryUnlock("cache_1m", cacheVolume >= CACHE_VOL_SILVER && cacheRatio >= CACHE_RATIO_80);
  tryUnlock("cache_10m", cacheVolume >= CACHE_VOL_GOLD && cacheRatio >= CACHE_RATIO_90);

  // Frugal: prompts >= N AND total cost <= ceiling
  const prompts = state.counters.promptsTotal;
  tryUnlock(
    "frugal_100p",
    prompts >= FRUGAL_BRONZE_PROMPTS && otel.costUsdCents <= FRUGAL_BRONZE_MAX_CENTS,
  );
  tryUnlock(
    "frugal_500p",
    prompts >= FRUGAL_SILVER_PROMPTS && otel.costUsdCents <= FRUGAL_SILVER_MAX_CENTS,
  );
  tryUnlock(
    "frugal_2kp",
    prompts >= FRUGAL_GOLD_PROMPTS && otel.costUsdCents <= FRUGAL_GOLD_MAX_CENTS,
  );

  // Big spender
  tryUnlock("big_spender_100", otel.costUsdCents >= SPENDER_BRONZE_CENTS);
  tryUnlock("big_spender_500", otel.costUsdCents >= SPENDER_SILVER_CENTS);
  tryUnlock("big_spender_2k", otel.costUsdCents >= SPENDER_GOLD_CENTS);

  // PRs
  tryUnlock("pr_50", otel.prCount >= PR_BRONZE);
  tryUnlock("pr_200", otel.prCount >= PR_SILVER);
  tryUnlock("pr_500", otel.prCount >= PR_GOLD);

  // Picky reviewer
  tryUnlock("picky_50", otel.editsRejected >= PICKY_BRONZE);
  tryUnlock("picky_250", otel.editsRejected >= PICKY_SILVER);
  tryUnlock("picky_1k", otel.editsRejected >= PICKY_GOLD);

  return newly;
}
