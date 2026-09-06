import * as THREE from 'three';

/**
 * Life behind the windows.
 *
 * The facades are one merged mesh per zone sharing one small emissive tile, so every lit pane
 * in the city is literally the same handful of texels: nothing can be animated per building
 * from the CPU without giving up the fifteen-draw-call budget. Instead the stock
 * MeshStandardMaterial is patched to scale `totalEmissiveRadiance` by a per-window factor
 * derived in the fragment shader — no extra geometry, no extra draw calls, one uniform
 * updated per frame.
 *
 * IDENTIFYING A WINDOW
 * A pane is one cell of the texture grid, so `floor(uv * grid)` names it exactly, and the
 * cell edges always fall on the pane edges regardless of the per-building UV offset. That
 * index repeats between buildings though, so it is mixed with the facade's own plane offset:
 * the world position projected onto the face normal, which is constant across a flat facade
 * (the x of an east wall, the z of a north wall) and different for every wall in the city.
 * Constant across the pane means no seam can appear inside one window.
 *
 * WHAT IT LOOKS LIKE, and why each layer is there
 * - BREATH: every window drifts a few percent, each at its own lazy rate. On its own this is
 *   barely perceptible per window; across a facade it stops the grid reading as a decal.
 * - OCCUPANCY: a very slow sine per window crossed against a per-window bias. Most windows
 *   sit permanently on the lit side; the rest cross over every few minutes and fade — over
 *   about six seconds, never a switch — down to a dim standby, and back again later. This is
 *   the layer that sells "someone is in there": one window an hour is nothing, but a facade
 *   holds hundreds, so something is always going out or coming back somewhere in view. The
 *   phase carries a per-floor term, so departures cluster along a storey the way an office
 *   empties rather than sprinkling evenly.
 * - TV: a handful of windows get a slow, low-contrast wobble on top. A screen, not a strobe.
 *
 * `norm` puts back the average brightness the occupancy layer takes away, so switching this
 * on does not quietly dim the city the palette was tuned against.
 */
export const WINDOW_ACTIVITY = {
  /** Per-window drift: down by up to this fraction and back, at 0.13..0.55 rad/s. */
  breathDepth: 0.1,
  breathRateMin: 0.13,
  breathRateSpan: 0.42,
  /** Occupancy cycle: 0.004..0.02 rad/s, so a room changes its mind every 5 to 25 minutes. */
  cycleRateMin: 0.004,
  cycleRateSpan: 0.016,
  /**
   * Bias the cycle is compared against. Below -1 the window never goes out at all; the span
   * is chosen so roughly one lit pane in nine is dark at any moment.
   */
  biasMin: -1.15,
  biasSpan: 0.5,
  /** Half-width of the fade, in sine units. Wider = slower fade; this is about six seconds. */
  edge: 0.09,
  /** What a dark room keeps: blinds, a hallway, spill from the street. Never fully black. */
  offLevel: 0.12,
  /**
   * Fraction of windows with a screen flickering in them, and how deep it wobbles. Slow on
   * purpose: a real screen cuts faster than this, but at street distance a fast wobble on a
   * few hundred panes reads as noise, and the brief is a world going about its evening.
   */
  tvChance: 0.08,
  tvDepth: 0.09,
  /** Reciprocal of the average dimming above, so the city's overall level is unchanged. */
  norm: 1.186,
};

/** Every patched facade compiles the same program; without a stable key each gets its own. */
export const WINDOW_ACTIVITY_CACHE_KEY = 'rb-window-activity-v1';

/** GLSL float literal: `1` is an int in GLSL and will not compile where a float is wanted. */
function f(n: number): string {
  return Number.isInteger(n) ? `${n}.0` : `${n}`;
}

const A = WINDOW_ACTIVITY;

const VERTEX_PARS = `
varying float vWinPlane;
`;

// The facade's own plane: world position projected onto the face normal. Constant over a flat
// wall, so it identifies the wall without varying inside a pane.
const VERTEX_BODY = `
  vWinPlane = dot((modelMatrix * vec4(transformed, 1.0)).xyz, abs(normalize(mat3(modelMatrix) * objectNormal)));
`;

const FRAGMENT_PARS = `
varying float vWinPlane;
uniform float uWinTime;
uniform vec2 uWinGrid;
uniform float uWinSeed;

float rbWinHash(vec3 p) {
  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
}
`;

const FRAGMENT_BODY = `
  {
    vec2 winCell = floor(vEmissiveMapUv * uWinGrid);
    vec3 winId = vec3(winCell, vWinPlane) + uWinSeed;
    // One hash per window, two more folded out of it: a sine hash costs a transcendental and
    // this runs on every facade pixel, so only the per-floor value pays for a second one.
    float wa = rbWinHash(winId);
    float wb = fract(wa * 197.13 + 0.371);
    float wc = fract(wb * 331.77 + 0.117);
    // Per floor, so a storey tends to empty together.
    float wf = rbWinHash(vec3(winCell.y, vWinPlane, uWinSeed) + 13.1);

    float breath = 1.0 - ${f(A.breathDepth)} * (0.5 + 0.5 * sin(uWinTime * (${f(A.breathRateMin)} + ${f(A.breathRateSpan)} * wa) + wb * 6.2831));

    float cycle = sin(uWinTime * (${f(A.cycleRateMin)} + ${f(A.cycleRateSpan)} * wb) + wc * 6.2831 + wf * 1.7);
    float bias = ${f(A.biasMin)} + ${f(A.biasSpan)} * wa;
    float occupied = smoothstep(bias - ${f(A.edge)}, bias + ${f(A.edge)}, cycle);
    float level = mix(${f(A.offLevel)}, 1.0, occupied);

    float tv = 1.0 + step(1.0 - ${f(A.tvChance)}, wc) * ${f(A.tvDepth)}
      * sin(uWinTime * (0.45 + 0.4 * wa) + 1.2 * sin(uWinTime * (0.25 + 0.2 * wb)));

    totalEmissiveRadiance *= ${f(A.norm)} * breath * level * tv;
  }
`;

export interface WindowActivity {
  /**
   * Patch one facade material. `cols`/`rows` must match the grid its window texture was drawn
   * with, or the cells will not line up with the panes; `seed` decorrelates the zones.
   */
  apply(material: THREE.MeshStandardMaterial, cols: number, rows: number, seed: number): void;
  /** Advance every patched material. `time` is the scene clock in seconds. */
  update(time: number): void;
}

export function createWindowActivity(): WindowActivity {
  const times: { value: number }[] = [];
  return {
    apply(material, cols, rows, seed) {
      // Made once per material, not once per compile: Three re-runs `onBeforeCompile` whenever
      // the program is rebuilt (a light added, fog changed), and the clock must survive that.
      const uTime = { value: 0 };
      const uGrid = { value: new THREE.Vector2(cols, rows) };
      const uSeed = { value: seed };
      times.push(uTime);
      material.onBeforeCompile = (shader) => {
        shader.uniforms.uWinTime = uTime;
        shader.uniforms.uWinGrid = uGrid;
        shader.uniforms.uWinSeed = uSeed;
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
          .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERTEX_BODY}`);
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
          .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${FRAGMENT_BODY}`);
      };
      // The grid and the seed are uniforms, so all three zones compile the same program.
      material.customProgramCacheKey = () => WINDOW_ACTIVITY_CACHE_KEY;
    },
    update(time) {
      for (const t of times) t.value = time;
    },
  };
}
