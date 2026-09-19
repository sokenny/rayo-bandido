import { describe, expect, it, vi } from 'vitest';

// The turbo flutter voice fetches its recordings; there is nothing to fetch here.
vi.mock('../src/audio/sample', async (orig) => ({
  ...(await orig<typeof import('../src/audio/sample')>()),
  fetchSample: () => Promise.reject(new Error('no files in tests')),
}));

import { EXHAUST_PRESETS, EXHAUST_XFADE, createEngine, exhaustPreset, type EngineInput } from '../src/audio/engine';
import { REV_DEMO, REV_DEMO_LENGTH, REV_DEMO_LIFT_AT, revDemoRpm, revDemoThrottle } from '../src/audio/exhaustDemo';
import { IDLE_RPM01 } from '../src/audio/dsp';
import { partsOf } from '../src/content/carParts';
import type { AudioCore } from '../src/audio/core';

/* ------------------------------------------------------------------ a fake Web Audio graph */

class FakeParam {
  value: number;
  events: Array<[string, ...number[]]> = [];
  constructor(v = 0) {
    this.value = v;
  }
  setValueAtTime(v: number, t: number) {
    this.events.push(['set', v, t]);
    this.value = v;
    return this;
  }
  setTargetAtTime(v: number, t: number, tc: number) {
    this.events.push(['target', v, t, tc]);
    return this;
  }
  linearRampToValueAtTime(v: number, t: number) {
    this.events.push(['linear', v, t]);
    return this;
  }
  exponentialRampToValueAtTime(v: number, t: number) {
    this.events.push(['exp', v, t]);
    return this;
  }
  cancelScheduledValues(t: number) {
    this.events.push(['cancel', t]);
    return this;
  }
}

class FakeNode {
  kind: string;
  outputs = new Set<FakeNode>();
  gain = new FakeParam(1);
  frequency = new FakeParam(350);
  Q = new FakeParam(1);
  playbackRate = new FakeParam(1);
  type = '';
  curve: Float32Array | null = null;
  oversample = 'none';
  buffer: unknown = null;
  loop = false;
  started = false;
  stopAt: number | null = null;
  onended: (() => void) | null = null;
  constructor(kind: string) {
    this.kind = kind;
  }
  connect(n: FakeNode) {
    this.outputs.add(n);
    return n;
  }
  disconnect(n?: FakeNode) {
    if (n) this.outputs.delete(n);
    else this.outputs.clear();
  }
  start() {
    this.started = true;
  }
  stop(t = 0) {
    this.stopAt = t;
  }
}

function fakeCore() {
  const created: FakeNode[] = [];
  const make = (kind: string) => () => {
    const n = new FakeNode(kind);
    created.push(n);
    return n;
  };
  let buffers = 0;
  const ctx = {
    sampleRate: 8000,
    currentTime: 0,
    createGain: make('gain'),
    createBiquadFilter: make('filter'),
    createWaveShaper: make('shaper'),
    createBufferSource: make('source'),
    createOscillator: make('osc'),
    createBuffer(_ch: number, len: number, sr: number) {
      buffers++;
      const data = new Float32Array(len);
      return { length: len, sampleRate: sr, duration: len / sr, numberOfChannels: 1, getChannelData: () => data };
    },
  };
  const master = new FakeNode('master');
  const core = { ctx, master, noise: { duration: 2 } } as unknown as AudioCore;
  return { core, ctx, created, master, buffers: () => buffers };
}

const idle: EngineInput = { rpm01: IDLE_RPM01, speed: 0, throttle: 0, brake: 0, nitro: false };

/** The source nodes that are pulse banks (looping, carrying a baked buffer, not the noise). */
const banks = (created: FakeNode[]) =>
  created.filter((n) => n.kind === 'source' && n.loop && (n.buffer as { duration: number }).duration !== 2);

/* ------------------------------------------------------------------------------ the tests */

