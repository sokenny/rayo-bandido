import type { AudioCore } from './core';
import { AUDIO } from '../config/tuning';
import { clamp01, lerp } from '../core/math';
import { REF_SPEED } from './dsp';
import { fetchSample, normalizeRms } from './sample';

export interface TireScreech {
  /** `intensity` is the 0..1 slip-angle amount (see `screechIntensity`); `speed` is ground speed in m/s. */
  update(dt: number, intensity: number, speed: number): void;
  reset(): void;
  dispose(): void;
}

/**
 * Seconds dropped off the end of the recording, after its trailing silence. The file ends on a
 * hard cut mid-squeal; this last tenth is where that cut lives.
 */
const TAIL_DROP = 0.1;
/** Below this (absolute sample value) the end of the decoded file counts as encoder padding. */
const SILENCE = 0.002;
/** Where the sustain grains may start reading: past the recording's soft ~40 ms onset. */
const BODY_START = 0.12;
/** Loudness (RMS) the recording is normalized to, so `AUDIO.tireVolume` survives a file swap. */
const TARGET_RMS = 0.2;

/** Length (s) of one sustain grain at playback rate 1. */
const GRAIN = 0.48;
/** Grains overlap by half: each one fades in while the previous one fades out. */
const HOP = GRAIN / 2;
/** How far ahead of the audio clock (s) grains are scheduled, so a slow frame never leaves a gap. */
const LOOKAHEAD = 0.12;
/** Minimum distance (s) between two consecutive grains' read positions, so neighbours never phase. */
const MIN_JUMP = 0.18;
/** Length (s) of the onset grain that opens a fresh slide with the recording's own attack. */
const HEAD = 0.36;
/** Fastest playback rate the voice asks for; grain read windows are sized for it. */
const MAX_RATE = 1.25;

/** Intensity below which the tires count as gripping. */
const GRIP = 0.06;
/** Intensity a slide has to reach again, after a lull, to re-attack instead of just fading back up. */
const REBREAK = 0.14;
/** Seconds of grip that turn the next slide into a fresh one (with the onset), not a continuation. */
const LULL = 0.1;
/** Seconds of grip after which the grains stop being scheduled at all. */
const IDLE = 0.35;

/**
 * Exponent on the level curve. Above 1 on purpose: the first few degrees past `ANGLE_START` are
 * barely there (15° is about -15 dB), and the squeal only fills out as the car gets properly sideways.
 */
const LEVEL_CURVE = 1.5;
/** Level time constants (s). Fast enough that a brief pause or a flick is heard as a dip. */
const ATTACK_TC = 0.025;
const RELEASE_TC = 0.06;
/** How long (s) the break-away yelp takes to fall off. */
const BITE_DECAY = 0.3;
/** Slow pitch wander (fraction) and its re-target rate (1/s): the slide angle breathing. */
const WANDER_DEPTH = 0.025;
const WANDER_RATE = 3;

/** An equal-power window: sin rising over the first half, falling over the second. */
function makeWindow(n: number, riseFrac: number, fallFrac: number): Float32Array<ArrayBuffer> {
  const w = new Float32Array(new ArrayBuffer(n * 4));
  const rise = Math.max(1, Math.round(n * riseFrac));
  const fall = Math.max(1, Math.round(n * fallFrac));
  for (let i = 0; i < n; i++) {
    let v = 1;
    if (i < rise) v = Math.sin(((i + 0.5) / rise) * Math.PI * 0.5);
    const fromEnd = n - 1 - i;
    if (fromEnd < fall) v = Math.min(v, Math.sin(((fromEnd + 0.5) / fall) * Math.PI * 0.5));
    w[i] = v;
  }
  return w;
}

/** Sustain grain: half in, half out. sin² windows at 50% overlap sum to constant power. */
const GRAIN_WINDOW = makeWindow(256, 0.5, 0.5);
/**
 * Onset grain: a 5 ms click guard (the recording's own attack does the rest), a hold, then the
 * same falling half-window as a sustain grain so the first one crossfades out of it seamlessly.
 */
