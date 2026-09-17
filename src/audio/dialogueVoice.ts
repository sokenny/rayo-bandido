import { AUDIO, HUSTLERS } from '../config/tuning';
import { distanceGain, stereoPan } from './dsp';

/**
 * Spoken dialogue from the server's text-to-speech (`server/dialogue/speech.mjs`).
 *
 * Fire and forget beside a subtitle: `speakDialogue` never throws and never waits on anything the
 * game needs. The newest request always wins — a clip that arrives after a newer line has been
 * asked for, or after `stopDialogue`, is dropped unheard. BadKala is on the phone, so hers is plain
 * `<audio>`; a line given `at` comes out of whoever says it — attenuated, panned and darkened from
 * the listener every frame (`placeDialogueListener`), so driving off mid-line leaves it on the
 * corner. Playback relies on the page already having had a gesture
 * (the same one that starts the theme); a refused `play()` is simply silence.
 */

/** Mirrors the keys of `CHARACTER_VOICES` in `server/dialogue/voices.mjs`. */
export type DialogueCharacterId = 'badkala' | 'buho' | 'loco-mustang' | 'trapito' | 'villero' | 'travesti' | 'policia' | 'npc-masculino-1' | 'npc-femenino-1';

export interface SpeakDialogueOptions {
  characterId: DialogueCharacterId;
  text: string;
  /** Cut off whatever line is audible when this one is ready. Default: drop this one instead. */
  interrupt?: boolean;
  /** Loudness multiplier. Above 1 goes through a limiter so a boosted line never clips. Default 1. */
  gain?: number;
  /**
   * Where the speaker stands (world m), read again every frame so a walking speaker carries his
   * voice with him. Missing = not in the world: heard at full level, dead centre.
   */
  at?: DialogueEmitter;
}

export interface DialogueEmitter {
  readonly x: number;
  readonly z: number;
}

/** The bits of `HTMLAudioElement` this uses, so tests can hand in a fake. */
export interface VoiceClip {
  play(): Promise<void> | void;
  pause(): void;
  addEventListener(type: 'ended' | 'error' | 'timeupdate', fn: () => void): void;
}

export interface DialogueVoiceDeps {
  request(characterId: DialogueCharacterId, text: string, signal: AbortSignal): Promise<{ audioUrl: string; cached: boolean }>;
  createClip(src: string, gain: number, at?: DialogueEmitter): VoiceClip;
  /** The game's mute (the `M` key). Checked before playing and while playing. */
  isMuted(): boolean;
  /** Music level while a line is audible; restored to 1 after. */
  duckMusic(level: number): void;
  duckLevel: number;
  log?(msg: string): void;
  /** Clock for `maxLateMs`, in ms. Default `performance.now`. */
  now?(): number;
  /**
   * A clip ready later than this after its line was asked for is dropped: the subtitle has moved
   * on, and a line that starts half-way through it only gets cut off. Default `MAX_LATE_MS`.
   */
  maxLateMs?: number;
}

/** Baked clips answer in tens of milliseconds; only a line being generated is ever this late. */
const MAX_LATE_MS = 1500;

export interface DialogueVoice {
  speak(options: SpeakDialogueOptions): Promise<VoiceClip | null>;
  /** Silence everything, or — given a character — only that character's line, pending or audible. */
  stop(characterId?: DialogueCharacterId): void;
  /** A line is audible or on its way. The street's ambient voices hold their tongue meanwhile. */
  speaking(): boolean;
}

