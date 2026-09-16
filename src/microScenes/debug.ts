import type { GameEvent } from '../core/types';
import { MICRO_SCENES as CFG } from '../config/tuning';
import { SHARED_BEHAVIORS, SHARED_BEHAVIOR_IDS } from './behaviors';
import { MICRO_SCENES, behaviorUsage, microScene, sceneBehaviors, sceneCost, sceneLines } from './registry';
import type { MicroSceneRuntime } from './runtime/director';
import { clearMicroScenes, requestMicroScene, sceneWeightAt } from './runtime/director';
import type { MicroSceneAnchor, MicroSceneDefinition } from './types';
import { validateAnchors, validateCatalog } from './validate';
import { resolvedVoice, unvoicedProfiles, VOICE_PROFILES } from './voices';

/**
 * AUTHORING AND QA CONTROLS. Development only — `src/game.ts` hangs this off `__rb.microScenes`
 * inside an `import.meta.env.DEV` guard, so nothing here reaches a player and nothing here is a
 * piece of UI. It is a console, and it answers the questions that are otherwise a long drive:
 *
 *   __rb.microScenes.list()                    every scene, with its anchors, cast and cost
 *   __rb.microScenes.filter('police')          by tag or category
 *   __rb.microScenes.spawn('bridge-smoke-circle')          force one up at the nearest anchor
 *   __rb.microScenes.spawn('bus-stop-conversation', null, 'cheating-boyfriend')  and pick a variant
 *   __rb.microScenes.anchors('under-bridge')   where that kind of place is
 *   __rb.microScenes.radii('bus-stop-conversation')        spawn / activate / dialogue / despawn
 *   __rb.microScenes.status()                  what is standing, in what state, at what cost
 *   __rb.microScenes.police(true)              pretend a patrol is beside every scene
 *   __rb.microScenes.observe(true)             pretend the player is sitting there watching
 *   __rb.microScenes.pass()                    pretend the player has just blown past
 *   __rb.microScenes.cooldowns(false)          stop waiting between appearances
 *   __rb.microScenes.clear()                   take everything down
 *   __rb.microScenes.validate()                every complaint the catalogue has about itself
 *   __rb.microScenes.voices()                  which parts have a recording and which do not
 */

export interface MicroSceneDebugDeps {
  runtime: () => MicroSceneRuntime | null;
  anchors: () => readonly MicroSceneAnchor[];
  /** The game's event list for this tick, so a forced change is seen by the audio and the art. */
  events: () => GameEvent[];
  /** Where the car is, for "the nearest anchor" and for the simulated player reactions. */
  player: () => { x: number; z: number };
}

function summarise(scene: MicroSceneDefinition): Record<string, unknown> {
  const behaviors = sceneBehaviors(scene);
  return {
    id: scene.id,
    title: scene.title,
    category: scene.category,
    tags: scene.tags,
    status: scene.status,
    anchors: scene.compatibleAnchorTypes,
    requires: scene.requiredAnchorTags ?? [],
    actors: scene.actors.length,
    props: scene.props.length,
    variants: scene.dialogueVariants.length,
    lines: sceneLines(scene).length,
    behaviors,
    reactions: (scene.reactions ?? []).map((r) => `${r.id}:${r.trigger}`),
    conditions: (scene.conditions ?? []).map((c) => c.kind),
    weight: scene.weight,
    cooldown: scene.cooldownSeconds,
    cost: Math.round(sceneCost(scene)),
    unique: !!scene.unique,
  };
}

