import * as THREE from 'three';
import { CROWD, VEHICLE } from '../../config/tuning';
import type { CarMeetSpec, MeetPersonSpec } from '../../world/carMeet';
import { buildBodyGeometry, buildGlassGeometry, buildTailGeometry } from './carVisual';
import type { CrowdSubject, HumanAct } from './env/humanActs';
import type { HumanHead, HumanLook } from './env/humanFigure';
import { createHumanCrowd, type CrowdMember } from './env/humanRig';
import { buildWheelGeometry } from './vehicles/wheel';

/**
 * THE CARS AND PEOPLE AT A MEET (`world/carMeet.ts`). The parked cars are the Bandidos' coupe,
 * the rivals' car (`rivalCarVisual.ts`), but a rival costs five draw calls and a meet parks
 * sixteen of them: so here each part is ONE instanced mesh for every car at every meet — body,
 * glass, tail lamps, wheels — with the paint as the instance colour. The people are the shared
 * body (`env/humanFigure.ts`) as one skinned crowd (`env/humanRig.ts`): one lit mesh and one for
 * their lit bits, whoever is filming, pacing or warming their hands. Seven draw calls for the
 * whole meet, and none at all once the car is far enough away that the haze has taken the lot.
 *
 * The light they throw (underglow, sill tubes, head lamps on the ground) is static art in the
 * city's own glow and neon batches (`env/meetBuilder.ts`), from the same list of cars.
 *
 * The cars stand still; the people do not. Nothing is allocated per frame.
 */
export interface MeetVisual {
  root: THREE.Group;
  /**
   * Show the meets only while the camera is near enough to see them, and move the people on
   * while it is: `subject` is the player's car, which they notice.
   */
  update(camX?: number, camZ?: number, time?: number, dt?: number, subject?: CrowdSubject | null): void;
  dispose(): void;
}

/** Past this (m) from a lot's middle the meet is not drawn: the city's own cull is 850 m, the haze takes a car well before. */
const SHOW_WITHIN = 420;
const WHEEL_WIDTH = 0.26;
const HALF_TRACK = VEHICLE.trackWidth / 2;
const HALF_BASE = VEHICLE.wheelbase / 2;

/** What people at a meet wear: dark, with the odd colour. */
const SKIN = [0xd9a37f, 0xa86f4c, 0x7a4b30, 0xf0c7a4, 0xc58c63, 0x5c3a26];
const HAIR = [0x14100e, 0x2a1b12, 0x0c0c10, 0x6b4a2b, 0x1a1012];
const COAT = [0x15181e, 0x2a2f36, 0x3b1f2b, 0x1d2a3a, 0x56606a, 0x0f1c14, 0x6a1c22, 0xd8d8d0];
const LEGS = [0x1b1f27, 0x2b3444, 0x121316, 0x3a3f47, 0x4a4f3a];
const HEADS: HumanHead[] = ['crop', 'cap', 'hood', 'mop', 'tied', 'fringe', 'cap'];
const BANDS = [0x3fe8ff, 0x39ff6a, 0xff2fb4];
/** A phone screen at night: cold white, or the blue of a feed. */
const SCREENS = [0xcfe6ff, 0x8fc4ff, 0xe8f2ff];

function pick<T>(list: readonly T[], seed: number, salt: number): T {
  const v = Math.abs(Math.sin(seed * 12.9898 + salt * 78.233) * 43758.5453) % 1;
  return list[Math.floor(v * list.length) % list.length];
}

