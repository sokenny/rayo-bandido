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
 * - SPARKS: see `LAMP_SPARKS`.
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

/**
 * The shower of sparks off a faulty head.
 *
 * A lamp that strobes has a connection arcing inside it, and every few seconds that arc lets
 * go: a small burst of hot specks at the lens that spray outward, arc over and fall the whole
 * way to the pavement, dying on the way down. It is the one thing that tells you the lamp is
 * FAILING rather than merely dim, and it is the reason to look up at a dark street.
 *
 * Subtle is the whole brief. Nine specks, each a couple of hand-widths across, out for four
 * fifths of the lamp's life — at 40 m/s you catch one out of the corner of the eye, and it is
 * gone before you can turn your head.
 *
 * WHY IT COSTS NOTHING
 * The specks are built into the same city-wide `glow` mesh as the halos, standing still at the
 * head, and the vertex shader both dims them and MOVES them: it reads the speck's seed off
 * `aLampFault` and displaces `transformed` along a ballistic arc. No particle system, no
 * per-frame CPU work, no draw call — a city of a thousand broken lamps costs one uniform.
 *
 * WHY THEY ALWAYS LAND
 * The fall distance is not a constant and is not carried per lamp: it is the speck's own
 * `position.y`. The environment meshes are built in world space at the origin, so a vertex's
 * y IS its height above the street, and a fall that ends at `-position.y + groundClear` puts
 * the speck on the pavement whatever it fell from — a 7.4 m street lamp, a 4.4 m alley stub or
 * a maintenance lamp under the viaduct, all from one line of shader.
 */
export const LAMP_SPARKS = {
  /** Specks per burst. Each is two crossed quads, so this is the whole cost of the effect. */
  count: 9,
  /**
   * Seconds between one lamp's bursts: 3.4 to 8. Longer than it looks, because a burst is not
   * an instant — the specks are on their way down for over a second after the flash.
   */
  periodMin: 3.4,
  periodSpan: 4.6,
  /**
   * The window the specks are born in. Short against `life`: they leave together, as one pop,
   * and separate on the way down. Staggering the births instead reads as a leak, not a fault.
   */
  spray: 0.16,
  /** How long one speck falls. About what gravity takes to bring it down off a street lamp. */
  life: 1.15,
  /**
   * Upward kick at birth, as a fraction of the fall. It buys about a third of a metre of arc
   * over the lens before gravity takes the speck: without it the shower drops out of the head
   * like water out of a tap, and an arc throws its sparks.
   */
  rise: 0.55,
  /** How far out a speck drifts by the time it lands, in metres. */
  spreadMin: 0.35,
  spreadSpan: 1.15,
  /** Where the fall stops: a speck dies just above the pavement, never inside it. */
  groundClear: 0.25,
  /** Fraction of the life the speck burns at full before it starts going out. */
  fadeFrom: 0.4,
  /** The rattle of the arc on the way down, rad/s, and its floor. */
  chatterRate: 41,
  chatterFloor: 0.4,
};

/** Every patched material compiles the same program; without a stable key each gets its own. */
export const LAMP_FAULT_CACHE_KEY = 'rb-lamp-faults-v3';

/** GLSL float literal: `1` is an int in GLSL and will not compile where a float is wanted. */
function f(n: number): string {
  return Number.isInteger(n) ? `${n}.0` : `${n}`;
}

const L = LAMP_FAULTS;
const S = LAMP_SPARKS;

const VERTEX_PARS = `
attribute float aLampFault;
uniform float uLampTime;

float rbLampHash(float n) {
  return fract(sin(n * 78.233 + 3.17) * 43758.5453);
}

// A spark speck carries -(index + lampSeed): one attribute, two kinds of vertex.
// Its age across its own fall, 0 at the flash and 1 as it lands, or -1 when it is not out.
float rbSparkAge(float m, float t) {
  float idx = floor(m);
  float seed = m - idx;
  float h1 = rbLampHash(seed + 5.1);
  float h2 = rbLampHash(seed + idx * 1.7 + 21.9);
  // Where this lamp is in its own cycle, in seconds, and when this speck left the lens.
  float period = ${f(S.periodMin)} + ${f(S.periodSpan)} * h1;
  float ph = fract(t / period + h1) * period;
  float k = (ph - h2 * ${f(S.spray)}) / ${f(S.life)};
  if (k < 0.0 || k > 1.0) return -1.0;
  return k;
}

float rbSparkLevel(float m, float t) {
  float k = rbSparkAge(m, t);
  if (k < 0.0) return 0.0;
  float idx = floor(m);
  float h3 = rbLampHash(m - idx + idx * 4.3 + 47.3);
  // Hot off the arc, going out as it falls, dark before it reaches the ground.
  float fade = 1.0 - smoothstep(${f(S.fadeFrom)}, 1.0, k);
  float chatter = ${f(S.chatterFloor)} + ${f(1 - S.chatterFloor)} * step(0.0, sin(t * ${f(S.chatterRate)} + h3 * 6.2831));
  return fade * chatter;
}

// Thrown out and up, then gravity. y is the speck's built height, i.e. how far it has to
// fall; at k = 1 the offset is exactly -y + clearance, so it lands on the pavement.
vec3 rbSparkOffset(float m, float t, float y) {
  float k = rbSparkAge(m, t);
  if (k < 0.0) return vec3(0.0);
  float idx = floor(m);
  float seed = m - idx;
  float ha = rbLampHash(seed + idx * 2.9 + 13.7);
  float hr = rbLampHash(seed + idx * 6.1 + 31.1);
  float drop = max(y - ${f(S.groundClear)}, 0.0);
  float ang = ha * 6.2831;
  float rad = (${f(S.spreadMin)} + ${f(S.spreadSpan)} * hr) * k;
  float arc = ${f(S.rise)} * k - ${f(1 + S.rise)} * k * k;
  return vec3(cos(ang) * rad, drop * arc, sin(ang) * rad);
}

float rbLampLevel(float seed, float t) {
  if (seed < 0.0) return rbSparkLevel(-seed, t);
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

/**
 * The only piece of the city that moves in the shader. Sparks are built standing still at the
 * lens and thrown from there; every other vertex takes a zero offset and the branch out.
 */
const POSITION_BODY = `
  if (aLampFault < 0.0) transformed += rbSparkOffset(-aLampFault, uLampTime, position.y);
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
          .replace('#include <color_vertex>', `#include <color_vertex>\n${VERTEX_BODY}`)
          .replace('#include <begin_vertex>', `#include <begin_vertex>\n${POSITION_BODY}`);
      };
      material.customProgramCacheKey = () => LAMP_FAULT_CACHE_KEY;
    },
    update(time) {
      uTime.value = time;
    },
  };
}

/**
 * The seed one spark speck carries. Negative marks the vertex as a spark rather than a lamp
 * head; the whole number is the speck's index within its burst and the fraction is the lamp's
 * own fault seed, so every speck on a head keeps that head's cadence while lighting on its own
 * beat. Only ever called for a faulty lamp (`fault > 0`).
 */
export function lampSparkSeed(fault: number, index: number): number {
  return -(index + 1 + fault);
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
