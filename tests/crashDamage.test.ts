import { describe, expect, it } from 'vitest';
import { CRASH_DAMAGE, RUSH, TARGETS } from '../src/config/tuning';
import { crashSeverity, crashStalled, createCrashDamageState, stallSeconds, stepCrashDamage } from '../src/sim/crashDamage';
import { createFlairState, stepFlair } from '../src/sim/flair';
import { resolveTargetCollisions } from '../src/sim/collision';
import { createInitialGameState, createVehicleState, stepGame } from '../src/sim/gameState';
import { createOpenWorld } from '../src/world/openWorld';
import { createCircuitWorld } from '../src/world/circuitWorld';
import { createRushWorld } from '../src/world/rushWorld';
import { beginRush } from '../src/sim/rush';

import type { ArenaLayout } from '../src/core/types';
import type { CityPlan } from '../src/world/cityPlan';
import type { CrashDamageState, DriftState, EconomyState, GameEvent, PlayerCommand, TargetState } from '../src/core/types';

/**
 * Crash damage (`src/sim/crashDamage.ts`): a real crash costs money, the AURA line and a marked
 * car until the garage — once per accident, never below zero, and never a slower car.
 */

const DT = 1 / 60;
const T = CRASH_DAMAGE.tiers;
const idle: PlayerCommand = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false, fire: false, restart: false, cruise: false, pov: false, shiftUp: false, shiftDown: false, transmission: false, activate: false };

function wall(impact: number, closing?: number): GameEvent {
  return { type: 'collision', x: 1, y: 0, z: 2, impact, closing };
}

function rig(money = 1000, stall = false) {
  const s: CrashDamageState = createCrashDamageState();
  const economy: EconomyState = { money, destroyed: 0, lastReward: 0 };
  const charges: Extract<GameEvent, { type: 'crashDamage' }>[] = [];
  const stalls: Extract<GameEvent, { type: 'crashStall' }>[] = [];
  let time = 0;
  /** One tick with `incoming` collisions (and whatever else), at the garage or not. */
  function tick(incoming: GameEvent[] = [], atGarage = false, enabled = true): GameEvent[] {
    const events = [...incoming];
    time += DT;
    stepCrashDamage(s, economy, { enabled, atGarage, stall }, time, DT, events);
    for (const ev of events) {
      if (ev.type === 'crashDamage') charges.push(ev);
      if (ev.type === 'crashStall') stalls.push(ev);
    }
    return events;
  }
  function run(seconds: number, each: () => GameEvent[] = () => []): void {
    for (let i = 0, n = Math.round(seconds / DT); i < n; i++) tick(each());
  }
  return { s, economy, charges, stalls, tick, run };
}

describe('crash severity', () => {
  it('lets a touch go and sorts real hits into three tiers', () => {
    expect(crashSeverity(T.light.impact - 0.01)).toBeNull();
    expect(crashSeverity(T.light.impact)).toBe('light');
    expect(crashSeverity(T.medium.impact)).toBe('medium');
    expect(crashSeverity(T.heavy.impact + 20)).toBe('heavy');
    expect([T.light.fine, T.medium.fine, T.heavy.fine]).toEqual([50, 150, 300]);
  });

  it('charges each tier its fine, once, and marks the car', () => {
    for (const [speed, fine] of [[T.light.impact + 0.5, 50], [T.medium.impact + 0.5, 150], [T.heavy.impact + 0.5, 300]]) {
      const r = rig();
      r.tick([wall(speed)]);
      expect(r.charges).toHaveLength(1);
      expect(r.economy.money).toBe(1000 - fine);
      expect(r.charges[0]).toMatchObject({ fine, charged: fine, balance: 1000 - fine, aura: 1000 });
      expect(r.s.marks).toBeGreaterThan(0);
    }
  });

  it('never takes a scrape, and never takes the balance below zero', () => {
    const r = rig();
    r.run(3, () => [wall(T.light.impact - 1)]);
    expect(r.charges).toHaveLength(0);
    expect(r.s.marks).toBe(0);

    const broke = rig(40);
    broke.tick([wall(T.medium.impact + 1)]);
    expect(broke.charges[0]).toMatchObject({ fine: 150, charged: 40, balance: 0 });
    expect(broke.economy.money).toBe(0);
    broke.run(3);
    broke.tick([wall(T.heavy.impact + 1)]);
    expect(broke.economy.money).toBe(0);
    expect(broke.charges[1]).toMatchObject({ charged: 0, balance: 0 });
  });

  it('judges a bump on a moving car by the closing speed, not the player speed', () => {
    const r = rig();
    r.tick([wall(30, 3)]);
    expect(r.charges).toHaveLength(0);
  });
});

