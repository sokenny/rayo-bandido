import type { AudioCore } from './core';
import { AUDIO } from '../config/tuning';
import { fetchSample, normalizeRms } from './sample';

export interface LightningChargeAudio {
  /** Every frame: whether a shot is loading (`LightningState.charging`). Edges start and stop the load. */
  setCharging(charging: boolean): void;
  /** The bolt left the car. Returns false while the release recording has not loaded. */
  release(): boolean;
  reset(): void;
  dispose(): void;
}

/**
 * Seconds at the end of the load recording that loop for as long as the button stays down. The
 * recording builds for ~4 s and then holds; this is the held part.
 */
const HOLD_LOOP = 1.4;
/** Crossfade (s) blended into that loop's seam so it does not click. */
const LOOP_CROSSFADE = 0.3;
/** Time constant (s) the load fades out with when the bolt leaves. Short: the release covers it. */
const FIRE_TC = 0.03;
/** Time constant (s) the load fades out with on a fumble: the button let go and nothing left. */
const FUMBLE_TC = 0.1;
/** Loudness (RMS) both recordings are normalized to on decode, so the volume knobs hold for any file. */
const TARGET_RMS = 0.2;

/**
 * Plays the recording once, then loops its last `HOLD_LOOP` seconds. The seam is prepared in the
 * buffer: the samples just before the end are crossfaded into the ones just before the loop
 * start, so the jump back lands on audio that already continues from what was playing.
 */
function withHoldLoop(ctx: BaseAudioContext, src: AudioBuffer): { buffer: AudioBuffer; loopStart: number } {
  const rate = src.sampleRate;
  const length = src.length;
  const loopLen = Math.min(Math.floor(HOLD_LOOP * rate), Math.floor(length / 2));
  const fade = Math.min(Math.floor(LOOP_CROSSFADE * rate), Math.floor(loopLen / 2));
  const loopStart = length - loopLen;
  const out = ctx.createBuffer(src.numberOfChannels, length, rate);
  for (let ch = 0; ch < src.numberOfChannels; ch++) {
    const input = src.getChannelData(ch);
    const data = out.getChannelData(ch);
    data.set(input);
    for (let i = 0; i < fade; i++) {
      const x = (i + 0.5) / fade;
      const end = length - fade + i;
      data[end] = input[end] * Math.cos(x * Math.PI * 0.5) + input[loopStart - fade + i] * Math.sin(x * Math.PI * 0.5);
    }
  }
  return { buffer: out, loopStart: loopStart / rate };
}

/**
 * The Rayo's two recordings (`public/rayo-load.mp3`, `public/rayo-release.mp3`).
 *
 * - **Load**: starts the moment a shot begins charging (fire held, `src/sim/lightning.ts`) and
 *   builds while it is held; held past the end of the recording, its top keeps looping. It fades
 *   out when the button lets go — quickly under the release when the bolt leaves, a little
 *   slower on a fumble, where nothing leaves and there is no release to cover it.
 * - **Release**: the discharge, on `lightningFired`.
 */
export function createLightningChargeAudio(core: AudioCore): LightningChargeAudio {
  const { ctx, master } = core;

  let load: { buffer: AudioBuffer; loopStart: number } | null = null;
  let releaseBuffer: AudioBuffer | null = null;
  let voice: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  let charging = false;
  let disposed = false;

  fetchSample(ctx, AUDIO.lightningLoadSrc)
    .then((decoded) => {
      if (!disposed) load = withHoldLoop(ctx, normalizeRms(decoded, TARGET_RMS));
    })
    .catch(() => {
      /* No load sound: charging is silent, as it was. */
    });
  fetchSample(ctx, AUDIO.lightningReleaseSrc)
    .then((decoded) => {
      if (!disposed) releaseBuffer = normalizeRms(decoded, TARGET_RMS);
    })
    .catch(() => {
      /* No release recording: the caller keeps the synthesized zap. */
    });

  function startLoad(): void {
    if (!load) return;
    stopLoad(0.01);
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = load.buffer;
    src.loop = true;
    src.loopStart = load.loopStart;
    src.loopEnd = load.buffer.duration;
    const gain = ctx.createGain();
    gain.gain.value = AUDIO.lightningLoadVolume;
    src.connect(gain).connect(master);
    src.onended = () => {
      src.disconnect();
      gain.disconnect();
    };
    src.start(t);
    voice = { src, gain };
  }

  function stopLoad(tc: number): void {
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
    setCharging(next) {
      if (disposed || next === charging) return;
      charging = next;
      if (next) startLoad();
      // A load still sounding here was not fired (`release` stops it first): a fumble.
      else stopLoad(FUMBLE_TC);
    },

    release() {
      if (disposed) return false;
      stopLoad(FIRE_TC);
      if (!releaseBuffer) return false;
      const t = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = releaseBuffer;
      const gain = ctx.createGain();
      gain.gain.value = AUDIO.lightningReleaseVolume;
      src.connect(gain).connect(master);
      src.onended = () => {
        src.disconnect();
        gain.disconnect();
      };
      src.start(t);
      return true;
    },

    reset() {
      charging = false;
      stopLoad(0.02);
    },

    dispose() {
      disposed = true;
      stopLoad(0.01);
    },
  };
}
