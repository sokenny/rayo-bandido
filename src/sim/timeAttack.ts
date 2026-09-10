import type { GameEvent, RaceState, TimeAttackResults, TimeAttackState } from '../core/types';
import { TIME_ATTACK } from '../config/tuning';

/**
 * TIME ATTACK: the mission chain on the city circuit.
 *
 * WHAT IT IS. Three runs of the race that already exists — two laps of the Bandido Grid — in
 * order, each asking for a shorter finish time and a smaller crash allowance than the last
 * (`TIME_ATTACK.levels`). Clear one and the next is on offer the moment the car is put back on
 * the grid.
 *
 * WHAT IT IS NOT. A mode. This module owns no clock, no course, no gates and no car: the race
 * rules (`src/sim/race.ts`) time the laps exactly as they always did, the collision pass raises
 * the impacts exactly as it always did, and all this does is watch both and decide whether what
 * happened met what the mission asked for. Nothing here can change the outcome of a lap, which
 * is what lets the same circuit be driven as a versus race with the chain simply absent.
 *
 * WHERE IT SITS IN A TICK. After `stepRace`, and deliberately: the finish this module reacts to
 * is the one that race decided on THIS tick, and the `collision` events it counts were raised
 * earlier in the same tick by the collision pass. So a crash on the run's last corner is
 * counted before the flag it is judged at.
 *
 * THE RUN IS BOUNDED BY THE RACE. There is no "start a run" here and no key to press. The race
 * goes back to `countdown` — at the lights, and on every restart — and that IS the start of a
 * run: the crash count goes back to zero. The race reaches `finished` and that IS the flag.
 * `TimeAttackState.phase` remembers which of those this module has already reacted to, so a
 * finish is judged once however many frames the card is up for.
 *
 * A CRASH, not a touch. `TIME_ATTACK.crashImpact` is velocity INTO a surface, which is what
 * separates brushing a barrier on the exit of a corner from hitting it, and `crashCooldown`
 * keeps one accident to one crash: a real impact raises a burst of events over the following
 * ticks as the car bounces off and rides down the wall.
 *
 * FAILING IS NOT STOPPING. Spending the allowance sets `failed` and the mission cannot be
 * passed by that run, but the race carries on: the lap is still worth driving out, the time is
 * still a time, and the player restarts when they choose to rather than being thrown out of a
 * race the rules are still perfectly happy to run.
 *
 * THE CHAIN. `cleared` is the whole progression — how many missions are done AND which one is
 * on offer — and it moves forward by exactly one, at the end of a run that met BOTH halves of
 * what the mission asked, and only when that mission was the one still outstanding. Replaying
 * a cleared level can therefore never skip the next one. A player who has finished the chain
 * keeps driving the last mission rather than falling off the end of the list.
 */

/** Which mission is on offer, given how many are cleared. Clamped to the last one. */
export function timeAttackLevelIndex(cleared: number): number {
  const last = TIME_ATTACK.levels.length - 1;
  if (!Number.isFinite(cleared) || cleared <= 0) return 0;
  return Math.min(last, Math.floor(cleared));
}

/** How many missions there are in all. */
export function timeAttackLevelCount(): number {
  return TIME_ATTACK.levels.length;
}

/** True once every mission has been cleared: the chain keeps the last one and stops gating. */
export function timeAttackAllClear(cleared: number): boolean {
  return cleared >= TIME_ATTACK.levels.length;
}

/** What the mission on offer asks for: a finish time (s), a crash allowance and a name. */
export function timeAttackLevel(cleared: number): (typeof TIME_ATTACK.levels)[number] {
  return TIME_ATTACK.levels[timeAttackLevelIndex(cleared)];
}

/** A stored progress count, made safe: a whole number between 0 and the length of the chain. */
function clampCleared(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(TIME_ATTACK.levels.length, Math.floor(value));
}

/**
 * `cleared` is how many missions this player has already finished, read back from wherever the
 * caller keeps such things. It defaults to 0 — a fresh browser starts at the first mission —
 * and is clamped, because a stored number is an untrusted number.
 */
export function createTimeAttackState(cleared = 0): TimeAttackState {
  return {
    cleared: clampCleared(cleared),
    crashes: 0,
    crashCooldown: 0,
    failed: false,
    phase: 'countdown',
    results: null,
  };
}

