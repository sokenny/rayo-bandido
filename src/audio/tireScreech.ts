import type { AudioCore } from './core';
import { AUDIO } from '../config/tuning';
import { clamp01, lerp } from '../core/math';
import { REF_SPEED, squealHz } from './dsp';

export interface TireScreech {
  /** `intensity` is the 0..1 slide amount (see `skidIntensity`); `speed` is ground speed in m/s. */
  update(dt: number, intensity: number, speed: number): void;
  reset(): void;
  dispose(): void;
}

/** Series-bandpass Q. Two of these stacked ring hard enough to read as a pitch, not a hiss. */
const SQUEAL_Q = 14;
/** The squeal's upper partial, as a ratio of the fundamental. Deliberately not a whole number. */
const PARTIAL_RATIO = 2.37;
/** How far (fraction) the squeal pitch wanders around its target. */
const WANDER_DEPTH = 0.08;
/** How fast the wander re-targets, in 1/s. Slow enough to read as drift, not vibrato. */
const WANDER_RATE = 6;
/** Depth (fraction) of the per-frame stick-slip chatter riding on top of the slow wander. */
const CHATTER_DEPTH = 0.032;
/** Smoothing constant for the chatter. Short enough that the pitch never fully settles. */
const CHATTER_TC = 0.008;
/**
 * Exponent on the level curve. A straight `tireVolume * intensity` left the most common state in
 * play — a latched low-angle drift, which `skidIntensity` pins at its 0.35 floor — nearly
 * inaudible. Bending the curve lifts the quiet end without touching silence at 0 or full at 1.
 */
const LEVEL_CURVE = 0.5;
/**
 * Exponent on the howl-vs-scrub balance. Below 1 the howl leads from the moment the tire lets
 * go, and the scrub only ever backs it up — wide noise leading is the recipe for wind.
 */
const HOWL_CURVE = 0.5;
/**
 * Roughness: the howl is amplitude-modulated by band-limited noise around 30-70 Hz. That band is
 * where the ear hears *roughness* — rasp, tearing — rather than separate pulses (an 11 Hz
 * tremolo was tried once and sounded like riffling cards). Real rubber stick-slip is exactly this
 * kind of irregular fast grab-and-release, and it is most of what separates an angry screech from
 * a clean whistle.
 */
const ROUGH_HZ = 60;
/** How long (s) the break-away snarl takes to fall off after the tires let go. */
const BITE_DECAY = 0.35;

function makeRaspCurve(): Float32Array<ArrayBuffer> {
  const n = 2048;
  const k = 3.2;
  const norm = Math.tanh(k);
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    // A touch of asymmetry adds even harmonics, which read as grit rather than fuzz.
    // (That also adds a DC offset, which `dcBlock` after the shaper removes.)
    curve[i] = Math.tanh(k * x + 0.25 * x * x) / norm;
  }
  return curve;
}

/**
 * Soft-clip shape for the howl bus. Rubber squeal is a violently nonlinear stick-slip
 * oscillation, not a clean resonance, and the harmonics that come out of clipping it are what
 * make the sound bite. It also evens out the amplitude of the filtered noise underneath, which
 * is what turns a "shhh" that happens to be filtered into a continuous howl.
 */
const RASP_CURVE = makeRaspCurve();

