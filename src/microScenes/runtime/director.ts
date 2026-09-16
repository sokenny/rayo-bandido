import { MICRO_SCENES as CFG } from '../../config/tuning';
import type { GameEvent, MicroSceneEndReason } from '../../core/types';
import { MICRO_SCENES, presentActors } from '../registry';
import type {
  DialogueLine,
  DialogueVariant,
  MicroSceneAnchor,
  MicroSceneDefinition,
  MicroSceneTimeOfDay,
  ReactionTrigger,
  SceneCondition,
  SceneReaction,
} from '../types';
import { voiceConfigured } from '../voices';
import { budgetAllows, chargeBudget, clearBudget, createBudget, type MicroSceneBudget } from './budget';
import { createAnchorIndex, type MicroSceneAnchorIndex } from './anchorIndex';
import {
  clearInstance,
  createInstance,
  spokenSeconds,
  live,
  placeInstance,
  playerTrigger,
  setState,
  variantSeconds,
  type MicroSceneInstance,
} from './instance';

/**
 * THE DIRECTOR: what stands where, who talks, and — far more often — who does not.
 *
 * IT KNOWS NOTHING ABOUT ANY PARTICULAR SCENE. Everything it does is a function of the catalogue
 * (`registry.ts`), the anchors the world laid down, and a flat record of signals the game already
 * keeps. That is the whole point of the split: the eighth scene and the eightieth are the same
 * amount of work here, which is none.
 *
 * WHAT IT ACTUALLY DOES, in order of how often it says no:
 *   - it looks at anchors on a slow clock, never per frame, and only ones the car is APPROACHING;
 *   - it throws NOTHING HAPPENING into the draw beside the eligible scenes, and nothing wins most
 *     of the time — empty anchors are the feature, not the gap;
 *   - it refuses a scene the global budget cannot afford, one on cooldown, one whose conditions do
 *     not hold, one too near another scene already standing, and one whose dialogue has no voice;
 *   - it starts a conversation only when the player will still be in earshot for enough of it, and
 *     never more than one conversation in the whole city at a time, with a long quiet spell after;
 *   - it lets a scene react to the player ONCE per appearance, and remembers the conversation
 *     happened, so driving back and forth over a trigger hears nothing at all.
 *
 * WHAT IT NEVER DOES. It does not open UI, start a mission, pay anything, move traffic, touch the
 * wanted level, or ask the player for anything. It reads the police; it cannot write them.
 *
 * Pure data in, events out. No Three.js, no DOM, no clock of its own, nothing allocated per tick.
 */

/* ================================================================== what the tick knows */

/**
 * Everything the director is told about the world, assembled once per tick by the orchestrator
 * (`src/sim/gameState.ts`) out of state that already existed. One long-lived object.
 */
export interface MicroSceneSignals {
  /** The player's car. */
  x: number;
  y: number;
  z: number;
  heading: number;
  /** Unsigned (m/s). */
  speed: number;
  vx: number;
  vz: number;
  /** The horn is being sounded this tick. */
  horn: boolean;
  /** The player is in the combustion car. */
  combustionCar: boolean;

  /** The police, read only. */
  pursuit: boolean;
  stars: number;
  /** Nearest police car; `policeDistance` is `Infinity` when there is none on the road. */
  policeX: number;
  policeZ: number;
  policeDistance: number;

  /** Something else has the car: a run, a ride, a race door, the intro. */
  activity: boolean;
  /** A cinematic, a story line, a mission line or the police radio is audible. */
  storyAudio: boolean;

  /** Seconds since the session began. */
  session: number;
  timeOfDay: MicroSceneTimeOfDay;
}

export function createMicroSceneSignals(): MicroSceneSignals {
  return {
    x: 0, y: 0, z: 0, heading: 0, speed: 0, vx: 0, vz: 0,
    horn: false, combustionCar: true,
    pursuit: false, stars: 0, policeX: 0, policeZ: 0, policeDistance: Infinity,
    activity: false, storyAudio: false, session: 0, timeOfDay: 'night',
  };
}

/* ================================================================== the runtime */

export interface MicroSceneStats {
  spawned: number;
  despawned: number;
  conversations: number;
  reactions: number;
  /** Refused because the player would not have heard enough of it. */
  skippedNoTime: number;
  /** Refused because there was no free slot. */
  skippedBudget: number;
  /** Refused because a variant's voices are not configured. */
  skippedVoice: number;
}

export interface MicroSceneRuntime {
  /** The fixed pool. One more than `maxActive`, so a scene can fade out while another goes up. */
  instances: MicroSceneInstance[];
  /** Where scenes may stand. An implementation detail: built once, never serialised. */
  index: MicroSceneAnchorIndex;
  clock: number;
  scanIn: number;
  /** Per scene, the clock time it may appear again. */
  ready: Float64Array;
  /** Per category, the same, at a shorter interval: two police scenes in a row is a theme. */
  categoryReady: Map<string, number>;
  /** The last few scenes, and the last few variants of each, so nothing repeats straight away. */
  recent: number[];
  recentVariants: Map<number, string[]>;
  /** No micro-scene speaks before this. */
  quietUntil: number;
  /** Which slot has the one conversation, or -1. */
  talking: number;
  seed: number;
  budget: MicroSceneBudget;
  /** Development only: cooldowns and the quiet spell off. */
  ignoreCooldowns: boolean;
  /** Development only: police proximity forced on, whatever the real patrol is doing. */
  fakePolice: boolean;
  /**
   * Priority audio the RULES cannot see: a voiced character line, the police radio, the mute.
   * Written once a frame by the composition root (`src/game.ts`) out of what the audio layer
   * knows, and read into `MicroSceneSignals.storyAudio` by the orchestrator. It is a boolean
   * rather than a callback so the simulation stays free of the presentation layer.
   */
  externalAudio: boolean;
  /** Development only: a spawn asked for by name, taken on the next scan. */
  forced: { scene: number; anchor: string | null; variant: string | null } | null;
  stats: MicroSceneStats;
}

