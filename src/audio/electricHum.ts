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
}

interface HumVoice {
  gain: GainNode;
  pan: StereoPannerNode;
  a: OscillatorNode;
  b: OscillatorNode;
  shimmer: OscillatorNode;
}

/** Base hover pitch (Hz). Each car is detuned a little so a group never phase-locks. */
const BASE_HZ = 118;

/**
 * A soft, almost-silent hover hum per electric car: two close sines that beat, plus a faint
 * high shimmer, panned and attenuated by the car's position relative to the listener. The
 * whole layer sits far under the engine — you notice it most when a car glides past nearby.
 */
export function createElectricHums(core: AudioCore, count: number): ElectricHums {
  const { ctx, master, noise } = core;
  const voices: HumVoice[] = [];

  for (let i = 0; i < count; i++) {
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const pan = ctx.createStereoPanner();
    gain.connect(pan).connect(master);

    const detune = (i - (count - 1) / 2) * 4; // cents, spreads the fleet apart
    const base = BASE_HZ * (1 + i * 0.03);

    const a = ctx.createOscillator();
    a.type = 'sine';
    a.frequency.value = base;
    a.detune.value = detune;
    const ga = ctx.createGain();
    ga.gain.value = 0.6;
    a.connect(ga).connect(gain);

    const b = ctx.createOscillator();
    b.type = 'sine';
    b.frequency.value = base * 1.005; // slow beat
    b.detune.value = detune;
    const gb = ctx.createGain();
    gb.gain.value = 0.5;
    b.connect(gb).connect(gain);

    const shimmer = ctx.createOscillator();
    shimmer.type = 'triangle';
    shimmer.frequency.value = base * 4.02;
    const gs = ctx.createGain();
    gs.gain.value = 0.08;
    shimmer.connect(gs).connect(gain);

    // A breath of filtered noise gives the whine some air.
    const air = ctx.createBufferSource();
    air.buffer = noise;
    air.loop = true;
    const airFilter = ctx.createBiquadFilter();
    airFilter.type = 'bandpass';
    airFilter.frequency.value = base * 6;
    airFilter.Q.value = 3;
    const airGain = ctx.createGain();
    airGain.gain.value = 0.05;
    air.connect(airFilter).connect(airGain).connect(gain);

    // Subtle vibrato so the hover feels alive.
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 4.5 + i * 0.3;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 1.5;
    lfo.connect(lfoGain);
    lfoGain.connect(a.detune);
    lfoGain.connect(b.detune);

    a.start();
    b.start();
    shimmer.start();
    air.start();
    lfo.start();

    voices.push({ gain, pan, a, b, shimmer });
  }

  return {
    update(dt, listener, targets) {
      const t = ctx.currentTime;
      const tc = Math.max(0.03, Math.min(0.1, dt * 4));
      for (let i = 0; i < voices.length; i++) {
        const voice = voices[i];
        const target = targets[i];
        if (!target || target.status !== 'active') {
          voice.gain.gain.setTargetAtTime(0, t, 0.08);
          continue;
        }
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
      for (const voice of voices) voice.gain.gain.setValueAtTime(0, t);
    },

    dispose() {
      for (const voice of voices) {
        try {
          voice.a.stop();
          voice.b.stop();
          voice.shimmer.stop();
        } catch {
          /* already stopped */
        }
        voice.gain.disconnect();
        voice.pan.disconnect();
      }
    },
  };
}
