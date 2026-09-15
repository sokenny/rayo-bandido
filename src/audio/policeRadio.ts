import type { GameEvent, PoliceUnit } from '../core/types';
import { AUDIO, POLICE_RADIO_CONFIG } from '../config/tuning';
import { forwardX, forwardZ } from '../core/math';
import { createShuffleBag, type ShuffleBag } from '../core/shuffleBag';
import { POLICE_RADIO_LINES, type PoliceRadioTrigger } from '../content/policeRadio';
import type { AudioCore } from './core';
import { dialogueHooks, requestSpeech } from './dialogueVoice';
import type { Listener } from './electricHum';
import { fetchSample } from './sample';

/**
 * The chasers on the radio to Central, heard now and then while a pursuit is on.
 *
 * THE VOICE. `policia` is a CLEAN ElevenLabs Instant Voice clone; its exaltada delivery is the TTS
 * settings in `server/dialogue/voices.mjs` (low stability, high style), and the walkie-talkie is
 * this file's FX chain, applied live to every clip: band-pass ~300–3000 Hz with a narrow scoop
 * in the lows and a mid honk, soft-clip saturation, a fast compressor, a static bed and hiss
 * under the voice while the channel is open, and a PTT squelch at each end.
 *
 * THE CACHE. The server generates each line the first time it is asked for and keeps the mp3
 * (`server/dialogue/speech.mjs`, keyed by text and voice settings); this page keeps each decoded
 * clip, so a line said twice asks nothing twice. Nothing is fetched until a line is chosen. No key,
 * no server, no Web Audio: silence, and the chase goes on.
 *
 * THE RULES (`createPoliceRadioDirector`, pure). A moment only makes its category ELIGIBLE;
 * `tryPlay` decides (`POLICE_RADIO_CONFIG`): only during a pursuit, never while a line is being
 * fetched or heard, not inside the global quiet or the category's own cooldown, and then only on a
 * roll of `eventProbability`. A moment that loses is gone — nothing queues. Of several moments in
 * one update the most important gets the roll (`PRIORITY`). Lines come from a shuffle bag per
 * category, so none repeats back to back. The "seguimos atrás" filler is its own timer, one per
 * pursuit, under the same rules.
 */

const CFG = AUDIO.policeRadio;

/** Most important first. */
const PRIORITY: readonly PoliceRadioTrigger[] = [
  'hitPolice',
  'hardCrash',
  'lostSight',
  'repeatedCrash',
  'rayShot',
  'drift',
  'highSpeed',
  'policeClose',
  'activePursuit',
];

/** What the director reads each frame. */
export interface PoliceRadioFrame {
  listener: Listener;
  /** m/s, unsigned. */
  speed: number;
  drifting: boolean;
  units: readonly PoliceUnit[];
}

export interface PoliceRadioBark {
  trigger: PoliceRadioTrigger;
  text: string;
}

export interface PoliceRadioDirectorDeps {
  /**
   * Say `bark`: fetch it, play it. Call `done` once it has finished, failed or been dropped — the
   * radio is busy until then. A `done` from a pursuit that has since ended is ignored.
   */
  transmit(bark: PoliceRadioBark, done: () => void): void;
  /** The police radio is muted: nothing is started. */
  muted?(): boolean;
  random?(): number;
  /** Milliseconds. */
  now?(): number;
  setTimer?(fn: () => void, ms: number): unknown;
  clearTimer?(handle: unknown): void;
  config?: typeof POLICE_RADIO_CONFIG;
}

export interface PoliceRadioDirector {
  onEvent(ev: GameEvent): void;
  /** Held conditions, and the most important moment of this update gets its roll. */
  update(dt: number, frame: PoliceRadioFrame): void;
  /** The one gate: true if a line of `trigger` was chosen and handed to `transmit`. */
  tryPlay(trigger: PoliceRadioTrigger): boolean;
  readonly chasing: boolean;
  /** A line is being fetched or heard. */
  readonly busy: boolean;
  /** A new game session: chase state and the shuffle bags. */
  reset(): void;
}