describe('exhaust presets against the catalogue', () => {
  it('has a preset for every exhaust sound sold, and sells every preset', () => {
    const sold = partsOf('exhaustSound').map((p) => p.id).sort();
    expect(Object.keys(EXHAUST_PRESETS).sort()).toEqual(sold);
    expect(sold.length).toBeGreaterThanOrEqual(4);
  });

  it('keeps stock exactly the engine that shipped before the workshop', () => {
    expect(EXHAUST_PRESETS['exhaustSound.stock']).toEqual({
      bodyA: 118, bodyB: 92, decay: 190, h2: 0.5, h3: 0.28, grit: 0.55, gainA: 0.6, gainB: 0.5, sub: 0.5,
      clipK: 2.2, driveLo: 1, driveHi: 3.6, cutLo: 420, cutHi: 5200, filterQ: 0.9, volume: 1, hiss: 1,
      hissLo: 500, hissHi: 1600, popLevel: 1, popBite: 1, popKeep: 1, demoPop: 0.5,
    });
  });

  it('keeps every preset in sane ranges', () => {
    for (const [id, p] of Object.entries(EXHAUST_PRESETS)) {
      for (const [k, v] of Object.entries(p)) expect(Number.isFinite(v), `${id}.${k}`).toBe(true);
      expect(p.bodyA, id).toBeGreaterThan(40);
      expect(p.bodyA, id).toBeLessThan(400);
      expect(p.cutLo, id).toBeLessThan(p.cutHi);
      expect(p.driveLo, id).toBeLessThan(p.driveHi);
      expect(p.popKeep, id).toBeGreaterThanOrEqual(0);
      expect(p.popKeep, id).toBeLessThanOrEqual(1);
      expect(p.volume, id).toBeLessThanOrEqual(1.4);
    }
    expect(exhaustPreset('exhaustSound.nope')).toBe(EXHAUST_PRESETS['exhaustSound.stock']);
  });
});

describe('engine.setExhaust', () => {
  it('starts on stock and does nothing when asked for what is already playing', () => {
    const { core, created } = fakeCore();
    const engine = createEngine(core);
    expect(engine.exhaust).toBe('exhaustSound.stock');
    const before = created.length;
    engine.setExhaust('exhaustSound.stock');
    engine.setExhaust('exhaustSound.nope'); // unknown = stock = unchanged
    expect(created.length).toBe(before);
    engine.dispose();
  });

  it('crossfades to freshly baked banks at the current revs, and stops the old ones after', () => {
    const { core, ctx, created, buffers } = fakeCore();
    const engine = createEngine(core);
    engine.update(1 / 60, { ...idle, rpm01: 0.6, throttle: 1 });
    const [oldA, oldB] = banks(created);
    oldA.playbackRate.value = 1.7;
    const baked = buffers();
    ctx.currentTime = 3;
    engine.setExhaust('exhaustSound.titanium');
    expect(engine.exhaust).toBe('exhaustSound.titanium');
    expect(buffers()).toBe(baked + 2);
    const fresh = banks(created).filter((n) => n !== oldA && n !== oldB);
    expect(fresh.length).toBe(2);
    expect(fresh.every((n) => n.started)).toBe(true);
    expect(fresh[0].playbackRate.value).toBe(1.7);
    // The old banks are stopped just after the crossfade, never immediately (that would click).
    expect(oldA.stopAt).toBeGreaterThanOrEqual(3 + EXHAUST_XFADE);
    expect(oldB.stopAt).toBeGreaterThanOrEqual(3 + EXHAUST_XFADE);
    // Both fades ramp over the crossfade: the new one up to 1, the old one down to 0.
    const fades = created.filter((n) => n.kind === 'gain' && n.gain.events.some((e) => e[0] === 'linear'));
    const ramps = fades.map((f) => f.gain.events.find((e) => e[0] === 'linear')!);
    expect(ramps).toContainEqual(['linear', 1, 3 + EXHAUST_XFADE]);
    expect(ramps).toContainEqual(['linear', 0, 3 + EXHAUST_XFADE]);
    // Per-frame updates now drive the new banks, not the old.
    const oldEvents = oldA.playbackRate.events.length;
    engine.update(1 / 60, { ...idle, rpm01: 0.9, throttle: 1 });
    expect(oldA.playbackRate.events.length).toBe(oldEvents);
    expect(fresh[0].playbackRate.events.length).toBeGreaterThan(0);
    // When the old bank ends, its nodes come off the graph.
    oldA.onended?.();
    expect(oldA.outputs.size).toBe(0);
    engine.dispose();
  });

  it('builds nothing per frame', () => {
    const { core, created } = fakeCore();
    const engine = createEngine(core);
    engine.setExhaust('exhaustSound.straight');
    const before = created.length;
    for (let i = 0; i < 240; i++) {
      engine.update(1 / 60, { ...idle, rpm01: (i % 60) / 60, throttle: i % 2, limiterCut: i % 7 === 0 ? 1 : 0 });
    }
    expect(created.length).toBe(before);
    engine.dispose();
  });

  it('lets a muffler swallow some bangs, and never changes when the trigger fires them', () => {
    const { core, created } = fakeCore();
    const engine = createEngine(core);
    const bangsFor = (n: number): number => {
      const before = created.filter((c) => c.kind === 'shaper').length;
      for (let i = 0; i < n; i++) engine.backfire(0.8);
      return created.filter((c) => c.kind === 'shaper').length - before;
    };
    expect(bangsFor(50)).toBe(50); // stock: every bang is heard
    engine.setExhaust('exhaustSound.quiet');
    const heard = bangsFor(400);
    expect(heard).toBeGreaterThan(40);
    expect(heard).toBeLessThan(260);
    engine.dispose();
  });
});

