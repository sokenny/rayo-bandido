import type { CrashDamageState, CrashSeverity, EconomyState, GameEvent } from '../core/types';
import { CRASH_DAMAGE } from '../config/tuning';
import { chargeCrashFine } from './economy';

/**
 * CRASH DAMAGE: what driving into things costs.
 *
 * The game pays for driving fast with style — near misses, drifts, kills. This is the other half.
 * A meaningful hit, and only a meaningful one, is punished exactly once. Its severity is the speed
 * the collision passes ALREADY measured (`collision.ts`, `rivalCollision.ts`, `streetProps.ts`,
 * the police's shove): the closing speed on another car when the pass knew it, the speed into the
 * surface otherwise. Under the lightest tier it is a touch, and a touch is free. Nothing here
 * detects contact of its own.
 *
 * WHAT IT COSTS depends on the world (`CrashRules.stall`):
 *
 *   - THE OPEN WORLD: the tier's fine, taken in the economy's one place for it
 *     (`chargeCrashFine`) and never below zero, and marks on the body until the car rolls onto
 *     Loco Mustang's ring, which washes them off for nothing. The car drives exactly as before.
 *   - A RACE: time. A light crash costs nothing; a medium or heavy one stalls the car — engine cut,
 *     brakes on, blinking like a respawn — for `CRASH_DAMAGE.race` seconds. No fine, no marks. The
 *     hold itself is the orchestrator's (`gameState.ts`), the way the grid's is.
 *
 * ONE ACCIDENT, ONE PUNISHMENT. After one nothing is punished for `cooldownSeconds` (in a race, for
 * the whole stall and its grace), and until the car has been clear of every surface for
 * `separationSeconds` only a hit of `stillTouchingImpact` or more is a new crash — a car ground
 * along a wall, bouncing in a corner or left leaning on a barrier pays once.
 *
 * Cutting the streaks is the caller's (`gameState.ts`), because they belong to `drift.ts` and
 * `flair.ts`. Pure data in, pure data out. No DOM, no audio, no Three.js; nothing allocates per tick.
 */

/** What the caller decides about this tick. One long-lived object is fine; nothing here keeps it. */
export interface CrashRules {
  /** May a crash be punished right now (off during the intro, the grid and after the flag). */
  enabled: boolean;
  /** The car is on the garage's ring, which repairs it. */
  atGarage: boolean;
  /** A race world: stall the car instead of fining it. */
  stall: boolean;
}

export function createCrashDamageState(): CrashDamageState {
  return {
    cooldown: 0,
    sinceContact: Infinity,
    latched: false,
    marks: 0,
    heavy: false,
    heavyAt: -Infinity,
    version: 0,
    stall: 0,
    stallSeconds: 0,
    stats: { crashes: 0, charged: 0, repairs: 0, stalls: 0 },
  };
}

/** A clean, running car and a clear latch: a restart. The counters are the session's and survive it. */
export function resetCrashDamageState(s: CrashDamageState): void {
  s.cooldown = 0;
  s.sinceContact = Infinity;
  s.latched = false;
  s.marks = 0;
  s.heavy = false;
  s.heavyAt = -Infinity;
  s.stall = 0;
  s.stallSeconds = 0;
  s.version++;
}

/** The tier a hit at `speed` (m/s) falls in, or null for a touch. */
export function crashSeverity(speed: number): CrashSeverity | null {
  const t = CRASH_DAMAGE.tiers;
  if (speed >= t.heavy.impact) return 'heavy';
  if (speed >= t.medium.impact) return 'medium';
  if (speed >= t.light.impact) return 'light';
  return null;
}

/** Seconds a race crash at `speed` stalls the car: 0 for light, a flat medium, a heavy one growing with the hit. */
export function stallSeconds(severity: CrashSeverity, speed: number): number {
  const r = CRASH_DAMAGE.race;
  if (severity === 'light') return 0;
  if (severity === 'medium') return r.mediumStall;
  const from = CRASH_DAMAGE.tiers.heavy.impact;
  const t = Math.max(0, Math.min(1, (speed - from) / Math.max(1e-6, r.heavyStallImpact - from)));
  return r.heavyStall[0] + (r.heavyStall[1] - r.heavyStall[0]) * t;
}

