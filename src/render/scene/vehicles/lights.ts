import * as THREE from 'three';
import { STOCK_LOADOUT, type CarLoadout, type PartId } from '../../../core/loadout';
import { box, mergeParts, part } from './geometryKit';
import { exhaustOutlets, type ExhaustOutlet } from './parts/exhaustTips';

/**
 * THE CAR'S LAMPS: head lights, tail lights, reverse lights and the exhaust flame. OWNED BY
 * agent G (`docs/GARAGE_PLAN.md` §2.7, Ola 1). Extracted from `carVisual.ts` unchanged.
 *
 * CONTRACT
 * - `createCarLights(chassis, loadout)` builds four meshes and adds them to `chassis` in this
 *   order: head, tail, reverse, exhaust glow. Four of the car's fourteen draw calls; the order
 *   is the order they have always been added in (`tests/carVisualStock.test.ts` walks it).
 * - `setNitro` / `setBraking` / `setReversing` are the per-frame-safe controls `CarVisual`
 *   forwards; they allocate nothing.
 * - `applyLoadout(loadout)` is workshop-time: it may rebuild geometry (disposing what it
 *   replaces) and restyle materials, but never create or drop a mesh.
 *
 * WAVE 0 STATE: `applyLoadout` rebuilds the head/tail shapes and the exhaust discs when their
 * part changes (only `stock` exists yet) and does not touch colour. Agent G adds: head light
 * shapes (`buildHeadGeometry` cases), tail light shapes (`buildTailGeometry` cases), and
 * `lights.headColor` → `headMat.emissive` from `PALETTE`. The tail lights stay red when braking
 * and turn magenta under nitro whatever else changes (`AGENTS.md` visual rules).
 */
export interface CarLights {
  readonly head: THREE.Mesh;
  readonly tail: THREE.Mesh;
  readonly reverse: THREE.Mesh;
  readonly exhaustGlow: THREE.Mesh;
  /** 0..1, already clamped by the caller. Brightens the tails toward magenta and grows the flame. */
  setNitro(level: number): void;
  setBraking(on: boolean): void;
  setReversing(on: boolean): void;
  applyLoadout(loadout: CarLoadout): void;
  dispose(): void;
}

const TAIL_RED = new THREE.Color(0xff1a2e);
const TAIL_MAGENTA = new THREE.Color(0xff33d6);

/** Head light clusters: a lamp and a DRL strip each side. */
export function buildHeadGeometry(partId: PartId = STOCK_LOADOUT.lights.head): THREE.BufferGeometry {
  switch (partId) {
    default: {
      const parts: THREE.BufferGeometry[] = [];
      for (const sign of [-1, 1]) {
        const lamp = box(0.36, 0.13, 0.1);
        lamp.rotateY(sign * 0.1);
        lamp.translate(sign * 0.44, 0.5, -2.13);
        parts.push(part(lamp, 0xffffff));
        const drl = box(0.3, 0.035, 0.08);
        drl.translate(sign * 0.44, 0.38, -2.13);
        parts.push(part(drl, 0x9fe8ff));
      }
      return mergeParts(parts);
    }
  }
}

/**
 * Tail light clusters. Shared with the rival cars and the meet (re-exported by `carVisual.ts`):
 * the view of a rival is usually this one. Called with no argument there — the stock shape.
 */
export function buildTailGeometry(partId: PartId = STOCK_LOADOUT.lights.tail): THREE.BufferGeometry {
  switch (partId) {
    default: {
      const parts: THREE.BufferGeometry[] = [];
      for (const sign of [-1, 1]) {
        const outer = box(0.32, 0.16, 0.08);
        outer.translate(sign * 0.52, 0.61, 2.12);
        parts.push(part(outer, 0xffffff));
        const inner = box(0.18, 0.11, 0.06);
        inner.translate(sign * 0.29, 0.61, 2.11);
        parts.push(part(inner, 0xffffff));
      }
      return mergeParts(parts);
    }
  }
}

function buildReverseGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const sign of [-1, 1]) {
    const lamp = box(0.15, 0.07, 0.05);
    lamp.translate(sign * 0.46, 0.4, 2.16);
    parts.push(part(lamp, 0xffffff));
  }
  return mergeParts(parts);
}

