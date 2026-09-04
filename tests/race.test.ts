import { describe, expect, it } from 'vitest';
import type { GameEvent, RaceCourse, RaceGate } from '../src/core/types';
import { RACE, SIM_STEP } from '../src/config/tuning';
import { createVehicleState } from '../src/sim/gameState';
import { createRaceState, gateCrossing, stepRace } from '../src/sim/race';
import { buildTrackPath, offsetAtStation } from '../src/world/track';

/**
 * Race rules on a synthetic circuit: a 100 m square with a line and three checkpoints. The
 * car is teleported along the centreline tick by tick (previous pose -> pose), which is
 * exactly what the rules look at, so these tests are independent of the vehicle physics.
 */
const path = buildTrackPath({
  closed: true,
  nodes: [
    { x: -50, z: 50, r: 10, width: 10, zone: 'urban' },
    { x: -50, z: -50, r: 10, width: 10, zone: 'urban' },
    { x: 50, z: -50, r: 10, width: 10, zone: 'urban' },
    { x: 50, z: 50, r: 10, width: 10, zone: 'urban' },
  ],
});

function gateAt(s: number): RaceGate {
  const p = offsetAtStation(path, s, 0);
  const hw = p.halfWidth + 1;
  return { ax: p.x + p.tz * hw, az: p.z - p.tx * hw, bx: p.x - p.tz * hw, bz: p.z + p.tx * hw, fx: p.tx, fz: p.tz, s };
}

const course: RaceCourse = {
  laps: 2,
  gates: [gateAt(20), gateAt(100), gateAt(200), gateAt(300)],
  grid: [],
  path,
  shortcuts: [],
};

interface Run {
  race: ReturnType<typeof createRaceState>;
  v: ReturnType<typeof createVehicleState>;
  time: number;
  events: GameEvent[];
  station: number;
}

function start(): Run {
  const race = createRaceState(course);
  const p = offsetAtStation(path, 30, 0);
  const v = createVehicleState(p.x, p.z, Math.atan2(p.tx, -p.tz));
  const run: Run = { race, v, time: 0, events: [], station: 30 };
  // Burn the countdown.
  while (race.phase === 'countdown') tick(run, 0);
  return run;
}

/** Advance one tick, moving the car `ds` metres along the centreline (negative = backwards). */
function tick(run: Run, ds: number): GameEvent[] {
  run.events.length = 0;
  run.time += SIM_STEP;
  run.station += ds;
  const p = offsetAtStation(path, run.station, 0);
  run.v.prevX = run.v.x;
  run.v.prevZ = run.v.z;
  run.v.x = p.x;
  run.v.z = p.z;
  run.v.vx = (run.v.x - run.v.prevX) / SIM_STEP;
  run.v.vz = (run.v.z - run.v.prevZ) / SIM_STEP;
  stepRace(run.race, course, run.v, run.time, SIM_STEP, run.events);
  return run.events;
}

function drive(run: Run, metres: number, step = 0.8): GameEvent[] {
  const all: GameEvent[] = [];
  const n = Math.ceil(Math.abs(metres) / step);
  for (let i = 0; i < n; i++) all.push(...tick(run, Math.sign(metres) * step));
  return all;
}

describe('gate crossing', () => {
  it('reports forward, backward and no crossing', () => {
    // Gate across the x axis at z = 0, forward = -Z (north).
    expect(gateCrossing(0, 1, 0, -1, -5, 0, 5, 0, 0, -1)).toBe(1);
    expect(gateCrossing(0, -1, 0, 1, -5, 0, 5, 0, 0, -1)).toBe(-1);
    expect(gateCrossing(7, 1, 7, -1, -5, 0, 5, 0, 0, -1)).toBe(0);
    expect(gateCrossing(0, 2, 0, 1, -5, 0, 5, 0, 0, -1)).toBe(0);
    expect(gateCrossing(0, 1, 0, 1, -5, 0, 5, 0, 0, -1)).toBe(0);
  });
});

