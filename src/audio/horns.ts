import type { AudioCore } from './core';
import type { Listener } from './electricHum';
import type { TargetState } from '../core/types';
import { AUDIO, HORNS } from '../config/tuning';
import { clamp } from '../core/math';
import { LEVEL_GAP } from '../sim/collision';
import { distanceGain, stereoPan } from './dsp';

/**
 * Oncoming electric cars honking at a player coming at them fast.
 *
 * THE DECISION (`createHornTrigger`, pure, testable): a car decides once per approach, when it is
 * oncoming (facing against the player's travel), roughly on the player's line, and the two will
 * meet inside `HORNS.decideWithin` at a closing speed worth honking about. It then honks with
 * `HORNS.chance`, if no other car honked inside `HORNS.cooldown`. The decision is kept until the
 * car is behind the player or out of range, so one approach is one roll of the dice.
 *
 * THE SOUND (`createHorns`): the horn stays ON THE CAR for as long as it is held. Every frame
 * its voice is re-panned and re-attenuated from the car's position, lowpassed a little more with
 * distance, and pitched by `dopplerRatio` from the two velocities along the line between them.
 * Bearing down on a car, the note is sharp; the instant it is abreast it drops; and the faster
 * the pass, the bigger the drop and the sooner the note falls away behind.
 */

export type HornPattern = 'tap' | 'double' | 'lean';

export interface HornTrigger {
  /** The car to honk this frame and how, or null. */
  step(dt: number, listener: Listener, targets: readonly TargetState[]): { car: number; pattern: HornPattern } | null;
  reset(): void;
}

/**
 * Doppler frequency ratio for a source and listener. `nx`,`nz` is the unit vector from the
 * listener to the source. >1 while they close, <1 while they separate.
 */
export function dopplerRatio(
  nx: number, nz: number,
  listenerVx: number, listenerVz: number,
  sourceVx: number, sourceVz: number,
  c = HORNS.soundSpeed,
): number {
  const towardSource = listenerVx * nx + listenerVz * nz;
  const awayFromListener = sourceVx * nx + sourceVz * nz;
  return clamp((c + towardSource) / Math.max(1, c + awayFromListener), 0.5, 2);
}

/** A target's world velocity: its lane speed along its heading plus any knockback. */
export function carVx(t: TargetState): number {
  return Math.sin(t.heading) * t.speed + t.vx;
}
export function carVz(t: TargetState): number {
  return -Math.cos(t.heading) * t.speed + t.vz;
}

export function createHornTrigger(targetCount: number, random: () => number = Math.random): HornTrigger {
  /** 0 undecided, 1 decided (honked or not) for the current approach. */
  let decided = new Uint8Array(targetCount);
  let sinceHonk = Infinity;
  const result = { car: -1, pattern: 'tap' as HornPattern };

  return {
    step(dt, listener, targets) {
      sinceHonk += dt;
      if (decided.length < targets.length) decided = new Uint8Array(targets.length);
      const lvx = listener.vx ?? 0;
      const lvz = listener.vz ?? 0;
      const speed = Math.hypot(lvx, lvz);
      const ux = speed > 0.1 ? lvx / speed : 0;
      const uz = speed > 0.1 ? lvz / speed : 0;
      let pick = -1;
      for (let i = 0; i < targets.length; i++) {
        const t = targets[i];
        const dx = t.x - listener.x;
        const dz = t.z - listener.z;
        const ahead = dx * ux + dz * uz;
        if (t.status !== 'active' || ahead < 0 || ahead > HORNS.maxAhead || speed < 0.1) {
          decided[i] = 0;
          continue;
        }
        if (decided[i] || speed < HORNS.minSpeed || ahead < HORNS.minAhead) continue;
        if (listener.y !== undefined && Math.abs(t.y - listener.y) > LEVEL_GAP) continue;
        const fx = Math.sin(t.heading);
        const fz = -Math.cos(t.heading);
        if (fx * ux + fz * uz > HORNS.oncomingDot) continue;
        if (Math.abs(dx * uz - dz * ux) > HORNS.maxLateral) continue;
        const closing = speed - (carVx(t) * ux + carVz(t) * uz);
        if (closing < HORNS.minClosing || ahead / closing > HORNS.decideWithin) continue;
        decided[i] = 1;
        if (pick < 0 && sinceHonk >= HORNS.cooldown && random() < HORNS.chance) pick = i;
      }
      if (pick < 0) return null;
      sinceHonk = 0;
      const r = random();
      result.car = pick;
      result.pattern = r < 0.4 ? 'double' : r < 0.85 ? 'lean' : 'tap';
      return result;
    },
    reset() {
      decided.fill(0);
      sinceHonk = Infinity;
    },
  };
}

export interface Horns {
  update(dt: number, listener: Listener, targets: readonly TargetState[]): void;
  reset(): void;
  dispose(): void;
}

