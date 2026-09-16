/**
 * URBAN MICRO-SCENES: the vocabulary. Nothing here runs; everything here is a shape a scene is
 * WRITTEN in, so a scene can be read, diffed, validated and catalogued without being played.
 *
 * A micro-scene is a short situation the city is already having when the player arrives: two or
 * three people, a prop or two, one conversation, and at most one reaction to the car going by.
 * It is never a mission, never a reward, never a prompt, and it never asks the player to stop.
 *
 * THE SPLIT THIS FILE EXISTS TO ENFORCE. The director (`runtime/director.ts`) knows about these
 * types and nothing about any particular scene; a scene (`scenes/*.ts`) knows about these types
 * and nothing about the director. Adding a scene is therefore: write a definition, point it at
 * shared behaviours and anchor types that already exist, and register it. No runtime file moves.
 *
 * TYPE-ONLY BY DESIGN. This module and every scene definition import nothing at runtime, so the
 * voice generator and the catalogue generator can load them straight into Node
 * (`scripts/generate-scene-voices.mjs`, `scripts/scene-catalog.mjs`).
 *
 * Conventions are the game's: metres, seconds, radians; heading 0 faces -z and grows clockwise.
 */

/* ================================================================== the world side */

/**
 * A place a micro-scene may happen. An anchor describes the PLACE, never the scene: "a bus
 * shelter on a wide pavement", not "the bus stop argument". The director matches the two.
 */
export interface MicroSceneAnchor {
  id: string;
  /** The primary kind of place. A scene lists the types it can occupy. */
  type: MicroSceneAnchorType;
  /** Everything else true about it. A scene may require or forbid some of these. */
  tags: MicroSceneAnchorTag[];
  /** Where the scene stands, and which way it faces. Actor and prop slots are relative to this. */
  transform: MicroSceneTransform;
  /** Room for people, in the anchor's own frame. An actor takes the slot its definition names. */
  actorSlots: MicroSceneTransform[];
  /** Room for things, same frame. A prop takes the slot its definition names. */
  propSlots: MicroSceneTransform[];
  /** Which way a car arrives past it, when the anchor sits on a one-way approach. */
  approachDirection?: { x: number; z: number };
  /** Metres from the nearest lane edge. The director refuses anchors too close to traffic. */
  roadClearance?: number;
  visibility?: 'open' | 'partially-hidden' | 'hidden';
  /** Absent means any hour. */
  allowedTimeOfDay?: MicroSceneTimeOfDay[];
  /**
   * Anchors that must not be busy while this one is. Both of Bandido Metro's bridge scenes sit
   * under the same deck, and two of them in one underpass is a set, not a city.
   */
  exclusiveWith?: string[];
}

/** Position, height and facing in world space (or in an anchor's frame, for a slot). */
export interface MicroSceneTransform {
  x: number;
  y?: number;
  z: number;
  heading: number;
}

/**
 * The kinds of place the city offers. A new kind means teaching `world/microSceneAnchors.ts`
 * how to find one; it does not mean touching the director.
 */
export type MicroSceneAnchorType =
  /** A bus shelter and the pavement in front of it. */
  | 'bus-stop'
  /** Ordinary kerb with room to stand: the commonest anchor in the city. */
  | 'roadside'
  /** Kerb outside shops, where a stall or an argument reads as belonging. */
  | 'commercial'
  /** Pavement wide enough for a stopped car and people round it. */
  | 'lay-by'
  /** Under the viaduct: columns, shade, nobody overlooking. */
  | 'under-bridge'
  /** Under an elevated road that is not the viaduct proper. */
  | 'under-highway'
  /** A corner the lamps miss. */
  | 'dark-corner'
  /** Between industrial blocks in the east. */
  | 'industrial-alley'
  /** An unlit service road nobody drives for its own sake. */
  | 'dark-service-road';

export type MicroSceneAnchorTag =
  | 'under-bridge'
  | 'commercial'
  | 'roadside'
  | 'bus-stop'
  | 'industrial'
  | 'dark'
  | 'wide-sidewalk'
  | 'police-compatible'
  | 'civilian'
  | 'hidden'
  | 'downtown'
  | 'waterfront';

export type MicroSceneTimeOfDay = 'dawn' | 'day' | 'dusk' | 'night';

/* ================================================================== the actors */

