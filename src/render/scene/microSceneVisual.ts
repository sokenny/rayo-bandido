import * as THREE from 'three';
import { CROWD, MICRO_SCENES as CFG } from '../../config/tuning';
import {
  clearActorDrive,
  createActorDrive,
  createBehaviorContext,
  runBehaviors,
  type ActorDrive,
  type BehaviorContext,
} from '../../microScenes/behaviors';
import { MICRO_SCENES } from '../../microScenes/registry';
import type { MicroSceneRuntime } from '../../microScenes/runtime/director';
import type { MicroSceneInstance } from '../../microScenes/runtime/instance';
import { MAX_ACTORS } from '../../microScenes/runtime/instance';
import type { ActorDefinition, MicroSceneCast, MicroSceneDefinition, PropDefinition } from '../../microScenes/types';
import { createParticlePool, type ParticlePool } from '../fx/particlePool';
import type { BodyPose, CrowdSubject } from './env/humanActs';
import type { HumanHead, HumanLook } from './env/humanFigure';
import { applyHaze } from './env/haze';
import { createHumanCrowd, type CrowdMember, type HumanCrowd } from './env/humanRig';
import { boardTexture, buildSceneProps, primeVehicleShells, type MicroScenePropSet } from './microSceneProps';

/**
 * THE MICRO-SCENES, DRAWN. The rules (`src/microScenes/runtime/director.ts`) decide what stands
 * where, who is talking and what everybody is reacting to; this file is the only thing that turns
 * any of that into a body.
 *
 * BUILT ONCE PER SCENE, NOT PER APPEARANCE. The first time a scene ever goes up, its cast becomes
 * one skinned crowd (`env/humanRig.ts`: two draw calls for everybody) and its furniture becomes
 * three merged geometries (`microSceneProps.ts`). Every later appearance MOVES that group to the
 * new anchor rather than building anything, which is what makes a scene going up cost nothing at
 * the moment the player would notice it. Nothing is allocated per frame.
 *
 * THE BODIES ARE THE CITY'S OWN. Every actor is the same rigged figure the meet, the bus stops and
 * the hustlers use, doing one of the same acts (`env/humanActs.ts`). What a micro-scene adds is a
 * layer over that act: the shared behaviour blocks produce a flat record of DRIVES (look there,
 * talk, gesture, step back, put that away, freeze), and `applyDrives` writes them into the pose
 * the act already made, through the crowd's own edit hook. The act stays the city's; the behaviour
 * stays the scene's; neither has to know about the other.
 *
 * ONE BODY SET PER SCENE means one appearance of a scene at a time, which the director enforces.
 * Two bus shelters having the same conversation a street apart would have been worse anyway.
 *
 * AN ANCHOR MAY MOVE PEOPLE. The bodies are built at the scene's own canonical layout; an anchor
 * with its own actor slots (the bus shelters have one, because the shelter dictates where anybody
 * can stand) shifts them by the difference at spawn, as a pose offset. So one built bus stop fits
 * every shelter in Bandido Metro.
 */

export interface MicroSceneVisual {
  root: THREE.Group;
  /**
   * Once a frame. `subject` is the player's car in world space, which the people notice through
   * the crowd's own reactions; `vx`/`vz` are its velocity, which is what tells a glance at a motor
   * going past from a step back out of its way; `camX`/`camZ` decide what is worth animating.
   */
  update(
    rt: MicroSceneRuntime,
    time: number,
    frameDt: number,
    camX: number,
    camZ: number,
    subject: CrowdSubject,
    vx: number,
    vz: number,
  ): void;
  /** Scenes drawn, people stepped and live particles. For the debug readout. */
  stats(): { scenes: number; actors: number; particles: number; builds: number };
  dispose(): void;
}

/* ================================================================== the wardrobe */

