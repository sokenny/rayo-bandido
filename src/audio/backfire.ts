import { AUDIO } from '../config/tuning';
import { clamp01 } from '../core/math';
import { REF_SPEED, engineNote } from './dsp';

/**
 * Exhaust backfire — the "pops and bangs" of an anti-lag / overrun tune.
 *
 * Two things make a hot exhaust bang, and both are modeled here:
 * - **Overrun.** The throttle snaps shut, unburnt fuel dumps into a glowing exhaust and
 *   detonates there. This is the loud one, and it comes in a short burst of two or three
 *   decaying cracks rather than a single hit. It is gated on road speed, not on the engine
 *   note: what makes a pipe bang is how long it has been under load, and the fake gearbox
 *   sweeps past redline once per gear, so gating on revs would make the bang a coincidence
 *   of when you happened to lift.
 * - **Crackle.** Pinned near the limiter (or on nitro) the same thing happens sporadically,
 *   giving the continuous snap-crackle under load. This one is gated on the engine note.
 *
 * The trigger is pure and allocation-free so it can be unit tested without an AudioContext,
 * and so the audio bang and the visual flame spit off the same decision on the same frame.
 */

/** Shape of the effect. Volume lives in `AUDIO.backfireVolume`; these are the timings. */
export const BACKFIRE = {
  /**
   * Engine note (0..1) below which the crackle stays quiet. Set high on purpose: this one
   * wants the last of the rev range, not merely a raised note, so the crackle stays something
   * you have to hold the car at rather than something any old part-throttle earns.
   */
  MIN_RPM01: 0.78,
  /** Speed fraction below which a crawling car never pops, whatever the fake gearbox says. */
  MIN_SPEED_FRAC: 0.18,
  /** Speed fraction at which the exhaust is fully heat-soaked and lift-off bangs are loudest. */
  HOT_SPEED_FRAC: 0.45,
  /** Throttle drop within one frame that counts as a snap lift-off. */
  LIFT_DROP: 0.3,
  /**
   * How long a lift-off burst runs, as weights for one, two and three cracks. A triple is the
   * showpiece and stays rare on purpose: fired off every lift it stops reading as an event and
   * starts sounding like a stutter, and it is the single cracks either side that make it land.
   */
  LIFT_BANG_WEIGHTS: [0.46, 0.42, 0.12],
  /** Longest burst one lift-off can queue. Matches the length of `LIFT_BANG_WEIGHTS`. */
  LIFT_BANGS_MAX: 3,
  /** Nominal gap (s) between the cracks of a lift-off burst; jittered per hit. */
  LIFT_SPACING: 0.085,
  /** Each crack in a burst is this much quieter than the one before. */
  LIFT_FALLOFF: 0.72,
  /** Throttle above which an on-load crackle can fire. */
  CRACKLE_THROTTLE: 0.8,
  /**
   * Crackles per second at redline. Nitro multiplies this. Kept sparse on purpose: at a high
   * rate the pops stop being punctuation and turn into texture, and each one stops landing.
   */
  CRACKLE_HZ: 3.2,
  /** Extra crackle rate while boosting. */
  NITRO_RATE_SCALE: 1.4,
  /** Hard floor (s) between any two bangs, so they never machine-gun. */
  MIN_INTERVAL: 0.07,
} as const;

/** Draw a burst length from `LIFT_BANG_WEIGHTS`: mostly one or two cracks, rarely three. */
function pickLiftBangs(): number {
  let r = Math.random();
  for (let i = 0; i < BACKFIRE.LIFT_BANG_WEIGHTS.length - 1; i++) {
    r -= BACKFIRE.LIFT_BANG_WEIGHTS[i];
    if (r < 0) return i + 1;
  }
  return BACKFIRE.LIFT_BANG_WEIGHTS.length;
}

export interface BackfireTrigger {
  /**
   * Advance one render frame and report whether the exhaust bangs.
   *
   * @param speed Signed longitudinal speed (m/s).
   * @param throttle Applied throttle 0..1.
   * @param nitro Boosting this frame.
   * @returns 0 for no bang, otherwise the strength 0..1 to fire the sound and flame at.
   */
  tick(dt: number, speed: number, rpm01: number, throttle: number, nitro: boolean): number;
  reset(): void;
}

