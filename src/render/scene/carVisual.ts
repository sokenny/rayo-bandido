import * as THREE from 'three';
import { VEHICLE } from '../../config/tuning';
import { applyLengthwiseUVs, box, glowPool, loft, mergeParts, part, partRGBA, wheelArch } from './vehicles/geometryKit';
import { createBodyAttitude } from './bodyAttitude';
import { createLiveryTexture } from './vehicles/livery';
import { slotColor, slotCss } from '../../core/playerColors';
import { buildWheelGeometry } from './vehicles/wheel';
import { createCabinInterior } from './vehicles/interior';

/**
 * Player car visual: a stylized low-poly GT86-like drift coupe.
 *
 * CONTRACT
 * - `root` origin is on the ground at the center of the wheelbase. The nose points toward
 *   local -Z. `src/render/sync.ts` sets `root.position` and `root.rotation.y`.
 * - Everything that rides on the springs (bodywork, glass, cabin, lights, exhaust and rocker
 *   glow) lives under `chassis`, which rolls and pitches about the root origin and shifts a
 *   centimetre or two fore-aft when the gearbox shoves it. The wheels and the
 *   ground light pool stay on `root` so they keep their contact with the road.
 * - `wheels` are ordered [front-left, front-right, rear-left, rear-right]. Sync rotates
 *   `steer.rotation.y` (front wheels only) and `spin.rotation.x` (all wheels).
 * - Wheel radius is `VEHICLE.wheelRadius`; wheel centers sit at y = wheelRadius.
 * - All materials/geometries are created once and disposed in `dispose()`.
 *
 * IMPLEMENTATION NOTES
 * - The four wheels are a single `InstancedMesh`. The `steer`/`spin` objects that sync
 *   drives are transform carriers; `update()` bakes `steer.matrix * spin.matrix` into the
 *   instance matrices, so `update()` must run every frame after `syncCar()` (`src/game.ts`
 *   already does).
 * - Twelve draw calls: body, glass, head lights, tail lights, reverse lights, exhaust glow,
 *   ground light pool, underglow, wheels, and the cabin's three (trim, light strips, spectrum
 *   bars — see `vehicles/interior.ts`). The chassis group costs nothing extra.
 */
export interface CarVisualOptions {
  /**
   * Grid slot in a multiplayer race. Given, the car is painted in that slot's colour with the
   * same marker strips a rival wears (`rivalCarVisual.ts`), so the player is the same colour
   * on their own screen as on everybody else's. Absent, it wears the single-player livery.
   */
  slot?: number;
}

export interface CarVisual {
  /** What the body is painted: `'livery'` for the single-player paint, or the CSS hex of a slot colour. */
  readonly paint: string;
  root: THREE.Group;
  /** Sprung mass: the bodywork, which leans and dives relative to the planted wheels. */
  chassis: THREE.Group;
  wheels: Array<{ steer: THREE.Object3D; spin: THREE.Object3D }>;
  /** 0..1 magenta/violet exhaust + boost glow. */
  setNitro(intensity: number): void;
  /** 0..1 cyan underglow / electric charge glow. */
  setCharge(level: number): void;
  /**
   * The music the cabin's spectrum display runs on: `ThemeAudio.spectrum`, one 0..1 level per
   * bar, low frequencies first. Held by reference, so passing it once is enough; with nothing
   * passed the display simply rests on its floor line.
   */
  setMusic(spectrum: ArrayLike<number>): void;
  /**
   * Accelerations the body is under this frame (m/s^2, car local frame): `VehicleState`'s
   * `latAccel` and `longAccel`. Drives body roll and dive/squat; `update()` integrates it.
   */
  setBodyAccel(latAccel: number, longAccel: number): void;
  /**
   * Shove the body once for a gear change: `drivetrain.shiftKickStrength` signed -1..1,
   * positive for an upshift. One call per shift — this is an impulse, not a per-frame value.
   */
  shiftKick(strength: number): void;
  /** Settle the body back to level immediately (respawn). */
  resetBody(): void;
  setBrakeLights(on: boolean): void;
  setReverseLights(on: boolean): void;
  /** Per-frame animation hook (flicker, arcs). */
  update(frameDt: number, time: number): void;
  dispose(): void;
}

/* Vertex colors multiply the livery map: white keeps the full livery, a dark tint turns a
 * merged part into matte carbon or plastic. */
