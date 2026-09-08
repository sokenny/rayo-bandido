import type { AudioCore } from './core';
import type { TargetState } from '../core/types';
import { AUDIO } from '../config/tuning';
import { distanceGain, stereoPan } from './dsp';

/** Where the player/camera is, so hums can be placed in the stereo field and by distance. */
export interface Listener {
  x: number;
  z: number;
  heading: number;
}

export interface ElectricHums {
  update(dt: number, listener: Listener, targets: readonly TargetState[]): void;
  reset(): void;
  dispose(): void;
  /** How many voices exist. For tests and the perf overlay; the pool never grows. */
  readonly voiceCount: number;
}

interface HumVoice {
  gain: GainNode;
  pan: StereoPannerNode;
  a: OscillatorNode;
  b: OscillatorNode;
  shimmer: OscillatorNode;
  air: AudioBufferSourceNode;
  airFilter: BiquadFilterNode;
  lfo: OscillatorNode;
  /** Index of the car this voice is currently singing for, or -1 when it is free. */
  car: number;
}

/** Base hover pitch (Hz). Each car is detuned a little so a group never phase-locks. */
const BASE_HZ = 118;

/**
 * Pick the cars worth a voice: the nearest `limit` active ones inside `far`, nearest first.
 * Writes their indices into `out` and returns how many it wrote.
 *
 * Pure, allocation-free and exported for its own sake — it is the whole of the pooling
 * decision, and the only part of this module that can be tested without Web Audio.
 */
export function selectHumTargets(
  targets: readonly TargetState[],
  listener: Listener,
  far: number,
  out: Int32Array,
  dist2Scratch: Float64Array,
): number {
  const limit = out.length;
  if (limit <= 0) return 0;
  const far2 = far * far;
  let held = 0;
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    if (t.status !== 'active') continue;
    const dx = t.x - listener.x;
    const dz = t.z - listener.z;
    const d2 = dx * dx + dz * dz;
    // `distanceGain` is exactly zero at `far`, so a car out there would be a silent voice.
    if (d2 >= far2) continue;
    if (held === limit && d2 >= dist2Scratch[held - 1]) continue;
    // Insertion into a sorted top-N. `limit` is a dozen, so the shuffle is nothing.
    let at = held < limit ? held : limit - 1;
    while (at > 0 && dist2Scratch[at - 1] > d2) {
      dist2Scratch[at] = dist2Scratch[at - 1];
      out[at] = out[at - 1];
      at--;
    }
    dist2Scratch[at] = d2;
    out[at] = i;
    if (held < limit) held++;
  }
  return held;
}

/**
 * A soft, almost-silent hover hum per electric car: two close sines that beat, plus a faint
 * high shimmer, panned and attenuated by the car's position relative to the listener. The
 * whole layer sits far under the engine — you notice it most when a car glides past nearby.
 *
 * THE VOICES ARE POOLED, and that is a performance decision, not a sound one. A voice is
 * thirteen Web Audio nodes that run for the life of the page, and `AUDIO.humFar` means a car
 * further away than fifty-five metres contributes exactly nothing. One voice per car is fine
 * for a race's twelve, but the open world holds a hundred and twenty-six of them: sixteen
 * hundred nodes, all but a handful rendering silence, plus two AudioParam writes each per
 * frame from the main thread. So `AUDIO.humVoices` voices are made instead and handed to the
 * nearest cars in range, re-tuned to each car's own pitch as they change hands.
 *
 * A car only ever picks up a voice at the edge of `humFar`, where its gain is zero, so a
 * hand-off is silent by construction — there is no crossfade to get wrong.
 */
