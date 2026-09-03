import { describe, expect, it } from 'vitest';
import { NEAR_MISS, VEHICLE, TARGETS } from '../src/config/tuning';
import {
  createNearMissState,
  nearMissPoints,
  nearMissQuality,
  resetNearMissState,
  stepNearMiss,
  sweptMinDistance,
} from '../src/sim/nearMiss';
import { createInitialGameState, createVehicleState, stepGame } from '../src/sim/gameState';
import { createArenaLayout } from '../src/world/arenaLayout';
import { createPlayerCommand } from '../src/core/input/keyboard';
import type { GameEvent, TargetState, VehicleState } from '../src/core/types';

function makeTarget(id: number, x: number, z: number, status: TargetState['status'] = 'active'): TargetState {
  return { id, x, z, heading: 0, prevX: x, prevZ: z, prevHeading: 0, vx: 0, vz: 0, status, hitTime: -1, patrolIndex: 0, patrolSpeed: 0, rewarded: false };
}

/** Moves the car to (x, z) with the given world velocity, keeping prev* as the last pose. */
function place(v: VehicleState, x: number, z: number, vx: number, vz: number): void {
  v.prevX = v.x;
  v.prevZ = v.z;
  v.x = x;
  v.z = z;
  v.vx = vx;
  v.vz = vz;
}

/**
 * Drives the car straight down +X past a target parked at (0, `offset`) and returns the
 * near-miss events produced, each tagged with how far past the target the car was when it
 * fired (negative = still short of it).
 */
function driveBy(offset: number, speed: number, targets = [makeTarget(0, 0, 0)]) {
  const n = createNearMissState(targets.length);
  const v = createVehicleState(-12, offset, Math.PI / 2);
  const events: GameEvent[] = [];
  const hits: Array<{ event: Extract<GameEvent, { type: 'nearMiss' }>; carX: number }> = [];
  const dt = 1 / 60;
  for (let i = 0; i < 240 && v.x < 12; i++) {
    place(v, v.x + speed * dt, offset, speed, 0);
    const before = events.length;
    stepNearMiss(n, v, targets, events);
    for (let e = before; e < events.length; e++) {
      const ev = events[e];
      if (ev.type === 'nearMiss') hits.push({ event: ev, carX: v.x });
    }
  }
  return hits;
}

describe('nearMissPoints', () => {
  it('pays nothing below the minimum speed, however close the pass', () => {
    expect(nearMissPoints(NEAR_MISS.contactDist + 0.05, NEAR_MISS.minSpeed - 0.1)).toBe(0);
  });

  it('pays nothing for a pass that never entered the radius', () => {
    expect(nearMissPoints(NEAR_MISS.radius, 50)).toBe(0);
    expect(nearMissPoints(NEAR_MISS.radius + 3, 50)).toBe(0);
  });

  it('pays at least the floor and never more than the ceiling', () => {
    for (let d = NEAR_MISS.contactDist; d < NEAR_MISS.radius; d += 0.05) {
      for (let sp = NEAR_MISS.minSpeed; sp < 70; sp += 2) {
        const p = nearMissPoints(d, sp);
        expect(p).toBeGreaterThanOrEqual(NEAR_MISS.minPoints);
        expect(p).toBeLessThanOrEqual(NEAR_MISS.maxPoints);
      }
    }
  });

  it('grows with closeness and with speed', () => {
    expect(nearMissPoints(2.4, 45)).toBeGreaterThan(nearMissPoints(3.4, 45));
    expect(nearMissPoints(2.4, 45)).toBeGreaterThan(nearMissPoints(2.4, 30));
  });

  it('reaches the ceiling only for a graze above the un-boosted top speed', () => {
    // A comfortable pass at speed is worth having but nowhere near the ceiling.
    expect(nearMissPoints(3, VEHICLE.maxSpeed)).toBeLessThan(NEAR_MISS.maxPoints / 2);
    // Even scraping paint at the un-boosted top speed does not max out: nitro is required.
    expect(nearMissPoints(NEAR_MISS.contactDist + 0.02, VEHICLE.maxSpeed)).toBeLessThan(NEAR_MISS.maxPoints);
    // Both at once does.
    expect(nearMissPoints(NEAR_MISS.contactDist + 0.02, NEAR_MISS.fullSpeed)).toBe(NEAR_MISS.maxPoints);
  });

  it('maps points onto a 0..1 quality for presentation', () => {
    expect(nearMissQuality(NEAR_MISS.minPoints)).toBe(0);
    expect(nearMissQuality(NEAR_MISS.maxPoints)).toBe(1);
    expect(nearMissQuality(0)).toBe(0);
  });
});

