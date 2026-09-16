/**
 * THE SHARED BEHAVIOUR BLOCKS: the fifteen things people in a micro-scene ever do.
 *
 * WHY THEY EXIST. Eight scenes written each in its own way is eight little animation systems to
 * keep alive. So a scene composes STRINGS — `['idleConversation', 'lookAtPassingVehicle']` — and
 * every one of those is implemented exactly once, here. The bus stop's glance down the avenue and
 * the smoke circle's glance at a passing motor are the SAME glance.
 *
 * WHAT A BEHAVIOUR IS. A pure function of (context, output): it reads where the actor stands,
 * where the car is, whether the police are near, who is talking, and it ADDS to a small flat
 * record of drives (`ActorDrive`). It never allocates, never touches Three, never reads a clock
 * of its own, and never decides anything about the scene — the director owns the state machine,
 * the renderer owns the bodies. A drive is a request ("look there, 70% of the way"), not a pose.
 *
 * THIS IS NOT A SCRIPTING ENGINE and must not become one. There is no branching, no expressions,
 * no user-defined blocks: a fixed table of fifteen typed functions and a scene that names some of
 * them. If a scene needs a sixteenth thing, that is a sixteenth entry here, used by more than one
 * scene or it does not belong here at all.
 */

import type { MicroSceneLifecycle, ReactionTrigger, SharedBehaviorId } from './types';

/* ================================================================== the outputs */

/**
 * What a behaviour may ask for. The renderer lays these over whatever the actor's base act
 * (`render/scene/env/humanActs.ts`) already made, so "nothing" is a valid and common answer.
 */
export interface ActorDrive {
  /** A world point to turn towards, and how much of the way (0..1). */
  lookX: number;
  lookZ: number;
  lookWeight: number;
  /** Talking: mouth-level emphasis that moves the head and the hands (0..1). */
  speak: number;
  /** Hand emphasis on its own: a listener gesturing back, someone pointing at a wheel (0..1). */
  gesture: number;
  /** Metres to stand off the slot, in world axes. Small: a step, never a walk. */
  offsetX: number;
  offsetZ: number;
  /** Whatever is in the hand, shown (1) or put away (0). */
  item: number;
  /** Leaning over something to cover it, or crouching to a bonnet (0..1). */
  cover: number;
  /** Frozen mid-action (0..1). */
  still: number;
  /** Effort of hauling something heavy (0..1). */
  drag: number;
  /** How hard the scene's smoke prop is smoking (0..1). */
  smoke: number;
  /** Hazard lights on the scene's vehicle (0..1, already square-waved). */
  hazards: number;
}

export function createActorDrive(): ActorDrive {
  return {
    lookX: 0, lookZ: 0, lookWeight: 0, speak: 0, gesture: 0, offsetX: 0, offsetZ: 0,
    item: 1, cover: 0, still: 0, drag: 0, smoke: 0, hazards: 0,
  };
}

export function clearActorDrive(d: ActorDrive): void {
  d.lookX = d.lookZ = d.lookWeight = 0;
  d.speak = d.gesture = d.offsetX = d.offsetZ = 0;
  d.item = 1;
  d.cover = d.still = d.drag = d.smoke = d.hazards = 0;
}

/* ================================================================== the input */

/** Everything a behaviour is allowed to know. Assembled once per actor per frame, never allocated. */
export interface BehaviorContext {
  /** Seconds since the scene appeared. */
  time: number;
  dt: number;
  /** The actor's own clock offset, so two people never move in step. */
  phase: number;
  /** Index into the scene's actors; -1 for the scene-level pass that drives its props. */
  actor: number;
  /** Where the actor stands, in world space. */
  x: number;
  z: number;
  /** Which way they face when nothing has turned them (rad). */
  heading: number;

  /** The player's car. */
  playerX: number;
  playerZ: number;
  playerSpeed: number;
  playerDistance: number;
  /** Closing speed towards this actor (m/s, positive is coming at them). */
  playerClosing: number;

  /** The nearest police car, and how far off it is. `Infinity` when there is none. */
  policeX: number;
  policeZ: number;
  policeDistance: number;
  /** 0..1, eased: how alarmed the scene is by the police right now. */
  alarm: number;

  /** 0..1: how long the player has sat there looking at them. */
  observed: number;

