import * as THREE from 'three';

/**
 * Broken street lamps.
 *
 * A city that never repairs anything is one of the cheapest ways to make a night street feel
 * lived in and neglected, and the strobing sodium head is its signature. Roughly a third of
 * the lamps here are faulty: a failing ballast that stutters, a tube that gives up for a few
 * seconds at a time, a head that only ever manages a dull ember.
 *
 * WHY IT IS A SHADER
 * Every lamp head, its halo and its pool of light on the asphalt are merged into the two
 * city-wide meshes (`neon` and `glow`) that keep the environment inside its draw-call budget,
 * so nothing can be dimmed per lamp from the CPU. Instead each vertex carries one float —
 * the lamp's fault seed, 0 for a healthy lamp — and the vertex shader scales `vColor` by a
 * level derived from that seed and the clock. No extra geometry, no extra draw calls, one
 * uniform per frame. Because the head, the halo and the spill share a seed, the whole lamp
 * goes out together: a dark patch of road, not a dark bulb over a lit one.
 *
 * WHAT IT LOOKS LIKE
 * - EPISODES: a faulty lamp is not broken continuously. A slow sine per lamp decides when it
 *   is misbehaving; between episodes it burns normally, which is what makes the fault read as
 *   a fault rather than as a decorative animation. The threshold varies per lamp, so a few
 *   are almost always out and most only cut for a handful of seconds every half-minute.
 * - STROBE: inside an episode the head hard-switches at its own rate, with a second faster
 *   term beaten against the first so it never settles into a metronome. The step is
 *   deliberately asymmetric — off longer than on, the way a tube that cannot strike behaves.
 * - EMBER: an off lamp keeps `offLevel`, never zero. A dead-black head at 40 m/s reads as a
 *   hole in the geometry; a dim one reads as a broken lamp.
 * - SAG: a faulty lamp sits a few percent under a healthy one even when lit. Tired ballast.
 */
export const LAMP_FAULTS = {
  /** Share of street lamps built faulty. */
  faultChance: 0.32,
  /** Episode clock: 0.09..0.31 rad/s, i.e. one bout every ~20 to ~70 seconds. */
  episodeRateMin: 0.09,
  episodeRateSpan: 0.22,
  /**
   * Per-lamp episode threshold. Near -0.85 the lamp only stutters at the very bottom of its
   * cycle; near 0.15 it spends more of its life fighting than burning. Across the range a
   * faulty lamp is misbehaving about a third of the time, which keeps the street roughly as
   * bright as the palette was tuned for while still reading as a city nobody maintains.
   */
  thresholdMin: -0.85,
  thresholdSpan: 1,
  /** Half-width of the entry/exit into an episode, in sine units. Small: faults arrive abruptly. */
  edge: 0.08,
  /** Strobe rate, rad/s, and the ratio of the second term beaten against it. */
  strobeRateMin: 6.5,
  strobeRateSpan: 11,
  strobeBeat: 2.63,
  /** Duty bias: above zero the head is off more of the time than it is on. */
  strobeBias: 0.3,
  /** What an unlit faulty head keeps: a warm ember in the tube, spill from nearby windows. */
  offLevel: 0.09,
  /** How far under a healthy lamp a faulty one sits while it is behaving. */
  sag: 0.1,
};

/** Every patched material compiles the same program; without a stable key each gets its own. */
export const LAMP_FAULT_CACHE_KEY = 'rb-lamp-faults-v1';

/** GLSL float literal: `1` is an int in GLSL and will not compile where a float is wanted. */
function f(n: number): string {
  return Number.isInteger(n) ? `${n}.0` : `${n}`;
}

const L = LAMP_FAULTS;

const VERTEX_PARS = `
attribute float aLampFault;
uniform float uLampTime;

float rbLampHash(float n) {
  return fract(sin(n * 78.233 + 3.17) * 43758.5453);
}

float rbLampLevel(float seed, float t) {
  if (seed <= 0.0) return 1.0;
  float h1 = rbLampHash(seed);
  float h2 = rbLampHash(seed + 3.7);
  float h3 = rbLampHash(seed + 11.3);

  // Is this lamp currently having one of its turns?
  float ep = sin(t * (${f(L.episodeRateMin)} + ${f(L.episodeRateSpan)} * h1) + h2 * 6.2831);
  float thresh = ${f(L.thresholdMin)} + ${f(L.thresholdSpan)} * h3;
  float trouble = smoothstep(thresh + ${f(L.edge)}, thresh - ${f(L.edge)}, ep);

  // Two rates beaten together, hard-stepped: a tube failing to strike, not a sine.
  float rate = ${f(L.strobeRateMin)} + ${f(L.strobeRateSpan)} * h2;
  float buzz = sin(t * rate + h1 * 6.2831) + 0.55 * sin(t * rate * ${f(L.strobeBeat)} + h3 * 6.2831);
  float strobe = step(${f(L.strobeBias)}, buzz);

  float lit = mix(${f(L.offLevel)}, 1.0, strobe);
  // Even between episodes the lamp is tired.
  return mix(1.0 - ${f(L.sag)}, lit, trouble);
}
`;

const VERTEX_BODY = `
  vColor *= rbLampLevel(aLampFault, uLampTime);
`;

export interface LampFaults {
  /** Patch one of the merged unlit materials whose geometry carries `aLampFault`. */
  apply(material: THREE.Material): void;
  /** Advance every patched material. `time` is the scene clock in seconds. */
  update(time: number): void;
}

export function createLampFaults(): LampFaults {
  // One clock shared by every patched material, so a head and its pool of light never drift
  // apart. Made once, not per compile: Three re-runs `onBeforeCompile` whenever the program
  // is rebuilt (a light added, fog changed).
  const uTime = { value: 0 };
  return {
    apply(material) {
      material.onBeforeCompile = (shader) => {
        shader.uniforms.uLampTime = uTime;
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
          .replace('#include <color_vertex>', `#include <color_vertex>\n${VERTEX_BODY}`);
      };
      material.customProgramCacheKey = () => LAMP_FAULT_CACHE_KEY;
    },
    update(time) {
      uTime.value = time;
    },
  };
}

/**
 * Rolls one lamp's health. Returns 0 for a lamp that simply works, or a seed in (0, 1] that
 * picks its fault out of the family above. Call once per lamp at build time.
 */
export function rollLampFault(rng: () => number): number {
  if (rng() >= LAMP_FAULTS.faultChance) return 0;
  // Never returns 0: that value is reserved for "healthy".
  return 0.02 + rng() * 0.98;
}