export function createPoliceRadioDirector(deps: PoliceRadioDirectorDeps): PoliceRadioDirector {
  const random = deps.random ?? Math.random;
  const now = deps.now ?? (() => performance.now());
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const RULES = deps.config ?? POLICE_RADIO_CONFIG;

  const bags = new Map<PoliceRadioTrigger, ShuffleBag<string>>();
  const bagOf = (t: PoliceRadioTrigger): ShuffleBag<string> => {
    let bag = bags.get(t);
    if (!bag) bags.set(t, (bag = createShuffleBag<string>(POLICE_RADIO_LINES[t], random)));
    return bag;
  };

  let chasing = false;
  let busy = false;
  /** Bumped when a pursuit ends: a `done` or a timer from before it is stale. */
  let generation = 0;
  let quietUntil = -Infinity;
  const readyAt = new Map<PoliceRadioTrigger, number>();
  /** When each category's moment was last seen (ms), so a moment held over frames rolls once. */
  const seenAt = new Map<PoliceRadioTrigger, number>();
  /** Moments since the last update, resolved by priority there. Never outlives one update. */
  const candidates = new Set<PoliceRadioTrigger>();
  let ambientTimer: unknown = null;
  let lastShotAt = -Infinity;
  let clock = 0;
  let crashTimes: number[] = [];
  let driftFor = 0;
  let driftSaid = false;
  let fastFor = 0;
  let fastSaid = false;
  let closeSaid = false;

  const between = (min: number, max: number): number => min + random() * (max - min);

  function eligible(t: PoliceRadioTrigger): void {
    const at = now();
    const seen = seenAt.get(t);
    seenAt.set(t, at);
    if (seen !== undefined && at - seen < RULES.sameMomentMs) return;
    candidates.add(t);
  }

  function cancelAmbient(): void {
    if (ambientTimer !== null) clearTimer(ambientTimer);
    ambientTimer = null;
  }

  function scheduleAmbient(): void {
    cancelAmbient();
    const gen = generation;
    ambientTimer = setTimer(
      () => {
        ambientTimer = null;
        if (gen !== generation || !chasing) return;
        // A moment waiting for this update's roll outranks the filler.
        if (candidates.size === 0) tryPlay('activePursuit');
        scheduleAmbient();
      },
      between(RULES.activePursuitIntervalMinMs, RULES.activePursuitIntervalMaxMs),
    );
  }

  function endChase(): void {
    chasing = false;
    generation++;
    busy = false;
    cancelAmbient();
    candidates.clear();
    seenAt.clear();
    readyAt.clear();
    quietUntil = -Infinity;
    crashTimes = [];
  }

  function tryPlay(trigger: PoliceRadioTrigger): boolean {
    if (!chasing || busy || deps.muted?.()) return false;
    const at = now();
    if (at < quietUntil || at < (readyAt.get(trigger) ?? -Infinity)) return false;
    if (random() >= RULES.eventProbability) return false;
    // Accepted: the cooldowns start now, before the voice is fetched.
    quietUntil = at + between(RULES.globalCooldownMinMs, RULES.globalCooldownMaxMs);
    readyAt.set(trigger, at + RULES.categoryCooldownMs);
    busy = true;
    const gen = generation;
    deps.transmit({ trigger, text: bagOf(trigger).next() }, () => {
      if (gen === generation) busy = false;
    });
    return true;
  }

  return {
    get chasing() {
      return chasing;
    },
    get busy() {
      return busy;
    },
    tryPlay,

    onEvent(ev) {
      switch (ev.type) {
        case 'pursuitStart':
          if (!chasing) {
            chasing = true;
            // The bolt that starts a pursuit arrives just before it.
            if (clock - lastShotAt <= CFG.shotStartsPursuit) eligible('rayShot');
            scheduleAmbient();
          }
          break;
        case 'pursuitEnd':
        case 'policeCleared':
        case 'policeBusted':
        case 'restart':
          if (chasing || ambientTimer !== null) endChase();
          break;
        case 'lightningFired':
          lastShotAt = clock;
          if (chasing) eligible('rayShot');
          break;
        case 'policeEscaping':
          if (ev.on && chasing) eligible('lostSight');
          break;
        case 'collision':
          if (chasing && ev.police && ev.impact >= CFG.hitPoliceImpact) eligible('hitPolice');
          break;
        case 'crashDamage':
          if (!chasing) break;
          crashTimes = crashTimes.filter((t) => clock - t < CFG.repeatedWindow);
          crashTimes.push(clock);
          if (crashTimes.length >= CFG.repeatedCount) {
            eligible('repeatedCrash');
            crashTimes = [];
          } else if (ev.severity === 'heavy') {
            eligible('hardCrash');
          }
          break;
        default:
          break;
      }
    },

    update(dt, frame) {
      clock += dt;

      // Held conditions: one moment per spell, re-armed when the spell ends — never a roll per frame.
      driftFor = frame.drifting ? driftFor + dt : 0;
      if (driftFor === 0) driftSaid = false;
      else if (!driftSaid && driftFor >= CFG.driftHold) {
        driftSaid = true;
        if (chasing) eligible('drift');
      }
      fastFor = frame.speed >= CFG.highSpeed ? fastFor + dt : 0;
      if (fastFor === 0) fastSaid = false;
      else if (!fastSaid && fastFor >= CFG.highSpeedHold) {
        fastSaid = true;
        if (chasing) eligible('highSpeed');
      }
      if (chasing) {
        const { x, z, heading } = frame.listener;
        const fx = forwardX(heading);
        const fz = forwardZ(heading);
        let close = false;
        for (let i = 0; i < frame.units.length; i++) {
          const u = frame.units[i];
          if (u.status !== 'active' || u.role !== 'pursuit' || !u.sight) continue;
          const dx = u.x - x;
          const dz = u.z - z;
          // Behind the car: from the chaser's seat, the car is "pegado adelante".
          if (dx * dx + dz * dz <= CFG.closeDistance * CFG.closeDistance && dx * fx + dz * fz < 0) {
            close = true;
            break;
          }
        }
        if (!close) closeSaid = false;
        else if (!closeSaid) {
          closeSaid = true;
          eligible('policeClose');
        }
      } else {
        closeSaid = false;
      }

      if (candidates.size === 0) return;
      // The most important moment not on its own cooldown gets the one roll; the rest are gone.
      const at = now();
      for (const trigger of PRIORITY) {
        if (!candidates.has(trigger) || at < (readyAt.get(trigger) ?? -Infinity)) continue;
        tryPlay(trigger);
        break;
      }
      candidates.clear();
    },

    reset() {
      endChase();
      for (const bag of bags.values()) bag.reset();
      lastShotAt = -Infinity;
      driftFor = fastFor = 0;
      driftSaid = fastSaid = closeSaid = false;
    },
  };
}

