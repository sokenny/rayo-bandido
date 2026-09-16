/**
 * WHEN THE MENU'S 3D BACKDROP IS LOADED (`render/menuBackdrop.ts`), and whether it is at all.
 *
 * The menu is the first thing anybody sees, so nothing here may cost it a paint or a click: the
 * backdrop is its own chunk, fetched only after the page has finished loading and the main
 * thread has gone idle, and then a beat later still. Until it has drawn its first frame the menu
 * wears its usual flat background; once it has, the body gets `rb-backdrop` (the menu's panels
 * go translucent, `styles.css`) and the canvas fades up.
 *
 * Skipped outright for anyone who asked for less motion, less data, a very small device, or
 * `?nobg=1` — the menu is complete without it.
 */
const SETTLE_MS = 900;
/** The fade in, and where it ends: `#game-canvas.rb-backdrop-canvas.is-live` in `styles.css`. */
const FADE_MS = 2800;
const FADE_TO = 0.8;

function wanted(): boolean {
  if (new URLSearchParams(location.search).has('nobg')) return false;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false;
  const nav = navigator as Navigator & { connection?: { saveData?: boolean }; deviceMemory?: number };
  if (nav.connection?.saveData) return false;
  if (nav.deviceMemory !== undefined && nav.deviceMemory < 4) return false;
  return true;
}

export function afterLoad(): Promise<void> {
  return document.readyState === 'complete'
    ? Promise.resolve()
    : new Promise((resolve) => window.addEventListener('load', () => resolve(), { once: true }));
}

export function idle(): Promise<void> {
  return new Promise((resolve) => {
    if ('requestIdleCallback' in window) window.requestIdleCallback(() => resolve(), { timeout: 2500 });
    else setTimeout(resolve, 300);
  });
}

/** Start the backdrop behind whatever menu is up. Returns a stop, safe to call at any point. */
export function scheduleMenuBackdrop(canvas: HTMLCanvasElement): () => void {
  let stopped = false;
  let dispose: (() => void) | null = null;
  if (!wanted()) return () => {};

  void (async () => {
    await afterLoad();
    await idle();
    await new Promise((r) => setTimeout(r, SETTLE_MS));
    if (stopped) return;
    try {
      const { startMenuBackdrop } = await import('../render/menuBackdrop');
      if (stopped) return;
      canvas.classList.add('rb-backdrop-canvas');
      const backdrop = startMenuBackdrop(canvas, {
        onFirstFrame() {
          document.body.classList.add('rb-backdrop');
          // An explicit animation from 0 rather than a CSS transition: a transition only fades if
          // the browser has already styled the hidden state, and a first frame that lands in the
          // same style pass would snap straight to the end. `is-live` holds the final opacity.
          canvas.classList.add('is-live');
          canvas.animate?.([{ opacity: 0 }, { opacity: FADE_TO }], { duration: FADE_MS, easing: 'cubic-bezier(0.45, 0, 0.25, 1)' });
        },
      });
      dispose = () => backdrop.dispose();
      if (stopped) dispose();
    } catch (err) {
      // No WebGL, or the chunk failed: the menu is whole without it.
      console.warn('Rayo Bandido: menu backdrop unavailable', err);
      canvas.classList.remove('rb-backdrop-canvas', 'is-live');
      document.body.classList.remove('rb-backdrop');
    }
  })();

  return () => {
    stopped = true;
    dispose?.();
    dispose = null;
  };
}
