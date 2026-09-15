import { describe, expect, it } from 'vitest';
import { PASS_BY, SIM_STEP } from '../src/config/tuning';
import { createPassByDetector, type PassByGust } from '../src/audio/passBy';
import { createVehicleState } from '../src/sim/gameState';
import type { ArenaLayout, ObstacleBox, StreetPropDef, TargetState } from '../src/core/types';

/**
 * The wind-past detector: drive a car in a straight line past things, tick by tick the way the
 * frame loop sees it, and count the gusts. Heading 0 drives toward -Z with +X on the right.
 */

function layoutWith(colliders: ObstacleBox[], props: StreetPropDef[] = []): ArenaLayout {
  return { colliders, streetProps: props } as unknown as ArenaLayout;
}

function pillar(x: number, z: number, half = 0.5): ObstacleBox {
  return { minX: x - half, maxX: x + half, minZ: z - half, maxZ: z + half };
}

function drive(layout: ArenaLayout, speed: number, targets: TargetState[] = [], seconds = 3): PassByGust[] {
  const det = createPassByDetector(layout);
  const v = createVehicleState(0, 60, 0);
  v.vx = 0;
  v.vz = -speed;
  const gusts: PassByGust[] = [];
  for (let t = 0; t < seconds; t += SIM_STEP) {
    v.prevX = v.x;
    v.prevZ = v.z;
    v.z += v.vz * SIM_STEP;
    for (const tg of targets) {
      tg.prevX = tg.x;
      tg.prevZ = tg.z;
    }
    for (const g of det.step(v, targets, null, null, null)) gusts.push({ ...g });
  }
  return gusts;
}

describe('pass-by wind', () => {
  it('gusts once for a pillar blown past close and fast, on its side', () => {
    const right = drive(layoutWith([pillar(2.2, 0)]), 50);
    expect(right).toHaveLength(1);
    expect(right[0].side).toBe(1);
    expect(right[0].strength).toBeGreaterThan(0.3);
    const left = drive(layoutWith([pillar(-2.2, 0)]), 50);
    expect(left).toHaveLength(1);
    expect(left[0].side).toBe(-1);
  });

  it('is silent when slow, or when the pass is wide', () => {
    expect(drive(layoutWith([pillar(2.2, 0)]), PASS_BY.minSpeed - 2)).toHaveLength(0);
    expect(drive(layoutWith([pillar(9, 0)]), 50)).toHaveLength(0);
  });

  it('ignores buildings', () => {
    expect(drive(layoutWith([{ minX: 2, maxX: 30, minZ: -20, maxZ: 20 }]), 50)).toHaveLength(0);
  });

  it('a closer, faster pass is stronger', () => {
    const close = drive(layoutWith([pillar(1.8, 0)]), 55)[0];
    const wide = drive(layoutWith([pillar(3.5, 0)]), 30)[0];
    expect(close.strength).toBeGreaterThan(wide.strength);
  });

  it('hears a street prop standing where the city put it, but not litter', () => {
    const prop = (kind: StreetPropDef['kind']): StreetPropDef => ({ kind, variant: 0, x: 1.6, z: 0, y: 0, yaw: 0, rank: 0 });
    expect(drive(layoutWith([], [prop('cone')]), 50)).toHaveLength(1);
    expect(drive(layoutWith([], [prop('litter')]), 50)).toHaveLength(0);
  });

  it('gusts past a parked car, never twice for the same one', () => {
    const car = { id: 0, x: 2.5, z: 0, y: 0, prevX: 2.5, prevZ: 0, status: 'active' } as TargetState;
    expect(drive(layoutWith([]), 45, [car])).toHaveLength(1);
  });
});
