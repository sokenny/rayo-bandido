import type { AudioCore } from './core';
import { AUDIO } from '../config/tuning';
import type { PartId } from '../core/loadout';
import { clamp, clamp01, lerp } from '../core/math';
import { engineNote } from './dsp';
import { fireBackfire } from './backfire';
import { REV_DEMO_LENGTH, REV_DEMO_LIFT_AT, revDemoRpm, revDemoThrottle } from './exhaustDemo';
import { createTurboFlutterTrigger, createTurboFlutterVoice } from './turboFlutter';

/** Live drive state the engine voice reads each frame. */
export interface EngineInput {
  /** Engine rpm from the simulation, 0 idle .. 1 redline (`VehicleState.rpm01`). */
  rpm01: number;
  /** Signed longitudinal speed (m/s); the turbo model spools on road speed. */
  speed: number;
  /** Applied throttle 0..1. */
  throttle: number;
  /** Applied brake 0..1. */
  brake: number;
  /** Nitro boosting this frame. */
  nitro: boolean;
  /**
   * Fuel cut this frame off the rev limiter (0..1, `VehicleState.limiterCut`). Square-waved at
   * ~11 Hz while the manual box is pinned at redline; it gates the note off and back on, which
   * is the "ta-ta-ta-ta". Gated with a very short time constant on purpose — the usual ~50 ms
   * smoothing would average the square wave into a wobble instead of a stutter.
   */
  limiterCut?: number;
}

export interface EngineVoice {
  update(dt: number, input: EngineInput): void;
  /** Fanfare when a nitro boost begins: a turbo spool + whoosh. */
  nitroWhoosh(): void;
  /** One exhaust pop/bang at the given strength (0..1). Driven by `createBackfireTrigger`. */
  backfire(strength: number): void;
  /**
   * Swap the exhaust (`loadout.exhaustSound`, a key of `EXHAUST_PRESETS`; unknown ids are stock).
   * Re-bakes the combustion-pulse loops and crossfades to them over `EXHAUST_XFADE` seconds, so
   * the change never clicks; the filter, drive, loudness and backfire level follow the new
   * preset from the next frame. A no-op when `presetId` is already the one playing.
   * Allocates (new buffers and nodes): workshop-time, never per frame.
   */
  setExhaust(presetId: PartId): void;
  /** The exhaust preset playing now. */
  readonly exhaust: PartId;
  /**
   * The workshop's throttle blip (`./exhaustDemo.ts`): about a second of revs up and back
   * down, with one pop at the lift on presets that pop. Call right after `setExhaust`. The
   * engine must keep getting `update` calls for it to play.
   */
  revDemo(): void;
  /** Snap back to idle (on restart). */
  reset(): void;
  dispose(): void;
}

/** Cylinders and firing model. A four-stroke fires cyl/2 times per crank revolution. */
const CYLINDERS = 4;
/** Firing rate (Hz) the cycle buffers are baked at. playbackRate = wantedFiringHz / this. */
const REF_FIRING_HZ = 50;