export function createMicroSceneRuntime(anchors: readonly MicroSceneAnchor[]): MicroSceneRuntime {
  const instances: MicroSceneInstance[] = [];
  for (let i = 0; i < CFG.maxActive + 1; i++) instances.push(createInstance(i));
  return {
    instances,
    index: createAnchorIndex(anchors),
    clock: 0,
    scanIn: 0,
    ready: new Float64Array(MICRO_SCENES.length),
    categoryReady: new Map(),
    recent: [],
    recentVariants: new Map(),
    quietUntil: 0,
    talking: -1,
    seed: 0x5f3a91c7,
    budget: createBudget(),
    ignoreCooldowns: false,
    fakePolice: false,
    externalAudio: false,
    forced: null,
    stats: {
      spawned: 0, despawned: 0, conversations: 0, reactions: 0,
      skippedNoTime: 0, skippedBudget: 0, skippedVoice: 0,
    },
  };
}

/** A restart: everything comes down, and nothing remembers having been said. */
export function resetMicroSceneRuntime(rt: MicroSceneRuntime): void {
  for (const inst of rt.instances) clearInstance(inst);
  rt.clock = 0;
  rt.scanIn = 0;
  rt.ready.fill(0);
  rt.categoryReady.clear();
  rt.recent.length = 0;
  rt.recentVariants.clear();
  rt.quietUntil = 0;
  rt.talking = -1;
  clearBudget(rt.budget);
  rt.forced = null;
}

/* ================================================================== dice */

function nextRandom(rt: MicroSceneRuntime): number {
  let x = rt.seed | 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  rt.seed = x | 0;
  return ((x >>> 0) % 100_000) / 100_000;
}

function between(rt: MicroSceneRuntime, range: readonly number[]): number {
  return range[0] + (range[1] - range[0]) * nextRandom(rt);
}

function beatSeconds(rt: MicroSceneRuntime, seconds: number | [number, number]): number {
  return typeof seconds === 'number' ? seconds : between(rt, seconds);
}

/* ================================================================== conditions */

/**
 * Whether a list of conditions holds. Evaluated against the signals and the place the scene would
 * stand, never against anything the director itself invented.
 */
export function conditionsHold(
  conditions: readonly SceneCondition[] | undefined,
  signals: MicroSceneSignals,
  anchorX: number,
  anchorZ: number,
): boolean {
  if (!conditions || conditions.length === 0) return true;
  for (const c of conditions) {
    switch (c.kind) {
      case 'playerCombustionCar':
        if (!signals.combustionCar) return false;
        break;
      case 'noPursuit':
        if (signals.pursuit) return false;
        break;
      case 'wantedNone':
        if (signals.stars > 0) return false;
        break;
      case 'wantedAtLeast':
        if (signals.stars < c.stars) return false;
        break;
      case 'noPoliceNearby': {
        if (!Number.isFinite(signals.policeDistance)) break;
        if (Math.hypot(signals.policeX - anchorX, signals.policeZ - anchorZ) < c.radius) return false;
        break;
      }
      case 'noActivity':
        if (signals.activity) return false;
        break;
      case 'timeOfDay':
        if (!c.phases.includes(signals.timeOfDay)) return false;
        break;
      case 'sessionAfter':
        if (signals.session < c.seconds) return false;
        break;
      case 'approachSlowerThan':
        if (signals.speed > c.speed) return false;
        break;
      default:
        break;
    }
  }
  return true;
}

/** Whether every line of a variant (or a reaction) can be heard in somebody's voice today. */
function linesVoiced(scene: MicroSceneDefinition, lines: readonly DialogueLine[]): boolean {
  for (const line of lines) {
    const profile = line.voice ?? scene.actors.find((a) => a.id === line.speaker)?.voice;
    if (!profile || !voiceConfigured(profile)) return false;
  }
  return true;
}

/** Cached: which voices exist does not change while the game runs. */
const VOICED = new Map<string, boolean>();

function variantVoiced(scene: MicroSceneDefinition, variant: DialogueVariant): boolean {
  const key = `${scene.id}/${variant.id}`;
  let known = VOICED.get(key);
  if (known === undefined) {
    known = linesVoiced(scene, variant.lines);
    VOICED.set(key, known);
  }
  return known;
}

/** Test seam: forget what is voiced, so a test can change the profiles and ask again. */
export function forgetVoiceCache(): void {
  VOICED.clear();
}

/* ================================================================== hearing */

/**
 * Seconds the player will still be within earshot of (x, z), from where they are and how they are
 * moving. A car heading towards the scene, or barely moving, gets the benefit of the doubt.
 */
