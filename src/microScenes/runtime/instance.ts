// `.ts` so Node can load this module straight; see `registry.ts`.
import { MICRO_SCENES as CFG } from '../../config/tuning.ts';
import type { DialogueLine, MicroSceneAnchor, MicroSceneDefinition, MicroSceneLifecycle, ReactionTrigger } from '../types';
import { CLIP_SECONDS } from '../clipDurations.ts';
import { VOICE_PROFILES } from '../voices.ts';

/**
 * ONE STANDING MICRO-SCENE. A slot in a fixed pool: it is filled, it plays, it empties, and the
 * same object is filled again with a different scene. Nothing here is allocated after the pool is
 * built — the arrays are sized for the biggest cast and prop list any scene declares.
 *
 * THE LIFECYCLE, and the two flags that make it behave:
 *
 *     Dormant -> Prewarming -> Ambient -> DialoguePlaying -> Reacted -> CoolingDown -> Despawning
 *
 * `dialogueDone` and `playerReacted` are remembered FOR THE WHOLE APPEARANCE. That is what stops
 * the oldest bug in environmental dialogue: driving back and forth across a trigger and hearing
 * the same two lines start over. One conversation and one player reaction per appearance; the
 * scene has to be taken down and put up again before either can happen once more.
 */

/** The biggest cast any scene declares, plus its understudy. Sized once, checked by validation. */
export const MAX_ACTORS = 4;
/** The longest prop list any scene declares. */
export const MAX_PROPS = 6;
/** The most reactions any scene declares. */
export const MAX_REACTIONS = 4;

export interface MicroSceneInstance {
  readonly slot: number;
  /** Index into `MICRO_SCENES`, or -1 when the slot is empty. */
  scene: number;
  anchorId: string;
  state: MicroSceneLifecycle;
  /** Seconds in the current state. */
  since: number;
  /** Bumped on every fresh appearance. The renderer rebuilds its placement when it changes. */
  generation: number;

  /** Where the scene stands. */
  x: number;
  y: number;
  z: number;
  heading: number;
  /** Away from the road at this anchor, unit length. */
  awayX: number;
  awayZ: number;

  /** Actors, in the scene's own declaration order. World space. */
  actorX: Float32Array;
  actorY: Float32Array;
  actorZ: Float32Array;
  actorHeading: Float32Array;
  /** The same, in the scene's local frame: what the renderer offsets its built bodies by. */
  localX: Float32Array;
  localZ: Float32Array;
  localHeading: Float32Array;
  /** Whether each actor is on the pavement this appearance. */
  present: Uint8Array;
  /** Each actor's own clock offset, so nobody moves in step with anybody. */
  phase: Float32Array;

  /** Props, in the scene's own declaration order, in the local frame. */
  propX: Float32Array;
  propZ: Float32Array;
  propHeading: Float32Array;

  /** The conversation: which variant was drawn, or -1. */
  variant: number;
  /**
   * A variant the debug tools pinned for the next conversation, or -1. It skips the draw and
   * nothing else — a pinned variant still plays through the same machinery a chosen one does.
   */
  pinned: number;
  /** Which list the line being spoken comes from: the chosen variant, or a reaction's. */
  lineSource: 'variant' | 'reaction';
  line: number;
  lineLeft: number;
  lineTotal: number;
  inGap: boolean;
  dialogueDone: boolean;

  /** The reactions. */
  reaction: number;
  reactionLeft: number;
  /** Whether the running reaction has already said its piece. */
  reactionSaid: boolean;
  reactionFired: Uint8Array;
  /** At most one PLAYER reaction per appearance, whichever of them it was. */
  playerReacted: boolean;
  resumeLeft: number;

  /** What the scene can see of the world, refreshed on its own low-frequency clock. */
  distance: number;
  alarm: number;
  observed: number;
  policeX: number;
  policeZ: number;
  policeDistance: number;
  policeTimer: number;

  /** The ambient loop. */
  beat: number;
  beatLeft: number;

  /** The passed prop: who has it, who it is going to, and how far along (0..1). */
  propHolder: number;
  propFrom: number;
  propTo: number;
  propTransfer: number;
  /** The dragged prop, 0..1 along its haul, and which way it is going. */
  dragProgress: number;
  dragDir: number;

