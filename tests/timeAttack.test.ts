import { afterEach, describe, expect, it } from 'vitest';
import type { GameEvent, RaceState } from '../src/core/types';
import { SIM_STEP, TIME_ATTACK, VEHICLE } from '../src/config/tuning';
import { createPlayerCommand } from '../src/core/input/keyboard';
import {
  emptyTimeAttackProgress,
  readTimeAttackProgress,
  recordTimeAttackRun,
  writeTimeAttackProgress,
} from '../src/core/progress';
import { createInitialGameState, stepGame } from '../src/sim/gameState';
import {
  createTimeAttackState,
  resetTimeAttackState,
  setTimeAttackProgress,
  stepTimeAttack,
  timeAttackAllClear,
  timeAttackLevel,
  timeAttackLevelCount,
  timeAttackLevelIndex,
} from '../src/sim/timeAttack';
import { createCircuitWorld } from '../src/world/circuitWorld';
import { createProjection, pointAtStation, projectOntoPath } from '../src/world/track';

/**
 * TIME ATTACK — the mission chain on the city circuit (`src/sim/timeAttack.ts`).
 *
 * The feature is a judgement, not a mode: the race times the laps, the collision pass raises
 * the impacts, and this only decides whether what happened met what the mission asked. So the
 * tests come in two halves — the rules driven against a hand-made race state, and one real lap
 * of the real circuit through the real simulation, which is the only thing that can show that
 * the target times are numbers a car can actually do.
 */

/* ------------------------------------------------------------------ the rules */

/** A race state parked in one phase. Only the fields this module reads are meaningful. */
function race(phase: RaceState['phase'], finishTime = -1): RaceState {
  return {
    phase,
    countdown: 0,
    lap: 1,
    laps: 2,
    nextGate: 0,
    goTime: 0,
    lapStart: 0,
    prevLapStart: 0,
    elapsed: 0,
    lapTimes: [-1, -1],
    bestLap: -1,
    lastLap: -1,
    finishTime,
    station: 0,
    progress: 0,
    wrongWay: false,
    wrongWayTime: 0,
    shortcut: -1,
  };
}

function crash(impact: number): GameEvent {
  return { type: 'collision', x: 0, y: 0, z: 0, impact };
}

/**
 * Run `seconds` of racing, with the given collisions raised on the FIRST tick only — a tick's
 * event list is wiped by the orchestrator, so every later tick starts empty the way a real one
 * does. Answers with everything the rules raised over the whole stretch.
 */
function drive(ta: ReturnType<typeof createTimeAttackState>, seconds: number, events: GameEvent[] = []): GameEvent[] {
  const r = race('racing');
  const raised: GameEvent[] = [];
  const tick = events.slice();
  const ticks = Math.max(1, Math.round(seconds / SIM_STEP));
  for (let i = 0; i < ticks; i++) {
    const before = tick.length;
    stepTimeAttack(ta, r, SIM_STEP, tick);
    for (let k = before; k < tick.length; k++) raised.push(tick[k]);
    tick.length = 0;
  }
  return raised;
}

