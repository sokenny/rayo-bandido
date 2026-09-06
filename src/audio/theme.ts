import { THEME } from '../config/tuning';
import { SILENT_MUSIC, type MusicBands } from '../core/types';

/**
 * The background theme song and the music signals driven from it.
 *
 * The track is streamed through an `<audio>` element (so a multi-megabyte MP3 is not decoded
 * into memory up front) and looped quietly beneath the game. The same signal is tapped by a
 * Web Audio `AnalyserNode` and split into three frequency bands — bass, mid, high — each with
 * its own rolling baseline and its own attack/release envelope. A fourth, much slower follower
 * tracks the loudness of the whole mix. The result is four 0..1 levels that move at genuinely
 * different speeds, which is what lets the environment give each family of lights its own
 * pacing instead of flashing the whole city at once — see `environment.update`.
 *
 * Browsers refuse to start audio until a real user gesture, so nothing plays until `arm()`
 * sees the first key press or pointer down. Everything degrades to a silent no-op (all bands
 * 0) when Web Audio is unavailable, e.g. in the headless QA runner.
 */
export interface ThemeAudio {
  /** Attach one-time input listeners that start the song on the first user gesture, and the
   *  `M` key listener that mutes it. */
  arm(target: Window): void;
  /** Read the analyser and advance the band envelopes. Call once per render frame. */
  update(frameDt: number): void;
  /**
   * The current music levels. This is one long-lived object mutated in place each frame — read
   * it, do not hold it expecting a snapshot.
   */
  readonly bands: MusicBands;
  /**
   * The bar display's levels: `THEME.spectrum.bars` values in 0..1, low frequencies first,
   * one per logarithmically spaced window across the mix. Like `bands`, this is one array
   * mutated in place every frame, so reading it costs nothing.
   */
  readonly spectrum: Float32Array;
  /** Playback state for QA/automation: 'unavailable' (no Web Audio), 'idle' (not started yet),
   *  or the live AudioContext state ('running' once the song is playing). */
  status(): 'unavailable' | 'idle' | AudioContextState;
  setMuted(muted: boolean): void;
  isMuted(): boolean;
  dispose(): void;
}

type AudioContextCtor = new () => AudioContext;

/** One band's tuning, as it appears in `THEME.bands`. */
type BandConfig = (typeof THEME.bands)[keyof typeof THEME.bands];

/** A band's tuning plus the bin window and the running state its envelope needs. */
interface Band {
  cfg: BandConfig;
  /** Inclusive bin window covering [loHz, hiHz] at the live sample rate. */
  lo: number;
  hi: number;
  /** Slow rolling average of this band's level; the pulse is what rises above it. */
  baseline: number;
  /** The smoothed 0..1 output. */
  value: number;
}

