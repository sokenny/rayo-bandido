import type { AudioCore } from './core';
import { AUDIO } from '../config/tuning';
import { clamp, clamp01, lerp } from '../core/math';
import { engineNote } from './dsp';
import { fireBackfire } from './backfire';
import { createTurboFlutterTrigger, fireTurboFlutter } from './turboFlutter';

/** Live drive state the engine voice reads each frame. */
export interface EngineInput {
  /** Engine rpm from the simulation, 0 idle .. 1 redline (`VehicleState.rpm01`). */
  rpm01: number;
  /** Signed longitudinal speed (m/s); the turbo model spools on road speed. */
  speed: number;
  /** Applied throttle 0..1. */
  throttle: number;
  /** Applied brake 0..1. */
  brake: number;
  /** Nitro boosting this frame. */
  nitro: boolean;
}

export interface EngineVoice {
  update(dt: number, input: EngineInput): void;
  /** Fanfare when a nitro boost begins: a turbo spool + whoosh. */
  nitroWhoosh(): void;
  /** One exhaust pop/bang at the given strength (0..1). Driven by `createBackfireTrigger`. */
  backfire(strength: number): void;
  /** Snap back to idle (on restart). */
  reset(): void;
  dispose(): void;
}

/** Cylinders and firing model. A four-stroke fires cyl/2 times per crank revolution. */
const CYLINDERS = 4;
/** Firing rate (Hz) the cycle buffers are baked at. playbackRate = wantedFiringHz / this. */
const REF_FIRING_HZ = 50;

/**
 * Bakes one full four-stroke cycle (CYLINDERS combustion pulses) into a looping buffer. Each
 * pulse is a short, fast-decaying "pop" with a low body tone plus grit — the exhaust note of
 * one cylinder firing. Per-cylinder amplitude and body-pitch jitter give the loop the uneven,
 * lumpy character of a real engine instead of a synth's perfect periodicity.
 *
 * Looping this and varying playbackRate revs the engine while keeping the pulse texture, which
 * is the whole point: sweeping an oscillator's pitch sounds like a zipper; pitching a train of
 * combustion pulses sounds like a car.
 */
function bakeEngineCycle(ctx: AudioContext, bodyHz: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const firingInterval = 1 / REF_FIRING_HZ;
  const len = Math.max(1, Math.floor(sr * firingInterval * CYLINDERS));
  const buffer = ctx.createBuffer(1, len, sr);
  const data = buffer.getChannelData(0);
  const decay = 190; // ~5 ms time constant: each pop clears well before the next fires
  const pulseSamples = Math.floor(firingInterval * sr);

  for (let c = 0; c < CYLINDERS; c++) {
    const start = Math.floor(c * firingInterval * sr);
    const amp = 0.72 + Math.random() * 0.28; // cylinder-to-cylinder unevenness
    const f = bodyHz * (0.9 + Math.random() * 0.2);
    for (let i = 0; i < pulseSamples; i++) {
      const t = i / sr;
      const attack = Math.min(1, t / 0.0008);
      const env = attack * Math.exp(-t * decay);
      const tone =
        Math.sin(2 * Math.PI * f * t) +
        0.5 * Math.sin(2 * Math.PI * 2 * f * t) +
        0.28 * Math.sin(2 * Math.PI * 3 * f * t);
      const grit = (Math.random() * 2 - 1) * 0.55;
      const idx = start + i;
      if (idx < len) data[idx] += env * amp * (tone + grit);
    }
  }

  // Normalize to a predictable peak so the mix level is stable regardless of the random bake.
  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(data[i]));
  if (peak > 0) {
    const g = 0.9 / peak;
    for (let i = 0; i < len; i++) data[i] *= g;
  }
  return buffer;
}

/** Soft-clip curve (tanh) for exhaust/header rasp. More drive into it = more growl. */
function makeSoftClipCurve(): Float32Array<ArrayBuffer> {
  const n = 2048;
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  const k = 2.2;
  const norm = Math.tanh(k);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x) / norm;
  }
  return curve;
}

/**
 * A synthesized four-stroke turbo engine, built as a looped train of combustion pulses (two
 * detuned banks for thickness) driven through a soft-clip waveshaper for exhaust/header rasp
 * and a lowpass that opens under load. Revving changes the loop's playback rate — the pulse
 * texture is preserved at every rpm. A quiet turbo whine spools with rpm and throttle, and
 * lifting off the throttle at speed pops the blow-off valve.
 */
