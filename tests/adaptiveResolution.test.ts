import { describe, expect, it } from 'vitest';
import { createResolutionGovernor, type ResolutionGovernorOptions } from '../src/render/adaptiveResolution';
import { createGameLoop } from '../src/core/loop';

const OPTS: ResolutionGovernorOptions = {
  startRatio: 1.5,
  minRatio: 0.7,
  stepFactor: 0.85,
  downMs: 18.5,
  upMs: 11,
  gpuUpMs: 9,
  gpuIdleMs: 8,
  downWindowSeconds: 1.5,
  upWindowSeconds: 6,
  settleSeconds: 1,
  hitchMs: 66,
  enabled: true,
};

/** Feed `seconds` of identical frames; returns the first ratio change, or null. */
function feed(
  g: ReturnType<typeof createResolutionGovernor>,
  seconds: number,
  frameMs: number,
  cpuMs: number,
  gpuMs: number,
): number | null {
  const frames = Math.ceil((seconds * 1000) / frameMs);
  for (let i = 0; i < frames; i++) {
    const next = g.update(frameMs, cpuMs, gpuMs);
    if (next !== null) return next;
  }
  return null;
}

describe('resolution governor', () => {
  it('starts at the start ratio and reports auto max', () => {
    const g = createResolutionGovernor(OPTS);
    expect(g.ratio).toBe(1.5);
    expect(g.status).toBe('auto max');
  });

  it('ignores the settle period, then steps down one notch when frames are dropped on the GPU', () => {
    const g = createResolutionGovernor(OPTS);
    // Settle: one second of bad frames changes nothing.
    expect(feed(g, 0.99, 33, 3, 30)).toBeNull();
    // Then a full window of 30 fps with a busy GPU steps down once.
    const next = feed(g, 3, 33, 3, 30);
    expect(next).toBeCloseTo(1.5 * 0.85, 5);
    expect(g.ratio).toBeCloseTo(1.275, 5);
    expect(g.status).toBe('auto');
  });

  it('never steps down for a CPU-bound frame', () => {
    const g = createResolutionGovernor(OPTS);
    feed(g, 1.01, 16, 2, 5);
    // 33 ms frames where the main thread itself takes 28 ms: fewer pixels would not help.
    expect(feed(g, 6, 33, 28, 6)).toBeNull();
    expect(g.ratio).toBe(1.5);
  });

  it('never steps down while the GPU timer says the GPU is idle', () => {
    const g = createResolutionGovernor(OPTS);
    feed(g, 1.01, 16, 2, 5);
    // Long frames but a 4 ms GPU: the stall is elsewhere (vsync, a throttled tab).
    expect(feed(g, 6, 33, 3, 4)).toBeNull();
    expect(g.ratio).toBe(1.5);
  });

  it('drops hitches from the averages', () => {
    const g = createResolutionGovernor(OPTS);
    feed(g, 1.01, 16, 2, 5);
    // A pattern of good frames with the odd 200 ms hitch is not load.
    let changed: number | null = null;
    for (let i = 0; i < 400 && changed === null; i++) {
      changed = g.update(i % 40 === 0 ? 200 : 16, 2, 5);
    }
    expect(changed).toBeNull();
  });

  it('stops at the minimum ratio and reports auto min', () => {
    const g = createResolutionGovernor(OPTS);
    feed(g, 1.01, 33, 3, 30);
    for (let i = 0; i < 20; i++) feed(g, 4, 33, 3, 30);
    expect(g.ratio).toBeCloseTo(0.7, 5);
    expect(g.status).toBe('auto min');
    expect(feed(g, 4, 33, 3, 30)).toBeNull();
  });

  it('steps back up only with measured GPU headroom, and never above the start ratio', () => {
    const g = createResolutionGovernor(OPTS);
    feed(g, 1.01, 33, 3, 30);
    expect(feed(g, 3, 33, 3, 30)).not.toBeNull();
    const lowered = g.ratio;
    // Fine frames but a GPU that would not fit the next notch: stay.
    expect(feed(g, 1.01, 16, 3, 8)).toBeNull();
    expect(feed(g, 8, 16, 3, 8)).toBeNull();
    expect(g.ratio).toBe(lowered);
    // Cheap GPU frames for the whole up window: one notch back up.
    const up = feed(g, 8, 16, 3, 4);
    expect(up).toBeCloseTo(1.5, 5);
    // Already at the start ratio: no further change however cheap the frame is.
    expect(feed(g, 1.01, 16, 3, 4)).toBeNull();
    expect(feed(g, 8, 16, 3, 2)).toBeNull();
    expect(g.ratio).toBe(1.5);
  });

  it('without a GPU timer, steps up only when the interval itself proves headroom', () => {
    const g = createResolutionGovernor(OPTS);
    feed(g, 1.01, 33, 3, -1);
    expect(feed(g, 3, 33, 3, -1)).not.toBeNull();
    // 60 Hz vsync frames say nothing about headroom: stay put.
    expect(feed(g, 1.01, 16.7, 3, -1)).toBeNull();
    expect(feed(g, 8, 16.7, 3, -1)).toBeNull();
    // A 144 Hz display running at 7 ms does.
    expect(feed(g, 1.01, 7, 2, -1)).toBeNull();
    expect(feed(g, 8, 7, 2, -1)).toBeCloseTo(1.5, 5);
  });

  it('can be pinned and then never moves', () => {
    const g = createResolutionGovernor(OPTS);
    g.set(1);
    expect(g.ratio).toBe(1);
    expect(g.status).toBe('locked');
    expect(feed(g, 10, 40, 3, 35)).toBeNull();
  });

  it('is inert when disabled', () => {
    const g = createResolutionGovernor({ ...OPTS, enabled: false });
    expect(g.status).toBe('locked');
    expect(feed(g, 10, 40, 3, 35)).toBeNull();
  });
});

describe('game loop stats', () => {
  it('exposes a stats object before the first frame', () => {
    const loop = createGameLoop({ simulate() {}, render() {} }, 1 / 60);
    expect(loop.stats).toEqual({ simMs: 0, renderMs: 0, steps: 0 });
    expect(loop.running).toBe(false);
  });
});