const PAINT = 0xffffff;
const PAINT_ROOF = 0xb8bfd0;
const CARBON = 0x5a5f70;
const CARBON_DARK = 0x3c404d;
const GRILLE = 0x1e2230;
const CHROME = 0x9aa3b5;
const PLATE = 0xe8e4d6;

const WHEEL_WIDTH = 0.26;
const FRONT_HALF_TRACK = VEHICLE.trackWidth / 2;
const REAR_HALF_TRACK = VEHICLE.trackWidth / 2 + 0.02;
const HALF_BASE = VEHICLE.wheelbase / 2;

/** Vertex alpha of the player's rear screen, on top of the glass material's own opacity.
 *  Low enough to see the cabin through, high enough that the pane still reads as glass. */
const REAR_GLASS_ALPHA = 0.52;

const TAIL_RED = new THREE.Color(0xff1a2e);
const TAIL_MAGENTA = new THREE.Color(0xff33d6);

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

/**
 * The bodywork, merged into one geometry.
 *
 * Exported because the rival cars in a multiplayer race are the same car in somebody else's
 * colours (`src/render/scene/rivalCarVisual.ts`) and build this once to share between them.
 * The player's own car keeps its own copy: it is the only one that needs the livery map.
 */
export function buildBodyGeometry(openCabin = false): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  // Main hull: wide low nose, long hood, rising beltline, tucked tail.
  parts.push(
    part(
      loft([
        { z: -2.1, bottomY: 0.28, topY: 0.6, bottomHalfWidth: 0.66, topHalfWidth: 0.74 },
        { z: -1.86, bottomY: 0.15, topY: 0.68, bottomHalfWidth: 0.82, topHalfWidth: 0.88 },
        { z: -1.3, bottomY: 0.12, topY: 0.79, bottomHalfWidth: 0.86, topHalfWidth: 0.9 },
        { z: -0.72, bottomY: 0.12, topY: 0.86, bottomHalfWidth: 0.88, topHalfWidth: 0.89 },
        { z: 0.3, bottomY: 0.12, topY: 0.89, bottomHalfWidth: 0.89, topHalfWidth: 0.87 },
        { z: 1.3, bottomY: 0.13, topY: 0.89, bottomHalfWidth: 0.9, topHalfWidth: 0.88 },
        { z: 1.9, bottomY: 0.19, topY: 0.86, bottomHalfWidth: 0.86, topHalfWidth: 0.82 },
        { z: 2.12, bottomY: 0.34, topY: 0.77, bottomHalfWidth: 0.76, topHalfWidth: 0.72 },
      ]),
      PAINT,
    ),
  );

  // Greenhouse: raked windshield, short cabin set back, fastback into a short deck.
  //
  // `openCabin` leaves the windscreen and backlight panels out, so those two are real holes
  // with the cabin behind them (`vehicles/interior.ts`) rather than paint under a pane of
  // glass. Only the player's own car takes it: a rival carries no cabin, and an empty opening
  // would be a window straight through the car.
  parts.push(
    part(
      loft(
        [
          { z: -0.74, bottomY: 0.8, topY: 0.87, bottomHalfWidth: 0.76, topHalfWidth: 0.76 },
          { z: -0.06, bottomY: 0.84, topY: 1.3, bottomHalfWidth: 0.74, topHalfWidth: 0.62 },
          { z: 0.62, bottomY: 0.84, topY: 1.31, bottomHalfWidth: 0.74, topHalfWidth: 0.62 },
          { z: 1.58, bottomY: 0.84, topY: 0.93, bottomHalfWidth: 0.78, topHalfWidth: 0.72 },
        ],
        { openTop: openCabin ? [0, 2] : [] },
      ),
      PAINT_ROOF,
    ),
  );

  // Wide-body over-fenders.
  for (const z of [-HALF_BASE, HALF_BASE]) {
    for (const sign of [-1, 1]) {
      const arch = wheelArch(VEHICLE.wheelRadius + 0.07, 0.07, 0.22, 7);
      arch.translate(sign * 0.9, VEHICLE.wheelRadius, z);
      parts.push(part(arch, PAINT));
    }
  }

  // Front splitter / lip.
  parts.push(
    part(
      loft([
        { z: -2.26, bottomY: 0.09, topY: 0.15, bottomHalfWidth: 0.74, topHalfWidth: 0.8 },
        { z: -2.0, bottomY: 0.09, topY: 0.2, bottomHalfWidth: 0.9, topHalfWidth: 0.94 },
        { z: -1.62, bottomY: 0.1, topY: 0.26, bottomHalfWidth: 0.94, topHalfWidth: 0.95 },
      ]),
      CARBON,
    ),
  );

  // Side skirts.
  for (const sign of [-1, 1]) {
    const skirt = box(0.09, 0.17, 2.24);
    skirt.translate(sign * 0.94, 0.18, 0);
    parts.push(part(skirt, CARBON));
  }

  // Rear diffuser with strakes.
  const diffuser = box(1.56, 0.13, 0.54);
  diffuser.translate(0, 0.17, 1.85);
  parts.push(part(diffuser, CARBON_DARK));
  for (const x of [-0.58, -0.2, 0.2, 0.58]) {
    const fin = box(0.05, 0.18, 0.54);
    fin.translate(x, 0.16, 1.85);
    parts.push(part(fin, CARBON));
  }

  // Rear valance and number plate.
  const valance = box(1.34, 0.2, 0.06);
  valance.translate(0, 0.4, 2.11);
  parts.push(part(valance, CARBON_DARK));
  const plate = box(0.46, 0.15, 0.03);
  plate.translate(0, 0.53, 2.145);
  parts.push(part(plate, PLATE));

  // GT wing: plane, endplates, stanchions.
  const wingPlane = box(1.76, 0.05, 0.34);
  wingPlane.rotateX(-0.14);
  wingPlane.translate(0, 1.24, 1.72);
  parts.push(part(wingPlane, CARBON));
  for (const sign of [-1, 1]) {
    const endplate = box(0.03, 0.24, 0.42);
    endplate.translate(sign * 0.87, 1.21, 1.72);
    parts.push(part(endplate, CARBON_DARK));
    const stanchion = box(0.05, 0.42, 0.14);
    stanchion.translate(sign * 0.55, 1.04, 1.7);
    parts.push(part(stanchion, CARBON_DARK));
  }

  // Mirrors.
  for (const sign of [-1, 1]) {
    const stalk = box(0.14, 0.04, 0.05);
    stalk.translate(sign * 0.88, 0.92, -0.56);
    parts.push(part(stalk, CARBON_DARK));
    const housing = box(0.16, 0.09, 0.12);
    housing.rotateY(sign * 0.14);
    housing.translate(sign * 0.99, 0.95, -0.58);
    parts.push(part(housing, CARBON));
  }

  // Grille, lower intake and hood vents.
  const grille = box(1.0, 0.18, 0.05);
  grille.translate(0, 0.42, -2.11);
  parts.push(part(grille, GRILLE));
  const intake = box(1.24, 0.12, 0.05);
  intake.translate(0, 0.24, -2.16);
  parts.push(part(intake, GRILLE));
  for (const sign of [-1, 1]) {
    const vent = box(0.3, 0.05, 0.22);
    vent.translate(sign * 0.36, 0.78, -1.34);
    parts.push(part(vent, CARBON_DARK));
  }

  // Dual round exhaust tips.
  for (const sign of [-1, 1]) {
    const tip = new THREE.CylinderGeometry(0.078, 0.078, 0.2, 10, 1, true);
    tip.rotateX(Math.PI / 2);
    tip.translate(sign * 0.34, 0.33, 2.14);
    parts.push(part(tip, CHROME));
    const rim = new THREE.RingGeometry(0.05, 0.078, 10, 1);
    rim.translate(sign * 0.34, 0.33, 2.24);
    parts.push(part(rim, CARBON_DARK));
  }

  const merged = mergeParts(parts);
  applyLengthwiseUVs(merged);
  merged.computeBoundingSphere();
  return merged;
}