describe('sweptMinDistance', () => {
  it('finds the closest approach inside the tick, not just at its ends', () => {
    // Car crosses x = 0 during the tick, one metre to the side of a parked target.
    const d = sweptMinDistance(-3, 1, 3, 1, 0, 0, 0, 0);
    expect(d).toBeCloseTo(1, 6);
  });

  it('falls back to the endpoints when the pair is only separating', () => {
    expect(sweptMinDistance(0, 0, 0, 0, 2, 0, 5, 0)).toBeCloseTo(2, 6);
  });

  it('handles two points that do not move', () => {
    expect(sweptMinDistance(0, 0, 0, 0, 3, 4, 3, 4)).toBeCloseTo(5, 6);
  });
});

describe('stepNearMiss', () => {
  it('scores one event when the car passes a target closely at speed', () => {
    const hits = driveBy(2.6, 45);
    expect(hits.length).toBe(1);
    const hit = hits[0].event;
    expect(hit.targetId).toBe(0);
    expect(hit.points).toBeGreaterThan(NEAR_MISS.minPoints);
    expect(hit.points).toBeLessThanOrEqual(NEAR_MISS.maxPoints);
    expect(hit.quality).toBeGreaterThan(0);
  });

  it('fires at the apex, while the shaved car is still alongside', () => {
    // The pop has to land next to the car, so the award cannot wait for the exit radius:
    // by then the target is metres behind the camera.
    const hits = driveBy(2.6, 45);
    expect(hits.length).toBe(1);
    // The target sits at x = 0. One tick at 45 m/s is 0.75 m, so allow a couple of ticks.
    expect(hits[0].carX).toBeLessThan(2);
    expect(hits[0].carX).toBeGreaterThan(0);
    // And the pop is placed on the target, not on the player.
    expect(hits[0].event.x).toBe(0);
  });

  it('pays an approach only once, even while the player lingers inside the radius', () => {
    const targets = [makeTarget(0, 0, 0)];
    const n = createNearMissState(1);
    const v = createVehicleState(-12, 2.6, Math.PI / 2);
    const events: GameEvent[] = [];
    // In past the target, then stop dead just outside it and idle there.
    for (let i = 0; i < 40; i++) {
      place(v, v.x + 45 / 60, 2.6, 45, 0);
      stepNearMiss(n, v, targets, events);
      if (v.x > 1) break;
    }
    for (let i = 0; i < 120; i++) {
      place(v, v.x, 2.6, 0, 0);
      stepNearMiss(n, v, targets, events);
    }
    expect(events.filter((e) => e.type === 'nearMiss').length).toBe(1);
  });

  it('does not score a pass that stays outside the radius', () => {
    expect(driveBy(NEAR_MISS.radius + 0.5, 45).length).toBe(0);
  });

  it('does not score a slow pass', () => {
    expect(driveBy(2.6, NEAR_MISS.minSpeed - 2).length).toBe(0);
  });

  it('voids the pass when the cars touch', () => {
    // Straight through the middle of the target: the proxies overlap, so it is a bump.
    expect(driveBy(VEHICLE.collisionRadius + TARGETS.knock.radius - 0.3, 45).length).toBe(0);
  });

  it('scores each target of a gate separately', () => {
    const gate = [makeTarget(0, 0, 2.6), makeTarget(1, 0, -2.6)];
    const n = createNearMissState(gate.length);
    const v = createVehicleState(-12, 0, Math.PI / 2);
    const events: GameEvent[] = [];
    for (let i = 0; i < 200 && v.x < 12; i++) {
      place(v, v.x + 45 / 60, 0, 45, 0);
      stepNearMiss(n, v, gate, events);
    }
    const hits = events.filter((e) => e.type === 'nearMiss');
    expect(hits.length).toBe(2);
  });

  it('drops a pass in flight when the target is destroyed', () => {
    const targets = [makeTarget(0, 0, 0)];
    const n = createNearMissState(1);
    const v = createVehicleState(-12, 2.6, Math.PI / 2);
    const events: GameEvent[] = [];
    for (let i = 0; i < 200 && v.x < 12; i++) {
      place(v, v.x + 45 / 60, 2.6, 45, 0);
      if (v.x > -0.5) targets[0].status = 'destroyed';
      stepNearMiss(n, v, targets, events);
    }
    expect(events.filter((e) => e.type === 'nearMiss').length).toBe(0);
  });

  it('records the count and the best pass, and clears them on reset', () => {
    const targets = [makeTarget(0, 0, 0)];
    const n = createNearMissState(1);
    const v = createVehicleState(-12, 2.6, Math.PI / 2);
    const events: GameEvent[] = [];
    for (let lap = 0; lap < 2; lap++) {
      v.x = -12;
      for (let i = 0; i < 200 && v.x < 12; i++) {
        place(v, v.x + 45 / 60, 2.6, 45, 0);
        stepNearMiss(n, v, targets, events);
      }
    }
    expect(n.count).toBe(2);
    expect(n.best).toBeGreaterThan(NEAR_MISS.minPoints);
    resetNearMissState(n);
    expect(n.count).toBe(0);
    expect(n.best).toBe(0);
    expect(n.passes[0].active).toBe(false);
  });
});

