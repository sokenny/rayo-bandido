import type { AudioCore } from './core';
import type { Listener } from './electricHum';
import type { PassByGust } from './passBy';
import type { GameEvent, TargetState } from '../core/types';
import { AMBIENT_VOICE, AUDIO } from '../config/tuning';
import { clamp } from '../core/math';
import { LEVEL_GAP } from '../sim/collision';
import { AMBIENT_CLIPS, AMBIENT_LINES, ambientClipUrl, type AmbientClipId, type AmbientTrigger } from '../content/ambientVoice';
import type { BusStopCrowd } from '../world/busStopCrowds';
import { carVx, carVz, dopplerRatio } from './horns';
import { distanceGain, stereoPan } from './dsp';
import { fetchSample, normalizeRms } from './sample';

/**
 * THE STREET TALKING BACK: a traffic driver or somebody at a bus stop yelling at the player's car.
 *
 * THE DIRECTOR (`createAmbientDirector`, pure, testable) is the one place that decides whether
 * anybody says anything. Everything that could provoke a line is OFFERED to it; it answers with
 * silence far more often than not:
 *   - one ambient line at a time, then nothing from anybody for `globalCooldown`;
 *   - nothing from the same car or the same stop for `sourceCooldown`;
 *   - except that a strong trigger (`preemptPriority`: a crash, a chase, the Rayo) ignores the
 *     global cooldown and cuts off a weaker line on air — the approach's "¡Dale, Toretto!" must not
 *     swallow the curse after the hit;
 *   - each trigger rolls its `chance`, and a stronger trigger (`priority`) replaces a weaker one
 *     still waiting on its reaction delay — never the other way round;
 *   - the line starts `delay` after its cause; if priority dialogue (BadKala, a character, the police
 *     radio) is on at that moment, or the moment has gone by `staleAfter`, it is DROPPED. Nothing
 *     is ever queued behind anything.
 *   - never the same clip as either of the last two.
 *
 * THE VOICE (`createAmbientVoices`) stays on whoever said it, like the horns (`audio/horns.ts`): a
 * pooled filter → gain → pan chain, re-placed every frame from the car's position (or the
 * pedestrian's), attenuated and darkened with distance, and pitched by a softened doppler — a
 * third of the physical one and never past ±4%, so a shout going by bends a little and stays
 * speech. Each line gets ±8% volume and ±3% rate so a repeat is not a copy.
 *
 * The triggers are the game's own: `nearMiss` and `collision` events for drivers, the pass-by
 * detector's gusts (`audio/passBy.ts`) for a car blown past, and — for bus stops — the car's
 * distance, speed, drift and the chase, read off what `audio.update` already has. The clips are
 * static files (`public/npc-voice/`), fetched only once the car first comes near traffic or a
 * populated stop.
 */

export type AmbientSpeakerKind = 'driver' | 'stop';

export interface AmbientLine {
  trigger: AmbientTrigger;
  clip: AmbientClipId;
  kind: AmbientSpeakerKind;
  /** Target id for a driver, index into the crowds for a stop. */
  id: number;
  /** A stop's speaker: index into its `waiters`. */
  waiter: number;
  priority: number;
  /** Clock time the line is due. */
  at: number;
}

export interface AmbientDirector {
  /**
   * Whether an offer of `trigger` from this source would get as far as its chance roll right now.
   * A stop checks this before spending its once-per-approach roll, so a busy moment does not waste it.
   */
  accepting(now: number, trigger: AmbientTrigger, kind: AmbientSpeakerKind, id: number): boolean;
  /** Something happened. True when a line is now waiting on its reaction delay. */
  offer(now: number, trigger: AmbientTrigger, kind: AmbientSpeakerKind, id: number, waiter?: number): boolean;
  /**
   * The line due now, if it may play: the caller must `ended` it once it is over (or failed). A
   * line can come back while another is on air only when it outranks it: the caller cuts the old one.
   */
  take(now: number, blocked: boolean): AmbientLine | null;
  ended(): void;
  readonly onAir: boolean;
  readonly pending: AmbientLine | null;
  reset(): void;
}

/** Repeated offers from the same source inside this (s) roll only if they are stronger: a grind is one event. */
const REROLL_GAP = 2;
/** A line that never reported its end is let go after this (s). */
const MAX_LINE = 6;

