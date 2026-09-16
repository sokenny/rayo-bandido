import type { AudioCore } from './core';
import type { Listener } from './electricHum';
import type { GameEvent } from '../core/types';
import { AUDIO, MICRO_SCENES as CFG } from '../config/tuning';
import { microScene, sceneLines } from '../microScenes/registry';
import { sceneClipUrl, VOICE_PROFILES, type VoiceProfile } from '../microScenes/voices';
import type { VoiceProfileId } from '../microScenes/types';
import { distanceGain, stereoPan } from './dsp';
import { fetchSample, normalizeRms } from './sample';

/**
 * A CONVERSATION HAPPENING NEARBY, not a line read at the player.
 *
 * ONE EMITTER PER SPEAKER. The rules say who is talking and where they are standing
 * (`microSceneLine` carries the speaker's own position); this file puts the clip THERE — its own
 * filter, gain and pan chain, re-placed every frame from the listener — so two people at a bus
 * shelter a metre and a half apart really are two points in the stereo field. That is the whole
 * difference between overhearing a conversation and being narrated at.
 *
 * NO DOPPLER, deliberately. The street's shouts bend because a car is tearing past a car
 * (`audio/ambientVoice.ts`); a person leaning on a ledge is not moving, and pitching their voice
 * as the player drives by would make the city sound like a fairground.
 *
 * NOTHING IS GENERATED AT RUNTIME. Every clip is a static file under `public/npc-voice/scenes/`,
 * rendered once by `scripts/generate-scene-voices.mjs`, fetched the first time a scene of that kind
 * goes up near the player and kept for the session. A clip that is missing is silence and nothing
 * else: the scene still plays, the timing is still the rules', and the subtitleless city carries on.
 *
 * PRIORITY. Cinematics, story and mission dialogue, and the police radio all outrank this, and
 * `deps.blocked()` is how it knows: a line on air FADES rather than stopping dead, and the director
 * — told the same thing through `MicroSceneRuntime.externalAudio` — does not start another. Below
 * this sit the street's ambient one-liners, which hold their tongue while `speaking()` is true.
 */

export interface MicroSceneVoices {
  update(dt: number, listener: Listener): void;
  onEvent(ev: GameEvent): void;
  /** A micro-scene line is audible. The street's one-liners wait for it. */
  speaking(): boolean;
  reset(): void;
  dispose(): void;
}

export interface MicroSceneVoiceDeps {
  /** Higher-priority audio is on (or voices are muted): a line on air fades and none starts. */
  blocked(): boolean;
}

/** Loudness the clips are normalized to on decode, so the volume knob means one thing. */
const TARGET_RMS = 0.2;

interface Chain {
  filter: BiquadFilterNode;
  level: GainNode;
  pan: StereoPannerNode;
  src: AudioBufferSourceNode | null;
  /** Which director slot owns it, or -1. */
  slot: number;
  x: number;
  y: number;
  z: number;
  gain: number;
}