describe('near miss through the whole simulation', () => {
  /**
   * Drops the player on the straight at x = -90 doing `speed` toward -Z with a frozen
   * electric car parked `offset` metres to the side, then runs real `stepGame` ticks.
   */
  function run(offset: number, speed: number) {
    const layout = createArenaLayout();
    layout.targetPatrols[2] = [];
    const s = createInitialGameState(layout);
    const cmd = createPlayerCommand();
    cmd.throttle = 1;

    const t = s.targets[2];
    t.x = -90 + offset;
    t.z = 55;
    t.prevX = t.x;
    t.prevZ = t.z;

    const v = s.vehicle;
    v.x = -90;
    v.z = 95;
    v.prevX = v.x;
    v.prevZ = v.z;
    v.heading = 0;
    v.prevHeading = 0;
    v.vz = -speed;
    v.speed = speed;

    let scored: Extract<GameEvent, { type: 'nearMiss' }> | null = null;
    for (let i = 0; i < 60 * 3 && s.vehicle.z > 40; i++) {
      stepGame(s, cmd, layout, 1 / 60);
      for (const ev of s.events) if (ev.type === 'nearMiss') scored = ev;
    }
    return { state: s, scored };
  }

  it('pays a close fast pass into the money counter and counts it', () => {
    const { state, scored } = run(2.6, 45);
    expect(scored).not.toBeNull();
    expect(scored!.targetId).toBe(2);
    expect(scored!.points).toBeGreaterThan(NEAR_MISS.minPoints);
    expect(state.economy.money).toBe(scored!.points);
    expect(state.nearMiss.count).toBe(1);
    expect(state.nearMiss.best).toBe(scored!.points);
    // No target was destroyed, so the kill counter must not have moved.
    expect(state.economy.destroyed).toBe(0);
  });

  it('pays nothing for a wide pass', () => {
    const { state, scored } = run(6, 45);
    expect(scored).toBeNull();
    expect(state.economy.money).toBe(0);
  });

  it('pays nothing when the player hits the car instead of missing it', () => {
    const { state, scored } = run(0, 45);
    expect(scored).toBeNull();
    expect(state.economy.money).toBe(0);
  });

  it('clears the near miss tally on restart', () => {
    const { state } = run(2.6, 45);
    expect(state.nearMiss.count).toBe(1);
    const layout = createArenaLayout();
    const cmd = createPlayerCommand();
    cmd.restart = true;
    stepGame(state, cmd, layout, 1 / 60);
    expect(state.nearMiss.count).toBe(0);
    expect(state.nearMiss.best).toBe(0);
    expect(state.nearMiss.passes.every((p) => !p.active)).toBe(true);
  });
});