describe('the circuit mission chain', () => {
  it('offers the missions in order and stops at the last one', () => {
    expect(timeAttackLevelCount()).toBe(TIME_ATTACK.levels.length);
    expect(timeAttackLevelIndex(0)).toBe(0);
    expect(timeAttackLevelIndex(1)).toBe(1);
    expect(timeAttackLevelIndex(TIME_ATTACK.levels.length)).toBe(TIME_ATTACK.levels.length - 1);
    // Nonsense from storage reads as a player who has not started.
    expect(timeAttackLevelIndex(-4)).toBe(0);
    expect(timeAttackLevelIndex(Number.NaN)).toBe(0);
    expect(timeAttackAllClear(TIME_ATTACK.levels.length - 1)).toBe(false);
    expect(timeAttackAllClear(TIME_ATTACK.levels.length)).toBe(true);
  });

  it('asks for a shorter time and a smaller crash allowance at every step', () => {
    for (let i = 1; i < TIME_ATTACK.levels.length; i++) {
      expect(TIME_ATTACK.levels[i].seconds, `level ${i + 1} time`).toBeLessThan(TIME_ATTACK.levels[i - 1].seconds);
      expect(TIME_ATTACK.levels[i].crashes, `level ${i + 1} crashes`).toBeLessThan(TIME_ATTACK.levels[i - 1].crashes);
    }
    // The last one is the one the whole feature is pointed at: a clean lap.
    expect(TIME_ATTACK.levels[TIME_ATTACK.levels.length - 1].crashes).toBe(0);
  });

  it('clamps a stored progress count to the chain that exists now', () => {
    expect(createTimeAttackState(99).cleared).toBe(TIME_ATTACK.levels.length);
    expect(createTimeAttackState(-1).cleared).toBe(0);
    const ta = createTimeAttackState();
    setTimeAttackProgress(ta, 2);
    expect(ta.cleared).toBe(2);
    setTimeAttackProgress(ta, TIME_ATTACK.levels.length + 5);
    expect(ta.cleared).toBe(TIME_ATTACK.levels.length);
    // Not a number at all: a player who has not started, not a player who has finished.
    setTimeAttackProgress(ta, Number.POSITIVE_INFINITY);
    expect(ta.cleared).toBe(0);
  });

  it('counts a hit as a crash and a brush as nothing', () => {
    const ta = createTimeAttackState();
    const events = drive(ta, 0.1, [crash(TIME_ATTACK.crashImpact - 0.1)]);
    expect(ta.crashes).toBe(0);
    expect(events.some((e) => e.type === 'timeAttackCrash')).toBe(false);

    drive(ta, 0.1, [crash(TIME_ATTACK.crashImpact + 2)]);
    expect(ta.crashes).toBe(1);
  });

  it('counts one accident once, however many impacts it raises', () => {
    const ta = createTimeAttackState();
    // A real hit comes back as a burst: the bounce, then the car riding down the wall.
    drive(ta, TIME_ATTACK.crashCooldown * 0.5, [crash(9), crash(7), crash(6)]);
    expect(ta.crashes).toBe(1);
    // Still inside the cooldown.
    drive(ta, 0.1, [crash(8)]);
    expect(ta.crashes).toBe(1);
    // Past it: a new accident.
    drive(ta, TIME_ATTACK.crashCooldown, []);
    drive(ta, 0.1, [crash(8)]);
    expect(ta.crashes).toBe(2);
  });

  it('counts nothing while the car is held on the grid', () => {
    const ta = createTimeAttackState();
    const events: GameEvent[] = [crash(9)];
    stepTimeAttack(ta, race('countdown'), SIM_STEP, events);
    expect(ta.crashes).toBe(0);
  });

  it('spends the allowance once, says so, and lets the race carry on', () => {
    const ta = createTimeAttackState(1); // level 2: one crash allowed
    const allowance = timeAttackLevel(ta.cleared).crashes;
    expect(allowance).toBe(1);

    let events = drive(ta, 0.1, [crash(9)]);
    let raised = events.filter((e) => e.type === 'timeAttackCrash');
    expect(raised).toHaveLength(1);
    expect(raised[0]).toMatchObject({ crashes: 1, allowance: 1, fatal: false });
    expect(ta.failed).toBe(false);

    drive(ta, TIME_ATTACK.crashCooldown, []);
    events = drive(ta, 0.1, [crash(9)]);
    raised = events.filter((e) => e.type === 'timeAttackCrash');
    expect(raised[0]).toMatchObject({ crashes: 2, fatal: true });
    expect(ta.failed).toBe(true);

    // A third one is still counted, but the run was already lost: `fatal` is said once.
    drive(ta, TIME_ATTACK.crashCooldown, []);
    events = drive(ta, 0.1, [crash(9)]);
    expect(events.filter((e) => e.type === 'timeAttackCrash')[0]).toMatchObject({ crashes: 3, fatal: false });
  });

  it('fails the last mission on the first contact', () => {
    const ta = createTimeAttackState(2);
    expect(timeAttackLevel(ta.cleared).crashes).toBe(0);
    const events = drive(ta, 0.1, [crash(9)]);
    expect(ta.failed).toBe(true);
    expect(events.filter((e) => e.type === 'timeAttackCrash')[0]).toMatchObject({ crashes: 1, allowance: 0, fatal: true });
  });

  it('clears the mission and moves the chain on when both halves are met', () => {
    const ta = createTimeAttackState();
    const spec = timeAttackLevel(0);
    drive(ta, 0.1, [crash(9)]); // one crash, well inside the first mission's allowance
    const events: GameEvent[] = [];
    stepTimeAttack(ta, race('finished', spec.seconds - 5), SIM_STEP, events);

    const end = events.find((e) => e.type === 'timeAttackEnd');
    expect(end).toBeDefined();
    expect(end && end.type === 'timeAttackEnd' && end.results).toMatchObject({
      level: 0,
      cleared: true,
      advanced: true,
      withinTime: true,
      withinCrashes: true,
      crashes: 1,
      targetTime: spec.seconds,
      crashLimit: spec.crashes,
    });
    const up = events.find((e) => e.type === 'timeAttackLevelUp');
    expect(up).toMatchObject({ level: 0, cleared: 1, allClear: false });
    // The promotion is said before the run it came from.
    expect(events.indexOf(up as GameEvent)).toBeLessThan(events.indexOf(end as GameEvent));
    expect(ta.cleared).toBe(1);
    expect(ta.results?.levelName).toBe(spec.name);
  });

  it('judges the flag once, however long the card is up', () => {
    const ta = createTimeAttackState();
    const finished = race('finished', 10);
    const events: GameEvent[] = [];
    for (let i = 0; i < 30; i++) stepTimeAttack(ta, finished, SIM_STEP, events);
    expect(events.filter((e) => e.type === 'timeAttackEnd')).toHaveLength(1);
    expect(ta.cleared).toBe(1);
  });

  it('fails a run that was fast but dirty, and one that was clean but slow', () => {
    const spec = timeAttackLevel(1);

    const dirty = createTimeAttackState(1);
    for (let i = 0; i < 3; i++) {
      drive(dirty, 0.1, [crash(9)]);
      drive(dirty, TIME_ATTACK.crashCooldown, []);
    }
    let events: GameEvent[] = [];
    stepTimeAttack(dirty, race('finished', spec.seconds - 20), SIM_STEP, events);
    let results = dirty.results!;
    expect(results).toMatchObject({ cleared: false, withinTime: true, withinCrashes: false });
    expect(dirty.cleared).toBe(1);

    const slow = createTimeAttackState(1);
    events = [];
    stepTimeAttack(slow, race('finished', spec.seconds + 0.5), SIM_STEP, events);
    results = slow.results!;
    expect(results).toMatchObject({ cleared: false, withinTime: false, withinCrashes: true });
    expect(slow.cleared).toBe(1);
    expect(events.some((e) => e.type === 'timeAttackLevelUp')).toBe(false);
  });

  it('lets a cleared mission be replayed without skipping the next one', () => {
    const ta = createTimeAttackState(2); // two done, the third on offer
    // Re-drive the third and clear it: the chain finishes.
    stepTimeAttack(ta, race('finished', timeAttackLevel(2).seconds - 10), SIM_STEP, []);
    expect(ta.cleared).toBe(3);
    expect(timeAttackAllClear(ta.cleared)).toBe(true);
    // And again, now that the chain is done: it stays done, and stays on the last mission.
    const events: GameEvent[] = [];
    ta.phase = 'racing';
    stepTimeAttack(ta, race('finished', 1), SIM_STEP, events);
    expect(ta.cleared).toBe(3);
    expect(ta.results).toMatchObject({ level: 2, advanced: false });
    expect(events.some((e) => e.type === 'timeAttackLevelUp')).toBe(false);
  });

  it('starts a fresh run when the car goes back on the grid, and keeps the progress', () => {
    const ta = createTimeAttackState(1);
    drive(ta, 0.1, [crash(9)]);
    drive(ta, TIME_ATTACK.crashCooldown, []);
    drive(ta, 0.1, [crash(9)]);
    expect(ta.crashes).toBe(2);
    expect(ta.failed).toBe(true);

    stepTimeAttack(ta, race('countdown'), SIM_STEP, []);
    expect(ta.crashes).toBe(0);
    expect(ta.failed).toBe(false);
    expect(ta.results).toBeNull();
    expect(ta.cleared, 'a restart does not un-finish a mission').toBe(1);

    resetTimeAttackState(ta);
    expect(ta.cleared).toBe(1);
    expect(ta.crashes).toBe(0);
  });
});

