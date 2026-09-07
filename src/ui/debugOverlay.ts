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

/**
 * Where the car, the camera and the crosshair are in world metres. Every world spec in
 * `src/world` is written in these same metres (x east, z south, y up, heading 0 = north),
 * so a number read off this line can be pasted straight into a spec or a bug report
 * instead of describing a place by what it looks like.
 */
export interface WorldReadout {
  carX: number;
  carY: number;
  carZ: number;
  /** Radians, 0 = north (-z), increasing clockwise (east = +90 deg). */
  heading: number;
  camX: number;
  camY: number;
  camZ: number;
  /** Where the crosshair meets the ground plane. Free, so it is live every frame. */
  aimX: number;
  aimY: number;
  aimZ: number;
  aimDistance: number;
  /** The collider tag at the ground point, or 'ground' / 'sky'. */
  aimWhat: string;
  aimValid: boolean;
  /**
   * The last F4 reading: the visible surface under the crosshair, walls and roofs included.
   * It sticks around so it can be read after the key is pressed, and it is what the ground
   * line cannot tell you - the ground point shoots straight through a building.
   */
  surface: {
    x: number;
    y: number;
    z: number;
    distance: number;
    /** Collider tag with its rectangle where there is one, else the mesh's group name. */
    what: string;
    valid: boolean;
    /** False until F4 has been pressed once. */
    taken: boolean;
  };
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
  /** Positions in world metres. Omitted before the first frame has a pose. */
  world?: WorldReadout;
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

export interface DebugOverlayOptions {
  /**
   * Called on F4 for one accurate crosshair reading before the line is copied. The per-frame
   * readout is the cheap ground-plane one; this is the expensive scene raycast, paid for only
   * when someone actually asks for a coordinate.
   */
  precise?: () => WorldReadout;
}

export function createDebugOverlay(
  root: HTMLElement,
  initiallyVisible = false,
  options: DebugOverlayOptions = {},
): DebugOverlay {
  root.innerHTML = '';
  const el = document.createElement('pre');
  el.className = 'debug-overlay';
  root.appendChild(el);
  // Coordinates live in their own element so they can refresh every frame while the
  // performance figures keep their half-second averaging window.
  const coords = document.createElement('pre');
  coords.className = 'debug-overlay debug-coords';
  root.appendChild(coords);
  // The crosshair marks exactly which pixel the `aim` line is reporting.
  const crosshair = document.createElement('div');
  crosshair.className = 'debug-crosshair';
  root.appendChild(crosshair);
  let visible = initiallyVisible;
  let lastWorld: WorldReadout | null = null;
  let copiedUntil = 0;
  setVisible(visible);

  function setVisible(on: boolean): void {
    const display = on ? 'block' : 'none';
    el.style.display = display;
    coords.style.display = display;
    crosshair.style.display = display;
  }

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
      setVisible(visible);
    }
    // F4 puts the current readout on the clipboard, ready to paste into a message.
    if (e.code === 'F4' && lastWorld) {
      e.preventDefault();
      const readout = options.precise ? options.precise() : lastWorld;
      const text = clipboardLine(readout);
      copiedUntil = performance.now() + 1400;
      coords.textContent = worldText(readout, true);
      void navigator.clipboard?.writeText(text).catch(() => {
        // No clipboard permission (or no secure context): the line is still on screen.
        copiedUntil = 0;
      });
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
      if (input.world) {
        lastWorld = input.world;
        if (visible) coords.textContent = worldText(input.world, performance.now() < copiedUntil);
      }
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
      setVisible(visible);
    },
    dispose() {
      window.removeEventListener('keydown', onKey);
      root.innerHTML = '';
    },
  };
}

/* ------------------------------------------------------------ coordinate text */

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/** Heading in radians (0 = north, clockwise) to degrees plus the nearest of eight points. */
export function headingLabel(heading: number): string {
  let deg = (heading * 180) / Math.PI;
  deg = ((deg % 360) + 360) % 360;
  const point = COMPASS[Math.round(deg / 45) % 8];
  return `${deg.toFixed(0).padStart(3, ' ')}° ${point}`;
}

/** Fixed width so the numbers stop jittering as the car drives across a sign change. */
function m(value: number): string {
  return value.toFixed(1).padStart(7, ' ');
}

export function worldText(w: WorldReadout, copied: boolean): string {
  // 'ground' as the label of the ground line says nothing; a collider tag says everything.
  const under = w.aimWhat === 'ground' ? '' : `  ${w.aimWhat}`;
  const ground = w.aimValid
    ? `x${m(w.aimX)}         z${m(w.aimZ)}  ${w.aimDistance.toFixed(0)} m${under}`
    : `(${w.aimWhat})`;
  const s = w.surface;
  const surface = !s.taken
    ? '(press F4)'
    : s.valid
      ? `x${m(s.x)} y${m(s.y)} z${m(s.z)}  ${s.distance.toFixed(0)} m  ${s.what}`
      : `(${s.what})`;
  return (
    `car    x${m(w.carX)} y${m(w.carY)} z${m(w.carZ)}  ${headingLabel(w.heading)}\n` +
    `cam    x${m(w.camX)} y${m(w.camY)} z${m(w.camZ)}\n` +
    `ground ${ground}\n` +
    `hit    ${surface}\n` +
    (copied ? 'F4 copied to clipboard' : 'F4 read + copy')
  );
}

/** One pasteable line: the two places that identify a spot, in the world's own metres. */
export function clipboardLine(w: WorldReadout): string {
  const ground = w.aimValid ? `ground (${w.aimX.toFixed(1)}, ${w.aimZ.toFixed(1)})` : `ground none (${w.aimWhat})`;
  const s = w.surface;
  const hit = s.valid ? `hit (${s.x.toFixed(1)}, ${s.y.toFixed(1)}, ${s.z.toFixed(1)}) on ${s.what}` : `hit none (${s.what})`;
  return (
    `car (${w.carX.toFixed(1)}, ${w.carY.toFixed(1)}, ${w.carZ.toFixed(1)}) heading ${headingLabel(w.heading).trim()}; ` +
    `cam (${w.camX.toFixed(1)}, ${w.camY.toFixed(1)}, ${w.camZ.toFixed(1)}); ${ground}; ${hit}`
  );
}
