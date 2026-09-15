import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BONE, HUMAN_BONE_COUNT, HUMAN_BONE_PARENT, buildHumanParts, restJoints, type HumanLook } from './humanFigure';
import { createActor, createPose, stepActor, type Actor, type BodyPose, type CrowdSubject, type HumanAct } from './humanActs';

/**
 * PEOPLE, MOVING, AT THE COST OF PEOPLE STANDING STILL.
 *
 * A crowd is any number of rigged bodies (`humanFigure.ts`) merged into ONE skinned mesh for
 * everything lit and ONE for everything that glows, on one skeleton of eleven bones a person.
 * The bones are posed on the CPU from what each person is doing (`humanActs.ts`): a handful of
 * trigonometry a person, written into bone rotations. Three turns those into one small float
 * texture and the GPU moves every vertex. So a crowd costs the same two draw calls it did when
 * it was a statue, plus one texture upload a frame — and a single passenger at a kerb is simply
 * a crowd of one.
 *
 * Nothing here is allocated per frame. The acts are stepped in `update`; the rest is Three's.
 */
export interface CrowdMember {
  look: HumanLook;
  /** Where they stand in the crowd's group, and which way they face (0 is -z, + clockwise). */
  x: number;
  y: number;
  z: number;
  heading: number;
  act: HumanAct;
  /** Any integer: keeps two people out of step. */
  seed: number;
  focus?: { x: number; z: number } | null;
  to?: { x: number; z: number };
}

export interface HumanCrowd {
  group: THREE.Group;
  readonly actors: readonly Actor[];
  readonly poses: readonly BodyPose[];
  /**
   * Step everyone by `dt` seconds at `time`, with the player's car in the group's own space (or
   * null), and pose the skeleton to match. With `awake`, only the people whose flag is set are
   * stepped; the rest hold the pose they were last left in.
   */
  update(time: number, dt: number, subject: CrowdSubject | null, awake?: Uint8Array): void;
  dispose(): void;
}

/** What is held is put away by scaling the hand bone to this rather than to zero, so nothing degenerates. */
const FOLDED_AWAY = 1e-4;

/** Per person: the bones a pose is written into. */
interface Rig {
  hips: THREE.Bone;
  spine: THREE.Bone;
  head: THREE.Bone;
  legL: THREE.Bone;
  legR: THREE.Bone;
  upperArmL: THREE.Bone;
  foreArmL: THREE.Bone;
  upperArmR: THREE.Bone;
  foreArmR: THREE.Bone;
  hand: THREE.Bone;
  hipY: number;
  cos: number;
  sin: number;
}

/** Replace a geometry's `aBone` with the skin attributes, every vertex wholly on one bone. */
function skin(geo: THREE.BufferGeometry, base: number, fixed = -1): void {
  const n = geo.getAttribute('position').count;
  const tag = geo.getAttribute('aBone');
  const index = new Uint16Array(n * 4);
  const weight = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    index[i * 4] = fixed >= 0 ? fixed : base + (tag ? tag.getX(i) : BONE.place);
    weight[i * 4] = 1;
  }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(index, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weight, 4));
  if (tag) geo.deleteAttribute('aBone');
}

