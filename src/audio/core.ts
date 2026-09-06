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

  const master = ctx.createGain();
  master.gain.value = AUDIO.masterVolume;
  master.connect(limiter);

  const noise = makeNoiseBuffer(ctx, 2);
  let muted = false;
  // `resume()` rejects when it is called without a user gesture behind it. Since `update` now
  // calls this every frame, an in-flight/failed attempt must not spam unhandled rejections.
  let resuming = false;

  return {
    ctx,
    master,
    noise,
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
    },
    isMuted() {
      return muted;
    },
    dispose() {
      try {
        master.disconnect();
        limiter.disconnect();
        void ctx.close();
      } catch {
        /* already closing */
      }
    },
  };
}
