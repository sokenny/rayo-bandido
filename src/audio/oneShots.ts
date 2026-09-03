import type { AudioCore } from './core';
import { AUDIO } from '../config/tuning';

export interface OneShots {
  /** The lightning weapon firing: a sharp electric crack with a sizzling tail. */
  lightning(): void;
  /** An electric car losing power and going out of service: a descending spin-down + fizzle. */
  shutdown(): void;
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
