import { AUDIO } from '../config/tuning';

/**
 * The shared Web Audio graph root. Every voice connects to `master`; `master` runs through a
 * gentle limiter into the destination so stacked layers (engine + several hums + a zap) never
 * clip. Browsers start the context suspended until a user gesture — call `resume()` from a
 * real input event.
 */
export interface AudioCore {
  readonly ctx: AudioContext;
  /** Pre-limiter bus. Connect every voice here. */
  readonly master: GainNode;
  /**
   * A bus for the one sound that must punch through everything (the Rayo's release). It skips the
   * mix limiter for its own, higher ceiling, and is not touched by `duck`.
   */
  readonly lead: GainNode;
  /** Pull the whole `master` mix down by `db` right now, easing back over `recover` seconds. */
  duck(db: number, recover: number): void;
  /** Shared 2 s white-noise buffer, safe to loop. Reused by every noise voice. */
  readonly noise: AudioBuffer;
  now(): number;
  resume(): void;
  setMuted(muted: boolean): void;
  isMuted(): boolean;
  dispose(): void;
}

type AudioContextCtor = new () => AudioContext;

function getAudioContextCtor(): AudioContextCtor | null {
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

function makeNoiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

/**
 * Creates the audio graph, or a no-op stand-in when Web Audio is unavailable (old browsers,
 * or a headless/QA environment). Callers never branch on availability — every method is safe.
 */
export function createAudioCore(): AudioCore | null {
  const Ctor = getAudioContextCtor();
  if (!Ctor) return null;

  let ctx: AudioContext;
  try {
    ctx = new Ctor();
  } catch {
    return null;
  }

  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -6;
  limiter.knee.value = 6;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.15;
  limiter.connect(ctx.destination);

  // master -> ducker -> limiter: the mute toggle owns master's gain, the ducker owns its own.
  const ducker = ctx.createGain();
  ducker.connect(limiter);
  const master = ctx.createGain();
  master.gain.value = AUDIO.masterVolume;
  master.connect(ducker);

  const leadLimiter = ctx.createDynamicsCompressor();
  leadLimiter.threshold.value = -2;
  leadLimiter.knee.value = 2;
  leadLimiter.ratio.value = 20;
  leadLimiter.attack.value = 0.001;
  leadLimiter.release.value = 0.1;
  leadLimiter.connect(ctx.destination);
  const lead = ctx.createGain();
  lead.gain.value = AUDIO.masterVolume;
  lead.connect(leadLimiter);

  const noise = makeNoiseBuffer(ctx, 2);
  let muted = false;
  // `resume()` rejects when it is called without a user gesture behind it. Since `update` now
  // calls this every frame, an in-flight/failed attempt must not spam unhandled rejections.
  let resuming = false;

  return {
    ctx,
    master,
    lead,
    noise,
    duck(db, recover) {
      const t = ctx.currentTime;
      const floor = Math.pow(10, -Math.abs(db) / 20);
      ducker.gain.cancelScheduledValues(t);
      ducker.gain.setValueAtTime(ducker.gain.value, t);
      ducker.gain.linearRampToValueAtTime(floor, t + 0.01);
      ducker.gain.setTargetAtTime(1, t + 0.01, Math.max(0.01, recover) / 3);
    },
    now() {
      return ctx.currentTime;
    },
    resume() {
      if (resuming || ctx.state !== 'suspended') return;
      resuming = true;
      ctx.resume().then(
        () => {
          resuming = false;
        },
        () => {
          resuming = false;
        },
      );
    },
    setMuted(next: boolean) {
      muted = next;
      master.gain.setTargetAtTime(muted ? 0 : AUDIO.masterVolume, ctx.currentTime, 0.02);
      lead.gain.setTargetAtTime(muted ? 0 : AUDIO.masterVolume, ctx.currentTime, 0.02);
    },
    isMuted() {
      return muted;
    },
    dispose() {
      try {
        master.disconnect();
        ducker.disconnect();
        limiter.disconnect();
        lead.disconnect();
        leadLimiter.disconnect();
        void ctx.close();
      } catch {
        /* already closing */
      }
    },
  };
}