const SKIN = [0xe0b08c, 0xc58c63, 0xa86f4c, 0x8a5a3a, 0x6e4530, 0xd9a37f, 0xb98260];
const HAIR = [0x14100e, 0x2a1b12, 0x0c0c10, 0x4a3322, 0x6b4a2b];
const COAT = [0x15181e, 0x2a2f36, 0x3b1f2b, 0x1d2a3a, 0x56606a, 0x0f1c14, 0x6a1c22, 0x8a7a5c];
const LEGS = [0x1b1f27, 0x2b3444, 0x121316, 0x3a3f47, 0x4a4f3a];
const SHOES = [0xd6d2c8, 0x3a3a40, 0x8a8f96, 0x1b1b1f];
const HEADS: HumanHead[] = ['crop', 'cap', 'hood', 'mop', 'tied', 'fringe', 'bucket'];
const SCREENS = [0xcfe6ff, 0x8fc4ff, 0xe8f2ff];

function pick<T>(list: readonly T[], seed: number, salt: number): T {
  let h = (Math.imul(Math.floor(seed), 374761393) + Math.imul(salt, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return list[(h >>> 0) % list.length];
}

/**
 * What an actor wears, from their cast and seed. Cheap variations on one body, the way the meet's
 * crowd and the hustlers do it: nothing here is a new asset.
 */
export function microSceneLook(actor: ActorDefinition): HumanLook {
  const s = actor.seed;
  const look: HumanLook = {
    height: 0.92 + pick([0, 0.03, 0.06, 0.09], s, 1),
    build: 0.9 + pick([0, 0.06, 0.13, 0.2], s, 2),
    skin: pick(SKIN, s, 3),
    hair: pick(HAIR, s, 4),
    head: pick(HEADS, s, 5),
    headwear: pick(COAT, s, 6),
    coat: pick(COAT, s, 7),
    coatLength: pick([0.05, 0.3, 0.55], s, 8),
    legs: pick(LEGS, s, 9),
    boots: pick(SHOES, s, 10),
    pose: 'idle',
    eyes: 'none',
    // Everybody gets the pool of light El Búho has had from the start: a person at a kerb at
    // night is otherwise not there at all from down the street.
    aura: 0xffb070,
    auraRadius: 1.5,
  };
  const cast: MicroSceneCast = actor.cast;
  switch (cast) {
    case 'civilian-f':
      look.head = pick(['tied', 'mop', 'fringe', 'crop'] as HumanHead[], s, 11);
      look.build = 0.82 + pick([0, 0.05, 0.1], s, 12);
      look.height = 0.88 + pick([0, 0.03, 0.05], s, 13);
      look.phone = pick(SCREENS, s, 14);
      break;
    case 'officer':
      look.coat = 0x1c2733;
      look.legs = 0x161c24;
      look.head = 'cap';
      look.headwear = 0x121820;
      look.band = 0x3fd0ff;
      look.eyes = 'visor';
      look.eyeColor = 0x3fd0ff;
      break;
    case 'worker':
      look.vest = 0xff6a13;
      look.band = 0xd9f2c4;
      look.head = pick(['cap', 'hood', 'crop'] as HumanHead[], s, 15);
      break;
    case 'mechanic':
      look.coat = 0x2b3038;
      look.vest = 0x4a4f3a;
      look.prop = 'toolbag';
      look.propColor = 0x2a2e34;
      break;
    case 'vendor':
      look.prop = 'case';
      look.propColor = 0x3b4550;
      look.propAccent = 0xffb020;
      look.head = pick(['cap', 'bucket'] as HumanHead[], s, 16);
      break;
    case 'crew':
      look.prop = 'camera';
      look.eyeColor = 0xff2e2e;
      look.phone = pick(SCREENS, s, 17);
      break;
    case 'driver':
      look.pose = 'pocket';
      look.phone = pick(SCREENS, s, 18);
      break;
    default:
      look.phone = pick(SCREENS, s, 19);
      break;
  }
  return look;
}

/* ================================================================== one built scene */

interface LooseMesh {
  prop: PropDefinition;
  mesh: THREE.Mesh;
  /** Which actor carries it, or -1 for a dragged or standing prop. */
  holder: number;
}

/**
 * A material the fade touches, with how it was BORN. Restoring the original flags rather than
 * assuming opaque is the whole point: the pool of light under a person and the hazard lamps are
 * transparent by design, and a fade that switched them to opaque on the way in left the lamps
 * unable to blink and the light pools drawn as solid discs.
 */
interface Fading {
  material: THREE.Material;
  transparent: boolean;
  depthWrite: boolean;
  opacity: number;
}

interface Built {
  scene: MicroSceneDefinition;
  group: THREE.Group;
  crowd: HumanCrowd;
  props: MicroScenePropSet;
  blink: THREE.MeshBasicMaterial | null;
  loose: LooseMesh[];
  /** Everything whose opacity the fade touches, and how each of them was born. */
  materials: Fading[];
  geometries: THREE.BufferGeometry[];
  drives: ActorDrive[];
  awake: Uint8Array;
  /** Which slot is using it, or -1. */
  slot: number;
  shown: number;
}

/** Below this the people are stepped every `CROWD.farStride` frames instead of every frame. */
const FULL_WITHIN = CROWD.fullWithin;

/* ================================================================== the materials */

/**
 * THE THREE MATERIAL FAMILIES A SCENE USES, each made the same way every time — which is the
 * whole point. Three compiles a program the first time a material is drawn, so a scene going up
 * mid-play used to cost one compile; one primer of each family, added to the root at construction
 * and left invisible, means the game's warm-up (`render/warmup.ts`) has already paid for them
 * behind the loading screen. A second material with the same configuration reuses the program.
 */
function litMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.18 });
  // A little of its own colour as light, exactly as the street props and the storm grates do it:
  // this city is lit by a hemisphere over a very weak key, and a dark car parked at a kerb on wet
  // asphalt at night is otherwise not there at all.
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += diffuseColor.rgb * 0.34;',
    );
  };
  applyHaze(mat);
  return mat;
}