  /** Fade, 0..1. Nothing is ever drawn popping in. */
  show: number;
}

export function createInstance(slot: number): MicroSceneInstance {
  return {
    slot,
    scene: -1,
    anchorId: '',
    state: 'dormant',
    since: 0,
    generation: 0,
    x: 0, y: 0, z: 0, heading: 0, awayX: 0, awayZ: 1,
    actorX: new Float32Array(MAX_ACTORS),
    actorY: new Float32Array(MAX_ACTORS),
    actorZ: new Float32Array(MAX_ACTORS),
    actorHeading: new Float32Array(MAX_ACTORS),
    localX: new Float32Array(MAX_ACTORS),
    localZ: new Float32Array(MAX_ACTORS),
    localHeading: new Float32Array(MAX_ACTORS),
    present: new Uint8Array(MAX_ACTORS),
    phase: new Float32Array(MAX_ACTORS),
    propX: new Float32Array(MAX_PROPS),
    propZ: new Float32Array(MAX_PROPS),
    propHeading: new Float32Array(MAX_PROPS),
    variant: -1,
    pinned: -1,
    lineSource: 'variant',
    line: -1,
    lineLeft: 0,
    lineTotal: 0,
    inGap: false,
    dialogueDone: false,
    reaction: -1,
    reactionLeft: 0,
    reactionSaid: false,
    reactionFired: new Uint8Array(MAX_REACTIONS),
    playerReacted: false,
    resumeLeft: 0,
    distance: Infinity,
    alarm: 0,
    observed: 0,
    policeX: 0,
    policeZ: 0,
    policeDistance: Infinity,
    policeTimer: 0,
    beat: 0,
    beatLeft: 0,
    propHolder: -1,
    propFrom: -1,
    propTo: -1,
    propTransfer: 0,
    dragProgress: 0,
    dragDir: 1,
    show: 0,
  };
}

/** Empty the slot. The pool object survives; everything about the appearance does not. */
export function clearInstance(inst: MicroSceneInstance): void {
  inst.scene = -1;
  inst.anchorId = '';
  inst.state = 'dormant';
  inst.since = 0;
  inst.variant = -1;
  inst.pinned = -1;
  inst.lineSource = 'variant';
  inst.line = -1;
  inst.lineLeft = 0;
  inst.lineTotal = 0;
  inst.inGap = false;
  inst.dialogueDone = false;
  inst.reaction = -1;
  inst.reactionLeft = 0;
  inst.reactionSaid = false;
  inst.reactionFired.fill(0);
  inst.playerReacted = false;
  inst.resumeLeft = 0;
  inst.distance = Infinity;
  inst.alarm = 0;
  inst.observed = 0;
  inst.policeDistance = Infinity;
  inst.policeTimer = 0;
  inst.beat = 0;
  inst.beatLeft = 0;
  inst.propHolder = -1;
  inst.propFrom = -1;
  inst.propTo = -1;
  inst.propTransfer = 0;
  inst.dragProgress = 0;
  inst.dragDir = 1;
  inst.show = 0;
  inst.present.fill(0);
}

export function setState(inst: MicroSceneInstance, state: MicroSceneLifecycle): void {
  if (inst.state === state) return;
  inst.state = state;
  inst.since = 0;
}

export function live(inst: MicroSceneInstance): boolean {
  return inst.scene >= 0 && inst.state !== 'dormant';
}

/** A local point in a scene standing at `heading`, into world space. The game's own axes. */
export function localToWorld(
  originX: number,
  originZ: number,
  heading: number,
  lx: number,
  lz: number,
  out: { x: number; z: number },
): { x: number; z: number } {
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  out.x = originX + lx * c - lz * s;
  out.z = originZ + lx * s + lz * c;
  return out;
}

const POINT = { x: 0, z: 0 };

/**
 * Stand a scene up at an anchor: everyone and everything placed, the flags cleared, the loop at
 * its first beat. `present` is the cast this appearance, which the chosen variant may change.
 */