export function createMicroSceneDebug(deps: MicroSceneDebugDeps) {
  return {
    config: CFG,
    catalog: MICRO_SCENES,
    behaviors: SHARED_BEHAVIORS,

    /** Every registered scene, and how many there are. */
    list() {
      const rows = MICRO_SCENES.map(summarise);
      return { count: rows.length, scenes: rows };
    },

    /** Scenes carrying a tag, or in a category. */
    filter(term: string) {
      const t = term.toLowerCase();
      return MICRO_SCENES.filter(
        (s) => s.category === t || s.tags.some((tag) => tag.toLowerCase() === t) || s.id.includes(t),
      ).map(summarise);
    },

    /** Which scenes involve the police, either as cast or as a thing they react to. */
    police(force?: boolean) {
      const rt = deps.runtime();
      if (force !== undefined && rt) rt.fakePolice = force;
      return {
        forced: rt ? rt.fakePolice : false,
        scenes: MICRO_SCENES.filter(
          (s) =>
            s.category === 'police' ||
            s.tags.includes('police-reactive') ||
            (s.reactions ?? []).some((r) => r.trigger === 'policeNear' || r.trigger === 'playerWanted'),
        ).map((s) => s.id),
      };
    },

    /** Which scenes are still waiting on a recording or an asset. */
    pending() {
      return {
        needsAudio: MICRO_SCENES.filter((s) => s.status === 'needs-audio').map((s) => s.id),
        needsAssets: MICRO_SCENES.filter((s) => s.status === 'needs-assets').map((s) => s.id),
        unvoicedProfiles: unvoicedProfiles().map((p) => p.id),
      };
    },

    /** Which behaviour blocks are shared, and by whom. */
    reuse() {
      const usage = behaviorUsage();
      return SHARED_BEHAVIOR_IDS.map((id) => ({
        id,
        summary: SHARED_BEHAVIORS[id].summary,
        scenes: usage.get(id) ?? [],
      }));
    },

    /** The most expensive scenes first. */
    cost() {
      return [...MICRO_SCENES]
        .sort((a, b) => sceneCost(b) - sceneCost(a))
        .map((s) => ({ id: s.id, cost: Math.round(sceneCost(s)), ...s.performanceBudget }));
    },

    /** The four radii a scene works at, so a QA drive can be planned round them. */
    radii(id: string) {
      const scene = microScene(id);
      if (!scene) return null;
      return {
        spawn: scene.spawnDistance,
        activation: scene.activationDistance,
        dialogue: scene.dialogueDistance,
        despawn: scene.despawnDistance,
        audible: CFG.audio.max,
      };
    },

    /** Anchors of a type (or all of them), nearest first. */
    anchors(type?: string) {
      const at = deps.player();
      return deps
        .anchors()
        .filter((a) => !type || a.type === type || a.tags.includes(type as never))
        .map((a) => ({
          id: a.id,
          type: a.type,
          tags: a.tags,
          x: Math.round(a.transform.x),
          z: Math.round(a.transform.z),
          distance: Math.round(Math.hypot(a.transform.x - at.x, a.transform.z - at.z)),
        }))
        .sort((p, q) => p.distance - q.distance);
    },

    /** Which anchors a scene could stand on right now, and what it is worth at each. */
    eligible(id: string) {
      const rt = deps.runtime();
      const index = MICRO_SCENES.findIndex((s) => s.id === id);
      if (!rt || index < 0) return null;
      const at = deps.player();
      const signals = { ...FAKE_SIGNALS, x: at.x, z: at.z };
      return deps
        .anchors()
        .map((a) => ({ anchor: a.id, weight: sceneWeightAt(rt, index, a, signals) }))
        .filter((r) => r.weight > 0);
    },

    /** Force one up. `anchor` null picks the nearest compatible one; `variant` pins the dialogue. */
    spawn(id: string, anchor?: string | null, variant?: string | null) {
      const rt = deps.runtime();
      if (!rt) return false;
      return requestMicroScene(rt, id, anchor ?? undefined, variant ?? undefined);
    },

    /** Take everything down at once. */
    clear() {
      const rt = deps.runtime();
      if (!rt) return false;
      clearMicroScenes(rt, deps.events());
      return true;
    },

    /** Cooldowns and the quiet spell between conversations, off or on. */
    cooldowns(on?: boolean) {
      const rt = deps.runtime();
      if (!rt) return null;
      if (on !== undefined) {
        rt.ignoreCooldowns = !on;
        if (!on) rt.quietUntil = 0;
      }
      return !rt.ignoreCooldowns;
    },

    /** Pretend the player is sitting there watching, or has just blown past. */
    observe(on: boolean) {
      const rt = deps.runtime();
      if (!rt) return false;
      for (const inst of rt.instances) if (inst.scene >= 0) inst.observed = on ? 1 : 0;
      return true;
    },

    pass() {
      const rt = deps.runtime();
      if (!rt) return false;
      // Put the car on top of them going flat out for one scan: the reaction rules do the rest.
      for (const inst of rt.instances) {
        if (inst.scene < 0) continue;
        inst.distance = 4;
      }
      return true;
    },

    /** What is standing, in what state, and what it is costing. */
    status() {
      const rt = deps.runtime();
      if (!rt) return null;
      return {
        enabled: CFG.enabled,
        clock: Math.round(rt.clock),
        talking: rt.talking,
        quietFor: Math.max(0, Math.round(rt.quietUntil - rt.clock)),
        budget: { ...rt.budget },
        stats: { ...rt.stats },
        anchors: deps.anchors().length,
        active: rt.instances
          .filter((i) => i.scene >= 0)
          .map((i) => {
            const scene = MICRO_SCENES[i.scene];
            return {
              slot: i.slot,
              scene: scene?.id ?? '?',
              anchor: i.anchorId,
              state: i.state,
              since: Math.round(i.since * 10) / 10,
              distance: Math.round(i.distance),
              show: Math.round(i.show * 100) / 100,
              variant: i.variant >= 0 ? scene?.dialogueVariants[i.variant]?.id : null,
              line: i.line,
              said: i.dialogueDone,
              reacted: i.playerReacted,
              reaction: i.reaction >= 0 ? scene?.reactions?.[i.reaction]?.id : null,
              alarm: Math.round(i.alarm * 100) / 100,
              observed: Math.round(i.observed * 100) / 100,
              holder: i.propHolder,
              cost: scene ? Math.round(sceneCost(scene)) : 0,
            };
          }),
      };
    },

    /** Every complaint the catalogue and the world's anchors have about themselves. */
    validate() {
      return [...validateCatalog(), ...validateAnchors(deps.anchors())];
    },

    /** Which parts have a voice, which borrow one, and which have none at all. */
    voices() {
      return Object.values(VOICE_PROFILES).map((p) => {
        const heard = resolvedVoice(p.id);
        return {
          id: p.id,
          label: p.label,
          presenting: p.presenting,
          own: p.characterId,
          heardAs: heard ? heard.characterId : null,
          placeholder: !!heard && heard.id !== p.id,
          silent: !heard,
          lines: MICRO_SCENES.flatMap((s) =>
            sceneLines(s)
              .filter((l) => (l.voice ?? s.actors.find((a) => a.id === l.speaker)?.voice) === p.id)
              .map((l) => l.clip),
          ),
        };
      });
    },
  };
}

/** A neutral reading of the world for `eligible`, which asks a what-if rather than a what-is. */
const FAKE_SIGNALS = {
  x: 0,
  y: 0,
  z: 0,
  heading: 0,
  speed: 0,
  vx: 0,
  vz: 0,
  horn: false,
  combustionCar: true,
  pursuit: false,
  stars: 0,
  policeX: 0,
  policeZ: 0,
  policeDistance: Infinity,
  activity: false,
  storyAudio: false,
  session: 1e6,
  timeOfDay: 'night' as const,
};
