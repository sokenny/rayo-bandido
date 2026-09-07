import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  createLampFaults,
  rollLampFault,
  lampSparkSeed,
  LAMP_FAULTS as L,
  LAMP_SPARKS as S,
} from '../src/render/scene/env/lampFaults';
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
    // The sparks move, so the patch writes to `transformed` as well as to `vColor`.
    expect(shader.vertexShader).toContain('#include <begin_vertex>');
    // The helper must be declared before the line that calls it.
    expect(shader.vertexShader.indexOf('#include <common>')).toBeLessThan(
      shader.vertexShader.indexOf('#include <color_vertex>'),
    );
  });

  it('injects the attribute, the clock and the modulation', () => {
    const shader = patch();
    expect(shader.vertexShader).toContain('attribute float aLampFault;');
    expect(shader.vertexShader).toContain('vColor *= rbLampLevel(aLampFault, uLampTime);');
    expect(shader.vertexShader).toContain('transformed += rbSparkOffset(-aLampFault, uLampTime, position.y);');
    expect(shader.uniforms.uLampTime).toEqual({ value: 0 });
  });

  it('emits float literals: `1` where GLSL wants a float will not compile', () => {
    const body = patch().vertexShader;
    for (const [key, value] of Object.entries(L)) {
      if (key === 'faultChance') continue; // build-time only, never reaches the shader.
      expect(body).toContain(Number.isInteger(value) ? `${value}.0` : `${value}`);
    }
  });

  it('emits the spark constants as float literals too', () => {
    const body = patch().vertexShader;
    for (const [key, value] of Object.entries(S)) {
      if (key === 'count') continue; // build-time only: it decides how many quads exist.
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


/**
 * A mirror of the spark, on the same terms as `level` above: same constants, same shape, so
 * both what a speck looks like and where it is can be surveyed without a GPU. Returns the
 * brightness and the offset the vertex shader would apply to a speck built `y` metres up.
 */
function spark(seed: number, index: number, t: number, y = 6.7): { level: number; dx: number; dy: number; dz: number } {
  const m = -lampSparkSeed(seed, index);
  const idx = Math.floor(m);
  const s = m - idx;
  const h1 = hash(s + 5.1);
  const h2 = hash(s + idx * 1.7 + 21.9);
  const h3 = hash(s + idx * 4.3 + 47.3);
  const period = S.periodMin + S.periodSpan * h1;
  const cycles = t / period + h1;
  const ph = (cycles - Math.floor(cycles)) * period;
  const k = (ph - h2 * S.spray) / S.life;
  if (k < 0 || k > 1) return { level: 0, dx: 0, dy: 0, dz: 0 };

  const x = Math.max(0, Math.min(1, (k - S.fadeFrom) / (1 - S.fadeFrom)));
  const fade = 1 - x * x * (3 - 2 * x);
  const chatter = S.chatterFloor + (1 - S.chatterFloor) * (Math.sin(t * S.chatterRate + h3 * 6.2831) >= 0 ? 1 : 0);

  const ha = hash(s + idx * 2.9 + 13.7);
  const hr = hash(s + idx * 6.1 + 31.1);
  const drop = Math.max(y - S.groundClear, 0);
  const ang = ha * 6.2831;
  const rad = (S.spreadMin + S.spreadSpan * hr) * k;
  const arc = S.rise * k - (1 + S.rise) * k * k;
  return { level: fade * chatter, dx: Math.cos(ang) * rad, dy: drop * arc, dz: Math.sin(ang) * rad };
}

/** The whole life of one speck, sampled fine enough to see the top of its throw. */
function trajectory(seed: number, index: number, t0: number, y = 6.7): { level: number; dy: number }[] {
  const out: { level: number; dy: number }[] = [];
  for (let t = t0; t < t0 + S.life; t += S.life / 200) {
    const p = spark(seed, index, t, y);
    if (p.level > 0 || p.dy !== 0) out.push(p);
  }
  return out;
}

describe('the spark shower', () => {
  const seeds = Array.from({ length: 40 }, (_, i) => 0.02 + ((i * 0.6180339887) % 1) * 0.98);
  const STEP_S = 1 / 240;
  const SPAN_S = 120;
  /** A street lamp's lens: the height the specks have to fall from. */
  const HEAD_Y = 6.7;

  it('encodes the lamp inside the speck: negative marks a spark, the fraction is the lamp', () => {
    for (const seed of seeds) {
      for (let i = 0; i < S.count; i++) {
        const m = -lampSparkSeed(seed, i);
        expect(m).toBeGreaterThan(0);
        expect(Math.floor(m)).toBe(i + 1);
        expect(m - Math.floor(m)).toBeCloseTo(seed, 6);
      }
    }
  });

  it('lands on the pavement, whatever the lamp it fell off', () => {
    // The fall is the speck's own height, so one line of shader serves a 7.4 m street lamp, a
    // 4.4 m alley stub and a maintenance lamp under the viaduct.
    for (const y of [6.7, 4, 12.5]) {
      for (const seed of seeds.slice(0, 6)) {
        for (let i = 0; i < S.count; i++) {
          const born = firstMoment(seed, i);
          const path = trajectory(seed, i, born, y);
          const landed = path[path.length - 1];
          expect(y + landed.dy).toBeGreaterThan(0);
          expect(y + landed.dy).toBeLessThan(S.groundClear + 0.35);
        }
      }
    }
  });

  it('is thrown up before it falls, and falls faster the further it goes', () => {
    const path = trajectory(seeds[3], 2, firstMoment(seeds[3], 2), HEAD_Y);
    const top = Math.max(...path.map((p) => p.dy));
    expect(top).toBeGreaterThan(0.15);
    // Gravity, not a slide: the second half of the drop is longer than the first.
    const half = path[Math.floor(path.length / 2)].dy;
    const end = path[path.length - 1].dy;
    expect(Math.abs(end - half)).toBeGreaterThan(Math.abs(half));
  });

  it('drifts outward as it falls, and never far enough to leave the lamp', () => {
    for (const seed of seeds.slice(0, 8)) {
      for (let i = 0; i < S.count; i++) {
        const born = firstMoment(seed, i);
        const start = spark(seed, i, born + S.life * 0.05, HEAD_Y);
        const end = spark(seed, i, born + S.life * 0.95, HEAD_Y);
        const r = (p: { dx: number; dz: number }): number => Math.hypot(p.dx, p.dz);
        expect(r(end)).toBeGreaterThan(r(start));
        expect(r(end)).toBeLessThan(S.spreadMin + S.spreadSpan);
      }
    }
  });

  it('goes out on the way down: nothing bright ever reaches the ground', () => {
    for (const seed of seeds.slice(0, 8)) {
      for (let i = 0; i < S.count; i++) {
        const born = firstMoment(seed, i);
        expect(spark(seed, i, born + S.life * 0.05, HEAD_Y).level).toBeGreaterThan(0.35);
        expect(spark(seed, i, born + S.life * 0.97, HEAD_Y).level).toBeLessThan(0.05);
      }
    }
  });

  it('leaves as one burst: every speck is out within a blink of the first', () => {
    for (const seed of seeds) {
      // Rising edges land in whichever cycle each speck happened to next fire in, so they are
      // compared inside the lamp's own cycle: the question is whether they leave together, not
      // which burst the scan caught them on.
      const period = sparkPeriod(seed);
      const births = Array.from({ length: S.count }, (_, i) => firstMoment(seed, i));
      const base = births[0];
      // Circular: a speck that was still falling at t = 0 has its next edge a whole cycle
      // later than one that was not, which is the same moment in the burst, not a later one.
      const phases = births.map((b) => {
        const d = ((b - base) % period + period) % period;
        return Math.min(d, period - d);
      });
      const spread = Math.max(...phases);
      expect(spread).toBeLessThanOrEqual(S.spray + 1e-3);
      // But not in lockstep: an explosion of identical specks is one big speck.
      expect(new Set(phases.map((b) => Math.round(b * 1000))).size).toBeGreaterThan(S.count / 2);
    }
  });

  it('is dark nearly all the time: an event, not a decoration', () => {
    for (const seed of seeds) {
      let lit = 0;
      let n = 0;
      for (let t = 0; t < SPAN_S; t += STEP_S) {
        for (let i = 0; i < S.count; i++) {
          if (spark(seed, i, t).level > 0) lit++;
          n++;
        }
      }
      // A speck falls for over a second, so a burst is not brief — but the gaps are long.
      expect(lit / n).toBeLessThan(0.4);
      expect(lit / n).toBeGreaterThan(0.05);
    }
  });

  it('fires every few seconds, and every lamp fires', () => {
    for (const seed of seeds) {
      const starts: number[] = [];
      let wasOn = false;
      for (let t = 0; t < SPAN_S; t += STEP_S) {
        let on = false;
        for (let i = 0; i < S.count && !on; i++) on = spark(seed, i, t).level > 0;
        if (on && !wasOn) starts.push(t);
        wasOn = on;
      }
      expect(starts.length).toBeGreaterThan(SPAN_S / (S.periodMin + S.periodSpan) - 1);
      for (let i = 1; i < starts.length; i++) {
        const gap = starts[i] - starts[i - 1];
        expect(gap).toBeGreaterThan(S.life);
        expect(gap).toBeLessThan(S.periodMin + S.periodSpan + S.life);
      }
    }
  });

  it('does not spark in unison', () => {
    const moments = seeds.map((seed) => firstMoment(seed, 0));
    expect(new Set(moments.map((m) => Math.round(m * 100))).size).toBeGreaterThan(seeds.length * 0.8);
  });
});

/** How long one lamp waits between bursts. */
function sparkPeriod(seed: number): number {
  return S.periodMin + S.periodSpan * hash(seed + 5.1);
}

/**
 * When speck `index` of a lamp next leaves the lens: a rising edge, not merely the first lit
 * sample. At t = 0 half the lamps are already mid-burst, and taking that for a birth reads the
 * tail of a fall as the start of one.
 */
function firstMoment(seed: number, index: number): number {
  let wasOn = true;
  for (let t = 0; t < 60; t += 1 / 960) {
    const on = spark(seed, index, t).level > 0;
    if (on && !wasOn) return t;
    wasOn = on;
  }
  return -1;
}
