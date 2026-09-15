import type { AudioCore } from './core';
import { AUDIO } from '../config/tuning';
import { fetchSample, normalizeRms } from './sample';

export interface NitroBoostAudio {
  /** Nitro lit. Returns false while the recording has not loaded, so the caller can fall back. */
  start(): boolean;
  /** Nitro released (or ran dry): the recording is cut with a short fade. */
  stop(): void;
  reset(): void;
  dispose(): void;
}

/** Seconds at the end of the recording faded out into the engine's own nitro sound underneath. */
const TAIL_FADE = 2;
/** Time constant (s) of the fade when the player lets go of nitro before the recording ends. */
const RELEASE_TC = 0.08;
/** Loudness (RMS) the recording is normalized to on decode, so `AUDIO.nitroSampleVolume` holds for any file. */
const TARGET_RMS = 0.2;

/**
 * The nitro recording at `AUDIO.nitroSrc` (`public/nitro.mp3`), played once each time the boost
 * lights.
 *
 * The engine keeps making its own nitro sound the whole time (`audio/engine.ts` throws the filter
 * and the drive open while `nitro` is set). The recording plays on top of it, and if the player
 * holds the boost long enough, its last `TAIL_FADE` seconds fade out into that — so a long boost
 * ends on the engine's sustained roar rather than on the recording stopping. Letting go earlier
 * cuts the recording with a short fade.
 */
export function createNitroBoostAudio(core: AudioCore): NitroBoostAudio {
  const { ctx, master } = core;

  let buffer: AudioBuffer | null = null;
  let voice: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  let disposed = false;

  fetchSample(ctx, AUDIO.nitroSrc)
    .then((decoded) => {
      if (!disposed) buffer = normalizeRms(decoded, TARGET_RMS);
    })
    .catch(() => {
      /* No recording: the caller keeps the synthesized whoosh. */
    });

  function release(tc: number): void {
    if (!voice) return;
    const { src, gain } = voice;
    const t = ctx.currentTime;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(gain.gain.value, t);
    gain.gain.setTargetAtTime(0, t, tc);
    try {
      src.stop(t + tc * 8);
    } catch {
      /* already stopped */
    }
    voice = null;
  }

  return {
    start() {
      if (disposed || !buffer) return false;
      release(0.02);
      const t = ctx.currentTime;
      const dur = buffer.duration;
      const level = AUDIO.nitroSampleVolume;
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(level, t);
      // Held to the end: the tail fades out, and the engine's nitro note is what is left.
      const fadeFrom = Math.max(0, dur - TAIL_FADE);
      gain.gain.setValueAtTime(level, t + fadeFrom);
      gain.gain.linearRampToValueAtTime(0, t + dur);
      src.connect(gain).connect(master);
      src.onended = () => {
        src.disconnect();
        gain.disconnect();
        if (voice?.src === src) voice = null;
      };
      src.start(t);
      voice = { src, gain };
      return true;
    },

    stop() {
      release(RELEASE_TC);
    },

    reset() {
      release(0.02);
    },

    dispose() {
      disposed = true;
      release(0.01);
    },
  };
}