export function earshotSeconds(signals: MicroSceneSignals, x: number, z: number): number {
  const dx = signals.x - x;
  const dz = signals.z - z;
  const dist = Math.hypot(dx, dz);
  const reach = CFG.audio.max;
  if (dist >= reach) return 0;
  const speed = Math.hypot(signals.vx, signals.vz);
  if (speed < 1) return Infinity;
  // How fast the gap is opening: the velocity along the line out from the scene.
  const away = dist > 1e-3 ? (signals.vx * dx + signals.vz * dz) / dist : 0;
  if (away <= 0.5) return Infinity;
  return (reach - dist) / away;
}

/* ================================================================== the step */

const NEAR: MicroSceneAnchor[] = [];
/** Seconds a small prop takes to change hands. */
const PASS_SECONDS = 1.6;

/** One tick of the whole system. `events` is appended to; nothing else in the game is touched. */
export function stepMicroScenes(
  rt: MicroSceneRuntime,
  signals: MicroSceneSignals,
  dt: number,
  events: GameEvent[],
): void {
  rt.clock += dt;

  for (const inst of rt.instances) {
    if (live(inst)) stepInstance(rt, inst, signals, dt, events);
  }

  // Everything standing, recounted from scratch: a slot that emptied this tick has already given
  // its budget back by the time anything asks for more.
  clearBudget(rt.budget);
  for (const inst of rt.instances) {
    if (!live(inst) || inst.state === 'despawning') continue;
    const scene = MICRO_SCENES[inst.scene];
    if (scene) chargeBudget(rt.budget, scene);
    if (inst.line >= 0) rt.budget.talking++;
  }

  rt.scanIn -= dt;
  if (rt.scanIn > 0) return;
  rt.scanIn = CFG.scan.interval;
  if (rt.forced) {
    takeForced(rt, signals, events);
    return;
  }
  if (CFG.enabled) scan(rt, signals, events);
}

/* ------------------------------------------------------------------ one instance */

function stepInstance(
  rt: MicroSceneRuntime,
  inst: MicroSceneInstance,
  signals: MicroSceneSignals,
  dt: number,
  events: GameEvent[],
): void {
  const scene = MICRO_SCENES[inst.scene];
  if (!scene) {
    clearInstance(inst);
    return;
  }
  inst.since += dt;
  inst.distance = Math.hypot(signals.x - inst.x, signals.z - inst.z);
  readWorld(rt, inst, signals, dt);

  // The fade. Nothing is ever drawn snapping in or out.
  const target = inst.state === 'despawning' ? 0 : 1;
  const step = dt / Math.max(0.05, CFG.fadeSeconds);
  inst.show += Math.sign(target - inst.show) * Math.min(step, Math.abs(target - inst.show));

  switch (inst.state) {
    case 'prewarming':
      if (inst.since >= CFG.prewarmSeconds) setState(inst, 'ambient');
      break;
    case 'ambient':
    case 'coolingDown':
      stepBeats(rt, inst, scene, dt);
      break;
    case 'dialoguePlaying':
      stepBeats(rt, inst, scene, dt);
      stepDialogue(rt, inst, scene, signals, dt, events);
      break;
    case 'reacted':
      stepReaction(rt, inst, scene, dt, events);
      break;
    case 'despawning':
      if (inst.show <= 0) {
        stopSpeaking(rt, inst, true, events);
        events.push({ type: 'microSceneDespawn', slot: inst.slot, scene: scene.id, reason: endReason(scene, signals, inst) });
        rt.stats.despawned++;
        const cool = rt.ignoreCooldowns ? 0 : scene.cooldownSeconds;
        rt.ready[inst.scene] = rt.clock + cool;
        rt.categoryReady.set(scene.category, rt.clock + cool * 0.4);
        clearInstance(inst);
      }
      return;
    default:
      break;
  }

  if (shouldDespawn(inst, scene, signals)) {
    stopSpeaking(rt, inst, true, events);
    setState(inst, 'despawning');
    return;
  }

  // A reaction can fire from any settled state, including in the middle of a conversation.
  if (inst.state === 'ambient' || inst.state === 'dialoguePlaying' || inst.state === 'coolingDown') {
    tryReaction(rt, inst, scene, signals, events);
  }
  if (inst.state === 'ambient') tryDialogue(rt, inst, scene, signals, events);
}

/** Why the slot is emptying. Presentation only; nothing downstream branches hard on it. */
function endReason(scene: MicroSceneDefinition, signals: MicroSceneSignals, inst: MicroSceneInstance): MicroSceneEndReason {
  if (!CFG.enabled) return 'disabled';
  if (!conditionsHold(scene.conditions, signals, inst.x, inst.z)) return 'conditions';
  return 'driven-away';
}

function shouldDespawn(inst: MicroSceneInstance, scene: MicroSceneDefinition, signals: MicroSceneSignals): boolean {
  if (inst.state === 'despawning') return false;
  if (!CFG.enabled) return true;
  if (inst.distance > scene.despawnDistance) return true;
  // A scene whose own conditions have stopped holding goes quietly, and only once it is far
  // enough away that nobody watches it go: the checkpoint standing calm in the middle of a chase
  // is the case this exists for.
  return inst.distance > scene.dialogueDistance && !conditionsHold(scene.conditions, signals, inst.x, inst.z);
}

/* ------------------------------------------------------------------ the world, read slowly */

