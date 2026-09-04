import type * as THREE from 'three';

/**
 * GPU frame timer built on `EXT_disjoint_timer_query_webgl2`.
 *
 * JS frame time says how long the main thread was busy; it says nothing about the GPU, which
 * is the side that actually saturates on an integrated laptop chip at high pixel ratios. This
 * wraps every frame's draw calls in a timestamp query and reads the results back a few frames
 * later (queries are asynchronous), so the debug overlay and the resolution governor can see
 * the real render cost.
 *
 * Degrades to `available = false` and `ms = 0` when the extension is missing (Firefox, some
 * mobile GPUs, most headless runs). Never throws.
 */
export interface GpuTimer {
  readonly available: boolean;
  /** Most recent completed GPU frame time, in milliseconds. 0 until the first result. */
  readonly ms: number;
  /** Call right before the frame's first draw. */
  begin(): void;
  /** Call right after the frame's last draw. Also harvests any finished queries. */
  end(): void;
  dispose(): void;
}

interface TimerQueryExt {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

/** Queries in flight at once. Results usually land within two or three frames. */
const RING = 6;

export function createGpuTimer(renderer: THREE.WebGLRenderer): GpuTimer {
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const isWebGL2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
  const ext = isWebGL2 ? (gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerQueryExt | null) : null;

  if (!ext) {
    return {
      available: false,
      ms: 0,
      begin() {},
      end() {},
      dispose() {},
    };
  }

  const queries: Array<WebGLQuery | null> = new Array(RING).fill(null);
  const pending: boolean[] = new Array(RING).fill(false);
  let head = 0;
  let active = false;
  let ms = 0;

  function harvest(): void {
    for (let i = 0; i < RING; i++) {
      const q = queries[i];
      if (!q || !pending[i]) continue;
      const done = gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) as boolean;
      const disjoint = gl.getParameter(ext!.GPU_DISJOINT_EXT) as boolean;
      if (disjoint) {
        // The GPU clock was reset (power state change, context switch). Discard everything.
        for (let j = 0; j < RING; j++) pending[j] = false;
        return;
      }
      if (done) {
        const ns = gl.getQueryParameter(q, gl.QUERY_RESULT) as number;
        ms = ns / 1e6;
        pending[i] = false;
      }
    }
  }

  return {
    available: true,
    get ms() {
      return ms;
    },
    begin() {
      if (active) return;
      // Only one timer query can be active at a time; skip the frame if the slot is still busy.
      if (pending[head]) return;
      let q = queries[head];
      if (!q) {
        q = gl.createQuery();
        queries[head] = q;
      }
      if (!q) return;
      gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
      active = true;
    },
    end() {
      if (active) {
        gl.endQuery(ext.TIME_ELAPSED_EXT);
        pending[head] = true;
        head = (head + 1) % RING;
        active = false;
      }
      harvest();
    },
    dispose() {
      if (active) gl.endQuery(ext.TIME_ELAPSED_EXT);
      for (let i = 0; i < RING; i++) {
        const q = queries[i];
        if (q) gl.deleteQuery(q);
        queries[i] = null;
        pending[i] = false;
      }
    },
  };
}