/**
 * Continuous tire screech while sliding, off one looping noise buffer.
 *
 * - **Scrub**: a low band (~160-380 Hz) rolled off above ~1 kHz — the weight of rubber dragging
 *   across asphalt. This is what makes a slide feel heavy.
 * - **Howl**: noise through two bandpasses *in series* at the same frequency, plus a resonance at
 *   an inharmonic 2.37x, driven hard into an asymmetric soft clipper, then a presence peak around
 *   2.8 kHz for bite. The clipper holds the level steady and adds the rasp; the peak is where a
 *   real screech cuts through an engine.
 * - **Tear**: a wide mid band (~1.4-2.4 kHz) that only opens on hard slides. Alone it would be air;
 *   with the roughness on it, it is rubber ripping.
 * - **Roughness**: a second, decorrelated read of the noise, low-passed near 60 Hz, modulating the
 *   howl and tear amplitudes at audio rate. See `ROUGH_HZ`.
 *
 * The pitch moves on two timescales, both aperiodic and driven from the frame update: a slow
 * wander that reads as the slide angle breathing, and a per-frame chatter that is the tread
 * grabbing and releasing. When the tires first break away a short *bite* overdrives the clipper
 * and lifts the level, the way a real slide yelps before settling into its howl.
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

  // --- Scrub: the low roar of the contact patch. ---
  const scrub = ctx.createBiquadFilter();
  scrub.type = 'bandpass';
  scrub.frequency.value = 260;
  scrub.Q.value = 1.4;
  const scrubTone = ctx.createBiquadFilter();
  scrubTone.type = 'lowpass';
  scrubTone.frequency.value = 900;
  scrubTone.Q.value = 0.5;
  const scrubGain = ctx.createGain();
  scrubGain.gain.value = 0;
  src.connect(scrub).connect(scrubTone).connect(scrubGain).connect(out);

  // --- Roughness modulator: slow-played, decorrelated noise, band-limited to the rasp region. ---
  const roughSrc = ctx.createBufferSource();
  roughSrc.buffer = noise;
  roughSrc.loop = true;
  roughSrc.playbackRate.value = 0.37;
  const roughLp = ctx.createBiquadFilter();
  roughLp.type = 'lowpass';
  roughLp.frequency.value = ROUGH_HZ;
  roughLp.Q.value = 0.9;
  const roughHp = ctx.createBiquadFilter();
  roughHp.type = 'highpass';
  roughHp.frequency.value = 18; // no slow swells: those read as tremolo, not grain
  roughHp.Q.value = 0.5;
  const roughDepth = ctx.createGain();
  roughDepth.gain.value = 0;
  roughSrc.connect(roughLp).connect(roughHp).connect(roughDepth);

  // --- Howl output stage: everything pitched is fused by one clipper, then given bite. ---
  const rasp = ctx.createWaveShaper();
  rasp.curve = RASP_CURVE;
  rasp.oversample = '4x';
  const dcBlock = ctx.createBiquadFilter();
  dcBlock.type = 'highpass';
  dcBlock.frequency.value = 90;
  dcBlock.Q.value = 0.5;
  const presence = ctx.createBiquadFilter();
  presence.type = 'peaking';
  presence.frequency.value = 2800;
  presence.Q.value = 1.1;
  presence.gain.value = 6;
  const fizzCut = ctx.createBiquadFilter();
  fizzCut.type = 'lowpass';
  fizzCut.frequency.value = 7500; // clipper fizz above here is just harsh, not aggressive
  fizzCut.Q.value = 0.6;
  const howlRough = ctx.createGain();
  howlRough.gain.value = 1;
  roughDepth.connect(howlRough.gain);
  const howlLevel = ctx.createGain();
  howlLevel.gain.value = 0;
  rasp.connect(dcBlock).connect(presence).connect(fizzCut).connect(howlRough).connect(howlLevel).connect(out);

  // Pre-clip drive. Bigger slide angles are pushed further in, so intensity changes the
  // character — snarlier, more torn up — and not just the volume.
  const drive = ctx.createGain();
  drive.gain.value = 2;
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
  partial.Q.value = 18;
  const partialGain = ctx.createGain();
  partialGain.gain.value = 0;
  src.connect(partial).connect(partialGain).connect(drive);

  // --- Tear: the ripping mid band, roughened by the same modulator. ---
  const tear = ctx.createBiquadFilter();
  tear.type = 'bandpass';
  tear.frequency.value = 1800;
  tear.Q.value = 0.9;
  const tearRough = ctx.createGain();
  tearRough.gain.value = 1;
  roughDepth.connect(tearRough.gain);
  const tearGain = ctx.createGain();
  tearGain.gain.value = 0;
  src.connect(tear).connect(tearRough).connect(tearGain).connect(out);

  src.start();
  // Offset into the buffer so the modulator is not a slowed copy of the carrier it modulates.
  roughSrc.start(0, 0.9);

  // Aperiodic pitch drift: a target that is re-rolled continuously and chased smoothly.
  let wander = 0;
  let wanderTarget = 0;
  // Break-away snarl: kicked when intensity jumps, decays over `BITE_DECAY`.
  let bite = 0;
  let follow = 0;

  return {
    update(dt, intensity, speed) {
      const t = ctx.currentTime;
      const tc = Math.max(0.025, Math.min(0.07, dt * 4)); // snappy but click-free
      const i = clamp01(intensity);
      const speedFrac = clamp01(Math.abs(speed) / REF_SPEED);

      // A fast rise over a slowly-following reference is the tire letting go.
      const rise = i - follow;
      follow += (i - follow) * (1 - Math.exp(-dt / 0.25));
      if (rise > 0.15) bite = Math.max(bite, clamp01(rise * 2.5));
      bite *= Math.exp(-dt / BITE_DECAY);

      out.gain.setTargetAtTime(AUDIO.tireVolume * Math.pow(i, LEVEL_CURVE) * (1 + 0.35 * bite), t, tc);

      // Random-walk the squeal pitch. Re-rolling the target rather than the value itself keeps
      // the motion smooth; the chase rate sets how twitchy the slide sounds.
      const chase = 1 - Math.exp(-WANDER_RATE * dt);
      if (Math.random() < WANDER_RATE * dt) wanderTarget = (Math.random() * 2 - 1) * WANDER_DEPTH;
      wander += (wanderTarget - wander) * chase;

      // Stick-slip chatter: re-rolled every frame and only lightly smoothed, so the pitch never
      // quite settles. The bite pushes the pitch up a little — the yelp as the grip snaps.
      const chatter = (Math.random() * 2 - 1) * CHATTER_DEPTH;

      const hz = squealHz(i, speedFrac) * (1 + wander + chatter + 0.06 * bite);
      squealA.frequency.setTargetAtTime(hz, t, CHATTER_TC);
      squealB.frequency.setTargetAtTime(hz, t, CHATTER_TC);
      partial.frequency.setTargetAtTime(hz * PARTIAL_RATIO, t, CHATTER_TC);

      // Scrub carries the low end from the moment the tire breaks away, and opens up with speed.
      scrub.frequency.setTargetAtTime(lerp(160, 380, i * 0.5 + speedFrac * 0.5), t, 0.08);
      scrubTone.frequency.setTargetAtTime(lerp(700, 1300, speedFrac), t, 0.08);
      scrubGain.gain.setTargetAtTime(lerp(0.8, 1.1, i), t, tc);

      // Roughness gets deeper with the slide: a floor drift growls, a full-lock slide tears.
      // Band-limited noise is quiet (~0.045 RMS), hence the large gain: ~0.25 RMS of modulation
      // on a floor drift, ~0.55 at full lock.
      roughDepth.gain.setTargetAtTime(lerp(5.5, 12, i), t, tc);

      // The series filters cost a lot of level, hence the large make-up gains. The chatter rides
      // the drive as well as the pitch, so the grit flickers instead of sitting still.
      const howl = Math.pow(i, HOWL_CURVE);
      squealGain.gain.setTargetAtTime(11 * howl, t, tc);
      partialGain.gain.setTargetAtTime(3.2 * howl * i, t, tc);
      drive.gain.setTargetAtTime(lerp(2.2, 6.5, i) * (1 + chatter * 3) * (1 + 0.8 * bite), t, CHATTER_TC);
      // The clipper bounds its own output, so this fader is pure level and never changes tone.
      howlLevel.gain.setTargetAtTime(lerp(0.16, 0.42, i), t, tc);

      // Tear only arrives on a committed slide, and more of it at speed.
      const tearAmt = clamp01((i - 0.3) / 0.7);
      tear.frequency.setTargetAtTime(lerp(1400, 2400, speedFrac), t, 0.08);
      tearGain.gain.setTargetAtTime(0.5 * tearAmt * tearAmt * lerp(0.6, 1, speedFrac), t, tc);
    },

    reset() {
      const t = ctx.currentTime;
      wander = 0;
      wanderTarget = 0;
      bite = 0;
      follow = 0;
      out.gain.setValueAtTime(0, t);
      scrubGain.gain.setValueAtTime(0, t);
      squealGain.gain.setValueAtTime(0, t);
      partialGain.gain.setValueAtTime(0, t);
      howlLevel.gain.setValueAtTime(0, t);
      tearGain.gain.setValueAtTime(0, t);
      roughDepth.gain.setValueAtTime(0, t);
      drive.gain.setValueAtTime(2, t);
    },

    dispose() {
      for (const s of [src, roughSrc]) {
        try {
          s.stop();
        } catch {
          /* already stopped */
        }
      }
      out.disconnect();
      scrub.disconnect();
      scrubTone.disconnect();
      scrubGain.disconnect();
      roughLp.disconnect();
      roughHp.disconnect();
      roughDepth.disconnect();
      squealA.disconnect();
      squealB.disconnect();
      squealGain.disconnect();
      partial.disconnect();
      partialGain.disconnect();
      drive.disconnect();
      rasp.disconnect();
      dcBlock.disconnect();
      presence.disconnect();
      fizzCut.disconnect();
      howlRough.disconnect();
      howlLevel.disconnect();
      tear.disconnect();
      tearRough.disconnect();
      tearGain.disconnect();
    },
  };
}
