/**
 * Phones: make the page stop behaving like a page.
 *
 * A browser reads a fast thumb as a document gesture — double tap zooms, two fingers pinch,
 * a drag scrolls or pulls to refresh, a held finger offers to copy — and every one of those
 * lands on a player who is only trying to drive. CSS kills most of them (`touch-action: none`
 * on the game layer, `overscroll-behavior: none` on the document, both in `src/styles.css`),
 * but three gaps are left that only script can close, and this module is those three:
 *
 *   - iOS ignores `user-scalable=no`, so pinch zoom on Safari is cancelled through the
 *     non-standard `gesture*` events that only Safari fires,
 *   - Safari's double-tap zoom survives `touch-action` on some versions, so a second tap
 *     arriving within 320ms of the first is swallowed,
 *   - a long press still opens the callout menu over a canvas, so `contextmenu` is refused.
 *
 * Two comforts ride along, both touch-only: the screen is kept awake while the game is on
 * screen (a driving game can go a minute without a touch, which is long enough for a handset
 * to dim), and the first tap asks for fullscreen so Android drops its address bar. iOS grants
 * neither on iPhone; adding the game to the home screen is what gets it there, which is what
 * the manifest and the `apple-mobile-web-app-*` tags in `index.html` are for.
 *
 * Everything here is scoped to the game layer or filtered by target: the menus still scroll,
 * their inputs still focus, and a desktop browser is left completely alone apart from the
 * `contextmenu` refusal over the canvas.
 */
import { isTouchDevice } from './viewport';

/** Two taps closer together than this are a zoom attempt rather than two shots. */
const DOUBLE_TAP_MS = 320;

/** True when the touch is on something the player is meant to be able to scroll. */
function overScrollable(target: EventTarget | null): boolean {
  let el = target instanceof Element ? target : null;
  while (el) {
    if (el.closest('[data-rb-scroll]')) return true;
    const style = getComputedStyle(el);
    if (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight) return true;
    el = el.parentElement;
  }
  return false;
}

/**
 * Fit the page to the phone and keep it there. Returns the undo, which the tests and the
 * page's own teardown use; in the game it is installed once and never released.
 */
export function installMobileShell(): () => void {
  const off: Array<() => void> = [];
  const on = <K extends keyof DocumentEventMap>(
    target: Document | Window,
    type: K,
    handler: (e: DocumentEventMap[K]) => void,
    opts?: AddEventListenerOptions,
  ): void => {
    target.addEventListener(type as string, handler as EventListener, opts);
    off.push(() => target.removeEventListener(type as string, handler as EventListener, opts));
  };

  // A long press over the game is a held button, never a request for the copy menu. Menus keep
  // theirs: there is nothing to press-and-hold there, and taking it away helps nobody.
  on(document, 'contextmenu', (e) => {
    if (!(e.target instanceof Element) || !e.target.closest('#menu-root')) e.preventDefault();
  });

  if (!isTouchDevice()) return () => off.forEach((fn) => fn());

  // Safari's pinch. These events do not exist anywhere else, hence the string names.
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    const stop = (e: Event): void => e.preventDefault();
    document.addEventListener(type, stop, { passive: false });
    off.push(() => document.removeEventListener(type, stop));
  }

  // Double-tap zoom, and the drag that would otherwise rubber-band the document. Both are let
  // through over anything scrollable so the lobby and the room list still work.
  let lastTap = 0;
  on(
    document,
    'touchend',
    (e) => {
      const now = e.timeStamp;
      // `touches.length` is what is *left* on the glass: a second finger landing is a pinch,
      // not a tap, and pinches are already handled above.
      if (e.changedTouches.length === 1 && !overScrollable(e.target)) {
        if (now - lastTap < DOUBLE_TAP_MS) e.preventDefault();
        lastTap = now;
      }
    },
    { passive: false },
  );

  on(
    document,
    'touchmove',
    (e) => {
      // Multi-touch that reaches here is a pinch on a non-scrolling area: always refuse it.
      if (e.touches.length > 1 || !overScrollable(e.target)) e.preventDefault();
    },
    { passive: false },
  );

  off.push(installWakeLock(), installFullscreenOnFirstTap());
  return () => off.forEach((fn) => fn());
}

/**
 * Keep the backlight on. The lock is dropped by the browser whenever the tab is hidden, so it
 * is taken again on the way back rather than once at start-up.
 */
function installWakeLock(): () => void {
  const nav = navigator as Navigator & {
    wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> };
  };
  if (!nav.wakeLock) return () => {};
  let lock: { release(): Promise<void> } | null = null;
  let disposed = false;

  const acquire = async (): Promise<void> => {
    if (disposed || lock || document.visibilityState !== 'visible') return;
    try {
      lock = await nav.wakeLock!.request('screen');
      // A lock the browser dropped on its own must not be remembered as still held.
      lock = disposed ? (await lock.release(), null) : lock;
    } catch {
      /* refused (battery saver, no permission): the screen dims, the game plays on */
    }
  };
  const onVisibility = (): void => {
    if (document.visibilityState === 'visible') void acquire();
    else lock = null;
  };
  document.addEventListener('visibilitychange', onVisibility);
  void acquire();

  return () => {
    disposed = true;
    document.removeEventListener('visibilitychange', onVisibility);
    void lock?.release().catch(() => {});
    lock = null;
  };
}

/**
 * Android hides its address bar for a fullscreen element, which is the difference between a
 * web page and a game on a 6-inch screen. Fullscreen can only be asked for from a user
 * gesture, so the first tap of the session asks — once, and never again, because a player who
 * leaves fullscreen means it.
 */
function installFullscreenOnFirstTap(): () => void {
  const el = document.documentElement as HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void>;
  };
  const request = el.requestFullscreen ?? el.webkitRequestFullscreen;
  if (!request) return () => {};

  const onTap = (): void => {
    window.removeEventListener('pointerdown', onTap);
    if (document.fullscreenElement) return;
    // iPhone Safari rejects this; the catch is the whole handling.
    void Promise.resolve(request.call(el)).catch(() => {});
  };
  window.addEventListener('pointerdown', onTap, { once: true });
  return () => window.removeEventListener('pointerdown', onTap);
}
