import { IDLE_RPM01 } from './dsp';

/**
 * THE WORKSHOP'S REV DEMO: the throttle blip the engine gives when an exhaust is picked in the
 * workshop, so the player hears the new pipes straight away (`docs/GARAGE_PLAN.md` §2.7).
 *
 * Pure timing, no Web Audio: `EngineVoice.revDemo()` (`./engine.ts`) starts a clock and, for
 * `REV_DEMO_LENGTH` seconds, lets these curves hold the engine's rpm and throttle UP — never
 * down: if the sim is revving harder than the demo, the sim wins. At the lift (`REV_DEMO.RISE +
 * REV_DEMO.HOLD`) the engine fires one exhaust pop at the preset's `demoPop` strength, the one
 * overrun bang a real blip on a hot tune gives. It is a single pop by design — the backfire
 * RHYTHM belongs to `./backfire.ts`, tuned by ear from recordings, and the demo does not imitate it.
 *
 * Tune by ear: all the numbers are here.
 */
export const REV_DEMO = {
  /** Seconds from idle to the peak of the blip (throttle snapped open). */
  RISE: 0.16,
  /** Seconds held at the peak before the lift. */
  HOLD: 0.14,
  /** Seconds to fall back to idle after the lift. */
  FALL: 0.8,
  /** The blip's peak, as the sim's raw `rpm01` (before `engineNote`). */
  PEAK_RPM01: 0.86,
} as const;

/** How long a rev demo holds the engine, in seconds. */
export const REV_DEMO_LENGTH = REV_DEMO.RISE + REV_DEMO.HOLD + REV_DEMO.FALL;

/** When the throttle snaps shut (and the demo pop fires), seconds into the demo. */
export const REV_DEMO_LIFT_AT = REV_DEMO.RISE + REV_DEMO.HOLD;

/** The raw rpm (0..1) the demo holds the engine at, `t` seconds in. Idle outside the demo. */
export function revDemoRpm(t: number): number {
  if (!(t > 0) || t >= REV_DEMO_LENGTH) return IDLE_RPM01;
  const span = REV_DEMO.PEAK_RPM01 - IDLE_RPM01;
  if (t < REV_DEMO.RISE) {
    const u = t / REV_DEMO.RISE;
    return IDLE_RPM01 + span * u * u * (3 - 2 * u);
  }
  if (t < REV_DEMO_LIFT_AT) return REV_DEMO.PEAK_RPM01;
  // Falls fast off the lift and settles gently, like a flywheel spinning down.
  const u = (t - REV_DEMO_LIFT_AT) / REV_DEMO.FALL;
  return REV_DEMO.PEAK_RPM01 - span * (1 - (1 - u) * (1 - u));
}

/** The throttle (0..1) the demo holds, `t` seconds in: floored until the lift, then closed. */
export function revDemoThrottle(t: number): number {
  return t >= 0 && t < REV_DEMO_LIFT_AT ? 1 : 0;
}