/** Whether a race stall holds the car this tick. */
export function crashStalled(s: CrashDamageState | null): boolean {
  return !!s && s.stall > 0;
}

/** Wash the car. False when it was already clean. */
export function repairCrashDamage(s: CrashDamageState, events: GameEvent[]): boolean {
  if (s.marks === 0 && !s.heavy) return false;
  s.marks = 0;
  s.heavy = false;
  s.heavyAt = -Infinity;
  s.version++;
  s.stats.repairs++;
  events.push({ type: 'crashRepaired' });
  return true;
}

/**
 * One tick. Reads the `collision` events already raised from `from` on, so it must run after
 * every pass that can put the car into something. Contact is tracked whether or not `rules.enabled`,
 * so a crash that began while punishing was off is not punished the moment it comes back on.
 *
 * Returns the severity of the crash punished on this tick, or null. In a race a light crash is
 * never punished, so it is never returned either.
 */
export function stepCrashDamage(
  s: CrashDamageState,
  economy: EconomyState,
  rules: CrashRules,
  time: number,
  dt: number,
  events: GameEvent[],
  from = 0,
): CrashSeverity | null {
  if (s.cooldown > 0) s.cooldown = Math.max(0, s.cooldown - dt);
  if (s.stall > 0) {
    s.stall = Math.max(0, s.stall - dt);
    if (s.stall === 0) s.stallSeconds = 0;
  }

  let hardest = 0;
  let contact = false;
  let x = 0;
  let y = 0;
  let z = 0;
  const count = events.length;
  for (let i = from; i < count; i++) {
    const ev = events[i];
    if (ev.type !== 'collision') continue;
    contact = true;
    const speed = ev.closing ?? ev.impact;
    if (speed > hardest) {
      hardest = speed;
      x = ev.x;
      y = ev.y;
      z = ev.z;
    }
  }
  if (contact) s.sinceContact = 0;
  else s.sinceContact += dt;
  if (s.latched && s.sinceContact >= CRASH_DAMAGE.separationSeconds) s.latched = false;

  let punished: CrashSeverity | null = null;
  let severity = rules.enabled && CRASH_DAMAGE.enabled ? crashSeverity(hardest) : null;
  if (rules.stall && severity === 'light') severity = null;
  if (severity && s.cooldown <= 0 && (!s.latched || hardest >= CRASH_DAMAGE.stillTouchingImpact)) {
    s.latched = true;
    s.stats.crashes++;
    punished = severity;
    if (rules.stall) {
      const seconds = stallSeconds(severity, hardest);
      s.stall = seconds;
      s.stallSeconds = seconds;
      s.cooldown = seconds + CRASH_DAMAGE.race.graceSeconds;
      s.stats.stalls++;
      events.push({ type: 'crashStall', severity, speed: hardest, seconds, x, y, z });
    } else {
      const tier = CRASH_DAMAGE.tiers[severity];
      const paid = chargeCrashFine(economy, tier.fine);
      s.cooldown = CRASH_DAMAGE.cooldownSeconds;
      s.marks = Math.min(CRASH_DAMAGE.visual.maxMarks, s.marks + tier.marks);
      if (severity === 'heavy') {
        s.heavy = true;
        s.heavyAt = time;
      }
      s.version++;
      s.stats.charged += paid;
      events.push({
        type: 'crashDamage',
        severity,
        speed: hardest,
        fine: tier.fine,
        charged: paid,
        balance: economy.money,
        aura: CRASH_DAMAGE.aura,
        x,
        y,
        z,
      });
    }
  }

  if (rules.atGarage) repairCrashDamage(s, events);
  return punished;
}