describe('one accident, one charge', () => {
  it('charges a car ground along a wall once, however long it grinds', () => {
    const r = rig();
    r.tick([wall(T.medium.impact + 1)]);
    // Three seconds of contact that would be a light crash on its own, every tick.
    r.run(3, () => [wall(T.light.impact + 2)]);
    expect(r.charges).toHaveLength(1);
    expect(r.s.latched).toBe(true);
  });

  it('charges again once the car has come off and hits something new', () => {
    const r = rig();
    r.tick([wall(T.light.impact + 1)]);
    r.run(CRASH_DAMAGE.cooldownSeconds + CRASH_DAMAGE.separationSeconds);
    expect(r.s.latched).toBe(false);
    r.tick([wall(T.light.impact + 1)]);
    expect(r.charges).toHaveLength(2);
  });

  it('holds the cooldown even when the car bounced clear', () => {
    const r = rig();
    r.tick([wall(T.heavy.impact + 1)]);
    r.run(CRASH_DAMAGE.separationSeconds + 0.1);
    expect(r.s.latched).toBe(false);
    r.tick([wall(T.heavy.impact + 1)]);
    expect(r.charges).toHaveLength(1);
  });

  it('counts a new hard hit while still touching, once the cooldown is over', () => {
    const r = rig();
    r.tick([wall(T.light.impact + 1)]);
    r.run(CRASH_DAMAGE.cooldownSeconds + 0.1, () => [wall(2)]);
    r.tick([wall(T.light.impact + 2)]);
    expect(r.charges).toHaveLength(1);
    r.tick([wall(CRASH_DAMAGE.stillTouchingImpact + 1)]);
    expect(r.charges).toHaveLength(2);
  });

  it('charges nothing while switched off (the intro)', () => {
    const r = rig();
    r.tick([wall(T.heavy.impact + 1)], false, false);
    expect(r.charges).toHaveLength(0);
    expect(r.economy.money).toBe(1000);
    expect(r.s.marks).toBe(0);
  });
});

describe('the garage', () => {
  it('washes the car for free', () => {
    const r = rig();
    r.tick([wall(T.heavy.impact + 1)]);
    expect(r.s.heavy).toBe(true);
    const money = r.economy.money;
    const version = r.s.version;
    const events = r.tick([], true);
    expect(events.map((e) => e.type)).toEqual(['crashRepaired']);
    expect(r.s).toMatchObject({ marks: 0, heavy: false });
    expect(r.s.version).toBeGreaterThan(version);
    expect(r.economy.money).toBe(money);
    // Already clean: nothing more to say.
    expect(r.tick([], true)).toHaveLength(0);
  });
});