const sourceKey = (kind: AmbientSpeakerKind, id: number): number => (kind === 'driver' ? id : -(id + 1));
const between = (range: readonly [number, number], r: number): number => range[0] + (range[1] - range[0]) * r;

export function createAmbientDirector(random: () => number = Math.random): AmbientDirector {
  const cfg = AMBIENT_VOICE;
  let pending: AmbientLine | null = null;
  let onAir = false;
  let onAirSince = 0;
  let onAirPriority = 0;
  let quietUntil = -Infinity;
  const sourceUntil = new Map<number, { until: number; priority: number }>();
  const rolled = new Map<number, { at: number; priority: number }>();
  const recent: AmbientClipId[] = [];

  function pick(trigger: AmbientTrigger): AmbientClipId {
    const pool = AMBIENT_LINES[trigger];
    let options = pool.filter((c) => !recent.includes(c));
    if (options.length === 0) options = pool.filter((c) => c !== recent[recent.length - 1]);
    if (options.length === 0) options = [...pool];
    return options[Math.min(options.length - 1, Math.floor(random() * options.length))];
  }

  function accepting(now: number, trigger: AmbientTrigger, kind: AmbientSpeakerKind, id: number): boolean {
    if (onAir && now - onAirSince > MAX_LINE) onAir = false;
    const priority = cfg.priority[trigger];
    const strong = priority >= cfg.preemptPriority;
    if (onAir && !(strong && priority > onAirPriority)) return false;
    if (now < quietUntil && !strong) return false;
    const key = sourceKey(kind, id);
    const cooling = sourceUntil.get(key);
    if (cooling && cooling.until > now && !(strong && priority > cooling.priority)) return false;
    if (pending && priority <= pending.priority) return false;
    const prev = rolled.get(key);
    return !(prev && now - prev.at < REROLL_GAP && priority <= prev.priority);
  }

  return {
    accepting,

    offer(now, trigger, kind, id, waiter = 0) {
      if (!accepting(now, trigger, kind, id)) return false;
      const priority = cfg.priority[trigger];
      rolled.set(sourceKey(kind, id), { at: now, priority });
      if (random() >= cfg.chance[trigger]) return false;
      pending = { trigger, clip: pick(trigger), kind, id, waiter, priority, at: now + between(cfg.delay, random()) };
      return true;
    },

    take(now, blocked) {
      if (!pending || now < pending.at) return null;
      const line = pending;
      pending = null;
      if (blocked || now - line.at > cfg.staleAfter) return null;
      if (onAir && line.priority <= onAirPriority) return null;
      onAir = true;
      onAirSince = now;
      onAirPriority = line.priority;
      quietUntil = now + between(cfg.globalCooldown, random());
      sourceUntil.set(sourceKey(line.kind, line.id), { until: now + cfg.sourceCooldown, priority: line.priority });
      recent.push(line.clip);
      if (recent.length > 2) recent.shift();
      return line;
    },

    ended() {
      onAir = false;
    },

    get onAir() {
      return onAir;
    },

    get pending() {
      return pending;
    },

    reset() {
      pending = null;
      onAir = false;
      onAirPriority = 0;
      quietUntil = -Infinity;
      sourceUntil.clear();
      rolled.clear();
      recent.length = 0;
    },
  };
}

/**
 * A near miss that finished with the player ahead of the car's nose and across its line is a
 * cut-up; anything else is a pass alongside. `px`/`pz` is the player.
 */
export function nearMissTrigger(t: TargetState, px: number, pz: number): AmbientTrigger {
  const fx = Math.sin(t.heading);
  const fz = -Math.cos(t.heading);
  const rx = px - t.x;
  const rz = pz - t.z;
  const ahead = rx * fx + rz * fz;
  const lateral = Math.abs(rx * fz - rz * fx);
  const cfg = AMBIENT_VOICE.driver;
  return ahead > cfg.cutAhead && lateral < cfg.cutLateral ? 'driverCut' : 'driverClose';
}

/* ------------------------------------------------------------------ the voice */

export interface AmbientVoices {
  update(dt: number, listener: Listener, targets: readonly TargetState[], drifting: boolean, pursuit: boolean): void;
  onEvent(ev: GameEvent): void;
  gust(gust: PassByGust): void;
  reset(): void;
  dispose(): void;
}

