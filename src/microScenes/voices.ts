/**
 * WHO SAYS A MICRO-SCENE LINE, and in whose voice.
 *
 * A profile is a level of indirection between an actor and a recording. The point of it is the
 * case where the recording does not exist yet: a profile with no `characterId` still carries its
 * speaker assignments, the lines that need it stay written down in the scene, the generator
 * refuses to render them, and the director refuses to select the variant. Nothing is quietly
 * voiced by the wrong person, and nothing else in the system waits on it.
 *
 * `fallback` is for placeholders that are HONEST ones: two men in the same conversation share the
 * one male voice we have, pitched apart so they are still two people. A female part has no
 * male stand-in on purpose — the male placeholder would be worse than silence, and the flag in
 * `validate.ts` is how it stays visible instead of being forgotten.
 *
 * Clips are static files under `public/npc-voice/scenes/`, rendered once by
 * `scripts/generate-scene-voices.mjs`. Nothing here reaches the voice API at runtime.
 *
 * No runtime imports on purpose: the generator loads this file straight into Node.
 */

import type { VoiceProfileId } from './types';

export interface VoiceProfile {
  id: VoiceProfileId;
  label: string;
  /** Which speaker they present as, for casting and for the missing-voice report. */
  presenting: 'masculine' | 'feminine';
  /**
   * The `CHARACTER_VOICES` key in `server/dialogue/voices.mjs`, or null when this profile has no
   * voice of its own yet.
   */
  characterId: string | null;
  /**
   * Which configured profile stands in while `characterId` is null. Null means nobody does: the
   * lines are not generated and the variants that need them do not play.
   */
  fallback: VoiceProfileId | null;
  /** Playback rate the clips are played back at, so a shared voice is still two people. */
  rate: number;
  /** Loudness multiplier over `MICRO_SCENES.audio.volume`. */
  gain: number;
  /** Delivery direction prefixed to every line of theirs (an audio tag, performed, not read). */
  direction: string;
}

export const VOICE_PROFILES: Record<VoiceProfileId, VoiceProfile> = {
  'npc-masculino-1': {
    id: 'npc-masculino-1',
    label: 'Hombre 1',
    presenting: 'masculine',
    characterId: 'npc-masculino-1',
    fallback: null,
    rate: 1,
    gain: 1,
    direction: '[conversational]',
  },
  'npc-masculino-2': {
    id: 'npc-masculino-2',
    label: 'Hombre 2',
    presenting: 'masculine',
    // No second male clone yet. Voiced by the first, a little lower and slower, so the two
    // sides of a conversation are still two people rather than one man answering himself.
    characterId: null,
    fallback: 'npc-masculino-1',
    rate: 0.93,
    gain: 1,
    direction: '[conversational]',
  },
  'npc-femenina-1': {
    id: 'npc-femenina-1',
    label: 'Mujer 1',
    presenting: 'feminine',
    characterId: 'npc-femenino-1',
    fallback: null,
    rate: 1,
    gain: 1,
    direction: '[conversational]',
  },
  'npc-femenina-2': {
    id: 'npc-femenina-2',
    label: 'Mujer 2',
    presenting: 'feminine',
    // One female clone so far. The friend is voiced by it a little lower and slower, the same
    // honest placeholder the second man gets — and never by a male voice.
    characterId: null,
    fallback: 'npc-femenina-1',
    rate: 0.92,
    gain: 1,
    direction: '[conversational]',
  },
  'npc-policia-1': {
    id: 'npc-policia-1',
    label: 'Oficial de tránsito',
    presenting: 'masculine',
    // The `policia` clone in the server is the radio voice, deliberately exaltada; an officer
    // standing at a checkpoint is bored, not shouting. Until there is a clone for that, the
    // street's own voice does it, slowed a shade into officialdom.
    characterId: null,
    fallback: 'npc-masculino-1',
    rate: 0.9,
    gain: 1,
    direction: '[flat, bureaucratic]',
  },
};

/** The voice a profile is actually heard in, following one fallback. Null when nobody voices it. */
export function resolvedVoice(id: VoiceProfileId): VoiceProfile | null {
  const profile = VOICE_PROFILES[id];
  if (!profile) return null;
  if (profile.characterId) return profile;
  if (!profile.fallback) return null;
  const stand = VOICE_PROFILES[profile.fallback];
  return stand && stand.characterId ? stand : null;
}

/** Whether a line in this profile can be heard at all: it has a voice, its own or a stand-in. */
export function voiceConfigured(id: VoiceProfileId): boolean {
  return resolvedVoice(id) !== null;
}

/** Profiles with no voice and no stand-in. What development has to be told about. */
export function unvoicedProfiles(): VoiceProfile[] {
  return Object.values(VOICE_PROFILES).filter((p) => !voiceConfigured(p.id));
}

/** Where a clip lives once it has been rendered. */
export function sceneClipUrl(clip: string): string {
  return `/npc-voice/scenes/${clip}.mp3`;
}
