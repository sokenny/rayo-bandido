import { describe, expect, it } from 'vitest';
import { TACHO_REDLINE01, tachoAngle, tachoRpm } from '../src/ui/tacho';
import { REF_SPEED, autoGear, roadRpm01 } from '../src/sim/drivetrain';
import { DRIVETRAIN } from '../src/config/tuning';

/** Road rpm the automatic shows at `speed` with no throttle excess: what the HUD snapshot carries. */
function rpm01For(speed: number): number {
  return roadRpm01(Math.abs(speed), autoGear(Math.abs(speed), 0));
}

describe('tacho scale', () => {
  it('idles low and tops out just inside the red band', () => {
    expect(tachoRpm(0)).toBeCloseTo(900, 5);
    expect(tachoRpm(1)).toBeCloseTo(9200, 5);
    expect(TACHO_REDLINE01).toBeGreaterThan(0.8);
    expect(TACHO_REDLINE01).toBeLessThan(1);
    // The needle enters the red before the top of every gear, so an upshift is visible.
    expect(tachoRpm(TACHO_REDLINE01)).toBeCloseTo(8500, 5);
  });

  it('sweeps clockwise from the lower left and clamps off-scale input', () => {
    expect(tachoAngle(0)).toBeCloseTo(195, 5);
    expect(tachoAngle(10000)).toBeCloseTo(-15, 5);
    expect(tachoAngle(5000)).toBeCloseTo(90, 5);
    expect(tachoAngle(-500)).toBeCloseTo(195, 5);
    expect(tachoAngle(99999)).toBeCloseTo(-15, 5);
  });

  it('is monotonic: more revs is never a lower needle', () => {
    let previous = Infinity;
    for (let i = 0; i <= 20; i++) {
      const angle = tachoAngle(tachoRpm(i / 20));
      expect(angle).toBeLessThan(previous);
      previous = angle;
    }
  });
});

describe('tacho against the gearbox that drives the sound', () => {
  it('parks the needle at the bottom of the dial when stopped', () => {
    expect(rpm01For(0)).toBeCloseTo(0, 5);
    expect(tachoRpm(rpm01For(0))).toBeCloseTo(900, 5);
  });

  it('drops the needle on the upshift the engine note drops on', () => {
    const bound = DRIVETRAIN.gearTops[1] * REF_SPEED;
    const before = tachoAngle(tachoRpm(rpm01For(bound - 0.01)));
    const after = tachoAngle(tachoRpm(rpm01For(bound + 0.01)));
    // Angles decrease clockwise, so a bigger angle after the shift means the needle fell back.
    expect(after).toBeGreaterThan(before);
    expect(tachoRpm(rpm01For(bound - 0.01))).toBeGreaterThan(8500);
  });

  it('stays on the dial under nitro overspeed', () => {
    const rpm = tachoRpm(rpm01For(REF_SPEED * 1.4));
    expect(rpm).toBeLessThanOrEqual(9200);
    expect(tachoAngle(rpm)).toBeGreaterThan(-15);
  });
});
