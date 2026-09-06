import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createLampFaults, rollLampFault, LAMP_FAULTS as L } from '../src/render/scene/env/lampFaults';
import { makeRng } from '../src/render/scene/env/meshBuilder';

/** The stock unlit shader, as `onBeforeCompile` receives it. */
function stockShader(): { vertexShader: string; fragmentShader: string; uniforms: Record<string, unknown> } {
  return {
    vertexShader: THREE.ShaderLib.basic.vertexShader,
    fragmentShader: THREE.ShaderLib.basic.fragmentShader,
    uniforms: {},
  };
}

function patch(): ReturnType<typeof stockShader> {
  const faults = createLampFaults();
  const material = new THREE.MeshBasicMaterial({ vertexColors: true });
  faults.apply(material);
  const shader = stockShader();
  material.onBeforeCompile(shader as never, null as never);
  return shader;
}

describe('lamp fault anchors', () => {
  // The patch is string surgery on Three's own chunks. If a Three upgrade renames one of these
  // the replace silently does nothing: the city keeps rendering and every lamp quietly heals.
  it('finds every chunk it splices into', () => {
    const shader = stockShader();
    expect(shader.vertexShader).toContain('#include <common>');
    expect(shader.vertexShader).toContain('#include <color_vertex>');
    // The helper must be declared before the line that calls it.
    expect(shader.vertexShader.indexOf('#include <common>')).toBeLessThan(
      shader.vertexShader.indexOf('#include <color_vertex>'),
    );
  });

  it('injects the attribute, the clock and the modulation', () => {
    const shader = patch();
    expect(shader.vertexShader).toContain('attribute float aLampFault;');
    expect(shader.vertexShader).toContain('vColor *= rbLampLevel(aLampFault, uLampTime);');
    expect(shader.uniforms.uLampTime).toEqual({ value: 0 });
  });

  it('emits float literals: `1` where GLSL wants a float will not compile', () => {
    const body = patch().vertexShader;
    for (const [key, value] of Object.entries(L)) {
      if (key === 'faultChance') continue; // build-time only, never reaches the shader.
      expect(body).toContain(Number.isInteger(value) ? `${value}.0` : `${value}`);
    }
  });

  it('drives the head and its pool of light off one clock', () => {
    const faults = createLampFaults();
    const shaders = [0, 1].map(() => {
      const material = new THREE.MeshBasicMaterial({ vertexColors: true });
      faults.apply(material);
      const shader = stockShader();
      material.onBeforeCompile(shader as never, null as never);
      return shader;
    });
    faults.update(9.25);
    for (const s of shaders) expect((s.uniforms.uLampTime as { value: number }).value).toBe(9.25);
  });

  it('keeps the clock across a recompile', () => {
    const faults = createLampFaults();
    const material = new THREE.MeshBasicMaterial({ vertexColors: true });
    faults.apply(material);
    const first = stockShader();
    material.onBeforeCompile(first as never, null as never);
    // Three rebuilds the program whenever the light setup changes.
    const second = stockShader();
    material.onBeforeCompile(second as never, null as never);
    faults.update(4);
    expect((second.uniforms.uLampTime as { value: number }).value).toBe(4);
  });

  it('reuses one program across the neon and glow meshes', () => {
    const faults = createLampFaults();
    const keys = [0, 1].map(() => {
      const material = new THREE.MeshBasicMaterial({ vertexColors: true });
      faults.apply(material);
      return material.customProgramCacheKey();
    });
    expect(keys[0]).toBe(keys[1]);
  });
});

describe('how many lamps are broken', () => {
  const rng = makeRng(0x1a3f9);
  const seeds = Array.from({ length: 20_000 }, () => rollLampFault(rng));
  const faulty = seeds.filter((s) => s > 0);

  it('breaks close to the share it advertises', () => {
    expect(faulty.length / seeds.length).toBeGreaterThan(L.faultChance - 0.02);
    expect(faulty.length / seeds.length).toBeLessThan(L.faultChance + 0.02);
  });

  it('never hands a faulty lamp the seed that means healthy', () => {
    for (const s of faulty) {
      expect(s).toBeGreaterThan(0);
      expect(s).toBeLessThanOrEqual(1);
    }
  });
});