/** One person's look from their kind and seed. */
export function meetLook(p: MeetPersonSpec): HumanLook {
  const s = p.seed;
  const look: HumanLook = {
    height: 0.92 + pick([0, 0.02, 0.05, 0.08, 0.1], s, 1),
    build: 0.9 + pick([0, 0.05, 0.12, 0.2], s, 2),
    skin: pick(SKIN, s, 3),
    hair: pick(HAIR, s, 4),
    head: pick(HEADS, s, 5),
    headwear: pick(COAT, s, 6),
    coat: pick(COAT, s, 7),
    coatLength: pick([0.05, 0.3, 0.55, 0.8], s, 8),
    legs: pick(LEGS, s, 9),
    boots: 0x121216,
    pose: 'idle',
    eyes: 'none',
  };
  if (s % 3 === 0) look.band = pick(BANDS, s, 10);
  switch (p.kind) {
    case 'camera':
      look.prop = 'camera';
      look.eyeColor = 0xff2e2e;
      break;
    case 'folded':
      look.pose = 'folded';
      break;
    case 'pocket':
      look.pose = 'pocket';
      break;
    case 'cooler':
      look.prop = 'cooler';
      look.propColor = 0x2d6fb8;
      look.propAccent = 0xffd9a0;
      break;
    case 'case':
      look.pose = 'pocket';
      look.prop = 'case';
      look.propColor = 0x1a1d22;
      look.propAccent = 0x3fe8ff;
      break;
    default:
      break;
  }
  // Anyone might take a phone out: the screen is only there while they do.
  if (look.prop !== 'camera') look.phone = pick(SCREENS, s, 11);
  return look;
}

/** What someone does when the meet's data does not say. */
function defaultAct(p: MeetPersonSpec): HumanAct {
  switch (p.kind) {
    case 'camera':
      return 'film';
    case 'cooler':
      return 'vendor';
    case 'case':
    case 'phone':
      return 'phone';
    default:
      return 'chat';
  }
}

/** Talking is to somebody: the nearest other person within a few steps, if there is one. */
function nearestPartner(p: MeetPersonSpec, people: readonly MeetPersonSpec[]): { x: number; z: number } | null {
  let best: MeetPersonSpec | null = null;
  let bestD = 4.5;
  for (const q of people) {
    if (q === p) continue;
    const d = Math.hypot(q.x - p.x, q.z - p.z);
    if (d < bestD) {
      bestD = d;
      best = q;
    }
  }
  return best ? { x: best.x, z: best.z } : null;
}

/** One person at a meet, as the crowd builds them. */
export function meetMember(p: MeetPersonSpec, index: number, people: readonly MeetPersonSpec[]): CrowdMember {
  const act = p.act ?? defaultAct(p);
  return {
    look: meetLook(p),
    x: p.x,
    y: 0.03,
    z: p.z,
    heading: p.to ? Math.atan2(p.to.x - p.x, -(p.to.z - p.z)) : p.heading,
    act,
    seed: p.seed * 31 + index,
    focus: p.focus ?? (act === 'chat' || act === 'stand' ? nearestPartner(p, people) : null),
    to: p.to,
  };
}

