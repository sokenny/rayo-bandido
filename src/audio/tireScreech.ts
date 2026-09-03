import type { AudioCore } from './core';
import { AUDIO } from '../config/tuning';
import { clamp01, lerp } from '../core/math';
import { REF_SPEED, squealHz } from './dsp';

export interface TireScreech {
  /** `intensity` is the 0..1 slide amount (see `skidIntensity`); `speed` is signed m/s. */
  update(dt: number, intensity: number, speed: number): void;
  reset(): void;
  dispose(): void;
}

/** Series-bandpass Q. Two of these stacked ring hard enough to read as a pitch, not a hiss. */
const SQUEAL_Q = 16;
/** The squeal's upper partial, as a ratio of the fundamental. Deliberately not a whole number. */
const PARTIAL_RATIO = 2.37;
/** How far (fraction) the squeal pitch wanders around its target. */
const WANDER_DEPTH = 0.07;
/** How fast the wander re-targets, in 1/s. Slow enough to read as drift, not vibrato. */
const WANDER_RATE = 5.5;
/** Depth (fraction) of the per-frame stick-slip chatter riding on top of the slow wander. */
const CHATTER_DEPTH = 0.028;
/** Smoothing constant for the chatter. Short enough that the pitch never fully settles. */
const CHATTER_TC = 0.008;
/**
 * Exponent on the level curve. A straight `tireVolume * intensity` left the most common state in
 * play — a latched low-angle drift, which `skidIntensity` pins at its 0.35 floor — nearly
 * inaudible. Bending the curve lifts the quiet end without touching silence at 0 or full at 1.
 */
const LEVEL_CURVE = 0.6;
/**
 * Exponent on the howl-vs-scrub balance. This used to be `i * i`, which at the 0.35 drift floor
 * left the pitched layers at 12% while the scrub ran at 69% — so the most common moment in the
 * game was almost entirely wide filtered noise, which is the recipe for wind. Below 1 the howl
 * leads from the moment the tire lets go, and the scrub only ever backs it up.
 */
const HOWL_CURVE = 0.55;

function makeRaspCurve(): Float32Array<ArrayBuffer> {
  const n = 2048;
  const k = 2.2;
  const norm = Math.tanh(k);
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x) / norm;
  }
  return curve;
}

/**
 * Soft-clip shape for the howl bus. Rubber squeal is a violently nonlinear stick-slip
 * oscillation, not a clean resonance, and the harmonics that come out of clipping it are what
 * make the sound bite. It also evens out the amplitude of the filtered noise underneath, which
 * is what turns a "shhh" that happens to be filtered into a continuous howl. Putting the
 * aggression here rather than in the fader means the effect gets angrier without getting louder.
 */
const RASP_CURVE = makeRaspCurve();

/**
 * Continuous tire scrub while sliding, in two stages off one looping noise source.
 *
 * - **Scrub**: a low band (~180-380 Hz) rolled off hard above ~1 kHz — the weight of rubber
 *   tearing across asphalt. This is what makes a slide feel heavy. It is deliberately kept dark
 *   and quiet: every bit of top end it is allowed reads as air rushing past, not as a tire.
 * - **Howl**: noise through two bandpasses *in series* at the same frequency, plus a second
 *   resonance at a deliberately inharmonic 2.37x, both driven into a soft clipper. Stacking the
 *   filters rings far harder than one can, so the noise turns pitched while keeping the grain of
 *   real rubber; the clipper then adds the rasp and holds the level steady. A pure oscillator
 *   here sounds synthetic, and an unclipped one sounds like weather.
 *
 * The pitch moves on two timescales, both aperiodic and both driven from the frame update rather
 * than an LFO: a slow wander that reads as the slide angle breathing, and a per-frame chatter
 * that is the tread grabbing and releasing. The chatter also nudges the clipper drive, so the
 * grit flickers with it — texture, not tremolo. (An 11 Hz amplitude tremolo was tried and is
 * almost exactly the rate at which the ear stops hearing texture and starts hearing separate
 * events: it sounded like riffling a deck of cards.)
 *
 * Level tracks the same slide intensity that drives the tire smoke, so what you see and what
 * you hear agree.
 */
