import { describe, expect, it } from 'vitest';
import { createAmbientDirector, nearMissTrigger } from '../src/audio/ambientVoice';
import { AMBIENT_VOICE } from '../src/config/tuning';
import { AMBIENT_CLIPS, AMBIENT_LINES } from '../src/content/ambientVoice';
import type { TargetState } from '../src/core/types';
import { busStopCrowds } from '../src/world/busStopCrowds';
import { BUS_STOP, type BusStopDef } from '../src/world/cityPlan';

/** Always passes the chance roll and takes the smallest delay / cooldown. */
const lucky = () => 0;

describe('ambient voice director', () => {
  it('speaks after the reaction delay, then stays quiet for the global cooldown', () => {
    const d = createAmbientDirector(lucky);
    expect(d.offer(0, 'driverHit', 'driver', 3)).toBe(true);
    expect(d.take(0.05, false)).toBeNull();
    const line = d.take(AMBIENT_VOICE.delay[0], false);
    expect(line?.trigger).toBe('driverHit');
    expect(AMBIENT_LINES.driverHit).toContain(line!.clip);
    // One line at a time.
    expect(d.offer(0.2, 'stopFast', 'stop', 0)).toBe(false);
    d.ended();
    // Another source, still inside the global cooldown.
    expect(d.offer(AMBIENT_VOICE.globalCooldown[0] - 1, 'stopFast', 'stop', 0)).toBe(false);
    expect(d.offer(AMBIENT_VOICE.globalCooldown[0] + 1, 'stopFast', 'stop', 0)).toBe(true);
  });

  it('keeps one source quiet for its own cooldown', () => {
    const d = createAmbientDirector(lucky);
    d.offer(0, 'driverClose', 'driver', 7);
    d.take(0.1, false);
    d.ended();
    const afterGlobal = AMBIENT_VOICE.globalCooldown[1] + 1;
    expect(d.offer(afterGlobal, 'driverClose', 'driver', 7)).toBe(false);
    expect(d.offer(afterGlobal, 'driverClose', 'driver', 8)).toBe(true);
    const d2 = createAmbientDirector(lucky);
    d2.offer(0, 'driverClose', 'driver', 7);
    d2.take(0.1, false);
    d2.ended();
    expect(d2.offer(AMBIENT_VOICE.sourceCooldown + 1, 'driverHit', 'driver', 7)).toBe(true);
  });

  it('lets a crash cut through the cooldowns and the weaker line on air from the approach', () => {
    const d = createAmbientDirector(lucky);
    d.offer(0, 'driverFast', 'driver', 5);
    expect(d.take(0.1, false)?.trigger).toBe('driverFast');
    // Still on air, same car, inside every cooldown: the hit gets through anyway.
    expect(d.accepting(0.4, 'driverHit', 'driver', 5)).toBe(true);
    expect(d.offer(0.4, 'driverHit', 'driver', 5)).toBe(true);
    const hit = d.take(0.5, false);
    expect(AMBIENT_LINES.driverHit).toContain(hit!.clip);
    // But not a second crash line over the first.
    expect(d.offer(0.6, 'stopCrash', 'stop', 0)).toBe(false);
  });

  it('lets a stronger trigger replace a waiting weaker one, never the reverse', () => {
    const d = createAmbientDirector(lucky);
    expect(d.offer(0, 'stopFast', 'stop', 1)).toBe(true);
    expect(d.offer(0.01, 'stopRayo', 'stop', 2)).toBe(true);
    expect(d.offer(0.02, 'driverFast', 'driver', 4)).toBe(false);
    expect(d.pending?.trigger).toBe('stopRayo');
  });

  it('drops a line that is blocked or stale instead of queueing it', () => {
    const d = createAmbientDirector(lucky);
    d.offer(0, 'driverHit', 'driver', 1);
    expect(d.take(0.2, true)).toBeNull();
    expect(d.pending).toBeNull();
    expect(d.take(0.3, false)).toBeNull();

    const late = createAmbientDirector(lucky);
    late.offer(0, 'driverHit', 'driver', 1);
    expect(late.take(AMBIENT_VOICE.delay[0] + AMBIENT_VOICE.staleAfter + 0.5, false)).toBeNull();
  });

  it('stays silent when the roll fails, and a grind does not roll again', () => {
    const d = createAmbientDirector(() => 0.999);
    expect(d.offer(0, 'stopRayo', 'stop', 0)).toBe(false);
    let rolls = 0;
    const counting = createAmbientDirector(() => {
      rolls++;
      return 0.999;
    });
    for (let i = 0; i < 10; i++) counting.offer(i * 0.016, 'driverHit', 'driver', 2);
    expect(rolls).toBe(1);
  });

  it('never repeats either of the last two clips while the pool has another', () => {
    let r = 0;
    const d = createAmbientDirector(() => ((r = (r + 0.37) % 1), r));
    const played: string[] = [];
    let t = 0;
    for (let i = 0; i < 60; i++) {
      t += 40;
      if (!d.offer(t, 'stopFast', 'stop', i)) continue;
      const line = d.take(t + 0.5, false);
      if (!line) continue;
      played.push(line.clip);
      d.ended();
    }
    expect(played.length).toBeGreaterThan(3);
    for (let i = 1; i < played.length; i++) {
      expect(played[i]).not.toBe(played[i - 1]);
      if (i > 1) expect(played[i]).not.toBe(played[i - 2]);
    }
  });

  it('only ever names clips that exist', () => {
    for (const pool of Object.values(AMBIENT_LINES)) for (const id of pool) expect(AMBIENT_CLIPS[id]).toBeTruthy();
  });
});

describe('near miss classification', () => {
  const car = (heading: number): TargetState =>
    ({ id: 0, x: 0, z: 0, y: 0, heading, speed: 10, vx: 0, vz: 0, status: 'active' }) as TargetState;

  it('calls a finish in front of the bonnet a cut-up, and one alongside a close pass', () => {
    // Heading 0 drives toward -z.
    expect(nearMissTrigger(car(0), 0.5, -3)).toBe('driverCut');
    expect(nearMissTrigger(car(0), 2.5, 0)).toBe('driverClose');
    expect(nearMissTrigger(car(0), 0, 3)).toBe('driverClose');
  });
});

describe('bus stop crowds', () => {
  const stops: BusStopDef[] = Array.from({ length: 30 }, (_, i) => ({
    x: i * 100,
    z: 50,
    y: 0,
    tx: 1,
    tz: 0,
    nx: 0,
    nz: 1,
    zone: 'downtown' as BusStopDef['zone'],
    route: 0,
  }));

  it('puts two to four people under some stops, the same every time, inside the shelter', () => {
    const crowds = busStopCrowds(stops);
    expect(crowds.length).toBeGreaterThan(0);
    expect(crowds.length).toBeLessThan(stops.length);
    expect(busStopCrowds(stops.map((s) => ({ ...s })))).toEqual(crowds);
    for (const c of crowds) {
      expect(c.waiters.length).toBeGreaterThanOrEqual(AMBIENT_VOICE.stop.minWaiting);
      expect(c.waiters.length).toBeLessThanOrEqual(AMBIENT_VOICE.stop.maxWaiting);
      for (const w of c.waiters) {
        expect(Math.abs(w.x - c.x)).toBeLessThanOrEqual(BUS_STOP.length / 2);
        expect(Math.abs(w.z - c.z)).toBeLessThanOrEqual(BUS_STOP.depth / 2);
      }
    }
  });
});
