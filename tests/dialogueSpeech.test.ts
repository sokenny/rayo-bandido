import { describe, expect, it, vi } from 'vitest';
import { createDialogueVoice, type VoiceClip } from '../src/audio/dialogueVoice';

/**
 * Text-to-speech proof of concept: the server's cache key and cache (`server/dialogue/speech.mjs`)
 * and the client's rule that a late clip never talks over a newer line (`src/audio/dialogueVoice.ts`).
 */

interface SpeechModule {
  speechCacheKey(input: { normalizedText: string; characterId: string; voice: Record<string, unknown> }): string;
  normalizeText(text: unknown): string;
  createDialogueSpeech(opts: Record<string, unknown>): {
    synthesize(characterId: unknown, text: unknown): Promise<{ audioUrl: string; cached: boolean }>;
  };
}
// Plain `.mjs` under Node: imported by URL so the type checker does not go looking for its types.
const speechUrl = new URL('../server/dialogue/speech.mjs', import.meta.url).href;
const loadSpeech = (): Promise<SpeechModule> => import(/* @vite-ignore */ speechUrl) as Promise<SpeechModule>;

const voice = {
  voiceId: 'v1',
  modelId: 'eleven_flash_v2_5',
  outputFormat: 'mp3_44100_128',
  voiceSettings: { stability: 0.4, similarityBoost: 0.8, style: 0.25, useSpeakerBoost: true, speed: 1 },
  version: 1,
};

function memoryCache() {
  const files = new Map<string, Buffer>();
  return {
    files,
    has: async (k: string) => files.has(k),
    get: async (k: string) => files.get(k) ?? null,
    put: async (k: string, b: Buffer) => void files.set(k, b),
  };
}

const env = { ELEVENLABS_API_KEY: 'test-key', NODE_ENV: 'test' };
const audioResponse = () => new Response(new Uint8Array([1, 2, 3]), { status: 200 });

describe('speech cache key', () => {
  it('is stable across key order and changes with anything that shapes the audio', async () => {
    const { speechCacheKey, normalizeText } = await loadSpeech();
    const text = normalizeText('  Mirá quién   decidió\nvolver al radar. ');
    expect(text).toBe('Mirá quién decidió volver al radar.');
    const a = speechCacheKey({ normalizedText: text, characterId: 'badkala', voice });
    const reordered = { ...voice, voiceSettings: { speed: 1, style: 0.25, useSpeakerBoost: true, similarityBoost: 0.8, stability: 0.4 } };
    expect(speechCacheKey({ normalizedText: text, characterId: 'badkala', voice: reordered })).toBe(a);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(speechCacheKey({ normalizedText: `${text}!`, characterId: 'badkala', voice })).not.toBe(a);
    expect(speechCacheKey({ normalizedText: text, characterId: 'badkala', voice: { ...voice, version: 2 } })).not.toBe(a);
  });
});