export function createHumanCrowd(members: readonly CrowdMember[], name = 'crowd'): HumanCrowd {
  const group = new THREE.Group();
  group.name = name;
  const bones: THREE.Bone[] = [];
  const inverses: THREE.Matrix4[] = [];
  const rigs: Rig[] = [];
  const actors: Actor[] = [];
  const poses: BodyPose[] = [];
  const lit: THREE.BufferGeometry[] = [];
  const glow: THREE.BufferGeometry[] = [];
  const pools: THREE.BufferGeometry[] = [];
  const bounds = new THREE.Box3();

  for (let m = 0; m < members.length; m++) {
    const member = members[m];
    const parts = buildHumanParts(member.look);
    const base = bones.length;
    const rest = restJoints(parts.joints);
    for (let b = 0; b < HUMAN_BONE_COUNT; b++) {
      const bone = new THREE.Bone();
      const parent = HUMAN_BONE_PARENT[b];
      if (parent < 0) {
        bone.position.set(member.x, member.y, member.z);
        bone.rotation.y = -member.heading;
        group.add(bone);
      } else {
        bone.position.fromArray(parts.joints, b * 3);
        bones[base + parent].add(bone);
      }
      // Twist, then lean: a body leaning over a bonnet can still turn to look along it.
      if (b === BONE.spine || b === BONE.head || b === BONE.foreArmL || b === BONE.foreArmR) bone.rotation.order = 'YXZ';
      bones.push(bone);
      // The body is built standing at its own feet with nothing turned, so the bind pose of
      // every bone is just its joint's rest position.
      inverses.push(new THREE.Matrix4().makeTranslation(-rest[b * 3], -rest[b * 3 + 1], -rest[b * 3 + 2]));
    }
    const at = (bone: keyof typeof BONE): THREE.Bone => bones[base + BONE[bone]];
    rigs.push({
      hips: at('hips'),
      spine: at('spine'),
      head: at('head'),
      legL: at('legL'),
      legR: at('legR'),
      upperArmL: at('upperArmL'),
      foreArmL: at('foreArmL'),
      upperArmR: at('upperArmR'),
      foreArmR: at('foreArmR'),
      hand: at('hand'),
      hipY: parts.joints[BONE.hips * 3 + 1],
      cos: Math.cos(member.heading),
      sin: Math.sin(member.heading),
    });
    actors.push(
      createActor({
        act: member.act,
        x: member.x,
        z: member.z,
        heading: member.heading,
        arms: member.look.pose,
        seed: member.seed,
        focus: member.focus ?? null,
        to: member.to,
      }),
    );
    poses.push(createPose());

    skin(parts.body, base);
    lit.push(parts.body);
    if (parts.prop) {
      skin(parts.prop, base, base + BONE.place);
      lit.push(parts.prop);
    }
    if (parts.accent) {
      skin(parts.accent, base);
      glow.push(parts.accent);
    }
    if (parts.aura) {
      parts.aura.translate(member.x, member.y, member.z);
      pools.push(parts.aura);
    }
    bounds.expandByPoint(new THREE.Vector3(member.x, member.y, member.z));
    if (member.to) bounds.expandByPoint(new THREE.Vector3(member.to.x, member.y, member.to.z));
  }

  const skeleton = new THREE.Skeleton(bones, inverses);
  // Everyone the crowd could reach, with an arm in the air, whatever pose the vertices are in.
  const sphere = bounds.isEmpty() ? new THREE.Sphere(new THREE.Vector3(), 3) : bounds.getBoundingSphere(new THREE.Sphere());
  sphere.center.y += 1;
  sphere.radius += 3;
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];

  const addSkinned = (parts: THREE.BufferGeometry[], material: THREE.Material, suffix: string): void => {
    if (parts.length === 0) return;
    const geo = parts.length === 1 ? parts[0] : mergeGeometries(parts, false);
    if (parts.length > 1) for (const g of parts) g.dispose();
    if (!geo) return;
    const mesh = new THREE.SkinnedMesh(geo, material);
    mesh.name = `${name}-${suffix}`;
    mesh.bind(skeleton, new THREE.Matrix4());
    mesh.boundingSphere = sphere;
    group.add(mesh);
    geometries.push(geo);
    materials.push(material);
  };

  // Lit by the street's own two lights, like the kerb they stand on.
  addSkinned(lit, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.05 }), 'body');

  // The pools of light they stand in stay on the ground: not skinned, never posed.
  let poolMat: THREE.MeshBasicMaterial | null = null;
  if (pools.length > 0) {
    const geo = pools.length === 1 ? pools[0] : mergeGeometries(pools, false);
    if (pools.length > 1) for (const g of pools) g.dispose();
    if (geo) {
      poolMat = new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      const aura = new THREE.Mesh(geo, poolMat);
      aura.name = `${name}-aura`;
      aura.renderOrder = 2;
      group.add(aura);
      geometries.push(geo);
      materials.push(poolMat);
    }
  }

  const accentMat = glow.length > 0 ? new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, transparent: true, opacity: 0.95 }) : null;
  if (accentMat) addSkinned(glow, accentMat, 'accent');

  const apply = (r: Rig, p: BodyPose): void => {
    // `x`/`z` are in the group's space; the hips hang from `place`, which is turned to face.
    r.hips.position.set(p.x * r.cos + p.z * r.sin, r.hipY + p.lift, -p.x * r.sin + p.z * r.cos);
    r.hips.rotation.set(0, -p.turn, 0);
    r.spine.rotation.set(-p.lean, -p.twist, -p.tilt);
    r.head.rotation.set(-p.nod, -p.look, 0);
    r.legL.rotation.set(p.legL, 0, 0);
    r.legR.rotation.set(p.legR, 0, 0);
    r.upperArmL.rotation.set(p.raiseL, 0, -p.spreadL);
    r.upperArmR.rotation.set(p.raiseR, 0, p.spreadR);
    r.foreArmL.rotation.set(p.bendL, -p.crossL, 0);
    r.foreArmR.rotation.set(p.bendR, p.crossR, 0);
    r.hand.scale.setScalar(p.item > FOLDED_AWAY ? p.item : FOLDED_AWAY);
  };

  // Stand everyone in their first pose, so nothing is ever drawn in the bind pose.
  for (let i = 0; i < actors.length; i++) {
    stepActor(actors[i], 0, 0, null, poses[i]);
    apply(rigs[i], poses[i]);
  }

  return {
    group,
    actors,
    poses,
    update(time, dt, subject, awake) {
      // The lit parts breathe a little rather than sitting at one brightness, and the pools
      // under them breathe with them.
      if (accentMat) accentMat.color.setScalar(0.85 + 0.15 * Math.sin(time * 0.9));
      if (poolMat) poolMat.opacity = 0.64 + 0.1 * Math.sin(time * 0.9);
      for (let i = 0; i < actors.length; i++) {
        if (awake && !awake[i]) continue;
        stepActor(actors[i], time, dt, subject, poses[i]);
        apply(rigs[i], poses[i]);
      }
    },
    dispose() {
      group.removeFromParent();
      group.clear();
      for (const g of geometries) g.dispose();
      for (const mat of materials) mat.dispose();
      skeleton.dispose();
    },
  };
}