export function createEngine(core: AudioCore): EngineVoice {
  const { ctx, master, noise } = core;

  // --- Output stage: waveshaper (rasp) -> lowpass (brightness) -> level. -----------------
  const toneGain = ctx.createGain();
  toneGain.gain.value = 0;

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 500;
  filter.Q.value = 0.9;
  filter.connect(toneGain);
  toneGain.connect(master);

  const shaper = ctx.createWaveShaper();
  shaper.curve = makeSoftClipCurve();
  shaper.oversample = '2x';
  shaper.connect(filter);

  // Pre-shaper drive: raising this pushes harder into the soft clip for more growl under load.
  const drive = ctx.createGain();
  drive.gain.value = 1;
  drive.connect(shaper);

  // --- Two combustion-pulse banks, slightly detuned, summed into the drive stage. --------
  const bankA = ctx.createBufferSource();
  bankA.buffer = bakeEngineCycle(ctx, 118);
  bankA.loop = true;
  const gainA = ctx.createGain();
  gainA.gain.value = 0.6;
  bankA.connect(gainA).connect(drive);

  const bankB = ctx.createBufferSource();
  bankB.buffer = bakeEngineCycle(ctx, 92);
  bankB.loop = true;
  const gainB = ctx.createGain();
  gainB.gain.value = 0.5;
  bankB.connect(gainB).connect(drive);

  // A low sine glued to the firing rate adds chest-thump body under the pulses.
  const sub = ctx.createOscillator();
  sub.type = 'sine';
  const subGain = ctx.createGain();
  subGain.gain.value = 0.5;
  sub.connect(subGain).connect(drive);

  // Combustion hiss/air that grows with load, into the same output stage (post-shaper).
  const combSrc = ctx.createBufferSource();
  combSrc.buffer = noise;
  combSrc.loop = true;
  const combFilter = ctx.createBiquadFilter();
  combFilter.type = 'bandpass';
  combFilter.frequency.value = 900;
  combFilter.Q.value = 0.7;
  const combGain = ctx.createGain();
  combGain.gain.value = 0;
  combSrc.connect(combFilter).connect(combGain).connect(filter);

  // --- Turbo whine: a high triangle that rises with spool. -------------------------------
  const turbo = ctx.createOscillator();
  turbo.type = 'triangle';
  const turboGain = ctx.createGain();
  turboGain.gain.value = 0;
  turbo.connect(turboGain).connect(master);

  bankA.start();
  bankB.start();
  sub.start();
  combSrc.start();
  turbo.start();

  const flutter = createTurboFlutterTrigger();

  function firingHzFor(rpm01: number): number {
    return lerp(AUDIO.engineIdleHz, AUDIO.engineRedlineHz, rpm01);
  }

  return {
    update(dt, input) {
      const t = ctx.currentTime;
      const tc = Math.max(0.03, Math.min(0.12, dt * 3)); // smooth revs; gear shifts glide

      const rpm01 = engineNote(input.rpm01);
      const throttle = clamp01(input.throttle);
      const nitroBoost = input.nitro ? 1 : 0;

      // Rev the pulse trains by playback rate; a hair of detune between banks thickens it.
      const firing = firingHzFor(rpm01);
      const rate = firing / REF_FIRING_HZ;
      bankA.playbackRate.setTargetAtTime(rate, t, tc);
      bankB.playbackRate.setTargetAtTime(rate * 1.006, t, tc);
      sub.frequency.setTargetAtTime(firing, t, tc);
      combFilter.frequency.setTargetAtTime(lerp(500, 1600, rpm01), t, tc);

      // Brightness opens with rpm and throttle; nitro throws it wide open.
      const cutoff = clamp(
        lerp(420, 5200, rpm01) * (0.5 + 0.5 * throttle) + nitroBoost * 2000,
        260,
        11000,
      );
      filter.frequency.setTargetAtTime(cutoff, t, tc);

      // More throttle = harder into the soft clip = more exhaust growl.
      const load = clamp01(0.3 + 0.5 * rpm01 + 0.45 * throttle + nitroBoost * 0.25);
      drive.gain.setTargetAtTime(lerp(1, 3.6, clamp01(0.35 * rpm01 + 0.65 * throttle)) + nitroBoost, t, 0.06);

      // Loudness: idle floor + load, never fully silent, never past the mix level.
      toneGain.gain.setTargetAtTime(AUDIO.engineVolume * (0.4 + 0.6 * load), t, 0.05);
      combGain.gain.setTargetAtTime(AUDIO.engineVolume * (0.06 + 0.35 * throttle * rpm01), t, 0.05);

      // One boost model drives both the whine and the flutter, so they can never disagree about
      // how spooled the car is. The surge fires only on a closed throttle with pressure behind
      // it (see `audio/turboFlutter.ts`) — not on every lift, which is most of them.
      const surge = flutter.tick(dt, input.speed, throttle, input.nitro);
      if (surge > 0) fireTurboFlutter(ctx, master, noise, surge);

      // Whine: pitched by boost, coloured by the gear so upshifts still bend the note.
      const spool = flutter.boost;
      turbo.frequency.setTargetAtTime(lerp(700, 5400, spool * (0.55 + 0.45 * rpm01)), t, 0.06);
      turboGain.gain.setTargetAtTime(AUDIO.turboVolume * spool * spool, t, 0.06);
    },

    backfire(strength) {
      fireBackfire(ctx, master, noise, strength);
    },

    nitroWhoosh() {
      const t = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = noise;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 0.9;
      bp.frequency.setValueAtTime(900, t);
      bp.frequency.exponentialRampToValueAtTime(6000, t + 0.18);
      bp.frequency.exponentialRampToValueAtTime(2200, t + 0.5);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(AUDIO.nitroVolume, t + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
      src.connect(bp).connect(g).connect(master);
      src.start(t);
      src.stop(t + 0.6);
      src.onended = () => {
        g.disconnect();
        bp.disconnect();
      };
    },

    reset() {
      const t = ctx.currentTime;
      flutter.reset();
      const rate = firingHzFor(0.18) / REF_FIRING_HZ;
      bankA.playbackRate.setValueAtTime(rate, t);
      bankB.playbackRate.setValueAtTime(rate * 1.006, t);
      sub.frequency.setValueAtTime(firingHzFor(0.18), t);
      turboGain.gain.setValueAtTime(0, t);
    },

    dispose() {
      try {
        bankA.stop();
        bankB.stop();
        sub.stop();
        combSrc.stop();
        turbo.stop();
      } catch {
        /* already stopped */
      }
      toneGain.disconnect();
      filter.disconnect();
      shaper.disconnect();
      drive.disconnect();
      turboGain.disconnect();
    },
  };
}