/** Windscreen, rear screen and side glass. Shared with the rival cars, like the bodywork. */
/**
 * Rocker strips, a slim roof bar and a rear strip, all white so a per-car tint can colour
 * them: the marker that names a player's colour from any angle. Worn by every car in a
 * multiplayer race, the player's own included.
 */
export function buildMarkerGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const sign of [-1, 1]) {
    const rocker = box(0.03, 0.05, 1.9);
    rocker.translate(sign * 0.995, 0.13, 0);
    parts.push(partRGBA(rocker, 0xffffff, 1));
  }
  // A slim bar across the roof: the one part of a car ahead of you that is never occluded.
  const roof = box(0.9, 0.05, 0.12);
  roof.translate(0, 1.35, 0.3);
  parts.push(partRGBA(roof, 0xffffff, 1));
  const rear = box(1.44, 0.04, 0.02);
  rear.translate(0, 0.17, 2.13);
  parts.push(partRGBA(rear, 0xffffff, 1));
  return mergeParts(parts);
}

/**
 * The body paint of a car in slot colour `colour`: dark enough to stay a night-time car,
 * saturated enough to name across the circuit. One formula for the player and the rivals.
 */
export function tintBody(material: THREE.MeshStandardMaterial, colour: THREE.Color): void {
  material.color.copy(colour).multiplyScalar(0.42);
  material.emissive.copy(colour).multiplyScalar(0.06);
}

