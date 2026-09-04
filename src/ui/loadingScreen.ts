/**
 * Loading screen. The markup lives in `index.html` so it paints before the game bundle even
 * arrives; this module only drives it (status line, progress bar) and takes it down.
 *
 * Why there is one at all: the first frames of the game used to be spent building the city,
 * uploading textures and compiling shaders, and every effect that appears for the first time
 * (smoke, nitro, lightning) compiled its shader mid-play. All of that now happens behind this
 * screen (see `src/render/warmup.ts`), so the first playable frame is already a smooth one.
 *
 * Performance contract: the bar's shimmer is a compositor animation (CSS transform), so it
 * keeps moving while the main thread is blocked building the scene.
 */
export interface LoadingScreen {
  /** Update the status caption and, optionally, the progress (0..1). */
  set(status: string, progress?: number): void;
  /** Resolve after the browser has painted the latest status, so long work starts after it shows. */
  paint(): Promise<void>;
  /** Fade the screen out and remove it. Resolves when it is gone. */
  hide(): Promise<void>;
  /** True after `hide()` has been called. */
  readonly hidden: boolean;
}

const FADE_MS = 420;
/**
 * A background tab gets no animation frames at all, and an embedded preview pane throttles them
 * hard. The paint wait gives up after this long so loading still completes out of sight.
 */
const PAINT_TIMEOUT_MS = 250;

/** Two animation frames (the first commits style, the second is after the paint), or the timeout. */
function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, PAINT_TIMEOUT_MS);
    requestAnimationFrame(() => requestAnimationFrame(finish));
  });
}

export function createLoadingScreen(root: HTMLElement | null): LoadingScreen {
  const statusEl = root ? root.querySelector<HTMLElement>('.rb-loading__status') : null;
  const barEl = root ? root.querySelector<HTMLElement>('.rb-loading__bar-fill') : null;
  let hidden = false;
  let lastStatus = '';
  let lastProgress = -1;

  return {
    get hidden() {
      return hidden;
    },
    set(status, progress) {
      if (statusEl && status !== lastStatus) {
        lastStatus = status;
        statusEl.textContent = status;
      }
      if (barEl && progress !== undefined) {
        const p = progress < 0 ? 0 : progress > 1 ? 1 : progress;
        if (p !== lastProgress) {
          lastProgress = p;
          barEl.style.transform = `scaleX(${p.toFixed(3)})`;
        }
      }
    },
    paint: nextPaint,
    async hide() {
      if (hidden) return;
      hidden = true;
      if (!root) return;
      root.classList.add('is-done');
      await new Promise<void>((resolve) => setTimeout(resolve, FADE_MS));
      root.remove();
    },
  };
}
