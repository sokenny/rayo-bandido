import type { AudioCore } from './core';
import { AUDIO } from '../config/tuning';

export interface OneShots {
  /** The lightning weapon firing: a sharp electric crack with a sizzling tail. */
  lightning(): void;
  /** An electric car losing power and going out of service: a descending spin-down + fizzle. */
  shutdown(): void;
  /**
   * The doppler whoosh of shaving past a car. `quality` 0..1 (how good the pass was) makes it
   * louder, brighter and snappier, so a paint-scraping pass sounds different from a wide one.
   */
  nearMiss(quality: number): void;
  /** Race countdown tick; `go` is the longer, higher note on the lights going out. */
  countdown(go: boolean): void;
}

/**
 * Transient sound effects. Each call builds a tiny throwaway graph, schedules it against the
 * audio clock, and disconnects itself on `ended`. These fire rarely, so per-event allocation
 * is fine.
 */
export function createOneShots(core: AudioCore): OneShots {
  const { ctx, master, noise } = core;

  function playNoise(
    from: number,
    to: number,
    filterType: BiquadFilterType,
    fStart: number,
    fEnd: number,
    q: number,
    peak: number,
    attack: number,
  ): void {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    // Start at a random offset so repeats don't sound identical.
    const offset = Math.random() * 1.5;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(fStart, from);
    filter.frequency.exponentialRampToValueAtTime(Math.max(20, fEnd), to);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, from);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), from + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, to);
    src.connect(filter).connect(g).connect(master);
    src.start(from, offset);
    src.stop(to + 0.02);
    src.onended = () => {
      g.disconnect();
      filter.disconnect();
    };
  }

  function playOsc(
    type: OscillatorType,
    from: number,
    to: number,
    fStart: number,
    fEnd: number,
    peak: number,
    attack: number,
    lp?: number,
  ): void {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(fStart, from);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, fEnd), to);
    let node: AudioNode = osc;
    let filter: BiquadFilterNode | null = null;
    if (lp !== undefined) {
      filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = lp;
      filter.Q.value = 6;
      osc.connect(filter);
      node = filter;
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, from);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), from + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, to);
    node.connect(g).connect(master);
    osc.start(from);
    osc.stop(to + 0.02);
    osc.onended = () => {
      g.disconnect();
      if (filter) filter.disconnect();
    };
  }

  return {
    lightning() {
      const t = ctx.currentTime;
      const v = AUDIO.lightningVolume;
      // Body: a low thump so the shot lands with weight.
      playOsc('sine', t, t + 0.16, 90, 42, 0.6 * v, 0.004);
      // Zap: a bright saw diving through a resonant lowpass — the "pew".
      playOsc('sawtooth', t, t + 0.14, 2200, 190, 0.5 * v, 0.003, 2600);
      // Crack: a sharp high noise transient.
      playNoise(t, t + 0.07, 'highpass', 1800, 1800, 0.7, 0.7 * v, 0.002);
      // Sizzle tail: crackling electricity dying off.
      playNoise(t + 0.01, t + 0.34, 'bandpass', 3600, 2400, 6, 0.32 * v, 0.01);
    },

    nearMiss(quality) {
      const q = quality < 0 ? 0 : quality > 1 ? 1 : quality;
      const t = ctx.currentTime;
      const v = AUDIO.nearMissVolume * (0.55 + 0.45 * q);
      // The pass itself: a band of air sweeping down past the ear. A closer, faster pass
      // starts brighter and gets through quicker, which is what sells the speed.
      const dur = 0.34 - 0.1 * q;
      playNoise(t, t + dur, 'bandpass', 1500 + 1900 * q, 320, 1.6, 0.85 * v, 0.05 + 0.05 * (1 - q));
      // Body: the low pressure wave under the whoosh, only on a genuinely close pass.
      if (q > 0.25) playOsc('sine', t + 0.02, t + 0.24, 150, 60, 0.35 * v * q, 0.05);
    },

    countdown(go) {
      const t = ctx.currentTime;
      const v = AUDIO.countdownVolume;
      if (go) {
        // Two stacked tones, a fifth apart, held: the lights are out.
        playOsc('square', t, t + 0.62, 1046, 1046, 0.5 * v, 0.006, 3200);
        playOsc('square', t, t + 0.62, 1568, 1568, 0.3 * v, 0.006, 4200);
      } else {
        playOsc('square', t, t + 0.19, 784, 784, 0.55 * v, 0.006, 2600);
      }
    },

    shutdown() {
      const t = ctx.currentTime;
      const v = AUDIO.shutdownVolume;
      // Spin-down: the hover pitch gliding down as the motor loses power.
      playOsc('sawtooth', t, t + 0.72, 320, 46, 0.4 * v, 0.01, 1400);
      playOsc('sine', t, t + 0.7, 240, 38, 0.32 * v, 0.01);
      // Electrical short: a bright fizzle sweeping down.
      playNoise(t, t + 0.4, 'bandpass', 2600, 700, 4, 0.28 * v, 0.006);
      // Final thunk as it settles dead.
      playOsc('sine', t + 0.6, t + 0.9, 110, 48, 0.35 * v, 0.006);
    },
  };
}
