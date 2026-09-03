import { AUDIO } from '../config/tuning';
import { clamp01, lerp } from '../core/math';
import { REF_SPEED } from './dsp';

/**
 * Turbo flutter — the rally "stututu", and the boost model that decides when it is earned.
 *
 * The sound is compressor surge: the throttle plate slams shut while the compressor is still
 * spinning against a column of pressurised air with nowhere to go, so the air stalls, reverses,
 * and chops back through the wheel. Three things have to be true for that to happen, and only
 * the first one is about the pedal:
 *
 * - **The throttle actually closes.** Not "eases off" — shut. Trailing off from full to
 *   half-throttle keeps the plate open and the air flowing; nothing flutters.
 * - **There is boost to stall.** Pressure takes time under load to build, so a blip of the gas
 *   has nothing behind it. This is the part that was missing: gating on a *rate of change* of
 *   throttle alone means every lift flutters, including the constant on/off tapping that
 *   ordinary cornering is made of, and a sound that plays on every corner is just the engine.
 * - **The pressure is spent when it vents.** One lift is one surge. The pipes are empty
 *   afterwards, and you have to go back and earn it with another pull.
 *
 * `boost` is a real state variable here — it lags the throttle going up, bleeds off going down,
 * and is dumped by the flutter itself — which is what turns the effect from a throttle-release
 * notification into something that rewards a long pull into a corner. It also drives the turbo
 * whine, so the whine and the flutter can never disagree about how spooled the car is.
 *
 * The trigger is pure and allocation-free so it can be unit tested without an AudioContext,
 * matching `createBackfireTrigger`.
 */

/** Shape of the effect. Volume lives in `AUDIO.turboFlutterVolume`; these are the physics. */
export const FLUTTER = {
  /** Speed fraction below which the turbo never really loads up, whatever the pedal says. */
  MIN_SPEED_FRAC: 0.08,
  /** Speed fraction at which the compressor can reach full boost. */
  FULL_SPEED_FRAC: 0.3,
  /** Time constant (s) for boost building under load. Long on purpose: a blip must not spool. */
  SPOOL_UP: 0.55,
  /** Time constant (s) for boost bleeding off the throttle. Faster than it builds, as in life. */
  BLEED: 0.3,
  /** Boost needed before a closed throttle can surge. Below this the air just stops. */
  FIRE_BOOST: 0.45,
  /** Throttle drop within one frame that counts as a snap lift-off. */
  LIFT_DROP: 0.35,
  /** Throttle at or below which the plate counts as shut. A part-throttle lift keeps flowing. */
  CLOSED_THROTTLE: 0.15,
  /** Boost left in the pipes after a surge has vented through them. */
  VENT_TO: 0.12,
  /** Length (s) of the shortest surge — a half-spooled lift gets a couple of chuffs. */
  MIN_BURST: 0.32,
  /** Length (s) of the longest surge. A "stututu" is punctuation; past ~1 s it becomes a drone. */
  MAX_BURST: 0.85,
  /** First chuff's period (s). ~18 Hz: distinctly stuttered, not a buzz. */
  CHUFF_PERIOD: 0.055,
  /** Each chuff is this much slower than the one before, as the surge loses pressure. */
  CHUFF_SLOWDOWN: 1.12,
  /**
   * Hard floor (s) between surges, so two can never overlap into a drone. Must stay above
   * `MAX_BURST` — a burst that outlives the gap to the next one is the drone, by definition.
   */
  MIN_INTERVAL: 1.1,
} as const;

/**
 * The chuff times of one surge, relative to its start. Pure, so the burst's length is a fact the
 * tests can check against `MIN_INTERVAL` rather than something to be trusted by ear.
 *
 * Chuffs slow down as the pressure drops, so the count follows from the length rather than the
 * other way round: the burst is cut off at its allotted time instead of running as long as its
 * chuff count happens to take.
 */
export function chuffTimes(strength: number): number[] {
  const budget = lerp(FLUTTER.MIN_BURST, FLUTTER.MAX_BURST, clamp01(strength));
  const times: number[] = [];
  let t = 0;
  let period = FLUTTER.CHUFF_PERIOD;
  while (t + period <= budget) {
    times.push(t);
    t += period;
    period *= FLUTTER.CHUFF_SLOWDOWN;
  }
  return times;
}

