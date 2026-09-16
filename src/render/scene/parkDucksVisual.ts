import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CityPlan } from '../../world/cityPlan';
import { contourBounds, lakeFieldOf, LAKE, type LakeField, type ParkSpec } from '../../world/park';
import type { CrowdSubject } from './env/humanActs';

/**
 * THE DUCKS (`world/park.ts`): what the lakes of the Bosques de Palermo are never without. White
 * farmyard ducks and mallards paddling about in flocks, mothers with a file of ducklings behind
 * them, a couple of pairs of black-necked swans, and a few groups up on the grass at the water's
 * edge pecking at whatever the people left.
 *
 * Nothing here is data the rules read: the birds are ambience, placed from the park's own depth
 * field when the environment is built (deterministic, a seed per lake) and moved here. A flock's
 * leader wanders over the deep water and turns back from the bank before it reaches it (the
 * field's depth a few metres ahead); the rest follow it nose to tail. A car coming close sends
 * them paddling off, and the ones on the grass waddle into the water.
 *
 * COST. Three instanced meshes (white duck, mallard, swan) for every bird on the map, a few
 * hundred triangles a bird, hidden with everything else once the camera is far from every lake.
 * One matrix a bird a frame, nothing allocated.
 */
export interface ParkDucksVisual {
  root: THREE.Group;
  update(camX: number, camZ: number, time: number, dt: number, subject: CrowdSubject | null): void;
  dispose(): void;
}

type Breed = 0 | 1 | 2;
const WHITE: Breed = 0;
const MALLARD: Breed = 1;
const SWAN: Breed = 2;

/** Past this (m) from the nearest lake's edge, no bird is drawn or moved. */
const SHOW_WITHIN = 320;
/** Paddling speeds (m/s): idle, and fleeing a car. */
const PADDLE = 0.32;
const FLEE = 1.9;
/** How close (m) a car comes before a flock makes off, and before the grazers take to the water. */
const SPOOK = 22;
/** How far ahead (m) a leader looks for the bank, and the depth it wants there. */
const LOOK = 6;
const DEEP = LAKE.depth * 0.7;
/** Every bird a third over life size: a real duck is a speck from the road at night. */
const BIRD_SIZE = 1.35;
/** Space between one bird and the next in a file (m), by the one in front's size. */
const FILE_GAP = 0.85;

interface Bird {
  breed: Breed;
  scale: number;
  x: number;
  z: number;
  heading: number;
  /** Bob phase, so no two birds rise together. */
  phase: number;
  /** Where on the land it stands when grazing (NaN when it swims). */
  homeX: number;
  homeZ: number;
}

interface Flock {
  birds: Bird[];
  speed: number;
  /** Wander state: a turn rate that drifts. */
  turn: number;
  seed: number;
}

function rngOf(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ the birds' shapes */

/** A piece of a bird: a sphere squashed to (sx, sy, sz) at (x, y, z), painted one colour. */
function part(sx: number, sy: number, sz: number, x: number, y: number, z: number, color: number, w = 8, h = 5): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, w, h).toNonIndexed();
  g.scale(sx, sy, sz);
  g.translate(x, y, z);
  const c = new THREE.Color(color);
  const n = g.getAttribute('position').count;
  const cols = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    cols[i * 3] = c.r;
    cols[i * 3 + 1] = c.g;
    cols[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  g.deleteAttribute('uv');
  return g;
}