  /** Away from the road, unit length: which way a step back goes. */
  awayX: number;
  awayZ: number;

  /** Who is talking (actor index), or -1. */
  speaker: number;
  /** Whether this actor is the one talking. */
  speaking: boolean;
  /** How far through the current line we are, 0..1. */
  lineProgress: number;

  state: MicroSceneLifecycle;
  reaction: ReactionTrigger | null;
  /** Seconds left of the pause before the loop picks up again. */
  resumeIn: number;

  /** Which actor holds the passed prop, where it is going, and how far along (0..1). */
  propHolder: number;
  propTo: number;
  propTransfer: number;
  /** 0..1 along the drag the scene's dragged prop is making. */
  dragProgress: number;
  /** Whether the beat running right now asked for this actor's drag or pass. */
  beatActive: boolean;
}

export function createBehaviorContext(): BehaviorContext {
  return {
    time: 0, dt: 0, phase: 0, actor: -1, x: 0, z: 0, heading: 0,
    playerX: 0, playerZ: 0, playerSpeed: 0, playerDistance: Infinity, playerClosing: 0,
    policeX: 0, policeZ: 0, policeDistance: Infinity, alarm: 0, observed: 0,
    awayX: 0, awayZ: 1, speaker: -1, speaking: false, lineProgress: 0,
    state: 'dormant', reaction: null, resumeIn: 0,
    propHolder: -1, propTo: -1, propTransfer: 0, dragProgress: 0, beatActive: false,
  };
}

/* ================================================================== arithmetic */

function hash(a: number, b: number): number {
  const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return v - Math.floor(v);
}