/**
 * Voice profiles are named per actor and may be overridden per line. They are a level of
 * indirection ON PURPOSE: a profile with no recorded voice yet still carries its speaker
 * assignments, and the variants that need it simply stay ineligible until it is configured.
 * See `voices.ts`.
 */
export type VoiceProfileId =
  | 'npc-masculino-1'
  | 'npc-masculino-2'
  | 'npc-femenina-1'
  | 'npc-femenina-2'
  | 'npc-policia-1';

/** Which wardrobe the renderer dresses an actor from. Cheap variations on the city's one body. */
export type MicroSceneCast =
  | 'civilian-m'
  | 'civilian-f'
  | 'worker'
  | 'mechanic'
  | 'officer'
  | 'driver'
  | 'vendor'
  | 'crew';

/** One person in a scene. */
export interface ActorDefinition {
  /** Referenced by dialogue, beats and reactions. Unique within the scene. */
  id: string;
  /** Which of the anchor's `actorSlots` they take. */
  slot: number;
  /**
   * Where they stand relative to the scene's own origin, which is what the renderer builds them
   * at. The anchor's slot, when it has one, is applied on top as an offset at spawn — so one
   * built body serves every anchor the scene can occupy.
   */
  offset: MicroSceneTransform;
  cast: MicroSceneCast;
  voice: VoiceProfileId;
  /** The idle loop underneath everything else, from the city's own act list. */
  act: MicroSceneAct;
  /** Blocks laid over the act, composed in order. */
  behaviors: SharedBehaviorId[];
  /** Counts against `performanceBudget.maxAnimatedActors`. Default true. */
  animated?: boolean;
  /** Sits rather than stands: the renderer drops and folds them. */
  seated?: boolean;
  /**
   * A prop carried in their hand. The renderer draws it at the hand bone rather than at a slot on
   * the ground, which is the same path a transferable prop travels — so a squeegee, a scanner and
   * a joint being passed are all one piece of code.
   */
  holds?: string;
  /**
   * An understudy: built with the rest of the cast, but only on the pavement for the dialogue
   * variants that name them (`DialogueVariant.present`). This is how one bus stop can be two men
   * and a woman waiting for the 82 on one appearance and two women mid-story on the next, without
   * the renderer building a second bus stop.
   */
  alternate?: boolean;
  /** Any integer: picks their clothes, hair and build out of the cast's lists. */
  seed: number;
}

/**
 * The subset of the city's acts (`render/scene/env/humanActs.ts`) a micro-scene actor may use.
 * Deliberately short: a scene composes shared behaviours, it does not invent animation.
 */
export type MicroSceneAct = 'stand' | 'chat' | 'phone' | 'film' | 'inspect' | 'vendor' | 'warm';

/* ================================================================== the props */

/** What a scene can put on the ground. Each kind is one piece of built geometry the art owns. */
export type MicroScenePropKind =
  | 'combustion-car'
  | 'tuned-coupe'
  | 'civilian-ev'
  | 'police-ev'
  | 'van'
  | 'table'
  | 'tarp'
  | 'boxes'
  | 'lamp'
  | 'ledge'
  | 'crate'
  | 'scanner'
  | 'holo-barrier'
  | 'joint'
  | 'bundle'
  | 'display-board';

export interface PropDefinition {
  id: string;
  kind: MicroScenePropKind;
  /** Which of the anchor's `propSlots` it wants. -1 for a prop carried rather than placed. */
  slot: number;
  /** Where it sits relative to the scene's origin. */
  offset: MicroSceneTransform;
  color?: number;
  /** A lit tip, a screen, a light bar: an emissive material, never a real light. */
  emissive?: number;
  /** Text on a display board. */
  text?: string;
  /** Passed hand to hand (`passSmallProp`). Exactly one holder at a time, ever. */
  transferable?: boolean;
  /** Dragged between two actors (`dragLargeProp`). */
  dragged?: boolean;
  /** Hazard lights on this vehicle (`playVehicleHazards`). */
  hazards?: boolean;
  /**
   * Steam or smoke rises from it (`emitLightSmoke`). On a vehicle it also means the bonnet is up:
   * there is no separate open-hood prop, because a hood placed by hand beside a car is a hood
   * that ends up inside it.
   */
  smokes?: boolean;
}

/* ================================================================== the behaviour blocks */

/**
 * The reusable blocks a scene composes instead of writing its own logic. Every one of them is
 * implemented once in `behaviors.ts` and drives the same small set of outputs, so a scene that
 * needs "they look at the car" costs a string, not a function.
 */