describe('race rules', () => {
  it('counts down 3, 2, 1 and then starts', () => {
    const race = createRaceState(course);
    const v = createVehicleState(0, 0, 0);
    const events: GameEvent[] = [];
    const seen: number[] = [];
    let started = false;
    let t = 0;
    for (let i = 0; i < 60 * 5 && !started; i++) {
      events.length = 0;
      t += SIM_STEP;
      stepRace(race, course, v, t, SIM_STEP, events);
      for (const e of events) {
        if (e.type === 'raceCountdown') seen.push(e.seconds);
        if (e.type === 'raceStart') started = true;
      }
    }
    expect(seen).toEqual([3, 2, 1]);
    expect(started).toBe(true);
    expect(race.phase).toBe('racing');
    expect(t).toBeCloseTo(RACE.countdownSeconds, 1);
  });

  it('completes laps through every checkpoint in order and finishes', () => {
    const run = start();
    const lap = path.length;
    const events = drive(run, lap);
    expect(events.filter((e) => e.type === 'checkpoint').map((e) => (e as { index: number }).index)).toEqual([1, 2, 3]);
    expect(events.some((e) => e.type === 'lapComplete')).toBe(true);
    expect(run.race.lap).toBe(2);
    expect(run.race.lapTimes[0]).toBeGreaterThan(0);
    expect(run.race.bestLap).toBe(run.race.lapTimes[0]);
    expect(run.race.phase).toBe('racing');

    const second = drive(run, lap);
    expect(second.some((e) => e.type === 'raceFinish')).toBe(true);
    expect(run.race.phase).toBe('finished');
    expect(run.race.finishTime).toBeGreaterThan(run.race.lapTimes[0]);
    expect(run.race.progress).toBe(2);
    // Nothing more happens after the flag.
    expect(drive(run, lap).filter((e) => e.type !== 'wrongWay')).toHaveLength(0);
  });

  it('does not count a lap when a checkpoint was skipped', () => {
    const run = start();
    // Jump from before gate 1 to after gate 2 in one tick (a cut across the infield).
    drive(run, 60); // station 90, just before gate 1 at 100
    tick(run, 120); // lands at 210: crossed gate 1 and gate 2's segment in one motion? No - a straight teleport
    // Whatever the teleport touched, force the state to "missed gate 2" and cross the line.
    run.race.nextGate = 2;
    run.station = 310;
    tick(run, 0);
    const events = drive(run, path.length - 310 + 40);
    expect(events.some((e) => e.type === 'lapComplete')).toBe(false);
    expect(run.race.lap).toBe(1);
  });

  it('takes a lap back when the line is re-crossed backwards, so reversing cannot mint laps', () => {
    const run = start();
    drive(run, path.length); // lap 1 done, station ~30 + lap
    expect(run.race.lap).toBe(2);
    drive(run, -20); // back over the line
    expect(run.race.lap).toBe(1);
    expect(run.race.lapTimes[0]).toBe(-1);
    expect(run.race.nextGate).toBe(0);
    drive(run, 25); // forward over it again: the lap is counted once, not twice
    expect(run.race.lap).toBe(2);
    expect(run.race.lapTimes[0]).toBeGreaterThan(0);
    expect(run.race.nextGate).toBe(1);
  });

  it('makes a checkpoint crossed backwards count again', () => {
    const run = start();
    drive(run, 80); // past gate 1 (100)? 30 + 80 = 110 yes
    expect(run.race.nextGate).toBe(2);
    drive(run, -20); // back over gate 1
    expect(run.race.nextGate).toBe(1);
    drive(run, 20);
    expect(run.race.nextGate).toBe(2);
  });

  it('reports the wrong way after driving against the lap for a while, and clears it', () => {
    const run = start();
    drive(run, 20);
    const back = drive(run, -60);
    const on = back.find((e) => e.type === 'wrongWay' && e.on);
    expect(on).toBeDefined();
    expect(run.race.wrongWay).toBe(true);
    const fwd = drive(run, 30);
    expect(fwd.some((e) => e.type === 'wrongWay' && !e.on)).toBe(true);
    expect(run.race.wrongWay).toBe(false);
  });

  it('measures progress in laps from the line', () => {
    const run = start();
    expect(run.race.progress).toBeGreaterThan(0);
    expect(run.race.progress).toBeLessThan(0.1);
    drive(run, path.length / 2);
    expect(run.race.progress).toBeCloseTo(0.5, 1);
    drive(run, path.length / 2);
    expect(run.race.lap).toBe(2);
    expect(run.race.progress).toBeCloseTo(1, 1);
  });
});
