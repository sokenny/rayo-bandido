import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createWindowActivity, WINDOW_ACTIVITY as A } from '../src/render/scene/env/windowActivity';

/** The stock shader, as `onBeforeCompile` receives it. */
function stockShader(): { vertexShader: string; fragmentShader: string; uniforms: Record<string, unknown> } {
  return {
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    uniforms: {},
  };
}

function patch(): ReturnType<typeof stockShader> {
  const activity = createWindowActivity();
  const material = new THREE.MeshStandardMaterial();
  activity.apply(material, 5, 5, 2.7);
  const shader = stockShader();
  material.onBeforeCompile(shader as never, null as never);
  return shader;
}

describe('window activity anchors', () => {
  // The patch is string surgery on Three's own chunks. If a Three upgrade renames one of these
  // the replace silently does nothing: the city keeps rendering and quietly stops living.
  it('finds every chunk it splices into', () => {
    const shader = stockShader();
    expect(shader.vertexShader).toContain('#include <begin_vertex>');
    expect(shader.vertexShader).toContain('#include <common>');
    expect(shader.fragmentShader).toContain('#include <emissivemap_fragment>');
    expect(shader.fragmentShader).toContain('#include <common>');
    // The plane offset is taken from the normal set up before `begin_vertex`.
    expect(shader.vertexShader.indexOf('#include <beginnormal_vertex>')).toBeLessThan(
      shader.vertexShader.indexOf('#include <begin_vertex>'),
    );
    // The emissive UV is what names a window; `vUv` only exists for some map setups.
    expect(THREE.ShaderChunk.uv_pars_fragment).toContain('vEmissiveMapUv');
    expect(THREE.ShaderChunk.emissivemap_fragment).toContain('vEmissiveMapUv');
  });

  it('injects the varying, the uniforms and the modulation', () => {
    const shader = patch();
    expect(shader.vertexShader).toContain('vWinPlane =');
    expect(shader.fragmentShader).toContain('varying float vWinPlane;');
    expect(shader.fragmentShader).toContain('totalEmissiveRadiance *=');
    expect(shader.uniforms.uWinTime).toEqual({ value: 0 });
    expect(shader.uniforms.uWinGrid).toEqual({ value: new THREE.Vector2(5, 5) });
    expect(shader.uniforms.uWinSeed).toEqual({ value: 2.7 });
  });

  it('emits float literals: `1` where GLSL wants a float will not compile', () => {
    const body = patch().fragmentShader.slice(patch().fragmentShader.indexOf('vec2 winCell'));
    // Every constant spliced in carries a decimal point.
    for (const value of Object.values(A)) {
      expect(body).toContain(Number.isInteger(value) ? `${value}.0` : `${value}`);
    }
  });

  it('drives every patched material off one clock', () => {
    const activity = createWindowActivity();
    const shaders = [0, 1].map((i) => {
      const material = new THREE.MeshStandardMaterial();
      activity.apply(material, 4, 4, i);
      const shader = stockShader();
      material.onBeforeCompile(shader as never, null as never);
      return shader;
    });
    activity.update(12.5);
    for (const s of shaders) expect((s.uniforms.uWinTime as { value: number }).value).toBe(12.5);
  });

  it('reuses one program across the three zones', () => {
    const activity = createWindowActivity();
    const keys = [0, 1].map((i) => {
      const material = new THREE.MeshStandardMaterial();
      activity.apply(material, 4, 4, i);
      return material.customProgramCacheKey();
    });
    expect(keys[0]).toBe(keys[1]);
  });

  it('keeps the clock across a recompile', () => {
    const activity = createWindowActivity();
    const material = new THREE.MeshStandardMaterial();
    activity.apply(material, 5, 5, 1);
    const first = stockShader();
    material.onBeforeCompile(first as never, null as never);
    // Three rebuilds the program whenever the light setup changes.
    const second = stockShader();
    material.onBeforeCompile(second as never, null as never);
    activity.update(3);
    expect((second.uniforms.uWinTime as { value: number }).value).toBe(3);
  });
});