/* ---------------------------------------------------------------- the record */

/**
 * `localStorage` does not exist in the node test environment, which the module is written for
 * (a browser that refuses storage outright behaves the same way). A stub is installed for the
 * round trip below and taken away afterwards.
 */
function installStorage(seed: Record<string, string> = {}): Map<string, string> {
  const store = new Map<string, string>(Object.entries(seed));
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  };
  return store;
}

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe('what the browser remembers about the chain', () => {
  it('keeps the quickest time on each mission and only ever moves the chain forward', () => {
    let p = emptyTimeAttackProgress();
    expect(p.best).toHaveLength(TIME_ATTACK.levels.length);
    expect(p.best.every((t) => t === -1)).toBe(true);

    p = recordTimeAttackRun(p, 0, 150, true);
    expect(p).toMatchObject({ cleared: 1 });
    expect(p.best[0]).toBe(150);
    // Slower: the record stands.
    p = recordTimeAttackRun(p, 0, 158, false);
    expect(p.best[0]).toBe(150);
    // Quicker: it does not.
    p = recordTimeAttackRun(p, 0, 144.5, false);
    expect(p.best[0]).toBe(144.5);
    // A replay of a cleared mission cannot take the chain back.
    expect(p.cleared).toBe(1);
    // A mission that was never finished has no time in it.
    expect(p.best[2]).toBe(-1);
  });

  it('rebuilds a stored record against the chain that exists now', () => {
    const store = installStorage();
    writeTimeAttackProgress({ cleared: 99, best: [120] });
    let read = readTimeAttackProgress();
    expect(read.cleared).toBe(TIME_ATTACK.levels.length);
    expect(read.best).toHaveLength(TIME_ATTACK.levels.length);
    expect(read.best[0]).toBe(120);
    expect(read.best[1]).toBe(-1);

    store.set('rb.circuit.missions', '{ not json');
    expect(readTimeAttackProgress()).toEqual(emptyTimeAttackProgress());
    // And a browser with no storage at all: a player who has not started, never a throw.
    delete (globalThis as { localStorage?: unknown }).localStorage;
    expect(readTimeAttackProgress()).toEqual(emptyTimeAttackProgress());
    expect(() => writeTimeAttackProgress({ cleared: 1, best: [120, -1, -1] })).not.toThrow();
  });
});