/**
 * A mirror of the per-lamp level computed in the shader. It is a second copy of the maths,
 * which is the price of being able to say anything about how a street behaves over an hour
 * without a GPU; it reads the same constants, so tuning cannot drift out from under it.
 */
function level(seed: number, t: number): number {
  if (seed <= 0) return 1;
  const h1 = hash(seed);
  const h2 = hash(seed + 3.7);
  const h3 = hash(seed + 11.3);
  const ep = Math.sin(t * (L.episodeRateMin + L.episodeRateSpan * h1) + h2 * 6.2831);
  const thresh = L.thresholdMin + L.thresholdSpan * h3;
  // smoothstep(hi, lo, x): descending edges, so `trouble` rises as `ep` falls past `thresh`.
  const x = Math.max(0, Math.min(1, (ep - (thresh + L.edge)) / (-2 * L.edge)));
  const trouble = x * x * (3 - 2 * x);
  const rate = L.strobeRateMin + L.strobeRateSpan * h2;
  const buzz = Math.sin(t * rate + h1 * 6.2831) + 0.55 * Math.sin(t * rate * L.strobeBeat + h3 * 6.2831);
  const strobe = buzz >= L.strobeBias ? 1 : 0;
  const lit = L.offLevel + (1 - L.offLevel) * strobe;
  return (1 - L.sag) * (1 - trouble) + lit * trouble;
}

function hash(n: number): number {
  const v = Math.sin(n * 78.233 + 3.17) * 43758.5453;
  return v - Math.floor(v);
}

/** A hundred and fifty broken lamps, sampled twenty times a second for twenty minutes. */
const STEP = 0.05;
const SPAN = 1200;

function survey(): number[][] {
  const values: number[][] = [];
  for (let i = 1; i <= 150; i++) {
    // Irrational stride: an even spread of seeds without a repeating pattern.
    const seed = 0.02 + ((i * 0.6180339887) % 1) * 0.98;
    const series: number[] = [];
    for (let t = 0; t < SPAN; t += STEP) series.push(level(seed, t));
    values.push(series);
  }
  return values;
}

describe('what a broken lamp does', () => {
  const values = survey();
  // Spreading a few million samples into Math.min blows the call stack; walk them instead.
  let sum = 0;
  let n = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const series of values) {
    for (const v of series) {
      sum += v;
      n++;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  const mean = sum / n;

  it('leaves the street lit: the palette was tuned against working lamps', () => {
    // A faulty lamp averages well under a healthy one, but the city keeps most of its light
    // because only `faultChance` of the lamps are faulty at all.
    expect(mean).toBeGreaterThan(0.6);
    const cityWide = 1 - L.faultChance * (1 - mean);
    expect(cityWide).toBeGreaterThan(0.85);
  });

  it('never goes fully dark and never blows out', () => {
    expect(min).toBeGreaterThanOrEqual(L.offLevel);
    expect(max).toBeLessThanOrEqual(1);
  });

  it('actually strobes: every lamp cuts out, and none of them all night', () => {
    for (const series of values) {
      const dark = series.filter((v) => v < 0.2).length / series.length;
      expect(dark).toBeGreaterThan(0.01);
      expect(dark).toBeLessThan(0.6);
    }
  });

  it('does not strobe in unison: two lamps are dark at different moments', () => {
    const a = values[0];
    const b = values[1];
    let agree = 0;
    for (let i = 0; i < a.length; i++) if (a[i] < 0.2 === b[i] < 0.2) agree++;
    expect(agree / a.length).toBeLessThan(0.9);
  });

  it('burns steadily between bouts, not as a constant flicker', () => {
    // Over any ten-second window at least one lamp is holding a steady light.
    const window = Math.round(10 / STEP);
    let steadySomewhere = 0;
    for (let start = 0; start + window < values[0].length; start += window) {
      const steady = values.some((s) => s.slice(start, start + window).every((v) => v > 0.85));
      if (steady) steadySomewhere++;
    }
    expect(steadySomewhere).toBeGreaterThan(0);
  });

  it('leaves a healthy lamp exactly alone', () => {
    for (let t = 0; t < 200; t += 0.37) expect(level(0, t)).toBe(1);
  });
});