export function createTireScreech(core: AudioCore): TireScreech {
  const { ctx, master, noise } = core;

  const out = ctx.createGain();
  out.gain.value = 0;
  out.connect(master);

  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.loop = true;

  // --- Scrub: the low roar of the contact patch. Narrow and dark on purpose. ---
  const scrub = ctx.createBiquadFilter();
  scrub.type = 'bandpass';
  scrub.frequency.value = 260;
  scrub.Q.value = 1.8;
  const scrubTone = ctx.createBiquadFilter();
  scrubTone.type = 'lowpass';
  scrubTone.frequency.value = 900;
  scrubTone.Q.value = 0.5;
  const scrubGain = ctx.createGain();
  scrubGain.gain.value = 0;
  src.connect(scrub).connect(scrubTone).connect(scrubGain).connect(out);

  // --- Howl output stage: everything pitched is fused by one soft clipper. ---
  const rasp = ctx.createWaveShaper();
  rasp.curve = RASP_CURVE;
  rasp.oversample = '2x';
  const howlLevel = ctx.createGain();
  howlLevel.gain.value = 0;
  rasp.connect(howlLevel).connect(out);

  // Pre-clip drive. Bigger slide angles are pushed further in, so intensity changes the
  // character — snarlier, more torn up — and not just the volume.
  const drive = ctx.createGain();
  drive.gain.value = 1.6;
  drive.connect(rasp);

  // --- Squeal: two bandpasses in series so the noise actually rings. ---
  const squealA = ctx.createBiquadFilter();
  squealA.type = 'bandpass';
  squealA.frequency.value = 900;
  squealA.Q.value = SQUEAL_Q;
  const squealB = ctx.createBiquadFilter();
  squealB.type = 'bandpass';
  squealB.frequency.value = 900;
  squealB.Q.value = SQUEAL_Q;
  const squealGain = ctx.createGain();
  squealGain.gain.value = 0;
  src.connect(squealA).connect(squealB).connect(squealGain).connect(drive);

  // --- Partial: the inharmonic overtone that keeps it sounding like rubber. ---
  const partial = ctx.createBiquadFilter();
  partial.type = 'bandpass';
  partial.frequency.value = 900 * PARTIAL_RATIO;
  partial.Q.value = 20;
  const partialGain = ctx.createGain();
  partialGain.gain.value = 0;
  src.connect(partial).connect(partialGain).connect(drive);

  src.start();

  // Aperiodic pitch drift: a target that is re-rolled continuously and chased smoothly.
  let wander = 0;
  let wanderTarget = 0;

  return {
    update(dt, intensity, speed) {
      const t = ctx.currentTime;
      const tc = Math.max(0.03, Math.min(0.08, dt * 4)); // snappy but click-free
      const i = clamp01(intensity);
      const speedFrac = clamp01(Math.abs(speed) / REF_SPEED);

      out.gain.setTargetAtTime(AUDIO.tireVolume * Math.pow(i, LEVEL_CURVE), t, tc);

      // Random-walk the squeal pitch. Re-rolling the target rather than the value itself keeps
      // the motion smooth; the chase rate sets how twitchy the slide sounds.
      const chase = 1 - Math.exp(-WANDER_RATE * dt);
      if (Math.random() < WANDER_RATE * dt) wanderTarget = (Math.random() * 2 - 1) * WANDER_DEPTH;
      wander += (wanderTarget - wander) * chase;

      // Stick-slip chatter: re-rolled every frame and only lightly smoothed, so the pitch never
      // quite settles. This is most of the difference between a tire and a tone.
      const chatter = (Math.random() * 2 - 1) * CHATTER_DEPTH;

      const hz = squealHz(i, speedFrac) * (1 + wander + chatter);
      squealA.frequency.setTargetAtTime(hz, t, CHATTER_TC);
      squealB.frequency.setTargetAtTime(hz, t, CHATTER_TC);
      partial.frequency.setTargetAtTime(hz * PARTIAL_RATIO, t, CHATTER_TC);

      // Scrub carries the low end from the moment the tire breaks away, and opens up with speed —
      // but only as far as ~1.3 kHz. Anything brighter than that stops being rubber and starts
      // being airflow.
      scrub.frequency.setTargetAtTime(lerp(180, 380, i * 0.5 + speedFrac * 0.5), t, 0.08);
      scrubTone.frequency.setTargetAtTime(lerp(700, 1300, speedFrac), t, 0.08);
      scrubGain.gain.setTargetAtTime(lerp(0.7, 0.9, i), t, tc);

      // The series filters cost a lot of level, hence the large make-up gains. The chatter rides
      // the drive as well as the pitch, so the grit flickers instead of sitting still.
      const howl = Math.pow(i, HOWL_CURVE);
      squealGain.gain.setTargetAtTime(10 * howl, t, tc);
      partialGain.gain.setTargetAtTime(2.6 * howl * i, t, tc);
      drive.gain.setTargetAtTime(lerp(1.6, 4.5, i) * (1 + chatter * 3), t, CHATTER_TC);
      // The clipper bounds its own output, so this fader is pure level and never changes tone.
      // It runs low because clipping raises the bus RMS a long way above the old open-noise mix:
      // measured against the previous voice this lands a floor drift ~1.3x hotter (it used to be
      // inaudible) and a full-lock slide ~0.8x, so the loud end got quieter, not louder.
      howlLevel.gain.setTargetAtTime(lerp(0.12, 0.36, i), t, tc);
    },

    reset() {
      const t = ctx.currentTime;
      wander = 0;
      wanderTarget = 0;
      out.gain.setValueAtTime(0, t);
      scrubGain.gain.setValueAtTime(0, t);
      squealGain.gain.setValueAtTime(0, t);
      partialGain.gain.setValueAtTime(0, t);
      howlLevel.gain.setValueAtTime(0, t);
      drive.gain.setValueAtTime(1.6, t);
    },

    dispose() {
      try {
        src.stop();
      } catch {
        /* already stopped */
      }
      out.disconnect();
      scrub.disconnect();
      scrubTone.disconnect();
      scrubGain.disconnect();
      squealA.disconnect();
      squealB.disconnect();
      squealGain.disconnect();
      partial.disconnect();
      partialGain.disconnect();
      drive.disconnect();
      rasp.disconnect();
      howlLevel.disconnect();
    },
  };
}