/* ------------------------------------------------------- one real lap of it */

const world = createCircuitWorld(7);
const layout = world.layout;
const course = layout.race!;

/**
 * A driver that follows the racing line and nothing else: no nitro, no shortcuts, no attempt
 * at an apex. `commitment` scales how much of the car's grip it is willing to use in a corner,
 * which is the one dial between "getting round" and "on the limit".
 */
function lapTheCircuit(commitment: number): { time: number; crashes: number; failed: boolean; cleared: number } {
  const path = course.path;
  const samples = path.samples;
  const n = samples.length;
  // Corner speed from the grip circle, then a backward pass so the car is already slow enough
  // when it arrives rather than braking inside the corner.
  const profile: number[] = [];
  for (let i = 0; i < n; i++) {
    const k = Math.abs(samples[i].curvature);
    profile.push(Math.min(VEHICLE.maxSpeed, k > 1e-6 ? Math.sqrt(VEHICLE.maxLatAccel * commitment / k) : VEHICLE.maxSpeed));
  }
  for (let pass = 0; pass < 4; pass++) {
    for (let i = n - 1; i >= 0; i--) {
      const j = (i + 1) % n;
      const ds = Math.hypot(samples[j].x - samples[i].x, samples[j].z - samples[i].z) || 1;
      profile[i] = Math.min(profile[i], Math.sqrt(profile[j] * profile[j] + 2 * VEHICLE.brakeDecel * 0.55 * commitment * ds));
    }
  }
  const targetAt = (s: number): number => {
    const L = path.length;
    const st = ((s % L) + L) % L;
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (samples[mid].s <= st) lo = mid;
      else hi = mid - 1;
    }
    return profile[lo];
  };

  const state = createInitialGameState(layout, 'auto', { timeAttack: true });
  // The traffic is not what is being measured here.
  for (const t of state.targets) {
    t.status = 'destroyed';
    t.hitTime = Number.POSITIVE_INFINITY;
  }
  const cmd = createPlayerCommand();
  const proj = createProjection();
  const aim = createProjection();
  const ticks = Math.round(400 / SIM_STEP);
  for (let i = 0; i < ticks; i++) {
    const v = state.vehicle;
    projectOntoPath(path, v.x, v.z, proj);
    pointAtStation(path, proj.s + 8 + 0.5 * Math.max(0, v.speed), aim);
    let err = Math.atan2(aim.x - v.x, -(aim.z - v.z)) - v.heading;
    while (err > Math.PI) err -= Math.PI * 2;
    while (err < -Math.PI) err += Math.PI * 2;
    cmd.steer = Math.max(-1, Math.min(1, err * 2.2 - v.yawRate * 0.25));
    const over = v.speed - targetAt(proj.s + 4);
    cmd.throttle = over < -0.5 ? 1 : 0;
    cmd.brake = over > 0.5 ? Math.min(1, over / 6) : 0;
    stepGame(state, cmd, layout, SIM_STEP);
    if (state.race!.phase === 'finished') break;
  }
  const ta = state.timeAttack!;
  return { time: state.race!.finishTime, crashes: ta.crashes, failed: ta.failed, cleared: ta.cleared };
}