export function createElectricHums(core: AudioCore, count: number): ElectricHums {
  const { ctx, master, noise } = core;
  const voices: HumVoice[] = [];
  const poolSize = Math.max(0, Math.min(count, AUDIO.humVoices));

  /**
   * The pitch and character of one car, by index. Kept exactly as it was when every car owned
   * a voice, so a given car sounds the same as it always did; `count` is the whole fleet, not
   * the pool, because the detune spread is a property of the fleet.
   */
  function tune(voice: HumVoice, car: number): void {
    const detune = (car - (count - 1) / 2) * 4; // cents, spreads the fleet apart
    const base = BASE_HZ * (1 + car * 0.03);
    voice.a.frequency.value = base;
    voice.a.detune.value = detune;
    voice.b.frequency.value = base * 1.005; // slow beat
    voice.b.detune.value = detune;
    voice.shimmer.frequency.value = base * 4.02;
    voice.airFilter.frequency.value = base * 6;
    voice.lfo.frequency.value = 4.5 + car * 0.3;
  }

  for (let i = 0; i < poolSize; i++) {
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const pan = ctx.createStereoPanner();
    gain.connect(pan).connect(master);

    const a = ctx.createOscillator();
    a.type = 'sine';
    const ga = ctx.createGain();
    ga.gain.value = 0.6;
    a.connect(ga).connect(gain);

    const b = ctx.createOscillator();
    b.type = 'sine';
    const gb = ctx.createGain();
    gb.gain.value = 0.5;
    b.connect(gb).connect(gain);

    const shimmer = ctx.createOscillator();
    shimmer.type = 'triangle';
    const gs = ctx.createGain();
    gs.gain.value = 0.08;
    shimmer.connect(gs).connect(gain);

    // A breath of filtered noise gives the whine some air.
    const air = ctx.createBufferSource();
    air.buffer = noise;
    air.loop = true;
    const airFilter = ctx.createBiquadFilter();
    airFilter.type = 'bandpass';
    airFilter.Q.value = 3;
    const airGain = ctx.createGain();
    airGain.gain.value = 0.05;
    air.connect(airFilter).connect(airGain).connect(gain);

    // Subtle vibrato so the hover feels alive.
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 1.5;
    lfo.connect(lfoGain);
    lfoGain.connect(a.detune);
    lfoGain.connect(b.detune);

    const voice: HumVoice = { gain, pan, a, b, shimmer, air, airFilter, lfo, car: -1 };
    // Tuned to its own index up front so the nodes never start at a default frequency; the
    // first `update` retunes it to whichever car it actually gets.
    tune(voice, i);

    a.start();
    b.start();
    shimmer.start();
    air.start();
    lfo.start();

    voices.push(voice);
  }

  /** The cars that should be singing this frame, nearest first, and their distances. */
  const picked = new Int32Array(poolSize);
  const pickedDist2 = new Float64Array(poolSize);

  return {
    get voiceCount() {
      return voices.length;
    },

    update(dt, listener, targets) {
      if (voices.length === 0) return;
      const t = ctx.currentTime;
      const tc = Math.max(0.03, Math.min(0.1, dt * 4));
      const chosen = selectHumTargets(targets, listener, AUDIO.humFar, picked, pickedDist2);

      // Let go of any voice whose car has driven out of range or been destroyed. Released
      // first, so the voices it frees are available to the cars that just came in.
      for (let v = 0; v < voices.length; v++) {
        const voice = voices[v];
        if (voice.car < 0) continue;
        let stillWanted = false;
        for (let i = 0; i < chosen; i++) {
          if (picked[i] === voice.car) {
            stillWanted = true;
            break;
          }
        }
        if (stillWanted) continue;
        voice.gain.gain.setTargetAtTime(0, t, 0.08);
        voice.car = -1;
      }

      for (let i = 0; i < chosen; i++) {
        const car = picked[i];
        let voice: HumVoice | null = null;
        for (let v = 0; v < voices.length; v++) {
          if (voices[v].car === car) {
            voice = voices[v];
            break;
          }
        }
        if (!voice) {
          for (let v = 0; v < voices.length; v++) {
            if (voices[v].car < 0) {
              voice = voices[v];
              break;
            }
          }
          // Every voice is busy with a nearer car. `picked` is sorted, so this one and
          // everything after it is further away than all of them: nothing more to hand out.
          if (!voice) break;
          voice.car = car;
          tune(voice, car);
          // A car can only arrive at the edge of `humFar`, where the gain it is about to be
          // given is zero anyway; starting there makes the hand-off silent rather than a step.
          voice.gain.gain.cancelScheduledValues(t);
          voice.gain.gain.setValueAtTime(0, t);
        }
        const target = targets[car];
        const dx = target.x - listener.x;
        const dz = target.z - listener.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        const g = AUDIO.humVolume * distanceGain(dist, AUDIO.humNear, AUDIO.humFar);
        voice.gain.gain.setTargetAtTime(g, t, tc);
        voice.pan.pan.setTargetAtTime(stereoPan(dx, dz, listener.heading, AUDIO.maxPan), t, tc);
      }
    },

    reset() {
      const t = ctx.currentTime;
      for (const voice of voices) {
        voice.gain.gain.cancelScheduledValues(t);
        voice.gain.gain.setValueAtTime(0, t);
        voice.car = -1;
      }
    },

    dispose() {
      for (const voice of voices) {
        try {
          voice.a.stop();
          voice.b.stop();
          voice.shimmer.stop();
          voice.air.stop();
          voice.lfo.stop();
        } catch {
          /* already stopped */
        }
        voice.gain.disconnect();
        voice.pan.disconnect();
      }
    },
  };
}