const HEAD_WINDOW = makeWindow(256, 0.005 / HEAD, HOP / HEAD);

/**
 * The trimmed, mono, level-normalized recording: trailing padding and then `TAIL_DROP` cut off.
 * The file is mono in stereo clothing (L = R), so one channel is all of it.
 */
function prepare(ctx: BaseAudioContext, src: AudioBuffer): AudioBuffer {
  const input = src.getChannelData(0);
  let end = input.length;
  while (end > 0 && Math.abs(input[end - 1]) < SILENCE) end--;
  const length = Math.max(1, end - Math.floor(TAIL_DROP * src.sampleRate));
  const out = ctx.createBuffer(1, length, src.sampleRate);
  out.getChannelData(0).set(input.subarray(0, length));
  return normalizeRms(out, TARGET_RMS);
}

interface Grain {
  src: AudioBufferSourceNode;
  env: GainNode;
}

/**
 * Tire screech while sliding, from the recording at `AUDIO.tireScreechSrc`
 * (`public/tire-screech.mp3`, a ~1.8 s squeal once trimmed).
 *
 * A two-second file cannot simply loop — the ear catches the seam and the repeat within a couple
 * of cycles. Instead it is played as overlapping **grains**: slices of the body of the recording,
 * each read from a fresh random spot, windowed and crossfaded at half-overlap so the power stays
 * flat. The result is one continuous squeal for as long as the slide lasts, never repeating the
 * same stretch twice in a row.
 *
 * A slide is shaped so what the car does can be *heard*:
 *
 * - **Break-away**: a slide that starts from grip opens with the recording's own onset (its first
 *   grain is read from the top of the file), plus a short yelp — louder and a touch higher.
 * - **Lulls and flicks**: the level follows the slide intensity with fast time constants, so a
 *   brief catch of grip is a clear dip. If grip lasted long enough to count (`LULL`) — e.g. the
 *   car swapping from one drift angle to the other — the slide that follows re-attacks with a
 *   fresh onset on a new bus, while the old grains fade out underneath it.
 * - **Angle and speed**: the playback rate (pitch) rises with the slide intensity and, while
 *   sliding, with road speed; the tone opens up (low-pass) as the slide gets harder. A slow
 *   aperiodic wander keeps a held drift alive.
 *
 * The file is fetched and decoded on start-up; until it arrives (or if it never does) the voice
 * is simply silent.
 */