export function placeInstance(
  inst: MicroSceneInstance,
  sceneIndex: number,
  scene: MicroSceneDefinition,
  anchor: MicroSceneAnchor,
  present: readonly string[],
): void {
  clearInstance(inst);
  inst.scene = sceneIndex;
  inst.anchorId = anchor.id;
  inst.generation++;
  inst.x = anchor.transform.x;
  inst.y = anchor.transform.y ?? 0;
  inst.z = anchor.transform.z;
  inst.heading = anchor.transform.heading;
  // Away from whatever the anchor faces, which the world places facing the road.
  inst.awayX = -Math.sin(inst.heading);
  inst.awayZ = Math.cos(inst.heading);

  for (let i = 0; i < scene.actors.length && i < MAX_ACTORS; i++) {
    const a = scene.actors[i];
    // The anchor's slot is the authority where it has one; the actor's own offset is what the
    // body was BUILT at, and the renderer shifts it by the difference.
    const slot = anchor.actorSlots[a.slot];
    const lx = slot ? slot.x : a.offset.x;
    const lz = slot ? slot.z : a.offset.z;
    const lh = slot ? slot.heading : a.offset.heading;
    inst.localX[i] = lx;
    inst.localZ[i] = lz;
    inst.localHeading[i] = lh;
    localToWorld(inst.x, inst.z, inst.heading, lx, lz, POINT);
    inst.actorX[i] = POINT.x;
    inst.actorZ[i] = POINT.z;
    inst.actorY[i] = inst.y + (a.offset.y ?? 0);
    inst.actorHeading[i] = inst.heading + lh;
    inst.present[i] = present.includes(a.id) ? 1 : 0;
    // Deterministic from the actor's own seed, so a scene looks the same wherever it stands.
    inst.phase[i] = ((a.seed * 2654435761) % 1000) / 1000 * 20;
  }

  for (let i = 0; i < scene.props.length && i < MAX_PROPS; i++) {
    const p = scene.props[i];
    const slot = p.slot >= 0 ? anchor.propSlots[p.slot] : undefined;
    inst.propX[i] = slot ? slot.x : p.offset.x;
    inst.propZ[i] = slot ? slot.z : p.offset.z;
    inst.propHeading[i] = slot ? slot.heading : p.offset.heading;
  }

  // Whoever the scene says starts with the passed prop.
  inst.propHolder = scene.actors.findIndex((a) => !!a.holds && scene.props.some((p) => p.id === a.holds && p.transferable));
  setState(inst, 'prewarming');
  inst.beatLeft = 0;
}

/** Where an actor is standing right now, drives included. The audio's emitter and the look tests. */
export function actorPoint(inst: MicroSceneInstance, actor: number, out: { x: number; y: number; z: number }): void {
  out.x = inst.actorX[actor];
  out.y = inst.actorY[actor] + 1.5;
  out.z = inst.actorZ[actor];
}

/** Seconds a line of `text` takes, the way the street's other subtitles are timed. */
export function lineSeconds(text: string): number {
  const d = CFG.dialogue;
  return Math.min(d.maxSeconds, d.minSeconds + text.length * d.secondsPerChar);
}

/**
 * How long a line really lasts: the author's override, else the RECORDING's measured length
 * stretched by the rate its voice plays at, else the estimate from its text. Timing lines from the
 * recording is what stops a take that runs long from being cut by the next speaker.
 */
export function spokenSeconds(scene: MicroSceneDefinition, line: DialogueLine): number {
  if (line.seconds !== undefined) return line.seconds;
  const measured = CLIP_SECONDS[line.clip];
  if (measured === undefined) return lineSeconds(line.text);
  const voice = line.voice ?? scene.actors.find((a) => a.id === line.speaker)?.voice;
  const rate = (voice && VOICE_PROFILES[voice]?.rate) || 1;
  return measured / rate;
}

/** How long a whole variant runs, lines and gaps together. What "will they hear it" is judged on. */
export function variantSeconds(scene: MicroSceneDefinition, lines: readonly DialogueLine[]): number {
  let total = 0;
  for (let i = 0; i < lines.length; i++) {
    total += spokenSeconds(scene, lines[i]);
    if (i < lines.length - 1) total += lines[i].gapAfter ?? CFG.dialogue.gap;
  }
  return total;
}

/** Whether a trigger is the player's doing, which is the thing allowed only once per appearance. */
export function playerTrigger(trigger: ReactionTrigger): boolean {
  return trigger === 'aggressivePass' || trigger === 'slowPass' || trigger === 'horn' || trigger === 'observed';
}