export function createDialogueVoice(deps: DialogueVoiceDeps): DialogueVoice {
  const now = deps.now ?? (() => performance.now());
  const maxLateMs = deps.maxLateMs ?? MAX_LATE_MS;
  /** Bumped by every speak and stop; a request only plays if it is still the latest. */
  let session = 0;
  let pending: AbortController | null = null;
  let pendingWho: DialogueCharacterId | null = null;
  let current: VoiceClip | null = null;
  let currentWho: DialogueCharacterId | null = null;

  function silence(): void {
    if (!current) return;
    current.pause();
    current = null;
    currentWho = null;
    deps.duckMusic(1);
  }

  function stop(characterId?: DialogueCharacterId): void {
    if (!characterId || pendingWho === characterId) {
      session++;
      pending?.abort();
      pending = null;
      pendingWho = null;
    }
    if (!characterId || currentWho === characterId) silence();
  }

  async function speak({ characterId, text, interrupt = false, gain = 1, at }: SpeakDialogueOptions): Promise<VoiceClip | null> {
    const mine = ++session;
    pending?.abort();
    const controller = new AbortController();
    pending = controller;
    pendingWho = characterId;
    const asked = now();
    try {
      const { audioUrl, cached } = await deps.request(characterId, text, controller.signal);
      deps.log?.(`[TTS] cache ${cached ? 'hit' : 'miss'}: ${characterId}`);
      if (mine !== session || deps.isMuted()) return null;
      if (now() - asked > maxLateMs) {
        deps.log?.(`[TTS] too late, dropped: ${characterId}`);
        return null;
      }
      if (current) {
        if (!interrupt) return null;
        silence();
      }
      const clip = deps.createClip(audioUrl, gain, at);
      current = clip;
      currentWho = characterId;
      const done = (): void => {
        if (current === clip) silence();
      };
      clip.addEventListener('ended', done);
      clip.addEventListener('error', done);
      clip.addEventListener('timeupdate', () => {
        if (deps.isMuted()) done();
      });
      deps.duckMusic(deps.duckLevel);
      await clip.play();
      return current === clip ? clip : null;
    } catch {
      // Unconfigured, offline, rate-limited, aborted, autoplay refused: the subtitle carries on.
      if (current && mine === session) silence();
      return null;
    } finally {
      if (pending === controller) {
        pending = null;
        pendingWho = null;
      }
    }
  }

  return { speak, stop, speaking: () => current !== null || pending !== null };
}

/* ------------------------------------------------------------------ the game's one voice */

let boostCtx: AudioContext | null = null;

/**
 * An `<audio>` element tops out at volume 1, so a louder line goes element → gain → limiter →
 * speakers on its own small context. Only after the page has had a gesture: an element routed into
 * a context the browser has not let start is silent, and plain unboosted is better than nothing.
 */
function boost(a: HTMLAudioElement, gain: number): void {
  if (typeof AudioContext === 'undefined' || !navigator.userActivation?.hasBeenActive) return;
  try {
    boostCtx ??= new AudioContext();
    if (boostCtx.state !== 'running') void boostCtx.resume();
    const amp = boostCtx.createGain();
    amp.gain.value = gain;
    const limiter = boostCtx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.15;
    boostCtx.createMediaElementSource(a).connect(amp).connect(limiter).connect(boostCtx.destination);
  } catch {
    /* no Web Audio: the line plays at its own level */
  }
}

/* ------------------------------------------------------------------ voices in the world */

/** A line playing from somewhere in the world, re-placed every frame until it stops. */
interface Placed {
  a: HTMLAudioElement;
  at: DialogueEmitter;
  gain: number;
  /** Null when there was no Web Audio to route it through: then only `volume` follows distance. */
  filter: BiquadFilterNode | null;
  amp: GainNode | null;
  pan: StereoPannerNode | null;
}

const placed: Placed[] = [];
let ear: { x: number; z: number; heading: number } | null = null;

function place(p: Placed, smooth: boolean): void {
  const cfg = HUSTLERS.voice;
  const dx = ear ? p.at.x - ear.x : 0;
  const dz = ear ? p.at.z - ear.z : 0;
  const dist = Math.hypot(dx, dz);
  const level = distanceGain(dist, cfg.near, cfg.max);
  if (!p.amp || !p.pan || !p.filter || !boostCtx) {
    p.a.volume = Math.min(1, level * p.gain);
    return;
  }
  const t = boostCtx.currentTime;
  const tc = smooth ? 0.04 : 0.005;
  p.amp.gain.setTargetAtTime(level * p.gain, t, tc);
  p.pan.pan.setTargetAtTime(ear ? stereoPan(dx, dz, ear.heading, AUDIO.maxPan) : 0, t, tc);
  const dark = Math.min(1, dist / cfg.max);
  p.filter.frequency.setTargetAtTime(cfg.brightHz - (cfg.brightHz - cfg.darkHz) * dark, t, tc);
}

/**
 * element → lowpass → gain → pan → limiter → speakers, placed before the first sample so the line
 * starts at the speaker instead of sweeping there. Without Web Audio (or before a gesture) it is
 * the plain element with its volume following distance, which still leaves it behind.
 */
function positional(a: HTMLAudioElement, gain: number, at: DialogueEmitter): void {
  const p: Placed = { a, at, gain, filter: null, amp: null, pan: null };
  if (typeof AudioContext !== 'undefined' && navigator.userActivation?.hasBeenActive) {
    try {
      boostCtx ??= new AudioContext();
      if (boostCtx.state !== 'running') void boostCtx.resume();
      const filter = boostCtx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 0.5;
      const amp = boostCtx.createGain();
      amp.gain.value = 0;
      const pan = boostCtx.createStereoPanner();
      const limiter = boostCtx.createDynamicsCompressor();
      limiter.threshold.value = -3;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.15;
      boostCtx.createMediaElementSource(a).connect(filter).connect(amp).connect(pan).connect(limiter).connect(boostCtx.destination);
      p.filter = filter;
      p.amp = amp;
      p.pan = pan;
    } catch {
      /* no Web Audio: volume only */
    }
  }
  place(p, false);
  placed.push(p);
}

