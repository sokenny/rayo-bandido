import * as THREE from 'three';
import { VEHICLE } from '../../config/tuning';
import type { MicroSceneDefinition, PropDefinition } from '../../microScenes/types';
import { buildBodyGeometry, buildGlassGeometry, buildTailGeometry } from './carVisual';
import { electricCarGeometry } from './electricCarVisual';
import { mergeParts, part } from './vehicles/geometryKit';
import { buildWheelGeometry } from './vehicles/wheel';

/**
 * WHAT A MICRO-SCENE PUTS ON THE PAVEMENT, built once per scene definition and never again.
 *
 * THE WHOLE POINT IS THE DRAW CALL COUNT. Everything a scene stands still is baked into THREE
 * geometries in the scene's own local frame — one lit, one steadily glowing, one that blinks — so
 * a bus shelter's two boards, or a checkpoint's patrol car, civilian car, scanner and holo
 * barrier, cost three draw calls between them however many pieces they are made of. The vehicles
 * go into the same merge: a parked car at night is looked at, not driven, and it does not need
 * its own material to be a car.
 *
 * NOTHING HERE IS SOLID, and that is deliberate rather than forgotten. The street cast has never
 * been solid (`sim/hustlers.ts`: "nobody is solid"), and a micro-scene must not alter traffic,
 * collision or the police, so its cars park with two wheels up on the kerb — out of the lane,
 * which is the rule that matters — and the player may drive through them exactly as they may
 * drive through a trapito. Making them solid would mean mutating the world's collider list at
 * runtime, which every other system reads as fixed.
 *
 * NO DYNAMIC LIGHTS, EVER. A lamp, a scanner tip, a lit joint, a light bar, a hazard: all of them
 * are emissive material on the glow meshes. The city is lit by a hemisphere over a weak key and
 * cannot afford another shadow caster for a folding table.
 */

export interface MicroScenePropSet {
  /** Everything ordinary, in the scene's local frame. */
  lit: THREE.BufferGeometry | null;
  /** Everything that glows steadily: a lamp, a screen, a light bar, underglow. */
  glow: THREE.BufferGeometry | null;
  /** Everything that blinks: hazard lights. Driven by the `playVehicleHazards` behaviour. */
  blink: THREE.BufferGeometry | null;
  /** Props carried in a hand or dragged: built separately, moved every frame. */
  loose: Array<{ prop: PropDefinition; geometry: THREE.BufferGeometry; glow: boolean }>;
  /**
   * Boards with words on them. One draw call each, because a canvas of Spanish is a texture and
   * everything else in a scene is vertex colour. There are never more than two.
   */
  boards: Array<{ prop: PropDefinition; geometry: THREE.BufferGeometry; texture: THREE.CanvasTexture | null }>;
}

/* ================================================================== small change */

const TMP = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
const POS = new THREE.Vector3();
const ONE = new THREE.Vector3(1, 1, 1);

/** Place a piece at a scene-local transform. The one heading rule the rest of the game uses. */
function at(g: THREE.BufferGeometry, x: number, y: number, z: number, heading: number): THREE.BufferGeometry {
  TMP.compose(POS.set(x, y, z), Q.setFromAxisAngle(UP, -heading), ONE);
  return g.applyMatrix4(TMP);
}

function boxAt(w: number, h: number, d: number, color: number, x: number, y: number, z: number, heading = 0): THREE.BufferGeometry {
  return at(part(new THREE.BoxGeometry(w, h, d), color), x, y, z, heading);
}

/* ================================================================== the vehicles */

const WHEEL_WIDTH = 0.26;
const HALF_TRACK = VEHICLE.trackWidth / 2;
const HALF_BASE = VEHICLE.wheelbase / 2;

/**
 * The shells, lofted ONCE for the whole catalogue and cloned per scene. `part()` consumes the
 * geometry it is given — it strips attributes and bakes a colour — so a scene takes a copy. A loft
 * is the expensive half of building a scene, and five of the eight park a car.
 */
const SHELLS: { body?: THREE.BufferGeometry; glass?: THREE.BufferGeometry; tail?: THREE.BufferGeometry; wheel?: THREE.BufferGeometry; small?: THREE.BufferGeometry } = {};

function shell<K extends keyof typeof SHELLS>(key: K, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  SHELLS[key] ??= make();
  return SHELLS[key]!.clone();
}