interface HornVoice {
  car: number;
  a: OscillatorNode;
  b: OscillatorNode;
  filter: BiquadFilterNode;
  gate: GainNode;
  level: GainNode;
  pan: StereoPannerNode;
}

export function createHorns(core: AudioCore, targetCount: number): Horns {
  const { ctx, master } = core;
  const trigger = createHornTrigger(targetCount);
  const voices: HornVoice[] = [];

  /** Point a voice at its car's position and relative motion right now. */
  function place(voice: HornVoice, listener: Listener, t: TargetState, at: number, tc: number): void {
    const dx = t.x - listener.x;
    const dz = t.z - listener.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const nx = dist > 1e-3 ? dx / dist : 0;
    const nz = dist > 1e-3 ? dz / dist : 0;
    const ratio = dopplerRatio(nx, nz, listener.vx ?? 0, listener.vz ?? 0, carVx(t), carVz(t));
    const cents = 1200 * Math.log2(ratio);
    voice.a.detune.setTargetAtTime(cents, at, tc);
    voice.b.detune.setTargetAtTime(cents, at, tc);
    voice.level.gain.setTargetAtTime(HORNS.volume * distanceGain(dist, HORNS.near, HORNS.far), at, tc);
    voice.pan.pan.setTargetAtTime(stereoPan(dx, dz, listener.heading, AUDIO.maxPan), at, tc);
    // Air takes the edge off a horn with distance.
    voice.filter.frequency.setTargetAtTime(3400 - 2300 * Math.min(1, dist / HORNS.far), at, tc);
  }

  function start(car: number, pattern: HornPattern, listener: Listener, target: TargetState): void {
    const t0 = ctx.currentTime;
    // Each car's horn is its own: a few percent off the fleet pitch, stable per car.
    const tune = 1 + (((car * 7919) % 13) - 6) * 0.008;
    const a = ctx.createOscillator();
    a.type = 'sawtooth';
    a.frequency.value = HORNS.lowHz * tune;
    const b = ctx.createOscillator();
    b.type = 'square';
    b.frequency.value = HORNS.highHz * tune;
    const ga = ctx.createGain();
    ga.gain.value = 0.55;
    const gb = ctx.createGain();
    gb.gain.value = 0.3;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 1.4;
    const gate = ctx.createGain();
    const level = ctx.createGain();
    level.gain.value = 0;
    const pan = ctx.createStereoPanner();
    a.connect(ga).connect(filter);
    b.connect(gb).connect(filter);
    filter.connect(gate).connect(level).connect(pan).connect(master);

    // The pattern, on the gate. Short ramps so the horn clicks on like a relay, not a pad.
    const g = gate.gain;
    g.setValueAtTime(0, t0);
    const blip = (from: number, to: number): void => {
      g.setValueAtTime(0, from);
      g.linearRampToValueAtTime(1, from + 0.012);
      g.setValueAtTime(1, to - 0.02);
      g.linearRampToValueAtTime(0, to);
    };
    let end: number;
    if (pattern === 'double') {
      blip(t0, t0 + 0.13);
      blip(t0 + 0.21, t0 + 0.95);
      end = t0 + 0.95;
    } else if (pattern === 'lean') {
      blip(t0, t0 + 1.4);
      end = t0 + 1.4;
    } else {
      blip(t0, t0 + 0.45);
      end = t0 + 0.45;
    }
    a.start(t0);
    b.start(t0);
    a.stop(end + 0.05);
    b.stop(end + 0.05);

    const voice: HornVoice = { car, a, b, filter, gate, level, pan };
    // Placed before the first sample, so it starts from where the car is instead of sweeping there.
    place(voice, listener, target, t0, 0.005);
    voices.push(voice);
    a.onended = () => {
      const i = voices.indexOf(voice);
      if (i >= 0) voices.splice(i, 1);
      ga.disconnect();
      gb.disconnect();
      filter.disconnect();
      gate.disconnect();
      level.disconnect();
      pan.disconnect();
    };
  }

  return {
    update(dt, listener, targets) {
      const t = ctx.currentTime;
      const tc = Math.max(0.015, Math.min(0.05, dt * 2));
      for (const voice of voices) {
        const target = targets[voice.car];
        // A car shot mid-honk: the horn goes with it.
        if (!target || target.status !== 'active') voice.level.gain.setTargetAtTime(0, t, 0.03);
        else place(voice, listener, target, t, tc);
      }
      const honk = trigger.step(dt, listener, targets);
      if (honk && voices.length < HORNS.maxVoices) start(honk.car, honk.pattern, listener, targets[honk.car]);
    },
    reset() {
      trigger.reset();
      const t = ctx.currentTime;
      for (const voice of voices) {
        voice.level.gain.cancelScheduledValues(t);
        voice.level.gain.setValueAtTime(0, t);
      }
    },
    dispose() {
      for (const voice of voices) {
        try {
          voice.a.stop();
          voice.b.stop();
        } catch {
          /* already stopped */
        }
      }
    },
  };
}
