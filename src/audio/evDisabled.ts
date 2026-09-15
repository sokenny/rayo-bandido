import type { AudioCore } from './core';
import type { Listener } from './electricHum';
import type { TargetState } from '../core/types';
import { AUDIO } from '../config/tuning';
import { carVx, carVz, dopplerRatio } from './horns';
import { distanceGain, stereoPan } from './dsp';
import { fetchSample, normalizeRms } from './sample';

export interface EvDisabledAudio {
  /** The Rayo took this car out (`targetDestroyed`). Sounds on the next `update`, which knows where it is. */
  hit(targetId: number): void;
  update(dt: number, listener: Listener, targets: readonly TargetState[]): void;
  /** False while no recording has loaded, so the caller can fall back to the synthesized power-down. */
  ready(): boolean;
  reset(): void;
  dispose(): void;
}

/** Loudness (RMS) the recordings are normalized to on decode, so `AUDIO.evDisabledVolume` holds for any file. */
const TARGET_RMS = 0.2;
/** More at once than this and the oldest carries on alone: a chain of kills is not a wall of noise. */
const MAX_VOICES = 4;

interface Voice {
  id: number;
  src: AudioBufferSourceNode;
  filter: BiquadFilterNode;
  level: GainNode;
  pan: StereoPannerNode;
}

function findById(targets: readonly TargetState[], id: number): TargetState | undefined {
  for (let i = 0; i < targets.length; i++) if (targets[i].id === id) return targets[i];
  return undefined;
}

/**
 * An electric car going dead when the Rayo lands on it: one of the recordings at
 * `AUDIO.evDisabledSrcs`, picked at random (never the same one twice in a row while there is a
 * choice).
 *
 * Like the horns (`audio/horns.ts`), the sound stays ON THE CAR: every frame it is re-panned and
 * re-attenuated from where the car is, darkened with distance, and pitched by the doppler of the
 * two velocities along the line between them. From far away it is barely there; beside the car it
 * is loud; driving off past it, it drops and falls away behind.
 */
export function createEvDisabledAudio(core: AudioCore): EvDisabledAudio {
  const { ctx, master } = core;
  const buffers: AudioBuffer[] = [];
  const pending: number[] = [];
  const voices: Voice[] = [];
  let last = -1;
  let disposed = false;

  for (const url of AUDIO.evDisabledSrcs) {
    fetchSample(ctx, url)
      .then((decoded) => {
        if (!disposed) buffers.push(normalizeRms(decoded, TARGET_RMS));
      })
      .catch(() => {
        /* That one is missing; the others still play. */
      });
  }

  function place(voice: Voice, listener: Listener, t: TargetState, at: number, tc: number): void {
    const dx = t.x - listener.x;
    const dz = t.z - listener.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const nx = dist > 1e-3 ? dx / dist : 0;
    const nz = dist > 1e-3 ? dz / dist : 0;
    const ratio = dopplerRatio(nx, nz, listener.vx ?? 0, listener.vz ?? 0, carVx(t), carVz(t));
    voice.src.playbackRate.setTargetAtTime(ratio, at, tc);
    voice.level.gain.setTargetAtTime(
      AUDIO.evDisabledVolume * distanceGain(dist, AUDIO.evDisabledNear, AUDIO.evDisabledFar),
      at,
      tc,
    );
    voice.pan.pan.setTargetAtTime(stereoPan(dx, dz, listener.heading, AUDIO.maxPan), at, tc);
    voice.filter.frequency.setTargetAtTime(12000 - 9500 * Math.min(1, dist / AUDIO.evDisabledFar), at, tc);
  }

  function start(id: number, listener: Listener, target: TargetState): void {
    if (buffers.length === 0) return;
    if (voices.length >= MAX_VOICES) return;
    let pick = Math.floor(Math.random() * buffers.length);
    if (buffers.length > 1 && pick === last) pick = (pick + 1) % buffers.length;
    last = pick;

    const t0 = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = buffers[pick];
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.5;
    const level = ctx.createGain();
    level.gain.value = 0;
    const pan = ctx.createStereoPanner();
    src.connect(filter).connect(level).connect(pan).connect(master);

    const voice: Voice = { id, src, filter, level, pan };
    // Placed before the first sample, so it starts from where the car is instead of sweeping there.
    place(voice, listener, target, t0, 0.005);
    voices.push(voice);
    src.onended = () => {
      const i = voices.indexOf(voice);
      if (i >= 0) voices.splice(i, 1);
      src.disconnect();
      filter.disconnect();
      level.disconnect();
      pan.disconnect();
    };
    src.start(t0);
  }

  return {
    hit(targetId) {
      if (!disposed && targetId >= 0) pending.push(targetId);
    },

    update(dt, listener, targets) {
      if (disposed) return;
      const t = ctx.currentTime;
      const tc = Math.max(0.015, Math.min(0.05, dt * 2));
      for (const voice of voices) {
        const target = findById(targets, voice.id);
        // A car that is gone from the world (despawned, restarted) takes its sound with it.
        if (!target) voice.level.gain.setTargetAtTime(0, t, 0.03);
        else place(voice, listener, target, t, tc);
      }
      while (pending.length > 0) {
        const id = pending.shift() as number;
        const target = findById(targets, id);
        if (target) start(id, listener, target);
      }
    },

    ready() {
      return buffers.length > 0;
    },

    reset() {
      pending.length = 0;
      const t = ctx.currentTime;
      for (const voice of voices) {
        voice.level.gain.cancelScheduledValues(t);
        voice.level.gain.setValueAtTime(0, t);
      }
    },

    dispose() {
      disposed = true;
      for (const voice of voices) {
        try {
          voice.src.stop();
        } catch {
          /* already stopped */
        }
      }
    },
  };
}