describe('a real run of the first mission', () => {
  /**
   * The target times are the only numbers in this feature that can be wrong in a way no unit
   * test would notice: a mission nobody can clear, or one that clears itself. So the first is
   * driven for real, by a driver that only follows the line — no nitro, none of the hidden
   * shortcuts, no racecraft at all — and the last one's target is checked against a lap driven
   * with real commitment. Both are floors: a player has more than this driver does.
   */
  it('is cleared by a careful driver who just follows the line, and clears the mission', () => {
    const run = lapTheCircuit(0.55);
    expect(run.time, 'the lap finished').toBeGreaterThan(0);
    expect(run.time, `the first mission asks for ${TIME_ATTACK.levels[0].seconds}s`).toBeLessThanOrEqual(TIME_ATTACK.levels[0].seconds);
    expect(run.crashes, 'and it can be done without hitting anything').toBe(0);
    expect(run.failed).toBe(false);
    expect(run.cleared, 'so the chain moved on').toBe(1);
  }, 20000);

  it('is not fast enough for the last mission, which a committed lap is', () => {
    const careful = lapTheCircuit(0.55);
    expect(careful.time).toBeGreaterThan(TIME_ATTACK.levels[TIME_ATTACK.levels.length - 1].seconds);
    const committed = lapTheCircuit(0.85);
    expect(committed.time, 'the last mission is inside a committed clean lap').toBeLessThanOrEqual(
      TIME_ATTACK.levels[TIME_ATTACK.levels.length - 1].seconds,
    );
    expect(committed.crashes, 'which that driver got round without hitting anything').toBe(0);
  }, 30000);
});
