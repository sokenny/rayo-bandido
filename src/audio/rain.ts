import type { AudioCore } from './core';
import { AUDIO, ATMOSPHERE } from '../config/tuning';
import { clamp01 } from '../core/math';
import { REF_SPEED } from './dsp';
import { fetchSample } from './sample';

export interface RainAudio {
  /** `speed` is the car's ground speed in m/s: the faster it goes, the harder the rain hits it. */
  update(dt: number, speed: number): void;
  reset(): void;
  dispose(): void;
}

/** Seconds (time constant) the level takes to follow a change in rain intensity. Rain never snaps on. */
const LEVEL_TC = 1.2;
/** Seconds (time constant) the playback rate takes to follow the car's speed. */
const RATE_TC = 0.35;
/** Trimmed off each end of the decoded file: the mp3 encoder's silent padding would click on the loop. */
const EDGE_TRIM = 0.06;
/** Seconds of the recording's tail crossfaded over its head, so the loop has no seam. */
const CROSSFADE = 1.5;
/**
 * Loudness (RMS) the recording is normalized to on decode, so `AUDIO.rainVolume` means the same
 * thing whatever file sits at `AUDIO.rainSrc`.
 */
const TARGET_RMS = 0.22;

/**
 * Turns the decoded recording into a seamless, level-normalized loop: the padding trimmed off
 * both ends, the last `CROSSFADE` seconds blended (equal-power) over the first.
 */
function makeLoop(ctx: BaseAudioContext, src: AudioBuffer): AudioBuffer {
  const rate = src.sampleRate;
  const trim = Math.floor(EDGE_TRIM * rate);
  const usable = src.length - trim * 2;
  const fade = Math.min(Math.floor(CROSSFADE * rate), Math.floor(usable / 3));
  const length = usable - fade;
  const out = ctx.createBuffer(src.numberOfChannels, length, rate);

  let sum = 0;
  let peak = 0;
  for (let ch = 0; ch < src.numberOfChannels; ch++) {
    const input = src.getChannelData(ch);
    const data = out.getChannelData(ch);
    for (let i = 0; i < length; i++) data[i] = input[trim + i];
    for (let i = 0; i < fade; i++) {
      const x = (i + 0.5) / fade;
      data[i] = data[i] * Math.sin(x * Math.PI * 0.5) + input[trim + length + i] * Math.cos(x * Math.PI * 0.5);
    }
    for (let i = 0; i < length; i++) {
      sum += data[i] * data[i];
      peak = Math.max(peak, Math.abs(data[i]));
    }
  }

  const rms = Math.sqrt(sum / (length * src.numberOfChannels));
  const norm = rms > 0 ? Math.min(TARGET_RMS / rms, 0.99 / peak) : 1;
  for (let ch = 0; ch < out.numberOfChannels; ch++) {
    const data = out.getChannelData(ch);
    for (let i = 0; i < length; i++) data[i] *= norm;
  }
  return out;
}

/**
 * Rain hitting the car, from the recording at `AUDIO.rainSrc` (`public/rain.mp3`), looped.
 *
 * It follows the weather (`ATMOSPHERE.rain.intensity`), not the drawn streaks, so it is the same
 * rain on every quality preset — `low` draws none, but it is still raining on the wet road.
 *
 * The car's speed plays the loop faster (`AUDIO.rainSpeedRate`): driving into the rain, more
 * drops hit the windscreen and the roof per second, and they hit harder. The pitch rising with
 * it is part of that — it reads as the rain getting more violent, not as a tape speeding up.
 *
 * The file is fetched and decoded on start-up; until it arrives (or if it never does) the voice
 * is simply silent.
 */
export function createRainAudio(core: AudioCore): RainAudio {
  const { ctx, master } = core;

  const out = ctx.createGain();
  out.gain.value = 0;
  out.connect(master);

  let source: AudioBufferSourceNode | null = null;
  let disposed = false;

  fetchSample(ctx, AUDIO.rainSrc)
    .then((decoded) => {
      if (disposed) return;
      const loop = makeLoop(ctx, decoded);
      source = ctx.createBufferSource();
      source.buffer = loop;
      source.loop = true;
      source.connect(out);
      // Start somewhere in the loop, not always on its first drop.
      source.start(ctx.currentTime, Math.random() * loop.duration);
    })
    .catch(() => {
      /* No rain sound; everything else plays on. */
    });

  return {
    update(dt, speed) {
      if (disposed || dt <= 0) return;
      const t = ctx.currentTime;
      const intensity = clamp01(ATMOSPHERE.rain.intensity);
      out.gain.setTargetAtTime(AUDIO.rainVolume * intensity, t, LEVEL_TC);
      if (source) {
        const rate = 1 + AUDIO.rainSpeedRate * clamp01(Math.abs(speed) / REF_SPEED);
        source.playbackRate.setTargetAtTime(rate, t, RATE_TC);
      }
    },

    reset() {},

    dispose() {
      disposed = true;
      try {
        source?.stop();
      } catch {
        /* never started */
      }
      out.disconnect();
    },
  };
}
