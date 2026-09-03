import { describe, expect, it } from 'vitest';
import {
  IDLE_RPM01,
  REF_SPEED,
  SKID,
  distanceGain,
  engineTone,
  skidIntensity,
  squealHz,
  stereoPan,
} from '../src/audio/dsp';
import { BACKFIRE, createBackfireTrigger } from '../src/audio/backfire';
import { FLUTTER, chuffTimes, createTurboFlutterTrigger } from '../src/audio/turboFlutter';
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

describe('backfire trigger', () => {
  const FRAME = 1 / 60;
  // Just under the second gear's upper bound: past the minimum speed and near redline.
  const REDLINE_SPEED = (AUDIO.gearBounds[1] - 1e-3) * REF_SPEED;
  // Inside first gear: the fake gearbox reads near redline, but the car is barely moving.
  const CRAWL_SPEED = 0.1 * REF_SPEED;

  /** Run `frames` frames at a held throttle, collecting every bang strength returned. */
  function drive(
    trigger: ReturnType<typeof createBackfireTrigger>,
    frames: number,
    speed: number,
    throttle: number,
    nitro = false,
  ): number[] {
    const bangs: number[] = [];
    for (let i = 0; i < frames; i++) {
      const s = trigger.tick(FRAME, speed, throttle, nitro);
      if (s > 0) bangs.push(s);
    }
    return bangs;
  }

  it('stays silent while the exhaust is cold, even on a snap lift', () => {
    const trigger = createBackfireTrigger();
    drive(trigger, 30, CRAWL_SPEED, 1);
    expect(drive(trigger, 60, CRAWL_SPEED, 0)).toEqual([]);
  });

  it('fires a decaying burst when the throttle snaps shut at high rpm', () => {
    const trigger = createBackfireTrigger();
    drive(trigger, 30, REDLINE_SPEED, 1);
    const bangs = drive(trigger, 90, REDLINE_SPEED, 0);
    expect(bangs.length).toBeGreaterThanOrEqual(1);
    expect(bangs.length).toBeLessThanOrEqual(BACKFIRE.LIFT_BANGS_MAX);
    for (const s of bangs) expect(s).toBeLessThanOrEqual(1);
    for (let i = 1; i < bangs.length; i++) expect(bangs[i]).toBeLessThan(bangs[i - 1]);
  });

  it('bangs on a lift-off mid-gear, where the note is nowhere near the limiter', () => {
    // Middle of third gear: fast, hot pipes, but a low engine note after the upshift.
    const speed = ((AUDIO.gearBounds[1] + AUDIO.gearBounds[2]) / 2) * REF_SPEED;
    expect(engineTone(speed / REF_SPEED, AUDIO.gearBounds).rpm01).toBeLessThan(BACKFIRE.MIN_RPM01);
    const trigger = createBackfireTrigger();
    drive(trigger, 30, speed, 1);
    expect(drive(trigger, 90, speed, 0).length).toBeGreaterThanOrEqual(1);
  });

  it('keeps lift-off bursts short, with the odd triple', () => {
    const lengths: number[] = [];
    for (let i = 0; i < 400; i++) {
      const trigger = createBackfireTrigger();
      drive(trigger, 30, REDLINE_SPEED, 1);
      lengths.push(drive(trigger, 90, REDLINE_SPEED, 0).length);
    }
    const share = (n: number) => lengths.filter((l) => l === n).length / lengths.length;
    expect(Math.max(...lengths)).toBeLessThanOrEqual(BACKFIRE.LIFT_BANGS_MAX);
    expect(Math.min(...lengths)).toBeGreaterThanOrEqual(1);
    // Singles and doubles carry the effect; triples are the rare punctuation.
    expect(share(1) + share(2)).toBeGreaterThan(0.75);
    expect(share(3)).toBeLessThan(0.25);
  });

  it('bangs harder off a hot exhaust than a barely-warm one', () => {
    function liftAt(speedFrac: number): number {
      const trigger = createBackfireTrigger();
      drive(trigger, 30, speedFrac * REF_SPEED, 1);
      return drive(trigger, 90, speedFrac * REF_SPEED, 0)[0];
    }
    // Just off the minimum vs. fully heat-soaked, both mid-gear.
    expect(liftAt(BACKFIRE.MIN_SPEED_FRAC + 0.02)).toBeLessThan(liftAt(BACKFIRE.HOT_SPEED_FRAC + 0.1));
  });

  it('ignores a gentle throttle release', () => {
    const trigger = createBackfireTrigger();
    // Start already off the crackle threshold, then ease off well under LIFT_DROP per frame.
    const start = BACKFIRE.CRACKLE_THROTTLE - 0.05;
    drive(trigger, 30, REDLINE_SPEED, start);
    const bangs: number[] = [];
    for (let i = 0; i < 40; i++) {
      const s = trigger.tick(FRAME, REDLINE_SPEED, Math.max(0, start - i * 0.05), false);
      if (s > 0) bangs.push(s);
    }
    expect(bangs).toEqual([]);
  });

  it('does not crackle at a cruising part-throttle', () => {
    const trigger = createBackfireTrigger();
    expect(drive(trigger, 600, REDLINE_SPEED, 0.5)).toEqual([]);
  });

  it('crackles under load at redline, never faster than the refractory gap', () => {
    const trigger = createBackfireTrigger();
    let elapsed = 0;
    let previous = -1;
    let count = 0;
    for (let i = 0; i < 1200; i++) {
      elapsed += FRAME;
      if (trigger.tick(FRAME, REDLINE_SPEED, 1, false) === 0) continue;
      // The trigger starts ready, so only gaps between consecutive bangs are constrained.
      if (previous >= 0) expect(elapsed - previous).toBeGreaterThanOrEqual(BACKFIRE.MIN_INTERVAL);
      previous = elapsed;
      count++;
    }
    expect(count).toBeGreaterThan(1);
  });

  it('drops a queued burst on reset', () => {
    const trigger = createBackfireTrigger();
    drive(trigger, 30, REDLINE_SPEED, 1);
    trigger.tick(FRAME, REDLINE_SPEED, 0, false); // queues (and fires the first of) a burst
    trigger.reset();
    expect(drive(trigger, 90, REDLINE_SPEED, 0)).toEqual([]);
  });
});