function getAudioContextCtor(): AudioContextCtor | null {
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** A stand-in used when Web Audio is missing; the game keeps running, the lights just sit still. */
function silentTheme(): ThemeAudio {
  return {
    arm() {},
    update() {},
    bands: SILENT_MUSIC,
    spectrum: new Float32Array(THEME.spectrum.bars),
    status: () => 'unavailable',
    setMuted() {},
    isMuted: () => false,
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

  // Analysis tap: source -> analyser (a dead end; it does not feed the speakers). The built-in
  // smoothing is kept low so the high band can still resolve a hi-hat; each band then does its
  // own smoothing afterwards, at its own rate.
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.45;
  source.connect(analyser);
  const bins = new Uint8Array(analyser.frequencyBinCount);

  // Map each band's frequency window onto bins. One bin spans sampleRate / fftSize Hz — about
  // 43 Hz at 44.1 kHz — so this is derived rather than hard-coded, and holds at 48 kHz too.
  const binHz = ctx.sampleRate / analyser.fftSize;
  const lastBin = analyser.frequencyBinCount - 1;
  const makeBand = (cfg: BandConfig): Band => ({
    cfg,
    // Bin 0 is DC and never useful, so the lowest band starts at 1.
    lo: Math.max(1, Math.min(lastBin, Math.round(cfg.loHz / binHz))),
    hi: Math.max(1, Math.min(lastBin, Math.round(cfg.hiHz / binHz))),
    baseline: 0,
    value: 0,
  });
  const bass = makeBand(THEME.bands.bass);
  const mid = makeBand(THEME.bands.mid);
  const high = makeBand(THEME.bands.high);
  const bandList: Band[] = [bass, mid, high];

  // The bar display's windows: `bars` logarithmically spaced slices of [loHz, hiHz], so each
  // bar covers the same musical interval rather than the same number of Hz — an octave per
  // bar or so, which is how the ear hears the split and how the display ends up even.
  const spec = THEME.spectrum;
  const barLo = new Int32Array(spec.bars);
  const barHi = new Int32Array(spec.bars);
  const barTilt = new Float32Array(spec.bars);
  const ratio = spec.hiHz / spec.loHz;
  for (let i = 0; i < spec.bars; i++) {
    const edge = (k: number) => spec.loHz * Math.pow(ratio, k / spec.bars);
    const lo = Math.max(1, Math.min(lastBin, Math.round(edge(i) / binHz)));
    // Windows are half-open so two neighbouring bars never share a bin, but the lowest few
    // slices are narrower than one bin, and a bar with no bins would sit dead: keep at least
    // one, even where that means the bottom bars share the same fundamental.
    const hi = Math.max(lo, Math.min(lastBin, Math.round(edge(i + 1) / binHz) - 1));
    barLo[i] = lo;
    barHi[i] = hi;
    const t = spec.bars > 1 ? i / (spec.bars - 1) : 0;
    barTilt[i] = spec.tiltLo + (spec.tiltHi - spec.tiltLo) * t;
  }
  const spectrum = new Float32Array(spec.bars);
  /** Each bar's rolling average, the line its `punch` term is measured against. */
  const barBaseline = new Float32Array(spec.bars);

  // Mutated in place every frame and handed out by reference, so the render loop allocates
  // nothing to read the music.
  const bands: MusicBands = { bass: 0, mid: 0, high: 0, energy: 0 };

  let started = false;
  let armed = false;
  let armWindow: Window | null = null;
  let muted = false;

  function start(): void {
    if (started) return;
    started = true;
    if (ctx.state === 'suspended') void ctx.resume();
    void el.play().catch(() => {
      // Autoplay still blocked (rare after a gesture) — leave it; a later gesture retries.
      started = false;
    });
    // Fade the track in so it eases under the game instead of stabbing in. If the player has
    // already muted (e.g. hit M before the first gesture landed), settle at silence instead.
    const now = ctx.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(muted ? 0 : THEME.volume, now + THEME.fadeInSeconds);
  }

  function onGesture(): void {
    start();
  }

  function setMuted(next: boolean): void {
    if (muted === next) return;
    muted = next;
    if (!started) return; // Nothing playing yet; `start()` will honor `muted` when it fires.
    const now = ctx.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(muted ? 0 : THEME.volume, now + 0.05);
  }

  function onMuteKey(e: KeyboardEvent): void {
    if (e.code === 'KeyM') setMuted(!muted);
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
      target.addEventListener('keydown', onMuteKey);
    },
    update() {
      if (!started) return;
      analyser.getByteFrequencyData(bins);

      for (const band of bandList) {
        let sum = 0;
        for (let i = band.lo; i <= band.hi; i++) sum += bins[i];
        const level = sum / (band.hi - band.lo + 1); // 0..255

        // Each band tracks its own slow baseline, so a busy hi-hat pattern cannot drown out
        // the kick and a bass-heavy mix cannot pin the mids at full. The pulse is whatever
        // rises above that band's own recent average.
        band.baseline += (level - band.baseline) * band.cfg.baselineRate;
        const over = level - band.baseline;
        const pulse = over > 0 ? Math.min(1, over / band.cfg.gain) : 0;

        // Asymmetric smoothing: rise at `attack`, fall at `release`. These two numbers are the
        // whole trick — they are what make the three bands feel like three different tempos.
        const k = pulse > band.value ? band.cfg.attack : band.cfg.release;
        band.value += (pulse - band.value) * k;
      }

      // The slow one: mean level across the whole analysed spectrum, followed over seconds and
      // asymmetric the other way round (rises faster than it sags), so a chorus is held.
      let total = 0;
      for (let i = 1; i <= lastBin; i++) total += bins[i];
      const loudness = Math.min(1, total / lastBin / THEME.energyFull);
      const ek = loudness > bands.energy ? THEME.energyRise : THEME.energyFall;
      bands.energy += (loudness - bands.energy) * ek;

      bands.bass = bass.value;
      bands.mid = mid.value;
      bands.high = high.value;

      // The bar display: the window's own level for the shape, plus its excess over its own
      // rolling average for the movement, then attack/release smoothed like the bands.
      for (let i = 0; i < spectrum.length; i++) {
        const lo = barLo[i];
        const hi = barHi[i];
        let sum = 0;
        for (let b = lo; b <= hi; b++) sum += bins[b];
        const level = (sum / (hi - lo + 1) / 255) * barTilt[i];
        barBaseline[i] += (level - barBaseline[i]) * spec.baselineRate;
        const raw = level * spec.shape + (level - barBaseline[i]) * spec.punch;
        const target = raw < 0 ? 0 : raw > 1 ? 1 : raw;
        const k = target > spectrum[i] ? spec.attack : spec.release;
        spectrum[i] += (target - spectrum[i]) * k;
      }
    },
    bands,
    spectrum,
    status() {
      return started ? ctx.state : 'idle';
    },
    setMuted,
    isMuted() {
      return muted;
    },
    dispose() {
      if (armWindow) {
        armWindow.removeEventListener('keydown', onGesture);
        armWindow.removeEventListener('pointerdown', onGesture);
        armWindow.removeEventListener('keydown', onMuteKey);
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
