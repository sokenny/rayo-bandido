/**
 * Resolution governor: keeps the frame inside its budget on hardware that cannot fill the
 * canvas at the capped pixel ratio, by stepping the render scale down a notch at a time and
 * back up once there is headroom again.
 *
 * WHY THIS AND NOT A LOWER CAP
 * The one cost that scales with the screen on an integrated laptop GPU is fill: pixels times
 * MSAA samples times the number of transparent layers over them. A fixed cap that is right for
 * a 1080p desktop is wrong for a 4K laptop, and a cap that is right for that laptop wastes
 * clarity on a desktop. Measuring and adapting is the only setting that is right for both.
 *
 * HOW IT DECIDES
 * - It watches the real frame interval. Over `downWindowSeconds`, an average above
 *   `downMs` means the display is dropping frames, so it steps down one notch.
 * - It never steps down for a frame the CPU caused: when the main-thread time is most of the
 *   frame, fewer pixels would not help. With a GPU timer available it also refuses to step
 *   down while the GPU itself is well under budget (the stall is elsewhere, usually vsync).
 * - Stepping up needs proof of headroom over the longer `upWindowSeconds`: either the GPU
 *   timer says the frame is cheap, or (without one) the interval itself is far below budget,
 *   which only happens on high-refresh displays. Under 60 Hz vsync with no timer it stays put,
 *   which is the safe direction.
 * - After every change it ignores `settleSeconds` of frames, so the reallocated buffers and
 *   any one-off hitch never trigger the next step.
 * - Single frames longer than `hitchMs` are dropped from the averages: a shader compile, a
 *   tab switch or a GC pause is not GPU load.
 *
 * Pure logic, no Three.js: `update` returns the new pixel ratio when one should be applied and
 * `null` otherwise. The caller owns `renderer.setPixelRatio`.
 */
export interface ResolutionGovernorOptions {
  /** The scale the game starts at: `min(devicePixelRatio, RENDER.maxPixelRatio)`. */
  startRatio: number;
  /** Lowest scale the governor will ever pick. */
  minRatio: number;
  /** Multiplier applied per step down (and undone per step up). */
  stepFactor: number;
  /** Average frame interval above which the game is dropping frames (ms). */
  downMs: number;
  /** Average frame interval below which the display is clearly not the limit (ms). */
  upMs: number;
  /** GPU ms per frame under which stepping up is safe. Only used when a GPU timer exists. */
  gpuUpMs: number;
  /** GPU ms per frame under which the GPU is not what is stalling the frame. */
  gpuIdleMs: number;
  downWindowSeconds: number;
  upWindowSeconds: number;
  settleSeconds: number;
  /** Frames longer than this are hitches, not load, and are ignored. */
  hitchMs: number;
  /** When false the governor never changes the ratio (debug override). */
  enabled: boolean;
}

export interface ResolutionGovernor {
  readonly ratio: number;
  /** "auto", "auto min", "auto max" or "locked". For the debug overlay. */
  readonly status: string;
  /**
   * Feed one frame. `frameMs` is the real interval, `cpuMs` the main-thread time this frame
   * (sim + render JS), `gpuMs` the latest GPU frame time or -1 when no timer is available.
   * Returns the new ratio to apply, or null.
   */
  update(frameMs: number, cpuMs: number, gpuMs: number): number | null;
  /** Force a ratio (debug). Also locks the governor unless `lock` is false. */
  set(ratio: number, lock?: boolean): void;
}

export function createResolutionGovernor(o: ResolutionGovernorOptions): ResolutionGovernor {
  let ratio = o.startRatio;
  let locked = !o.enabled;
  let settle = o.settleSeconds; // ignore the first frames after start as well
  let downAccum = 0;
  let downTime = 0;
  let downFrames = 0;
  let upAccum = 0;
  let upTime = 0;
  let upFrames = 0;
  let gpuAccum = 0;
  let gpuFrames = 0;
  let cpuAccum = 0;

  function clear(): void {
    downAccum = 0;
    downTime = 0;
    downFrames = 0;
    upAccum = 0;
    upTime = 0;
    upFrames = 0;
    gpuAccum = 0;
    gpuFrames = 0;
    cpuAccum = 0;
  }

  function change(next: number): number {
    ratio = next;
    settle = o.settleSeconds;
    clear();
    return ratio;
  }

  return {
    get ratio() {
      return ratio;
    },
    get status() {
      if (locked) return 'locked';
      if (ratio <= o.minRatio + 1e-6) return 'auto min';
      if (ratio >= o.startRatio - 1e-6) return 'auto max';
      return 'auto';
    },
    update(frameMs, cpuMs, gpuMs) {
      if (locked) return null;
      if (!(frameMs > 0)) return null;
      const seconds = frameMs / 1000;
      if (settle > 0) {
        settle -= seconds;
        return null;
      }
      if (frameMs > o.hitchMs) return null;

      downAccum += frameMs;
      downTime += seconds;
      downFrames++;
      upAccum += frameMs;
      upTime += seconds;
      upFrames++;
      cpuAccum += cpuMs;
      if (gpuMs >= 0) {
        gpuAccum += gpuMs;
        gpuFrames++;
      }

      if (downTime >= o.downWindowSeconds) {
        const avg = downAccum / downFrames;
        const cpuAvg = cpuAccum / downFrames;
        const gpuAvg = gpuFrames > 0 ? gpuAccum / gpuFrames : -1;
        downAccum = 0;
        downTime = 0;
        downFrames = 0;
        if (avg > o.downMs && ratio > o.minRatio + 1e-6) {
          const cpuBound = cpuAvg > avg * 0.6;
          const gpuIdle = gpuAvg >= 0 && gpuAvg < o.gpuIdleMs;
          if (!cpuBound && !gpuIdle) {
            return change(Math.max(o.minRatio, ratio * o.stepFactor));
          }
        }
      }

      if (upTime >= o.upWindowSeconds) {
        const avg = upAccum / upFrames;
        const cpuAvg = cpuAccum / upFrames;
        const gpuAvg = gpuFrames > 0 ? gpuAccum / gpuFrames : -1;
        upAccum = 0;
        upTime = 0;
        upFrames = 0;
        gpuAccum = 0;
        gpuFrames = 0;
        cpuAccum = 0;
        if (ratio < o.startRatio - 1e-6 && avg <= o.downMs) {
          // Going up costs more pixels; the frame after the step must still fit. Estimate
          // the GPU cost at the next notch from the current one.
          const grow = 1 / (o.stepFactor * o.stepFactor);
          const gpuHeadroom = gpuAvg >= 0 ? gpuAvg * grow < o.gpuUpMs : false;
          const intervalHeadroom = gpuAvg < 0 && avg < o.upMs && cpuAvg < o.upMs * 0.6;
          if (gpuHeadroom || intervalHeadroom) {
            return change(Math.min(o.startRatio, ratio / o.stepFactor));
          }
        }
      }
      return null;
    },
    set(next, lock = true) {
      ratio = Math.max(o.minRatio, Math.min(o.startRatio, next));
      locked = lock;
      settle = o.settleSeconds;
      clear();
    },
  };
}
