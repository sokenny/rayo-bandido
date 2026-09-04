/**
 * Fixed-timestep game loop. Simulation advances in constant `stepSeconds` ticks;
 * rendering happens once per animation frame with an interpolation alpha.
 *
 * The loop also times its own work: `stats` carries the main-thread milliseconds the last
 * frame spent in simulation and in rendering (the JS side of the frame, before the GPU). The
 * debug overlay averages them, and the resolution governor reads them to tell a CPU-bound
 * frame from a GPU-bound one.
 */
export interface LoopCallbacks {
  /** Advance simulation by exactly `dt` seconds. */
  simulate(dt: number): void;
  /** Render the current state. `alpha` in [0,1) is the fraction into the next tick. `frameDt` is real elapsed seconds. */
  render(alpha: number, frameDt: number): void;
}

export interface LoopStats {
  /** Main-thread time spent in `simulate` calls during the last frame, in ms. */
  simMs: number;
  /** Main-thread time spent in `render` during the last frame, in ms. */
  renderMs: number;
  /** Simulation ticks run in the last frame (0 when the frame was too short for one). */
  steps: number;
}

export interface GameLoop {
  start(): void;
  stop(): void;
  readonly running: boolean;
  /** Timings of the last frame. One long-lived object, mutated in place: read, do not keep. */
  readonly stats: LoopStats;
}

export function createGameLoop(callbacks: LoopCallbacks, stepSeconds = 1 / 60, maxStepsPerFrame = 5): GameLoop {
  let running = false;
  let rafId = 0;
  let last = 0;
  let accumulator = 0;
  const maxFrameDt = stepSeconds * maxStepsPerFrame;
  const stats: LoopStats = { simMs: 0, renderMs: 0, steps: 0 };

  function frame(now: number): void {
    if (!running) return;
    rafId = requestAnimationFrame(frame);
    let frameDt = (now - last) / 1000;
    last = now;
    if (frameDt > maxFrameDt) frameDt = maxFrameDt; // tab was hidden or a hitch; do not spiral
    if (frameDt < 0) frameDt = 0;
    accumulator += frameDt;
    let steps = 0;
    const simStart = performance.now();
    while (accumulator >= stepSeconds && steps < maxStepsPerFrame) {
      callbacks.simulate(stepSeconds);
      accumulator -= stepSeconds;
      steps++;
    }
    if (steps === maxStepsPerFrame) accumulator = 0;
    const renderStart = performance.now();
    callbacks.render(accumulator / stepSeconds, frameDt);
    const end = performance.now();
    stats.simMs = renderStart - simStart;
    stats.renderMs = end - renderStart;
    stats.steps = steps;
  }

  return {
    get running() {
      return running;
    },
    stats,
    start() {
      if (running) return;
      running = true;
      last = performance.now();
      accumulator = 0;
      rafId = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      cancelAnimationFrame(rafId);
    },
  };
}