describe('in a race', () => {
  const R = CRASH_DAMAGE.race;

  it('lets a light crash go, and stalls medium and heavy ones for 2 to 5 seconds', () => {
    expect(stallSeconds('medium', T.medium.impact)).toBe(R.mediumStall);
    expect(stallSeconds('heavy', T.heavy.impact)).toBeCloseTo(R.heavyStall[0]);
    expect(stallSeconds('heavy', 80)).toBeCloseTo(R.heavyStall[1]);
    expect(R.mediumStall).toBeGreaterThanOrEqual(2);
    expect(R.heavyStall[1]).toBeLessThanOrEqual(5);

    const light = rig(1000, true);
    light.tick([wall(T.light.impact + 1)]);
    expect(light.stalls).toHaveLength(0);
    expect(light.s.stall).toBe(0);

    const hard = rig(1000, true);
    hard.tick([wall(T.medium.impact + 1)]);
    expect(hard.stalls).toHaveLength(1);
    expect(hard.stalls[0].seconds).toBe(R.mediumStall);
    expect(crashStalled(hard.s)).toBe(true);
    // No fine, no marks, no AURA: races cost time.
    expect(hard.charges).toHaveLength(0);
    expect(hard.economy.money).toBe(1000);
    expect(hard.s.marks).toBe(0);
    hard.run(R.mediumStall + 0.05);
    expect(crashStalled(hard.s)).toBe(false);
  });

  it('holds the car on the circuit while stalled, and lets it go after', () => {
    const { layout } = createCircuitWorld(7);
    const state = createInitialGameState(layout);
    expect(state.crash).not.toBeNull();
    state.race!.phase = 'racing';
    state.crash!.stall = state.crash!.stallSeconds = 2;
    const floor: PlayerCommand = { ...idle, throttle: 1, nitro: true };
    for (let i = 0; i < Math.round(1.9 / DT); i++) stepGame(state, floor, layout, DT);
    expect(Math.abs(state.vehicle.speed)).toBeLessThan(0.5);
    for (let i = 0; i < Math.round(1.5 / DT); i++) stepGame(state, floor, layout, DT);
    expect(crashStalled(state.crash)).toBe(false);
    expect(state.vehicle.speed).toBeGreaterThan(3);
  });

  it('never stacks a second stall on the first, nor on the car pulling away', () => {
    const r = rig(1000, true);
    r.tick([wall(T.heavy.impact + 1)]);
    const seconds = r.s.stall;
    // Hit again and again while stalled, and just after, once clear of the wall each time.
    r.run(seconds + R.graceSeconds - 0.1, () => [wall(T.heavy.impact + 5)]);
    expect(r.stalls).toHaveLength(1);
    r.run(CRASH_DAMAGE.separationSeconds + 0.1);
    r.tick([wall(T.heavy.impact + 1)]);
    expect(r.stalls).toHaveLength(2);
  });
});

describe('the streak and the line', () => {
  it('cuts the flair streak and says AURA −1000 over the fine, run or no run', () => {
    const f = createFlairState();
    const drift: DriftState = { active: true, duration: 3, candidateTime: 0, lapseTime: 0, chain: 2, chainWindow: 0, chargeRate: 0 };
    const events: GameEvent[] = [];
    // A streak under way...
    stepFlair(f, drift, true, 1, DT, events, 0, false);
    expect(f.streak).toBe(true);
    // ...and a charged crash with no run on.
    drift.active = false;
    events.length = 0;
    stepFlair(f, drift, false, 1.1, DT, events, 0, true);
    expect(f.streak).toBe(false);
    const line = events.find((e) => e.type === 'flair');
    expect(line).toMatchObject({ id: 'auraMenos', text: '−1000 DE AURA', tier: 'crash', seconds: CRASH_DAMAGE.cardSeconds });
    // A hard hit the crash rules did NOT charge says nothing when they are the judge.
    events.length = 0;
    const hit: GameEvent[] = [wall(40)];
    stepFlair(f, drift, true, 9, DT, hit, 1, false);
    expect(hit.filter((e) => e.type === 'flair')).toHaveLength(0);
  });

  it('works out the closing speed on a car driving away from the bumper', () => {
    const v = createVehicleState(0, 0, 0);
    v.vz = -24; // north, 24 m/s
    const target = {
      id: 0, x: 0, z: -2, y: 0, heading: 0, prevX: 0, prevZ: -2, prevY: 0, prevHeading: 0,
      vx: 0, vz: 0, status: 'active', hitTime: -1, patrolIndex: 0, patrolSpeed: 20, speed: 20, rewarded: false,
    } as TargetState;
    const events: GameEvent[] = [];
    resolveTargetCollisions(v, [target], events);
    const ev = events[0] as Extract<GameEvent, { type: 'collision' }>;
    expect(ev.impact).toBeGreaterThan(TARGETS.knock.minImpact);
    expect(ev.closing).toBeCloseTo(4, 5);
  });
});

