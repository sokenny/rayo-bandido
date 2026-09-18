import type { AudioCore } from './core';
import { AUDIO } from '../config/tuning';
import type { CrashSeverity } from '../core/types';
import { fetchSample } from './sample';

export interface CrashRecordings {
  /**
   * Plays the recording for a `medium` or `heavy` crash. Returns false for a `light` one (which
   * has no recording) or while the files have not loaded, so the caller keeps the synthesized crash.
   */
  play(severity: CrashSeverity): boolean;
  dispose(): void;
}

/** Peak the recordings are scaled to on decode: they are all transient, so peak, not RMS, is the level. */
const TARGET_PEAK = 0.9;
/** Random playback-rate spread (fraction) per crash, so the same file never lands twice identically. */
const RATE_SPREAD = 0.05;

function normalizePeak(buffer: AudioBuffer): AudioBuffer {
  let peak = 0;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
  }
  if (peak <= 0) return buffer;
  const k = TARGET_PEAK / peak;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) data[i] *= k;
  }
  return buffer;
}

/**
 * The crash recordings (`AUDIO.crashHeavySrc`, `AUDIO.crashMediumSrcs`, served from public/),
 * played once on a punished crash by severity: the big one for `heavy`, one of the medium ones for
 * `medium` — never the same medium file twice in a row. `light` crashes have no recording yet and
 * keep the synthesized crash in `oneShots.ts`.
 */
export function createCrashRecordings(core: AudioCore): CrashRecordings {
  const { ctx, master } = core;

  let heavy: AudioBuffer | null = null;
  const medium: AudioBuffer[] = [];
  let lastMedium = -1;
  let disposed = false;

  const load = (src: string): Promise<AudioBuffer | null> =>
    fetchSample(ctx, src)
      .then((decoded) => (disposed ? null : normalizePeak(decoded)))
      .catch(() => null); // Missing file: that tier keeps the synthesized crash.

  void load(AUDIO.crashHeavySrc).then((b) => (heavy = b));
  for (const src of AUDIO.crashMediumSrcs) void load(src).then((b) => b && medium.push(b));

  const playBuffer = (buffer: AudioBuffer, volume: number): void => {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = 1 + (Math.random() * 2 - 1) * RATE_SPREAD;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    src.connect(gain).connect(master);
    src.onended = () => {
      src.disconnect();
      gain.disconnect();
    };
    src.start();
  };

  return {
    play(severity) {
      if (disposed) return false;
      if (severity === 'heavy') {
        // No big recording (yet)? A medium one beats the synth.
        const buf = heavy ?? medium[0] ?? null;
        if (!buf) return false;
        playBuffer(buf, AUDIO.crashHeavyVolume);
        return true;
      }
      if (severity === 'medium' && medium.length > 0) {
        let i = Math.floor(Math.random() * medium.length);
        if (medium.length > 1 && i === lastMedium) i = (i + 1) % medium.length;
        lastMedium = i;
        playBuffer(medium[i], AUDIO.crashMediumVolume);
        return true;
      }
      return false;
    },

    dispose() {
      disposed = true;
    },
  };
}
