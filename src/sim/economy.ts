import type { EconomyState, GameEvent, TargetState } from '../core/types';
import { TARGETS } from '../config/tuning';

/**
 * Pays rewards for `targetDestroyed` events exactly once per target. The event's
 * `reward` field is filled in here so presentation can show the amount.
 */
export function applyRewards(e: EconomyState, targets: TargetState[], events: GameEvent[]): void {
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev.type !== 'targetDestroyed') continue;
    const t = targets[ev.targetId];
    if (!t || t.rewarded) continue;
    t.rewarded = true;
    e.money += TARGETS.reward;
    e.destroyed += 1;
    e.lastReward += TARGETS.reward;
    ev.reward = TARGETS.reward;
  }
}