export function createBackfireTrigger(): BackfireTrigger {
  let prevThrottle = 0;
  let sinceLast: number = BACKFIRE.MIN_INTERVAL;
  let pending = 0;
  let pendingStrength = 0;
  let nextIn = 0;

  return {
    tick(dt, speed, rpm01In, throttle, nitro) {
      sinceLast += dt;

      const speedFrac = Math.abs(speed) / REF_SPEED;
      const rpm01 = engineNote(rpm01In);
      // How heat-soaked the pipes are: a proxy for time spent under load, so it tracks road
      // speed rather than the fake gearbox — which sweeps past redline once per gear and would
      // otherwise make an overrun bang a coincidence of when you happened to lift.
      const speedHeat = clamp01(
        (speedFrac - BACKFIRE.MIN_SPEED_FRAC) / (BACKFIRE.HOT_SPEED_FRAC - BACKFIRE.MIN_SPEED_FRAC),
      );
      // How close the engine note is to the limiter.
      const rpmHeat = clamp01((rpm01 - BACKFIRE.MIN_RPM01) / (1 - BACKFIRE.MIN_RPM01));

      const drop = prevThrottle - throttle;
      prevThrottle = throttle;

      // A snap lift-off with hot pipes queues a burst; a second lift mid-burst re-arms it.
      // Speed carries this one — revs only decide how angry it is.
      const liftHeat = speedHeat * (0.65 + 0.35 * rpmHeat);
      if (liftHeat > 0 && drop > BACKFIRE.LIFT_DROP) {
        pending = pickLiftBangs();
        pendingStrength = 0.55 + 0.45 * liftHeat;
        nextIn = 0;
      }

      if (pending > 0) {
        nextIn -= dt;
        if (nextIn > 0 || sinceLast < BACKFIRE.MIN_INTERVAL) return 0;
        pending--;
        nextIn = BACKFIRE.LIFT_SPACING * (0.7 + Math.random() * 0.7);
        sinceLast = 0;
        const strength = pendingStrength;
        pendingStrength *= BACKFIRE.LIFT_FALLOFF;
        return clamp01(strength);
      }

      // On-load crackle: this one really does want the limiter, and the throttle buried.
      const crackleHeat = speedHeat > 0 ? rpmHeat : 0;
      if (crackleHeat <= 0) return 0;
      if (throttle <= BACKFIRE.CRACKLE_THROTTLE && !nitro) return 0;
      if (sinceLast < BACKFIRE.MIN_INTERVAL) return 0;
      const rate = BACKFIRE.CRACKLE_HZ * crackleHeat * (nitro ? BACKFIRE.NITRO_RATE_SCALE : 1);
      if (Math.random() >= rate * dt) return 0;
      sinceLast = 0;
      return clamp01(0.28 + 0.4 * crackleHeat * Math.random() + (nitro ? 0.15 : 0));
    },

    reset() {
      prevThrottle = 0;
      sinceLast = BACKFIRE.MIN_INTERVAL;
      pending = 0;
      pendingStrength = 0;
      nextIn = 0;
    },
  };
}

/**
 * Hard clip curve for the bang. Much steeper than the engine's exhaust rasp: driven this hard
 * it squares off the transient, which is what turns a noise burst into a *detonation* instead
 * of a hiss. Built once at module load and shared by every bang.
 */
const CLIP_CURVE = ((): Float32Array<ArrayBuffer> => {
  const n = 2048;
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  const k = 6;
  const norm = Math.tanh(k);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x) / norm;
  }
  return curve;
})();

/**
 * One bang, scheduled against the audio clock.
 *
 * The whole thing is a **blast**: a noise burst through a low, resonant bandpass, slammed hard
 * into a shared clipper. Filtering low before the distortion is what matters — broadband noise
 * through a highpass just sounds like tearing paper, because the ear reads high-frequency noise
 * as air, not pressure. Three parts feed that clipper: the **crack** (a bright, 30 ms ignition
 * transient), the **blast** itself around 200 Hz, and a short **tail** of the charge burning off
 * down the pipe. A clean sine **sub** bypasses the clipper so the low thump keeps its weight
 * instead of being squared away with everything else.
 *
 * Loudness comes from the sustained low-mid energy, not from a taller peak — the master limiter
 * flattens peaks anyway, so a spikier bang would only sound thinner.
 *
 * Standalone (not closed over an engine), matching `fireTurboFlutter`, so it can be
 * auditioned in isolation.
 */