export function createMeetVisual(meets: readonly CarMeetSpec[]): MeetVisual {
  const root = new THREE.Group();
  root.name = 'car-meets';
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const centres = meets.map((m) => ({ x: (m.lot.minX + m.lot.maxX) / 2, z: (m.lot.minZ + m.lot.maxZ) / 2 }));

  const cars = meets.flatMap((m) => m.cars);

  if (cars.length > 0) {
    const body = buildBodyGeometry();
    const glass = buildGlassGeometry();
    const tail = buildTailGeometry();
    const wheel = buildWheelGeometry(VEHICLE.wheelRadius, WHEEL_WIDTH, 12);
    geometries.push(body, glass, tail, wheel);

    // The rival's paint (`tintBody`), with the colour moved from the material to the instance.
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x6b6b6b, vertexColors: true, roughness: 0.38, metalness: 0.32, emissive: 0x040506 });
    // A shade over the rivals' 0.42: parked, they are looked at rather than glimpsed.
    bodyMat.color.setScalar(0.5);
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x0b1c26,
      roughness: 0.06,
      metalness: 0.55,
      transparent: true,
      opacity: 0.7,
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    const tailMat = new THREE.MeshStandardMaterial({ color: 0x180205, emissive: 0xff1a2e, emissiveIntensity: 1.2, vertexColors: true, roughness: 0.3 });
    const darkTailMat = new THREE.MeshStandardMaterial({ color: 0x2a0508, emissive: 0x3a0308, emissiveIntensity: 0.4, vertexColors: true, roughness: 0.3 });
    const wheelMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.45 });
    materials.push(bodyMat, glassMat, tailMat, darkTailMat, wheelMat);

    const lit = cars.filter((c) => c.tail);
    const unlit = cars.filter((c) => !c.tail);
    const bodies = new THREE.InstancedMesh(body, bodyMat, cars.length);
    const glasses = new THREE.InstancedMesh(glass, glassMat, cars.length);
    const tails = new THREE.InstancedMesh(tail, tailMat, Math.max(1, lit.length));
    const darkTails = new THREE.InstancedMesh(tail, darkTailMat, Math.max(1, unlit.length));
    const wheels = new THREE.InstancedMesh(wheel, wheelMat, cars.length * 4);
    tails.count = lit.length;
    darkTails.count = unlit.length;

    const m = new THREE.Matrix4();
    const w = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const pos = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    const paint = new THREE.Color();
    const carMatrix = (c: (typeof cars)[number], out: THREE.Matrix4): THREE.Matrix4 =>
      // The one heading mapping outside `render/sync.ts` follows the same rule it does.
      out.compose(pos.set(c.x, 0, c.z), q.setFromAxisAngle(up, -c.heading), one);
    const wheelAt: Array<[number, number, boolean]> = [
      [-HALF_TRACK, -HALF_BASE, true],
      [HALF_TRACK, -HALF_BASE, true],
      [-HALF_TRACK - 0.02, HALF_BASE, false],
      [HALF_TRACK + 0.02, HALF_BASE, false],
    ];
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      carMatrix(c, m);
      bodies.setMatrixAt(i, m);
      glasses.setMatrixAt(i, m);
      bodies.setColorAt(i, paint.set(c.paint));
      for (let k = 0; k < 4; k++) {
        const [x, z, front] = wheelAt[k];
        w.compose(pos.set(x, VEHICLE.wheelRadius, z), q.setFromAxisAngle(up, front ? -(c.steer ?? 0) : 0), one);
        wheels.setMatrixAt(i * 4 + k, w.premultiply(m));
      }
    }
    lit.forEach((c, i) => tails.setMatrixAt(i, carMatrix(c, m)));
    unlit.forEach((c, i) => darkTails.setMatrixAt(i, carMatrix(c, m)));
    for (const mesh of [bodies, glasses, tails, darkTails, wheels]) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      root.add(mesh);
    }
    if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true;
    bodies.name = 'meet-car-bodies';
    wheels.name = 'meet-car-wheels';
  }

  // The people: one crowd for every meet, two skinned draw calls, posed from what each of them
  // is doing (`env/humanActs.ts`).
  const people = meets.flatMap((m) => m.people);
  const crowd = people.length > 0 ? createHumanCrowd(people.map((p, i) => meetMember(p, i, people)), 'meet-people') : null;
  if (crowd) root.add(crowd.group);
  let stride = 0;
  let owed = 0;

  return {
    root,
    update(camX, camZ, time = 0, dt = 0, subject = null) {
      if (camX === undefined || camZ === undefined) return;
      let nearest = Infinity;
      for (let i = 0; i < centres.length; i++) nearest = Math.min(nearest, Math.hypot(centres[i].x - camX, centres[i].z - camZ));
      root.visible = nearest < SHOW_WITHIN;
      if (!crowd || !root.visible) return;
      // Level of detail: every frame up close, every few frames across the lot, and not at all
      // once they are a few pixels tall. A skipped frame's time is owed to the next step.
      owed += dt;
      if (nearest > CROWD.animateWithin) return;
      stride = (stride + 1) % CROWD.farStride;
      if (nearest > CROWD.fullWithin && stride !== 0) return;
      crowd.update(time, Math.min(owed, 0.25), subject);
      owed = 0;
    },
    dispose() {
      crowd?.dispose();
      root.removeFromParent();
      root.clear();
      for (const g of geometries) g.dispose();
      for (const mat of materials) mat.dispose();
    },
  };
}