function readWorld(rt: MicroSceneRuntime, inst: MicroSceneInstance, signals: MicroSceneSignals, dt: number): void {
  // The police, on their own low-frequency clock: a chase does not need a per-frame answer.
  inst.policeTimer -= dt;
  if (inst.policeTimer <= 0) {
    inst.policeTimer = CFG.police.interval;
    inst.policeX = signals.policeX;
    inst.policeZ = signals.policeZ;
    inst.policeDistance = Number.isFinite(signals.policeDistance)
      ? Math.hypot(signals.policeX - inst.x, signals.policeZ - inst.z)
      : Infinity;
  }
  const near = rt.fakePolice || inst.policeDistance < CFG.police.radius ? 1 : 0;
  const tc = near ? CFG.police.attack : CFG.police.release;
  inst.alarm += (near - inst.alarm) * Math.min(1, dt / Math.max(0.01, tc));

  // Being watched: close, slow, and pointed at them. A simple bounding test, no rays.
  const r = CFG.reactions;
  let watching = false;
  if (inst.distance < r.observeRadius && signals.speed < r.observeSpeed) {
    const dx = inst.x - signals.x;
    const dz = inst.z - signals.z;
    const d = Math.hypot(dx, dz);
    if (d > 1e-3) {
      const fx = Math.sin(signals.heading);
      const fz = -Math.cos(signals.heading);
      watching = (dx * fx + dz * fz) / d > Math.cos(r.observeCone);
    }
  }
  const towards = watching ? dt / r.observeSeconds : -dt / r.observeRelease;
  inst.observed = Math.max(0, Math.min(1, inst.observed + towards));
}

/* ------------------------------------------------------------------ the ambient loop */

function stepBeats(rt: MicroSceneRuntime, inst: MicroSceneInstance, scene: MicroSceneDefinition, dt: number): void {
  // A pass in flight finishes first, and the prop only ever lands in ONE hand.
  if (inst.propTo >= 0 && inst.propFrom >= 0) {
    inst.propTransfer = Math.min(1, inst.propTransfer + dt / PASS_SECONDS);
    if (inst.propTransfer >= 1) {
      inst.propHolder = inst.propTo;
      inst.propFrom = -1;
      inst.propTo = -1;
      inst.propTransfer = 0;
    }
  }

  const beats = scene.ambientSequence;
  if (beats.length === 0) return;
  inst.beatLeft -= dt;
  if (inst.beatLeft > 0) return;
  inst.beat = (inst.beat + 1) % beats.length;
  const beat = beats[inst.beat];
  inst.beatLeft = beatSeconds(rt, beat.seconds);
  if (!beat.prop || !beat.to) return;

  const prop = scene.props.find((p) => p.id === beat.prop);
  if (prop?.transferable) {
    const to = scene.actors.findIndex((a) => a.id === beat.to);
    // Never a pass to somebody who is not standing there, and never one from nobody.
    if (to >= 0 && inst.present[to] && inst.propHolder >= 0 && to !== inst.propHolder) {
      inst.propFrom = inst.propHolder;
      inst.propTo = to;
      inst.propTransfer = 0;
    }
  } else if (prop?.dragged) {
    // The haul creeps towards the cover and then starts again: it never completes into anything.
    inst.dragProgress += inst.dragDir * 0.22;
    if (inst.dragProgress >= 1) {
      inst.dragProgress = 1;
      inst.dragDir = -1;
    } else if (inst.dragProgress <= 0) {
      inst.dragProgress = 0;
      inst.dragDir = 1;
    }
  }
}

/* ------------------------------------------------------------------ speaking */

function currentLines(inst: MicroSceneInstance, scene: MicroSceneDefinition): readonly DialogueLine[] {
  if (inst.lineSource === 'reaction') return scene.reactions?.[inst.reaction]?.lines ?? [];
  return scene.dialogueVariants[inst.variant]?.lines ?? [];
}

/** True while a clip is actually audible (as opposed to the gap after one). */
function audible(inst: MicroSceneInstance): boolean {
  return inst.line >= 0 && !inst.inGap;
}

function speakLine(
  rt: MicroSceneRuntime,
  inst: MicroSceneInstance,
  scene: MicroSceneDefinition,
  index: number,
  events: GameEvent[],
): void {
  const line = currentLines(inst, scene)[index];
  if (!line) return;
  const actor = scene.actors.findIndex((a) => a.id === line.speaker);
  if (actor < 0) return;
  inst.line = index;
  inst.inGap = false;
  inst.lineTotal = spokenSeconds(scene, line);
  inst.lineLeft = inst.lineTotal;
  rt.talking = inst.slot;
  events.push({
    type: 'microSceneLine',
    slot: inst.slot,
    scene: scene.id,
    speaker: line.speaker,
    actor,
    clip: line.clip,
    voice: line.voice ?? scene.actors[actor].voice,
    text: line.text,
    seconds: inst.lineTotal,
    // One emitter per speaker: the line comes out of the person saying it, not out of the scene.
    x: inst.actorX[actor],
    y: inst.actorY[actor] + 1.5,
    z: inst.actorZ[actor],
  });
}

/** The clip that is playing stops here. The gap after it may still run. */
function endCurrentLine(rt: MicroSceneRuntime, inst: MicroSceneInstance, cut: boolean, events: GameEvent[]): void {
  if (!audible(inst)) return;
  inst.inGap = true;
  events.push({ type: 'microSceneLineEnd', slot: inst.slot, cut });
  void rt;
}

/** Nobody in this scene is saying anything any more, and the one audio slot is given back. */
function stopSpeaking(rt: MicroSceneRuntime, inst: MicroSceneInstance, cut: boolean, events: GameEvent[]): void {
  endCurrentLine(rt, inst, cut, events);
  inst.line = -1;
  inst.inGap = false;
  inst.lineLeft = 0;
  if (rt.talking === inst.slot) rt.talking = -1;
}