export function createTireScreech(core: AudioCore): TireScreech {
  const { ctx, master } = core;

  const out = ctx.createGain();
  out.gain.value = 0;
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 6000;
  tone.Q.value = 0.5;
  tone.connect(out).connect(master);

  // Two buses so a re-attack can fade the old grains out while the new onset comes in.
  const buses = [ctx.createGain(), ctx.createGain()];
  for (const b of buses) {
    b.gain.value = 0;
    b.connect(tone);
  }
  let bus = 0;

  let buffer: AudioBuffer | null = null;
  let disposed = false;
  void fetchSample(ctx, AUDIO.tireScreechSrc)
    .then((decoded) => {
      if (!disposed) buffer = prepare(ctx, decoded);
    })
    .catch(() => {}); // No screech; everything else plays on.

  const grains = new Set<Grain>();
  /** Whether grains are being scheduled. */
  let running = false;
  /** Audio-clock time the next sustain grain starts. */
  let nextAt = 0;
  let lastOffset = -1;
  let rate = 1;
  let wander = 0;
  let wanderTarget = 0;
  let bite = 0;
  /** Seconds the tires have been gripping (intensity under `GRIP`). */
  let gripFor = IDLE;

  const spawn = (buf: AudioBuffer, when: number, offset: number, length: number, window: Float32Array, dest: GainNode): void => {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const env = ctx.createGain();
    env.gain.value = 0;
    env.gain.setValueCurveAtTime(window, when, length);
    src.connect(env).connect(dest);
    // Read enough for the fastest rate the grain could be pushed to while it plays.
    src.start(when, offset, Math.min(length * MAX_RATE, buf.duration - offset));
    src.stop(when + length);
    const g: Grain = { src, env };
    grains.add(g);
    src.onended = () => {
      env.disconnect();
      grains.delete(g);
    };
  };

  /** A random read position in the body, never too close to the previous grain's. */
  const pickOffset = (buf: AudioBuffer): number => {
    const hi = Math.max(BODY_START, buf.duration - GRAIN * MAX_RATE);
    let off = BODY_START;
    for (let tries = 0; tries < 6; tries++) {
      off = BODY_START + Math.random() * (hi - BODY_START);
      if (Math.abs(off - lastOffset) >= MIN_JUMP) break;
    }
    lastOffset = off;
    return off;
  };

  /** A fresh slide: new bus, the recording's onset, sustain grains taking over from it. */
  const attack = (buf: AudioBuffer, t: number): void => {
    const old = buses[bus];
    old.gain.setTargetAtTime(0, t, 0.03);
    bus = 1 - bus;
    const fresh = buses[bus];
    fresh.gain.cancelScheduledValues(t);
    fresh.gain.setValueAtTime(1, t);
    const at = t + 0.005;
    spawn(buf, at, 0, HEAD, HEAD_WINDOW, fresh);
    nextAt = at + HEAD - HOP;
    lastOffset = -1;
    running = true;
  };

  const stopAll = (when: number): void => {
    for (const g of grains) {
      try {
        g.src.stop(when);
      } catch {
        /* already stopped */
      }
    }
  };

  return {
    update(dt, intensity, speed) {
      if (disposed || dt <= 0) return;
      const t = ctx.currentTime;
      const i = clamp01(intensity);
      const speedFrac = clamp01(Math.abs(speed) / REF_SPEED);

      const wasGripping = gripFor;
      gripFor = i < GRIP ? gripFor + dt : 0;

      if (buffer) {
        // Break-away: from idle, or after a real lull (a flick from one angle to the other).
        if (i >= REBREAK && (!running || wasGripping >= LULL)) {
          bite = clamp01(0.5 + i);
          attack(buffer, t);
        }
        if (running && gripFor >= IDLE) {
          running = false;
          stopAll(t + RELEASE_TC * 4);
        }
        if (running) {
          // A stalled frame (hidden tab) leaves `nextAt` in the past; pick up from now, not then.
          if (nextAt < t) nextAt = t + 0.01;
          while (nextAt < t + LOOKAHEAD) {
            spawn(buffer, nextAt, pickOffset(buffer), GRAIN, GRAIN_WINDOW, buses[bus]);
            nextAt += HOP;
          }
        }
      }

      bite *= Math.exp(-dt / BITE_DECAY);

      const level = AUDIO.tireVolume * Math.pow(i, LEVEL_CURVE) * (1 + 0.3 * bite);
      const current = out.gain.value;
      out.gain.setTargetAtTime(level, t, level > current ? ATTACK_TC : RELEASE_TC);

      // Pitch: the rubber works harder with more angle, and faster with speed while sliding.
      if (Math.random() < WANDER_RATE * dt) wanderTarget = (Math.random() * 2 - 1) * WANDER_DEPTH;
      wander += (wanderTarget - wander) * (1 - Math.exp(-WANDER_RATE * dt));
      rate = Math.min(MAX_RATE, (0.9 + 0.14 * i + 0.1 * speedFrac * i) * (1 + wander + 0.05 * bite));
      for (const g of grains) g.src.playbackRate.setTargetAtTime(rate, t, 0.05);

      tone.frequency.setTargetAtTime(lerp(3800, 12000, i), t, 0.08);
    },

    reset() {
      const t = ctx.currentTime;
      stopAll(t);
      running = false;
      gripFor = IDLE;
      bite = 0;
      wander = 0;
      wanderTarget = 0;
      out.gain.cancelScheduledValues(t);
      out.gain.setValueAtTime(0, t);
    },

    dispose() {
      disposed = true;
      stopAll(ctx.currentTime);
      for (const b of buses) b.disconnect();
      tone.disconnect();
      out.disconnect();
    },
  };
}
