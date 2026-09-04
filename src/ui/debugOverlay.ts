import type * as THREE from 'three';

/**
 * Debug performance overlay. Toggle with F3 or backquote, or open with `?debug=1` (handled by
 * the caller). Also exposes the latest metrics for automation via `metrics`.
 *
 * What it shows, and why each line is there:
 *   - FPS and average / worst frame time over a 0.5 s window: the number the player feels.
 *   - `cpu sim / render`: main-thread ms per frame split into simulation and presentation.
 *     If these are small and the frame is still long, the GPU (or vsync) is the limit.
 *   - `gpu`: real GPU frame time from a timer query when the browser exposes one. This is
 *     the number that moves with pixel ratio, overdraw and MSAA.
 *   - draw calls, triangles, geometries / textures / programs in memory. A rising program
 *     count during play means a shader compiled mid-game (a hitch).
 *   - the render scale the resolution governor has settled on, and the JS heap on Chromium.
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
  /** Average main-thread ms per frame spent in simulation over the last window. */
  simMs: number;
  /** Average main-thread ms per frame spent in rendering (JS side) over the last window. */
  renderMs: number;
  /** Average GPU ms per frame over the last window. 0 when no timer query is available. */
  gpuMs: number;
  /** Worst GPU frame in the last window. */
  worstGpuMs: number;
  /** Current renderer pixel ratio (after the resolution governor). */
  pixelRatio: number;
}

/** Per-frame inputs that are not derivable from the renderer. */
export interface DebugFrameInput {
  simMs: number;
  renderMs: number;
  /** GPU ms for the most recently completed frame, or -1 when unavailable. */
  gpuMs: number;
  pixelRatio: number;
  /** Short status of the resolution governor, e.g. "auto" or "locked". */
  governor: string;
}

export interface DebugOverlay {
  update(frameDt: number, renderer: THREE.WebGLRenderer, input: DebugFrameInput): void;
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
    simMs: 0,
    renderMs: 0,
    gpuMs: 0,
    worstGpuMs: 0,
    pixelRatio: 1,
  };
  let accum = 0;
  let frames = 0;
  let worstMs = 0;
  let simAccum = 0;
  let renderAccum = 0;
  let gpuAccum = 0;
  let gpuFrames = 0;
  let worstGpu = 0;

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
    update(frameDt, renderer, input) {
      accum += frameDt;
      frames++;
      const ms = frameDt * 1000;
      if (ms > worstMs) worstMs = ms;
      simAccum += input.simMs;
      renderAccum += input.renderMs;
      if (input.gpuMs >= 0) {
        gpuAccum += input.gpuMs;
        gpuFrames++;
        if (input.gpuMs > worstGpu) worstGpu = input.gpuMs;
      }
      const info = renderer.info;
      metrics.drawCalls = info.render.calls;
      metrics.triangles = info.render.triangles;
      metrics.geometries = info.memory.geometries;
      metrics.textures = info.memory.textures;
      metrics.programs = info.programs ? info.programs.length : 0;
      metrics.pixelRatio = input.pixelRatio;
      if (accum >= 0.5) {
        metrics.fps = frames / accum;
        metrics.frameMs = (accum / frames) * 1000;
        metrics.worstFrameMs = worstMs;
        metrics.simMs = simAccum / frames;
        metrics.renderMs = renderAccum / frames;
        metrics.gpuMs = gpuFrames > 0 ? gpuAccum / gpuFrames : 0;
        metrics.worstGpuMs = worstGpu;
        if (memory) metrics.heapMb = memory.usedJSHeapSize / 1048576;
        if (visible) {
          const gpuLine =
            gpuFrames > 0
              ? `gpu ${metrics.gpuMs.toFixed(1)} ms avg / ${metrics.worstGpuMs.toFixed(1)} ms worst`
              : 'gpu n/a (no timer query)';
          el.textContent =
            `FPS ${metrics.fps.toFixed(0)}\n` +
            `frame ${metrics.frameMs.toFixed(1)} ms avg / ${metrics.worstFrameMs.toFixed(1)} ms worst\n` +
            `cpu sim ${metrics.simMs.toFixed(2)} ms  render ${metrics.renderMs.toFixed(2)} ms\n` +
            `${gpuLine}\n` +
            `draws ${metrics.drawCalls}  tris ${metrics.triangles}\n` +
            `geo ${metrics.geometries}  tex ${metrics.textures}  prog ${metrics.programs}\n` +
            `scale ${metrics.pixelRatio.toFixed(2)}x (${input.governor})` +
            (memory ? `\nheap ~${metrics.heapMb.toFixed(0)} MB` : '');
        }
        accum = 0;
        frames = 0;
        worstMs = 0;
        simAccum = 0;
        renderAccum = 0;
        gpuAccum = 0;
        gpuFrames = 0;
        worstGpu = 0;
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
