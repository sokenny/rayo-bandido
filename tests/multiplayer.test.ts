import { describe, expect, it } from 'vitest';
import type { ArenaLayout, GameEvent, RivalCar, TargetState } from '../src/core/types';
import { RIVALS, SIM_STEP, TARGETS, VEHICLE } from '../src/config/tuning';
import { createVehicleState } from '../src/sim/gameState';
import { resolveRivalCollisions } from '../src/sim/rivalCollision';
import { createTrafficSync, TRAFFIC_STRIDE } from '../src/sim/traffic';
import { createTargets, stepTargets } from '../src/sim/targets';
import { resolveTargetCollisions } from '../src/sim/collision';
import { createRivalSet } from '../src/net/rivals';
import { CAR_FLAG, INTERP_DELAY_MS, RIVAL_TIMEOUT_MS, packCarFlags, type WireCar } from '../src/net/protocol';
import { slotColor, slotCss, SLOT_COLORS } from '../src/core/playerColors';
import { rankStandings, type StandingsRow } from '../src/ui/standings';

/**
 * The parts of multiplayer that are pure rules and pure arithmetic: contact between two
 * players' cars, the interpolation that turns snapshots back into a moving car, and the
 * traffic reconciliation. None of them need a socket, a browser or a GPU.
 *
 * What is deliberately NOT tested here is the room and the transport — those need a running
 * server and two clients, and are verified by actually racing (see docs/PROGRESS.md).
 */

function rival(overrides: Partial<RivalCar> = {}): RivalCar {
  return {
    id: 'p2',
    name: 'RIVAL',
    slot: 1,
    present: true,
    x: 0,
    z: 0,
    heading: 0,
    vx: 0,
    vz: 0,
    speed: 0,
    steerAngle: 0,
    wheelSpin: 0,
    latAccel: 0,
    longAccel: 0,
    drifting: false,
    nitro: false,
    braking: false,
    reversing: false,
    charge: 0,
    lap: 1,
    progress: 0,
    lapTime: 0,
    bestLap: -1,
    finishTime: -1,
    money: 0,
    ...overrides,
  };
}

const CONTACT = VEHICLE.collisionRadius + RIVALS.radius;

