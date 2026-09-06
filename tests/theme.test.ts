import { afterEach, describe, expect, it } from 'vitest';
import { createThemeAudio } from '../src/audio/theme';
import { THEME } from '../src/config/tuning';

/**
 * The theme analyser, driven by a fake Web Audio graph.
 *
 * The point of these tests is the thing you cannot see in a screenshot: the three bands must
 * be independent (a kick must not light the hi-hat group) and they must move at *different
 * speeds*, because that difference in pacing is the whole reason the city no longer flashes
 * as one block. Frequencies here are real Hz; the analyser maps them to bins itself.
 */

const FFT = 1024;
const SAMPLE_RATE = 44100;
const BIN_HZ = SAMPLE_RATE / FFT;

class FakeAnalyser {
  fftSize = FFT;
  smoothingTimeConstant = 0;
  /** The spectrum the next `getByteFrequencyData` will report, 0..255 per bin. */
  spectrum: Uint8Array<ArrayBuffer> = new Uint8Array(FFT / 2);
  get frequencyBinCount(): number {
    return this.fftSize / 2;
  }
  getByteFrequencyData(out: Uint8Array): void {
    out.set(this.spectrum.subarray(0, out.length));
  }
  connect(): void {}
  disconnect(): void {}
}

let analyser: FakeAnalyser;

/** Fill the bins covering [loHz, hiHz] with `level` (0..255) and zero everything else. */
function spectrum(loHz: number, hiHz: number, level: number): Uint8Array<ArrayBuffer> {
  const s = new Uint8Array(FFT / 2);
  const lo = Math.round(loHz / BIN_HZ);
  const hi = Math.round(hiHz / BIN_HZ);
  for (let i = lo; i <= hi && i < s.length; i++) s[i] = level;
  return s;
}

const SILENCE = new Uint8Array(FFT / 2);
/** A kick: energy only inside the bass window. */
const KICK = spectrum(50, 180, 200);
/** A hi-hat: energy only inside the high window. */
const HAT = spectrum(3000, 8000, 200);
/** A chord/snare body: energy only inside the mid window. */
const BODY = spectrum(300, 1700, 200);

function installFakeAudio(): void {
  class FakeAudio {
    loop = false;
    crossOrigin: string | null = null;
    preload = '';
    constructor(public src: string) {}
    play(): Promise<void> {
      return Promise.resolve();
    }
    pause(): void {}
  }

  class FakeAudioContext {
    sampleRate = SAMPLE_RATE;
    currentTime = 0;
    state: AudioContextState = 'running';
    destination = {};
    resume(): Promise<void> {
      return Promise.resolve();
    }
    close(): Promise<void> {
      return Promise.resolve();
    }
    createMediaElementSource() {
      return { connect() {}, disconnect() {} };
    }
    createGain() {
      return {
        gain: { value: 0, cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {} },
        connect() {},
        disconnect() {},
      };
    }
    createAnalyser() {
      analyser = new FakeAnalyser();
      return analyser;
    }
  }

  const listeners = new Map<string, () => void>();
  const fakeWindow = {
    AudioContext: FakeAudioContext,
    addEventListener: (type: string, fn: () => void) => listeners.set(type, fn),
    removeEventListener: (type: string) => listeners.delete(type),
    /** Test-only: fire the gesture the browser would send on first input. */
    gesture: () => listeners.get('pointerdown')?.(),
  };

  (globalThis as Record<string, unknown>).window = fakeWindow;
  (globalThis as Record<string, unknown>).Audio = FakeAudio;
}

/** A started theme plus a helper that feeds it `frames` frames of one spectrum. */
function startedTheme() {
  installFakeAudio();
  const w = (globalThis as unknown as { window: { gesture(): void } }).window;
  const theme = createThemeAudio();
  // Bind this instance's own analyser: two themes may be alive at once in a pacing test.
  const own = analyser;
  theme.arm(w as unknown as Window);
  w.gesture();
  const feed = (bins: Uint8Array<ArrayBuffer>, frames: number): void => {
    for (let i = 0; i < frames; i++) {
      own.spectrum = bins;
      theme.update(1 / 60);
    }
  };
  return { theme, feed };
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).window;
  delete (globalThis as Record<string, unknown>).Audio;
});

describe('theme band separation', () => {
  it('is silent until the first gesture starts the track', () => {
    installFakeAudio();
    const theme = createThemeAudio();
    expect(theme.status()).toBe('idle');
    theme.update(1 / 60);
    expect(theme.bands.bass).toBe(0);
  });

  it('lifts only the bass on a kick', () => {
    const { theme, feed } = startedTheme();
    feed(KICK, 8);
    expect(theme.bands.bass).toBeGreaterThan(0.5);
    expect(theme.bands.mid).toBe(0);
    expect(theme.bands.high).toBe(0);
  });

  it('lifts only the highs on a hi-hat', () => {
    const { theme, feed } = startedTheme();
    feed(HAT, 8);
    expect(theme.bands.high).toBeGreaterThan(0.5);
    expect(theme.bands.bass).toBe(0);
    expect(theme.bands.mid).toBe(0);
  });

  it('lifts only the mids on a chord', () => {
    const { theme, feed } = startedTheme();
    feed(BODY, 12);
    expect(theme.bands.mid).toBeGreaterThan(0.3);
    expect(theme.bands.bass).toBe(0);
    expect(theme.bands.high).toBe(0);
  });
});

