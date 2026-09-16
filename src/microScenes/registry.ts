/**
 * THE CATALOGUE. Every micro-scene the game knows about, in one list.
 *
 * This is the ONLY file a new scene touches besides its own: write the definition, import it here,
 * add it to the array. The director, the renderer, the audio, the debug tools, the voice generator
 * and `SCENE_CATALOG.md` are all downstream of this array and none of them needs editing.
 *
 * Explicit `.ts` extensions so Node can load this straight (`scripts/scene-catalog.mjs`,
 * `scripts/generate-scene-voices.mjs`); Vite and TypeScript both accept them.
 */

import type { MicroSceneDefinition, DialogueLine, DialogueVariant, SharedBehaviorId } from './types';
import { BRIDGE_BODY_DISPOSAL } from './scenes/bridgeBodyDisposal.ts';
import { BRIDGE_SMOKE_CIRCLE } from './scenes/bridgeSmokeCircle.ts';
import { BROKEN_COMBUSTION_CAR } from './scenes/brokenCombustionCar.ts';
import { BUS_STOP_CONVERSATION } from './scenes/busStopConversation.ts';
import { DOUBLE_PARKING_ARGUMENT } from './scenes/doubleParkingArgument.ts';
import { EMISSIONS_CHECKPOINT } from './scenes/emissionsCheckpoint.ts';
import { ILLEGAL_PARTS_STAND } from './scenes/illegalPartsStand.ts';
import { TUNED_CAR_PHOTOGRAPHERS } from './scenes/tunedCarPhotographers.ts';

export const MICRO_SCENES: readonly MicroSceneDefinition[] = [
  BUS_STOP_CONVERSATION,
  BROKEN_COMBUSTION_CAR,
  EMISSIONS_CHECKPOINT,
  DOUBLE_PARKING_ARGUMENT,
  ILLEGAL_PARTS_STAND,
  TUNED_CAR_PHOTOGRAPHERS,
  BRIDGE_SMOKE_CIRCLE,
  BRIDGE_BODY_DISPOSAL,
];

const BY_ID = new Map<string, MicroSceneDefinition>(MICRO_SCENES.map((s) => [s.id, s]));

export function microScene(id: string): MicroSceneDefinition | null {
  return BY_ID.get(id) ?? null;
}

/** Index of a scene in the catalogue, or -1. What the runtime stores instead of a string. */
export function microSceneIndex(id: string): number {
  return MICRO_SCENES.findIndex((s) => s.id === id);
}

/* ================================================================== derived views */

/** Every dialogue line in a scene, ambient and reactions together. What the generator renders. */
export function sceneLines(scene: MicroSceneDefinition): DialogueLine[] {
  const out: DialogueLine[] = [];
  for (const v of scene.dialogueVariants) out.push(...v.lines);
  for (const r of scene.reactions ?? []) out.push(...(r.lines ?? []));
  return out;
}

/** Every line in the whole catalogue, tagged with the scene it belongs to. */
export function allSceneLines(): Array<{ scene: MicroSceneDefinition; line: DialogueLine }> {
  const out: Array<{ scene: MicroSceneDefinition; line: DialogueLine }> = [];
  for (const scene of MICRO_SCENES) for (const line of sceneLines(scene)) out.push({ scene, line });
  return out;
}

/** Which actor definition a line belongs to, so its voice can be resolved. */
export function lineVoice(scene: MicroSceneDefinition, line: DialogueLine): string | null {
  if (line.voice) return line.voice;
  return scene.actors.find((a) => a.id === line.speaker)?.voice ?? null;
}

/** Every shared behaviour a scene uses, actors and reactions and its own list together. */
export function sceneBehaviors(scene: MicroSceneDefinition): SharedBehaviorId[] {
  const seen = new Set<SharedBehaviorId>(scene.sharedBehaviors);
  for (const a of scene.actors) for (const b of a.behaviors) seen.add(b);
  for (const r of scene.reactions ?? []) for (const b of r.behaviors) seen.add(b);
  for (const b of scene.ambientSequence) if (b.behavior) seen.add(b.behavior);
  return [...seen];
}

/** Which actors stand there for a variant: the ones it names, or everyone not marked `alternate`. */
export function presentActors(scene: MicroSceneDefinition, variant: DialogueVariant | null): string[] {
  if (variant?.present) return [...variant.present];
  return scene.actors.filter((a) => !a.alternate).map((a) => a.id);
}

/** How many scenes each shared behaviour is used by. The answer to "which of these earn their keep". */
export function behaviorUsage(): Map<SharedBehaviorId, string[]> {
  const out = new Map<SharedBehaviorId, string[]>();
  for (const scene of MICRO_SCENES) {
    for (const b of sceneBehaviors(scene)) {
      const list = out.get(b);
      if (list) list.push(scene.id);
      else out.set(b, [scene.id]);
    }
  }
  return out;
}

/** Roughly what a scene costs: actors, animated actors, props and particles. For the catalogue. */
export function sceneCost(scene: MicroSceneDefinition): number {
  const b = scene.performanceBudget;
  return b.maxActors * 2 + b.maxAnimatedActors * 3 + scene.props.length + b.maxParticles / 8;
}
