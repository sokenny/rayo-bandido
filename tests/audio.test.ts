import { describe, expect, it } from 'vitest';
import { IDLE_RPM01, SKID, distanceGain, engineTone, skidIntensity, stereoPan } from '../src/audio/dsp';
import { AUDIO } from '../src/config/tuning';

describe('engineTone gearbox', () => {
  const bounds = AUDIO.gearBounds;

  it('sits at the idle floor when stopped', () => {
    const { gear, rpm01 } = engineTone(0, bounds);
    expect(gear).toBe(0);
    expect(rpm01).toBeCloseTo(IDLE_RPM01, 5);
  });

  it('rises to redline at the top of a gear', () => {
    // Just under the first gear's upper bound → nearly redline.
    const { gear, rpm01 } = engineTone(bounds[0] - 1e-4, bounds);
    expect(gear).toBe(0);
    expect(rpm01).toBeGreaterThan(0.98);
  });

  it('drops the note on the upshift (gear boundary is not monotonic in rpm)', () => {
    const top1 = engineTone(bounds[0] - 1e-4, bounds).rpm01;
    const bottom2 = engineTone(bounds[0] + 1e-4, bounds).rpm01;
    expect(bottom2).toBeLessThan(top1);
    expect(engineTone(bounds[0] + 1e-4, bounds).gear).toBe(1);
  });

  it('selects ascending gears with speed and holds redline past the last bound', () => {
    expect(engineTone(0.05, bounds).gear).toBe(0);
    expect(engineTone(0.5, bounds).gear).toBe(3);
    // Overspeed (nitro) clamps within the top gear rather than exploding past redline.
    const over = engineTone(1.4, bounds);
    expect(over.gear).toBe(bounds.length - 1);
    expect(over.rpm01).toBeLessThanOrEqual(1);
  });
});

describe('distanceGain', () => {
  it('is full inside the near radius and silent past the far radius', () => {
    expect(distanceGain(0, 6, 55)).toBe(1);
    expect(distanceGain(6, 6, 55)).toBe(1);
    expect(distanceGain(55, 6, 55)).toBe(0);
    expect(distanceGain(100, 6, 55)).toBe(0);
  });

  it('rolls off monotonically between near and far', () => {
    const mid = distanceGain(30, 6, 55);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(distanceGain(20, 6, 55)).toBeGreaterThan(distanceGain(40, 6, 55));
  });
});

describe('skidIntensity', () => {
  it('is silent when parked, even with lateral velocity noise', () => {
    expect(skidIntensity(5, 1, false)).toBe(0); // below MIN_SPEED
  });

  it('is silent when gripping and barely sliding', () => {
    // Moving but not drifting and lateral under SLIDE_LATERAL → no scrub.
    expect(skidIntensity(3, 20, false)).toBe(0);
  });

  it('ramps with lateral speed once past the slide threshold', () => {
    const low = skidIntensity(SKID.SLIDE_LATERAL + 1, 20, false);
    const high = skidIntensity(9, 20, false);
    expect(low).toBeGreaterThan(0);
    expect(high).toBeGreaterThan(low);
    expect(skidIntensity(50, 20, false)).toBe(1); // clamps at full
  });

  it('a latched drift always scrubs at least the floor', () => {
    // Drifting but with tiny lateral speed still gets the floor.
    expect(skidIntensity(0.5, 20, true)).toBeCloseTo(SKID.DRIFT_FLOOR, 5);
  });
});

describe('stereoPan', () => {
  // heading 0 faces -Z; right vector is +X. See src/core/types.ts coordinate notes.
  it('pans right for a source on the +X side', () => {
    expect(stereoPan(10, 0, 0, 0.85)).toBeCloseTo(0.85, 5);
  });

  it('pans left for a source on the -X side', () => {
    expect(stereoPan(-10, 0, 0, 0.85)).toBeCloseTo(-0.85, 5);
  });

  it('is centered for a source directly ahead', () => {
    // Directly ahead is -Z, orthogonal to the right axis → no pan.
    expect(stereoPan(0, -10, 0, 0.85)).toBeCloseTo(0, 5);
  });

  it('returns 0 when the source is on top of the listener', () => {
    expect(stereoPan(0, 0, 1.2, 0.85)).toBe(0);
  });
});