/**
 * Move the chain to a given point. The caller's way of restoring progress it had written down
 * (`src/core/progress.ts`) onto a state that was built before that was known, and the only
 * thing besides finishing a run that may move it.
 */
export function setTimeAttackProgress(ta: TimeAttackState, cleared: number): void {
  ta.cleared = clampCleared(cleared);
}

/**
 * Back to the grid with nothing counted. Used by a restart, alongside the race's own reset.
 *
 * `cleared` is deliberately NOT touched: restarting puts the car back on the line, it does not
 * un-finish missions the player has finished. Progress leaves this state only by being
 * overwritten with `setTimeAttackProgress`.
 */
export function resetTimeAttackState(ta: TimeAttackState): void {
  ta.crashes = 0;
  ta.crashCooldown = 0;
  ta.failed = false;
  ta.phase = 'countdown';
  ta.results = null;
}

/** The run under way is back to zero. A fresh grid, whether from the lights or from a restart. */
function beginRun(ta: TimeAttackState): void {
  ta.crashes = 0;
  ta.crashCooldown = 0;
  ta.failed = false;
  ta.results = null;
}

/**
 * The flag. Freezes the run into a `TimeAttackResults`, and — this is the whole of the
 * progression — moves the chain on by one when BOTH halves of the mission were met AND that
 * mission was the one still outstanding.
 *
 * The promotion is raised BEFORE the run itself, so a listener that writes the new total down
 * and one that shows the card see them in the order they happened.
 */
function endRun(ta: TimeAttackState, race: RaceState, events: GameEvent[]): void {
  const level = timeAttackLevelIndex(ta.cleared);
  const spec = TIME_ATTACK.levels[level];
  const time = race.finishTime;
  const withinTime = time > 0 && time <= spec.seconds;
  const withinCrashes = ta.crashes <= spec.crashes;
  const cleared = withinTime && withinCrashes;
  const advanced = cleared && ta.cleared === level;
  if (advanced) {
    ta.cleared = level + 1;
    events.push({ type: 'timeAttackLevelUp', level, cleared: ta.cleared, allClear: timeAttackAllClear(ta.cleared) });
  }

  const results: TimeAttackResults = {
    level,
    levelName: spec.name,
    targetTime: spec.seconds,
    crashLimit: spec.crashes,
    time,
    crashes: ta.crashes,
    withinTime,
    withinCrashes,
    cleared,
    advanced,
  };
  ta.results = results;
  events.push({ type: 'timeAttackEnd', results });
}

/**
 * One tick of the chain. Called after `stepRace`, with the tick's events — the collisions it
 * counts are already in there, and so is the `raceFinish` this judges.
 *
 * `events` is both read for `collision` and appended to; the length is taken before anything is
 * pushed, so a crash raised inside the loop is never counted as one.
 */
export function stepTimeAttack(ta: TimeAttackState, race: RaceState, dt: number, events: GameEvent[]): void {
  const phase = race.phase;
  // Back on the grid: the lights, or a restart. Either way the run starts again from nothing.
  if (phase === 'countdown' && ta.phase !== 'countdown') beginRun(ta);

  if (phase === 'racing') {
    if (ta.crashCooldown > 0) ta.crashCooldown = Math.max(0, ta.crashCooldown - dt);
    const allowance = timeAttackLevel(ta.cleared).crashes;
    const count = events.length;
    for (let i = 0; i < count; i++) {
      const ev = events[i];
      if (ev.type !== 'collision') continue;
      if (ev.impact < TIME_ATTACK.crashImpact) continue;
      // Still inside the last accident: the car is bouncing off, or riding down the wall.
      if (ta.crashCooldown > 0) continue;
      ta.crashCooldown = TIME_ATTACK.crashCooldown;
      ta.crashes++;
      const fatal = !ta.failed && ta.crashes > allowance;
      if (fatal) ta.failed = true;
      events.push({ type: 'timeAttackCrash', crashes: ta.crashes, allowance, impact: ev.impact, fatal });
    }
  }

  if (phase === 'finished' && ta.phase !== 'finished') endRun(ta, race, events);
  ta.phase = phase;
}
