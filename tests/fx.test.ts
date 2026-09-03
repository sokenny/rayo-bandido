import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  QUAD_FLOATS,
  buildBoltPoints,
  clearQuad,
  emissionCount,
  polylineToSegments,
  ringNext,
  writeQuad,
} from '../src/render/fx/shapes';
import {
  formatPoints,
  hexToRgbTriplet,
  popupAlpha,
  popupRise,
  popupScale,
  POPUP_KILL,
  POPUP_NEAR_MISS,
} from '../src/render/fx/scorePopup';
import { createNitroExhaust } from '../src/render/fx/nitroExhaust';
import { speedBlurStrength } from '../src/render/post/speedBlur';
import { SPEED_BLUR } from '../src/config/tuning';
import type { FxTextures } from '../src/render/fx/sprites';

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

describe('nitro exhaust backfire', () => {
  const FRAME = 1 / 60;

  /** The real textures need a 2D canvas; the exhaust only ever hands them to a material. */
  function stubTextures(): FxTextures {
    return {
      smoke: new THREE.Texture(),
      flare: new THREE.Texture(),
      spark: new THREE.Texture(),
      flame: new THREE.Texture(),
      dispose() {},
    };
  }

  /** Build an exhaust with the tips parked at a known pose and the boost cold. */
  function coldExhaust() {
    const parent = new THREE.Group();
    const exhaust = createNitroExhaust(parent, stubTextures());
    exhaust.set(FRAME, 0, -0.5, 0.35, 2, 0.5, 0.35, 2, 0, 1, 0, 0);
    exhaust.update(FRAME, 0);
    return exhaust;
  }

  function alphas(exhaust: ReturnType<typeof createNitroExhaust>): [number, number] {
    const a = exhaust.flames.geometry.getAttribute('aAlpha');
    return [a.getX(0), a.getX(1)];
  }

  it('is fully dark with the boost cold and nothing popping', () => {
    const exhaust = coldExhaust();
    expect(exhaust.flames.visible).toBe(false);
    expect(alphas(exhaust)).toEqual([0, 0]);
    exhaust.dispose();
  });

  it('lights both tips unevenly on a pop, with no nitro', () => {
    const exhaust = coldExhaust();
    exhaust.backfire(1);
    exhaust.update(FRAME, 0);

    expect(exhaust.flames.visible).toBe(true);
    const [left, right] = alphas(exhaust);
    expect(Math.min(left, right)).toBeGreaterThan(0);
    expect(Math.max(left, right)).toBeLessThanOrEqual(1);
    // One pipe leads, the other answers — they must never flash in lockstep.
    expect(left).not.toBeCloseTo(right, 3);
    // A pop is combustion, not boost: it must not drip nitro trail particles.
    expect(exhaust.trail.visible).toBe(false);
    exhaust.dispose();
  });

  it('burns the tips red-orange, never nitro magenta', () => {
    const exhaust = coldExhaust();
    const colors = exhaust.flames.geometry.getAttribute('color');
    // Neutral while idle, so the nitro flame keeps the sprite's own palette.
    expect([colors.getX(0), colors.getY(0), colors.getZ(0)]).toEqual([1, 1, 1]);

    exhaust.backfire(1);
    exhaust.update(FRAME, 0);
    // The lead tip: red held at full, green and blue pulled down out of the magenta.
    const lead = alphas(exhaust)[0] > alphas(exhaust)[1] ? 0 : 1;
    expect(colors.getX(lead)).toBeCloseTo(1, 5);
    expect(colors.getY(lead)).toBeLessThan(0.5);
    expect(colors.getZ(lead)).toBeLessThan(colors.getY(lead));
    exhaust.dispose();
  });

  it('decays back to dark within a couple of hundred milliseconds', () => {
    const exhaust = coldExhaust();
    exhaust.backfire(1);
    exhaust.update(FRAME, 0);
    const peak = Math.max(...alphas(exhaust));

    exhaust.update(4 * FRAME, 0.07);
    const mid = Math.max(...alphas(exhaust));
    expect(mid).toBeLessThan(peak);
    expect(mid).toBeGreaterThan(0);

    for (let i = 0; i < 20; i++) exhaust.update(FRAME, 0.1 + i * FRAME);
    expect(alphas(exhaust)).toEqual([0, 0]);
    expect(exhaust.flames.visible).toBe(false);
    exhaust.dispose();
  });

  it('scales the flash with strength and ignores a zero-strength pop', () => {
    const weak = coldExhaust();
    weak.backfire(0.2);
    weak.update(FRAME, 0);
    const strong = coldExhaust();
    strong.backfire(1);
    strong.update(FRAME, 0);
    expect(Math.max(...alphas(weak))).toBeLessThan(Math.max(...alphas(strong)));

    const none = coldExhaust();
    none.backfire(0);
    none.update(FRAME, 0);
    expect(none.flames.visible).toBe(false);
    weak.dispose();
    strong.dispose();
    none.dispose();
  });

  it('clears a live flash on reset', () => {
    const exhaust = coldExhaust();
    exhaust.backfire(1);
    exhaust.update(FRAME, 0);
    exhaust.reset();
    expect(alphas(exhaust)).toEqual([0, 0]);
    expect(exhaust.flames.visible).toBe(false);
    exhaust.dispose();
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

  it('keeps a kill and a near miss visually unmistakable', () => {
    // A kill is a bare acid number; a pass is cyan and captioned. Sharing the pool is fine,
    // sharing a look is not.
    expect(POPUP_KILL.caption).toBeUndefined();
    expect(POPUP_NEAR_MISS.caption).toBe('NEAR MISS');
    expect(POPUP_NEAR_MISS.accent).not.toBe(POPUP_KILL.accent);
  });

  it('turns a style accent into an rgb triplet for its glow', () => {
    expect(hexToRgbTriplet('#4ff3ff')).toBe('79, 243, 255');
    expect(hexToRgbTriplet('a8ff3e')).toBe('168, 255, 62');
    expect(hexToRgbTriplet('#fff')).toBe('255, 255, 255');
  });
});

describe('nitro speed blur strength', () => {
  it('stays off with the boost cold, however fast the car is going', () => {
    expect(speedBlurStrength(0, 50)).toBe(0);
  });

  it('stays off while boosting below the speed threshold', () => {
    expect(speedBlurStrength(1, SPEED_BLUR.speedStart)).toBe(0);
    expect(speedBlurStrength(1, 0)).toBe(0);
    expect(speedBlurStrength(1, -20)).toBe(0);
  });

  it('ramps in with speed and saturates at 1', () => {
    const mid = (SPEED_BLUR.speedStart + SPEED_BLUR.speedFull) / 2;
    expect(speedBlurStrength(1, mid)).toBeCloseTo(0.5, 5);
    expect(speedBlurStrength(1, SPEED_BLUR.speedFull)).toBe(1);
    expect(speedBlurStrength(1, SPEED_BLUR.speedFull * 3)).toBe(1);
  });

  it('scales with the eased boost intensity, so it fades in and out with the flames', () => {
    expect(speedBlurStrength(0.5, SPEED_BLUR.speedFull)).toBeCloseTo(0.5, 5);
    let previous = -1;
    for (let i = 0; i <= 10; i++) {
      const s = speedBlurStrength(i / 10, SPEED_BLUR.speedFull);
      expect(s).toBeGreaterThanOrEqual(previous);
      previous = s;
    }
  });
});