/** The conversation is over, however it ended. It cannot start again this appearance. */
function endConversation(rt: MicroSceneRuntime, inst: MicroSceneInstance, cut: boolean, events: GameEvent[]): void {
  stopSpeaking(rt, inst, cut, events);
  inst.dialogueDone = true;
  rt.quietUntil = rt.clock + between(rt, CFG.dialogue.spacing);
  if (inst.state === 'dialoguePlaying') setState(inst, 'coolingDown');
}

function stepDialogue(
  rt: MicroSceneRuntime,
  inst: MicroSceneInstance,
  scene: MicroSceneDefinition,
  signals: MicroSceneSignals,
  dt: number,
  events: GameEvent[],
): void {
  const policy = scene.interruptionPolicy;
  const lines = currentLines(inst, scene);
  if (lines.length === 0) {
    endConversation(rt, inst, false, events);
    return;
  }

  // HIGHER-PRIORITY AUDIO. `fade` lets go of the line now; `cancel` lets this line finish and
  // stops before the next one. Either way the conversation does not come back.
  if (signals.storyAudio) {
    if (policy.onPriorityAudio === 'fade' || !audible(inst)) {
      endConversation(rt, inst, audible(inst), events);
      return;
    }
  }

  // The player has driven out of it. Same two policies, same one-way door.
  if (inst.distance > CFG.audio.max) {
    endConversation(rt, inst, policy.onPlayerLeaves === 'fade' && audible(inst), events);
    return;
  }

  inst.lineLeft -= dt;
  if (inst.lineLeft > 0) return;

  if (audible(inst)) {
    const line = lines[inst.line];
    endCurrentLine(rt, inst, false, events);
    if (inst.line + 1 >= lines.length) {
      endConversation(rt, inst, false, events);
      return;
    }
    inst.lineLeft = line?.gapAfter ?? CFG.dialogue.gap;
    return;
  }
  // The gap has run out: on to the next line.
  const next = inst.line + 1;
  if (next >= lines.length) {
    endConversation(rt, inst, false, events);
    return;
  }
  speakLine(rt, inst, scene, next, events);
}

/* ------------------------------------------------------------------ choosing a variant */

/** Whether enough of a variant will be heard for it to be worth starting. */
function enoughTime(scene: MicroSceneDefinition, variant: DialogueVariant, earshot: number): boolean {
  const total = variantSeconds(scene, variant.lines);
  return earshot >= Math.max(variant.minListenSeconds ?? 0, total * CFG.dialogue.minHeard);
}

function variantWeight(
  scene: MicroSceneDefinition,
  variant: DialogueVariant,
  signals: MicroSceneSignals,
  inst: MicroSceneInstance,
  recent: readonly string[],
  earshot: number,
): number {
  if (!variantVoiced(scene, variant)) return 0;
  if (!conditionsHold(variant.conditions, signals, inst.x, inst.z)) return 0;
  if (!enoughTime(scene, variant, earshot)) return 0;
  if (variant.present && variant.present.length > scene.performanceBudget.maxActors) return 0;
  // Not the same one twice running: heavily discouraged rather than forbidden, so a scene with
  // two eligible variants does not fall silent because one of them was the last.
  return Math.max(0, variant.weight) * (recent.includes(variant.id) ? 0.15 : 1);
}

/** Set the cast a variant asks for. Anybody it does not name steps out of the picture. */
function castFor(inst: MicroSceneInstance, scene: MicroSceneDefinition, variant: DialogueVariant | null): void {
  const present = presentActors(scene, variant);
  for (let i = 0; i < scene.actors.length; i++) inst.present[i] = present.includes(scene.actors[i].id) ? 1 : 0;
}

/** Pick and start one eligible variant, if the moment is right. Called only from `ambient`. */
function tryDialogue(
  rt: MicroSceneRuntime,
  inst: MicroSceneInstance,
  scene: MicroSceneDefinition,
  signals: MicroSceneSignals,
  events: GameEvent[],
): void {
  if (inst.dialogueDone || inst.line >= 0) return;
  if (inst.distance > scene.dialogueDistance) return;
  if (signals.storyAudio) return;
  if (rt.talking >= 0 && rt.talking !== inst.slot) return;
  if (rt.budget.talking >= CFG.maxTalking) return;
  if (!rt.ignoreCooldowns && rt.clock < rt.quietUntil) return;

  const earshot = earshotSeconds(signals, inst.x, inst.z);

  // A variant pinned by the debug tools skips the draw but not the machinery.
  let chosen = inst.pinned;
  if (chosen < 0) {
    const recent = rt.recentVariants.get(inst.scene) ?? [];
    let total = 0;
    for (const v of scene.dialogueVariants) total += variantWeight(scene, v, signals, inst, recent, earshot);
    if (total <= 0) {
      // Say WHY nothing was chosen, so the counters tell a missing voice from a fast driver.
      let unvoiced = false;
      let noTime = false;
      for (const v of scene.dialogueVariants) {
        if (!variantVoiced(scene, v)) unvoiced = true;
        else if (!enoughTime(scene, v, earshot)) noTime = true;
      }
      if (unvoiced) rt.stats.skippedVoice++;
      else if (noTime) rt.stats.skippedNoTime++;
      return;
    }
    let roll = nextRandom(rt) * total;
    for (let i = 0; i < scene.dialogueVariants.length; i++) {
      roll -= variantWeight(scene, scene.dialogueVariants[i], signals, inst, recent, earshot);
      if (roll <= 0) {
        chosen = i;
        break;
      }
    }
    if (chosen < 0) return;
  }

  const variant = scene.dialogueVariants[chosen];
  if (!variant) return;
  castFor(inst, scene, variant);
  inst.variant = chosen;
  inst.pinned = -1;
  inst.lineSource = 'variant';
  setState(inst, 'dialoguePlaying');
  speakLine(rt, inst, scene, 0, events);
  rt.stats.conversations++;

  const list = rt.recentVariants.get(inst.scene) ?? [];
  list.push(variant.id);
  while (list.length > CFG.dialogue.recentVariants) list.shift();
  rt.recentVariants.set(inst.scene, list);
}