/**
 * A mirror of the per-window factor computed in the shader. It is a second copy of the maths,
 * which is the price of being able to say anything about how the city behaves over an hour
 * without a GPU; it reads the same constants, so tuning cannot drift out from under it.
 */
function level(wa: number, wb: number, wc: number, wf: number, t: number): number {
  const breath = 1 - A.breathDepth * (0.5 + 0.5 * Math.sin(t * (A.breathRateMin + A.breathRateSpan * wa) + wb * 6.2831));
  const cycle = Math.sin(t * (A.cycleRateMin + A.cycleRateSpan * wb) + wc * 6.2831 + wf * 1.7);
  const bias = A.biasMin + A.biasSpan * wa;
  const x = Math.max(0, Math.min(1, (cycle - (bias - A.edge)) / (2 * A.edge)));
  const occupied = x * x * (3 - 2 * x);
  const lit = A.offLevel + (1 - A.offLevel) * occupied;
  const tv =
    1 +
    (wc >= 1 - A.tvChance ? 1 : 0) *
      A.tvDepth *
      Math.sin(t * (0.45 + 0.4 * wa) + 1.2 * Math.sin(t * (0.25 + 0.2 * wb)));
  return A.norm * breath * lit * tv;
}

/** Four hundred windows, sampled ten times a second for an hour. */
const STEP = 0.1;

function survey(): number[][] {
  const values: number[][] = [];
  for (let i = 0; i < 400; i++) {
    // Irrational strides: an even spread of the four hashes without a repeating pattern.
    const wa = (i * 0.6180339887) % 1;
    const wb = (i * 0.7548776662) % 1;
    const wc = (i * 0.5698402909) % 1;
    const wf = (i * 0.8191725134) % 1;
    const series: number[] = [];
    for (let t = 0; t < 3600; t += STEP) series.push(level(wa, wb, wc, wf, t));
    values.push(series);
  }
  return values;
}

function stats(values: number[][]): { mean: number; min: number; max: number; darkFraction: number } {
  let sum = 0;
  let n = 0;
  let min = Infinity;
  let max = -Infinity;
  let dark = 0;
  for (const series of values) {
    for (const v of series) {
      sum += v;
      n++;
      if (v < min) min = v;
      if (v > max) max = v;
      if (v < 0.4) dark++;
    }
  }
  return { mean: sum / n, min, max, darkFraction: dark / n };
}

describe('what a window does', () => {
  const values = survey();
  const { mean, min, max, darkFraction } = stats(values);

  it('leaves the city at the brightness the palette was drawn for', () => {
    expect(mean).toBeGreaterThan(0.97);
    expect(mean).toBeLessThan(1.03);
  });

  it('never goes fully dark and never blows out', () => {
    expect(min).toBeGreaterThan(0.05);
    expect(max).toBeLessThan(1.35);
  });

  it('moves slowly: nothing changes by a quarter of its brightness in a second', () => {
    let worst = 0;
    for (const series of values) {
      for (let i = 1; i < series.length; i++) worst = Math.max(worst, Math.abs(series[i] - series[i - 1]) / STEP);
    }
    expect(worst).toBeLessThan(0.25);
  });

  it('keeps most rooms lit, with about one in nine dark at any moment', () => {
    expect(darkFraction).toBeGreaterThan(0.06);
    expect(darkFraction).toBeLessThan(0.18);
  });

  it('gives every window something to do over an hour', () => {
    const still = values.filter((series) => Math.max(...series) - Math.min(...series) < 0.05).length;
    expect(still).toBe(0);
  });

  it('switches often enough to notice, rarely enough to ignore', () => {
    // One room going dark or coming back, per window, per hour. A facade in view holds
    // hundreds of windows, so a handful an hour each is a change every second or so somewhere.
    let crossings = 0;
    for (const series of values) {
      for (let i = 1; i < series.length; i++) if (series[i - 1] < 0.55 !== series[i] < 0.55) crossings++;
    }
    const perWindowPerHour = crossings / values.length;
    expect(perWindowPerHour).toBeGreaterThan(4);
    expect(perWindowPerHour).toBeLessThan(20);
  });
});
