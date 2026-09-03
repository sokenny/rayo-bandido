import { THEME } from '../config/tuning';

/**
 * The background theme song and the beat signal driven from it.
 *
 * The track is streamed through an `<audio>` element (so a multi-megabyte MP3 is not decoded
 * into memory up front) and looped quietly beneath the game. The same signal is tapped by a
 * Web Audio `AnalyserNode`; each frame we read the low-frequency (kick/bass) bins, compare
 * their energy to a slow rolling average, and turn the excess into a smoothed 0..1 `beat`.
 * That value is what the environment reads to pulse the lights — see `environment.update`.
 *
 * Browsers refuse to start audio until a real user gesture, so nothing plays until `arm()`
 * sees the first key press or pointer down. Everything degrades to a silent no-op (beat 0)
 * when Web Audio is unavailable, e.g. in the headless QA runner.
 */
export interface ThemeAudio {
  /** Attach one-time input listeners that start the song on the first user gesture. */
  arm(target: Window): void;
  /** Read the analyser and advance the smoothed beat. Call once per render frame. */
  update(frameDt: number): void;
  /** Current beat energy, 0 (silence/between hits) to ~1 (a kick). */
  readonly beat: number;
  /** Playback state for QA/automation: 'unavailable' (no Web Audio), 'idle' (not started yet),
   *  or the live AudioContext state ('running' once the song is playing). */
  status(): 'unavailable' | 'idle' | AudioContextState;
  dispose(): void;
}

type AudioContextCtor = new () => AudioContext;

function getAudioContextCtor(): AudioContextCtor | null {
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** A stand-in used when Web Audio is missing; the game keeps running, the lights just sit still. */
function silentTheme(): ThemeAudio {
  return {
    arm() {},
    update() {},
    beat: 0,
    status: () => 'unavailable',
    dispose() {},
  };
}

export function createThemeAudio(): ThemeAudio {
  const Ctor = getAudioContextCtor();
  if (!Ctor) return silentTheme();

  let ctx: AudioContext;
  try {
    ctx = new Ctor();
  } catch {
    return silentTheme();
  }

  const el = new Audio(THEME.src);
  el.loop = true;
  el.crossOrigin = 'anonymous';
  el.preload = 'auto';

  const source = ctx.createMediaElementSource(el);

  // Playback path: source -> gain -> speakers. Gain starts at 0 and fades in on first play.
  const gain = ctx.createGain();
  gain.gain.value = 0;
  source.connect(gain);
  gain.connect(ctx.destination);

  // Analysis tap: source -> analyser (a dead end; it does not feed the speakers).
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.6;
  source.connect(analyser);
  const bins = new Uint8Array(analyser.frequencyBinCount);

  // Low-frequency window to watch. At ~44.1 kHz and fftSize 1024 each bin is ~43 Hz, so bins
  // 1..10 cover roughly 43-430 Hz: the kick and bass, not the whole mix.
  const BASS_LO = 1;
  const BASS_HI = 10;

  let started = false;
  let armed = false;
  let baseline = 0; // Slow rolling average of bass energy; the beat is what rises above it.
  let beat = 0;
  let armWindow: Window | null = null;

  function start(): void {
    if (started) return;
    started = true;
    if (ctx.state === 'suspended') void ctx.resume();
    void el.play().catch(() => {
      // Autoplay still blocked (rare after a gesture) — leave it; a later gesture retries.
      started = false;
    });
    // Fade the track in so it eases under the game instead of stabbing in.
    const now = ctx.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(THEME.volume, now + THEME.fadeInSeconds);
  }

  function onGesture(): void {
    start();
  }

  return {
    arm(target: Window) {
      if (armed) return;
      armed = true;
      armWindow = target;
      // `once` is not enough — the first gesture might not unblock playback — so we keep the
      // listeners and simply no-op once `started` sticks.
      target.addEventListener('keydown', onGesture);
      target.addEventListener('pointerdown', onGesture);
    },
    update() {
      if (!started) return;
      analyser.getByteFrequencyData(bins);
      let sum = 0;
      for (let i = BASS_LO; i <= BASS_HI; i++) sum += bins[i];
      const energy = sum / (BASS_HI - BASS_LO + 1); // 0..255

      // Track a slow baseline; the transient part is energy above it.
      baseline += (energy - baseline) * 0.05;
      const over = energy - baseline;
      const pulse = over > 0 ? Math.min(1, over / THEME.beatGain) : 0;

      // Asymmetric smoothing: snap up to a hit, ease back down between them.
      const k = pulse > beat ? THEME.beatAttack : THEME.beatRelease;
      beat += (pulse - beat) * k;
    },
    get beat() {
      return beat;
    },
    status() {
      return started ? ctx.state : 'idle';
    },
    dispose() {
      if (armWindow) {
        armWindow.removeEventListener('keydown', onGesture);
        armWindow.removeEventListener('pointerdown', onGesture);
        armWindow = null;
      }
      try {
        el.pause();
        source.disconnect();
        gain.disconnect();
        analyser.disconnect();
        void ctx.close();
      } catch {
        /* already closing */
      }
    },
  };
}
