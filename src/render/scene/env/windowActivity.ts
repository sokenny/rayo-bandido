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
 * - ROOM: a fixed brightness and a fixed warmth per pane, which never move. The tile is five
 *   windows across and repeats every twelve metres, so without this a tower is the same
 *   twenty-five windows stamped over and over: uniform, flat, obviously a texture. Spreading
 *   each pane between a dim room and a bright one, and between lamp-warm and screen-cool,
 *   breaks the repeat everywhere at once.
 * - BREATH: every window drifts, each at its own rate over eight to twenty seconds.
 * - SOMEONE HOME: the one that carries it. A soft shape crosses the inside of the pane every
 *   ten seconds or so and dims the glass as it passes the lamp — a person moving through a
 *   room, not the room switching off. This is the only layer with structure INSIDE a window:
 *   `fract(uv * grid)` gives the position within the pane, so the shadow can travel across
 *   the glass instead of the whole pane stepping together.
 * - TV: one window in seven has a screen in it, flickering off two detuned sines so it never
 *   finds a rhythm, and weighted across the pane so one side of the glass takes more of it.
 * - OCCUPANCY: the slow one. Every couple of minutes a window crosses a per-window bias and
 *   fades — over a second or two, never a switch — down to a dim standby, and back later.
 *
 * All of it is masked by `glass`: the concrete between the windows and the panes the texture
 * painted dark keep exactly the emissive they had, so only lit glass is ever touched.
 *
 * `norm` puts back the average brightness the layers take away, so switching this on does not
 * dim the city the palette was tuned against; `cap` stops the layers stacking into a blowout
 * when a bright room, a breath peak and a TV flash line up.
 */