describe('turbo flutter trigger', () => {
  const FRAME = 1 / 60;
  const CRUISE = 0.6 * REF_SPEED;
  const CRAWL = FLUTTER.MIN_SPEED_FRAC * 0.5 * REF_SPEED;

  /** Hold a throttle for `seconds`, returning every surge strength returned along the way. */
  function drive(
    trigger: ReturnType<typeof createTurboFlutterTrigger>,
    seconds: number,
    speed: number,
    throttle: number,
    nitro = false,
  ): number[] {
    const surges: number[] = [];
    for (let i = 0; i < Math.round(seconds / FRAME); i++) {
      const s = trigger.tick(FRAME, speed, throttle, nitro);
      if (s > 0) surges.push(s);
    }
    return surges;
  }

  /** A full pull followed by a snap lift — the canonical way to earn a flutter. */
  function pullAndLift(
    trigger: ReturnType<typeof createTurboFlutterTrigger>,
    seconds: number,
    speed = CRUISE,
  ): number[] {
    drive(trigger, seconds, speed, 1);
    return drive(trigger, 0.5, speed, 0);
  }

  it('flutters once on a snap lift after a sustained pull', () => {
    const trigger = createTurboFlutterTrigger();
    const surges = pullAndLift(trigger, 2);
    expect(surges).toHaveLength(1);
    expect(surges[0]).toBeGreaterThan(0);
    expect(surges[0]).toBeLessThanOrEqual(1);
  });

  it('stays silent on a blip of the throttle: there is no boost to stall', () => {
    const trigger = createTurboFlutterTrigger();
    expect(pullAndLift(trigger, 0.15)).toEqual([]);
  });

  it('stays silent at a crawl, however hard the pedal is worked', () => {
    const trigger = createTurboFlutterTrigger();
    expect(pullAndLift(trigger, 3, CRAWL)).toEqual([]);
  });

  it('ignores a lift that only goes to part throttle', () => {
    const trigger = createTurboFlutterTrigger();
    drive(trigger, 2, CRUISE, 1);
    // A 0.6 drop, well past LIFT_DROP — but the plate is still open, so the air keeps flowing.
    expect(drive(trigger, 0.5, CRUISE, 0.4)).toEqual([]);
  });

  it('ignores a gentle roll-off the throttle', () => {
    const trigger = createTurboFlutterTrigger();
    drive(trigger, 2, CRUISE, 1);
    const surges: number[] = [];
    for (let i = 0; i < 60; i++) {
      const s = trigger.tick(FRAME, CRUISE, Math.max(0, 1 - i * 0.05), false);
      if (s > 0) surges.push(s);
    }
    expect(surges).toEqual([]);
  });

  it('does not re-fire on tapped throttle: the surge vents the pressure', () => {
    // Cornering is made of on/off tapping. Only the first lift should have anything behind it.
    const trigger = createTurboFlutterTrigger();
    drive(trigger, 2, CRUISE, 1);
    const surges: number[] = [];
    for (let tap = 0; tap < 8; tap++) {
      surges.push(...drive(trigger, 0.15, CRUISE, 0));
      surges.push(...drive(trigger, 0.15, CRUISE, 1));
    }
    expect(surges).toHaveLength(1);
  });

  it('earns another flutter after going back on the gas', () => {
    const trigger = createTurboFlutterTrigger();
    expect(pullAndLift(trigger, 2)).toHaveLength(1);
    expect(pullAndLift(trigger, 2)).toHaveLength(1);
  });

  it('surges harder off a long pull than a barely-spooled one', () => {
    const short = createTurboFlutterTrigger();
    const long = createTurboFlutterTrigger();
    expect(pullAndLift(short, 0.75)[0]).toBeLessThan(pullAndLift(long, 3)[0]);
  });

  it('builds boost that lags the throttle and bleeds off it', () => {
    const trigger = createTurboFlutterTrigger();
    trigger.tick(FRAME, CRUISE, 1, false);
    expect(trigger.boost).toBeLessThan(0.1); // one frame of throttle spools nothing
    drive(trigger, 3, CRUISE, 1);
    const spooled = trigger.boost;
    expect(spooled).toBeGreaterThan(FLUTTER.FIRE_BOOST);
    drive(trigger, 1.5, CRUISE, 0);
    expect(trigger.boost).toBeLessThan(spooled * 0.2);
  });

  it('keeps every burst short enough to read as punctuation, and shorter than the gap', () => {
    for (const s of [0, 0.25, 0.5, 0.75, 1]) {
      const times = chuffTimes(s);
      expect(times.length).toBeGreaterThanOrEqual(3);
      const last = times[times.length - 1] + FLUTTER.CHUFF_PERIOD;
      expect(last).toBeLessThanOrEqual(1);
      // A burst that outlives the refractory gap would overlap the next one into a drone.
      expect(last).toBeLessThan(FLUTTER.MIN_INTERVAL);
    }
  });

  it('gives a big surge more chuffs than a small one, and spaces them out as it fades', () => {
    const small = chuffTimes(0.1);
    const big = chuffTimes(1);
    expect(big.length).toBeGreaterThan(small.length);
    const gaps = big.slice(1).map((t, i) => t - big[i]);
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]).toBeGreaterThan(gaps[i - 1]);
  });

  it('spools on nitro even with the pedal up, and drops the lot on reset', () => {
    const trigger = createTurboFlutterTrigger();
    drive(trigger, 2, CRUISE, 0, true);
    expect(trigger.boost).toBeGreaterThan(FLUTTER.FIRE_BOOST);
    trigger.reset();
    expect(trigger.boost).toBe(0);
    expect(drive(trigger, 0.5, CRUISE, 0)).toEqual([]);
  });
});

describe('squealHz', () => {
  it('stays inside the band where real tire squeal lives', () => {
    for (const i of [0, 0.25, 0.5, 0.75, 1]) {
      for (const s of [0, 0.5, 1]) {
        expect(squealHz(i, s)).toBeGreaterThanOrEqual(700);
        expect(squealHz(i, s)).toBeLessThanOrEqual(1550);
      }
    }
  });

  it('climbs with slide angle', () => {
    expect(squealHz(0.8, 0.5)).toBeGreaterThan(squealHz(0.3, 0.5));
  });

  it('lets speed raise the pitch only while actually sliding', () => {
    // Not sliding: speed must not make a gripping tire sing.
    expect(squealHz(0, 1)).toBeCloseTo(squealHz(0, 0), 5);
    // Sliding: faster is higher.
    expect(squealHz(1, 1)).toBeGreaterThan(squealHz(1, 0));
  });

  it('clamps out-of-range inputs rather than running away', () => {
    expect(squealHz(4, 4)).toBeCloseTo(squealHz(1, 1), 5);
    expect(squealHz(-2, -2)).toBeCloseTo(squealHz(0, 0), 5);
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
