import type { AudioCore } from './core';
import type { PassByGust } from './passBy';
import { PASS_BY } from '../config/tuning';

export interface WindGusts {
  /** Voice one pass (`audio/passBy.ts`). Dropped when `PASS_BY.maxVoices` are already sounding. */
  play(g: PassByGust): void;
}

/**
 * The rush of air past something close at speed. No tone and no reward in it — just displaced
 * air, the way it sounds through an open window:
 *
 * - AIR: noise through a wide band that sweeps up into the pass and falls away after it, the
 *   doppler drop that tells the ear the thing went BY rather than simply got loud.
 * - PUSH: a low lowpassed thump of pressure under it, scaled by how much the object displaces —
 *   a bus or a pillar thumps, a cone barely does.
 * - PAN: it arrives from ahead-ish on its side and swings hard to that side as it passes.
 *
 * The swell peaks at `g.lead`, the moment the object is abreast. A faster pass is shorter and
 * brighter; a closer one louder. Each gust is a throwaway graph that disconnects itself.
 */
export function createWindGusts(core: AudioCore): WindGusts {
  const { ctx, master, noise } = core;
  let voices = 0;

  return {
    play(g) {
      if (voices >= PASS_BY.maxVoices) return;
      const s = g.strength < 0 ? 0 : g.strength > 1 ? 1 : g.strength;
      const speed01 = Math.min(1, Math.max(0, (g.speed - PASS_BY.minSpeed) / (PASS_BY.fullSpeed - PASS_BY.minSpeed)));
      const t0 = ctx.currentTime;
      const peakAt = t0 + Math.max(0.025, g.lead) + 1.2 / g.speed;
      const end = peakAt + 0.1 + 7 / g.speed + 0.08 * g.size;
      const v = PASS_BY.volume * (0.3 + 0.7 * s);

      const src = ctx.createBufferSource();
      src.buffer = noise;

      const air = ctx.createBiquadFilter();
      air.type = 'bandpass';
      air.Q.value = 0.8 + 0.6 * s;
      const fPeak = 1100 + 2600 * speed01 * (0.6 + 0.4 * s) - 350 * g.size;
      air.frequency.setValueAtTime(fPeak * 0.55, t0);
      air.frequency.exponentialRampToValueAtTime(fPeak, peakAt);
      air.frequency.exponentialRampToValueAtTime(Math.max(120, fPeak * 0.32), end);
      const airGain = ctx.createGain();
      airGain.gain.setValueAtTime(0.0001, t0);
      airGain.gain.exponentialRampToValueAtTime(Math.max(0.0002, v), peakAt);
      airGain.gain.exponentialRampToValueAtTime(0.0001, end);

      const push = ctx.createBiquadFilter();
      push.type = 'lowpass';
      push.Q.value = 0.9;
      push.frequency.setValueAtTime(420, t0);
      push.frequency.exponentialRampToValueAtTime(140, end);
      const pushGain = ctx.createGain();
      const pv = v * (0.25 + 1.1 * g.size) * s;
      pushGain.gain.setValueAtTime(0.0001, t0);
      pushGain.gain.exponentialRampToValueAtTime(Math.max(0.0002, pv), peakAt + 0.01);
      pushGain.gain.exponentialRampToValueAtTime(0.0001, end - 0.03);

      const out = ctx.createGain();
      out.gain.value = 1;
      let pan: StereoPannerNode | null = null;
      if (typeof ctx.createStereoPanner === 'function') {
        pan = ctx.createStereoPanner();
        pan.pan.setValueAtTime(g.side * 0.25, t0);
        pan.pan.linearRampToValueAtTime(g.side * 0.9, peakAt);
        pan.pan.linearRampToValueAtTime(g.side * 0.65, end);
        out.connect(pan).connect(master);
      } else {
        out.connect(master);
      }

      src.connect(air).connect(airGain).connect(out);
      src.connect(push).connect(pushGain).connect(out);
      src.start(t0, Math.random() * 1.5);
      src.stop(end + 0.02);
      voices++;
      src.onended = () => {
        voices--;
        air.disconnect();
        airGain.disconnect();
        push.disconnect();
        pushGain.disconnect();
        out.disconnect();
        if (pan) pan.disconnect();
      };
    },
  };
}