export function createMicroSceneVoices(core: AudioCore, deps: MicroSceneVoiceDeps): MicroSceneVoices {
  const { ctx, master } = core;
  const cfg = CFG.audio;
  const buffers = new Map<string, AudioBuffer>();
  const asked = new Set<string>();
  const warmed = new Set<string>();
  let listener: Listener = { x: 0, z: 0, heading: 0 };
  let disposed = false;
  const heard: string[] = [];

  // Three chains: one line at a time by the rules, plus room for the last one's fade and for a
  // reaction cutting in on the same frame a conversation lets go.
  const chains: Chain[] = [];
  for (let i = 0; i < 3; i++) {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.5;
    const level = ctx.createGain();
    level.gain.value = 0;
    const pan = ctx.createStereoPanner();
    filter.connect(level).connect(pan).connect(master);
    chains.push({ filter, level, pan, src: null, slot: -1, x: 0, y: 0, z: 0, gain: 0 });
  }

  function load(clip: string): void {
    if (asked.has(clip) || disposed) return;
    asked.add(clip);
    fetchSample(ctx, sceneClipUrl(clip))
      .then((b) => {
        if (!disposed) buffers.set(clip, normalizeRms(b, TARGET_RMS));
      })
      .catch(() => {
        // Not rendered yet, or no voice for it: that line is silence, and the scene plays on.
      });
  }

  /** Warm every clip a scene could use, once, the first time one of them goes up. */
  function warm(sceneId: string): void {
    if (warmed.has(sceneId)) return;
    warmed.add(sceneId);
    const scene = microScene(sceneId);
    if (!scene) return;
    for (const line of sceneLines(scene)) load(line.clip);
  }

  function place(c: Chain, when: number, tc: number): void {
    const dx = c.x - listener.x;
    const dz = c.z - listener.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    c.level.gain.setTargetAtTime(c.gain * distanceGain(dist, cfg.near, cfg.max), when, tc);
    c.pan.pan.setTargetAtTime(stereoPan(dx, dz, listener.heading, AUDIO.maxPan), when, tc);
    // Open at the speaker, darker across the street. Never below speech.
    const dark = Math.min(1, dist / cfg.far);
    c.filter.frequency.setTargetAtTime(cfg.brightHz - (cfg.brightHz - cfg.darkHz) * dark, when, tc);
  }

  function silence(c: Chain, seconds: number): void {
    const src = c.src;
    c.slot = -1;
    if (!src) return;
    const tc = Math.max(0.01, seconds / 3);
    c.level.gain.setTargetAtTime(0, ctx.currentTime, tc);
    try {
      src.stop(ctx.currentTime + seconds);
    } catch {
      /* already stopped */
    }
  }

  /** Stop whatever slot `slot` has on air. -1 stops everything. */
  function stop(slot: number, seconds: number): void {
    for (const c of chains) if (slot < 0 || c.slot === slot) silence(c, seconds);
  }

  function start(slot: number, clip: string, voice: string, x: number, y: number, z: number): void {
    // One line per slot: whatever it had is done.
    stop(slot, cfg.fadeSeconds);
    const buffer = buffers.get(clip);
    if (!buffer) {
      // Not loaded yet (or missing). Ask for it, so the next appearance has it.
      load(clip);
      return;
    }
    const c = chains.find((ch) => !ch.src);
    if (!c) return;
    if (Math.hypot(x - listener.x, z - listener.z) > cfg.max) return;

    const profile: VoiceProfile | undefined = VOICE_PROFILES[voice as VoiceProfileId];
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    c.src = src;
    c.slot = slot;
    c.x = x;
    c.y = y;
    c.z = z;
    c.gain = cfg.volume * (profile?.gain ?? 1) * (1 + (Math.random() * 2 - 1) * cfg.volumeJitter);
    // The profile's rate is what makes two placeholder men two men; the jitter is what stops a
    // repeated line being a copy of itself.
    src.playbackRate.value = (profile?.rate ?? 1) * (1 + (Math.random() * 2 - 1) * cfg.rateJitter);
    src.connect(c.filter);
    const t0 = ctx.currentTime;
    // Placed before the first sample, so it starts at the speaker instead of sweeping there.
    place(c, t0, 0.005);
    src.onended = () => {
      src.disconnect();
      if (c.src === src) {
        c.src = null;
        c.slot = -1;
      }
    };
    src.start(t0);
    if (import.meta.env.DEV) {
      heard.push(`${clip}@${slot}`);
      if (heard.length > 20) heard.shift();
    }
  }

  const voices: MicroSceneVoices = {
    update(dt, next) {
      if (disposed) return;
      listener = next;
      const blocked = deps.blocked();
      const now = ctx.currentTime;
      const tc = Math.max(0.015, Math.min(0.05, dt * 2));
      for (const c of chains) {
        if (!c.src) continue;
        // Higher-priority audio cut in: fade cleanly rather than stopping dead.
        if (blocked) {
          silence(c, cfg.fadeSeconds);
          continue;
        }
        place(c, now, tc);
      }
    },

    onEvent(ev) {
      switch (ev.type) {
        case 'microSceneSpawn':
          warm(ev.scene);
          break;
        case 'microSceneLine':
          if (deps.blocked()) break;
          start(ev.slot, ev.clip, ev.voice, ev.x, ev.y, ev.z);
          break;
        case 'microSceneLineEnd':
          // `cut` means the rules let go of it early: fade. Otherwise the rules timed the line from
          // the recording itself, so the clip is ending on its own — let it, tail and breath included.
          if (ev.cut) stop(ev.slot, cfg.fadeSeconds);
          break;
        case 'microSceneDespawn':
          stop(ev.slot, cfg.fadeSeconds);
          break;
        case 'restart':
          voices.reset();
          break;
        default:
          break;
      }
    },

    speaking() {
      for (const c of chains) if (c.slot >= 0) return true;
      return false;
    },

    reset() {
      stop(-1, 0.05);
    },

    dispose() {
      disposed = true;
      for (const c of chains) {
        try {
          c.src?.stop();
        } catch {
          /* already stopped */
        }
        c.filter.disconnect();
        c.level.disconnect();
        c.pan.disconnect();
      }
    },
  };

  if (import.meta.env.DEV) {
    // QA: `__rbMicroVoice.status()` says what is loaded, what is on air and what blocked it.
    (window as unknown as { __rbMicroVoice?: unknown }).__rbMicroVoice = {
      status: () => ({
        loaded: buffers.size,
        asked: asked.size,
        missing: [...asked].filter((c) => !buffers.has(c)),
        onAir: chains.filter((c) => c.slot >= 0).map((c) => c.slot),
        blocked: deps.blocked(),
        heard: [...heard],
      }),
    };
  }

  return voices;
}
