import { AUDIO } from '../config/tuning';
import { clamp01, lerp } from '../core/math';
import { REF_SPEED } from './dsp';
import { fetchSample, normalizeRms } from './sample';

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
 * matching `createBackfireTrigger`. The sound itself is a recording (`AUDIO.turboFlutterSrcs`),
 * varied per surge by `surgePlayback`.
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
  /**
   * Hard floor (s) between surges. Shorter than the longest recording on purpose: a new surge
   * chokes the one still ringing (`CHOKE`), as one valve venting again would.
   */
  MIN_INTERVAL: 1.1,
} as const;

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

/** How a surge plays its recording. Pure, so the variation is something the tests can hold to. */
export interface SurgePlayback {
  /** Playback rate: pitch and tempo together, as a turbo spun harder flutters higher and faster. */
  rate: number;
  /** Gain on top of `AUDIO.turboFlutterVolume`. */
  gain: number;
  /** Seconds of output (at `rate`) before the fade-out ends it. Never past the clip's own end. */
  length: number;
}

/** Recording shaping. The volume knob is `AUDIO.turboFlutterVolume`; these are the character. */
export const SURGE = {
  /** Loudness (RMS) the recordings are normalized to, so the knob survives a file swap. */
  TARGET_RMS: 0.12,
  /** Below this (absolute sample value) the head of a decoded file counts as encoder padding. */
  SILENCE: 0.004,
  /** Playback rate of the weakest and the strongest surge. */
  RATE_WEAK: 0.93,
  RATE_STRONG: 1.05,
  /** Random rate spread (fraction) per surge, so no two land the same even off the same file. */
  RATE_JITTER: 0.04,
  /** Gain of the weakest surge; the strongest plays at 1. */
  GAIN_WEAK: 0.55,
  /** Fraction of the clip a barely-spooled surge gets before it is faded: a couple of chuffs. */
  LENGTH_WEAK: 0.4,
  /** Fade-out (s) where a surge is cut short. */
  FADE: 0.18,
  /** Fade (s) on a surge still ringing when the next one fires. */
  CHOKE: 0.06,
} as const;

/**
 * The playback of one surge off a clip `duration` seconds long. `jitter` is -1..1 (random in the
 * game, fixed in tests). A bigger surge plays more of the clip, louder, and a hair higher — a
 * long pull into a corner sounds different from a short one, not only louder.
 */
export function surgePlayback(strength: number, duration: number, jitter: number): SurgePlayback {
  const s = clamp01(strength);
  const rate = lerp(SURGE.RATE_WEAK, SURGE.RATE_STRONG, s) * (1 + SURGE.RATE_JITTER * jitter);
  const full = duration / rate;
  return {
    rate,
    gain: lerp(SURGE.GAIN_WEAK, 1, s),
    length: Math.min(full, lerp(SURGE.LENGTH_WEAK, 1, s) * full),
  };
}

export interface TurboFlutterVoice {
  /** Fire one surge at the trigger's strength (0..1). Silent until the recordings have loaded. */
  play(strength: number): void;
  dispose(): void;
}

interface Clip {
  buffer: AudioBuffer;
  /** Seconds of encoder padding / dead air at the head, skipped so the surge lands on the lift. */
  offset: number;
}

function leadingSilence(buffer: AudioBuffer): number {
  const ch = buffer.getChannelData(0);
  for (let i = 0; i < ch.length; i++) if (Math.abs(ch[i]) > SURGE.SILENCE) return i / buffer.sampleRate;
  return 0;
}

/**
 * The compressor surge, off recordings (`AUDIO.turboFlutterSrcs`, served from public/): one of
 * them per surge, never the same file twice running, pitched and trimmed by `surgePlayback`.
 * A new surge chokes the last one if it is still ringing, so two never pile into a drone.
 */
export function createTurboFlutterVoice(ctx: AudioContext, out: AudioNode): TurboFlutterVoice {
  const clips: Clip[] = [];
  let last = -1;
  let ringing: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  let disposed = false;

  for (const url of AUDIO.turboFlutterSrcs) {
    fetchSample(ctx, url)
      .then((decoded) => {
        if (disposed) return;
        const buffer = normalizeRms(decoded, SURGE.TARGET_RMS);
        clips.push({ buffer, offset: leadingSilence(buffer) });
      })
      .catch(() => {
        /* Missing file: one fewer variation. */
      });
  }

  return {
    play(strength) {
      if (disposed || clips.length === 0) return;
      let i = Math.floor(Math.random() * clips.length);
      if (clips.length > 1 && i === last) i = (i + 1 + Math.floor(Math.random() * (clips.length - 1))) % clips.length;
      last = i;
      const clip = clips[i];

      const t0 = ctx.currentTime;
      if (ringing) {
        ringing.gain.gain.cancelScheduledValues(t0);
        ringing.gain.gain.setTargetAtTime(0, t0, SURGE.CHOKE / 3);
        ringing.src.stop(t0 + SURGE.CHOKE);
      }

      const p = surgePlayback(strength, clip.buffer.duration - clip.offset, Math.random() * 2 - 1);
      const src = ctx.createBufferSource();
      src.buffer = clip.buffer;
      src.playbackRate.value = p.rate;
      const gain = ctx.createGain();
      const peak = AUDIO.turboFlutterVolume * p.gain;
      const fade = Math.min(SURGE.FADE, p.length * 0.5);
      gain.gain.setValueAtTime(peak, t0);
      gain.gain.setValueAtTime(peak, t0 + p.length - fade);
      gain.gain.linearRampToValueAtTime(0, t0 + p.length);
      src.connect(gain).connect(out);
      src.start(t0, clip.offset);
      src.stop(t0 + p.length + 0.02);

      const voice = { src, gain };
      ringing = voice;
      src.onended = () => {
        src.disconnect();
        gain.disconnect();
        if (ringing === voice) ringing = null;
      };
    },

    dispose() {
      disposed = true;
      ringing?.src.stop();
    },
  };
}