/* =================================================================================================
 * EXHAUST PRESETS — THE ONE TABLE TO TUNE BY EAR.
 *
 * One row per `exhaustSound.*` part (`src/content/parts/exhaustSound.ts`; a test checks the two
 * agree). `exhaustSound.stock` IS the engine as it sounded before the workshop, number for
 * number — leave it alone. The others are starting points, not measurements: tune them by ear
 * in the workshop (select the exhaust, the car blips). Every field, what it does, and stock:
 *
 *   bodyA, bodyB   Hz   Body tone of the two combustion-pulse banks (A, B). Lower = deeper
 *                       chest; higher = more buzz/scream. The bake jitters each cylinder ±10 %.
 *                       Stock 118 / 92.
 *   decay          1/s  How fast each pulse dies. Higher = shorter, snappier, raspier pops;
 *                       lower = longer boom that runs into the next pulse. Stock 190.
 *   h2, h3         x    2nd and 3rd harmonic of the pulse body. More = brassier/metallic.
 *                       Stock 0.5 / 0.28.
 *   grit           x    Noise inside each pulse: the rasp. Stock 0.55.
 *   gainA, gainB   x    Mix of the two banks. Stock 0.6 / 0.5.
 *   sub            x    Sine glued to the firing rate: the chest thump. Stock 0.5.
 *   clipK          -    Hardness of the soft clip (tanh k). Higher = more distortion/growl at
 *                       the same drive. Stock 2.2.
 *   driveLo/Hi     x    Pre-clip drive from light to full load. Stock 1 / 3.6.
 *   cutLo/Hi       Hz   Lowpass cutoff at idle / redline (then × 0.5..1 with throttle, +2 kHz
 *                       on nitro). Low = muffled; high = open, bright. Stock 420 / 5200.
 *   filterQ        -    Lowpass resonance. Above ~1.5 the cutoff sings: a metallic scream that
 *                       follows the revs. Stock 0.9.
 *   volume         x    Engine level on top of `AUDIO.engineVolume`. Stock 1.
 *   hiss           x    Combustion air/hiss under load. Stock 1.
 *   hissLo/Hi      Hz   Centre of that hiss at idle / redline. Stock 500 / 1600.
 *   popLevel       x    Loudness of every exhaust bang (`./backfire.ts`) through this pipe.
 *                       Stock 1.
 *   popBite        x    Strength multiplier into the bang: > 1 angrier, more clipped; < 1
 *                       softer. Clamped to 1. Stock 1.
 *   popKeep        0..1 Chance a bang the trigger fires is heard at all. < 1 for a muffler
 *                       that swallows some. The trigger's RHYTHM (`BACKFIRE` in
 *                       `./backfire.ts`) is never changed here. Stock 1.
 *   demoPop        0..1 Strength of the one pop at the lift of the workshop rev demo; 0 = none.
 * ============================================================================================== */
export interface ExhaustPreset {
  bodyA: number;
  bodyB: number;
  decay: number;
  h2: number;
  h3: number;
  grit: number;
  gainA: number;
  gainB: number;
  sub: number;
  clipK: number;
  driveLo: number;
  driveHi: number;
  cutLo: number;
  cutHi: number;
  filterQ: number;
  volume: number;
  hiss: number;
  hissLo: number;
  hissHi: number;
  popLevel: number;
  popBite: number;
  popKeep: number;
  demoPop: number;
}

export const EXHAUST_PRESETS: Readonly<Record<string, Readonly<ExhaustPreset>>> = {
  //                          bodyA bodyB decay  h2    h3    grit  gainA gainB sub   clipK driveLo driveHi cutLo cutHi filterQ volume hiss hissLo hissHi popLevel popBite popKeep demoPop
  // Today's engine. DO NOT TUNE: this is the car everyone already knows.
  'exhaustSound.stock': { bodyA: 118, bodyB: 92, decay: 190, h2: 0.5, h3: 0.28, grit: 0.55, gainA: 0.6, gainB: 0.5, sub: 0.5, clipK: 2.2, driveLo: 1, driveHi: 3.6, cutLo: 420, cutHi: 5200, filterQ: 0.9, volume: 1, hiss: 1, hissLo: 500, hissHi: 1600, popLevel: 1, popBite: 1, popKeep: 1, demoPop: 0.5 },
  // Street: deeper and louder. Lower bodies, longer boom, more sub, a darker top end.
  'exhaustSound.street': { bodyA: 96, bodyB: 74, decay: 150, h2: 0.6, h3: 0.22, grit: 0.45, gainA: 0.62, gainB: 0.6, sub: 0.78, clipK: 2.6, driveLo: 1.1, driveHi: 4.0, cutLo: 360, cutHi: 4400, filterQ: 1.1, volume: 1.18, hiss: 0.9, hissLo: 420, hissHi: 1400, popLevel: 1.15, popBite: 1.1, popKeep: 1, demoPop: 0.65 },
  // Straight pipe: raw and raspy. Short pulses full of grit, hard clip, wide-open filter, the
  // bangs louder and angrier (their rhythm is untouched: only how hard each one lands).
  'exhaustSound.straight': { bodyA: 124, bodyB: 98, decay: 235, h2: 0.45, h3: 0.4, grit: 0.95, gainA: 0.62, gainB: 0.52, sub: 0.45, clipK: 3.6, driveLo: 1.3, driveHi: 5.0, cutLo: 520, cutHi: 7000, filterQ: 0.7, volume: 1.25, hiss: 1.5, hissLo: 600, hissHi: 2200, popLevel: 1.35, popBite: 1.3, popKeep: 1, demoPop: 0.9 },
  // Titanium: the high metallic JDM scream. High bodies, strong upper harmonics, a resonant
  // lowpass that sings up the rev range; lighter on the bangs.
  'exhaustSound.titanium': { bodyA: 176, bodyB: 142, decay: 240, h2: 0.72, h3: 0.58, grit: 0.5, gainA: 0.6, gainB: 0.42, sub: 0.28, clipK: 3.0, driveLo: 1.1, driveHi: 4.2, cutLo: 600, cutHi: 8200, filterQ: 2.2, volume: 1.08, hiss: 1.2, hissLo: 800, hissHi: 2800, popLevel: 0.9, popBite: 1, popKeep: 0.85, demoPop: 0.45 },
  // Muffled: the quiet can. Soft clip, closed-down filter, less of everything, and most of the
  // bangs swallowed by the muffler.
  'exhaustSound.quiet': { bodyA: 104, bodyB: 84, decay: 170, h2: 0.4, h3: 0.15, grit: 0.3, gainA: 0.6, gainB: 0.5, sub: 0.55, clipK: 1.6, driveLo: 0.9, driveHi: 2.4, cutLo: 300, cutHi: 2600, filterQ: 0.7, volume: 0.72, hiss: 0.5, hissLo: 400, hissHi: 1100, popLevel: 0.55, popBite: 0.8, popKeep: 0.35, demoPop: 0 },
};

