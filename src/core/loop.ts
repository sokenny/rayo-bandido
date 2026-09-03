/**
 * Fixed-timestep game loop. Simulation advances in constant `stepSeconds` ticks;
 * rendering happens once per animation frame with an interpolation alpha.
 */
export interface LoopCallbacks {
  /** Advance simulation by exactly `dt` seconds. */
  simulate(dt: number): void;
  /** Render the current state. `alpha` in [0,1) is the fraction into the next tick. `frameDt` is real elapsed seconds. */
  render(alpha: number, frameDt: number): void;
}

export interface GameLoop {
  start(): void;
  stop(): void;
  readonly running: boolean;
}

export function createGameLoop(callbacks: LoopCallbacks, stepSeconds = 1 / 60, maxStepsPerFrame = 5): GameLoop {
  let running = false;
  let rafId = 0;
  let last = 0;
  let accumulator = 0;
  const maxFrameDt = stepSeconds * maxStepsPerFrame;

  function frame(now: number): void {
    if (!running) return;
    rafId = requestAnimationFrame(frame);
    let frameDt = (now - last) / 1000;
    last = now;
    if (frameDt > maxFrameDt) frameDt = maxFrameDt; // tab was hidden or a hitch; do not spiral
    if (frameDt < 0) frameDt = 0;
    accumulator += frameDt;
    let steps = 0;
    while (accumulator >= stepSeconds && steps < maxStepsPerFrame) {
      callbacks.simulate(stepSeconds);
      accumulator -= stepSeconds;
      steps++;
    }
    if (steps === maxStepsPerFrame) accumulator = 0;
    callbacks.render(accumulator / stepSeconds, frameDt);
  }

  return {
    get running() {
      return running;
    },
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
