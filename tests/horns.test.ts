import { describe, expect, it } from 'vitest';
import { HORNS, SIM_STEP } from '../src/config/tuning';
import { createHornTrigger, dopplerRatio } from '../src/audio/horns';
import type { Listener } from '../src/audio/electricHum';
import type { TargetState } from '../src/core/types';

/**
 * Oncoming horns. The player drives toward -Z (heading 0) from z = 0; cars are placed ahead and
 * the scene is stepped the way the frame loop does, counting honks.
 */

function car(x: number, z: number, heading: number, speed: number): TargetState {
  return { id: 0, x, z, y: 0, heading, speed, vx: 0, vz: 0, prevX: x, prevZ: z, status: 'active' } as TargetState;
}

function run(playerSpeed: number, cars: TargetState[], random = () => 0, seconds = 4): number[] {
  const trig = createHornTrigger(cars.length, random);
  const L: Listener = { x: 0, z: 0, y: 0, heading: 0, vx: 0, vz: -playerSpeed };
  const honks: number[] = [];
  for (let t = 0; t < seconds; t += SIM_STEP) {
    L.z += (L.vz ?? 0) * SIM_STEP;
    for (const c of cars) {
      c.x += Math.sin(c.heading) * c.speed * SIM_STEP;
      c.z += -Math.cos(c.heading) * c.speed * SIM_STEP;
    }
    const h = trig.step(SIM_STEP, L, cars);
    if (h) honks.push(h.car);
  }
  return honks;
}

describe('oncoming horns', () => {
  it('an oncoming car in the player\'s lane honks once per approach', () => {
    expect(run(45, [car(1, -150, Math.PI, 12)])).toEqual([0]);
  });

  it('nobody honks at a slow player, a car going the same way, or a car well off the line', () => {
    expect(run(HORNS.minSpeed - 4, [car(0, -120, Math.PI, 12)])).toEqual([]);
    expect(run(45, [car(0, -60, 0, 12)])).toEqual([]);
    expect(run(45, [car(HORNS.maxLateral + 3, -150, Math.PI, 12)])).toEqual([]);
  });

  it('is occasional: a failed roll is not re-rolled on the same approach', () => {
    let calls = 0;
    const honks = run(45, [car(0, -150, Math.PI, 12)], () => {
      calls++;
      return 0.99;
    });
    expect(honks).toEqual([]);
    expect(calls).toBe(1);
  });

  it('respects the cooldown between two cars', () => {
    const honks = run(45, [car(0, -150, Math.PI, 12), car(-1, -170, Math.PI, 12)]);
    expect(honks).toHaveLength(1);
  });
});

describe('doppler', () => {
  it('is sharp closing, flat when still, flat across, and drops after the pass', () => {
    // Listener moving toward -Z at 50 m/s, source ahead (n = (0,-1)) coming at +Z at 15 m/s.
    const closing = dopplerRatio(0, -1, 0, -50, 0, 15);
    const receding = dopplerRatio(0, 1, 0, -50, 0, 15);
    expect(closing).toBeGreaterThan(1.15);
    expect(receding).toBeLessThan(0.82);
    expect(dopplerRatio(1, 0, 0, -50, 0, 15)).toBeCloseTo(1, 5);
    expect(dopplerRatio(0, -1, 0, 0, 0, 0)).toBe(1);
  });

  it('a faster pass drops further', () => {
    const slow = dopplerRatio(0, -1, 0, -25, 0, 10) / dopplerRatio(0, 1, 0, -25, 0, 10);
    const fast = dopplerRatio(0, -1, 0, -60, 0, 10) / dopplerRatio(0, 1, 0, -60, 0, 10);
    expect(fast).toBeGreaterThan(slow);
  });
});