/** A coupe: the player's own body shell, parked. `lit` and `glow` in the car's local frame. */
function coupeParts(paint: number, underglow: number | undefined, tail: boolean): { lit: THREE.BufferGeometry[]; glow: THREE.BufferGeometry[] } {
  const lit: THREE.BufferGeometry[] = [part(shell('body', () => buildBodyGeometry()), paint), part(shell('glass', () => buildGlassGeometry()), 0x0b1c26)];
  const wheelAt: Array<[number, number]> = [
    [-HALF_TRACK, -HALF_BASE],
    [HALF_TRACK, -HALF_BASE],
    [-HALF_TRACK - 0.02, HALF_BASE],
    [HALF_TRACK + 0.02, HALF_BASE],
  ];
  for (const [x, z] of wheelAt) {
    lit.push(at(part(shell('wheel', () => buildWheelGeometry(VEHICLE.wheelRadius, WHEEL_WIDTH, 10)), 0x1a1c20), x, VEHICLE.wheelRadius, z, 0));
  }
  const glow: THREE.BufferGeometry[] = [];
  if (tail) glow.push(part(shell('tail', () => buildTailGeometry()), 0xff1a2e));
  // Sill tubes rather than a light: two thin strips under the body, the way the meet's cars glow.
  if (underglow !== undefined) {
    glow.push(boxAt(0.1, 0.06, VEHICLE.wheelbase * 0.95, underglow, -HALF_TRACK + 0.1, 0.16, 0));
    glow.push(boxAt(0.1, 0.06, VEHICLE.wheelbase * 0.95, underglow, HALF_TRACK - 0.1, 0.16, 0));
  }
  return { lit, glow };
}

/** An electric hatch: the city's own traffic body. */
function evParts(paint: number, bar: number | undefined): { lit: THREE.BufferGeometry[]; glow: THREE.BufferGeometry[] } {
  const geo = electricCarGeometry();
  const lit = [part(geo.body.clone(), paint)];
  const glow = [part(geo.bars.clone(), bar ?? 0x3fd0ff)];
  const wheelAt: Array<[number, number]> = [
    [-HALF_TRACK + 0.05, -HALF_BASE + 0.1],
    [HALF_TRACK - 0.05, -HALF_BASE + 0.1],
    [-HALF_TRACK + 0.05, HALF_BASE - 0.1],
    [HALF_TRACK - 0.05, HALF_BASE - 0.1],
  ];
  for (const [x, z] of wheelAt) {
    lit.push(at(part(shell('small', () => buildWheelGeometry(VEHICLE.wheelRadius * 0.92, 0.22, 10)), 0x141518), x, VEHICLE.wheelRadius * 0.92, z, 0));
  }
  return { lit, glow };
}

/** A van: a box on wheels. Nothing about it needs to be more than that. */
function vanParts(paint: number): { lit: THREE.BufferGeometry[]; glow: THREE.BufferGeometry[] } {
  const lit = [
    // Body, cab and a darker band where the windows are.
    boxAt(2.05, 1.55, 4.4, paint, 0, 1.25, -0.2),
    boxAt(1.95, 0.85, 1.5, paint, 0, 1.0, 2.1),
    boxAt(1.98, 0.42, 1.2, 0x10161c, 0, 1.6, 2.05),
  ];
  const wheelAt: Array<[number, number]> = [
    [-0.95, -1.5],
    [0.95, -1.5],
    [-0.95, 1.6],
    [0.95, 1.6],
  ];
  for (const [x, z] of wheelAt) {
    lit.push(at(part(shell('small', () => buildWheelGeometry(VEHICLE.wheelRadius * 0.92, 0.22, 10)).scale(1.1, 1.1, 1.1), 0x15171a), x, 0.36, z, 0));
  }
  return { lit, glow: [] };
}

/** Four corner lamps in the car's own frame, so one blink is one material change. */
function hazardLamps(): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (const [ox, oz] of [[-0.82, -1.85], [0.82, -1.85], [-0.82, 1.85], [0.82, 1.85]]) {
    out.push(part(new THREE.BoxGeometry(0.22, 0.15, 0.13), 0xffa61f).translate(ox, 0.62, oz));
  }
  return out;
}

/**
 * Loft the shells now, while the loading screen is still up. Without this the first scene with a
 * car in it pays for the loft on a frame of the game, which is the one part of building a scene
 * big enough to see.
 */