describe('theme spectrum display', () => {
  const BARS = THEME.spectrum.bars;

  it('is flat before the track starts', () => {
    installFakeAudio();
    const theme = createThemeAudio();
    expect(theme.spectrum).toHaveLength(BARS);
    theme.update(1 / 60);
    for (const v of theme.spectrum) expect(v).toBe(0);
  });

  it('lifts the left of the display on a kick and the right on a hi-hat', () => {
    const kick = startedTheme();
    kick.feed(KICK, 30);
    expect(kick.theme.spectrum[0]).toBeGreaterThan(0.5);
    expect(kick.theme.spectrum[BARS - 1]).toBe(0);

    const hat = startedTheme();
    hat.feed(HAT, 30);
    expect(hat.theme.spectrum[BARS - 1]).toBeGreaterThan(0.5);
    expect(hat.theme.spectrum[0]).toBe(0);
  });

  it('fills the display on a loud mix, and every bar stays inside 0..1', () => {
    const { theme, feed } = startedTheme();
    feed(spectrum(40, 12000, 255), 60);
    for (const v of theme.spectrum) {
      expect(v).toBeGreaterThan(0.5);
      expect(v).toBeLessThanOrEqual(1);
    }
    // A quiet mix must not pin the meter: the tilt corrects the roll-off, it does not fake it.
    const quiet = startedTheme();
    quiet.feed(spectrum(40, 12000, 12), 60);
    for (const v of quiet.theme.spectrum) expect(v).toBeLessThan(0.5);
  });

  it('falls away more slowly than it rises, so a bar drops rather than blinks out', () => {
    const { theme, feed } = startedTheme();
    feed(spectrum(40, 12000, 220), 60);
    const peak = theme.spectrum[4];
    feed(SILENCE, 6);
    // Six frames of silence barely dents the bar...
    expect(theme.spectrum[4]).toBeGreaterThan(peak * 0.4);
    // ...while six frames of the same music takes one from rest to nearly that peak.
    const rising = startedTheme();
    rising.feed(spectrum(40, 12000, 220), 6);
    expect(rising.theme.spectrum[4]).toBeGreaterThan(peak * 0.9);
  });
});

describe('theme band pacing', () => {
  /** Frames for a band to fall under half its peak once the sound stops. */
  function framesToHalfDecay(bins: Uint8Array<ArrayBuffer>, read: (b: { bass: number; mid: number; high: number }) => number): number {
    const { theme, feed } = startedTheme();
    feed(bins, 6);
    const peak = read(theme.bands);
    expect(peak).toBeGreaterThan(0.2);
    let frames = 0;
    while (read(theme.bands) > peak * 0.5 && frames < 600) {
      feed(SILENCE, 1);
      frames++;
    }
    return frames;
  }

  it('decays the three bands at three different rates: high fastest, mid slowest', () => {
    const high = framesToHalfDecay(HAT, (b) => b.high);
    const bass = framesToHalfDecay(KICK, (b) => b.bass);
    const mid = framesToHalfDecay(BODY, (b) => b.mid);
    // The whole visual effect rests on these being clearly separated, not merely ordered.
    expect(high).toBeLessThan(bass);
    expect(bass).toBeLessThan(mid);
    expect(mid).toBeGreaterThan(high * 3);
  });

  it('rises the mids well behind the bass, so the swell lands after the punch', () => {
    const kick = startedTheme();
    const body = startedTheme();
    // Two frames in — the same instant for both — the kick is already most of the way up and
    // the mid swell has barely started.
    kick.feed(KICK, 2);
    body.feed(BODY, 2);
    expect(kick.theme.bands.bass).toBeGreaterThan(0.8);
    expect(body.theme.bands.mid).toBeLessThan(0.45);
  });

  it('moves `energy` at the scale of seconds, far slower than any band', () => {
    const { theme, feed } = startedTheme();
    const loud = spectrum(40, 12000, 200);
    feed(loud, 30); // half a second of loud music
    expect(theme.bands.energy).toBeLessThan(0.4); // nowhere near settled yet
    feed(loud, 600); // ten seconds
    const held = theme.bands.energy;
    expect(held).toBeGreaterThan(0.8);
    // And it sags rather than snapping when the music drops out.
    feed(SILENCE, 30);
    expect(theme.bands.energy).toBeGreaterThan(held * 0.85);
  });

  it('keeps every band inside 0..1', () => {
    const { theme, feed } = startedTheme();
    feed(spectrum(40, 12000, 255), 240);
    for (const v of [theme.bands.bass, theme.bands.mid, theme.bands.high, theme.bands.energy]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('THEME tuning', () => {
  it('keeps the three analysis windows ordered and non-overlapping', () => {
    const { bass, mid, high } = THEME.bands;
    expect(bass.hiHz).toBeLessThan(mid.loHz);
    expect(mid.hiHz).toBeLessThan(high.loHz);
  });

  it('gives each band a distinct envelope, which is what separates their pacing', () => {
    const { bass, mid, high } = THEME.bands;
    expect(high.attack).toBeGreaterThan(bass.attack);
    expect(bass.attack).toBeGreaterThan(mid.attack);
    expect(high.release).toBeGreaterThan(bass.release);
    expect(bass.release).toBeGreaterThan(mid.release);
  });
});