export type SharedBehaviorId =
  | 'idleConversation'
  | 'alternateSpeakerGestures'
  | 'lookAtPlayer'
  | 'lookAtPassingVehicle'
  | 'stepAwayFromRoad'
  | 'passSmallProp'
  | 'inspectObject'
  | 'coverTable'
  | 'watchForPolice'
  | 'hideHeldObject'
  | 'pauseWhenObserved'
  | 'dragLargeProp'
  | 'emitLightSmoke'
  | 'playVehicleHazards'
  | 'resumeAfterDelay';

/* ================================================================== the sequence */

/**
 * One step of the loop a scene plays while nothing else is happening. Beats are a RING: the last
 * one is followed by the first, with the pauses the scene asked for. They move props and cue
 * behaviours; they never branch, and they never wait on the player.
 */
export interface SceneBeat {
  id: string;
  /** How long it lasts. A range is rolled per pass so the loop never ticks like a metronome. */
  seconds: number | [number, number];
  /** Whose beat it is. */
  actor?: string;
  /** A behaviour pulsed for the length of the beat. */
  behavior?: SharedBehaviorId;
  /** The prop this beat moves. */
  prop?: string;
  /** Where the prop ends up: the actor receiving it, or the point it is dragged to. */
  to?: string;
}

/* ================================================================== the dialogue */

/** One spoken line. `clip` names a static file; nothing here is generated at runtime. */
export interface DialogueLine {
  /** An `ActorDefinition.id`. Validation fails on anything else. */
  speaker: string;
  text: string;
  /**
   * The clip id: `public/npc-voice/scenes/<clip>.mp3`, rendered by
   * `scripts/generate-scene-voices.mjs`. Unique across every scene.
   */
  clip: string;
  /** Overrides the speaker's profile for this line alone. */
  voice?: VoiceProfileId;
  /** Delivery direction for the generator (an audio tag, performed, never spoken). */
  direction?: string;
  /** Seconds of silence after it. Default `MICRO_SCENES.dialogue.gap`. */
  gapAfter?: number;
  /** Override the estimated length, when the recording is known to run long or short. */
  seconds?: number;
}

export interface DialogueVariant {
  id: string;
  /** For the catalogue and the debug list. */
  label: string;
  lines: DialogueLine[];
  /** Relative odds among the eligible variants. */
  weight: number;
  /** All must hold for the variant to be eligible at all. */
  conditions?: SceneCondition[];
  /**
   * Seconds of it the player must be able to hear for it to be worth starting. A long variant
   * sets this high so it is skipped rather than clipped (the bus stop's infidelity story).
   */
  minListenSeconds?: number;
  /**
   * Who is standing there while this one plays. Absent means everyone the scene does not mark
   * `alternate`. Never more than `performanceBudget.maxActors`; validation says so.
   */
  present?: string[];
}

/* ================================================================== conditions */

/**
 * Declarative eligibility. Evaluated against `MicroSceneSignals`, which is assembled once per
 * scan from state the game already keeps — no new detectors, and nothing here can change
 * anything.
 */
export type SceneCondition =
  /** The player is driving the combustion car (which, today, they always are). */
  | { kind: 'playerCombustionCar' }
  /** No pursuit under way. */
  | { kind: 'noPursuit' }
  /** No wanted stars at all. */
  | { kind: 'wantedNone' }
  /** At least this many stars. */
  | { kind: 'wantedAtLeast'; stars: number }
  /** No police car within `radius` metres. */
  | { kind: 'noPoliceNearby'; radius: number }
  /** Nothing else has the car: no mission, no ride, no run, no cinematic. */
  | { kind: 'noActivity' }
  /** Only at these hours, in worlds that have a clock. */
  | { kind: 'timeOfDay'; phases: MicroSceneTimeOfDay[] }
  /** Not before this many seconds of the session have passed. */
  | { kind: 'sessionAfter'; seconds: number }
  /** The player is approaching slowly enough to hear a conversation out. */
  | { kind: 'approachSlowerThan'; speed: number };

/* ================================================================== reactions */

/** What makes a scene notice the player or the world. All of them are existing game signals. */
export type ReactionTrigger =
  /** Blown past close and fast. */
  | 'aggressivePass'
  /** Gone by slowly, close enough to be looked at. */
  | 'slowPass'
  /** The horn. */
  | 'horn'
  /** Stopped or crawling nearby, pointed at them, for a while. */
  | 'observed'
  /** A police car came within the scene's police radius. */
  | 'policeNear'
  /** The player is wanted. */
  | 'playerWanted';

