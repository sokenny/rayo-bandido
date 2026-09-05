/**
 * Phones: one landscape viewport, however the handset is being held.
 *
 * The game is a landscape game — the chase camera, the HUD corners and the on-screen pad all
 * assume a wide screen — but a phone is picked up portrait, and the web cannot ask for a
 * landscape orientation outside fullscreen (and never on iOS). So when a touch device is held
 * portrait the whole *game* layer is rotated a quarter turn in CSS and given the swapped
 * dimensions: the player turns the handset sideways and the picture is already the right way
 * up. Menus are not rotated — they read fine in portrait, and the promise here is only about
 * the part you drive in.
 *
 * Two things follow from rotating in CSS rather than in the renderer:
 *   - the drawing buffer and the camera aspect have to come from `viewportWidth/Height()`
 *     below rather than from `window.innerWidth/Height`, because the layer is as wide as the
 *     window is tall,
 *   - hit-testing on the on-screen pad needs no work at all: the browser inverts the transform
 *     for pointer events, so a rotated button is still hit where it is drawn.
 *
 * The size is published as `--rb-vw` / `--rb-vh` instead of using `vw` / `vh` units, which on
 * mobile Safari measure a viewport that does not exist while the address bar is showing.
 */

/** True on a phone or tablet. `?touch=1` / `?touch=0` force it either way for testing. */
export function isTouchDevice(): boolean {
  const forced = new URLSearchParams(location.search).get('touch');
  if (forced === '1') return true;
  if (forced === '0') return false;
  if (typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(pointer: coarse)').matches && navigator.maxTouchPoints > 0;
}

let rotated = false;
/** How many games are currently asking for the lock. Only ever 0 or 1, but this is honest. */
let holders = 0;

function apply(): void {
  const root = document.documentElement;
  root.style.setProperty('--rb-vw', `${window.innerWidth}px`);
  root.style.setProperty('--rb-vh', `${window.innerHeight}px`);
  const want = holders > 0 && isTouchDevice() && window.innerHeight > window.innerWidth;
  if (want === rotated) return;
  rotated = want;
  document.body.classList.toggle('rb-rotated', rotated);
}

const onViewportChange = (): void => apply();

/** True while the game layer is being drawn a quarter turn round. */
export function isRotated(): boolean {
  return rotated;
}

/** Width of the game layer in CSS pixels — the window's *height* while rotated. */
export function viewportWidth(): number {
  return rotated ? window.innerHeight : window.innerWidth;
}

export function viewportHeight(): number {
  return rotated ? window.innerWidth : window.innerHeight;
}

/**
 * Turn the game layer sideways whenever the handset is portrait, until the returned function
 * is called. Install this before anything reads `viewportWidth()`: the renderer is sized once
 * at start-up and would otherwise be built for the unrotated window.
 *
 * `resize` fires after this handler for anyone who registers later (listeners run in the order
 * they were added), so `src/game.ts` sees the new orientation when it resizes the renderer.
 */
export function installLandscapeLock(): () => void {
  holders++;
  if (holders === 1) {
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('orientationchange', onViewportChange);
  }
  apply();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holders--;
    if (holders === 0) {
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('orientationchange', onViewportChange);
    }
    apply();
  };
}
