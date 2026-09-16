import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CROWD, HUSTLERS } from '../../config/tuning';
import type { HustlerSpot, HustlerState } from '../../core/types';
import {
  foamCleared,
  hustlerAt,
  signalAt,
  squeegeeAt,
  walkSeconds,
  type BeatPoint,
  type SignalColor,
  type SignalReading,
  type SqueegeePose,
} from '../../sim/hustlers';
import type { CrowdSubject } from './env/humanActs';
import type { HumanHead, HumanLook } from './env/humanFigure';
import { createHumanCrowd, type CrowdMember } from './env/humanRig';

/**
 * THE TRAPITOS, THE WASHERS AND THE SOCK SELLERS, drawn (`src/sim/hustlers.ts` decides what they do).
 *
 * THE PEOPLE are the city's shared body (`env/humanFigure.ts`) as ONE skinned crowd: two draw calls
 * for the whole cast wherever they stand, posed by the `trapito`, `washer` and `medias` acts
 * (`env/humanActs.ts`) from a cue this file writes onto each actor from the rules' state every
 * frame — for a sock seller, that includes where on his beat he is (`hustlerAt`). Only people near the camera are stepped; past `HUSTLERS.showWithin` nobody is drawn.
 * One rig, cheap variations: every look is picked from short lists by the spot's seed.
 *
 * THE LIGHTS are each washer's signal: every pole and head is one merged mesh, every lamp one
 * instance of one disc, recoloured only on the frame its light changes.
 *
 * THE FOAM is a few blobs on the player's windscreen, in the chassis' own space: sprayed on as a
 * clean starts and taken off blob by blob as the squeegee passes (`foamCleared`). One draw call,
 * and none while nobody is cleaning.
 *
 * Nothing is allocated per frame.
 */
export interface HustlersVisual {
  root: THREE.Group;
  /** Add to the player's chassis: the windscreen foam lives in its space. */
  foam: THREE.Object3D;
  update(state: HustlerState, time: number, frameDt: number, camX: number, camZ: number, subject: CrowdSubject): void;
  dispose(): void;
}

/* ================================================================== the looks */

const SKIN = [0xe0b08c, 0xc58c63, 0xa86f4c, 0x8a5a3a, 0x6e4530, 0xd9a37f, 0xb98260];
const HAIR = [0x14100e, 0x2a1b12, 0x0c0c10, 0x4a3322];
/** Under the vest: a Boca shirt, a River one, Racing, the national team, Independiente, a hoodie, a tee worn grey. */
const SHIRTS = [0x13328a, 0xe9e9e4, 0x7cc4ef, 0x9fd3f5, 0xc8102e, 0x4a4d52, 0x6b6456, 0x1b2a5c];
const VESTS = [0xff6a13, 0xe8ff2a, 0x5cff3a, 0xffa12a];
const HEADS: HumanHead[] = ['cap', 'bucket', 'mop', 'hood', 'cap', 'crop'];
const HEADWEAR = [0x121316, 0x13328a, 0xe9e9e4, 0x2b2f36, 0xc8102e];
/** Track pants, cargos, jeans, and — for some — shorts. */
const LEGS: Array<{ legs: number; stripe?: number; shorts?: boolean }> = [
  { legs: 0x1c1f2a, stripe: 0xe9e9e4 },
  { legs: 0x6d6448 },
  { legs: 0x2f4466 },
  { legs: 0x2a2d33, shorts: true },
  { legs: 0x141518, stripe: 0x13a0e0 },
];
/** Old sneakers. */
const SHOES = [0xd6d2c8, 0x3a3a40, 0x8a8f96, 0xb9b1a0];

/** A sock seller's shirt: Boca's blue and gold, or River's white with the red sash. */
const JERSEYS = [
  { coat: 0x163a94, band: 0xf2c200 },
  { coat: 0xecebe6, sash: 0xd3122b },
] as const;
/** Cardboard, from fresh to rained on. */
const BOXES = [0xb68a52, 0xa27a48, 0xc29a62];