function ease(x: number): number {
  const t = x < 0 ? 0 : x > 1 ? 1 : x;
  return t * t * (3 - 2 * t);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** 0..1: whether they are doing a thing this `period`, with odds `chance`, eased across the change. */
function spell(t: number, period: number, chance: number, salt: number): number {
  const u = t / period;
  const i = Math.floor(u);
  const a = hash(i, salt) < chance ? 1 : 0;
  const b = hash(i + 1, salt) < chance ? 1 : 0;
  return a + (b - a) * ease((u - i - 0.8) / 0.2);
}

/** Look at a point, blended in on top of whatever was asked for before. */
function lookAt(out: ActorDrive, x: number, z: number, weight: number): void {
  if (weight <= out.lookWeight) return;
  out.lookX = x;
  out.lookZ = z;
  out.lookWeight = weight > 1 ? 1 : weight;
}

/* ================================================================== the blocks */

export type BehaviorFn = (ctx: BehaviorContext, out: ActorDrive) => void;

/** What the catalogue and the validator know about a block, beyond its name. */
export interface BehaviorSpec {
  id: SharedBehaviorId;
  /** One line, for `SCENE_CATALOG.md` and the debug list. */
  summary: string;
  /** Drives it writes: what a scene is buying by naming it. */
  drives: Array<keyof ActorDrive>;
  /** True when it is about the scene's props rather than one person's body. */
  sceneLevel: boolean;
  run: BehaviorFn;
}

/**
 * Talking and listening, desynchronised. The mouth is not simulated: this is the body language of
 * a conversation already in progress — weight shifts, a nod at the right moment, hands that come
 * up while a point is being made. While a real line is playing it defers to the line.
 */
const idleConversation: BehaviorFn = (ctx, out) => {
  const t = ctx.time + ctx.phase;
  if (ctx.speaker >= 0) {
    // A line is playing: whoever is not speaking listens.
    if (!ctx.speaking) out.gesture = Math.max(out.gesture, 0.18 * spell(t, 2.6, 0.4, ctx.actor + 3));
    return;
  }
  const turn = spell(t, 5.5, 0.45, ctx.actor + 11);
  out.speak = Math.max(out.speak, turn * (0.45 + 0.2 * Math.sin(t * 3.1)));
  out.gesture = Math.max(out.gesture, turn * 0.5);
};

/**
 * The hands follow WHOEVER IS TALKING. The speaker gestures on the stressed part of their line;
 * everybody else answers with small head and hand movements, which is what makes two people
 * reading recorded lines look like two people having an argument.
 */
const alternateSpeakerGestures: BehaviorFn = (ctx, out) => {
  if (ctx.speaker < 0) return;
  const t = ctx.time + ctx.phase;
  if (ctx.speaking) {
    // Rises into the line and falls away at the end of it, so nobody waves through a full stop.
    const shape = ease(ctx.lineProgress / 0.25) * (1 - ease((ctx.lineProgress - 0.75) / 0.25));
    out.speak = Math.max(out.speak, 0.55 + 0.35 * Math.sin(t * 4.3) * shape);
    out.gesture = Math.max(out.gesture, shape * (0.5 + 0.35 * hash(ctx.actor, 5)));
  } else {
    out.gesture = Math.max(out.gesture, 0.22 * spell(t, 1.9, 0.5, ctx.actor + 17));
  }
};

/** Turn and look at the car, whether it is moving or not. A held look, not a glance. */
const lookAtPlayer: BehaviorFn = (ctx, out) => {
  if (ctx.playerDistance > NOTICE.look) return;
  const w = 1 - ctx.playerDistance / NOTICE.look;
  lookAt(out, ctx.playerX, ctx.playerZ, w * w * 0.9);
};

/**
 * A GLANCE at something going past: it lands as the car gets close, and lets go once it has gone
 * by. A stationary car gets nothing — this is the head turn a motor earns, not attention.
 */
const lookAtPassingVehicle: BehaviorFn = (ctx, out) => {
  if (ctx.playerSpeed < NOTICE.movingSpeed || ctx.playerDistance > NOTICE.glance) return;
  const near = 1 - ctx.playerDistance / NOTICE.glance;
  // Loudest while it is still coming; fades as it leaves.
  const coming = ctx.playerClosing > 0 ? 1 : 0.45;
  lookAt(out, ctx.playerX, ctx.playerZ, near * near * coming * 0.85);
};

/** A step back off the kerb when something is coming at them fast. Never more than a step. */
const stepAwayFromRoad: BehaviorFn = (ctx, out) => {
  if (ctx.playerDistance > NOTICE.flinch || ctx.playerClosing < NOTICE.flinchClosing) return;
  const w = (1 - ctx.playerDistance / NOTICE.flinch) * NOTICE.step;
  out.offsetX += ctx.awayX * w;
  out.offsetZ += ctx.awayZ * w;
};

/**
 * The joint going round. The holder has it in their hand; the receiver reaches for it as the pass
 * runs; nobody in between has anything. The prop itself is moved by the renderer along the same
 * `propTransfer` this reads, so what is in the hand and what is drawn cannot disagree.
 */
const passSmallProp: BehaviorFn = (ctx, out) => {
  const passing = ctx.propTo >= 0 && ctx.propTransfer > 0;
  if (ctx.actor === ctx.propHolder) {
    out.item = 1;
    // Offering it across: the arm comes up over the first half of the pass.
    if (passing) out.gesture = Math.max(out.gesture, ease(ctx.propTransfer / 0.5) * 0.8);
    else out.gesture = Math.max(out.gesture, 0.25 + 0.35 * spell(ctx.time + ctx.phase, 4, 0.35, ctx.actor + 23));
  } else if (passing && ctx.actor === ctx.propTo) {
    // Reaching for it: the hand goes out over the second half.
    out.item = 0;
    out.gesture = Math.max(out.gesture, ease((ctx.propTransfer - 0.4) / 0.6) * 0.8);
  } else {
    out.item = 0;
  }
};

/** Bent over a bonnet, a table, a part: leaning in, with the odd point at what is wrong. */
const inspectObject: BehaviorFn = (ctx, out) => {
  const t = ctx.time + ctx.phase;
  out.cover = Math.max(out.cover, 0.35 + 0.25 * spell(t, 6, 0.5, ctx.actor + 31));
  out.gesture = Math.max(out.gesture, 0.3 * spell(t, 4.5, 0.4, ctx.actor + 37));
};

/** Over the table, arms spread across whatever is on it. Only while the scene is alarmed. */
const coverTable: BehaviorFn = (ctx, out) => {
  if (ctx.alarm <= 0) return;
  out.cover = Math.max(out.cover, ctx.alarm);
  out.gesture = Math.max(out.gesture, ctx.alarm * 0.6);
};

/** An eye on the police: a look their way whenever one is within reach, harder the nearer it is. */
const watchForPolice: BehaviorFn = (ctx, out) => {
  if (!Number.isFinite(ctx.policeDistance) || ctx.policeDistance > NOTICE.police) return;
  const w = 1 - ctx.policeDistance / NOTICE.police;
  lookAt(out, ctx.policeX, ctx.policeZ, w * w);
};

/** Whatever is in the hand goes away while the police are about, and stays away. */
const hideHeldObject: BehaviorFn = (ctx, out) => {
  if (ctx.alarm <= 0) return;
  out.item = Math.min(out.item, 1 - ctx.alarm);
};

/** Stop dead while the player is sitting there watching. The most unsettling thing a body can do. */
const pauseWhenObserved: BehaviorFn = (ctx, out) => {
  if (ctx.observed <= 0) return;
  out.still = Math.max(out.still, ctx.observed);
  if (ctx.observed > 0.6) lookAt(out, ctx.playerX, ctx.playerZ, ctx.observed);
};

/** Hauling something heavy between two people: braced, short of breath, moving in shoves. */
const dragLargeProp: BehaviorFn = (ctx, out) => {
  if (!ctx.beatActive) return;
  const shove = 0.5 + 0.5 * Math.sin((ctx.time + ctx.phase) * 2.2);
  out.drag = Math.max(out.drag, 0.55 + 0.45 * shove);
  out.cover = Math.max(out.cover, 0.45);
};

/** A thin column of steam or smoke, pulsing rather than streaming. Scene level: it is the prop's. */
const emitLightSmoke: BehaviorFn = (ctx, out) => {
  const t = ctx.time + ctx.phase;
  // Intermittent on purpose — a hose that is losing it, not a machine that is making it.
  const pulse = spell(t, 3.4, 0.55, 3) * (0.55 + 0.45 * Math.sin(t * 1.7));
  out.smoke = Math.max(out.smoke, clamp01(pulse) * (1 - ctx.alarm));
};

/** The double blink of a car parked where it should not be. Scene level. */
const playVehicleHazards: BehaviorFn = (ctx, out) => {
  const blink = ((ctx.time * 1.4) % 1) < 0.5 ? 1 : 0;
  out.hazards = Math.max(out.hazards, blink);
};

/** Nothing picks up straight away after a fright: everything is damped while the pause runs. */
const resumeAfterDelay: BehaviorFn = (ctx, out) => {
  if (ctx.resumeIn <= 0) return;
  const hold = clamp01(ctx.resumeIn / RESUME_RAMP);
  out.speak *= 1 - hold;
  out.gesture *= 1 - hold;
  out.smoke *= 1 - hold;
  out.still = Math.max(out.still, hold * 0.5);
};

/* ================================================================== the table */

/** Ranges the blocks share, so "near enough to notice" means one thing across all eight scenes. */
const NOTICE = {
  /** A held look at the car starts inside this (m). */
  look: 26,
  /** A glance at a moving car starts inside this (m). */
  glance: 34,
  /** Under this (m/s) a car is parked as far as anybody is concerned. */
  movingSpeed: 3,
  /** A step back happens inside this (m) at this closing speed (m/s). */
  flinch: 9,
  flinchClosing: 7,
  /** How far that step goes (m). */
  step: 0.4,
  /** A police car is worth looking at inside this (m). */
  police: 45,
};

/** Seconds of the resume pause across which everything is still damped. */
const RESUME_RAMP = 2.5;

export const SHARED_BEHAVIORS: Record<SharedBehaviorId, BehaviorSpec> = {
  idleConversation: {
    id: 'idleConversation',
    summary: 'A conversation already in progress: weight shifts, nods, hands on a point being made.',
    drives: ['speak', 'gesture'],
    sceneLevel: false,
    run: idleConversation,
  },
  alternateSpeakerGestures: {
    id: 'alternateSpeakerGestures',
    summary: 'The hands follow whoever is talking; everybody else answers in small movements.',
    drives: ['speak', 'gesture'],
    sceneLevel: false,
    run: alternateSpeakerGestures,
  },
  lookAtPlayer: {
    id: 'lookAtPlayer',
    summary: 'A held look at the car, moving or not.',
    drives: ['lookX', 'lookZ', 'lookWeight'],
    sceneLevel: false,
    run: lookAtPlayer,
  },
  lookAtPassingVehicle: {
    id: 'lookAtPassingVehicle',
    summary: 'A glance at a motor going past, let go once it has gone.',
    drives: ['lookX', 'lookZ', 'lookWeight'],
    sceneLevel: false,
    run: lookAtPassingVehicle,
  },
  stepAwayFromRoad: {
    id: 'stepAwayFromRoad',
    summary: 'One step back off the kerb from something coming at them fast.',
    drives: ['offsetX', 'offsetZ'],
    sceneLevel: false,
    run: stepAwayFromRoad,
  },
  passSmallProp: {
    id: 'passSmallProp',
    summary: 'A small prop handed on: one holder at a time, the receiver reaching for it.',
    drives: ['item', 'gesture'],
    sceneLevel: false,
    run: passSmallProp,
  },
  inspectObject: {
    id: 'inspectObject',
    summary: 'Bent over a bonnet or a table, pointing at what is wrong with it.',
    drives: ['cover', 'gesture'],
    sceneLevel: false,
    run: inspectObject,
  },
  coverTable: {
    id: 'coverTable',
    summary: 'Arms out over whatever is on the table, while the scene is alarmed.',
    drives: ['cover', 'gesture'],
    sceneLevel: false,
    run: coverTable,
  },
  watchForPolice: {
    id: 'watchForPolice',
    summary: 'An eye kept on the nearest police car.',
    drives: ['lookX', 'lookZ', 'lookWeight'],
    sceneLevel: false,
    run: watchForPolice,
  },
  hideHeldObject: {
    id: 'hideHeldObject',
    summary: 'Whatever is in the hand goes away while the police are about.',
    drives: ['item'],
    sceneLevel: false,
    run: hideHeldObject,
  },
  pauseWhenObserved: {
    id: 'pauseWhenObserved',
    summary: 'Stop dead while the player sits there watching, and look back.',
    drives: ['still', 'lookWeight'],
    sceneLevel: false,
    run: pauseWhenObserved,
  },
  dragLargeProp: {
    id: 'dragLargeProp',
    summary: 'Two people hauling something heavy, in shoves.',
    drives: ['drag', 'cover'],
    sceneLevel: false,
    run: dragLargeProp,
  },
  emitLightSmoke: {
    id: 'emitLightSmoke',
    summary: 'A thin intermittent column of steam or smoke from the scene prop that makes it.',
    drives: ['smoke'],
    sceneLevel: true,
    run: emitLightSmoke,
  },
  playVehicleHazards: {
    id: 'playVehicleHazards',
    summary: 'The double blink of a car parked where it should not be.',
    drives: ['hazards'],
    sceneLevel: true,
    run: playVehicleHazards,
  },
  resumeAfterDelay: {
    id: 'resumeAfterDelay',
    summary: 'Everything damped while the pause after a fright runs out.',
    drives: ['speak', 'gesture', 'smoke', 'still'],
    sceneLevel: false,
    run: resumeAfterDelay,
  },
};

export const SHARED_BEHAVIOR_IDS = Object.keys(SHARED_BEHAVIORS) as SharedBehaviorId[];

/** Whether a string names a block. What validation asks before a scene is allowed to reference it. */
export function isSharedBehavior(id: string): id is SharedBehaviorId {
  return Object.prototype.hasOwnProperty.call(SHARED_BEHAVIORS, id);
}

/**
 * Run a composition of blocks into `out`. `resumeAfterDelay` is always run LAST whatever order the
 * scene wrote its list in: it damps what the others asked for, so it cannot be the one damped.
 */
export function runBehaviors(ids: readonly SharedBehaviorId[], ctx: BehaviorContext, out: ActorDrive): void {
  for (let i = 0; i < ids.length; i++) {
    const spec = SHARED_BEHAVIORS[ids[i]];
    if (spec && spec.id !== 'resumeAfterDelay') spec.run(ctx, out);
  }
  for (let i = 0; i < ids.length; i++) {
    if (ids[i] === 'resumeAfterDelay') SHARED_BEHAVIORS.resumeAfterDelay.run(ctx, out);
  }
}

/** Exposed for the tests and the debug list: the ranges the blocks share. */
export const BEHAVIOR_RANGES = NOTICE;
