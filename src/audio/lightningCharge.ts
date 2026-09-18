import type { AudioCore } from './core';
import { AUDIO } from '../config/tuning';
import { fetchSample, normalizeRms } from './sample';

export interface LightningChargeAudio {
  /** Every frame: whether a shot is loading (`LightningState.charging`). Edges start and stop the load. */
  setCharging(charging: boolean): void;
  /**
   * The bolt left the car; `strength` 0..1 is how much of a full load it carried, and sets how
   * loud it lands. Returns false while the release recording has not loaded.
   */
  release(strength: number): boolean;
  reset(): void;
  dispose(): void;
}

/** Time constant (s) the load fades out with when the bolt leaves. Short: the release covers it. */
const FIRE_TC = 0.03;
/** Time constant (s) the load fades out with on a fumble: the button let go and nothing left. */
const FUMBLE_TC = 0.1;
/** Loudness (RMS) both recordings are normalized to on decode, so the volume knobs hold for any file. */
const TARGET_RMS = 0.2;

/** Seconds of fade-in at the start offset, so cutting into the recording does not click. */
const START_RAMP = 0.005;

/**
 * The Rayo's two recordings (`public/rayo-load.mp3`, `public/rayo-release.mp3`).
 *
 * - **Load**: starts the moment a shot begins charging (fire held, `src/sim/lightning.ts`) and
 *   builds while it is held. It plays once and is not looped: held past its end, the charge is
 *   silent. It starts `AUDIO.lightningLoadOffset` seconds in, past the recording's quiet slow
 *   build, so it is heard on the press rather than a beat after it. It fades out when the
 *   button lets go — quickly under the release when the bolt leaves, a little
 *   slower on a fumble, where nothing leaves and there is no release to cover it.
 * - **Release**: the discharge, on `lightningFired`. It plays on `core.lead` (its own limiter,
 *   above the mix's) and ducks the rest of the mix, so it is the loudest thing in that moment.
 */
export function createLightningChargeAudio(core: AudioCore): LightningChargeAudio {
  const { ctx, master } = core;

  let load: AudioBuffer | null = null;
  let releaseBuffer: AudioBuffer | null = null;
  let voice: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  let charging = false;
  let disposed = false;

  fetchSample(ctx, AUDIO.lightningLoadSrc)
    .then((decoded) => {
      if (!disposed) load = normalizeRms(decoded, TARGET_RMS);
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
    src.buffer = load;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(AUDIO.lightningLoadVolume, t + START_RAMP);
    src.connect(gain).connect(master);
    const self = { src, gain };
    src.onended = () => {
      src.disconnect();
      gain.disconnect();
      if (voice === self) voice = null;
    };
    const offset = Math.min(Math.max(0, AUDIO.lightningLoadOffset), load.duration * 0.5);
    src.start(t, offset);
    voice = self;
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

    release(strength) {
      if (disposed) return false;
      stopLoad(FIRE_TC);
      if (!releaseBuffer) return false;
      const t = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = releaseBuffer;
      const gain = ctx.createGain();
      const f = Math.min(1, Math.max(0, strength));
      gain.gain.value = AUDIO.lightningReleaseVolumeMin + (AUDIO.lightningReleaseVolumeMax - AUDIO.lightningReleaseVolumeMin) * f;
      // Its own bus, over the mix's limiter, with everything else pulled down under it.
      src.connect(gain).connect(core.lead);
      core.duck(AUDIO.lightningReleaseDuckDbMin + (AUDIO.lightningReleaseDuckDbMax - AUDIO.lightningReleaseDuckDbMin) * f, releaseBuffer.duration);
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