describe('dialogue speech service', () => {
  it('generates once, then serves the cache without calling ElevenLabs', async () => {
    const { createDialogueSpeech } = await loadSpeech();
    const fetchImpl = vi.fn(async () => audioResponse());
    const cache = memoryCache();
    const speech = createDialogueSpeech({ env, generate: true, cache, fetchImpl });

    const first = await speech.synthesize('badkala', 'Mirá quién decidió volver al radar.');
    expect(first.cached).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/iHaDFejiMLsI0XjCnQVt?output_format=mp3_44100_128');
    expect(JSON.parse(init.body as string)).toMatchObject({ model_id: 'eleven_v3', language_code: 'es' });
    expect((init.headers as Record<string, string>)['xi-api-key']).toBe('test-key');

    const second = await speech.synthesize('badkala', ' Mirá quién decidió  volver al radar.');
    expect(second).toEqual({ ...first, cached: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('shares one generation between concurrent identical requests', async () => {
    const { createDialogueSpeech } = await loadSpeech();
    const fetchImpl = vi.fn(async () => audioResponse());
    const speech = createDialogueSpeech({ env, generate: true, cache: memoryCache(), fetchImpl });
    await Promise.all([speech.synthesize('badkala', 'Hola.'), speech.synthesize('badkala', 'Hola.')]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('never calls ElevenLabs unless generation is switched on: a missing line is a 404', async () => {
    const { createDialogueSpeech } = await loadSpeech();
    const fetchImpl = vi.fn(async () => audioResponse());
    const speech = createDialogueSpeech({ env, cache: memoryCache(), fetchImpl });
    await expect(speech.synthesize('badkala', 'Hola.')).rejects.toMatchObject({ status: 404 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('serves a baked clip ahead of the runtime cache, and writes only to the runtime one', async () => {
    const { createDialogueSpeech, layeredSpeechCache } = (await loadSpeech()) as SpeechModule & {
      layeredSpeechCache(layers: ReturnType<typeof memoryCache>[]): ReturnType<typeof memoryCache>;
    };
    const baked = memoryCache();
    const runtime = memoryCache();
    const fetchImpl = vi.fn(async () => audioResponse());
    const speech = createDialogueSpeech({ env, generate: true, cache: layeredSpeechCache([baked, runtime]), fetchImpl });
    const first = await speech.synthesize('badkala', 'Hola.');
    expect(runtime.files.size).toBe(1);
    expect(baked.files.size).toBe(0);
    runtime.files.clear();
    baked.files.set((first as unknown as { audioUrl: string }).audioUrl.slice(20, -4), Buffer.from([9]));
    expect(await speech.synthesize('badkala', 'Hola.')).toMatchObject({ cached: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects unknown characters, empty and overlong text before calling out', async () => {
    const { createDialogueSpeech } = await loadSpeech();
    const fetchImpl = vi.fn(async () => audioResponse());
    const speech = createDialogueSpeech({ env, generate: true, cache: memoryCache(), fetchImpl });
    await expect(speech.synthesize('nobody', 'Hola.')).rejects.toMatchObject({ status: 400 });
    await expect(speech.synthesize('__proto__', 'Hola.')).rejects.toMatchObject({ status: 400 });
    await expect(speech.synthesize('badkala', '   ')).rejects.toMatchObject({ status: 400 });
    await expect(speech.synthesize('badkala', 'x'.repeat(501))).rejects.toMatchObject({ status: 400 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('dialogue voice (client)', () => {
  it('never plays a clip that arrives after a newer line started', async () => {
    const resolvers = new Map<string, (v: { audioUrl: string; cached: boolean }) => void>();
    const played: string[] = [];
    const voiceOut = createDialogueVoice({
      request: (_c, text) => new Promise((resolve) => resolvers.set(text, resolve)),
      createClip: (src): VoiceClip => ({
        play: () => void played.push(src),
        pause: () => {},
        addEventListener: () => {},
      }),
      isMuted: () => false,
      duckMusic: () => {},
      duckLevel: 0.5,
    });

    const old = voiceOut.speak({ characterId: 'badkala', text: 'old', interrupt: true });
    const fresh = voiceOut.speak({ characterId: 'badkala', text: 'new', interrupt: true });
    resolvers.get('new')!({ audioUrl: '/new.mp3', cached: true });
    expect(await fresh).not.toBeNull();
    resolvers.get('old')!({ audioUrl: '/old.mp3', cached: false });
    expect(await old).toBeNull();
    expect(played).toEqual(['/new.mp3']);
  });

  it('drops a clip that is ready too late to go with its subtitle', async () => {
    let t = 0;
    const played: string[] = [];
    const voiceOut = createDialogueVoice({
      request: async (_c, text) => {
        t += text === 'slow' ? 4000 : 50;
        return { audioUrl: `/${text}.mp3`, cached: false };
      },
      createClip: (src): VoiceClip => ({ play: () => void played.push(src), pause: () => {}, addEventListener: () => {} }),
      isMuted: () => false,
      duckMusic: () => {},
      duckLevel: 0.5,
      now: () => t,
    });
    expect(await voiceOut.speak({ characterId: 'badkala', text: 'slow', interrupt: true })).toBeNull();
    expect(await voiceOut.speak({ characterId: 'badkala', text: 'fast', interrupt: true })).not.toBeNull();
    expect(played).toEqual(['/fast.mp3']);
  });

  it("stopping one character leaves another's line playing", async () => {
    const paused: string[] = [];
    const voiceOut = createDialogueVoice({
      request: async (_c, text) => ({ audioUrl: `/${text}.mp3`, cached: true }),
      createClip: (src): VoiceClip => ({ play: () => {}, pause: () => void paused.push(src), addEventListener: () => {} }),
      isMuted: () => false,
      duckMusic: () => {},
      duckLevel: 0.5,
    });
    expect(await voiceOut.speak({ characterId: 'trapito', text: 'pa' })).not.toBeNull();
    voiceOut.stop('buho');
    expect(paused).toEqual([]);
    voiceOut.stop('trapito');
    expect(paused).toEqual(['/pa.mp3']);
  });

  it('stays silent when muted or stopped before the clip is ready', async () => {
    let muted = true;
    const played: string[] = [];
    const voiceOut = createDialogueVoice({
      request: async () => ({ audioUrl: '/a.mp3', cached: true }),
      createClip: (src): VoiceClip => ({ play: () => void played.push(src), pause: () => {}, addEventListener: () => {} }),
      isMuted: () => muted,
      duckMusic: () => {},
      duckLevel: 0.5,
    });
    expect(await voiceOut.speak({ characterId: 'badkala', text: 'a' })).toBeNull();
    muted = false;
    const stopped = voiceOut.speak({ characterId: 'badkala', text: 'a' });
    voiceOut.stop();
    expect(await stopped).toBeNull();
    expect(played).toEqual([]);
  });
});