const STOCK_EXHAUST = 'exhaustSound.stock';

/** The preset for a part id; unknown ids (a stale save) get stock. */
export function exhaustPreset(presetId: PartId): Readonly<ExhaustPreset> {
  return EXHAUST_PRESETS[presetId] ?? EXHAUST_PRESETS[STOCK_EXHAUST];
}

/** Crossfade between two exhausts' pulse loops, in seconds. Long enough to never click. */
export const EXHAUST_XFADE = 0.22;

/**
 * Bakes one full four-stroke cycle (CYLINDERS combustion pulses) into a looping buffer. Each
 * pulse is a short, fast-decaying "pop" with a low body tone plus grit — the exhaust note of
 * one cylinder firing. Per-cylinder amplitude and body-pitch jitter give the loop the uneven,
 * lumpy character of a real engine instead of a synth's perfect periodicity.
 *
 * Looping this and varying playbackRate revs the engine while keeping the pulse texture, which
 * is the whole point: sweeping an oscillator's pitch sounds like a zipper; pitching a train of
 * combustion pulses sounds like a car.
 *
 * `p` shapes the pulse (decay, harmonics, grit); the stock preset bakes exactly the pulse this
 * function always baked.
 */
function bakeEngineCycle(ctx: BaseAudioContext, bodyHz: number, p: Readonly<ExhaustPreset>): AudioBuffer {
  const sr = ctx.sampleRate;
  const firingInterval = 1 / REF_FIRING_HZ;
  const len = Math.max(1, Math.floor(sr * firingInterval * CYLINDERS));
  const buffer = ctx.createBuffer(1, len, sr);
  const data = buffer.getChannelData(0);
  const decay = p.decay; // stock 190: ~5 ms time constant, each pop clears well before the next fires
  const pulseSamples = Math.floor(firingInterval * sr);

  for (let c = 0; c < CYLINDERS; c++) {
    const start = Math.floor(c * firingInterval * sr);
    const amp = 0.72 + Math.random() * 0.28; // cylinder-to-cylinder unevenness
    const f = bodyHz * (0.9 + Math.random() * 0.2);
    for (let i = 0; i < pulseSamples; i++) {
      const t = i / sr;
      const attack = Math.min(1, t / 0.0008);
      const env = attack * Math.exp(-t * decay);
      const tone =
        Math.sin(2 * Math.PI * f * t) +
        p.h2 * Math.sin(2 * Math.PI * 2 * f * t) +
        p.h3 * Math.sin(2 * Math.PI * 3 * f * t);
      const grit = (Math.random() * 2 - 1) * p.grit;
      const idx = start + i;
      if (idx < len) data[idx] += env * amp * (tone + grit);
    }
  }

  // Normalize to a predictable peak so the mix level is stable regardless of the random bake.
  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(data[i]));
  if (peak > 0) {
    const g = 0.9 / peak;
    for (let i = 0; i < len; i++) data[i] *= g;
  }
  return buffer;
}

/** Soft-clip curve (tanh) for exhaust/header rasp. More drive into it = more growl. */
function makeSoftClipCurve(k = 2.2): Float32Array<ArrayBuffer> {
  const n = 2048;
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  const norm = Math.tanh(k);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x) / norm;
  }
  return curve;
}

