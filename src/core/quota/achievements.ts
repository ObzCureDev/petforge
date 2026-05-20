/**
 * Quota-gated achievement checks. Spec §"Achievements".
 *
 * Gates on `quota.optIn === true && quota.lastProbeTs > 0` - matches the
 * OTel gate convention so unconfigured users never see a unlock from
 * default-zero counters.
 */

import { unlockAchievement } from "../achievements.js";
import type { AchievementId, State } from "../schema.js";

const EFFICIENT_BRONZE = 5;
const EFFICIENT_SILVER = 20;
const EFFICIENT_GOLD = 100;

const MARATHON_BRONZE = 1;
const MARATHON_SILVER = 10;
const MARATHON_GOLD = 50;

export function checkQuotaAchievements(state: State): AchievementId[] {
  const q = state.counters.quota;
  if (!q || !q.optIn || q.lastProbeTs === 0) return [];

  const newly: AchievementId[] = [];
  const tryUnlock = (id: AchievementId, condition: boolean): void => {
    if (condition && unlockAchievement(state, id)) newly.push(id);
  };

  tryUnlock("quota_efficient_bronze", q.consecutiveEfficient >= EFFICIENT_BRONZE);
  tryUnlock("quota_efficient_silver", q.consecutiveEfficient >= EFFICIENT_SILVER);
  tryUnlock("quota_efficient_gold", q.consecutiveEfficient >= EFFICIENT_GOLD);

  tryUnlock("quota_marathon_bronze", q.marathonCount >= MARATHON_BRONZE);
  tryUnlock("quota_marathon_silver", q.marathonCount >= MARATHON_SILVER);
  tryUnlock("quota_marathon_gold", q.marathonCount >= MARATHON_GOLD);

  return newly;
}