/** Park the car 3 m short of a tall building face with open road in front, doing 22 m/s at it. */
function aimAtWall(layout: ArenaLayout, plan: CityPlan, v: ReturnType<typeof createVehicleState>): void {
  const box = layout.colliders.find((b) => {
    if (b.minY !== undefined || b.maxY !== undefined || b.maxZ - b.minZ < 8) return false;
    const x = b.minX - 3;
    const z = (b.minZ + b.maxZ) / 2;
    return plan.isRoad(x, z) && !layout.colliders.some((o) => o !== b && x > o.minX - 2 && x < o.maxX + 2 && z > o.minZ - 2 && z < o.maxZ + 2);
  })!;
  expect(box).toBeTruthy();
  v.x = v.prevX = box.minX - 3;
  v.z = v.prevZ = (box.minZ + box.maxZ) / 2;
  v.heading = v.prevHeading = Math.PI / 2;
  v.vx = 22;
  v.speed = 22;
}

describe('in a RAYO RUSH run', () => {
  it('takes the crash off the score in the city, on top of the fine', () => {
    const { layout, plan } = createOpenWorld();
    const state = createInitialGameState(layout);
    state.economy.money = 500;
    beginRush(state.rush!, 0, state.events);
    state.rush!.score = 1000;
    aimAtWall(layout, plan, state.vehicle);
    const seen: GameEvent[] = [];
    for (let i = 0; i < 90; i++) {
      stepGame(state, idle, layout, DT);
      seen.push(...state.events);
    }
    expect(seen.filter((e) => e.type === 'crashDamage')).toHaveLength(1);
    expect(seen.filter((e) => e.type === 'rushCrash')).toHaveLength(1);
    expect(state.rush!.score).toBe(1000 - RUSH.scoring.crashPenalty.heavy);
  });

  it('judges crashes in RAYO RUSH on its own without fining or marking the car', () => {
    const { layout, plan } = createRushWorld();
    const state = createInitialGameState(layout);
    expect(state.crash).not.toBeNull();
    state.economy.money = 500;
    beginRush(state.rush!, 0, state.events);
    state.rush!.score = 1000;
    aimAtWall(layout, plan, state.vehicle);
    const seen: GameEvent[] = [];
    for (let i = 0; i < 90; i++) {
      stepGame(state, idle, layout, DT);
      seen.push(...state.events);
    }
    expect(seen.some((e) => e.type === 'crashDamage')).toBe(false);
    expect(seen.filter((e) => e.type === 'rushCrash')).toHaveLength(1);
    expect(state.rush!.score).toBe(1000 - RUSH.scoring.crashPenalty.heavy);
    expect(state.economy.money).toBe(500);
    expect(state.crash!.marks).toBe(0);
  });
});

describe('in the open world', () => {

  it('charges a real wall hit once, says the line and cuts the drift chain', () => {
    const { layout, plan } = createOpenWorld();
    const state = createInitialGameState(layout);
    expect(state.crash).not.toBeNull();
    state.economy.money = 500;
    // A tall building face with open road in front of it.
    const box = layout.colliders.find((b) => {
      if (b.minY !== undefined || b.maxY !== undefined || b.maxZ - b.minZ < 8) return false;
      const x = b.minX - 3;
      const z = (b.minZ + b.maxZ) / 2;
      return plan.isRoad(x, z) && !layout.colliders.some((o) => o !== b && x > o.minX - 2 && x < o.maxX + 2 && z > o.minZ - 2 && z < o.maxZ + 2);
    })!;
    expect(box).toBeTruthy();
    const v = state.vehicle;
    v.x = v.prevX = box.minX - 3;
    v.z = v.prevZ = (box.minZ + box.maxZ) / 2;
    v.heading = v.prevHeading = Math.PI / 2; // east, into the face
    v.vx = 22;
    v.speed = 22;
    state.drift.chain = 3;
    state.drift.chainWindow = 1;

    const seen: GameEvent[] = [];
    for (let i = 0; i < 90; i++) {
      stepGame(state, idle, layout, DT);
      seen.push(...state.events);
    }
    const charges = seen.filter((e) => e.type === 'crashDamage');
    expect(charges).toHaveLength(1);
    expect(charges[0]).toMatchObject({ severity: 'heavy', charged: 300, balance: 200 });
    expect(state.economy.money).toBe(200);
    expect(seen.some((e) => e.type === 'flair' && e.id === 'auraMenos')).toBe(true);
    expect(state.drift.chain).toBe(0);
    expect(state.crash!.marks).toBe(CRASH_DAMAGE.tiers.heavy.marks);
  });
});