/* ------------------------------------------------------------------ reactions */

function triggerFires(
  trigger: ReactionTrigger,
  inst: MicroSceneInstance,
  scene: MicroSceneDefinition,
  signals: MicroSceneSignals,
): boolean {
  const r = CFG.reactions;
  switch (trigger) {
    case 'aggressivePass':
      return inst.distance < r.aggressiveRadius && signals.speed > r.aggressiveSpeed;
    case 'slowPass':
      return inst.distance < r.slowRadius && signals.speed > 1.5 && signals.speed < r.slowSpeed;
    case 'horn':
      return signals.horn && inst.distance < r.hornRadius;
    case 'observed':
      return inst.observed >= 1;
    case 'policeNear':
      return inst.alarm > 0.5;
    case 'playerWanted':
      return signals.stars > 0 && inst.distance < scene.dialogueDistance;
    default:
      return false;
  }
}

function tryReaction(
  rt: MicroSceneRuntime,
  inst: MicroSceneInstance,
  scene: MicroSceneDefinition,
  signals: MicroSceneSignals,
  events: GameEvent[],
): void {
  const reactions = scene.reactions;
  if (!reactions || reactions.length === 0) return;

  let best = -1;
  let bestPriority = -Infinity;
  for (let i = 0; i < reactions.length; i++) {
    const reaction = reactions[i];
    if (reaction.once !== false && inst.reactionFired[i]) continue;
    // ONE player reaction per appearance, whichever of them it turns out to be.
    if (playerTrigger(reaction.trigger) && inst.playerReacted) continue;
    if (!triggerFires(reaction.trigger, inst, scene, signals)) continue;
    if (!conditionsHold(reaction.conditions, signals, inst.x, inst.z)) continue;
    if (reaction.priority > bestPriority) {
      best = i;
      bestPriority = reaction.priority;
    }
  }
  if (best < 0) return;

  const reaction = reactions[best];
  const speaks = !!reaction.lines && reaction.lines.length > 0 && linesVoiced(scene, reaction.lines);
  // A reaction that wants to speak over a conversation may only do so if the scene allows it, and
  // never while the one environmental conversation in the city belongs to somebody else.
  if (speaks && audible(inst) && !scene.interruptionPolicy.reactionInterrupts) return;
  if (speaks && rt.talking >= 0 && rt.talking !== inst.slot) return;
  if (speaks && signals.storyAudio) return;

  // Whatever was being said stops here; the conversation does not come back.
  if (inst.line >= 0) endConversation(rt, inst, true, events);

  inst.reactionFired[best] = 1;
  if (playerTrigger(reaction.trigger)) inst.playerReacted = true;
  inst.reaction = best;
  inst.reactionLeft = reaction.seconds;
  inst.reactionSaid = !speaks;
  inst.resumeLeft = 0;
  setState(inst, 'reacted');
  rt.stats.reactions++;
  events.push({
    type: 'microSceneReaction',
    slot: inst.slot,
    scene: scene.id,
    reaction: reaction.id,
    trigger: reaction.trigger,
  });

  if (speaks) {
    inst.lineSource = 'reaction';
    speakLine(rt, inst, scene, 0, events);
  }
}

function stepReaction(
  rt: MicroSceneRuntime,
  inst: MicroSceneInstance,
  scene: MicroSceneDefinition,
  dt: number,
  events: GameEvent[],
): void {
  const reaction: SceneReaction | undefined = scene.reactions?.[inst.reaction];
  if (!reaction) {
    setState(inst, inst.dialogueDone ? 'coolingDown' : 'ambient');
    return;
  }

  // A reaction's lines run on the same machinery a conversation's do.
  if (inst.line >= 0) {
    const lines = reaction.lines ?? [];
    inst.lineLeft -= dt;
    if (inst.lineLeft <= 0) {
      if (audible(inst)) {
        const line = lines[inst.line];
        endCurrentLine(rt, inst, false, events);
        if (inst.line + 1 >= lines.length) stopSpeaking(rt, inst, false, events);
        else inst.lineLeft = line?.gapAfter ?? CFG.dialogue.gap;
      } else {
        const next = inst.line + 1;
        if (next >= lines.length) stopSpeaking(rt, inst, false, events);
        else speakLine(rt, inst, scene, next, events);
      }
      if (inst.line < 0) inst.reactionSaid = true;
    }
  }

  inst.reactionLeft -= dt;
  // A police reaction is held open while a patrol is still there: nobody picks a joint or a
  // bundle back up with a car still sitting at the kerb.
  if (reaction.trigger === 'policeNear' && inst.alarm > 0.35) inst.reactionLeft = Math.max(inst.reactionLeft, 0.5);
  if (inst.reactionLeft > 0 || !inst.reactionSaid) return;

  if (reaction.resumeAfter && inst.resumeLeft <= 0) {
    inst.resumeLeft = between(rt, reaction.resumeAfter);
    if (inst.resumeLeft > 0) return;
  }
  if (inst.resumeLeft > 0) {
    inst.resumeLeft -= dt;
    if (inst.resumeLeft > 0) return;
  }
  inst.resumeLeft = 0;
  inst.reaction = -1;
  if (!scene.interruptionPolicy.resumeAfterReaction) {
    setState(inst, 'coolingDown');
    return;
  }
  setState(inst, inst.dialogueDone ? 'coolingDown' : 'ambient');
}

