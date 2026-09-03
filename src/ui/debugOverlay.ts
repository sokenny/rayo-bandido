import type * as THREE from 'three';

/**
 * Debug performance overlay: FPS (0.5 s average), average and worst frame time, draw calls,
 * triangles, geometries/textures/programs in memory and, on Chromium, an approximate JS heap
 * size. Toggle with F3 or backquote, or open with `?debug=1` (handled by the caller).
 * Also exposes the latest metrics for automation via `metrics`.
 */
export interface DebugMetrics {
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  programs: number;
  /** Worst single frame in the last averaging window, in milliseconds. */
  worstFrameMs: number;
  /** Approximate used JS heap in MB. 0 when the browser does not expose it. */
  heapMb: number;
}

export interface DebugOverlay {
  update(frameDt: number, renderer: THREE.WebGLRenderer): void;
  toggle(): void;
  readonly visible: boolean;
  readonly metrics: DebugMetrics;
  dispose(): void;
}

/** Non-standard, Chromium only. Guarded at every use. */
interface MemoryCapablePerformance extends Performance {
  memory?: { usedJSHeapSize: number };
}

export function createDebugOverlay(root: HTMLElement, initiallyVisible = false): DebugOverlay {
  root.innerHTML = '';
  const el = document.createElement('pre');
  el.className = 'debug-overlay';
  root.appendChild(el);
  let visible = initiallyVisible;
  el.style.display = visible ? 'block' : 'none';

  const metrics: DebugMetrics = {
    fps: 0,
    frameMs: 0,
    drawCalls: 0,
    triangles: 0,
    geometries: 0,
    textures: 0,
    programs: 0,
    worstFrameMs: 0,
    heapMb: 0,
  };
  let accum = 0;
  let frames = 0;
  let worstMs = 0;

  const memory = (performance as MemoryCapablePerformance).memory;

  const onKey = (e: KeyboardEvent): void => {
    if (e.code === 'F3' || e.code === 'Backquote') {
      e.preventDefault();
      visible = !visible;
      el.style.display = visible ? 'block' : 'none';
    }
  };
  window.addEventListener('keydown', onKey);

  return {
    get visible() {
      return visible;
    },
    metrics,
    update(frameDt, renderer) {
      accum += frameDt;
      frames++;
      const ms = frameDt * 1000;
      if (ms > worstMs) worstMs = ms;
      const info = renderer.info;
      metrics.drawCalls = info.render.calls;
      metrics.triangles = info.render.triangles;
      metrics.geometries = info.memory.geometries;
      metrics.textures = info.memory.textures;
      metrics.programs = info.programs ? info.programs.length : 0;
      if (accum >= 0.5) {
        metrics.fps = frames / accum;
        metrics.frameMs = (accum / frames) * 1000;
        metrics.worstFrameMs = worstMs;
        if (memory) metrics.heapMb = memory.usedJSHeapSize / 1048576;
        if (visible) {
          el.textContent =
            `FPS ${metrics.fps.toFixed(0)}\n` +
            `frame ${metrics.frameMs.toFixed(1)} ms avg / ${metrics.worstFrameMs.toFixed(1)} ms worst\n` +
            `draws ${metrics.drawCalls}  tris ${metrics.triangles}\n` +
            `geo ${metrics.geometries}  tex ${metrics.textures}  prog ${metrics.programs}` +
            (memory ? `\nheap ~${metrics.heapMb.toFixed(0)} MB` : '');
        }
        accum = 0;
        frames = 0;
        worstMs = 0;
      }
    },
    toggle() {
      visible = !visible;
      el.style.display = visible ? 'block' : 'none';
    },
    dispose() {
      window.removeEventListener('keydown', onKey);
      root.innerHTML = '';
    },
  };
}