/** One of `list` for this seed and trait: an integer mix, so neighbouring seeds dress nothing alike. */
function pick<T>(list: readonly T[], seed: number, salt: number): T {
  let h = (Math.imul(Math.floor(seed), 374761393) + Math.imul(salt, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return list[(h >>> 0) % list.length];
}

/** One hustler's look, from his spot. */
export function hustlerLook(spot: HustlerSpot): HumanLook {
  const s = spot.seed;
  const legs = pick(LEGS, s, 7);
  const vest = pick(VESTS, s, 5);
  const look: HumanLook = {
    height: 0.9 + pick([0, 0.03, 0.06, 0.1], s, 1),
    build: pick([0.86, 0.95, 1.05, 1.14], s, 2),
    skin: pick(SKIN, s, 3),
    hair: pick(HAIR, s, 4),
    head: pick(HEADS, s, 6),
    headwear: pick(HEADWEAR, s, 8),
    coat: pick(SHIRTS, s, 9),
    coatLength: pick([0, 0.1, 0.25], s, 10),
    legs: legs.legs,
    legStripe: legs.stripe,
    shorts: legs.shorts,
    boots: pick(SHOES, s, 11),
    vest,
    // The reflective strip across the vest: the thing headlights find first.
    band: 0xd9f2c4,
    pose: 'idle',
    eyes: 'none',
    aura: 0xffb070,
    auraRadius: 1.7,
  };
  if (spot.kind === 'medias') {
    // No vest and nothing hi-vis: a football shirt, a cap, and the box. The LEDs taped along the
    // box are what catches the eye at night, and they walk with him — a pool on the ground would not.
    const jersey = JERSEYS[s % JERSEYS.length];
    look.vest = undefined;
    look.band = undefined;
    look.aura = undefined;
    look.coat = jersey.coat;
    look.coatLength = 0.12;
    look.shortSleeves = true;
    look.shirtBand = 'band' in jersey ? jersey.band : undefined;
    look.shirtSash = 'sash' in jersey ? jersey.sash : undefined;
    look.head = pick(['cap', 'capBack'] as const, s, 20);
    look.headwear = pick([0x121316, 0xe9e9e4, 0x2b2f36, jersey.coat], s, 21);
    look.prop = 'sockBox';
    look.propColor = pick(BOXES, s, 22);
    look.propAccent = 0xfff0c8;
  } else if (spot.kind === 'trapito') {
    look.prop = 'cloth';
    // A rag in a different colour from the vest, so it reads as a thing he is holding.
    look.propColor = pick(VESTS.filter((c) => c !== vest), s, 12);
    look.propAccent = 0xd9f2c4;
  } else {
    look.prop = 'squeegee';
    look.propColor = pick([0xe0b020, 0x2d6fb8, 0xd8262a], s, 13);
    look.bottle = 0x9ad7c8;
  }
  return look;
}

/* ================================================================== the signals */

/** Pole and head sizes (m). The head's lamp faces are on its -z side. */
const SIGNAL = { pole: 0.12, height: 3.1, head: { w: 0.4, h: 1.08, d: 0.3 }, lamp: 0.12, pitch: 0.34 } as const;
const LAMP_ON: Record<SignalColor, number> = { red: 0xff2a1e, amber: 0xffb020, green: 0x2dff8a };
const LAMP_OFF = [0x2a0806, 0x2a1a04, 0x06240f];
const ORDER: SignalColor[] = ['red', 'amber', 'green'];

function buildSignalGeometry(spots: readonly HustlerSpot[]): THREE.BufferGeometry | null {
  const parts: THREE.BufferGeometry[] = [];
  const m = new THREE.Matrix4();
  for (const s of spots) {
    if (!s.signal) continue;
    const place = new THREE.Matrix4().makeRotationY(-s.signal.heading).setPosition(s.signal.x, 0, s.signal.z);
    const pole = new THREE.BoxGeometry(SIGNAL.pole, SIGNAL.height, SIGNAL.pole).translate(0, SIGNAL.height / 2, 0);
    const head = new THREE.BoxGeometry(SIGNAL.head.w, SIGNAL.head.h, SIGNAL.head.d).translate(0, SIGNAL.height + SIGNAL.head.h / 2 - 0.05, 0);
    parts.push(pole.applyMatrix4(place), head.applyMatrix4(place));
    // A hood over each lamp.
    for (let k = 0; k < 3; k++) {
      const y = SIGNAL.height + SIGNAL.head.h / 2 - 0.05 + (1 - k) * SIGNAL.pitch + 0.13;
      const hood = new THREE.BoxGeometry(SIGNAL.head.w * 0.8, 0.03, 0.16).translate(0, y, -SIGNAL.head.d / 2 - 0.08);
      parts.push(hood.applyMatrix4(m.copy(place)));
    }
  }
  if (parts.length === 0) return null;
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return merged;
}

/* ================================================================== the foam */

/** The player's windscreen, in chassis space (`carVisual.ts`, `buildGlassGeometry`). */
const GLASS = { y: 1.1, z: -0.41, rake: -0.564, width: 1.05, length: 0.72 } as const;
const FOAM_BLOBS = 30;
const FOAM_COLOR = new THREE.Color(0xeef7ff);

interface Foam {
  mesh: THREE.Mesh;
  u: Float32Array;
  v: Float32Array;
  alpha: Float32Array;
  colors: THREE.BufferAttribute;
}

function buildFoam(): Foam {
  const positions = new Float32Array(FOAM_BLOBS * 6 * 3);
  const colors = new Float32Array(FOAM_BLOBS * 6 * 4);
  const u = new Float32Array(FOAM_BLOBS);
  const v = new Float32Array(FOAM_BLOBS);
  let o = 0;
  for (let i = 0; i < FOAM_BLOBS; i++) {
    const h1 = Math.abs(Math.sin(i * 91.7) * 43758.5453) % 1;
    const h2 = Math.abs(Math.sin(i * 17.3 + 4.1) * 24634.6345) % 1;
    const h3 = Math.abs(Math.sin(i * 53.9 + 1.7) * 13758.937) % 1;
    u[i] = 0.06 + 0.88 * h1;
    v[i] = 0.08 + 0.84 * ((i + h2) / FOAM_BLOBS);
    // Streaks run down the glass; blobs are rounder.
    const streak = i % 3 === 0;
    const hw = streak ? 0.012 : 0.03 + 0.025 * h3;
    const hl = streak ? 0.08 + 0.05 * h3 : 0.022 + 0.018 * h2;
    const x = (u[i] - 0.5) * GLASS.width;
    const z = GLASS.length / 2 - v[i] * GLASS.length;
    const quad = [
      [x - hw, z - hl],
      [x + hw, z - hl],
      [x + hw, z + hl],
      [x - hw, z - hl],
      [x + hw, z + hl],
      [x - hw, z + hl],
    ];
    for (const [qx, qz] of quad) {
      positions[o * 3] = qx;
      positions[o * 3 + 1] = 0.03;
      positions[o * 3 + 2] = qz;
      colors[o * 4] = FOAM_COLOR.r;
      colors[o * 4 + 1] = FOAM_COLOR.g;
      colors[o * 4 + 2] = FOAM_COLOR.b;
      colors[o * 4 + 3] = 0;
      o++;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const colorAttr = new THREE.BufferAttribute(colors, 4);
  geo.setAttribute('color', colorAttr);
  geo.rotateX(GLASS.rake);
  geo.translate(0, GLASS.y, GLASS.z);
  geo.computeBoundingSphere();
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'windscreen-foam';
  mesh.renderOrder = 3;
  mesh.visible = false;
  return { mesh, u, v, alpha: new Float32Array(FOAM_BLOBS), colors: colorAttr };
}

/* ================================================================== assembly */

export function createHustlersVisual(spots: readonly HustlerSpot[]): HustlersVisual {
  const root = new THREE.Group();
  root.name = 'street-hustlers';
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];

  /* ---------------------------------------------------------------- the people */

  const members: CrowdMember[] = spots.map((spot) => ({
    look: hustlerLook(spot),
    x: spot.x,
    y: 0.03,
    z: spot.z,
    heading: spot.heading,
    act: spot.kind,
    seed: spot.seed * 7 + 3,
  }));
  const crowd = createHumanCrowd(members, 'hustlers');
  const people = new THREE.Group();
  people.name = 'hustler-people';
  people.add(crowd.group);
  root.add(people);
  const awake = new Uint8Array(spots.length);
  const at: BeatPoint = { x: 0, z: 0, heading: 0, moving: 0, stride: 0 };
  let owed = 0;
  let stride = 0;

  /* ---------------------------------------------------------------- the lights */

  const signalSpots = spots.filter((s) => s.signal);
  const signalGeo = buildSignalGeometry(spots);
  const signalMat = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.7, metalness: 0.4 });
  materials.push(signalMat);
  if (signalGeo) {
    geometries.push(signalGeo);
    const mesh = new THREE.Mesh(signalGeo, signalMat);
    mesh.name = 'hustler-signals';
    root.add(mesh);
  }
  const lampGeo = new THREE.CircleGeometry(SIGNAL.lamp, 12);
  const lampMat = new THREE.MeshBasicMaterial({ toneMapped: false });
  const haloGeo = new THREE.CircleGeometry(SIGNAL.lamp * 3.2, 16);
  const haloMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  geometries.push(lampGeo, haloGeo);
  materials.push(lampMat, haloMat);
  const lamps = new THREE.InstancedMesh(lampGeo, lampMat, Math.max(1, signalSpots.length * 3));
  const halos = new THREE.InstancedMesh(haloGeo, haloMat, Math.max(1, signalSpots.length));
  lamps.count = signalSpots.length * 3;
  halos.count = signalSpots.length;
  lamps.name = 'hustler-signal-lamps';
  halos.name = 'hustler-signal-halos';
  halos.renderOrder = 2;
  /** Each light's lamp placements, kept to move its halo onto whichever lamp is lit. */
  const lampAt: THREE.Matrix4[] = [];
  {
    const m = new THREE.Matrix4();
    const face = new THREE.Matrix4();
    const color = new THREE.Color();
    signalSpots.forEach((s, i) => {
      const sig = s.signal!;
      const place = new THREE.Matrix4().makeRotationY(-sig.heading).setPosition(sig.x, 0, sig.z);
      for (let k = 0; k < 3; k++) {
        const y = SIGNAL.height + SIGNAL.head.h / 2 - 0.05 + (1 - k) * SIGNAL.pitch;
        // The disc faces +z as built; turned half round it faces the head's front, -z.
        face.makeRotationY(Math.PI).setPosition(0, y, -SIGNAL.head.d / 2 - 0.01);
        m.multiplyMatrices(place, face);
        lampAt.push(m.clone());
        lamps.setMatrixAt(i * 3 + k, m);
        lamps.setColorAt(i * 3 + k, color.set(LAMP_OFF[k]));
      }
      halos.setMatrixAt(i, lampAt[i * 3]);
      halos.setColorAt(i, color.set(LAMP_ON.red));
    });
    lamps.instanceMatrix.needsUpdate = true;
    halos.instanceMatrix.needsUpdate = true;
    lamps.computeBoundingSphere();
    halos.computeBoundingSphere();
  }
  root.add(lamps, halos);
  const shownColor: Array<SignalColor | null> = signalSpots.map(() => null);
  const reading: SignalReading = { color: 'green', left: 0 };
  const lampColor = new THREE.Color();

  /* ---------------------------------------------------------------- the foam */

  const foam = buildFoam();
  geometries.push(foam.mesh.geometry);
  materials.push(foam.mesh.material as THREE.Material);
  const squeegee: SqueegeePose = { wiping: 0, stroke: 0, u: 0, v: 0 };

  /* ---------------------------------------------------------------- per frame */

  function updateLights(time: number): void {
    for (let i = 0; i < signalSpots.length; i++) {
      const color = signalAt(signalSpots[i].signal!.offset, time, reading).color;
      if (color === shownColor[i]) continue;
      shownColor[i] = color;
      for (let k = 0; k < 3; k++) lamps.setColorAt(i * 3 + k, lampColor.set(ORDER[k] === color ? LAMP_ON[color] : LAMP_OFF[k]));
      halos.setMatrixAt(i, lampAt[i * 3 + ORDER.indexOf(color)]);
      halos.setColorAt(i, lampColor.set(LAMP_ON[color]));
      if (lamps.instanceColor) lamps.instanceColor.needsUpdate = true;
      if (halos.instanceColor) halos.instanceColor.needsUpdate = true;
      halos.instanceMatrix.needsUpdate = true;
    }
  }

  function updateFoam(state: HustlerState, time: number): void {
    let t = -1;
    for (let i = 0; i < state.npcs.length; i++) {
      const n = state.npcs[i];
      if (n.phase === 'clean') t = time - n.since;
    }
    if (t < 0) {
      foam.mesh.visible = false;
      return;
    }
    foam.mesh.visible = true;
    const W = HUSTLERS.washer;
    const sprayed = Math.min(1, t / W.spraySeconds);
    let changed = false;
    for (let b = 0; b < FOAM_BLOBS; b++) {
      // Sprayed on in the order the squeegee will take it off, then off as the blade passes.
      const a = foamCleared(t, foam.u[b], foam.v[b]) ? 0 : 0.5 * Math.min(1, sprayed * 1.6 - foam.v[b] * 0.6);
      const alpha = a < 0 ? 0 : a;
      if (Math.abs(alpha - foam.alpha[b]) < 0.01) continue;
      foam.alpha[b] = alpha;
      for (let k = 0; k < 6; k++) foam.colors.setW(b * 6 + k, alpha);
      changed = true;
    }
    if (changed) foam.colors.needsUpdate = true;
  }

  return {
    root,
    foam: foam.mesh,
    update(state, time, frameDt, camX, camZ, subject) {
      updateLights(time);
      updateFoam(state, time);

      let nearest = Infinity;
      for (let i = 0; i < spots.length; i++) {
        const n = state.npcs[i];
        const p = n ? hustlerAt(spots[i], n, at) : spots[i];
        const d = Math.hypot(p.x - camX, p.z - camZ);
        awake[i] = d < CROWD.animateWithin ? 1 : 0;
        if (d < nearest) nearest = d;
      }
      people.visible = nearest < HUSTLERS.showWithin;
      owed += frameDt;
      if (!people.visible || nearest > CROWD.animateWithin) return;
      stride = (stride + 1) % CROWD.farStride;
      if (nearest > CROWD.fullWithin && stride !== 0) return;

      for (let i = 0; i < spots.length; i++) {
        if (!awake[i]) continue;
        const cue = crowd.actors[i].cue;
        const n = state.npcs[i];
        const spot = spots[i];
        if (!cue || !n) continue;
        const t = time - n.since;
        cue.phase = n.phase;
        cue.t = t;
        cue.mood = n.mood;
        cue.carX = subject.x;
        cue.carZ = subject.z;
        cue.spaceX = spot.space ? spot.space.x : spot.x;
        cue.spaceZ = spot.space ? spot.space.z : spot.z;
        cue.fromX = n.fromX;
        cue.fromZ = n.fromZ;
        cue.toX = n.toX;
        cue.toZ = n.toZ;
        cue.walk = n.phase === 'approach' || n.phase === 'retreat' ? Math.min(1, t / walkSeconds(n.fromX, n.fromZ, n.toX, n.toZ)) : 0;
        if (n.phase === 'clean' || n.phase === 'thanks') {
          const fx = Math.sin(n.carHeading);
          const fz = -Math.cos(n.carHeading);
          cue.glassX = n.carX + fx * 0.45;
          cue.glassZ = n.carZ + fz * 0.45;
          cue.acrossX = -fz;
          cue.acrossZ = fx;
          squeegeeAt(t, squeegee);
          cue.u = squeegee.u;
          cue.v = squeegee.v;
          cue.wiping = n.phase === 'clean' ? squeegee.wiping : 0;
        }
        cue.red = spot.signal ? signalAt(spot.signal.offset, time, reading).color === 'red' : false;
        if (spot.beat) {
          hustlerAt(spot, n, at);
          cue.atX = at.x;
          cue.atZ = at.z;
          cue.facing = at.heading;
          cue.striding = at.moving;
          cue.stride = at.stride;
        }
      }
      crowd.update(time, Math.min(owed, 0.25), subject, awake);
      owed = 0;
    },
    dispose() {
      crowd.dispose();
      root.removeFromParent();
      root.clear();
      foam.mesh.removeFromParent();
      lamps.dispose();
      halos.dispose();
      for (const g of geometries) g.dispose();
      for (const mat of materials) mat.dispose();
    },
  };
}