/** Additive disc with a warm core and a magenta/violet rim, used for the exhaust flame. */
function glowDisc(radius: number, segments: number): THREE.BufferGeometry {
  const geo = new THREE.CircleGeometry(radius, segments).toNonIndexed();
  geo.clearGroups();
  for (const name of Object.keys(geo.attributes)) {
    if (name !== 'position' && name !== 'normal') geo.deleteAttribute(name);
  }
  const position = geo.getAttribute('position');
  const core = new THREE.Color(0xffd8a8);
  const rim = new THREE.Color(0xff2fd0);
  const colors = new Float32Array(position.count * 4);
  for (let i = 0; i < position.count; i++) {
    const centre = Math.hypot(position.getX(i), position.getY(i)) < radius * 0.02;
    const c = centre ? core : rim;
    colors[i * 4] = c.r;
    colors[i * 4 + 1] = c.g;
    colors[i * 4 + 2] = c.b;
    colors[i * 4 + 3] = centre ? 1 : 0.14;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 4));
  return geo;
}

/** One flame disc per exhaust outlet (`exhaustOutlets` in `parts/exhaustTips.ts`). */
export function buildExhaustGlowGeometry(outlets: readonly ExhaustOutlet[]): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const o of outlets) {
    const disc = glowDisc(o.radius, 10);
    disc.translate(o.x, o.y, o.z);
    parts.push(disc);
  }
  return mergeParts(parts);
}

export function createCarLights(chassis: THREE.Object3D, loadout: CarLoadout = STOCK_LOADOUT): CarLights {
  let headPart = loadout.lights.head;
  let tailPart = loadout.lights.tail;
  let tipsPart = loadout.body.exhaustTips;

  /* ----------------------------------------------------------- head lights */
  const headMat = new THREE.MeshStandardMaterial({
    color: 0x0a0d12,
    emissive: 0xdff2ff,
    emissiveIntensity: 1.5,
    vertexColors: true,
    roughness: 0.2,
  });
  const head = new THREE.Mesh(buildHeadGeometry(headPart), headMat);
  chassis.add(head);

  /* ----------------------------------------------------------- tail lights */
  const tailMat = new THREE.MeshStandardMaterial({
    color: 0x180205,
    emissive: 0xff1a2e,
    emissiveIntensity: 0.9,
    vertexColors: true,
    roughness: 0.3,
  });
  const tail = new THREE.Mesh(buildTailGeometry(tailPart), tailMat);
  chassis.add(tail);

  /* -------------------------------------------------------- reverse lights */
  const reverseMat = new THREE.MeshStandardMaterial({
    color: 0x0e1014,
    emissive: 0xffffff,
    emissiveIntensity: 0,
    vertexColors: true,
    roughness: 0.4,
  });
  const reverse = new THREE.Mesh(buildReverseGeometry(), reverseMat);
  chassis.add(reverse);

  /* ---------------------------------------------------------- exhaust glow */
  const exhaustMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const exhaustGlow = new THREE.Mesh(buildExhaustGlowGeometry(exhaustOutlets(tipsPart)), exhaustMat);
  exhaustGlow.renderOrder = 3;
  chassis.add(exhaustGlow);

  /* ------------------------------------------------------------- behaviour */
  let nitro = 0;
  let braking = false;
  let reversing = false;

  function refresh(): void {
    let intensity = 0.85 + nitro * 1.9;
    if (braking) intensity = Math.max(intensity, 3.4);
    tailMat.emissiveIntensity = intensity;
    tailMat.emissive.lerpColors(TAIL_RED, TAIL_MAGENTA, braking ? 0 : Math.min(1, nitro * 0.85));
    reverseMat.emissiveIntensity = reversing ? 2.6 : 0;
    exhaustMat.opacity = 0.2 + nitro * 1.6;
    const scale = 1 + nitro * 0.7;
    exhaustGlow.scale.set(scale, scale, 1);
  }
  refresh();

  function swap(mesh: THREE.Mesh, geometry: THREE.BufferGeometry): void {
    const old = mesh.geometry;
    mesh.geometry = geometry;
    old.dispose();
  }

  return {
    head,
    tail,
    reverse,
    exhaustGlow,
    setNitro(level) {
      nitro = level;
      refresh();
    },
    setBraking(on) {
      braking = on;
      refresh();
    },
    setReversing(on) {
      reversing = on;
      refresh();
    },
    applyLoadout(l) {
      if (l.lights.head !== headPart) {
        headPart = l.lights.head;
        swap(head, buildHeadGeometry(headPart));
      }
      if (l.lights.tail !== tailPart) {
        tailPart = l.lights.tail;
        swap(tail, buildTailGeometry(tailPart));
      }
      if (l.body.exhaustTips !== tipsPart) {
        tipsPart = l.body.exhaustTips;
        swap(exhaustGlow, buildExhaustGlowGeometry(exhaustOutlets(tipsPart)));
      }
    },
    dispose() {
      for (const mesh of [head, tail, reverse, exhaustGlow]) mesh.geometry.dispose();
      headMat.dispose();
      tailMat.dispose();
      reverseMat.dispose();
      exhaustMat.dispose();
    },
  };
}
