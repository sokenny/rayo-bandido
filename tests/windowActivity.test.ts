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
    const shader = patch().fragmentShader;
    const body = shader.slice(shader.indexOf('vec2 winUv'));
    // Every constant spliced in carries a decimal point.
    for (const value of Object.values(A).flat()) {
      expect(body).toContain(Number.isInteger(value) ? `${value}.0` : `${value}`);
    }
  });

  it('leaves the concrete and the dark panes alone', () => {
    const body = patch().fragmentShader;
    // Everything is behind the glass mask; without it the facade itself would lift.
    expect(body).toContain('float glass = smoothstep(');
    expect(body).toContain('mix(vec3(1.0), amount * tint, glass)');
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
 * A mirror of the per-window factor computed in the shader, including where in the pane the
 * sample sits. It is a second copy of the maths, which is the price of being able to say
 * anything about how a window behaves over an hour without a GPU; it reads the same
 * constants, so tuning cannot drift out from under it.
 */
interface Window {
  wa: number;
  wb: number;
  wc: number;
  wd: number;
  we: number;
  wg: number;
  wf: number;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function level(w: Window, t: number, subX: number, subY: number): number {
  const room = A.baseMin + A.baseSpan * w.wd;
  const breath =
    1 - A.breathDepth * (0.5 + 0.5 * Math.sin(t * (A.breathRateMin + A.breathRateSpan * w.wa) + w.wb * 6.2831));

  const saw = (t * (A.walkRateMin + A.walkRateSpan * w.wc) + w.wb) % 1;
  const walk = saw / A.walkSpan;
  const dx = (subX - (0.12 + 0.76 * walk)) / A.walkWidth;
  let body = Math.max(0, 1 - dx * dx) ** 2;
  body *= smoothstep(0, 0.15, walk) * smoothstep(1, 0.85, walk);
  body *= 0.55 + 0.45 * smoothstep(0.78, 0.22, subY);
  const here = (walk <= 1 ? 1 : 0) * (w.wg <= A.presenceChance ? 1 : 0);
  const shadow = 1 - here * A.walkDepth * body;

  const wave =
    0.6 * Math.sin(t * (4 + 2.6 * w.wa) + w.wb * 6.2831) + 0.4 * Math.sin(t * (1.7 + 1.3 * w.wc) + w.wa * 6.2831);
  const tv = 1 + (w.we >= 1 - A.tvChance ? 1 : 0) * A.tvDepth * wave * (0.55 + 0.9 * subX);

  const cycle = Math.sin(t * (A.cycleRateMin + A.cycleRateSpan * w.wb) + w.wc * 6.2831 + w.wf * 1.7);
  const bias = A.biasMin + A.biasSpan * w.wa;
  const occupied = smoothstep(bias - A.edge, bias + A.edge, cycle);
  const lit = A.offLevel + (1 - A.offLevel) * occupied;

  return Math.min(A.cap, A.norm * room * breath * lit * tv * shadow);
}

/** Two hundred windows, spread evenly over the hash space. */
function windows(): Window[] {
  const out: Window[] = [];
  for (let i = 0; i < 200; i++) {
    // Irrational strides: an even spread of the hashes without a repeating pattern.
    out.push({
      wa: (i * 0.6180339887) % 1,
      wb: (i * 0.7548776662) % 1,
      wc: (i * 0.5698402909) % 1,
      wd: (i * 0.8191725134) % 1,
      we: (i * 0.430159709) % 1,
      wg: (i * 0.3247179572) % 1,
      wf: (i * 0.2360679775) % 1,
    });
  }
  return out;
}

const STEP = 0.05;
const SAMPLES: [number, number][] = [
  [0.25, 0.4],
  [0.5, 0.5],
  [0.75, 0.6],
];

describe('what a window does', () => {
  const all = windows();

  it('leaves the city at the brightness the palette was drawn for', () => {
    let sum = 0;
    let n = 0;
    for (const w of all) {
      for (const [x, y] of SAMPLES) {
        for (let t = 0; t < 600; t += 0.25) {
          sum += level(w, t, x, y);
          n++;
        }
      }
    }
    expect(sum / n).toBeGreaterThan(0.96);
    expect(sum / n).toBeLessThan(1.04);
  });

  it('never goes fully dark and never blows out', () => {
    let min = Infinity;
    let max = -Infinity;
    for (const w of all) {
      for (const [x, y] of SAMPLES) {
        for (let t = 0; t < 600; t += STEP) {
          const v = level(w, t, x, y);
          if (v < min) min = v;
          if (v > max) max = v;
        }
      }
    }
    expect(min).toBeGreaterThan(0.02);
    expect(max).toBeLessThanOrEqual(A.cap);
  });

  it('gives every lit window something to do inside a minute', () => {
    // The complaint this whole file exists to answer: a pane that just sits there.
    const still = all.filter((w) => {
      let lo = Infinity;
      let hi = -Infinity;
      for (let t = 0; t < 60; t += STEP) {
        const v = level(w, t, 0.5, 0.5);
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      return hi - lo < 0.12;
    });
    expect(still).toHaveLength(0);
  });

  it('walks a shadow across the pane rather than dimming it whole', () => {
    const w = all.find((x) => x.wg <= A.presenceChance);
    expect(w).toBeDefined();
    if (!w) return;
    // Where the darkest point sits, left to right, as one crossing plays out.
    const period = 1 / (A.walkRateMin + A.walkRateSpan * w.wc);
    const start = (1 - w.wb) * period;
    const columns = [0.2, 0.35, 0.5, 0.65, 0.8];
    const darkestAt: number[] = [];
    for (let f = 0.2; f <= 0.8; f += 0.15) {
      const t = start + f * A.walkSpan * period;
      let best = 0;
      let bestValue = Infinity;
      for (const c of columns) {
        const v = level(w, t, c, 0.5);
        if (v < bestValue) {
          bestValue = v;
          best = c;
        }
      }
      darkestAt.push(best);
    }
    // It sweeps: each sample is at or to the right of the last, and it covers ground.
    for (let i = 1; i < darkestAt.length; i++) expect(darkestAt[i]).toBeGreaterThanOrEqual(darkestAt[i - 1]);
    expect(darkestAt[darkestAt.length - 1] - darkestAt[0]).toBeGreaterThan(0.3);
  });

  it('darkens the glass enough for the pass to be visible', () => {
    const w = all.find((x) => x.wg <= A.presenceChance);
    expect(w).toBeDefined();
    if (!w) return;
    let lit = 0;
    let shaded = Infinity;
    for (let t = 0; t < 120; t += STEP) {
      const v = level(w, t, 0.5, 0.5);
      if (v > lit) lit = v;
      if (v < shaded) shaded = v;
    }
    expect(shaded).toBeLessThan(lit * 0.7);
  });

  it('keeps most rooms lit, with about one in twelve dark at any moment', () => {
    let dark = 0;
    let n = 0;
    for (const w of all) {
      for (let t = 0; t < 600; t += 0.25) {
        const v = level(w, t, 0.5, 0.5);
        if (v < 0.3) dark++;
        n++;
      }
    }
    expect(dark / n).toBeGreaterThan(0.03);
    expect(dark / n).toBeLessThan(0.16);
  });
});
