import type { EconomyState, GameEvent, PoliceState, TargetState } from '../core/types';
import { TARGETS } from '../config/tuning';

/**
 * The single place money is paid out.
 *
 * - `targetDestroyed` pays `TARGETS.reward` exactly once per target; the event's `reward`
 *   field is filled in here so presentation can show the amount.
 * - `nearMiss` pays the points the pass already earned in `src/sim/nearMiss.ts`. Those are
 *   scored once when the pass closes, so no extra guard is needed here.
 * - `passengerComplete` pays a ride's fare and tip (`applyPassengerFare`, below). That event is
 *   raised after this pass has run, so it has a pass of its own; it is raised exactly once per
 *   ride by `src/sim/passenger.ts`, so it needs no guard either.
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

/**
 * The fare and the tip of a ride that ended this tick. Read from `from`, the length the event
 * list had before the passenger rules ran, so only what they raised is scanned.
 */
export function applyPassengerFare(e: EconomyState, events: GameEvent[], from = 0): void {
  for (let i = from; i < events.length; i++) {
    const ev = events[i];
    if (ev.type !== 'passengerComplete') continue;
    const paid = ev.results.fare + ev.results.tip;
    e.money += paid;
    e.lastReward += paid;
  }
}

/**
 * The single place money is taken. False, and nothing taken, when the counter cannot cover
 * it: a purchase is all or nothing, never a debt. `lastReward` is left alone — it is the
 * reward flash's, and a purchase is not a reward.
 */
export function spendMoney(e: EconomyState, amount: number): boolean {
  if (!(amount >= 0) || e.money < amount) return false;
  e.money -= amount;
  return true;
}

/**
 * The fine of an arrest (`policeBusted`, raised by `src/sim/police.ts`). Taken from the
 * counter, never below zero — the fine is a penalty, not a debt — and what was actually taken
 * is written back onto the event (`charged`) and the police state, so the card and the counters
 * report the real number. Read from `from`, the length the list had before the police ran.
 */
export function applyPoliceFine(e: EconomyState, police: PoliceState, events: GameEvent[], from = 0): void {
  for (let i = from; i < events.length; i++) {
    const ev = events[i];
    if (ev.type !== 'policeBusted') continue;
    const charged = Math.max(0, Math.min(e.money, ev.fine));
    e.money -= charged;
    ev.charged = charged;
    police.bustedCharged = charged;
    police.stats.finesCharged += charged;
  }
}