describe('the workshop rev demo', () => {
  it('blips up from idle, holds, lifts and settles back, all inside its length', () => {
    expect(revDemoRpm(0)).toBe(IDLE_RPM01);
    expect(revDemoRpm(REV_DEMO.RISE / 2)).toBeGreaterThan(IDLE_RPM01);
    expect(revDemoRpm(REV_DEMO.RISE + 0.01)).toBe(REV_DEMO.PEAK_RPM01);
    expect(revDemoRpm(REV_DEMO_LIFT_AT + 0.2)).toBeLessThan(REV_DEMO.PEAK_RPM01);
    expect(revDemoRpm(REV_DEMO_LENGTH - 1e-6)).toBeCloseTo(IDLE_RPM01, 3);
    expect(revDemoRpm(REV_DEMO_LENGTH + 1)).toBe(IDLE_RPM01);
    expect(revDemoThrottle(0.05)).toBe(1);
    expect(revDemoThrottle(REV_DEMO_LIFT_AT + 0.01)).toBe(0);
    let prev = 0;
    for (let t = 0.001; t < REV_DEMO_LIFT_AT; t += 0.01) {
      expect(revDemoRpm(t)).toBeGreaterThanOrEqual(prev);
      prev = revDemoRpm(t);
    }
  });

  it('revs the engine, pops once at the lift on a loud pipe, and lets go', () => {
    const { core, created } = fakeCore();
    const engine = createEngine(core);
    engine.setExhaust('exhaustSound.straight');
    const bank = banks(created).at(-1)!;
    const rateAt = (): number => {
      const e = bank.playbackRate.events.at(-1)!;
      return e[1] as number;
    };
    engine.update(1 / 60, idle);
    const idleRate = rateAt();
    engine.revDemo();
    const shapersBefore = created.filter((c) => c.kind === 'shaper').length;
    let peak = 0;
    for (let t = 0; t < REV_DEMO_LENGTH + 0.3; t += 1 / 60) {
      engine.update(1 / 60, idle);
      peak = Math.max(peak, rateAt());
    }
    expect(peak).toBeGreaterThan(idleRate * 1.8);
    expect(created.filter((c) => c.kind === 'shaper').length - shapersBefore).toBe(1);
    expect(rateAt()).toBeCloseTo(idleRate, 5);
    engine.dispose();
  });

  it('does not pop on the muffled exhaust', () => {
    const { core, created } = fakeCore();
    const engine = createEngine(core);
    engine.setExhaust('exhaustSound.quiet');
    engine.revDemo();
    const before = created.filter((c) => c.kind === 'shaper').length;
    for (let t = 0; t < REV_DEMO_LENGTH + 0.3; t += 1 / 60) engine.update(1 / 60, idle);
    expect(created.filter((c) => c.kind === 'shaper').length).toBe(before);
    engine.dispose();
  });
});
