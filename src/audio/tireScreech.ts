import type { AudioCore } from './core';
import { AUDIO } from '../config/tuning';
import { clamp01, lerp } from '../core/math';

export interface TireScreech {
  /** `intensity` is the 0..1 slide amount (see `skidIntensity`); `speed` is signed m/s. */
  update(dt: number, intensity: number, speed: number): void;
  reset(): void;
  dispose(): void;
}

/**
 * Continuous tire scrub while sliding. Two layers off one looping noise source: a broadband
 * "hiss" body (the rubber scrubbing asphalt) and a narrow, higher-Q resonant "squeal" that
 * brightens with slip. A slow tremolo keeps it alive rather than a flat wash. Level tracks the
 * same slide intensity that drives the tire smoke, so what you see and what you hear agree.
 */
export function createTireScreech(core: AudioCore): TireScreech {
  const { ctx, master, noise } = core;

  const out = ctx.createGain();
  out.gain.value = 0;
  out.connect(master);

  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.loop = true;

  // A gentle tremolo so the scrub shimmers instead of sitting as a static noise bed.
  const trem = ctx.createGain();
  trem.gain.value = 0.85;
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 11;
  const lfoDepth = ctx.createGain();
  lfoDepth.gain.value = 0.15;
  lfo.connect(lfoDepth).connect(trem.gain);
  src.connect(trem);

  // Body: broadband scrub.
  const body = ctx.createBiquadFilter();
  body.type = 'bandpass';
  body.frequency.value = 1600;
  body.Q.value = 1.1;
  const bodyGain = ctx.createGain();
  bodyGain.gain.value = 0.8;
  trem.connect(body).connect(bodyGain).connect(out);

  // Squeal: a resonant peak that only really speaks at higher slip.
  const squeal = ctx.createBiquadFilter();
  squeal.type = 'bandpass';
  squeal.frequency.value = 2400;
  squeal.Q.value = 9;
  const squealGain = ctx.createGain();
  squealGain.gain.value = 0;
  trem.connect(squeal).connect(squealGain).connect(out);

  src.start();
  lfo.start();

  return {
    update(dt, intensity, speed) {
      const t = ctx.currentTime;
      const tc = Math.max(0.03, Math.min(0.08, dt * 4)); // snappy but click-free
      const i = clamp01(intensity);

      out.gain.setTargetAtTime(AUDIO.tireVolume * i, t, tc);

      // Faster slides scrub a touch brighter; the squeal climbs and rewards big-angle slides.
      const speedFactor = clamp01(Math.abs(speed) / 30);
      body.frequency.setTargetAtTime(lerp(1300, 2100, i * 0.6 + speedFactor * 0.4), t, 0.08);
      squeal.frequency.setTargetAtTime(lerp(1900, 3200, i), t, 0.08);
      squealGain.gain.setTargetAtTime(0.5 * i * i, t, tc);
    },

    reset() {
      const t = ctx.currentTime;
      out.gain.setValueAtTime(0, t);
      squealGain.gain.setValueAtTime(0, t);
    },

    dispose() {
      try {
        src.stop();
        lfo.stop();
      } catch {
        /* already stopped */
      }
      out.disconnect();
    },
  };
}
