import { describe, expect, it } from 'vitest';
import { ATMOSPHERE } from '../src/config/tuning';
import { createStorm, stormRng, type StormConfig } from '../src/render/scene/env/storm';
import { ATMOSPHERE_PRESETS, resolveQuality } from '../src/render/scene/env/atmosphere';

/**
 * The weather. Only the parts that are pure logic are tested here: the storm clock and the
 * quality presets. The dome and the rain are shaders, and the node test environment has no
 * WebGL context to compile them in — what proves those is the browser capture in
 * `scripts/city-shots.mjs` and the console being clean.
 */

/** Step a storm for `seconds` at 60 Hz and report what the sky did. */
function run(config: StormConfig, seconds: number, seed = 1234) {
  const storm = createStorm(config, seed);
  const dt = 1 / 60;
  let peak = 0;
  let lit = 0;
  const starts: number[] = [];
  let wasLit = false;
  for (let t = 0; t < seconds; t += dt) {
    storm.step(dt);
    const v = storm.intensity;
    if (v > peak) peak = v;
    if (v > 0) lit++;
    const isLit = v > 0;
    if (isLit && !wasLit) starts.push(t);
    wasLit = isLit;
  }
  return { storm, peak, lit, starts };
}

describe('storm clock', () => {
  it('is dark to begin with and never leaves the 0..1 range', () => {
    const storm = createStorm(ATMOSPHERE.storm, 7);
    expect(storm.intensity).toBe(0);
    const dt = 1 / 60;
    for (let i = 0; i < 60 * 300; i++) {
      storm.step(dt);
      expect(storm.intensity).toBeGreaterThanOrEqual(0);
      expect(storm.intensity).toBeLessThanOrEqual(1);
    }
  });

  it('strikes, and spends most of its time dark', () => {
    const { storm, peak, lit } = run(ATMOSPHERE.storm, 300);
    expect(storm.strikes).toBeGreaterThan(5);
    expect(peak).toBeGreaterThan(0.2);
    // A strike (leader plus restrikes) runs about half a second to a second, and there are
    // a couple of dozen in five minutes: anything much past this is a strobe, not weather.
    expect(lit / (300 * 60)).toBeLessThan(0.08);
  });

  it('flashes several times per strike, at irregular gaps', () => {
    const { starts, storm } = run(ATMOSPHERE.storm, 300);
    // Sub-flashes mean more separate lit runs than there were strikes.
    expect(starts.length).toBeGreaterThan(storm.strikes);
    const gaps: number[] = [];
    for (let i = 1; i < starts.length; i++) gaps.push(starts[i] - starts[i - 1]);
    const unique = new Set(gaps.map((g) => g.toFixed(3)));
    // Nothing periodic: a metronome would collapse to one or two distinct gaps.
    expect(unique.size).toBeGreaterThan(gaps.length * 0.5);
  });

  it('fires on demand and picks a unit direction in the upper sky', () => {
    const storm = createStorm(ATMOSPHERE.storm, 99);
    for (let i = 0; i < 40; i++) {
      storm.fire();
      const len = Math.hypot(storm.dirX, storm.dirY, storm.dirZ);
      expect(len).toBeCloseTo(1, 5);
      expect(storm.dirY).toBeGreaterThan(0);
      // A discharge attacks from nothing, so the light arrives on the next step, not on the
      // frame the strike was scheduled.
      storm.step(1 / 60);
      expect(storm.intensity).toBeGreaterThan(0);
    }
  });

  it('goes fully dark again between strikes', () => {
    const storm = createStorm(ATMOSPHERE.storm, 5);
    storm.fire();
    for (let i = 0; i < 60 * 3; i++) storm.step(1 / 60);
    expect(storm.intensity).toBe(0);
  });

  it('frequency 0 turns the weather lightning off', () => {
    const { storm, peak } = run({ ...ATMOSPHERE.storm, frequency: 0 }, 600);
    expect(storm.strikes).toBe(0);
    expect(peak).toBe(0);
  });

  it('a higher frequency strikes more often', () => {
    const slow = run({ ...ATMOSPHERE.storm, frequency: 0.5 }, 600).storm.strikes;
    const fast = run({ ...ATMOSPHERE.storm, frequency: 4 }, 600).storm.strikes;
    expect(fast).toBeGreaterThan(slow * 2);
  });

  it('intensity scales the peak without changing the schedule', () => {
    const dim = run({ ...ATMOSPHERE.storm, intensity: 0.25 }, 300);
    const bright = run({ ...ATMOSPHERE.storm, intensity: 1 }, 300);
    expect(dim.storm.strikes).toBe(bright.storm.strikes);
    expect(dim.peak).toBeLessThan(bright.peak * 0.5);
  });

  it('reset clears a strike in flight', () => {
    const storm = createStorm(ATMOSPHERE.storm, 3);
    storm.fire();
    storm.step(1 / 60);
    expect(storm.intensity).toBeGreaterThan(0);
    storm.reset();
    expect(storm.intensity).toBe(0);
  });

  it('is deterministic for a seed and different between seeds', () => {
    const a = run(ATMOSPHERE.storm, 120, 42);
    const b = run(ATMOSPHERE.storm, 120, 42);
    const c = run(ATMOSPHERE.storm, 120, 43);
    expect(a.starts).toEqual(b.starts);
    expect(c.starts).not.toEqual(a.starts);
  });

  it('the rng stays inside 0..1', () => {
    const rng = stormRng(2024);
    for (let i = 0; i < 10_000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('atmosphere quality', () => {
  it('auto is high on a pointer device and medium on a touch one', () => {
    expect(resolveQuality('auto', false)).toBe('high');
    expect(resolveQuality('auto', true)).toBe('medium');
  });

  it('an explicit level is honoured whatever the device', () => {
    expect(resolveQuality('low', false)).toBe('low');
    expect(resolveQuality('high', true)).toBe('high');
  });

  it('presets only ever get cheaper going down', () => {
    const { low, medium, high } = ATMOSPHERE_PRESETS;
    expect(low.octavesFar).toBeLessThanOrEqual(high.octavesFar);
    expect(medium.octavesFar).toBeLessThanOrEqual(high.octavesFar);
    expect(low.segments).toBeLessThan(high.segments);
    expect(low.rainScale).toBeLessThanOrEqual(medium.rainScale);
    expect(medium.rainScale).toBeLessThanOrEqual(high.rainScale);
    // The near layer is the biggest single saving, so low is the level that drops it.
    expect(low.twoLayers).toBe(false);
    expect(high.twoLayers).toBe(true);
  });

  it('every preset still draws at least one usable cloud layer', () => {
    for (const preset of Object.values(ATMOSPHERE_PRESETS)) {
      expect(preset.octavesFar).toBeGreaterThanOrEqual(2);
      expect(preset.segments).toBeGreaterThanOrEqual(16);
    }
  });
});

describe('atmosphere configuration', () => {
  it('exposes every knob the art direction needs', () => {
    for (const key of [
      'zenith', 'middle', 'horizon', 'horizonGlow', 'coverage', 'contrast',
      'cloudOpacity', 'driftFar', 'driftNear', 'fogColor', 'fogTint',
      'fogDensityScale', 'pollution', 'quality',
    ] as const) {
      expect(ATMOSPHERE[key]).toBeDefined();
    }
    expect(ATMOSPHERE.storm.frequency).toBeGreaterThan(0);
    expect(ATMOSPHERE.rain.intensity).toBeGreaterThanOrEqual(0);
  });

  it('keeps the clouds slow: a storm ceiling is not a screensaver', () => {
    expect(ATMOSPHERE.driftFar).toBeLessThan(0.02);
    expect(ATMOSPHERE.driftNear).toBeLessThan(0.02);
    // The two layers must differ, or there is no parallax and the sky reads as one card.
    expect(ATMOSPHERE.driftNear).not.toBe(ATMOSPHERE.driftFar);
    expect(ATMOSPHERE.scaleNear).not.toBe(ATMOSPHERE.scaleFar);
  });
});