export interface AmbientVoiceDeps {
  /** Priority dialogue is on (or voices are muted): nothing ambient starts, and a line on air fades. */
  blocked(): boolean;
}

/** Loudness the clips are normalized to on decode, so `AMBIENT_VOICE.volume` holds for any file. */
const TARGET_RMS = 0.2;
/** Seconds after a story character's line (voiced or only subtitled) during which the street stays quiet. */
const LINE_HOLD = 3;

const STOP_FAST = 1;
const STOP_DRIFT = 2;
const STOP_PURSUIT = 4;
const STOP_CRASH = 8;
const STOP_RAYO = 16;

interface Chain {
  filter: BiquadFilterNode;
  level: GainNode;
  pan: StereoPannerNode;
  src: AudioBufferSourceNode | null;
  line: AmbientLine | null;
  gain: number;
  rate: number;
}

function findById(targets: readonly TargetState[], id: number): TargetState | undefined {
  if (targets[id]?.id === id) return targets[id];
  for (let i = 0; i < targets.length; i++) if (targets[i].id === id) return targets[i];
  return undefined;
}

export function createAmbientVoices(core: AudioCore, stops: readonly BusStopCrowd[], deps: AmbientVoiceDeps): AmbientVoices {
  const { ctx, master } = core;
  const cfg = AMBIENT_VOICE;
  const director = createAmbientDirector();
  const buffers = new Map<AmbientClipId, AudioBuffer>();
  const loading = { driver: false, stop: false };
  const armed = new Uint8Array(stops.length);
  const fadeFar = cfg.hearing * 1.5;
  let listener: Listener = { x: 0, z: 0, heading: 0 };
  let targets: readonly TargetState[] = [];
  let clock = 0;
  let holdUntil = -Infinity;
  let callOn = false;
  let disposed = false;
  const heard: string[] = [];

  // Two chains: one line at a time, plus room for the last one's fade when a new one starts.
  const chains: Chain[] = [];
  for (let i = 0; i < 2; i++) {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.5;
    const level = ctx.createGain();
    level.gain.value = 0;
    const pan = ctx.createStereoPanner();
    filter.connect(level).connect(pan).connect(master);
    chains.push({ filter, level, pan, src: null, line: null, gain: 0, rate: 1 });
  }

  function load(kind: 'driver' | 'stop'): void {
    if (loading[kind] || disposed) return;
    loading[kind] = true;
    const prefix = kind === 'driver' ? 'driver_' : 'bus_stop_';
    for (const id of Object.keys(AMBIENT_CLIPS) as AmbientClipId[]) {
      if (!id.startsWith(prefix)) continue;
      fetchSample(ctx, ambientClipUrl(id))
        .then((b) => {
          if (!disposed) buffers.set(id, normalizeRms(b, TARGET_RMS));
        })
        .catch(() => {
          /* That clip is missing: its lines are silence. */
        });
    }
  }

  /** Where a line's speaker is, and how fast it moves; false if they are gone or out of earshot. */
  const at = { x: 0, z: 0, vx: 0, vz: 0 };
  function locate(line: AmbientLine): boolean {
    if (line.kind === 'driver') {
      const t = findById(targets, line.id);
      if (!t || t.status !== 'active') return false;
      at.x = t.x;
      at.z = t.z;
      at.vx = carVx(t);
      at.vz = carVz(t);
      return true;
    }
    const w = stops[line.id]?.waiters[line.waiter];
    if (!w) return false;
    at.x = w.x;
    at.z = w.z;
    at.vx = at.vz = 0;
    return true;
  }

  function place(c: Chain, when: number, tc: number): void {
    const dx = at.x - listener.x;
    const dz = at.z - listener.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const nx = dist > 1e-3 ? dx / dist : 0;
    const nz = dist > 1e-3 ? dz / dist : 0;
    const ratio = dopplerRatio(nx, nz, listener.vx ?? 0, listener.vz ?? 0, at.vx, at.vz);
    const bend = clamp((ratio - 1) * cfg.dopplerDepth, -cfg.dopplerMax, cfg.dopplerMax);
    c.src?.playbackRate.setTargetAtTime(c.rate * (1 + bend), when, tc);
    c.level.gain.setTargetAtTime(c.gain * distanceGain(dist, cfg.near, fadeFar), when, tc);
    c.pan.pan.setTargetAtTime(stereoPan(dx, dz, listener.heading, AUDIO.maxPan), when, tc);
    c.filter.frequency.setTargetAtTime(cfg.brightHz - (cfg.brightHz - cfg.darkHz) * Math.min(1, dist / fadeFar), when, tc);
  }

  function silence(c: Chain, tc: number): void {
    const src = c.src;
    if (!src) return;
    c.level.gain.setTargetAtTime(0, ctx.currentTime, tc);
    try {
      src.stop(ctx.currentTime + tc * 5);
    } catch {
      /* already stopped */
    }
  }

  function start(line: AmbientLine): void {
    const buffer = buffers.get(line.clip);
    // The director only hands over a line during another when it outranks it: cut the old one short.
    for (const ch of chains) {
      if (!ch.line) continue;
      ch.line = null;
      silence(ch, 0.03);
    }
    const c = chains.find((ch) => !ch.src) ?? null;
    if (!buffer || !c || !locate(line) || Math.hypot(at.x - listener.x, at.z - listener.z) > cfg.hearing) {
      director.ended();
      return;
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    c.src = src;
    c.line = line;
    c.gain = cfg.volume * (1 + (Math.random() * 2 - 1) * cfg.volumeJitter);
    c.rate = 1 + (Math.random() * 2 - 1) * cfg.rateJitter;
    src.playbackRate.value = c.rate;
    src.connect(c.filter);
    const t0 = ctx.currentTime;
    // Placed before the first sample, so it starts from the speaker instead of sweeping there.
    place(c, t0, 0.005);
    src.onended = () => {
      src.disconnect();
      if (c.src !== src) return;
      c.src = null;
      // A line faded out early was already ended; ending it again could cut short the next one.
      if (c.line) {
        c.line = null;
        director.ended();
      }
    };
    src.start(t0);
    if (import.meta.env.DEV) {
      heard.push(`${line.clip}@${line.kind}${line.id}`);
      if (heard.length > 20) heard.shift();
    }
  }

  /**
   * Roll `trigger` for stop `i` once per approach (`bit`), but only when the director could take
   * it: a stop passed while a driver has the street keeps its roll for later in the same approach.
   */
  function offerStop(i: number, trigger: AmbientTrigger, bit: number): void {
    if (armed[i] & bit || !director.accepting(clock, trigger, 'stop', i)) return;
    armed[i] |= bit;
    const s = stops[i];
    const waiter = Math.min(s.waiters.length - 1, Math.floor(Math.random() * s.waiters.length));
    director.offer(clock, trigger, 'stop', i, waiter);
  }

  /** The nearest populated stop within `radius` of (x, z) on the car's level, or -1. */
  function stopNear(x: number, z: number, radius: number): number {
    let best = -1;
    let bestD = radius;
    for (let i = 0; i < stops.length; i++) {
      const d = Math.hypot(stops[i].x - x, stops[i].z - z);
      if (d < bestD && (listener.y === undefined || Math.abs(stops[i].y - listener.y) <= LEVEL_GAP)) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  function driverInEarshot(t: TargetState | undefined): t is TargetState {
    if (!t || t.status !== 'active') return false;
    if (listener.y !== undefined && Math.abs(t.y - listener.y) > LEVEL_GAP) return false;
    return Math.hypot(t.x - listener.x, t.z - listener.z) < cfg.hearing;
  }

  const voices: AmbientVoices = {
    update(dt, nextListener, nextTargets, drifting, pursuit) {
      if (disposed) return;
      clock += dt;
      listener = nextListener;
      targets = nextTargets;
      const blocked = callOn || clock < holdUntil || deps.blocked();

      if (!loading.driver) {
        for (let i = 0; i < targets.length; i++) {
          if (driverInEarshot(targets[i])) {
            load('driver');
            break;
          }
        }
      }

      const speed = Math.hypot(listener.vx ?? 0, listener.vz ?? 0);
      for (let i = 0; i < stops.length; i++) {
        const s = stops[i];
        const d = Math.hypot(s.x - listener.x, s.z - listener.z);
        if (d < cfg.stop.preloadWithin) load('stop');
        if (d > cfg.stop.rearmBeyond) {
          armed[i] = 0;
          continue;
        }
        if (blocked || (listener.y !== undefined && Math.abs(s.y - listener.y) > LEVEL_GAP)) continue;
        if (d < cfg.stop.fastRadius && speed > cfg.stop.fastSpeed) offerStop(i, 'stopFast', STOP_FAST);
        if (d < cfg.stop.driftRadius && drifting) offerStop(i, 'stopDrift', STOP_DRIFT);
        if (d < cfg.stop.pursuitRadius && pursuit && speed > 8) offerStop(i, 'stopPursuit', STOP_PURSUIT);
      }

      const line = director.take(clock, blocked);
      if (line) start(line);

      const now = ctx.currentTime;
      const tc = Math.max(0.015, Math.min(0.05, dt * 2));
      for (const c of chains) {
        if (!c.src || !c.line) continue;
        // Priority dialogue cuts in, or the speaker is gone (shot, despawned): the line fades out.
        if (blocked || !locate(c.line)) {
          c.line = null;
          silence(c, 0.05);
          director.ended();
          continue;
        }
        place(c, now, tc);
      }
    },

    onEvent(ev) {
      switch (ev.type) {
        case 'collision': {
          if (ev.police) break;
          if (ev.targetId !== undefined) {
            const t = findById(targets, ev.targetId);
            if (driverInEarshot(t)) {
              const closing = ev.closing ?? ev.impact;
              director.offer(clock, closing < cfg.driver.swipeClosing ? 'driverSwipe' : 'driverHit', 'driver', t.id);
            }
          }
          if (ev.impact >= cfg.stop.crashImpact) {
            const i = stopNear(ev.x, ev.z, cfg.stop.crashRadius);
            if (i >= 0) offerStop(i, 'stopCrash', STOP_CRASH);
          }
          break;
        }
        case 'nearMiss': {
          const t = findById(targets, ev.targetId);
          if (driverInEarshot(t)) director.offer(clock, nearMissTrigger(t, listener.x, listener.z), 'driver', t.id);
          break;
        }
        case 'lightningFired': {
          let i = stopNear(ev.fromX, ev.fromZ, cfg.stop.rayoRadius);
          if (i < 0 && ev.targetId >= 0) i = stopNear(ev.toX, ev.toZ, cfg.stop.rayoRadius);
          if (i >= 0) offerStop(i, 'stopRayo', STOP_RAYO);
          break;
        }
        case 'introCall':
          callOn = ev.phase !== 'ended';
          break;
        case 'introLine':
        case 'passengerLine':
        case 'buhoLine':
        case 'garageLine':
        case 'hustlerLine':
          // Somebody the story cares about is talking (voiced or subtitled): the street waits.
          holdUntil = clock + LINE_HOLD;
          break;
        case 'restart':
          voices.reset();
          break;
        default:
          break;
      }
    },

    gust(g) {
      if (g.target < 0 || g.speed < cfg.driver.fastClosing) return;
      const t = targets[g.target];
      if (driverInEarshot(t)) director.offer(clock, 'driverFast', 'driver', t.id);
    },

    reset() {
      director.reset();
      armed.fill(0);
      holdUntil = -Infinity;
      callOn = false;
      for (const c of chains) {
        c.line = null;
        silence(c, 0.02);
      }
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
    // QA: `__rbAmbient.status()`; `__rbAmbient.say('stopRayo', 'stop', 0)` offers a trigger through the rules.
    (window as unknown as { __rbAmbient?: unknown }).__rbAmbient = {
      status: () => ({
        blockedBy: callOn ? 'call' : clock < holdUntil ? 'storyLine' : deps.blocked() ? 'dialogue/radio/mute' : null,
        loaded: buffers.size,
        onAir: director.onAir,
        pending: director.pending,
        populatedStops: stops.length,
        heard: [...heard],
      }),
      say: (trigger: AmbientTrigger, kind: AmbientSpeakerKind, id: number) => director.offer(clock, trigger, kind, id, 0),
      stop: (i: number) => stops[i] ?? null,
    };
  }

  return voices;
}
