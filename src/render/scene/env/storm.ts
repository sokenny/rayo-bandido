import { ATMOSPHERE } from '../../../config/tuning';

/**
 * The weather lightning. Not the weapon — that is `src/sim/lightning.ts` and `LIGHTNING`,
 * which fires at cars; this is the storm over the city and touches nothing but light.
 *
 * A real strike is never one clean flash. It is a leader, a return stroke and one to three
 * restrikes down the same channel, tens of milliseconds apart and each dimmer than the last,
 * which is why a photographed bolt has several exposures stacked in it and why a single
 * symmetric flash reads as a light switch rather than as weather. So a strike here is a
 * short burst of sub-flashes at irregular gaps with decaying peaks, and the gaps between
 * strikes are skewed towards the short end of the range so the sky is not on a metronome.
 *
 * This module is deliberately free of Three.js and of the DOM: it is a clock and a number
 * between 0 and 1, which is what makes it testable in the node test environment and what
 * keeps the decision of *when* the sky flashes out of the shader that decides *how*.
 *
 * No allocation after construction: the burst schedule lives in fixed-length arrays sized
 * for the largest strike the config allows.
 */
export interface StormConfig {
  frequency: number;
  minGap: number;
  maxGap: number;
  minFlashes: number;
  maxFlashes: number;
  flashGapMin: number;
  flashGapMax: number;
  flashDurationMin: number;
  flashDurationMax: number;
  intensity: number;
}

export interface Storm {
  /** Illumination of the sky right now, 0..1. Exactly 0 between strikes. */
  readonly intensity: number;
  /** Unit vector towards the part of the sky the current strike is behind. */
  readonly dirX: number;
  readonly dirY: number;
  readonly dirZ: number;
  /** Strikes begun since creation. For tests and for the debug overlay. */
  readonly strikes: number;
  /** Seconds until the next strike begins. */
  readonly nextIn: number;
  step(dt: number): void;
  /** Begin a strike now, whatever the clock says. */
  fire(): void;
  reset(): void;
}

/** The most sub-flashes one strike can schedule. Sized once; never grown. */
const MAX_FLASHES = 8;

/** Deterministic 32-bit RNG, same shape as `env/meshBuilder.ts`'s so seeds behave alike. */
export function stormRng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

/**
 * One sub-flash's brightness over its life: a near-instant attack and a hard exponential
 * decay, which is the shape of the real thing and the reason a flash reads as a discharge
 * rather than as a fade-in.
 */
function envelope(u: number): number {
  if (u < 0 || u > 1) return 0;
  const attack = 0.09;
  if (u < attack) return u / attack;
  const d = (u - attack) / (1 - attack);
  return Math.exp(-4.2 * d) * (1 - d);
}

export function createStorm(config: StormConfig = ATMOSPHERE.storm, seed = 0x51e17): Storm {
  const rng = stormRng(seed);
  const at = new Float64Array(MAX_FLASHES);
  const peak = new Float64Array(MAX_FLASHES);
  const dur = new Float64Array(MAX_FLASHES);
  let count = 0;
  let elapsed = 0;
  let active = false;
  let wait = 0;
  let strikes = 0;
  let intensity = 0;
  let dirX = 0;
  let dirY = 1;
  let dirZ = 0;

  /** Skewed towards the short end: `r * r` spends most of its mass near `minGap`. */
  function scheduleWait(): void {
    const f = config.frequency > 0 ? config.frequency : 0;
    if (f <= 0) {
      wait = Number.POSITIVE_INFINITY;
      return;
    }
    const r = rng();
    wait = (config.minGap + r * r * Math.max(0, config.maxGap - config.minGap)) / f;
  }

  function begin(): void {
    // Azimuth anywhere around the horizon, elevation low: a storm cell sits over the
    // skyline, not overhead, so the flash rakes the cloud base rather than lighting it flat.
    const az = rng() * Math.PI * 2;
    const el = 0.06 + rng() * 0.42;
    const c = Math.cos(el);
    dirX = Math.cos(az) * c;
    dirY = Math.sin(el);
    dirZ = Math.sin(az) * c;

    // Distance: a far cell is dimmer and its flash is broader and softer on the eye.
    const near = rng();
    const base = config.intensity * (0.38 + 0.62 * near * near);

    const span = Math.max(0, config.maxFlashes - config.minFlashes);
    const n = Math.min(MAX_FLASHES, Math.max(1, config.minFlashes + Math.floor(rng() * (span + 1))));
    let t = 0;
    for (let i = 0; i < n; i++) {
      at[i] = t;
      // Each restrike is weaker than the one before it, with a little life of its own.
      const decay = Math.pow(0.68, i) * (0.72 + rng() * 0.5);
      peak[i] = Math.min(1, base * decay);
      dur[i] = config.flashDurationMin + rng() * Math.max(0, config.flashDurationMax - config.flashDurationMin);
      t += dur[i] * (0.25 + rng() * 0.4) + config.flashGapMin + rng() * Math.max(0, config.flashGapMax - config.flashGapMin);
    }
    count = n;
    elapsed = 0;
    active = true;
    strikes++;
  }

  function sample(): number {
    // The brightest live sub-flash wins. Summing them would let a dense restrike burst
    // clip the whole sky white, which no amount of tone mapping makes look like lightning.
    let best = 0;
    for (let i = 0; i < count; i++) {
      const d = dur[i];
      if (d <= 0) continue;
      const u = (elapsed - at[i]) / d;
      if (u < 0) break; // scheduled in order, so nothing after this has started either
      const v = peak[i] * envelope(u);
      if (v > best) best = v;
    }
    return best;
  }

  scheduleWait();

  return {
    get intensity() {
      return intensity;
    },
    get dirX() {
      return dirX;
    },
    get dirY() {
      return dirY;
    },
    get dirZ() {
      return dirZ;
    },
    get strikes() {
      return strikes;
    },
    get nextIn() {
      return active ? 0 : wait;
    },

    step(dt: number) {
      if (!(dt > 0)) return;
      if (active) {
        elapsed += dt;
        intensity = sample();
        const last = count - 1;
        if (elapsed > at[last] + dur[last]) {
          active = false;
          intensity = 0;
          scheduleWait();
        }
        return;
      }
      intensity = 0;
      wait -= dt;
      if (wait <= 0) begin();
    },

    fire() {
      begin();
      intensity = sample();
    },

    reset() {
      active = false;
      intensity = 0;
      count = 0;
      elapsed = 0;
      scheduleWait();
    },
  };
}
