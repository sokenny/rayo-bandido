import type { PoliceUnit } from '../core/types';
import { AUDIO } from '../config/tuning';
import type { AudioCore } from './core';
import type { Listener } from './electricHum';

/**
 * The police, by ear (`src/sim/police.ts`). Two continuous voices, synthesised like the rest of
 * the kit:
 *
 * - THE SIREN: a two-tone wail (a sawtooth and its fifth through a lowpass), heard from the
 *   nearest car with its lights on. Its loudness, its brightness and its stereo position follow
 *   that car — distant and dull long before it is in view, bright and beside you when it is.
 * - THE MOTOR: the nearest police car's electric drive, pitched to its speed. Calm on patrol; a
 *   chaser opens the filter and gains a hard edge, so a car coming at you sounds like it.
 *
 * Both voices are built once and idle silent; nothing allocates per frame. The one-shots (the
 * scanner blip, the arrest, the escape) live in `audio/oneShots.ts` with the others.
 *
 * Chase music: `audio/theme.ts` has no layer to bring in yet, so the "chase layer" is a
 * TODO hook rather than a voice — see `setChase` on the returned object.
 */
export interface PoliceAudio {
  /** Every frame: which cars are on the road, and whether a chase (siren) is on at all. */
  update(dt: number, listener: Listener, units: readonly PoliceUnit[], siren: boolean): void;
  /** TODO(chase music): a hook for a theme layer when the theme grows one. No-op today. */
  setChase(on: boolean): void;
  reset(): void;
  dispose(): void;
}

/** The wail's sweep (Hz) and its rate (cycles per second). */
const WAIL_LOW = 620;
const WAIL_HIGH = 1140;
const WAIL_RATE = 0.42;