/**
 * One exhaust's worth of the engine: the two pulse banks, the sub's send, the pre-clip drive
 * and the clipper, ending in a `fade` gain that crossfades it in or out. Everything after it
 * (lowpass, level) and the sub oscillator itself are shared by every voice.
 */
interface ExhaustVoice {
  bankA: AudioBufferSourceNode;
  bankB: AudioBufferSourceNode;
  gainA: GainNode;
  gainB: GainNode;
  subGain: GainNode;
  drive: GainNode;
  shaper: WaveShaperNode;
  fade: GainNode;
}

/**
 * A synthesized four-stroke turbo engine, built as a looped train of combustion pulses (two
 * detuned banks for thickness) driven through a soft-clip waveshaper for exhaust/header rasp
 * and a lowpass that opens under load. Revving changes the loop's playback rate — the pulse
 * texture is preserved at every rpm. A quiet turbo whine spools with rpm and throttle, and
 * lifting off the throttle at speed pops the blow-off valve.
 *
 * The exhaust is swappable (`setExhaust`, the workshop): the pulse banks, sub send, drive and
 * clipper form one `ExhaustVoice`, and a swap builds a new voice and crossfades to it.
 */
export function createEngine(core: AudioCore): EngineVoice {
  const { ctx, master, noise } = core;
  let presetId: PartId = STOCK_EXHAUST;
  let P = exhaustPreset(presetId);

  // --- Output stage: [voice: drive -> waveshaper (rasp) -> fade] -> lowpass -> level. ------
  const toneGain = ctx.createGain();
  toneGain.gain.value = 0;

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 500;
  filter.Q.value = P.filterQ;
  filter.connect(toneGain);
  toneGain.connect(master);

  // A low sine glued to the firing rate adds chest-thump body under the pulses. Shared by
  // every exhaust voice; each has its own send (`subGain`) into its own drive.
  const sub = ctx.createOscillator();
  sub.type = 'sine';

  /** Soft-clip curves by hardness, so flipping back and forth never rebuilds one. */
  const curves = new Map<number, Float32Array<ArrayBuffer>>();
  const curveFor = (k: number): Float32Array<ArrayBuffer> => {
    let c = curves.get(k);
    if (!c) {
      c = makeSoftClipCurve(k);
      curves.set(k, c);
    }
    return c;
  };

  /** Builds (and starts) the pulse banks for preset `p`, playing at `rate`, faded to `fade0`. */
  function buildVoice(p: Readonly<ExhaustPreset>, rate: number, fade0: number): ExhaustVoice {
    const fade = ctx.createGain();
    fade.gain.value = fade0;
    fade.connect(filter);

    const shaper = ctx.createWaveShaper();
    shaper.curve = curveFor(p.clipK);
    shaper.oversample = '2x';
    shaper.connect(fade);

    // Pre-shaper drive: raising this pushes harder into the soft clip for more growl under load.
    const drive = ctx.createGain();
    drive.gain.value = 1;
    drive.connect(shaper);

    // Two combustion-pulse banks, slightly detuned, summed into the drive stage.
    const bankA = ctx.createBufferSource();
    bankA.buffer = bakeEngineCycle(ctx, p.bodyA, p);
    bankA.loop = true;
    bankA.playbackRate.value = rate;
    const gainA = ctx.createGain();
    gainA.gain.value = p.gainA;
    bankA.connect(gainA).connect(drive);

    const bankB = ctx.createBufferSource();
    bankB.buffer = bakeEngineCycle(ctx, p.bodyB, p);
    bankB.loop = true;
    bankB.playbackRate.value = rate * 1.006;
    const gainB = ctx.createGain();
    gainB.gain.value = p.gainB;
    bankB.connect(gainB).connect(drive);

    const subGain = ctx.createGain();
    subGain.gain.value = p.sub;
    sub.connect(subGain).connect(drive);

    bankA.start();
    bankB.start();
    return { bankA, bankB, gainA, gainB, subGain, drive, shaper, fade };
  }

  function disconnectVoice(v: ExhaustVoice): void {
    sub.disconnect(v.subGain);
    for (const n of [v.bankA, v.bankB, v.gainA, v.gainB, v.subGain, v.drive, v.shaper, v.fade]) n.disconnect();
  }

  let voice = buildVoice(P, 1, 1);
  /** Voices crossfading out, kept only so `dispose` can stop them early. */
  const leaving = new Set<ExhaustVoice>();

  // Combustion hiss/air that grows with load, into the same output stage (post-shaper).
  const combSrc = ctx.createBufferSource();
  combSrc.buffer = noise;
  combSrc.loop = true;
  const combFilter = ctx.createBiquadFilter();
  combFilter.type = 'bandpass';
  combFilter.frequency.value = 900;
  combFilter.Q.value = 0.7;
  const combGain = ctx.createGain();
  combGain.gain.value = 0;
  combSrc.connect(combFilter).connect(combGain).connect(filter);

  // Every bang goes through this bus, so the exhaust can make them louder or softer.
  const popBus = ctx.createGain();
  popBus.gain.value = P.popLevel;
  popBus.connect(master);

  // --- Turbo whine: a high triangle that rises with spool. -------------------------------
  const turbo = ctx.createOscillator();
  turbo.type = 'triangle';
  const turboGain = ctx.createGain();
  turboGain.gain.value = 0;
  turbo.connect(turboGain).connect(master);

  sub.start();
  combSrc.start();
  turbo.start();

  const flutter = createTurboFlutterTrigger();
  const flutterVoice = createTurboFlutterVoice(ctx, master);

  function firingHzFor(rpm01: number): number {
    return lerp(AUDIO.engineIdleHz, AUDIO.engineRedlineHz, rpm01);
  }

  let prevCut = 0;
  /** Seconds into the workshop rev demo, or -1 when none is playing. */
  let demoT = -1;
  let demoPopped = false;

  function bang(strength: number): void {
    if (P.popKeep < 1 && Math.random() >= P.popKeep) return;
    fireBackfire(ctx, popBus, noise, clamp01(strength * P.popBite));
  }

  return {
    get exhaust() {
      return presetId;
    },

    update(dt, input) {
      const t = ctx.currentTime;
      const tc = Math.max(0.03, Math.min(0.12, dt * 3)); // smooth revs; gear shifts glide

      // The workshop's blip holds the revs and throttle up (never down) while it plays.
      let rpmIn = input.rpm01;
      let throttleIn = input.throttle;
      if (demoT >= 0) {
        demoT += dt;
        if (demoT >= REV_DEMO_LENGTH) {
          demoT = -1;
        } else {
          rpmIn = Math.max(rpmIn, revDemoRpm(demoT));
          throttleIn = Math.max(throttleIn, revDemoThrottle(demoT));
          if (!demoPopped && demoT >= REV_DEMO_LIFT_AT) {
            demoPopped = true;
            if (P.demoPop > 0) fireBackfire(ctx, popBus, noise, P.demoPop);
          }
        }
      }

      const rpm01 = engineNote(rpmIn);
      const throttle = clamp01(throttleIn);
      const nitroBoost = input.nitro ? 1 : 0;

      // Rev the pulse trains by playback rate; a hair of detune between banks thickens it.
      const firing = firingHzFor(rpm01);
      const rate = firing / REF_FIRING_HZ;
      voice.bankA.playbackRate.setTargetAtTime(rate, t, tc);
      voice.bankB.playbackRate.setTargetAtTime(rate * 1.006, t, tc);
      sub.frequency.setTargetAtTime(firing, t, tc);
      combFilter.frequency.setTargetAtTime(lerp(P.hissLo, P.hissHi, rpm01), t, tc);

      // Brightness opens with rpm and throttle; nitro throws it wide open.
      const cutoff = clamp(
        lerp(P.cutLo, P.cutHi, rpm01) * (0.5 + 0.5 * throttle) + nitroBoost * 2000,
        260,
        11000,
      );
      filter.frequency.setTargetAtTime(cutoff, t, tc);

      // More throttle = harder into the soft clip = more exhaust growl.
      const load = clamp01(0.3 + 0.5 * rpm01 + 0.45 * throttle + nitroBoost * 0.25);
      voice.drive.gain.setTargetAtTime(lerp(P.driveLo, P.driveHi, clamp01(0.35 * rpm01 + 0.65 * throttle)) + nitroBoost, t, 0.06);

      // Loudness: idle floor + load, never fully silent, never past the mix level. The limiter
      // cut chops that down to a fraction and snaps it back, fast enough to read as separate hits.
      const cut = clamp01(input.limiterCut ?? 0);
      const gate = 1 - AUDIO.limiterCutDuck * cut;
      const gainTc = cut > 0 || prevCut > 0 ? 0.006 : 0.05;
      prevCut = cut;
      toneGain.gain.setTargetAtTime(AUDIO.engineVolume * P.volume * (0.4 + 0.6 * load) * gate, t, gainTc);
      combGain.gain.setTargetAtTime(
        AUDIO.engineVolume * P.hiss * (0.06 + 0.35 * throttle * rpm01) * gate,
        t,
        gainTc,
      );

      // One boost model drives both the whine and the flutter, so they can never disagree about
      // how spooled the car is. The surge fires only on a closed throttle with pressure behind
      // it (see `audio/turboFlutter.ts`) — not on every lift, which is most of them.
      const surge = flutter.tick(dt, input.speed, throttle, input.nitro);
      if (surge > 0) flutterVoice.play(surge);

      // Whine: pitched by boost, coloured by the gear so upshifts still bend the note.
      const spool = flutter.boost;
      turbo.frequency.setTargetAtTime(lerp(700, 5400, spool * (0.55 + 0.45 * rpm01)), t, 0.06);
      turboGain.gain.setTargetAtTime(AUDIO.turboVolume * spool * spool, t, 0.06);
    },

    backfire(strength) {
      bang(strength);
    },

    setExhaust(next) {
      const id = EXHAUST_PRESETS[next] ? next : STOCK_EXHAUST;
      if (id === presetId) return;
      presetId = id;
      P = exhaustPreset(id);
      const t = ctx.currentTime;

      // The new pulse loops start silent at the revs the old ones are playing, and the two
      // swap places over EXHAUST_XFADE. Linear ramps from wherever each fade is right now, so
      // a second pick in the middle of a crossfade just turns it round.
      const old = voice;
      voice = buildVoice(P, old.bankA.playbackRate.value, 0);
      voice.drive.gain.value = old.drive.gain.value;
      voice.fade.gain.setValueAtTime(0, t);
      voice.fade.gain.linearRampToValueAtTime(1, t + EXHAUST_XFADE);
      const from = old.fade.gain.value;
      old.fade.gain.cancelScheduledValues(t);
      old.fade.gain.setValueAtTime(from, t);
      old.fade.gain.linearRampToValueAtTime(0, t + EXHAUST_XFADE);
      leaving.add(old);
      old.bankA.onended = () => {
        leaving.delete(old);
        disconnectVoice(old);
      };
      old.bankA.stop(t + EXHAUST_XFADE + 0.03);
      old.bankB.stop(t + EXHAUST_XFADE + 0.03);

      filter.Q.setTargetAtTime(P.filterQ, t, 0.06);
      popBus.gain.setTargetAtTime(P.popLevel, t, 0.06);
    },

    revDemo() {
      demoT = 0;
      demoPopped = false;
    },

    nitroWhoosh() {
      const t = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = noise;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 0.9;
      bp.frequency.setValueAtTime(900, t);
      bp.frequency.exponentialRampToValueAtTime(6000, t + 0.18);
      bp.frequency.exponentialRampToValueAtTime(2200, t + 0.5);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(AUDIO.nitroVolume, t + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
      src.connect(bp).connect(g).connect(master);
      src.start(t);
      src.stop(t + 0.6);
      src.onended = () => {
        g.disconnect();
        bp.disconnect();
      };
    },

    reset() {
      prevCut = 0;
      demoT = -1;
      const t = ctx.currentTime;
      flutter.reset();
      const rate = firingHzFor(0.18) / REF_FIRING_HZ;
      voice.bankA.playbackRate.setValueAtTime(rate, t);
      voice.bankB.playbackRate.setValueAtTime(rate * 1.006, t);
      sub.frequency.setValueAtTime(firingHzFor(0.18), t);
      turboGain.gain.setValueAtTime(0, t);
    },

    dispose() {
      for (const v of [voice, ...leaving]) {
        try {
          v.bankA.stop();
          v.bankB.stop();
        } catch {
          /* already stopped */
        }
      }
      try {
        sub.stop();
        combSrc.stop();
        turbo.stop();
      } catch {
        /* already stopped */
      }
      flutterVoice.dispose();
      toneGain.disconnect();
      filter.disconnect();
      voice.shaper.disconnect();
      voice.drive.disconnect();
      voice.fade.disconnect();
      popBus.disconnect();
      turboGain.disconnect();
    },
  };
}