/** Where the player hears from, every frame (`src/game.ts`). Lines placed in the world follow it. */
export function placeDialogueListener(listener: { x: number; z: number; heading: number }): void {
  if (ear) {
    ear.x = listener.x;
    ear.z = listener.z;
    ear.heading = listener.heading;
  } else {
    ear = { x: listener.x, z: listener.z, heading: listener.heading };
  }
  for (let i = placed.length - 1; i >= 0; i--) {
    const p = placed[i];
    if (p.a.paused || p.a.ended) {
      p.filter?.disconnect();
      p.amp?.disconnect();
      p.pan?.disconnect();
      placed.splice(i, 1);
      continue;
    }
    place(p, true);
  }
}

let hooks: Pick<DialogueVoiceDeps, 'isMuted' | 'duckMusic' | 'duckLevel'> = {
  isMuted: () => false,
  duckMusic: () => {},
  duckLevel: 1,
};

const shared = createDialogueVoice({
  async request(characterId, text, signal) {
    const res = await fetch('/api/dialogue/speech', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ characterId, text }),
      signal,
    });
    if (!res.ok) throw new Error(`speech ${res.status}`);
    return (await res.json()) as { audioUrl: string; cached: boolean };
  },
  createClip(src, gain, at) {
    const a = new Audio(src);
    a.preload = 'auto';
    if (at) positional(a, gain, at);
    else if (gain > 1) boost(a, gain);
    return a;
  },
  isMuted: () => hooks.isMuted(),
  duckMusic: (level) => hooks.duckMusic(level),
  get duckLevel() {
    return hooks.duckLevel;
  },
  log: import.meta.env.DEV ? (msg) => console.info(msg) : undefined,
});

/** Tie the voice to the game's mute and music (`src/game.ts`). */
export function configureDialogueVoice(next: typeof hooks): void {
  hooks = next;
}

/** The game's mute and music duck, for voices that play through Web Audio (`audio/policeRadio.ts`). */
export function dialogueHooks(): Pick<DialogueVoiceDeps, 'isMuted' | 'duckMusic'> {
  return hooks;
}

/** The URL of `text` in `characterId`'s voice, generated first if the server has not cached it. */
export async function requestSpeech(characterId: DialogueCharacterId, text: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch('/api/dialogue/speech', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ characterId, text }),
    signal,
  });
  if (!res.ok) throw new Error(`speech ${res.status}`);
  return ((await res.json()) as { audioUrl: string }).audioUrl;
}

/** Whether a dialogue line is audible or being fetched right now. */
export function dialogueSpeaking(): boolean {
  return shared.speaking();
}

export function speakDialogue(options: SpeakDialogueOptions): Promise<VoiceClip | null> {
  return shared.speak(options);
}

/** Lines already warmed this page load, so walking up to someone twice asks nothing twice. */
const prepared = new Set<string>();
let warming: Promise<void> = Promise.resolve();

/**
 * Ask the server to have these lines ready without playing them, so a conversation's first run
 * does not wait on generation line by line. One at a time: it is a warm-up, not a burst.
 */
export function prepareDialogue(characterId: DialogueCharacterId, texts: readonly string[]): Promise<void> {
  const keyOf = (text: string): string => `${characterId}\n${text}`;
  const fresh = texts.filter((text) => !prepared.has(keyOf(text)));
  for (const text of fresh) prepared.add(keyOf(text));
  // Every caller's lines go through one queue: ElevenLabs' free tier allows only a couple of
  // generations at a time, and the lines actually being said need one of them.
  warming = warming.then(async () => {
    for (let i = 0; i < fresh.length; i++) {
      let ok = false;
      try {
        const res = await fetch('/api/dialogue/speech', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ characterId, text: fresh[i] }),
        });
        ok = res.ok;
      } catch {
        /* offline */
      }
      if (!ok) {
        // Unconfigured or refused: the rest would be too. Forget them so a later call can retry.
        for (const text of fresh.slice(i)) prepared.delete(keyOf(text));
        return;
      }
    }
  });
  return warming;
}

/** Everything, or only `characterId`'s line — so one overlay never cuts off another's speaker. */
export function stopDialogue(characterId?: DialogueCharacterId): void {
  shared.stop(characterId);
}