/* ================================================================== one person */

/** A person in the scene: the meshes, what they are doing, and the one call that throws it all away. */
export interface HumanFigureVisual {
  /** Positioned and turned by the caller. The figure stands at its origin, facing local -z. */
  group: THREE.Group;
  /**
   * Moves them on. `subject` is the player's car in WORLD space, if it should be noticed; the
   * figure works out where that is from where it has been put. Nothing allocated.
   */
  update(time: number, subject?: CrowdSubject | null): void;
  dispose(): void;
}

export interface HumanFigureOptions {
  /**
   * Offsets what they do, so two people standing near each other do not move in step. Any
   * number will do; a character's own hash is as good as anything.
   */
  phase?: number;
  /** Name given to the group, for anyone reading a scene graph in the debugger. */
  name?: string;
  /** What they do. Defaults to flagging the car down for a look that hails, standing otherwise. */
  act?: HumanAct;
}

/**
 * One person, as a crowd of one: two or three meshes, one skeleton, and whatever they are
 * doing. The caller moves `group`; the car they notice is handed over in world space and turned
 * into the group's own here, from the group's last world matrix.
 */
export function createHumanFigure(look: HumanLook, options: HumanFigureOptions = {}): HumanFigureVisual {
  const name = options.name ?? 'human';
  const crowd = createHumanCrowd(
    [
      {
        look,
        x: 0,
        y: 0,
        z: 0,
        heading: 0,
        act: options.act ?? (look.pose === 'hail' ? 'hail' : 'stand'),
        seed: Math.floor((options.phase ?? 0) * 997) + 1,
      },
    ],
    name,
  );
  const local: CrowdSubject = { x: 0, z: 0, speed: 0, drifting: false };
  let last = -1;

  return {
    group: crowd.group,
    update(time, subject) {
      const dt = last < 0 ? 0 : Math.min(0.1, Math.max(0, time - last));
      last = time;
      let seen: CrowdSubject | null = null;
      if (subject) {
        // World to the group's own space. The group is only ever moved and turned about y, so
        // the inverse is the transpose of its rotation — no matrix inverted, nothing allocated.
        const e = crowd.group.matrixWorld.elements;
        const dx = subject.x - e[12];
        const dz = subject.z - e[14];
        local.x = e[0] * dx + e[2] * dz;
        local.z = e[8] * dx + e[10] * dz;
        local.speed = subject.speed;
        local.drifting = subject.drifting;
        seen = local;
      }
      crowd.update(time, dt, seen);
    },
    dispose() {
      crowd.dispose();
    },
  };
}
