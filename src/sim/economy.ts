import type { EconomyState, GameEvent, TargetState } from '../core/types';
import { TARGETS } from '../config/tuning';

/**
 * The single place money is paid out.
 *
 * - `targetDestroyed` pays `TARGETS.reward` exactly once per target; the event's `reward`
 *   field is filled in here so presentation can show the amount.
 * - `nearMiss` pays the points the pass already earned in `src/sim/nearMiss.ts`. Those are
 *   scored once when the pass closes, so no extra guard is needed here.
 */
export function applyRewards(e: EconomyState, targets: TargetState[], events: GameEvent[]): void {
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev.type === 'nearMiss') {
      e.money += ev.points;
      e.lastReward += ev.points;
      continue;
    }
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