export interface TurboFlutterTrigger {
  /** Manifold pressure 0..1 this frame. Also drives the turbo whine. */
  readonly boost: number;
  /**
   * Advance one render frame and report whether the compressor surges.
   *
   * @param speed Signed longitudinal speed (m/s).
   * @param throttle Applied throttle 0..1.
   * @param nitro Boosting this frame.
   * @returns 0 for no flutter, otherwise the strength 0..1 to fire it at.
   */
  tick(dt: number, speed: number, throttle: number, nitro: boolean): number;
  reset(): void;
}

export function createTurboFlutterTrigger(): TurboFlutterTrigger {
  let boost = 0;
  let prevThrottle = 0;
  let sinceLast: number = FLUTTER.MIN_INTERVAL;

  return {
    get boost() {
      return boost;
    },

    tick(dt, speed, throttle, nitro) {
      sinceLast += dt;

      const speedFrac = Math.abs(speed) / REF_SPEED;
      // How much air the compressor can move: no load at a crawl, full load once rolling.
      const speedLoad = clamp01(
        (speedFrac - FLUTTER.MIN_SPEED_FRAC) / (FLUTTER.FULL_SPEED_FRAC - FLUTTER.MIN_SPEED_FRAC),
      );
      const pedal = nitro ? 1 : clamp01(throttle);
      const target = pedal * speedLoad;

      // The lift is judged on the pressure that was there *before* this frame's bleed — the
      // surge is made of the air already in the pipes, not what is left a frame later.
      const held = boost;
      const tau = target > boost ? FLUTTER.SPOOL_UP : FLUTTER.BLEED;
      boost = lerp(boost, target, 1 - Math.exp(-dt / tau));

      const drop = prevThrottle - throttle;
      prevThrottle = throttle;

      if (drop <= FLUTTER.LIFT_DROP) return 0;
      if (throttle > FLUTTER.CLOSED_THROTTLE) return 0;
      if (held < FLUTTER.FIRE_BOOST) return 0;
      if (sinceLast < FLUTTER.MIN_INTERVAL) return 0;

      sinceLast = 0;
      // Vent: the surge is the pressure leaving, so it takes the pressure with it.
      boost = Math.min(boost, FLUTTER.VENT_TO);
      return clamp01((held - FLUTTER.FIRE_BOOST) / (1 - FLUTTER.FIRE_BOOST));
    },

    reset() {
      boost = 0;
      prevThrottle = 0;
      sinceLast = FLUTTER.MIN_INTERVAL;
    },
  };
}

/**
 * One compressor surge, scheduled against the audio clock.
 *
 * A burst of distinct, resonant chuffs: each is a short noise pop rung through a high-Q bandpass
 * (so it has a clear pitch), fully gated to silence between pops so the ear hears separate "tu"
 * hits rather than a buzz. The chuffs get quieter, lower and slower as the surge runs out of
 * pressure — and a bigger surge is given a longer budget (`chuffTimes`), so a long pull into a
 * corner sounds different from a short one instead of only louder.
 *
 * The budget is the point: this is punctuation on a corner entry, and a "stututu" that runs on
 * past about a second stops being a gearchange and becomes a texture the engine has to sit under.
 *
 * Standalone (not closed over an engine) so it can be auditioned and unit-reasoned in isolation.
 */
export function fireTurboFlutter(ctx: AudioContext, out: AudioNode, noise: AudioBuffer, strength: number): void {
  const t0 = ctx.currentTime;
  const s = clamp01(strength);
  const times = chuffTimes(s);
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 9; // high Q -> each chuff rings at a clear pitch, reads as "tu" not "sh"
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);

  let peak = Math.max(0.0004, AUDIO.turboFlutterVolume * (0.5 + 0.5 * s));
  let freq = 2600;
  let end = t0;
  for (let i = 0; i < times.length; i++) {
    const t = t0 + times[i];
    const period = (i + 1 < times.length ? times[i + 1] : times[i] + FLUTTER.CHUFF_PERIOD) - times[i];
    const ring = period * 0.55; // pop rings for ~half the period...
    bp.frequency.setValueAtTime(freq, t);
    // ...then a chirp down inside the pop for the "blby" character.
    bp.frequency.exponentialRampToValueAtTime(freq * 0.72, t + ring);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + ring);
    g.gain.setValueAtTime(0.0001, t + period * 0.92); // hard gap of silence before the next hit
    peak *= 0.82; // fade out
    freq *= 0.92; // drop in pitch
    end = t + period;
  }
  src.connect(bp).connect(g).connect(out);
  src.start(t0);
  src.stop(end + 0.05);
  src.onended = () => {
    g.disconnect();
    bp.disconnect();
  };
}