function glowMaterial(blink = false): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, transparent: blink, opacity: 1 });
}

function boardMaterial(map: THREE.Texture | null, fallback: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ map, toneMapped: false, side: THREE.DoubleSide, color: map ? 0xffffff : fallback });
}

/** A speck of geometry carrying one of each family, so the warm-up compiles all three. */
function primer(): THREE.Object3D {
  const group = new THREE.Group();
  group.name = 'micro-scene-primer';
  const speck = (): THREE.BufferGeometry => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute([1, 1, 1, 1, 1, 1, 1, 1, 1], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 2));
    return g;
  };
  for (const mat of [litMaterial(), glowMaterial(), boardMaterial(boardTexture(' ', 0xffffff), 0xffffff)]) {
    const mesh = new THREE.Mesh(speck(), mat);
    mesh.frustumCulled = false;
    mesh.visible = false;
    group.add(mesh);
  }
  return group;
}

/* ================================================================== the visual */

const HAND = new THREE.Vector3();
const HAND_B = new THREE.Vector3();
const LOCAL_SUBJECT: CrowdSubject = { x: 0, z: 0, speed: 0, drifting: false };

export function createMicroSceneVisual(): MicroSceneVisual {
  const root = new THREE.Group();
  root.name = 'micro-scenes';
  root.userData.probeIgnore = true;
  const loose = new THREE.Group();
  loose.name = 'micro-scene-props';
  root.add(loose);
  // Present from the start so the warm-up pays for the programs, never a frame the player watches.
  root.add(primer());
  // Same reasoning for the car shells: lofting one costs more than everything else a scene builds.
  primeVehicleShells();

  const built = new Map<number, Built>();
  const ctx: BehaviorContext = createBehaviorContext();
  let builds = 0;
  let stride = 0;

  /* ---------------------------------------------------------------- the smoke */

  const puff = makePuffTexture();
  const pool: ParticlePool = puff
    ? createParticlePool({
        name: 'micro-scene-smoke',
        capacity: CFG.maxParticles,
        map: puff,
        blending: THREE.NormalBlending,
        baseSize: 0.55,
        opacity: 0.26,
        accelY: 0.4,
        drag: 0.5,
        endScale: 3.4,
        fadePower: 1.4,
        fadeIn: 0.12,
        fog: true,
      })
    : (null as unknown as ParticlePool);
  if (pool) root.add(pool.object);
  /** Seconds of smoke owed, so a low rate still emits at a steady average. */
  let owedSmoke = 0;

  /* ---------------------------------------------------------------- building */

  function build(sceneIndex: number): Built | null {
    const scene = MICRO_SCENES[sceneIndex];
    if (!scene) return null;
    const group = new THREE.Group();
    group.name = `micro-scene-${scene.id}`;
    const materials: Fading[] = [];
    const geometries: THREE.BufferGeometry[] = [];
    const fading = (m: THREE.Material): THREE.Material => {
      materials.push({ material: m, transparent: m.transparent, depthWrite: m.depthWrite, opacity: m.opacity });
      return m;
    };

    const members: CrowdMember[] = scene.actors.map((a) => ({
      look: microSceneLook(a),
      x: a.offset.x,
      y: 0,
      z: a.offset.z,
      heading: a.offset.heading,
      act: a.act,
      seed: a.seed,
      // Somebody to talk to: whoever else is in the scene, so `chat` has a focus.
      focus: focusFor(scene, a),
    }));
    const crowd = createHumanCrowd(members, `micro-${scene.id}`);
    group.add(crowd.group);

    const props = buildSceneProps(scene);
    if (props.lit) {
      const mat = litMaterial();
      const mesh = new THREE.Mesh(props.lit, mat);
      mesh.name = `${scene.id}-lit`;
      group.add(mesh);
      fading(mat);
      geometries.push(props.lit);
    }
    if (props.glow) {
      const mat = glowMaterial();
      const mesh = new THREE.Mesh(props.glow, mat);
      mesh.name = `${scene.id}-glow`;
      group.add(mesh);
      fading(mat);
      geometries.push(props.glow);
    }
    let blink: THREE.MeshBasicMaterial | null = null;
    if (props.blink) {
      blink = glowMaterial(true);
      const mesh = new THREE.Mesh(props.blink, blink);
      mesh.name = `${scene.id}-hazards`;
      group.add(mesh);
      fading(blink);
      geometries.push(props.blink);
    }
    for (const board of props.boards) {
      const mat = boardMaterial(board.texture, board.prop.emissive ?? 0xffb020);
      const mesh = new THREE.Mesh(board.geometry, mat);
      mesh.name = `${scene.id}-board`;
      group.add(mesh);
      fading(mat);
      geometries.push(board.geometry);
    }

    const looseMeshes: LooseMesh[] = props.loose.map((l) => {
      const mat = l.glow
        ? new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false })
        : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.1 });
      const mesh = new THREE.Mesh(l.geometry, mat);
      mesh.name = `${scene.id}-${l.prop.id}`;
      mesh.visible = false;
      loose.add(mesh);
      fading(mat);
      geometries.push(l.geometry);
      return { prop: l.prop, mesh, holder: scene.actors.findIndex((a) => a.holds === l.prop.id) };
    });

    // The crowd's own materials fade with everything else — including its light pools, which were
    // born transparent and have to be given back exactly as they were.
    crowd.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material;
      if (Array.isArray(mat)) for (const m of mat) fading(m);
      else if (mat) fading(mat);
    });

    const out: Built = {
      scene,
      group,
      crowd,
      props,
      blink,
      loose: looseMeshes,
      materials,
      geometries,
      drives: scene.actors.map(() => createActorDrive()),
      awake: new Uint8Array(MAX_ACTORS),
      slot: -1,
      shown: -1,
    };
    built.set(sceneIndex, out);
    builds++;
    return out;
  }

  /** Whoever an actor is talking to: the nearest other actor in the scene. */
  function focusFor(scene: MicroSceneDefinition, actor: ActorDefinition): { x: number; z: number } | null {
    let best: ActorDefinition | null = null;
    let bestD = Infinity;
    for (const other of scene.actors) {
      if (other === actor) continue;
      const d = Math.hypot(other.offset.x - actor.offset.x, other.offset.z - actor.offset.z);
      if (d < bestD) {
        bestD = d;
        best = other;
      }
    }
    return best ? { x: best.offset.x, z: best.offset.z } : null;
  }

  /* ---------------------------------------------------------------- the fade */

  function fade(b: Built, show: number): void {
    if (Math.abs(b.shown - show) < 0.01) return;
    const wasOpaque = b.shown >= 0.999;
    b.shown = show;
    const done = show >= 0.999;
    for (const f of b.materials) {
      const m = f.material;
      m.opacity = done ? f.opacity : f.opacity * show;
      // Only pay for the blend-mode flip while it is actually fading — it costs a program
      // re-resolve, and a scene is at full strength for all but half a second of its life. A
      // material that was born transparent goes back to being transparent, not to being opaque.
      if (done !== wasOpaque) {
        m.transparent = done ? f.transparent : true;
        m.depthWrite = done ? f.depthWrite : false;
        m.needsUpdate = true;
      }
    }
  }

  /* ---------------------------------------------------------------- the drives */

  function driveActors(
    b: Built,
    inst: MicroSceneInstance,
    time: number,
    dt: number,
    subject: CrowdSubject,
    vx: number,
    vz: number,
  ): void {
    const scene = b.scene;
    const beat = scene.ambientSequence[inst.beat];
    const reaction = inst.reaction >= 0 ? scene.reactions?.[inst.reaction] : undefined;
    const speaker = speakingActor(inst, scene);

    for (let i = 0; i < scene.actors.length; i++) {
      const actor = scene.actors[i];
      const drive = b.drives[i];
      clearActorDrive(drive);
      if (!inst.present[i]) {
        b.awake[i] = 0;
        continue;
      }
      ctx.time = time;
      ctx.dt = dt;
      ctx.phase = inst.phase[i];
      ctx.actor = i;
      ctx.x = inst.actorX[i];
      ctx.z = inst.actorZ[i];
      ctx.heading = inst.actorHeading[i];
      ctx.playerX = subject.x;
      ctx.playerZ = subject.z;
      ctx.playerSpeed = subject.speed;
      const dx = ctx.x - subject.x;
      const dz = ctx.z - subject.z;
      const dist = Math.hypot(dx, dz);
      ctx.playerDistance = dist;
      // How fast the gap is closing: the car's velocity along the line to them. Positive while it
      // is coming at them, negative once it has gone by.
      ctx.playerClosing = dist > 1e-3 ? (vx * dx + vz * dz) / dist : subject.speed;
      ctx.policeX = inst.policeX;
      ctx.policeZ = inst.policeZ;
      ctx.policeDistance = inst.policeDistance;
      ctx.alarm = inst.alarm;
      ctx.observed = inst.observed;
      ctx.awayX = inst.awayX;
      ctx.awayZ = inst.awayZ;
      ctx.speaker = speaker;
      ctx.speaking = speaker === i;
      ctx.lineProgress = inst.lineTotal > 0 ? 1 - Math.max(0, inst.lineLeft) / inst.lineTotal : 0;
      ctx.state = inst.state;
      ctx.reaction = reaction ? reaction.trigger : null;
      ctx.resumeIn = inst.resumeLeft;
      ctx.propHolder = inst.propHolder;
      ctx.propTo = inst.propTo;
      ctx.propTransfer = inst.propTransfer;
      ctx.dragProgress = inst.dragProgress;
      ctx.beatActive = !beat || !beat.actor || beat.actor === actor.id;

      runBehaviors(scene.sharedBehaviors, ctx, drive);
      runBehaviors(actor.behaviors, ctx, drive);
      // A reaction lays its own blocks over the actors it names.
      if (reaction && (!reaction.actors || reaction.actors.length === 0 || reaction.actors.includes(actor.id))) {
        runBehaviors(reaction.behaviors, ctx, drive);
      }
      // Frozen is frozen: a person who has stopped dead is not stepped at all.
      b.awake[i] = drive.still > 0.7 ? 0 : 1;
    }
  }

  /** Which actor is speaking right now, or -1. */
  function speakingActor(inst: MicroSceneInstance, scene: MicroSceneDefinition): number {
    if (inst.line < 0 || inst.inGap) return -1;
    const lines = inst.lineSource === 'reaction' ? scene.reactions?.[inst.reaction]?.lines : scene.dialogueVariants[inst.variant]?.lines;
    const line = lines?.[inst.line];
    if (!line) return -1;
    return scene.actors.findIndex((a) => a.id === line.speaker);
  }

  /** Lay one actor's drives over the pose their act has already made. */
  function applyDrives(b: Built, inst: MicroSceneInstance, i: number, pose: BodyPose): void {
    const actor = b.scene.actors[i];
    if (!actor) return;
    if (!inst.present[i]) {
      // Not in this appearance's cast: put them under the street rather than build a second body.
      pose.lift = -6;
      return;
    }
    const drive = b.drives[i];
    const c = Math.cos(inst.heading);
    const s = Math.sin(inst.heading);

    // The anchor's own slot, as a shift from where the body was built.
    pose.x += inst.localX[i] - actor.offset.x;
    pose.z += inst.localZ[i] - actor.offset.z;
    pose.turn += inst.localHeading[i] - actor.offset.heading;
    // A step back, from world axes into the scene's frame.
    pose.x += drive.offsetX * c + drive.offsetZ * s;
    pose.z += -drive.offsetX * s + drive.offsetZ * c;

    if (drive.lookWeight > 0) {
      const dx = drive.lookX - inst.actorX[i];
      const dz = drive.lookZ - inst.actorZ[i];
      const want = Math.atan2(dx, -dz);
      let delta = want - (inst.heading + inst.localHeading[i]);
      delta -= Math.PI * 2 * Math.floor((delta + Math.PI) / (Math.PI * 2));
      const w = drive.lookWeight;
      // The head goes first, then the shoulders, then — for a hard look — the body.
      pose.look += clamp(delta * w, -1.1, 1.1);
      pose.twist += clamp(delta * w * 0.4, -0.5, 0.5);
      if (w > 0.75) pose.turn += clamp(delta * (w - 0.75) * 2, -0.9, 0.9);
    }

    if (drive.speak > 0) {
      const t = ctx.time + inst.phase[i];
      pose.nod += Math.sin(t * 5.1) * 0.06 * drive.speak;
      pose.tilt += Math.sin(t * 2.3) * 0.05 * drive.speak;
    }
    if (drive.gesture > 0) {
      const t = ctx.time + inst.phase[i] * 1.7;
      const g = drive.gesture;
      pose.raiseR += (0.5 + 0.25 * Math.sin(t * 3.4)) * g;
      pose.bendR += (0.9 + 0.3 * Math.sin(t * 4.1)) * g;
      pose.spreadR += 0.25 * g;
      pose.raiseL += (0.2 + 0.15 * Math.sin(t * 2.7 + 1.3)) * g * 0.6;
      pose.bendL += (0.5 + 0.2 * Math.sin(t * 3.1 + 0.7)) * g * 0.6;
    }
    if (drive.cover > 0) {
      pose.lean += 0.42 * drive.cover;
      pose.raiseL += 0.55 * drive.cover;
      pose.raiseR += 0.55 * drive.cover;
      pose.bendL += 0.5 * drive.cover;
      pose.bendR += 0.5 * drive.cover;
    }
    if (drive.drag > 0) {
      pose.lean += 0.3 * drive.drag;
      pose.raiseL += 0.35 * drive.drag;
      pose.raiseR += 0.35 * drive.drag;
      pose.lift -= 0.12 * drive.drag;
    }
    if (actor.seated) {
      // Sitting: hips down, knees forward. The bench is the shelter's or the ledge's.
      pose.lift -= 0.42;
      pose.legL += 1.25;
      pose.legR += 1.2;
      pose.lean += 0.1;
    }
    // What is in the hand: the rig folds it away at 0.
    pose.item = drive.item;
  }

  /* ---------------------------------------------------------------- loose props */

  function placeLoose(b: Built, inst: MicroSceneInstance): void {
    for (const l of b.loose) {
      const prop = l.prop;
      if (prop.dragged) {
        // Between the two people hauling it, creeping along as the beats shove it.
        const draggers = b.scene.actors
          .map((a, i) => (a.behaviors.includes('dragLargeProp') && inst.present[i] ? i : -1))
          .filter((i) => i >= 0);
        if (draggers.length < 2) {
          l.mesh.visible = false;
          continue;
        }
        b.crowd.handAt(draggers[0], HAND);
        b.crowd.handAt(draggers[1], HAND_B);
        l.mesh.position.lerpVectors(HAND, HAND_B, 0.5);
        l.mesh.position.y = inst.y + 0.24;
        l.mesh.rotation.y = -(Math.atan2(HAND_B.x - HAND.x, -(HAND_B.z - HAND.z)) + Math.PI / 2);
        l.mesh.visible = b.shown > 0.05;
        continue;
      }

      // Carried: whoever has it, or in flight between two hands.
      let holder = l.holder;
      if (prop.transferable) holder = inst.propHolder;
      if (inst.propTo >= 0 && inst.propFrom >= 0 && prop.transferable) {
        b.crowd.handAt(inst.propFrom, HAND);
        b.crowd.handAt(inst.propTo, HAND_B);
        l.mesh.position.lerpVectors(HAND, HAND_B, inst.propTransfer);
        // A little lift through the middle of the pass, so it arcs rather than slides.
        l.mesh.position.y += Math.sin(inst.propTransfer * Math.PI) * 0.06;
        l.mesh.visible = b.shown > 0.05;
        continue;
      }
      if (holder < 0 || !inst.present[holder]) {
        l.mesh.visible = false;
        continue;
      }
      b.crowd.handAt(holder, HAND);
      l.mesh.position.copy(HAND);
      l.mesh.rotation.y = -inst.actorHeading[holder];
      // Put away with the hand: `hideHeldObject` is what the police reaction drives.
      l.mesh.visible = b.shown > 0.05 && b.drives[holder].item > 0.25;
    }
  }

  /* ---------------------------------------------------------------- the frame */

  function emitSmoke(b: Built, inst: MicroSceneInstance, dt: number, camX: number, camZ: number): void {
    if (!pool) return;
    const prop = b.scene.props.find((p) => p.smokes);
    if (!prop) return;
    // The scene-level pass drives the props: actor -1, at the scene's own origin.
    const rate = b.drives.reduce((m, d) => Math.max(m, d.smoke), 0);
    if (rate <= 0.02) return;
    if (Math.hypot(inst.x - camX, inst.z - camZ) > b.scene.activationDistance) return;
    // Out of the prop's own nose — the body's local -z — and then into the world through the
    // scene's frame. Doing it the other way round puts the steam beside a car parked sideways.
    // The body is built with its nose at its own local -z; turned by the prop's heading that
    // lands at (+sin, -cos) of the car's centre, which is the same forward vector the rest of the
    // game uses. Getting the sign wrong here puts the steam out of the boot.
    const ph = prop.offset.heading;
    const lx = prop.offset.x + Math.sin(ph) * 1.9;
    const lz = prop.offset.z - Math.cos(ph) * 1.9;
    const c = Math.cos(inst.heading);
    const s = Math.sin(inst.heading);
    const px = inst.x + lx * c - lz * s;
    const pz = inst.z + lx * s + lz * c;
    owedSmoke += rate * 7 * dt;
    while (owedSmoke >= 1) {
      owedSmoke -= 1;
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.18;
      pool.spawn(
        px + Math.cos(a) * r,
        inst.y + 1.15 + Math.random() * 0.1,
        pz + Math.sin(a) * r,
        (Math.random() - 0.5) * 0.12,
        0.5 + Math.random() * 0.35,
        (Math.random() - 0.5) * 0.12,
        0.35 + Math.random() * 0.25,
        1.2 + Math.random() * 0.8,
        0.82,
        0.84,
        0.88,
      );
    }
  }

  const visual: MicroSceneVisual = {
    root,

    update(rt, time, frameDt, camX, camZ, subject, vx, vz) {
      stride = (stride + 1) % Math.max(1, CROWD.farStride);
      // Everything that was up last frame and is not now goes back to the shelf.
      for (const b of built.values()) {
        const inst = b.slot >= 0 ? rt.instances[b.slot] : null;
        if (!inst || inst.scene < 0 || MICRO_SCENES[inst.scene] !== b.scene) {
          if (b.group.parent) root.remove(b.group);
          for (const l of b.loose) l.mesh.visible = false;
          b.slot = -1;
        }
      }

      for (const inst of rt.instances) {
        if (inst.scene < 0) continue;
        let b = built.get(inst.scene) ?? null;
        if (!b) b = build(inst.scene);
        if (!b) continue;
        // One body set per scene: if another slot already has it, this one is not drawn rather
        // than the two of them fighting over the group every frame. The director keeps to the
        // same rule, so this is a guard and not a mode.
        if (b.slot >= 0 && b.slot !== inst.slot && rt.instances[b.slot]?.scene === inst.scene) continue;
        if (b.slot !== inst.slot) {
          b.slot = inst.slot;
          b.shown = -1;
        }
        if (!b.group.parent) root.add(b.group);

        b.group.position.set(inst.x, inst.y, inst.z);
        b.group.rotation.y = -inst.heading;
        fade(b, inst.show);

        // Hazards: one material change for however many lamps the scene has.
        if (b.blink) {
          const on = b.drives.reduce((m, d) => Math.max(m, d.hazards), 0);
          b.blink.opacity = inst.show * (0.12 + 0.88 * on);
        }

        const far = inst.distance > FULL_WITHIN;
        const step = far && stride !== 0 ? 0 : frameDt * (far ? CROWD.farStride : 1);
        driveActors(b, inst, time, frameDt, subject, vx, vz);
        if (step > 0 && inst.distance < b.scene.despawnDistance) {
          // The car, in the scene's own frame: the crowd's reactions expect it there.
          const c = Math.cos(inst.heading);
          const s = Math.sin(inst.heading);
          const dx = subject.x - inst.x;
          const dz = subject.z - inst.z;
          LOCAL_SUBJECT.x = dx * c + dz * s;
          LOCAL_SUBJECT.z = -dx * s + dz * c;
          LOCAL_SUBJECT.speed = subject.speed;
          LOCAL_SUBJECT.drifting = subject.drifting;
          b.crowd.update(time, step, LOCAL_SUBJECT, b.awake, (i, pose) => applyDrives(b!, inst, i, pose));
        }
        placeLoose(b, inst);
        emitSmoke(b, inst, frameDt, camX, camZ);
      }

      if (pool) pool.update(frameDt);
    },

    stats() {
      let scenes = 0;
      let actors = 0;
      for (const b of built.values()) {
        if (b.slot < 0) continue;
        scenes++;
        for (let i = 0; i < b.awake.length; i++) actors += b.awake[i];
      }
      return { scenes, actors, particles: pool ? pool.live : 0, builds };
    },

    dispose() {
      for (const b of built.values()) {
        b.crowd.dispose();
        b.group.removeFromParent();
        b.group.clear();
        for (const g of b.geometries) g.dispose();
        for (const f of b.materials) f.material.dispose();
        for (const l of b.loose) l.mesh.removeFromParent();
      }
      built.clear();
      pool?.dispose();
      puff?.dispose();
      root.removeFromParent();
      root.clear();
    },
  };

  return visual;
}

/* ================================================================== helpers */

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** A soft grey puff, the same shape the sewers steam with. */
function makePuffTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const S = 64;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const g = canvas.getContext('2d');
  if (!g) return null;
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.5, 'rgba(238,240,246,0.28)');
  grad.addColorStop(1, 'rgba(228,230,238,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(canvas);
  tex.name = 'micro-scene-smoke';
  return tex;
}
