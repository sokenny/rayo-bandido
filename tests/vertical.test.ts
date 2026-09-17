import { describe, expect, it } from 'vitest';
import type { ArenaLayout, PlayerCommand, SurfaceField, VehicleState } from '../src/core/types';
import { SIM_STEP, VERTICAL } from '../src/config/tuning';
import { createVehicleState } from '../src/sim/gameState';
import { settleVehicle } from '../src/sim/surface';
import { stepVehicle } from '../src/sim/vehicle';

/** A world made only of a height function (grade by finite difference). */
function world(height: (x: number, z: number) => number): ArenaLayout {
  const surface: SurfaceField = {
    sample(x, z, _hint, out) {
      out.y = height(x, z);
      out.gx = (height(x + 0.01, z) - height(x - 0.01, z)) / 0.02;
      out.gz = (height(x, z + 0.01) - height(x, z - 0.01)) / 0.02;
    },
  };
  // A perfect plane: these cases are about flight, not the asphalt's unevenness.
  return { surface, roughness: 0 } as unknown as ArenaLayout;
}

const COAST: PlayerCommand = { throttle: 0, brake: 0, steer: 0, handbrake: false } as PlayerCommand;

function run(v: VehicleState, layout: ArenaLayout, seconds: number, each?: (v: VehicleState) => void): void {
  for (let t = 0; t < seconds; t += SIM_STEP) {
    stepVehicle(v, COAST, false, SIM_STEP);
    settleVehicle(v, layout, SIM_STEP);
    each?.(v);
  }
}

describe('vertical body', () => {
  it('rests still on flat ground', () => {
    const v = createVehicleState(0, 0, 0);
    run(v, world(() => 0), 3);
    expect(Math.abs(v.y)).toBeLessThan(1e-6);
    expect(Math.abs(v.pitch)).toBeLessThan(1e-6);
    expect(v.airborne).toBe(false);
  });

  it('falls from a height the whole way, and lands', () => {
    const v = createVehicleState(0, 0, 0, 12);
    let flew = 0;
    let impact = 0;
    run(v, world(() => 0), 3, (s) => {
      if (s.airborne) flew += SIM_STEP;
      impact = Math.max(impact, s.landingImpact);
    });
    // Free fall from 12 m: ~1.56 s, ~15 m/s.
    expect(flew).toBeGreaterThan(1.3);
    expect(impact).toBeGreaterThan(12);
    expect(v.airborne).toBe(false);
    expect(Math.abs(v.y)).toBeLessThan(0.2);
  });

  it('launches off a ramp lip at speed', () => {
    // A 12% ramp along -z (north) that ends in a 2.4 m drop back to the street.
    const ramp = (_x: number, z: number) => (z < 0 && z > -20 ? -z * 0.12 : 0);
    const fly = (speed: number) => {
      const v = createVehicleState(0, 10, 0);
      v.vz = -speed;
      v.speed = speed;
      let air = 0;
      let peak = 0;
      run(v, world(ramp), 3, (s) => {
        if (s.airborne) air += SIM_STEP;
        peak = Math.max(peak, s.y);
      });
      return { air, peak };
    };
    const fast = fly(35);
    expect(fast.air).toBeGreaterThan(0.6);
    expect(fast.peak).toBeGreaterThan(2.4 + 0.5);
  });

  it('tips nose down rolling slowly off a ledge', () => {
    const ledge = (_x: number, z: number) => (z > -2 ? 8 : 0);
    const v = createVehicleState(0, 0, 0, 8);
    v.vz = -4;
    v.speed = 4;
    let minPitch = 0;
    run(v, world(ledge), 2, (s) => {
      if (s.y > 1) minPitch = Math.min(minPitch, s.pitch);
    });
    expect(minPitch).toBeLessThan(-0.3);
    expect(Math.abs(v.pitch)).toBeLessThan(VERTICAL.uprightFrom + 0.05);
  });
});