export function primeVehicleShells(): void {
  shell('body', () => buildBodyGeometry()).dispose();
  shell('glass', () => buildGlassGeometry()).dispose();
  shell('tail', () => buildTailGeometry()).dispose();
  shell('wheel', () => buildWheelGeometry(VEHICLE.wheelRadius, WHEEL_WIDTH, 10)).dispose();
  shell('small', () => buildWheelGeometry(VEHICLE.wheelRadius * 0.92, 0.22, 10)).dispose();
  electricCarGeometry();
}

/* ================================================================== the furniture */

/** A screen face, for a board with words on it. The text itself is a canvas texture, made once. */
const BOARD_TEXTURES = new Map<string, THREE.CanvasTexture>();

export function boardTexture(text: string, color: number): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const key = `${text}|${color}`;
  const cached = BOARD_TEXTURES.get(key);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const g = canvas.getContext('2d');
  if (!g) return null;
  g.fillStyle = '#05080c';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
  g.font = 'bold 44px "Arial Narrow", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  // Long boards wrap onto two lines rather than shrinking into illegibility.
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (g.measureText(next).width > canvas.width - 40 && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  const step = canvas.height / (lines.length + 1);
  lines.forEach((l, i) => g.fillText(l, canvas.width / 2, step * (i + 1)));
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  BOARD_TEXTURES.set(key, texture);
  return texture;
}

/* ================================================================== assembly */

/**
 * Whether a prop moves: passed hand to hand, hauled between two people, or simply carried by
 * somebody. A crate on the ground to sit on and a crate in a mechanic's hand are the same kind
 * and different things, and what tells them apart is whether an actor says they hold it.
 */
export function looseProp(scene: MicroSceneDefinition, prop: PropDefinition): boolean {
  if (prop.transferable || prop.dragged) return true;
  return scene.actors.some((a) => a.holds === prop.id);
}