export interface SceneReaction {
  id: string;
  trigger: ReactionTrigger;
  /** Higher wins when two could fire on the same tick. */
  priority: number;
  /** Laid over the actors named, for `seconds`. */
  behaviors: SharedBehaviorId[];
  /** Which actors take it on. Empty or absent means everyone. */
  actors?: string[];
  /** What is said, if anything. At most a couple of lines. */
  lines?: DialogueLine[];
  /** How long the reaction holds the scene before the ambient loop resumes. */
  seconds: number;
  /** A randomized wait before the loop picks up again (`resumeAfterDelay`). */
  resumeAfter?: [number, number];
  /** Extra conditions on top of the trigger. */
  conditions?: SceneCondition[];
  /**
   * False lets a reaction fire again during the same appearance. Only the world-state ones
   * (police coming and going) ever set it; a player reaction is once, always.
   */
  once?: boolean;
}

/* ================================================================== policy and budget */

export interface InterruptionPolicy {
  /** What higher-priority audio does to a line already playing. */
  onPriorityAudio: 'fade' | 'cancel';
  /** What the player driving out of earshot does to the conversation. */
  onPlayerLeaves: 'fade' | 'cancel';
  /** Whether a reaction may cut the ambient conversation short. */
  reactionInterrupts: boolean;
  /** Whether the scene may pick its loop up after a reaction. */
  resumeAfterReaction: boolean;
}

export interface ScenePerformanceBudget {
  maxActors: number;
  maxAnimatedActors: number;
  maxParticles: number;
  allowsDynamicLights: boolean;
  allowsPhysics: boolean;
}

/** How finished a scene is. Shown in the catalogue so gaps are visible rather than discovered. */
export type SceneStatus = 'complete' | 'needs-audio' | 'needs-assets' | 'draft';

/* ================================================================== the definition */

export interface MicroSceneDefinition {
  id: string;
  title: string;
  description: string;
  category: MicroSceneCategory;
  tags: string[];

  compatibleAnchorTypes: MicroSceneAnchorType[];
  /** Tags the anchor must also carry. */
  requiredAnchorTags?: MicroSceneAnchorTag[];
  /** Tags that rule an anchor out. */
  forbiddenAnchorTags?: MicroSceneAnchorTag[];

  /** Relative odds against the other scenes eligible for an anchor. */
  weight: number;
  /** Seconds before this scene may appear again anywhere. */
  cooldownSeconds: number;

  /** Built and placed at this range, out of sight. */
  spawnDistance: number;
  /** The ambient loop starts running at this range. */
  activationDistance: number;
  /** A conversation may start inside this range. */
  dialogueDistance: number;
  /** Taken down past this range. */
  despawnDistance: number;

  actors: ActorDefinition[];
  props: PropDefinition[];

  /** Behaviours every actor in the scene carries. */
  sharedBehaviors: SharedBehaviorId[];
  ambientSequence: SceneBeat[];
  dialogueVariants: DialogueVariant[];
  reactions?: SceneReaction[];

  conditions?: SceneCondition[];
  interruptionPolicy: InterruptionPolicy;
  performanceBudget: ScenePerformanceBudget;

  /** Only one of these may exist at a time, anywhere. */
  unique?: boolean;
  /** Metres this scene keeps from another named scene already standing. */
  keepAwayFrom?: Array<{ sceneId: string; metres: number }>;
  status: SceneStatus;
}

export type MicroSceneCategory = 'civilian' | 'vehicle' | 'police' | 'commerce' | 'car-culture' | 'criminal';

/* ================================================================== the lifecycle */

/**
 * Dormant         - the slot is empty.
 * Prewarming      - built and placed, out of sight, nobody moving yet.
 * Ambient         - the loop is running; no conversation.
 * DialoguePlaying - one variant is being spoken, line by line.
 * Reacted         - a reaction has the scene.
 * CoolingDown     - said its piece; the loop runs on but nothing new starts.
 * Despawning      - being taken down.
 */
export type MicroSceneLifecycle =
  | 'dormant'
  | 'prewarming'
  | 'ambient'
  | 'dialoguePlaying'
  | 'reacted'
  | 'coolingDown'
  | 'despawning';