/**
 * `rearAlpha` scales the rear screen's opacity on top of the material's own, and nothing
 * else: it is how the player's car gets a back window you can see the cabin through
 * (`interior.ts`) while a rival, which has no cabin behind it, keeps the flat dark glass.
 */
export function buildGlassGeometry(rearAlpha = 1): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const windshield = box(1.2, 0.02, 0.78);
  windshield.rotateX(-0.564);
  windshield.translate(0, 1.1, -0.41);
  parts.push(partRGBA(windshield, 0xffffff, 1));
  const rearGlass = box(1.16, 0.02, 1.0);
  rearGlass.rotateX(0.377);
  rearGlass.translate(0, 1.137, 1.107);
  parts.push(partRGBA(rearGlass, 0xffffff, rearAlpha));
  for (const sign of [-1, 1]) {
    const side = box(0.02, 0.4, 0.68);
    side.rotateZ(sign * 0.26);
    side.translate(sign * 0.7, 1.07, 0.3);
    parts.push(partRGBA(side, 0xffffff, 1));
  }
  return mergeParts(parts);
}

/** Tail light clusters. Shared with the rival cars: the view of a rival is usually this one. */
export function buildTailGeometry(): THREE.BufferGeometry {
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

export function createCarVisual(options: CarVisualOptions = {}): CarVisual {
  const root = new THREE.Group();
  root.name = 'player-car';
  const disposables: Array<{ dispose(): void }> = [];
  const slot = options.slot;
  const slotTint = slot !== undefined ? new THREE.Color(slotColor(slot)) : null;

  /* Sprung mass. Rolls and pitches about the root origin, which puts the roll centre at
   * road level — right for a car this low, and it keeps the skirts clear of the tarmac. */
  const chassis = new THREE.Group();
  chassis.name = 'player-car-chassis';
  root.add(chassis);
  const attitude = createBodyAttitude();

  /* ----------------------------------------------------------------- body */
  // In a match the livery gives way to the slot colour: a rival is told apart by colour
  // alone, and the player has to be that same colour to themselves.
  const livery = slotTint ? null : createLiveryTexture();
  if (livery) disposables.push(livery);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: livery ? 0xffffff : 0x141834,
    map: livery,
    emissive: livery ? 0xffffff : 0x000000,
    emissiveMap: livery,
    emissiveIntensity: livery ? 0.14 : 0,
    vertexColors: true,
    roughness: 0.38,
    metalness: 0.28,
  });
  if (slotTint) tintBody(bodyMat, slotTint);
  const bodyGeo = buildBodyGeometry(true);
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.name = 'player-car-body';
  chassis.add(body);
  disposables.push(bodyGeo, bodyMat);

  /* --------------------------------------------------------------- marker */
  if (slotTint) {
    const markerGeo = buildMarkerGeometry();
    const markerMat = new THREE.MeshBasicMaterial({
      color: slotTint,
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const marker = new THREE.Mesh(markerGeo, markerMat);
    marker.name = 'player-car-marker';
    marker.renderOrder = 2;
    chassis.add(marker);
    disposables.push(markerGeo, markerMat);
  }

  /* ---------------------------------------------------------------- glass */
  // The chase camera looks through the rear screen for the whole game, so on the player's own
  // car that pane is left far clearer than the rest: it is the window onto the cabin.
  const glassGeo = buildGlassGeometry(REAR_GLASS_ALPHA);
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x0b1c26,
    roughness: 0.06,
    metalness: 0.55,
    transparent: true,
    opacity: 0.68,
    vertexColors: true,
    side: THREE.DoubleSide,
  });
  const glass = new THREE.Mesh(glassGeo, glassMat);
  glass.name = 'player-car-glass';
  glass.renderOrder = 4; // After the cabin, which is what you are looking at through it.
  chassis.add(glass);
  disposables.push(glassGeo, glassMat);

  /* ------------------------------------------------------------- interior */
  const interior = createCabinInterior();
  chassis.add(interior.group);
  disposables.push(interior);

  /* ----------------------------------------------------------- head lights */
  const headParts: THREE.BufferGeometry[] = [];
  for (const sign of [-1, 1]) {
    const lamp = box(0.36, 0.13, 0.1);
    lamp.rotateY(sign * 0.1);
    lamp.translate(sign * 0.44, 0.5, -2.13);
    headParts.push(part(lamp, 0xffffff));
    const drl = box(0.3, 0.035, 0.08);
    drl.translate(sign * 0.44, 0.38, -2.13);
    headParts.push(part(drl, 0x9fe8ff));
  }
  const headGeo = mergeParts(headParts);
  const headMat = new THREE.MeshStandardMaterial({
    color: 0x0a0d12,
    emissive: 0xdff2ff,
    emissiveIntensity: 1.5,
    vertexColors: true,
    roughness: 0.2,
  });
  const head = new THREE.Mesh(headGeo, headMat);
  chassis.add(head);
  disposables.push(headGeo, headMat);

  /* ----------------------------------------------------------- tail lights */
  const tailGeo = buildTailGeometry();
  const tailMat = new THREE.MeshStandardMaterial({
    color: 0x180205,
    emissive: 0xff1a2e,
    emissiveIntensity: 0.9,
    vertexColors: true,
    roughness: 0.3,
  });
  const tail = new THREE.Mesh(tailGeo, tailMat);
  chassis.add(tail);
  disposables.push(tailGeo, tailMat);

  /* -------------------------------------------------------- reverse lights */
  const reverseParts: THREE.BufferGeometry[] = [];
  for (const sign of [-1, 1]) {
    const lamp = box(0.15, 0.07, 0.05);
    lamp.translate(sign * 0.46, 0.4, 2.16);
    reverseParts.push(part(lamp, 0xffffff));
  }
  const reverseGeo = mergeParts(reverseParts);
  const reverseMat = new THREE.MeshStandardMaterial({
    color: 0x0e1014,
    emissive: 0xffffff,
    emissiveIntensity: 0,
    vertexColors: true,
    roughness: 0.4,
  });
  const reverse = new THREE.Mesh(reverseGeo, reverseMat);
  chassis.add(reverse);
  disposables.push(reverseGeo, reverseMat);

  /* ---------------------------------------------------------- exhaust glow */
  const exhaustParts: THREE.BufferGeometry[] = [];
  for (const sign of [-1, 1]) {
    const disc = glowDisc(0.072, 10);
    disc.translate(sign * 0.34, 0.33, 2.245);
    exhaustParts.push(disc);
  }
  const exhaustGeo = mergeParts(exhaustParts);
  const exhaustMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const exhaustGlow = new THREE.Mesh(exhaustGeo, exhaustMat);
  exhaustGlow.renderOrder = 3;
  chassis.add(exhaustGlow);
  disposables.push(exhaustGeo, exhaustMat);

  /* ------------------------------------------ underglow: ground light spill */
  // A soft radial pool cast on the road beneath the car. Its own mesh/material so
  // the spill can read as light without over-brightening the hard neon strips.
  const poolGeo = glowPool(3.9, 6.2, 8, 12, 0x22e6ff, 0xff2fd0);
  poolGeo.translate(0, 0.02, 0.1);
  const poolMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const groundGlow = new THREE.Mesh(poolGeo, poolMat);
  groundGlow.name = 'player-car-groundglow';
  groundGlow.renderOrder = 1;
  root.add(groundGlow);
  disposables.push(poolGeo, poolMat);

  /* ---------------------------------------------------------- underglow rim */
  const glowParts: THREE.BufferGeometry[] = [];
  for (const sign of [-1, 1]) {
    const rocker = box(0.02, 0.04, 1.62);
    rocker.translate(sign * 0.995, 0.11, 0);
    glowParts.push(partRGBA(rocker, 0x22e6ff, 1));
  }
  const rearStrip = box(1.44, 0.035, 0.02);
  rearStrip.translate(0, 0.15, 2.13);
  glowParts.push(partRGBA(rearStrip, 0xff2fd0, 1));
  const frontStrip = box(1.3, 0.03, 0.02);
  frontStrip.translate(0, 0.11, -2.27);
  glowParts.push(partRGBA(frontStrip, 0x22e6ff, 1));
  const glowGeo = mergeParts(glowParts);
  const glowMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const glow = new THREE.Mesh(glowGeo, glowMat);
  glow.name = 'player-car-underglow';
  glow.renderOrder = 2;
  chassis.add(glow);
  disposables.push(glowGeo, glowMat);

  /* ---------------------------------------------------------------- wheels */
  const wheelGeo = buildWheelGeometry(VEHICLE.wheelRadius, WHEEL_WIDTH, 16);
  const wheelMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.45 });
  const wheelsMesh = new THREE.InstancedMesh(wheelGeo, wheelMat, 4);
  wheelsMesh.name = 'player-car-wheels';
  root.add(wheelsMesh);
  disposables.push(wheelGeo, wheelMat, wheelsMesh);

  const wheelPositions: Array<[number, number]> = [
    [-FRONT_HALF_TRACK, -HALF_BASE],
    [FRONT_HALF_TRACK, -HALF_BASE],
    [-REAR_HALF_TRACK, HALF_BASE],
    [REAR_HALF_TRACK, HALF_BASE],
  ];
  const wheels: Array<{ steer: THREE.Object3D; spin: THREE.Object3D }> = [];
  for (const [x, z] of wheelPositions) {
    const steer = new THREE.Object3D();
    steer.position.set(x, VEHICLE.wheelRadius, z);
    const spin = new THREE.Object3D();
    steer.add(spin);
    root.add(steer);
    wheels.push({ steer, spin });
  }

  const wheelMatrix = new THREE.Matrix4();
  function syncWheelInstances(): void {
    for (let i = 0; i < wheels.length; i++) {
      const w = wheels[i];
      w.steer.updateMatrix();
      w.spin.updateMatrix();
      wheelMatrix.multiplyMatrices(w.steer.matrix, w.spin.matrix);
      wheelsMesh.setMatrixAt(i, wheelMatrix);
    }
    wheelsMesh.instanceMatrix.needsUpdate = true;
  }
  syncWheelInstances();
  wheelsMesh.computeBoundingSphere();

  /* ------------------------------------------------------------- behaviour */
  let nitro = 0;
  let charge = 0;
  let braking = false;
  let reversing = false;
  let flicker = 1;

  function refreshLights(): void {
    let intensity = 0.85 + nitro * 1.9;
    if (braking) intensity = Math.max(intensity, 3.4);
    tailMat.emissiveIntensity = intensity;
    tailMat.emissive.lerpColors(TAIL_RED, TAIL_MAGENTA, braking ? 0 : Math.min(1, nitro * 0.85));
    reverseMat.emissiveIntensity = reversing ? 2.6 : 0;
    exhaustMat.opacity = 0.2 + nitro * 1.6;
    const scale = 1 + nitro * 0.7;
    exhaustGlow.scale.set(scale, scale, 1);
  }

  function refreshUnderglow(): void {
    glowMat.opacity = (0.2 + charge * 0.85) * flicker;
    // Ground spill: always present for immersion, brightening with charge.
    poolMat.opacity = (0.45 + charge * 0.8) * flicker;
  }

  refreshLights();
  refreshUnderglow();

  return {
    root,
    chassis,
    wheels,
    paint: slot !== undefined ? slotCss(slot) : 'livery',
    setNitro(intensity) {
      nitro = intensity < 0 ? 0 : intensity > 1 ? 1 : intensity;
      refreshLights();
    },
    setCharge(level) {
      charge = level < 0 ? 0 : level > 1 ? 1 : level;
      refreshUnderglow();
    },
    setMusic(spectrum) {
      interior.setMusic(spectrum);
    },
    setBodyAccel(latAccel, longAccel) {
      attitude.setAccel(latAccel, longAccel);
    },
    shiftKick(strength) {
      attitude.kick(strength);
    },
    resetBody() {
      attitude.reset();
      chassis.rotation.set(0, 0, 0);
      chassis.position.set(0, 0, 0);
    },
    setBrakeLights(on) {
      braking = on;
      refreshLights();
    },
    setReverseLights(on) {
      reversing = on;
      refreshLights();
    },
    update(frameDt, time) {
      attitude.update(frameDt);
      chassis.rotation.z = attitude.roll;
      chassis.rotation.x = attitude.pitch;
      // The shell runs fore-aft on its mounts; the wheels below it never move.
      chassis.position.z = attitude.surge;
      syncWheelInstances();
      interior.update(frameDt);
      if (charge > 0.6) {
        const t = time * 26;
        flicker = 1 + (Math.sin(t) + Math.sin(t * 2.7)) * 0.08 * (charge - 0.6) * 2.5;
      } else {
        flicker = 1;
      }
      refreshUnderglow();
    },
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
