import { MENU_AUDIO } from '../config/tuning';
import { afterLoad, idle } from '../ui/menuBackdropLoader';

/**
 * The menu's sound: the thunderstorm (`MENU_AUDIO`), looped behind every menu screen.
 *
 * OPTIONAL AND LAST. Nothing here may cost the menu a paint or a click, so not a byte is fetched
 * until the page has finished loading and the main thread has gone idle — the same gate the 3D
 * backdrop waits behind. A key pressed before then still counts as the gesture that unlocks
 * audio, so the storm starts the moment it is allowed to. Skipped outright on save-data
 * connections; the menu is complete in silence.
 *
 * A plain media element rather than a Web Audio graph: nothing reacts to it, and a stream does
 * not decode megabytes up front. Browsers refuse to start audio until a user gesture, so the
 * first `play()` usually fails and waits for one.
 *
 * Every menu screen is a page load of its own, so the position is written to sessionStorage on
 * the way out and read back on the way in: stepping from the main menu into QUICK PLAY carries
 * the storm on rather than starting it over. M mutes, as it does in game, and that is carried too.
 */
const POSITION_KEY = 'rb.menuAmbience.at';
const MUTED_KEY = 'rb.menuAmbience.muted';

function read(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // Storage blocked: the storm just starts from the top on the next screen.
  }
}

/** Whether the player has muted the menu's sound with M. Every menu sound answers to it. */
export function isMenuAudioMuted(): boolean {
  return read(MUTED_KEY) === '1';
}

function saveData(): boolean {
  const nav = navigator as Navigator & { connection?: { saveData?: boolean } };
  return nav.connection?.saveData === true;
}

export function playMenuAmbience(): void {
  if (saveData()) return;

  let el: HTMLAudioElement | null = null;
  let muted = isMenuAudioMuted();
  let started = false;
  let fadeFrom = 0;
  let fadeStart = 0;
  const at = Number(read(POSITION_KEY));
  let fadeSeconds = MENU_AUDIO.fadeInSeconds;

  function fade(now: number): void {
    if (!el) return;
    // A frame timestamp can predate the `performance.now()` that set `fadeStart`; a negative `t`
    // pushes the volume out of 0..1, which throws and ends the fade with the storm still silent.
    const t = Math.max(0, Math.min(1, (now - fadeStart) / (fadeSeconds * 1000)));
    const target = muted ? 0 : MENU_AUDIO.volume;
    el.volume = Math.max(0, Math.min(1, fadeFrom + (target - fadeFrom) * t));
    if (t < 1) requestAnimationFrame(fade);
  }

  function ramp(): void {
    if (!el) return;
    fadeFrom = el.volume;
    fadeStart = performance.now();
    requestAnimationFrame(fade);
  }

  function start(): void {
    if (started || !el) return;
    started = true;
    el.play().then(ramp, () => {
      // Blocked until a gesture; the next one tries again.
      started = false;
    });
  }

  const onKey = (e: KeyboardEvent): void => {
    if (e.code === 'KeyM' && !e.repeat) {
      muted = !muted;
      write(MUTED_KEY, muted ? '1' : '0');
      fadeSeconds = MENU_AUDIO.muteFadeSeconds;
      if (started) ramp();
    }
    start();
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('pointerdown', start);

  void (async () => {
    await afterLoad();
    await idle();

    const storm = new Audio(MENU_AUDIO.thunderSrc);
    storm.loop = true;
    storm.volume = 0;
    if (at > 0) {
      storm.onloadedmetadata = () => {
        storm.currentTime = at % storm.duration;
      };
    }
    // Only a storm that actually loaded has a position worth handing to the next screen.
    window.addEventListener('pagehide', () => write(POSITION_KEY, String(storm.currentTime)));
    el = storm;

    // A key pressed while the page was still loading already counts as the gesture, so this
    // usually just plays; if not, the next key or click starts it.
    start();
  })();
}
