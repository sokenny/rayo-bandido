/**
 * Spoken dialogue from the server's text-to-speech (`server/dialogue/speech.mjs`).
 *
 * Fire and forget beside a subtitle: `speakDialogue` never throws and never waits on anything the
 * game needs. The newest request always wins — a clip that arrives after a newer line has been
 * asked for, or after `stopDialogue`, is dropped unheard. Plain non-positional `<audio>`: BadKala
 * is on the phone, not in the street. Playback relies on the page already having had a gesture
 * (the same one that starts the theme); a refused `play()` is simply silence.
 */

/** Mirrors the keys of `characterVoices` in `server/dialogue/voices.mjs`. */
export type DialogueCharacterId = 'badkala';

export interface SpeakDialogueOptions {
  characterId: DialogueCharacterId;
  text: string;
  /** Cut off whatever line is audible when this one is ready. Default: drop this one instead. */
  interrupt?: boolean;
}

/** The bits of `HTMLAudioElement` this uses, so tests can hand in a fake. */
export interface VoiceClip {
  play(): Promise<void> | void;
  pause(): void;
  addEventListener(type: 'ended' | 'error' | 'timeupdate', fn: () => void): void;
}

export interface DialogueVoiceDeps {
  request(characterId: DialogueCharacterId, text: string, signal: AbortSignal): Promise<{ audioUrl: string; cached: boolean }>;
  createClip(src: string): VoiceClip;
  /** The game's mute (the `M` key). Checked before playing and while playing. */
  isMuted(): boolean;
  /** Music level while a line is audible; restored to 1 after. */
  duckMusic(level: number): void;
  duckLevel: number;
  log?(msg: string): void;
}

export interface DialogueVoice {
  speak(options: SpeakDialogueOptions): Promise<VoiceClip | null>;
  stop(): void;
}

export function createDialogueVoice(deps: DialogueVoiceDeps): DialogueVoice {
  /** Bumped by every speak and stop; a request only plays if it is still the latest. */
  let session = 0;
  let pending: AbortController | null = null;
  let current: VoiceClip | null = null;

  function silence(): void {
    if (!current) return;
    current.pause();
    current = null;
    deps.duckMusic(1);
  }

  function stop(): void {
    session++;
    pending?.abort();
    pending = null;
    silence();
  }

  async function speak({ characterId, text, interrupt = false }: SpeakDialogueOptions): Promise<VoiceClip | null> {
    const mine = ++session;
    pending?.abort();
    const controller = new AbortController();
    pending = controller;
    try {
      const { audioUrl, cached } = await deps.request(characterId, text, controller.signal);
      deps.log?.(`[TTS] cache ${cached ? 'hit' : 'miss'}: ${characterId}`);
      if (mine !== session || deps.isMuted()) return null;
      if (current) {
        if (!interrupt) return null;
        silence();
      }
      const clip = deps.createClip(audioUrl);
      current = clip;
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
      if (pending === controller) pending = null;
    }
  }

  return { speak, stop };
}

/* ------------------------------------------------------------------ the game's one voice */

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
  createClip(src) {
    const a = new Audio(src);
    a.preload = 'auto';
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

export function speakDialogue(options: SpeakDialogueOptions): Promise<VoiceClip | null> {
  return shared.speak(options);
}

/**
 * Ask the server to have these lines ready without playing them, so a conversation's first run
 * does not wait on generation line by line. One at a time: it is a warm-up, not a burst.
 */
export async function prepareDialogue(characterId: DialogueCharacterId, texts: readonly string[]): Promise<void> {
  for (const text of texts) {
    try {
      const res = await fetch('/api/dialogue/speech', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ characterId, text }),
      });
      // Unconfigured or refused: every other line will be too, so stop asking.
      if (!res.ok) return;
    } catch {
      return;
    }
  }
}

export function stopDialogue(): void {
  shared.stop();
}