/** A neck: a thin tapered cylinder from (x0, y0) to (x1, y1) in the bird's plane (z forward is -z). */
function neck(r0: number, r1: number, z0: number, y0: number, z1: number, y1: number, color: number): THREE.BufferGeometry {
  const len = Math.hypot(z1 - z0, y1 - y0);
  const g = new THREE.CylinderGeometry(r1, r0, len, 6, 1, true).toNonIndexed();
  // Up the cylinder's axis is +y; tilt it toward -z by the neck's angle.
  g.rotateX(-Math.atan2(z0 - z1, y1 - y0));
  g.translate(0, (y0 + y1) / 2, (z0 + z1) / 2);
  const c = new THREE.Color(color);
  const n = g.getAttribute('position').count;
  const cols = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    cols[i * 3] = c.r;
    cols[i * 3 + 1] = c.g;
    cols[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  g.deleteAttribute('uv');
  return g;
}

/** Bird space: forward is -z, the waterline is y 0, a duck is about half a metre long. */
function duckGeometry(body: number, head: number, beak: number, wing: number, tail: number, neckBand?: number): THREE.BufferGeometry {
  const parts = [
    part(0.15, 0.11, 0.25, 0, 0.06, 0.02, body),
    part(0.12, 0.06, 0.18, 0, 0.12, 0.05, wing),
    part(0.06, 0.05, 0.1, 0, 0.12, 0.24, tail, 6, 4),
    part(0.075, 0.075, 0.085, 0, 0.27, -0.2, head, 7, 5),
    part(0.035, 0.015, 0.07, 0, 0.25, -0.3, beak, 6, 3),
  ];
  if (neckBand !== undefined) parts.push(part(0.06, 0.02, 0.06, 0, 0.2, -0.17, neckBand, 6, 3));
  else parts.push(part(0.06, 0.07, 0.06, 0, 0.18, -0.17, head, 6, 4));
  const g = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  g.computeVertexNormals();
  return g;
}

/** The black-necked swan of the Río de la Plata: white body, black neck and head, a red knob on the bill. */
function swanGeometry(): THREE.BufferGeometry {
  const parts = [
    part(0.32, 0.2, 0.58, 0, 0.1, 0.05, 0xf2f0ea),
    part(0.28, 0.14, 0.44, 0, 0.22, 0.12, 0xe6e3dc),
    part(0.12, 0.1, 0.18, 0, 0.2, 0.6, 0xf2f0ea, 6, 4),
    neck(0.085, 0.055, -0.38, 0.18, -0.46, 0.82, 0x0c0c0e),
    part(0.08, 0.075, 0.12, 0, 0.86, -0.52, 0x0c0c0e, 7, 5),
    part(0.035, 0.02, 0.1, 0, 0.84, -0.66, 0x6a7078, 6, 3),
    part(0.03, 0.03, 0.03, 0, 0.89, -0.6, 0xd8282a, 5, 3),
    // A thin white stripe behind the eye.
    part(0.082, 0.015, 0.05, 0, 0.9, -0.5, 0xf2f0ea, 6, 3),
  ];
  const g = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  g.computeVertexNormals();
  return g;
}

/* ------------------------------------------------------------------ placing them */

function deepSpot(field: LakeField, box: { minX: number; maxX: number; minZ: number; maxZ: number }, rng: () => number, taken: Array<{ x: number; z: number }>, apart: number): { x: number; z: number } | null {
  for (let tries = 0; tries < 400; tries++) {
    const x = box.minX + rng() * (box.maxX - box.minX);
    const z = box.minZ + rng() * (box.maxZ - box.minZ);
    if (field.depthAt(x, z) < LAKE.depth * 0.95) continue;
    if (taken.some((t) => Math.hypot(t.x - x, t.z - z) < apart)) continue;
    return { x, z };
  }
  return null;
}

function bird(breed: Breed, scale: number, x: number, z: number, heading: number, rng: () => number): Bird {
  return { breed, scale: scale * BIRD_SIZE, x, z, heading, phase: rng() * Math.PI * 2, homeX: NaN, homeZ: NaN };
}

function placeBirds(parks: readonly ParkSpec[], plan: CityPlan): { flocks: Flock[]; grazers: Bird[]; lakes: Array<{ x: number; z: number; r: number }> } {
  const flocks: Flock[] = [];
  const grazers: Bird[] = [];
  const lakes: Array<{ x: number; z: number; r: number }> = [];
  let seed = 7;
  for (const park of parks) {
    const field = lakeFieldOf(park);
    for (const lake of park.lakes) {
      const box = contourBounds(lake.shore);
      lakes.push({ x: (box.minX + box.maxX) / 2, z: (box.minZ + box.maxZ) / 2, r: Math.hypot(box.maxX - box.minX, box.maxZ - box.minZ) / 2 });
      const rng = rngOf(0x0d0c + seed++ * 977);
      const area = (box.maxX - box.minX) * (box.maxZ - box.minZ);
      const taken: Array<{ x: number; z: number }> = [];
      // Flocks on the water: about one a 6,000 m² of the lake's box, a mix of the three kinds.
      const count = Math.max(3, Math.round(area / 6000));
      for (let k = 0; k < count; k++) {
        const at = deepSpot(field, box, rng, taken, 34);
        if (!at) break;
        taken.push(at);
        const h = rng() * Math.PI * 2;
        const birds: Bird[] = [];
        const r = rng();
        if (k % 5 === 2) {
          // A pair of swans.
          birds.push(bird(SWAN, 1, at.x, at.z, h, rng), bird(SWAN, 0.94, at.x, at.z + 1.6, h, rng));
        } else if (r < 0.4) {
          // A mallard mother and her ducklings in a file.
          birds.push(bird(MALLARD, 1, at.x, at.z, h, rng));
          const n = 4 + Math.floor(rng() * 5);
          for (let i = 0; i < n; i++) birds.push(bird(MALLARD, 0.45 + rng() * 0.08, at.x, at.z + (i + 1) * 0.5, h, rng));
        } else {
          // A loose flock of white ducks with a mallard or two among them.
          const n = 3 + Math.floor(rng() * 5);
          for (let i = 0; i < n; i++) birds.push(bird(rng() < 0.25 ? MALLARD : WHITE, 0.95 + rng() * 0.15, at.x + (rng() - 0.5) * 3, at.z + (i + 1) * 0.9, h, rng));
        }
        flocks.push({ birds, speed: PADDLE, turn: (rng() - 0.5) * 0.3, seed: rng() * 1000 });
      }
      // Up on the grass: a few groups a metre or three from the water, where nothing drives.
      const groups = Math.max(2, Math.round(count / 2));
      const n = lake.shore.length;
      for (let g = 0, tries = 0; g < groups && tries < 200; tries++) {
        const p = lake.shore[Math.floor(rng() * n)];
        const q = lake.shore[(Math.floor(rng() * n) + 1) % n];
        // Out of the water along the shore's normal, whichever way is dry.
        let nx = -(q.z - p.z);
        let nz = q.x - p.x;
        const len = Math.hypot(nx, nz) || 1;
        nx /= len;
        nz /= len;
        if (field.inWater(p.x + nx * 2, p.z + nz * 2)) {
          nx = -nx;
          nz = -nz;
        }
        const cx = p.x + nx * (2.5 + rng() * 2);
        const cz = p.z + nz * (2.5 + rng() * 2);
        if (field.inWater(cx, cz) || plan.isRoad(cx, cz, 4)) continue;
        if (taken.some((t) => Math.hypot(t.x - cx, t.z - cz) < 30)) continue;
        taken.push({ x: cx, z: cz });
        g++;
        const size = 3 + Math.floor(rng() * 4);
        for (let i = 0; i < size; i++) {
          const x = cx + (rng() - 0.5) * 4;
          const z = cz + (rng() - 0.5) * 4;
          if (field.inWater(x, z) || plan.isRoad(x, z, 2)) continue;
          const b = bird(rng() < 0.7 ? WHITE : MALLARD, 0.95 + rng() * 0.15, x, z, rng() * Math.PI * 2, rng);
          b.homeX = x;
          b.homeZ = z;
          grazers.push(b);
        }
      }
    }
  }
  return { flocks, grazers, lakes };
}

/* ------------------------------------------------------------------ the visual */

export function createParkDucksVisual(parks: readonly ParkSpec[], plan: CityPlan): ParkDucksVisual | null {
  const { flocks, grazers, lakes } = placeBirds(parks, plan);
  const all = [...flocks.flatMap((f) => f.birds), ...grazers];
  if (all.length === 0) return null;
  const root = new THREE.Group();
  root.name = 'park-ducks';
  const geometries = [
    duckGeometry(0xf4f2ea, 0xf8f6ee, 0xf0a020, 0xe4e1d8, 0xefede4),
    duckGeometry(0x8a7058, 0x1f6a3a, 0xd8b030, 0x6a5a4a, 0x2a2622, 0xf0f0e8),
    swanGeometry(),
  ];
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, emissive: 0x1a1c20, emissiveIntensity: 1 });
  const byBreed: Bird[][] = [[], [], []];
  for (const b of all) byBreed[b.breed].push(b);
  const meshes = geometries.map((g, k) => {
    const m = new THREE.InstancedMesh(g, material, Math.max(1, byBreed[k].length));
    m.count = byBreed[k].length;
    m.name = `park-ducks-${k}`;
    // The birds move every frame over a whole lake: one bound for the lot is not worth keeping current.
    m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    root.add(m);
    return m;
  });
  const field = (x: number, z: number): number => {
    let d = 0;
    for (const p of parks) d = Math.max(d, lakeFieldOf(p).depthAt(x, z));
    return d;
  };

  const mat = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');

  const steerFlock = (f: Flock, time: number, dt: number, subject: CrowdSubject | null): void => {
    const lead = f.birds[0];
    // Wander: a turn rate that drifts slowly one way and the other.
    f.turn += (Math.sin(time * 0.23 + f.seed) * 0.5 + Math.sin(time * 0.61 + f.seed * 1.7) * 0.5) * 0.25 * dt;
    f.turn = Math.max(-0.35, Math.min(0.35, f.turn * (1 - dt * 0.1)));
    let turn = f.turn;
    let want = PADDLE;
    // A car close by: head straight away from it.
    if (subject) {
      const dx = lead.x - subject.x;
      const dz = lead.z - subject.z;
      const d = Math.hypot(dx, dz);
      if (d < SPOOK) {
        const away = Math.atan2(dx, -dz);
        turn = angleTo(lead.heading, away) * 2.5;
        want = FLEE;
      }
    }
    // The bank ahead: turn toward whichever side is deeper, harder the shallower it gets.
    const fx = Math.sin(lead.heading);
    const fz = -Math.cos(lead.heading);
    const ahead = field(lead.x + fx * LOOK, lead.z + fz * LOOK);
    if (ahead < DEEP) {
      const l = field(lead.x + Math.sin(lead.heading - 0.8) * LOOK, lead.z - Math.cos(lead.heading - 0.8) * LOOK);
      const r = field(lead.x + Math.sin(lead.heading + 0.8) * LOOK, lead.z - Math.cos(lead.heading + 0.8) * LOOK);
      turn = (r >= l ? 1 : -1) * (1.2 + (DEEP - ahead) * 1.5);
      want = Math.min(want, PADDLE);
    }
    f.speed += (want - f.speed) * Math.min(1, dt * 1.5);
    lead.heading += turn * dt;
    const nx = lead.x + Math.sin(lead.heading) * f.speed * dt;
    const nz = lead.z - Math.cos(lead.heading) * f.speed * dt;
    // Never onto the bank itself: a stroke that would leave the water is not taken.
    if (field(nx, nz) > LAKE.swim) {
      lead.x = nx;
      lead.z = nz;
    }
    // The rest in a file, each keeping its gap behind the one in front.
    for (let i = 1; i < f.birds.length; i++) {
      const b = f.birds[i];
      const p = f.birds[i - 1];
      const gap = FILE_GAP * Math.max(p.scale, b.scale) * (p.breed === SWAN ? 2.2 : 1);
      // A little sideways from the one in front, so a loose flock is not a line.
      const side = b.breed === p.breed && b.scale > 0.8 * BIRD_SIZE ? Math.sin(b.phase) * 0.6 : 0;
      const tx = p.x - Math.sin(p.heading) * gap + Math.cos(p.heading) * side;
      const tz = p.z + Math.cos(p.heading) * gap + Math.sin(p.heading) * side;
      const dx = tx - b.x;
      const dz = tz - b.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.02) {
        const step = Math.min(d, Math.max(f.speed * 1.4, d * 1.6) * dt);
        b.x += (dx / d) * step;
        b.z += (dz / d) * step;
        b.heading += angleTo(b.heading, Math.atan2(dx, -dz)) * Math.min(1, dt * 3);
      }
    }
  };

  const write = (b: Bird, index: number, time: number, swimming: boolean): void => {
    let y: number;
    let pitch = 0;
    if (swimming) {
      y = LAKE.surfaceY + Math.sin(time * 1.9 + b.phase) * 0.012 * b.scale;
      pitch = Math.sin(time * 1.9 + b.phase + 0.8) * 0.04;
    } else {
      y = plan.padY(b.x, b.z) + 0.06 * b.scale;
      // Pecking: now and then the whole bird tips forward.
      const peck = Math.max(0, Math.sin(time * 0.9 + b.phase * 3) - 0.75) * 4;
      pitch = -peck * 0.45;
    }
    euler.set(pitch, -b.heading, 0);
    quat.setFromEuler(euler);
    pos.set(b.x, y, b.z);
    scl.setScalar(b.scale);
    mat.compose(pos, quat, scl);
    meshes[b.breed].setMatrixAt(index, mat);
  };

  // Each bird's slot in its breed's mesh.
  const slot = new Map<Bird, number>();
  for (const list of byBreed) list.forEach((b, i) => slot.set(b, i));

  return {
    root,
    update(camX, camZ, time, dt, subject) {
      let near = Infinity;
      for (const l of lakes) near = Math.min(near, Math.hypot(l.x - camX, l.z - camZ) - l.r);
      root.visible = near < SHOW_WITHIN;
      if (!root.visible) return;
      const step = Math.min(dt, 0.1);
      for (const f of flocks) {
        steerFlock(f, time, step, subject);
        for (const b of f.birds) write(b, slot.get(b)!, time, true);
      }
      for (const b of grazers) {
        // A car close by: waddle off, away from it, and back once it has gone.
        let tx = b.homeX;
        let tz = b.homeZ;
        let speed = 0.25;
        if (subject) {
          const dx = b.x - subject.x;
          const dz = b.z - subject.z;
          const d = Math.hypot(dx, dz);
          if (d < SPOOK * 0.6) {
            tx = b.x + (dx / (d || 1)) * 3;
            tz = b.z + (dz / (d || 1)) * 3;
            speed = 1.1;
          }
        }
        const dx = tx - b.x;
        const dz = tz - b.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.1 && !plan.isRoad(b.x + (dx / d) * 0.5, b.z + (dz / d) * 0.5, 0.5)) {
          const s = Math.min(d, speed * step);
          b.x += (dx / d) * s;
          b.z += (dz / d) * s;
          b.heading += angleTo(b.heading, Math.atan2(dx, -dz)) * Math.min(1, step * 4);
        } else {
          // Idle: turning about a little on the spot.
          b.heading += Math.sin(time * 0.37 + b.phase * 5) * 0.4 * step;
        }
        const inWater = field(b.x, b.z) > LAKE.swim * 0.5;
        write(b, slot.get(b)!, time, inWater);
      }
      for (const m of meshes) m.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      for (const g of geometries) g.dispose();
      material.dispose();
      for (const m of meshes) m.dispose();
      root.removeFromParent();
      root.clear();
    },
  };
}

/** The signed shortest turn from `from` to `to` (radians). */
function angleTo(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