/* ------------------------------------------------------------------ selection */

function occupied(rt: MicroSceneRuntime, anchorId: string): boolean {
  for (const inst of rt.instances) if (live(inst) && inst.anchorId === anchorId) return true;
  return false;
}

function standing(rt: MicroSceneRuntime, sceneIndex: number): boolean {
  for (const inst of rt.instances) if (live(inst) && inst.scene === sceneIndex) return true;
  return false;
}

function freeSlot(rt: MicroSceneRuntime): MicroSceneInstance | null {
  for (const inst of rt.instances) if (!live(inst)) return inst;
  return null;
}

/** Whether an anchor could carry anything at all right now, before any scene is considered. */
function anchorUsable(rt: MicroSceneRuntime, anchor: MicroSceneAnchor, signals: MicroSceneSignals): boolean {
  if (occupied(rt, anchor.id)) return false;
  if (anchor.allowedTimeOfDay && !anchor.allowedTimeOfDay.includes(signals.timeOfDay)) return false;
  // The two bridge scenes share an underpass; they do not share it at the same time.
  if (anchor.exclusiveWith) {
    for (const other of anchor.exclusiveWith) if (occupied(rt, other)) return false;
  }
  const dx = anchor.transform.x - signals.x;
  const dz = anchor.transform.z - signals.z;
  const dist = Math.hypot(dx, dz);
  if (dist < CFG.scan.minSpawn) return false;
  // Only somewhere the car is heading: something appearing behind the camera is not a discovery.
  const fx = Math.sin(signals.heading);
  const fz = -Math.cos(signals.heading);
  if ((dx * fx + dz * fz) / (dist > 1e-3 ? dist : 1) < CFG.scan.approachDot) return false;
  // Not on top of something already standing.
  for (const inst of rt.instances) {
    if (!live(inst)) continue;
    if (Math.hypot(inst.x - anchor.transform.x, inst.z - anchor.transform.z) < CFG.scan.sceneSpacing) return false;
  }
  return true;
}

/** Whether a scene may take this anchor, and what it is worth against the others that may. */
export function sceneWeightAt(
  rt: MicroSceneRuntime,
  sceneIndex: number,
  anchor: MicroSceneAnchor,
  signals: MicroSceneSignals,
): number {
  const scene = MICRO_SCENES[sceneIndex];
  if (!scene) return 0;
  if (!scene.compatibleAnchorTypes.includes(anchor.type)) return 0;
  if (scene.requiredAnchorTags && !scene.requiredAnchorTags.every((t) => anchor.tags.includes(t))) return 0;
  if (scene.forbiddenAnchorTags && scene.forbiddenAnchorTags.some((t) => anchor.tags.includes(t))) return 0;
  // ONE APPEARANCE OF A SCENE AT A TIME, whether or not it declares itself `unique`: the renderer
  // builds one set of bodies per scene definition and reuses it, and two identical bus stops a
  // street apart would have been the wrong picture anyway. `unique` is the stronger statement —
  // and the only one the catalogue reports — but the floor is the same.
  if (standing(rt, sceneIndex)) return 0;
  if (!rt.ignoreCooldowns && rt.clock < rt.ready[sceneIndex]) return 0;
  if (!rt.ignoreCooldowns && rt.clock < (rt.categoryReady.get(scene.category) ?? 0)) return 0;
  if (!budgetAllows(rt.budget, scene)) return 0;
  if (!conditionsHold(scene.conditions, signals, anchor.transform.x, anchor.transform.z)) return 0;
  if (Math.hypot(anchor.transform.x - signals.x, anchor.transform.z - signals.z) > scene.spawnDistance) return 0;

  // Never beside a scene it is written to keep away from.
  if (scene.keepAwayFrom) {
    for (const rule of scene.keepAwayFrom) {
      for (const inst of rt.instances) {
        if (!live(inst) || MICRO_SCENES[inst.scene]?.id !== rule.sceneId) continue;
        if (Math.hypot(inst.x - anchor.transform.x, inst.z - anchor.transform.z) < rule.metres) return 0;
      }
    }
  }

  // Nothing whose every variant is silent today: an empty anchor beats a mime.
  if (!scene.dialogueVariants.some((v) => variantVoiced(scene, v))) return 0;

  return Math.max(0, scene.weight) * (rt.recent.includes(sceneIndex) ? 0.25 : 1);
}

