import type { AudioCore } from './core';
import { AUDIO, NEAR_MISS } from '../config/tuning';

export interface OneShots {
  /** The lightning weapon firing: a sharp electric crack with a sizzling tail. */
  lightning(): void;
  /** An electric car losing power and going out of service: a descending spin-down + fizzle. */
  shutdown(): void;
  /**
   * The doppler whoosh of shaving past a car, plus the ping that says it PAID. `quality` 0..1
   * (how good the pass was) makes the whoosh louder, brighter and snappier, so a paint-scraping
   * pass sounds different from a wide one. Passes inside `NEAR_MISS.chainWindow` of each other
   * walk the ping up a pentatonic ladder, so threading a line of traffic plays a rising figure
   * instead of the same note four times.
   */
  nearMiss(quality: number): void;
  /** Race countdown tick; `go` is the longer, higher note on the lights going out. */
  countdown(go: boolean): void;
  /**
   * Rolling onto a free-world activity marker: the arcade pickup chime, a bright rising figure
   * over in a fifth of a second. Confirms the circle by ear before the prompt has finished
   * animating in, which is the whole job — it is a "you are standing on it", not a fanfare.
   */
  pickup(): void;
  /** A new wanted star: a police-scanner blip, two clipped tones and a crackle of static. */
  scanner(): void;
  /** The arrest: a falling stack and a thud. */
  busted(): void;
  /** The escape: two rising notes, the pickup's cousin, quieter. */
  escaped(): void;
  /** The Rayo meeting a shielded car: a hard metallic clink, no sizzle. */
  shield(): void;
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

  /**
   * Semitones above `CHIME_ROOT` for the 1st, 2nd, 3rd... pass of a run. Major pentatonic, so
   * any prefix of it is consonant and a long run climbs an octave and a half and then holds
   * rather than disappearing into dog-whistle territory.
   */
  const CHAIN_LADDER = [0, 2, 4, 7, 9, 12, 14, 16, 19];
  /** A6-ish: over the engine, under the lightning crack, out of the way of both. */
  const CHIME_ROOT = 880;
  let nearMissStep = 0;
  let lastNearMissAt = -Infinity;

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

      // The reward. Deliberately a separate thing from the whoosh: the whoosh happens whether
      // or not it scored, this only ever plays when the pass paid. A hair behind the air so it
      // lands as the CONSEQUENCE of it rather than part of it.
      nearMissStep = t - lastNearMissAt <= NEAR_MISS.chainWindow ? Math.min(nearMissStep + 1, CHAIN_LADDER.length - 1) : 0;
      lastNearMissAt = t;
      const f = CHIME_ROOT * Math.pow(2, CHAIN_LADDER[nearMissStep] / 12);
      const cv = AUDIO.nearMissChimeVolume * (0.6 + 0.4 * q);
      const at = t + 0.04;
      // Triangle body with a sine an octave over it: bell-ish without being a literal bell.
      playOsc('triangle', at, at + 0.3, f, f, 0.6 * cv, 0.003, f * 3.5);
      playOsc('sine', at, at + 0.19, f * 2, f * 2, 0.3 * cv, 0.003);
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

    pickup() {
      const t = ctx.currentTime;
      const v = AUDIO.pickupVolume;
      // A rising open figure — root, fourth, octave — rather than a chord: three quick notes
      // read as "picked up", where a stack of them reads as an achievement.
      const notes = [1046.5, 1396.9, 2093];
      const step = 0.042;
      for (let i = 0; i < notes.length; i++) {
        const at = t + i * step;
        const f = notes[i];
        // Triangle through a high lowpass: a chime, not the square wave the countdown uses.
        playOsc('triangle', at, at + 0.17, f, f, (0.5 - i * 0.07) * v, 0.003, 7000);
        // An octave above, quiet: the glassy top that makes it read as metal rather than a beep.
        playOsc('sine', at, at + 0.11, f * 2, f * 2, (0.14 - i * 0.03) * v, 0.003);
      }
      // A bright tick on the leading edge, so the first note has something to land on.
      playNoise(t, t + 0.05, 'highpass', 5200, 5200, 0.8, 0.2 * v, 0.002);
    },

    scanner() {
      const t = ctx.currentTime;
      const v = AUDIO.scannerVolume;
      // Two clipped tones through a narrow band: a radio, not an instrument.
      playOsc('square', t, t + 0.07, 1180, 1180, 0.5 * v, 0.003, 2400);
      playOsc('square', t + 0.09, t + 0.17, 1560, 1560, 0.45 * v, 0.003, 2600);
      // Static under and after them.
      playNoise(t, t + 0.22, 'bandpass', 2200, 1800, 3, 0.35 * v, 0.004);
    },

    busted() {
      const t = ctx.currentTime;
      const v = AUDIO.bustedVolume;
      // The stack falling: a saw and its octave gliding down over half a second.
      playOsc('sawtooth', t, t + 0.55, 260, 70, 0.4 * v, 0.01, 1600);
      playOsc('sawtooth', t, t + 0.55, 130, 35, 0.3 * v, 0.01, 900);
      // The thud that ends it.
      playOsc('sine', t + 0.4, t + 0.75, 90, 40, 0.5 * v, 0.006);
      playNoise(t + 0.4, t + 0.5, 'lowpass', 400, 200, 1, 0.3 * v, 0.004);
    },

    escaped() {
      const t = ctx.currentTime;
      const v = AUDIO.pickupVolume * 0.8;
      const notes = [880, 1318.5];
      for (let i = 0; i < notes.length; i++) {
        const at = t + i * 0.09;
        playOsc('triangle', at, at + 0.22, notes[i], notes[i], (0.45 - i * 0.1) * v, 0.004, 6000);
      }
    },

    shield() {
      const t = ctx.currentTime;
      const v = AUDIO.shieldVolume;
      // Metal: a high, short, inharmonic pair with a bright transient — the bolt bounced.
      playOsc('triangle', t, t + 0.09, 2400, 2100, 0.5 * v, 0.002, 9000);
      playOsc('sine', t, t + 0.12, 3170, 2900, 0.3 * v, 0.002);
      playNoise(t, t + 0.04, 'highpass', 6000, 6000, 0.8, 0.35 * v, 0.001);
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