export function createPoliceAudio(core: AudioCore): PoliceAudio {
  const { ctx, master } = core;

  /* ----- siren */
  const sirenGain = ctx.createGain();
  sirenGain.gain.value = 0;
  const sirenPan = ctx.createStereoPanner();
  const sirenFilter = ctx.createBiquadFilter();
  sirenFilter.type = 'lowpass';
  sirenFilter.frequency.value = 800;
  sirenFilter.Q.value = 1.2;
  sirenFilter.connect(sirenGain).connect(sirenPan).connect(master);
  const wail = ctx.createOscillator();
  wail.type = 'sawtooth';
  wail.frequency.value = WAIL_LOW;
  const wailGain = ctx.createGain();
  wailGain.gain.value = 0.6;
  wail.connect(wailGain).connect(sirenFilter);
  const fifth = ctx.createOscillator();
  fifth.type = 'square';
  fifth.frequency.value = WAIL_LOW * 1.5;
  const fifthGain = ctx.createGain();
  fifthGain.gain.value = 0.18;
  fifth.connect(fifthGain).connect(sirenFilter);
  wail.start();
  fifth.start();

  /* ----- motor */
  const motorGain = ctx.createGain();
  motorGain.gain.value = 0;
  const motorPan = ctx.createStereoPanner();
  const motorFilter = ctx.createBiquadFilter();
  motorFilter.type = 'lowpass';
  motorFilter.frequency.value = 500;
  motorFilter.Q.value = 2;
  motorFilter.connect(motorGain).connect(motorPan).connect(master);
  const drive = ctx.createOscillator();
  drive.type = 'sawtooth';
  drive.frequency.value = 90;
  const driveGain = ctx.createGain();
  driveGain.gain.value = 0.5;
  drive.connect(driveGain).connect(motorFilter);
  const whine = ctx.createOscillator();
  whine.type = 'sine';
  whine.frequency.value = 180;
  const whineGain = ctx.createGain();
  whineGain.gain.value = 0.35;
  whine.connect(whineGain).connect(motorFilter);
  drive.start();
  whine.start();

  let phase = 0;

  /** Loudness (0..1) of a car `d` metres away, and its stereo position from the listener. */
  function closeness(d: number, near: number, far: number): number {
    if (d <= near) return 1;
    if (d >= far) return 0;
    const t = (d - near) / (far - near);
    return (1 - t) * (1 - t);
  }

  function panFor(listener: Listener, x: number, z: number): number {
    const dx = x - listener.x;
    const dz = z - listener.z;
    const bearing = Math.atan2(dx, -dz) - listener.heading;
    return Math.max(-AUDIO.maxPan, Math.min(AUDIO.maxPan, Math.sin(bearing) * AUDIO.maxPan));
  }

  return {
    update(dt, listener, units, siren) {
      const t = ctx.currentTime;
      const tc = Math.max(0.03, Math.min(0.12, dt * 5));

      // The nearest car of each kind.
      let nearestAny: PoliceUnit | null = null;
      let nearestAnyD = Infinity;
      let nearestLit: PoliceUnit | null = null;
      let nearestLitD = Infinity;
      for (let i = 0; i < units.length; i++) {
        const u = units[i];
        if (u.status !== 'active') continue;
        const dx = u.x - listener.x;
        const dz = u.z - listener.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d < nearestAnyD) {
          nearestAnyD = d;
          nearestAny = u;
        }
        if (u.lights && d < nearestLitD) {
          nearestLitD = d;
          nearestLit = u;
        }
      }

      /* siren */
      if (siren && nearestLit) {
        phase = (phase + dt * WAIL_RATE) % 1;
        const sweep = 0.5 - 0.5 * Math.cos(phase * Math.PI * 2);
        const f = WAIL_LOW + (WAIL_HIGH - WAIL_LOW) * sweep;
        wail.frequency.setTargetAtTime(f, t, 0.02);
        fifth.frequency.setTargetAtTime(f * 1.5, t, 0.02);
        const near = closeness(nearestLitD, AUDIO.sirenNear, AUDIO.sirenFar);
        sirenGain.gain.setTargetAtTime(AUDIO.sirenVolume * near, t, tc);
        // Dull at a distance, bright up close: the same trick as the traffic's hum.
        sirenFilter.frequency.setTargetAtTime(500 + 2600 * near, t, tc);
        sirenPan.pan.setTargetAtTime(panFor(listener, nearestLit.x, nearestLit.z), t, tc);
      } else {
        sirenGain.gain.setTargetAtTime(0, t, tc);
      }

      /* motor */
      if (nearestAny && nearestAnyD < AUDIO.humFar * 1.4) {
        const u = nearestAny;
        const speed = Math.abs(u.speed);
        const near = closeness(nearestAnyD, AUDIO.humNear, AUDIO.humFar * 1.4);
        const hard = u.lights ? 1 : 0;
        drive.frequency.setTargetAtTime(70 + speed * 7, t, 0.05);
        whine.frequency.setTargetAtTime(160 + speed * 22, t, 0.05);
        motorFilter.frequency.setTargetAtTime(380 + speed * 55 + hard * 1400, t, tc);
        const drivingLevel = 0.45 + 0.55 * Math.min(1, speed / 12);
        motorGain.gain.setTargetAtTime(AUDIO.policeMotorVolume * near * drivingLevel * (1 + 0.7 * hard), t, tc);
        motorPan.pan.setTargetAtTime(panFor(listener, u.x, u.z), t, tc);
      } else {
        motorGain.gain.setTargetAtTime(0, t, tc);
      }
    },

    setChase() {
      // Hook for a chase layer in `audio/theme.ts`; nothing to drive yet.
    },

    reset() {
      const t = ctx.currentTime;
      sirenGain.gain.cancelScheduledValues(t);
      sirenGain.gain.setValueAtTime(0, t);
      motorGain.gain.cancelScheduledValues(t);
      motorGain.gain.setValueAtTime(0, t);
    },

    dispose() {
      for (const o of [wail, fifth, drive, whine]) {
        try {
          o.stop();
        } catch {
          /* already stopped */
        }
        o.disconnect();
      }
      sirenPan.disconnect();
      motorPan.disconnect();
    },
  };
}