/** Build one scene's props. Called once, the first time the scene ever goes up. */
export function buildSceneProps(scene: MicroSceneDefinition): MicroScenePropSet {
  const lit: THREE.BufferGeometry[] = [];
  const glow: THREE.BufferGeometry[] = [];
  const blink: THREE.BufferGeometry[] = [];
  const loose: MicroScenePropSet['loose'] = [];
  const boards: MicroScenePropSet['boards'] = [];

  for (const prop of scene.props) {
    const { x, z, heading } = prop.offset;
    const y = prop.offset.y ?? 0;
    const color = prop.color ?? 0x5a5f66;
    const emissive = prop.emissive ?? 0xffd9a0;

    if (looseProp(scene, prop)) {
      loose.push({ prop, geometry: looseGeometry(prop), glow: prop.emissive !== undefined });
      continue;
    }

    switch (prop.kind) {
      case 'combustion-car':
      case 'tuned-coupe': {
        const tuned = prop.kind === 'tuned-coupe';
        // `smokes` on a vehicle also means the bonnet is up; a raised panel over the nose says so.
        const parts = coupeParts(color, tuned ? prop.emissive : undefined, tuned || !prop.smokes);
        for (const g of parts.lit) lit.push(at(g, x, y, z, heading));
        for (const g of parts.glow) glow.push(at(g, x, y, z, heading));
        if (prop.hazards) for (const g of hazardLamps()) blink.push(at(g, x, y, z, heading));
        if (prop.smokes) {
          // The bonnet, up and tilted back over the engine bay. Built in the CAR's own frame and
          // then placed with it — the nose is at the body's local -z, and a hood positioned in the
          // scene's frame instead is a hood that ends up inside a car parked any other way round.
          const hood = part(new THREE.BoxGeometry(1.5, 0.06, 1.1), color);
          hood.applyMatrix4(TMP.makeRotationX(-1.15));
          hood.translate(0, 1.15, -1.25);
          lit.push(at(hood, x, y, z, heading));
        }
        break;
      }
      case 'civilian-ev':
      case 'police-ev': {
        const police = prop.kind === 'police-ev';
        const parts = evParts(police ? 0x1b2330 : color, police ? (prop.emissive ?? 0x3fd0ff) : undefined);
        for (const g of parts.lit) lit.push(at(g, x, y, z, heading));
        for (const g of parts.glow) glow.push(at(g, x, y, z, heading));
        if (police) {
          // A light bar, emissive and nothing else. It does not light the street.
          glow.push(boxAt(1.2, 0.12, 0.28, 0x3fd0ff, x, y + 1.5, z, heading));
        }
        if (prop.hazards) for (const g of hazardLamps()) blink.push(at(g, x, y, z, heading));
        break;
      }
      case 'van': {
        const parts = vanParts(color);
        for (const g of parts.lit) lit.push(at(g, x, y, z, heading));
        break;
      }
      case 'table': {
        lit.push(boxAt(1.7, 0.07, 0.75, color, x, y + 0.86, z, heading));
        for (const [ox, oz] of [[-0.75, -0.3], [0.75, -0.3], [-0.75, 0.3], [0.75, 0.3]] as Array<[number, number]>) {
          const c = Math.cos(heading);
          const s = Math.sin(heading);
          lit.push(boxAt(0.05, 0.86, 0.05, 0x2a2e34, x + ox * c - oz * s, y + 0.43, z + ox * s + oz * c, heading));
        }
        // What is on it: a scatter of small parts, so the tarp has something to cover.
        for (let i = 0; i < 5; i++) {
          const along = -0.6 + i * 0.3;
          const c = Math.cos(heading);
          const s = Math.sin(heading);
          lit.push(boxAt(0.2, 0.1, 0.16, i % 2 ? 0x7c6a3a : 0x3b4550, x + along * c, y + 0.95, z + along * s, heading));
        }
        break;
      }
      case 'tarp':
        // Folded back off the table until the vendor throws it over: a low ridge along one edge.
        lit.push(boxAt(1.8, 0.09, 0.3, color, x, y + 0.96, z - 0.5, heading));
        break;
      case 'boxes':
        lit.push(boxAt(0.55, 0.42, 0.42, color, x, y + 0.21, z, heading));
        lit.push(boxAt(0.48, 0.36, 0.38, color, x + 0.06, y + 0.6, z + 0.04, heading + 0.3));
        break;
      case 'lamp':
        lit.push(boxAt(0.14, 0.2, 0.14, 0x22262c, x, y + 0.1, z, heading));
        glow.push(boxAt(0.2, 0.16, 0.2, emissive, x, y + 0.28, z, heading));
        break;
      case 'ledge':
        lit.push(boxAt(4.6, 0.5, 0.65, color, x, y + 0.25, z, heading));
        break;
      case 'holo-barrier':
        lit.push(boxAt(0.14, 0.9, 0.14, 0x2a2f36, x, y + 0.45, z, heading));
        // A pane of light, double-sided by being a thin box rather than a quad.
        glow.push(boxAt(1.5, 0.75, 0.03, emissive, x, y + 1.2, z, heading));
        break;
      case 'display-board': {
        lit.push(boxAt(2.1, 0.5, 0.07, 0x0b0f14, x, y, z, heading));
        // The face, with the words on it: its own small mesh, and the only texture a scene owns.
        // Turned to look the way the anchor does — a board is read from the road, not from behind
        // it, and a plane left facing local +z would show the Spanish mirrored.
        const face = at(new THREE.PlaneGeometry(2, 0.42).rotateY(Math.PI), x, y, z - 0.05, heading);
        boards.push({ prop, geometry: face, texture: boardTexture(prop.text ?? '', emissive) });
        break;
      }
      default:
        break;
    }
  }

  return {
    lit: lit.length > 0 ? mergeParts(lit) : null,
    glow: glow.length > 0 ? mergeParts(glow) : null,
    blink: blink.length > 0 ? mergeParts(blink) : null,
    loose,
    boards,
  };
}

/** The geometry of a prop that moves: carried in a hand, or hauled between two. */
function looseGeometry(prop: PropDefinition): THREE.BufferGeometry {
  switch (prop.kind) {
    case 'joint':
      // A centimetre of paper and a lit tip. Small enough that only the tip ever reads.
      return part(new THREE.BoxGeometry(0.015, 0.015, 0.09), prop.emissive ?? 0xff7a2a);
    case 'scanner':
      return part(new THREE.BoxGeometry(0.1, 0.16, 0.05), prop.emissive ?? 0x39ff9a);
    case 'bundle':
      // A long wrapped shape and nothing more: no face, no limbs, no detail to read.
      return part(new THREE.BoxGeometry(0.52, 0.42, 1.85), prop.color ?? 0x5a5c52);
    default:
      return part(new THREE.BoxGeometry(0.22, 0.14, 0.16), prop.color ?? 0x6b5a42);
  }
}
