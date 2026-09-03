import { describe, expect, it } from 'vitest';
import {
  QUAD_FLOATS,
  buildBoltPoints,
  clearQuad,
  emissionCount,
  polylineToSegments,
  ringNext,
  writeQuad,
} from '../src/render/fx/shapes';
import { formatPoints, popupAlpha, popupRise, popupScale } from '../src/render/fx/scorePopup';

describe('ring buffers', () => {
  it('wraps back to zero at capacity', () => {
    expect(ringNext(0, 3)).toBe(1);
    expect(ringNext(1, 3)).toBe(2);
    expect(ringNext(2, 3)).toBe(0);
  });
});

describe('skid mark quads', () => {
  it('writes four coplanar vertices offset by the half width', () => {
    const positions = new Float32Array(QUAD_FLOATS * 2);
    // a -> b along +X, so the normal is +Z.
    writeQuad(positions, 1, 0, 0, 2, 0, 0, 1, 0.15, 0.02);
    const o = QUAD_FLOATS;
    const expected = [0, 0.02, -0.15, 0, 0.02, 0.15, 2, 0.02, 0.15, 2, 0.02, -0.15];
    for (let i = 0; i < expected.length; i++) {
      expect(positions[o + i]).toBeCloseTo(expected[i], 5);
    }
    // The untouched quad stays at the origin.
    expect(positions.slice(0, QUAD_FLOATS).every((v) => v === 0)).toBe(true);
  });

  it('collapses a recycled quad so it rasterizes nothing', () => {
    const positions = new Float32Array(QUAD_FLOATS);
    writeQuad(positions, 0, 1, 1, 3, 4, 0, 1, 0.2, 0.02);
    clearQuad(positions, 0);
    expect(positions.every((v) => v === 0)).toBe(true);
  });
});

describe('lightning bolt generation', () => {
  const segments = 24;
  const points = segments + 1;

  it('anchors both endpoints exactly and fills every point', () => {
    const out = new Float32Array(points * 3);
    buildBoltPoints(out, segments, 1, 0.9, -2, 9, 0.8, 6, 0.8, 0.4);
    expect(out[0]).toBeCloseTo(1);
    expect(out[1]).toBeCloseTo(0.9);
    expect(out[2]).toBeCloseTo(-2);
    const last = segments * 3;
    expect(out[last]).toBeCloseTo(9);
    expect(out[last + 1]).toBeCloseTo(0.8);
    expect(out[last + 2]).toBeCloseTo(6);
    expect(out.every((v) => Number.isFinite(v))).toBe(true);
  });

  it('keeps the jitter inside the requested amplitude', () => {
    const out = new Float32Array(points * 3);
    const amplitude = 0.8;
    const bow = 0.4;
    const x0 = 0;
    const z0 = 0;
    const x1 = 20;
    const z1 = 0;
    const budget = amplitude * 1.6 + bow + 1e-4;
    for (let attempt = 0; attempt < 40; attempt++) {
      buildBoltPoints(out, segments, x0, 0.9, z0, x1, 0.8, z1, amplitude, bow);
      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const baseX = x0 + (x1 - x0) * t;
        const baseY = 0.9 + (0.8 - 0.9) * t;
        const baseZ = z0 + (z1 - z0) * t;
        const dx = out[i * 3] - baseX;
        const dy = out[i * 3 + 1] - baseY;
        const dz = out[i * 3 + 2] - baseZ;
        expect(Math.sqrt(dx * dx + dy * dy + dz * dz)).toBeLessThanOrEqual(budget);
      }
    }
  });

  it('survives a degenerate zero-length bolt', () => {
    const out = new Float32Array(points * 3);
    buildBoltPoints(out, segments, 4, 0.9, 4, 4, 0.9, 4, 0.5, 0.2);
    expect(out.every((v) => Number.isFinite(v))).toBe(true);
  });
});

describe('branch expansion', () => {
  it('turns a polyline into duplicated segment endpoints', () => {
    const src = new Float32Array([0, 0, 0, 1, 1, 1, 2, 2, 2]);
    const dst = new Float32Array(4 * 3);
    const written = polylineToSegments(src, 3, dst, 0);
    expect(written).toBe(4);
    expect([...dst]).toEqual([0, 0, 0, 1, 1, 1, 1, 1, 1, 2, 2, 2]);
  });

  it('writes nothing for a single point', () => {
    const dst = new Float32Array(6);
    expect(polylineToSegments(new Float32Array([1, 2, 3]), 1, dst, 0)).toBe(0);
    expect([...dst]).toEqual([0, 0, 0, 0, 0, 0]);
  });
});

describe('emission accumulator', () => {
  it('releases whole particles and caps frame spikes', () => {
    expect(emissionCount(0.9, 8)).toBe(0);
    expect(emissionCount(3.4, 8)).toBe(3);
    expect(emissionCount(120, 8)).toBe(8);
  });
});

describe('score popups', () => {
  it('formats a reward as a signed integer label', () => {
    expect(formatPoints(100)).toBe('+100');
    expect(formatPoints(1500.4)).toBe('+1500');
    expect(formatPoints(-5)).toBe('+0');
    expect(formatPoints(Number.NaN)).toBe('+0');
  });

  it('punches in past full size, then settles', () => {
    expect(popupScale(0)).toBeLessThan(1);
    expect(popupScale(0.1)).toBeGreaterThan(1);
    expect(popupScale(0.24)).toBeCloseTo(1, 5);
    expect(popupScale(0.8)).toBe(1);
  });

  it('holds full opacity before fading to nothing', () => {
    expect(popupAlpha(0)).toBe(1);
    expect(popupAlpha(0.5)).toBe(1);
    expect(popupAlpha(0.8)).toBeGreaterThan(0);
    expect(popupAlpha(0.8)).toBeLessThan(1);
    expect(popupAlpha(1)).toBeCloseTo(0, 5);
  });

  it('rises monotonically and never falls back', () => {
    expect(popupRise(0)).toBeCloseTo(0, 5);
    let previous = -1;
    for (let i = 0; i <= 10; i++) {
      const y = popupRise(i / 10);
      expect(y).toBeGreaterThanOrEqual(previous);
      previous = y;
    }
    expect(popupRise(1)).toBeGreaterThan(1);
  });
});