describe('contact between players', () => {
  it('leaves cars alone when they are not touching', () => {
    const v = createVehicleState(0, 0, 0);
    v.vx = 10;
    const events: GameEvent[] = [];
    resolveRivalCollisions(v, [rival({ x: CONTACT + 1 })], events);
    expect(v.x).toBe(0);
    expect(v.vx).toBe(10);
    expect(events).toHaveLength(0);
  });

  it('pushes the local car out of an overlap, and only its own share of it', () => {
    const v = createVehicleState(0, 0, 0);
    const overlap = 0.8;
    const events: GameEvent[] = [];
    // Rival to our right (+x), so we are pushed to the left (-x).
    resolveRivalCollisions(v, [rival({ x: CONTACT - overlap })], events);
    expect(v.x).toBeCloseTo(-overlap * RIVALS.separate, 5);
    // Both clients resolve their own share, so between them they clear the whole overlap.
    expect(RIVALS.separate * 2).toBeGreaterThan(1);
  });

  it('never moves the rival: it belongs to the other client', () => {
    const v = createVehicleState(0, 0, 0);
    v.vx = 14;
    const other = rival({ x: CONTACT - 0.5 });
    const before = { x: other.x, z: other.z, vx: other.vx, vz: other.vz };
    resolveRivalCollisions(v, [other], []);
    expect(other).toMatchObject(before);
  });

  it('costs speed when driving into a rival, and reports the bump', () => {
    const v = createVehicleState(0, 0, 0);
    v.vx = 12;
    const events: GameEvent[] = [];
    resolveRivalCollisions(v, [rival({ x: CONTACT - 0.4 })], events);
    expect(v.vx).toBeLessThan(12);
    expect(v.collided).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'collision' });
  });

  it('does nothing to a car being drafted at the same speed', () => {
    const v = createVehicleState(0, 0, 0);
    v.vx = 30;
    const events: GameEvent[] = [];
    // Overlapping, but with no closing speed at all: separation only, no impulse.
    resolveRivalCollisions(v, [rival({ x: CONTACT - 0.3, vx: 30 })], events);
    expect(v.vx).toBe(30);
    expect(events).toHaveLength(0);
  });

  it('ignores a rival that has gone quiet', () => {
    const v = createVehicleState(0, 0, 0);
    v.vx = 12;
    resolveRivalCollisions(v, [rival({ x: 0, present: false })], []);
    expect(v.x).toBe(0);
    expect(v.vx).toBe(12);
  });

  it('separates two cars that are exactly on top of each other', () => {
    const v = createVehicleState(0, 0, 0);
    resolveRivalCollisions(v, [rival({ x: 0, z: 0 })], []);
    expect(Math.hypot(v.x, v.z)).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------- interpolation */

function wire(overrides: Partial<WireCar> = {}): WireCar {
  return { x: 0, z: 0, h: 0, vx: 0, vz: 0, sp: 0, sa: 0, la: 0, ga: 0, f: 0, ch: 0, ...overrides };
}

describe('rival interpolation', () => {
  const players = [{ id: 'p2', name: 'RIVAL', slot: 1 }];

  it('draws a rival between the two samples that bracket the render time', () => {
    const set = createRivalSet(players);
    set.apply('p2', 1000, wire({ x: 0 }), null);
    set.apply('p2', 1100, wire({ x: 10 }), null);
    // Render time is `now - INTERP_DELAY_MS`; aim it exactly half way between the samples.
    set.update(1050 + INTERP_DELAY_MS, SIM_STEP);
    expect(set.all[0].x).toBeCloseTo(5, 5);
    expect(set.all[0].present).toBe(true);
  });

  it('extrapolates along the last velocity when nothing newer has arrived', () => {
    const set = createRivalSet(players);
    set.apply('p2', 1000, wire({ x: 0, vx: 20 }), null);
    // 100 ms past the newest sample: 20 m/s for 0.1 s is 2 m.
    set.update(1100 + INTERP_DELAY_MS, SIM_STEP);
    expect(set.all[0].x).toBeCloseTo(2, 5);
  });

  it('stops drawing a rival that has gone silent', () => {
    const set = createRivalSet(players);
    set.apply('p2', 1000, wire({ x: 4 }), null);
    set.update(1000 + INTERP_DELAY_MS, SIM_STEP);
    expect(set.all[0].present).toBe(true);
    set.update(1000 + RIVAL_TIMEOUT_MS + 100, SIM_STEP);
    expect(set.all[0].present).toBe(false);
  });

  it('is not present before any state has arrived', () => {
    const set = createRivalSet(players);
    set.update(5000, SIM_STEP);
    expect(set.all[0].present).toBe(false);
  });

  it('unpacks the flags and carries the standing across', () => {
    const set = createRivalSet(players);
    const flags = packCarFlags(true, false, true, false);
    expect(flags).toBe(CAR_FLAG.drifting | CAR_FLAG.braking);
    set.apply('p2', 1000, wire({ f: flags, ch: 0.5 }), { lap: 2, prog: 1.4, lapT: 12, best: 41.2, fin: -1, money: 600 });
    set.update(1000 + INTERP_DELAY_MS, SIM_STEP);
    const car = set.all[0];
    expect(car.drifting).toBe(true);
    expect(car.braking).toBe(true);
    expect(car.nitro).toBe(false);
    expect(car.charge).toBe(0.5);
    expect(car.lap).toBe(2);
    expect(car.progress).toBeCloseTo(1.4, 5);
    expect(car.money).toBe(600);
  });

  it('rolls the wheels from the speed rather than sending them', () => {
    const set = createRivalSet(players);
    set.apply('p2', 1000, wire({ sp: 20 }), null);
    set.update(1000 + INTERP_DELAY_MS, SIM_STEP);
    const first = set.all[0].wheelSpin;
    set.update(1000 + INTERP_DELAY_MS, SIM_STEP);
    expect(set.all[0].wheelSpin).not.toBe(first);
  });

  it('drops a sample the server has already fanned out once', () => {
    // The server snapshots on its own timer, so one client sample can be sent twice with
    // the same arrival stamp. Taking it twice would make the car wait, then jump.
    const set = createRivalSet(players);
    set.apply('p2', 1000, wire({ x: 0, vx: 20 }), null);
    set.apply('p2', 1000, wire({ x: 0, vx: 20 }), null);
    set.apply('p2', 1100, wire({ x: 2, vx: 20 }), null);
    set.update(1050 + INTERP_DELAY_MS, SIM_STEP);
    expect(set.all[0].x).toBeCloseTo(1, 5);
  });

  it('can be re-placed for every rendered frame without rolling the wheels twice', () => {
    const set = createRivalSet(players);
    set.apply('p2', 1000, wire({ x: 0, vx: 20, sp: 20 }), null);
    set.apply('p2', 1100, wire({ x: 2, vx: 20, sp: 20 }), null);
    set.interpolate(1025 + INTERP_DELAY_MS);
    const quarter = set.all[0].x;
    set.interpolate(1075 + INTERP_DELAY_MS);
    expect(set.all[0].x).toBeGreaterThan(quarter);
    expect(set.all[0].wheelSpin).toBe(0);
    set.spin(SIM_STEP);
    expect(set.all[0].wheelSpin).not.toBe(0);
  });

  it('keeps rivals in grid order whatever order the server listed them in', () => {
    const set = createRivalSet([
      { id: 'p4', name: 'THIRD', slot: 3 },
      { id: 'p2', name: 'FIRST', slot: 1 },
    ]);
    expect(set.all.map((r) => r.slot)).toEqual([1, 3]);
  });

  it('ignores state for a player who is not in this match', () => {
    const set = createRivalSet(players);
    expect(() => set.apply('nobody', 1000, wire(), null)).not.toThrow();
    expect(set.get('nobody')).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ traffic */

/** A minimal layout: two electric cars, no patrols, no colliders. */
function trafficLayout(): ArenaLayout {
  return {
    bounds: { minX: -100, maxX: 100, minZ: -100, maxZ: 100 },
    playerSpawn: { x: 0, z: 0, heading: 0 },
    targetSpawns: [
      { x: 10, z: 0, heading: 0 },
      { x: 20, z: 0, heading: 0 },
    ],
    targetPatrols: [],
    cruiseRoute: [],
    colliders: [],
    walls: [],
    surface: null,
    race: null,
    minimap: { bounds: { minX: -100, maxX: 100, minZ: -100, maxZ: 100 }, rects: [], ribbons: [] },
  };
}

/** One car on the wire: x, z, heading, status, then the patrol index and knock velocity. */
type WireTarget = [number, number, number, number, number?, number?, number?];

/** Flat wire form, `TRAFFIC_STRIDE` numbers per car. */
function trafficData(cars: WireTarget[]): number[] {
  const out: number[] = [];
  for (const [x, z, h, status, patrol = 0, vx = 0, vz = 0] of cars) out.push(x, z, h, status, patrol, vx, vz);
  expect(out.length).toBe(cars.length * TRAFFIC_STRIDE);
  return out;
}

const AT = 5000;

describe('traffic reconciliation', () => {
  it('eases a small position error out instead of snapping', () => {
    const layout = trafficLayout();
    const targets: TargetState[] = createTargets(layout);
    const sync = createTrafficSync(targets.length);
    const destroyed: number[] = [];

    sync.apply(targets, trafficData([[11, 0, 0, 0], [20, 0, 0, 0]]), AT, 0, destroyed);
    // The report has not moved the car by itself: the correction is still outstanding.
    expect(targets[0].x).toBe(10);

    sync.correct(targets, SIM_STEP);
    expect(targets[0].x).toBeGreaterThan(10);
    expect(targets[0].x).toBeLessThan(11);

    for (let i = 0; i < 60; i++) sync.correct(targets, SIM_STEP);
    expect(targets[0].x).toBeCloseTo(11, 2);
  });

  it('snaps an error too large to hide', () => {
    const layout = trafficLayout();
    const targets = createTargets(layout);
    const sync = createTrafficSync(targets.length);
    sync.apply(targets, trafficData([[60, 0, 0, 0], [20, 0, 0, 0]]), AT, 0, []);
    expect(targets[0].x).toBe(60);
  });

  it('compares a report with where the local copy was when it was taken, not where it is now', () => {
    // Two copies of one deterministic car, one report a whole 200 ms late: no error at all.
    const layout = trafficLayout();
    const targets = createTargets(layout);
    const sync = createTrafficSync(targets.length);
    const speed = 6; // m/s along +x, driven by hand since this layout has no patrol
    let serverNow = AT;
    for (let tick = 0; tick < 30; tick++) {
      targets[0].x += speed * SIM_STEP;
      serverNow += SIM_STEP * 1000;
      sync.record(targets, serverNow);
    }
    // The host's car 200 ms ago: 12 ticks back, i.e. 18 ticks of travel from the spawn.
    const hostThen = 10 + speed * SIM_STEP * 18;
    const then = AT + SIM_STEP * 1000 * 18;
    const before = targets[0].x;
    sync.apply(targets, trafficData([[hostThen, 0, 0, 0], [20, 0, 0, 0]]), then, 0.5, []);
    sync.correct(targets, SIM_STEP);
    expect(targets[0].x).toBeCloseTo(before, 6);

    // Whereas a host copy that really was a metre ahead at that time is a metre of error.
    sync.apply(targets, trafficData([[hostThen + 1, 0, 0, 0], [20, 0, 0, 0]]), then, 0.5, []);
    for (let i = 0; i < 90; i++) sync.correct(targets, SIM_STEP);
    expect(targets[0].x).toBeCloseTo(before + 1, 2);
  });

  it('carries a snap forward by however far the local copy has moved since the report', () => {
    const layout = trafficLayout();
    const targets = createTargets(layout);
    const sync = createTrafficSync(targets.length);
    sync.record(targets, AT);
    targets[0].x += 3; // moved on since
    sync.apply(targets, trafficData([[50, 0, 0, 0], [20, 0, 0, 0]]), AT, 0, []);
    expect(targets[0].x).toBe(53);
  });

  it('takes the host patrol index and knock velocity, allowing one waypoint of lag', () => {
    const layout = trafficLayout();
    const targets = createTargets(layout);
    const sync = createTrafficSync(targets.length);
    targets[0].patrolIndex = 4;
    // One ahead of a report from the past is fine...
    sync.apply(targets, trafficData([[10, 0, 0, 0, 3, 2, 0], [20, 0, 0, 0]]), AT, 0, []);
    expect(targets[0].patrolIndex).toBe(4);
    expect(targets[0].vx).toBe(2);
    // ...anything else is a desync and the host wins.
    sync.apply(targets, trafficData([[10, 0, 0, 0, 9, 0, 0], [20, 0, 0, 0]]), AT, 0, []);
    expect(targets[0].patrolIndex).toBe(9);
    sync.apply(targets, trafficData([[10, 0, 0, 0, 2, 0, 0], [20, 0, 0, 0]]), AT, 0, []);
    expect(targets[0].patrolIndex).toBe(2);
  });

  it('applies the host kill and names it so the caller can play the explosion', () => {
    const layout = trafficLayout();
    const targets = createTargets(layout);
    const sync = createTrafficSync(targets.length);
    const destroyed: number[] = [];
    sync.apply(targets, trafficData([[10, 0, 0, 1], [20, 0, 0, 0]]), AT, 3.5, destroyed);
    expect(targets[0].status).toBe('destroyed');
    expect(targets[0].hitTime).toBe(3.5);
    expect(destroyed).toEqual([0]);
    // Somebody else's kill must not also pay this client.
    expect(targets[0].rewarded).toBe(true);
  });

  it('does not report the same kill twice', () => {
    const layout = trafficLayout();
    const targets = createTargets(layout);
    const sync = createTrafficSync(targets.length);
    const first: number[] = [];
    const second: number[] = [];
    sync.apply(targets, trafficData([[10, 0, 0, 1], [20, 0, 0, 0]]), AT, 1, first);
    sync.apply(targets, trafficData([[10, 0, 0, 1], [20, 0, 0, 0]]), AT, 1.1, second);
    expect(first).toEqual([0]);
    expect(second).toEqual([]);
  });

  it('teleports a car back onto its respawn rather than sliding it there', () => {
    const layout = trafficLayout();
    const targets = createTargets(layout);
    const sync = createTrafficSync(targets.length);
    sync.apply(targets, trafficData([[10, 0, 0, 1], [20, 0, 0, 0]]), AT, 1, []);
    sync.apply(targets, trafficData([[42, 7, 1, 0, 5], [20, 0, 0, 0]]), AT, 9, []);
    expect(targets[0].status).toBe('active');
    expect(targets[0].x).toBe(42);
    expect(targets[0].z).toBe(7);
    expect(targets[0].patrolIndex).toBe(5);
    expect(targets[0].rewarded).toBe(false);
  });

  it('keeps a kill made here until the host agrees, then stops holding', () => {
    const layout = trafficLayout();
    const targets = createTargets(layout);
    const sync = createTrafficSync(targets.length);
    // Lightning fired here: dead at once, and the host is told.
    targets[0].status = 'destroyed';
    targets[0].hitTime = 2;
    sync.claimKill(0, 2, 1.5);
    // The host's next report has not caught up: still alive over there.
    sync.apply(targets, trafficData([[10, 0, 0, 0], [20, 0, 0, 0]]), AT, 2.1, []);
    expect(targets[0].status).toBe('destroyed');
    // Then it agrees. Nothing to explode: it was already dead here.
    const destroyed: number[] = [];
    sync.apply(targets, trafficData([[10, 0, 0, 1], [20, 0, 0, 0]]), AT, 2.3, destroyed);
    expect(destroyed).toEqual([]);
    // With the hold released, the host's eventual respawn is taken as normal.
    sync.apply(targets, trafficData([[30, 0, 0, 0], [20, 0, 0, 0]]), AT, 14, []);
    expect(targets[0].status).toBe('active');
    expect(targets[0].x).toBe(30);
  });

  it('gives up a kill the host never agreed with once the hold runs out', () => {
    const layout = trafficLayout();
    const targets = createTargets(layout);
    const sync = createTrafficSync(targets.length);
    targets[0].status = 'destroyed';
    sync.claimKill(0, 2, 1.5);
    sync.apply(targets, trafficData([[10, 0, 0, 0], [20, 0, 0, 0]]), AT, 3.4, []);
    expect(targets[0].status).toBe('destroyed');
    sync.apply(targets, trafficData([[10, 0, 0, 0], [20, 0, 0, 0]]), AT, 3.6, []);
    expect(targets[0].status).toBe('active');
  });

  it('lets a shove made here play out before the host reports catch up', () => {
    const layout = trafficLayout();
    const targets = createTargets(layout);
    const sync = createTrafficSync(targets.length);
    targets[0].x = 14; // shoved 4 m
    targets[0].vx = 20;
    sync.claimBump(0, 1, 0.4);
    sync.apply(targets, trafficData([[10, 0, 0, 0, 0, 0, 0], [20, 0, 0, 0]]), AT, 1.1, []);
    sync.correct(targets, SIM_STEP);
    expect(targets[0].x).toBe(14);
    expect(targets[0].vx).toBe(20);
    // Hold over: the host copy — which has the shove by now — is followed again.
    sync.apply(targets, trafficData([[15, 0, 0, 0, 0, 12, 0], [20, 0, 0, 0]]), AT, 1.5, []);
    expect(targets[0].vx).toBe(12);
  });

  it('applies a claimed kill on the host, once', () => {
    const layout = trafficLayout();
    const targets = createTargets(layout);
    const sync = createTrafficSync(targets.length);
    expect(sync.destroy(targets, 1, 2)).toBe(true);
    expect(targets[1].status).toBe('destroyed');
    expect(sync.destroy(targets, 1, 2)).toBe(false);
    expect(sync.destroy(targets, 99, 2)).toBe(false);
  });

  it('applies a reported shove on the host, fast-forwarded by the time it spent in transit', () => {
    const layout = trafficLayout();
    const targets = createTargets(layout);
    const sync = createTrafficSync(targets.length);
    expect(sync.bump(targets, 0, 10, 0, 0.1)).toBe(true);
    // A metre along already, and the knock is what is left after 100 ms of decay.
    expect(targets[0].x).toBeCloseTo(11, 6);
    expect(targets[0].vx).toBeCloseTo(10 * (1 - TARGETS.knock.damping * 0.1), 6);
    targets[1].status = 'destroyed';
    expect(sync.bump(targets, 1, 10, 0, 0)).toBe(false);
    expect(sync.bump(targets, 7, 10, 0, 0)).toBe(false);
  });

  it('leaves an already-agreeing car untouched while it keeps patrolling', () => {
    const layout = trafficLayout();
    const targets = createTargets(layout);
    const sync = createTrafficSync(targets.length);
    sync.apply(targets, trafficData([[10, 0, 0, 0], [20, 0, 0, 0]]), AT, 0, []);
    stepTargets(targets, layout, 0, SIM_STEP);
    const x = targets[0].x;
    sync.correct(targets, SIM_STEP);
    expect(targets[0].x).toBe(x);
  });
});

describe('electric cars off the patrol', () => {
  it('stay destroyed for a client that leaves respawning to the host', () => {
    const layout = trafficLayout();
    const targets = createTargets(layout);
    targets[0].status = 'destroyed';
    targets[0].hitTime = 0;
    stepTargets(targets, layout, TARGETS.respawnDelay + 1, SIM_STEP, false);
    expect(targets[0].status).toBe('destroyed');
    stepTargets(targets, layout, TARGETS.respawnDelay + 1, SIM_STEP, true);
    expect(targets[0].status).toBe('active');
  });

  it('are stopped by a guardrail when shoved, instead of leaving the circuit', () => {
    const layout = trafficLayout();
    // A wall across the car's path, two metres ahead.
    layout.walls.push({ ax: 12, az: -5, bx: 12, bz: 5, tag: 'rail' });
    const targets = createTargets(layout);
    targets[0].vx = 40;
    for (let i = 0; i < 60; i++) stepTargets(targets, layout, 0, SIM_STEP);
    expect(targets[0].x).toBeLessThan(12);
    expect(targets[0].vx).toBeLessThanOrEqual(0);
  });

  it('name the car and the knock when the player shoves one', () => {
    const layout = trafficLayout();
    const targets = createTargets(layout);
    const v = createVehicleState(10 - VEHICLE.collisionRadius - TARGETS.knock.radius + 0.3, 0, Math.PI / 2);
    v.vx = 15;
    const events: GameEvent[] = [];
    resolveTargetCollisions(v, targets, events);
    const bump = events.find((e) => e.type === 'collision');
    expect(bump).toBeDefined();
    if (bump && bump.type === 'collision') {
      expect(bump.targetId).toBe(0);
      expect(bump.knockX).toBeGreaterThan(0);
      expect(targets[0].vx).toBeCloseTo(bump.knockX ?? 0, 6);
    }
  });
});

/* ---------------------------------------------------------------- standings */

function row(name: string, progress: number, extra: Partial<StandingsRow> = {}): StandingsRow {
  return { name, slot: 0, progress, gap: 0, self: false, finished: false, finishTime: -1, ...extra };
}

describe('classification', () => {
  const LAP = 1400;

  it('puts the car that is furthest round in front', () => {
    const order = [row('ME', 0.113), row('RIVAL', 0.14)];
    rankStandings(order, LAP);
    expect(order.map((r) => r.name)).toEqual(['RIVAL', 'ME']);
  });

  it('measures the gap along the lap, and gives the leader none', () => {
    const order = [row('ME', 0.113), row('RIVAL', 0.14)];
    rankStandings(order, LAP);
    expect(order[0].gap).toBe(0);
    expect(order[1].gap).toBeCloseTo(0.027 * LAP, 5);
  });

  it('keeps ranking correctly once the array has already been reordered', () => {
    // The regression: the ranked array used to be the same one whose index said which row
    // belonged to which player, so after the first sort every car was fed somebody else's
    // progress. Ranking twice has to stay stable.
    const me = row('ME', 0.113, { self: true });
    const rival = row('RIVAL', 0.14);
    const order = [me, rival];
    rankStandings(order, LAP);
    me.progress = 0.5;
    rival.progress = 0.4;
    rankStandings(order, LAP);
    expect(order.map((r) => r.name)).toEqual(['ME', 'RIVAL']);
    expect(order[1].gap).toBeCloseTo(0.1 * LAP, 5);
  });

  it('puts a finisher ahead of a car still running, however far round it is', () => {
    const order = [row('RUNNING', 1.99), row('HOME', 2, { finished: true, finishTime: 92 })];
    rankStandings(order, LAP);
    expect(order.map((r) => r.name)).toEqual(['HOME', 'RUNNING']);
  });

  it('ranks finishers by time, not by progress', () => {
    const order = [
      row('SLOW', 2, { finished: true, finishTime: 95 }),
      row('FAST', 2, { finished: true, finishTime: 88 }),
    ];
    rankStandings(order, LAP);
    expect(order.map((r) => r.name)).toEqual(['FAST', 'SLOW']);
  });

  it('does nothing to an empty field', () => {
    expect(() => rankStandings([], LAP)).not.toThrow();
  });
});

/* ------------------------------------------------------------------ colours */

describe('player colours', () => {
  it('gives every grid slot its own colour', () => {
    const used = new Set(SLOT_COLORS.map((_, i) => slotColor(i)));
    expect(used.size).toBe(SLOT_COLORS.length);
  });

  it('wraps rather than failing on a slot outside the grid', () => {
    expect(slotColor(SLOT_COLORS.length)).toBe(slotColor(0));
    expect(slotColor(-1)).toBe(slotColor(SLOT_COLORS.length - 1));
  });

  it('renders as a six-digit CSS hex', () => {
    expect(slotCss(0)).toMatch(/^#[0-9a-f]{6}$/);
  });
});