/* ------------------------------------------------------------------ the radio itself */

export interface PoliceRadio {
  onEvent(ev: GameEvent): void;
  update(dt: number, frame: PoliceRadioFrame): void;
  reset(): void;
  dispose(): void;
}

/** Seconds of squelch before the voice, and of channel after it. */
const PTT_LEAD = 0.12;
const PTT_TAIL = 0.22;

function softClipCurve(drive: number) {
  const n = 1024;
  const curve = new Float32Array(n);
  const norm = Math.tanh(drive);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(drive * x) / norm;
  }
  return curve;
}

export function createPoliceRadio(core: AudioCore): PoliceRadio {
  const { ctx, master, noise } = core;
  const director = createPoliceRadioDirector({ transmit, muted: () => dialogueHooks().isMuted() });

  /* ----- the `police_radio` bus: built once, idle silent */
  const bus = ctx.createGain(); // everything that goes through the radio enters here
  const highpass = ctx.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = 300;
  highpass.Q.value = 0.8;
  const scoop = ctx.createBiquadFilter(); // narrow dip in the lows: thin, not boomy
  scoop.type = 'peaking';
  scoop.frequency.value = 420;
  scoop.Q.value = 2.2;
  scoop.gain.value = -5;
  const honk = ctx.createBiquadFilter(); // the walkie's nasal mid
  honk.type = 'peaking';
  honk.frequency.value = 1700;
  honk.Q.value = 1.1;
  honk.gain.value = 5;
  const lowpass = ctx.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = 3000;
  lowpass.Q.value = 0.9;
  const drive = ctx.createGain();
  drive.gain.value = 2.2;
  const shaper = ctx.createWaveShaper();
  shaper.curve = softClipCurve(2.4);
  shaper.oversample = '2x';
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -22;
  comp.knee.value = 4;
  comp.ratio.value = 6;
  comp.attack.value = 0.002;
  comp.release.value = 0.12;
  const out = ctx.createGain();
  out.gain.value = CFG.voiceVolume;
  bus.connect(highpass).connect(scoop).connect(honk).connect(lowpass).connect(drive).connect(shaper).connect(comp).connect(out).connect(master);

  // The static bed goes through the radio (band-limited and squashed with the voice); the hiss
  // sits on top of it, brighter. One looping noise source feeds both, silent while the channel is shut.
  const noiseSrc = ctx.createBufferSource();
  noiseSrc.buffer = noise;
  noiseSrc.loop = true;
  const staticGain = ctx.createGain();
  staticGain.gain.value = 0;
  noiseSrc.connect(staticGain).connect(bus);
  const hissFilter = ctx.createBiquadFilter();
  hissFilter.type = 'highpass';
  hissFilter.frequency.value = 4500;
  const hissGain = ctx.createGain();
  hissGain.gain.value = 0;
  noiseSrc.connect(hissFilter).connect(hissGain).connect(out);
  // A squelch burst: the same noise, gated hard for a few milliseconds.
  const squelchGain = ctx.createGain();
  squelchGain.gain.value = 0;
  noiseSrc.connect(squelchGain).connect(bus);
  noiseSrc.start();

  /* ----- the clips */
  /** Decoded clips by exact text: a line said before asks the server nothing. */
  const buffers = new Map<string, AudioBuffer>();
  /** Bumped by `stop`: a clip that arrives for an older transmission is dropped unheard. */
  let session = 0;
  let pending: AbortController | null = null;
  /** The director's `done` for the transmission on air. */
  let onDone: (() => void) | null = null;

  /** Fetch (generating on first use) and play `bark`; `done` once it is over, failed or dropped. */
  async function transmit(bark: PoliceRadioBark, done: () => void): Promise<void> {
    const mine = session;
    const controller = new AbortController();
    pending = controller;
    try {
      let buffer = buffers.get(bark.text);
      if (!buffer) {
        const url = await requestSpeech('policia', bark.text, controller.signal);
        buffer = await fetchSample(ctx, url);
        buffers.set(bark.text, buffer);
      }
      if (mine === session && play(buffer, done)) {
        if (import.meta.env.DEV) barks.push(bark.trigger);
        return;
      }
      done();
    } catch {
      // Unconfigured, offline, rate-limited, aborted or undecodable: no line, the chase goes on.
      done();
    } finally {
      if (pending === controller) pending = null;
    }
  }

  function squelch(at: number, level: number): void {
    const g = squelchGain.gain;
    g.setValueAtTime(0, at);
    g.linearRampToValueAtTime(level, at + 0.004);
    g.setValueAtTime(level, at + 0.05);
    g.linearRampToValueAtTime(0, at + 0.07);
  }

  function beep(at: number, freq: number): void {
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(0.08, at + 0.005);
    g.gain.setValueAtTime(0.08, at + 0.055);
    g.gain.linearRampToValueAtTime(0, at + 0.065);
    osc.connect(g).connect(bus);
    osc.start(at);
    osc.stop(at + 0.08);
    osc.onended = () => g.disconnect();
  }

  const barks: PoliceRadioTrigger[] = [];
  let voice: AudioBufferSourceNode | null = null;
  let endTimer: ReturnType<typeof setTimeout> | null = null;

  function closeChannel(): void {
    const t = ctx.currentTime;
    for (const g of [staticGain.gain, hissGain.gain]) {
      g.cancelScheduledValues(t);
      g.setTargetAtTime(0, t, 0.03);
    }
  }

  function finish(): void {
    if (endTimer) clearTimeout(endTimer);
    endTimer = null;
    voice = null;
    closeChannel();
    dialogueHooks().duckMusic(1);
    const done = onDone;
    onDone = null;
    done?.();
  }

  /** True if the line is playing; `done` is called when it has finished. */
  function play(buffer: AudioBuffer, done: () => void): boolean {
    if (voice || ctx.state !== 'running' || dialogueHooks().isMuted()) return false;
    onDone = done;
    const t = ctx.currentTime;
    const start = t + PTT_LEAD;
    const end = start + buffer.duration;

    // Key up: click, squelch, the channel opens.
    beep(t, 1250);
    squelch(t + 0.02, 0.5);
    for (const [g, level] of [
      [staticGain.gain, CFG.staticVolume],
      [hissGain.gain, CFG.staticVolume * 0.35],
    ] as const) {
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(level, t + 0.03);
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(bus);
    src.start(start);
    voice = src;
    // Key down: the squelch tail and the roger beep, then the channel shuts.
    squelch(end + 0.02, 0.6);
    beep(end + 0.1, 950);
    src.onended = () => {
      if (voice !== src) return;
      // `onended` fires as the voice stops; the tail is still to come.
      endTimer = setTimeout(finish, PTT_TAIL * 1000);
    };
    dialogueHooks().duckMusic(CFG.musicDuck);
    return true;
  }

  function stop(): void {
    session++;
    pending?.abort();
    pending = null;
    if (!voice) return;
    const src = voice;
    voice = null;
    try {
      src.stop();
    } catch {
      /* not started */
    }
    src.disconnect();
    squelchGain.gain.cancelScheduledValues(ctx.currentTime);
    squelchGain.gain.setValueAtTime(0, ctx.currentTime);
    finish();
  }

  const radio: PoliceRadio = {
    onEvent(ev) {
      director.onEvent(ev);
      // The arrest, the escape or an activity ends the chase: nobody is on the radio after it, and
      // a line still being fetched is dropped.
      if (ev.type === 'pursuitEnd' || ev.type === 'policeCleared' || ev.type === 'restart') stop();
    },

    update(dt, frame) {
      director.update(dt, frame);
      // The mute (M) cuts a bark off mid-line.
      if (voice && dialogueHooks().isMuted()) stop();
    },

    reset() {
      stop();
      director.reset();
    },

    dispose() {
      stop();
      try {
        noiseSrc.stop();
      } catch {
        /* already stopped */
      }
      noiseSrc.disconnect();
      out.disconnect();
    },
  };

  if (import.meta.env.DEV) {
    // QA: `__rbRadio.say('drift', 1)` fetches and plays that line now, bypassing the rules;
    // `__rbRadio.try('drift')` goes through them; `__rbRadio.barks()` lists what was heard.
    (window as unknown as { __rbRadio?: unknown }).__rbRadio = {
      loaded: () => buffers.size,
      barks: () => [...barks],
      say: (trigger: PoliceRadioTrigger, i = 0) => void transmit({ trigger, text: POLICE_RADIO_LINES[trigger][i] }, () => {}),
      try: (trigger: PoliceRadioTrigger) => director.tryPlay(trigger),
    };
  }

  return radio;
}