function scan(rt: MicroSceneRuntime, signals: MicroSceneSignals, events: GameEvent[]): void {
  if (rt.budget.scenes >= CFG.maxActive) return;
  if (signals.speed > CFG.scan.maxSpawnSpeed) return;
  const slot = freeSlot(rt);
  if (!slot) {
    rt.stats.skippedBudget++;
    return;
  }

  rt.index.near(signals.x, signals.z, CFG.scan.radius, NEAR);
  if (NEAR.length === 0) return;

  // ONE anchor is considered per scan, picked at random among the usable ones. Together with the
  // weight of NOTHING HAPPENING below, that is what leaves most of the city's anchors empty.
  let usable = 0;
  for (let i = 0; i < NEAR.length; i++) if (anchorUsable(rt, NEAR[i], signals)) usable++;
  if (usable === 0) return;
  let pick = Math.floor(nextRandom(rt) * usable);
  let anchor: MicroSceneAnchor | null = null;
  for (let i = 0; i < NEAR.length; i++) {
    if (!anchorUsable(rt, NEAR[i], signals)) continue;
    if (pick-- === 0) {
      anchor = NEAR[i];
      break;
    }
  }
  if (!anchor) return;

  let total = CFG.scan.nothingWeight;
  for (let i = 0; i < MICRO_SCENES.length; i++) total += sceneWeightAt(rt, i, anchor, signals);
  let roll = nextRandom(rt) * total - CFG.scan.nothingWeight;
  if (roll <= 0) return;
  for (let i = 0; i < MICRO_SCENES.length; i++) {
    roll -= sceneWeightAt(rt, i, anchor, signals);
    if (roll <= 0) {
      spawn(rt, slot, i, anchor, events);
      return;
    }
  }
}

function spawn(
  rt: MicroSceneRuntime,
  inst: MicroSceneInstance,
  sceneIndex: number,
  anchor: MicroSceneAnchor,
  events: GameEvent[],
): void {
  const scene = MICRO_SCENES[sceneIndex];
  if (!scene) return;
  placeInstance(inst, sceneIndex, scene, anchor, presentActors(scene, null));
  chargeBudget(rt.budget, scene);
  rt.stats.spawned++;
  rt.recent.push(sceneIndex);
  while (rt.recent.length > CFG.dialogue.recentScenes) rt.recent.shift();
  events.push({
    type: 'microSceneSpawn',
    slot: inst.slot,
    scene: scene.id,
    anchor: anchor.id,
    x: inst.x,
    y: inst.y,
    z: inst.z,
  });
}

/* ------------------------------------------------------------------ development */

/** Take down everything standing, at once. The debug tools' "clear". */
export function clearMicroScenes(rt: MicroSceneRuntime, events: GameEvent[]): void {
  for (const inst of rt.instances) {
    if (!live(inst)) continue;
    const scene = MICRO_SCENES[inst.scene];
    stopSpeaking(rt, inst, true, events);
    if (scene) events.push({ type: 'microSceneDespawn', slot: inst.slot, scene: scene.id, reason: 'cleared' });
    clearInstance(inst);
  }
  rt.talking = -1;
  clearBudget(rt.budget);
}

/**
 * Ask for a named scene on the next scan, at a named anchor or the nearest compatible one, with a
 * named variant or the ordinary draw. Development only (`__rb.microScenes.spawn`).
 */
export function requestMicroScene(rt: MicroSceneRuntime, sceneId: string, anchorId?: string, variantId?: string): boolean {
  const index = MICRO_SCENES.findIndex((s) => s.id === sceneId);
  if (index < 0) return false;
  rt.forced = { scene: index, anchor: anchorId ?? null, variant: variantId ?? null };
  rt.scanIn = 0;
  return true;
}

function takeForced(rt: MicroSceneRuntime, signals: MicroSceneSignals, events: GameEvent[]): void {
  const request = rt.forced;
  rt.forced = null;
  if (!request) return;
  const scene = MICRO_SCENES[request.scene];
  if (!scene) return;

  // ONE APPEARANCE OF A SCENE AT A TIME holds on this path too: the renderer keeps one set of
  // bodies per scene definition, and a forced spawn must not be the one thing that breaks it.
  const already = rt.instances.find((i) => live(i) && i.scene === request.scene);
  const slot = already ?? freeSlot(rt) ?? rt.instances[0];
  if (live(slot)) {
    stopSpeaking(rt, slot, true, events);
    const old = MICRO_SCENES[slot.scene];
    if (old) events.push({ type: 'microSceneDespawn', slot: slot.slot, scene: old.id, reason: 'preempted' });
    clearInstance(slot);
  }

  let anchor: MicroSceneAnchor | null = request.anchor ? rt.index.byId(request.anchor) : null;
  if (!anchor) {
    // The nearest compatible anchor, whatever the ordinary rules would have said about it.
    rt.index.near(signals.x, signals.z, CFG.scan.radius * 4, NEAR);
    let bestD = Infinity;
    for (const candidate of NEAR) {
      if (!scene.compatibleAnchorTypes.includes(candidate.type)) continue;
      if (scene.requiredAnchorTags && !scene.requiredAnchorTags.every((t) => candidate.tags.includes(t))) continue;
      if (occupied(rt, candidate.id)) continue;
      const d = Math.hypot(candidate.transform.x - signals.x, candidate.transform.z - signals.z);
      if (d < bestD) {
        bestD = d;
        anchor = candidate;
      }
    }
  }
  if (!anchor) return;

  spawn(rt, slot, request.scene, anchor, events);
  if (request.variant) {
    const at = scene.dialogueVariants.findIndex((v) => v.id === request.variant);
    if (at >= 0) {
      slot.pinned = at;
      castFor(slot, scene, scene.dialogueVariants[at]);
    }
  }
}