export function fireBackfire(ctx: AudioContext, out: AudioNode, noise: AudioBuffer, strength: number): void {
  const t0 = ctx.currentTime;
  const s = clamp01(strength);
  const v = Math.max(0.0004, AUDIO.backfireVolume * (0.45 + 0.55 * s));
  // Random noise offsets and a pitch jitter so repeated bangs never sound cloned.
  const jitter = 0.88 + Math.random() * 0.24;

  // --- Shared output stage: everything below is fused by one clipper. -------------------
  const clip = ctx.createWaveShaper();
  clip.curve = CLIP_CURVE;
  clip.oversample = '2x';
  const level = ctx.createGain();
  level.gain.value = v;
  clip.connect(level).connect(out);

  // Pre-clip drive. Harder bangs are pushed further into the distortion, so strength changes
  // the character (angrier, more squared off) and not just the volume.
  const drive = ctx.createGain();
  drive.gain.value = 2.5 + 4 * s;
  drive.connect(clip);

  // --- Blast: the bang itself. Low, resonant, and the longest of the clipped layers. ----
  const blastEnd = t0 + 0.11 + 0.1 * s;
  const blast = ctx.createBufferSource();
  blast.buffer = noise;
  const blastBp = ctx.createBiquadFilter();
  blastBp.type = 'bandpass';
  blastBp.Q.value = 1.4;
  blastBp.frequency.setValueAtTime(240 * jitter, t0);
  blastBp.frequency.exponentialRampToValueAtTime(120, blastEnd);
  const blastGain = ctx.createGain();
  blastGain.gain.setValueAtTime(0.0001, t0);
  blastGain.gain.exponentialRampToValueAtTime(1.4, t0 + 0.003);
  blastGain.gain.exponentialRampToValueAtTime(0.0001, blastEnd);
  blast.connect(blastBp).connect(blastGain).connect(drive);
  blast.start(t0, Math.random() * 1.5);
  blast.stop(blastEnd + 0.02);

  // --- Crack: the ignition transient. Bright but very short, so it snaps without hissing. --
  const crackEnd = t0 + 0.028 + 0.016 * s;
  const crack = ctx.createBufferSource();
  crack.buffer = noise;
  const crackBp = ctx.createBiquadFilter();
  crackBp.type = 'bandpass';
  crackBp.Q.value = 0.8;
  crackBp.frequency.setValueAtTime(1900 * jitter, t0);
  crackBp.frequency.exponentialRampToValueAtTime(500, crackEnd);
  const crackGain = ctx.createGain();
  crackGain.gain.setValueAtTime(0.0001, t0);
  crackGain.gain.exponentialRampToValueAtTime(1.1, t0 + 0.0012);
  crackGain.gain.exponentialRampToValueAtTime(0.0001, crackEnd);
  crack.connect(crackBp).connect(crackGain).connect(drive);
  crack.start(t0, Math.random() * 1.5);
  crack.stop(crackEnd + 0.02);

  // --- Tail: the rest of the charge burning off down the pipe. ---
  const tailEnd = t0 + 0.13 + 0.17 * s;
  const tail = ctx.createBufferSource();
  tail.buffer = noise;
  const tailBp = ctx.createBiquadFilter();
  tailBp.type = 'bandpass';
  tailBp.Q.value = 2.6;
  tailBp.frequency.setValueAtTime(900 * jitter, t0);
  tailBp.frequency.exponentialRampToValueAtTime(320, tailEnd);
  const tailGain = ctx.createGain();
  tailGain.gain.setValueAtTime(0.0001, t0);
  tailGain.gain.exponentialRampToValueAtTime(0.5, t0 + 0.014);
  tailGain.gain.exponentialRampToValueAtTime(0.0001, tailEnd);
  tail.connect(tailBp).connect(tailGain).connect(drive);
  tail.start(t0, Math.random() * 1.5);
  tail.stop(tailEnd + 0.02);

  // --- Sub: clean low thump, straight to the output. Bigger bangs sit lower and last longer. --
  const subEnd = t0 + 0.13 + 0.12 * s;
  const subHz = (128 - 46 * s) * jitter;
  const sub = ctx.createOscillator();
  sub.type = 'sine';
  sub.frequency.setValueAtTime(subHz, t0);
  sub.frequency.exponentialRampToValueAtTime(subHz * 0.38, subEnd);
  const subGain = ctx.createGain();
  subGain.gain.setValueAtTime(0.0001, t0);
  subGain.gain.exponentialRampToValueAtTime(v * 1.15, t0 + 0.004);
  subGain.gain.exponentialRampToValueAtTime(0.0001, subEnd);
  sub.connect(subGain).connect(out);
  sub.start(t0);
  sub.stop(subEnd + 0.02);

  // The tail always outlives the clipped layers; the sub is scheduled to end before it.
  tail.onended = () => {
    blastGain.disconnect();
    blastBp.disconnect();
    crackGain.disconnect();
    crackBp.disconnect();
    tailGain.disconnect();
    tailBp.disconnect();
    subGain.disconnect();
    drive.disconnect();
    clip.disconnect();
    level.disconnect();
  };
}