export const WINDOW_ACTIVITY = {
  /** Fixed brightness of one room, spread over this range. The anti-repeat layer. */
  baseMin: 0.62,
  baseSpan: 0.62,
  /**
   * Fixed warmth of one room, mixed between these two: a filament lamp and a screen-lit or
   * fluorescent room. The pair averages to neutral, so the zone palettes keep their colour.
   */
  warm: [1.16, 0.98, 0.78],
  cool: [0.82, 1.0, 1.2],
  /** Per-window drift: down by up to this fraction and back, at 0.3..1.1 rad/s. */
  breathDepth: 0.22,
  breathRateMin: 0.3,
  breathRateSpan: 0.8,
  /** Fraction of windows that have anybody in them. The rest are lit and empty. */
  presenceChance: 0.55,
  /** How often someone crosses: 0.045..0.13 crossings a second, so every 8 to 22 seconds. */
  walkRateMin: 0.045,
  walkRateSpan: 0.085,
  /** Share of that period spent crossing, i.e. how long one pass takes: 1.7 to 5 seconds. */
  walkSpan: 0.22,
  /** How much of the light the body blocks at its darkest, and how wide it is across a pane. */
  walkDepth: 0.55,
  walkWidth: 0.34,
  /** Fraction of windows with a screen in them, and how deep it flickers. */
  tvChance: 0.15,
  tvDepth: 0.3,
  /** Occupancy cycle: 0.02..0.07 rad/s, so a room changes its mind every 90 to 300 seconds. */
  cycleRateMin: 0.02,
  cycleRateSpan: 0.05,
  /**
   * Bias the cycle is compared against. Below -1 the window never goes out at all; the span
   * is chosen so roughly one lit pane in twelve is dark at any moment.
   */
  biasMin: -1.2,
  biasSpan: 0.5,
  /** Half-width of the fade, in sine units. Wider = slower fade; this is one to three seconds. */
  edge: 0.12,
  /** What a dark room keeps: blinds, a hallway, spill from the street. Never fully black. */
  offLevel: 0.09,
  /**
   * Emissive either side of which a pixel is concrete or glass. Lit panes land around 0.2-0.8
   * in this palette and the facade around 0.01, so the gap between them is wide and safe.
   */
  glassLo: 0.03,
  glassHi: 0.1,
  /** Reciprocal of the average dimming above, so the city's overall level is unchanged. */
  norm: 1.36,
  /** Ceiling on the whole factor, so stacked layers cannot blow a pane out. */
  cap: 1.9,
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
    vec2 winUv = vEmissiveMapUv * uWinGrid;
    vec2 winCell = floor(winUv);
    // Where we are inside this one pane. Everything that reads as movement uses it.
    vec2 sub = fract(winUv);
    vec3 winId = vec3(winCell, vWinPlane) + uWinSeed;
    // One hash per window, five more folded out of it: a sine hash costs a transcendental and
    // this runs on every facade pixel, so only the per-floor value pays for a second one.
    float wa = rbWinHash(winId);
    float wb = fract(wa * 197.13 + 0.371);
    float wc = fract(wb * 331.77 + 0.117);
    float wd = fract(wc * 419.31 + 0.613);
    float we = fract(wd * 263.17 + 0.451);
    float wg = fract(we * 157.91 + 0.289);
    // Per floor, so a storey tends to empty together.
    float wf = rbWinHash(vec3(winCell.y, vWinPlane, uWinSeed) + 13.1);

    float room = ${f(A.baseMin)} + ${f(A.baseSpan)} * wd;
    vec3 tint = mix(vec3(${A.warm.map(f).join(', ')}), vec3(${A.cool.map(f).join(', ')}), wc);

    float breath = 1.0 - ${f(A.breathDepth)} * (0.5 + 0.5 * sin(uWinTime * (${f(A.breathRateMin)} + ${f(A.breathRateSpan)} * wa) + wb * 6.2831));

    // SOMEONE HOME. A sawtooth is the room's clock; the crossing happens in the first slice of
    // it and the rest of the period is an empty room, so people arrive at the window rather
    // than orbiting it. The body is a squared parabola instead of an exp: same soft shoulders,
    // no transcendental, and it is exactly zero outside its own width.
    float saw = fract(uWinTime * (${f(A.walkRateMin)} + ${f(A.walkRateSpan)} * wc) + wb);
    float walk = saw / ${f(A.walkSpan)};
    float px = 0.12 + 0.76 * walk;
    float dx = (sub.x - px) / ${f(A.walkWidth)};
    float body = max(0.0, 1.0 - dx * dx);
    body *= body;
    // Fade in and out at the ends of the pass, so nobody pops in at the window frame.
    body *= smoothstep(0.0, 0.15, walk) * smoothstep(1.0, 0.85, walk);
    // Heavier low in the pane than high: a person, not a shutter.
    body *= 0.55 + 0.45 * smoothstep(0.78, 0.22, sub.y);
    float here = step(walk, 1.0) * step(wg, ${f(A.presenceChance)});
    float shadow = 1.0 - here * ${f(A.walkDepth)} * body;

    // Two detuned sines: neither period divides the other, so the flicker never repeats. The
    // sub.x weighting throws more of it at one side of the glass, the way a screen would.
    float wave = 0.6 * sin(uWinTime * (4.0 + 2.6 * wa) + wb * 6.2831)
      + 0.4 * sin(uWinTime * (1.7 + 1.3 * wc) + wa * 6.2831);
    float tv = 1.0 + step(1.0 - ${f(A.tvChance)}, we) * ${f(A.tvDepth)} * wave * (0.55 + 0.9 * sub.x);

    float cycle = sin(uWinTime * (${f(A.cycleRateMin)} + ${f(A.cycleRateSpan)} * wb) + wc * 6.2831 + wf * 1.7);
    float bias = ${f(A.biasMin)} + ${f(A.biasSpan)} * wa;
    float occupied = smoothstep(bias - ${f(A.edge)}, bias + ${f(A.edge)}, cycle);
    float level = mix(${f(A.offLevel)}, 1.0, occupied);

    float amount = min(${f(A.cap)}, ${f(A.norm)} * room * breath * level * tv * shadow);
    // Concrete and unlit panes are two orders of magnitude darker than glass: leave them be.
    float glass = smoothstep(${f(A.glassLo)}, ${f(A.glassHi)}, max(totalEmissiveRadiance.r, max(totalEmissiveRadiance.g, totalEmissiveRadiance.b)));
    totalEmissiveRadiance *= mix(vec3(1.0), amount * tint, glass);
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
