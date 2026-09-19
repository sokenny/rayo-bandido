import * as THREE from 'three';
import { CRASH_DAMAGE } from '../../config/tuning';
import { box, mergeParts, partRGBA } from './vehicles/geometryKit';
import { createCarDamage } from './vehicles/damage';
import { createBodyAttitude } from './bodyAttitude';
import { slotColor, slotCss } from '../../core/playerColors';
import { createCabinInterior } from './vehicles/interior';
import { carPaintMaterial } from './vehicles/paintEnv';
import { STOCK_LOADOUT, cloneLoadout, sanitizeLoadout, type CarLoadout } from '../../core/loadout';
import { buildBodyGeometry } from './vehicles/bodyAssembler';
import { createCarPaint } from './vehicles/paintShop';
import { createCarLights } from './vehicles/lights';
import { createUnderglow } from './vehicles/underglow';
import { createWheelRig } from './vehicles/wheelRig';

/* Shared with the rival cars, the meet and the micro-scene props, which import them from here:
 * the stock body (closed cabin unless asked) and the stock tail lights. */
export { buildBodyGeometry } from './vehicles/bodyAssembler';
export { buildTailGeometry } from './vehicles/lights';

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
 * - All materials are created once; geometries too, except what `applyLoadout` rebuilds. Both
 *   are disposed in `dispose()`.
 * - `applyLoadout(loadout)` dresses the car in a workshop loadout (`src/core/loadout.ts`,
 *   `docs/GARAGE_PLAN.md`). Workshop-time only: it rebuilds geometry and disposes what it
 *   replaces, never per frame. The car starts as `STOCK_LOADOUT` — exactly the car it always was
 *   (`tests/carVisualStock.test.ts`) — unless `options.loadout` says otherwise. In a match the
 *   paint stays the slot colour whatever the loadout says (decision D3); parts still show.
 *
 * HOW IT IS BUILT. This file is the assembler; each piece is its own module under `vehicles/`:
 *   body       `vehicles/bodyAssembler.ts` ← the slot builders in `vehicles/parts/` + `plate.ts`
 *   paint      `vehicles/paintShop.ts` (the body's map) on `vehicles/paintEnv.ts` (its material)
 *   lamps      `vehicles/lights.ts`     head, tail, reverse, exhaust flame
 *   neon       `vehicles/underglow.ts`  sill strips + ground pool, the lightning charge meter
 *   wheels     `vehicles/wheelRig.ts`   instanced wheels, steer/spin carriers, stance
 *   cabin      `vehicles/interior.ts`, damage decals `vehicles/damage.ts`
 * They are created in the order their meshes have always been added, which is also the order
 * three.js breaks draw-order ties by (material and object ids): keep it when adding to it.
 *
 * IMPLEMENTATION NOTES
 * - The four wheels are a single `InstancedMesh`. The `steer`/`spin` objects that sync
 *   drives are transform carriers; `update()` bakes `steer.matrix * spin.matrix` into the
 *   instance matrices, so `update()` must run every frame after `syncCar()` (`src/game.ts`
 *   already does).
 * - Fourteen draw calls: body, glass, head lights, tail lights, reverse lights, exhaust glow,
 *   ground light pool, underglow, wheels, and the cabin's five (trim, light strips, spectrum
 *   bars and the two that make up the turning steering wheel — see `vehicles/interior.ts`).
 *   The chassis group costs nothing extra. A fifteenth, the crash damage decals
 *   (`vehicles/damage.ts`), is drawn only while the car carries any.
 */
export interface CarVisualOptions {
  /**
   * Grid slot in a multiplayer race. Given, the car is painted in that slot's colour with the
   * same marker strips a rival wears (`rivalCarVisual.ts`), so the player is the same colour
   * on their own screen as on everybody else's. Absent, it wears the single-player livery.
   */
  slot?: number;
  /** What the car wears (sanitized on the way in). Absent: `STOCK_LOADOUT`. */
  loadout?: CarLoadout;
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
  /** Front wheel angle (rad, positive = right), which turns the cabin's steering wheel. */
  setSteering(steerAngle: number): void;
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
  /** The lightning leaving the car, 0..1 by shot size: the body dips and rebounds. An impulse. */
  dischargeKick(strength: number): void;
  /** Settle the body back to level immediately (respawn). */
  resetBody(): void;
  setBrakeLights(on: boolean): void;
  setReverseLights(on: boolean): void;
  /**
   * Crash damage (`CrashDamageState.marks`): that many scrapes and dents on the body, and the paint
   * a little grimier with each. 0 is the clean car the garage hands back. Call on change only.
   */
  setDamage(marks: number): void;
  /** Per-frame animation hook (flicker, arcs). */
  update(frameDt: number, time: number): void;
  /** What the car wears right now. A copy is kept; treat it as read-only. */
  readonly loadout: CarLoadout;
  /**
   * Dress the car in `loadout` (sanitized first): rebuilds the body from its slots, the wheels
   * and their stance, the lamps, the neon, the cabin light and the paint, disposing every
   * geometry it replaces. Allocates, so workshop-time only — never per frame. Draw calls and
   * materials are unchanged by any loadout.
   */
  applyLoadout(loadout: CarLoadout): void;
  dispose(): void;
}

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
 * Windscreen, rear screen and side glass. Shared with the rival cars, like the bodywork.
 *
 * `glazingAlpha` scales the windscreen's and rear screen's opacity on top of the material's
 * own, and nothing else — the side windows are untouched. It is how the player's car gets
 * glass you can see the cabin through from behind and the road through from the driver's
 * seat (`interior.ts`), while a rival, which has no cabin behind either pane, keeps the flat
 * dark glass.
 */
export function buildGlassGeometry(glazingAlpha = 1): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const windshield = box(1.2, 0.02, 0.78);
  windshield.rotateX(-0.564);
  windshield.translate(0, 1.1, -0.41);
  parts.push(partRGBA(windshield, 0xffffff, glazingAlpha));
  const rearGlass = box(1.16, 0.02, 1.0);
  rearGlass.rotateX(0.377);
  rearGlass.translate(0, 1.137, 1.107);
  parts.push(partRGBA(rearGlass, 0xffffff, glazingAlpha));
  for (const sign of [-1, 1]) {
    const side = box(0.02, 0.4, 0.68);
    side.rotateZ(sign * 0.26);
    side.translate(sign * 0.7, 1.07, 0.3);
    parts.push(partRGBA(side, 0xffffff, 1));
  }
  return mergeParts(parts);
}

/** Vertex alpha of the player's windscreen and rear screen, on top of the glass material's
 *  own opacity. Low enough to see the cabin through from behind and the road through from
 *  the driver's seat, high enough that both panes still read as glass. */
const GLAZING_ALPHA = 0.52;

export function createCarVisual(options: CarVisualOptions = {}): CarVisual {
  const root = new THREE.Group();
  root.name = 'player-car';
  const disposables: Array<{ dispose(): void }> = [];
  const slot = options.slot;
  const slotTint = slot !== undefined ? new THREE.Color(slotColor(slot)) : null;
  /** What the car wears. Built as stock; `options.loadout` is applied at the end. */
  let loadout = cloneLoadout(STOCK_LOADOUT);

  /* Sprung mass. Rolls and pitches about the root origin, which puts the roll centre at
   * road level — right for a car this low, and it keeps the skirts clear of the tarmac. */
  const chassis = new THREE.Group();
  chassis.name = 'player-car-chassis';
  root.add(chassis);
  const attitude = createBodyAttitude();

  /* ----------------------------------------------------------------- body */
  // In a match the livery gives way to the slot colour: a rival is told apart by colour
  // alone, and the player has to be that same colour to themselves. So no paint shop at all.
  const paint = slotTint ? null : createCarPaint(loadout);
  if (paint) disposables.push(paint);
  const livery = paint ? paint.texture : null;
  // Self-lit only a touch: the livery used to glow at 0.14, which lit every facet alike and
  // flattened the body. The shape now comes from what the paint reflects (`vehicles/paintEnv.ts`).
  const bodyMat = carPaintMaterial({
    color: livery ? 0xffffff : 0x141834,
    map: livery,
    emissive: livery ? 0xffffff : 0x000000,
    emissiveMap: livery,
    emissiveIntensity: livery ? 0.04 : 0,
    vertexColors: true,
    roughness: 0.26,
    metalness: 0.62,
  });
  if (slotTint) tintBody(bodyMat, slotTint);
  const body = new THREE.Mesh(buildBodyGeometry(true, loadout), bodyMat);
  body.name = 'player-car-body';
  chassis.add(body);
  disposables.push(bodyMat);
  /** The paint as built, so grime is always taken from the clean colour and never compounds. */
  const cleanPaint = bodyMat.color.clone();
  let damageMarks = 0;

  /* --------------------------------------------------------------- damage */
  const damage = createCarDamage();
  chassis.add(damage.mesh);
  disposables.push(damage);

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
  // The chase camera looks through the rear screen for the whole game and the cabin view
  // looks out through the windscreen, so on the player's own car both panes are left far
  // clearer than the side glass: they are the windows onto, and out of, the cabin.
  const glassGeo = buildGlassGeometry(GLAZING_ALPHA);
  // The player's glass differs from a rival's (`rivalCarVisual.ts`) in more than its alpha,
  // because it is the only glass with a cabin behind it rather than paint. Each pane is a
  // 2 cm box, so a double-sided one blends twice along the same sight line and a window ends
  // up darker than the paint around it — a black board laid on the deck rather than a hole
  // you look through. Front faces only fixes that; the pane still reads from both sides,
  // since each side sees its own outward face. Less metal and a little more colour in the
  // tint then leave it looking like glass at an angle instead of an absence.
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x15242f,
    roughness: 0.08,
    metalness: 0.32,
    transparent: true,
    opacity: 0.68,
    vertexColors: true,
    side: THREE.FrontSide,
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

  /* ------------------------------------ head, tail, reverse, exhaust flame */
  const lights = createCarLights(chassis, loadout);
  disposables.push(lights);

  /* ------------------------------------------ underglow: strips and ground pool */
  const underglow = createUnderglow(root, chassis, loadout);
  disposables.push(underglow);

  /* ---------------------------------------------------------------- wheels */
  const wheelRig = createWheelRig(root, loadout);
  disposables.push(wheelRig);

  function applyGrime(): void {
    const worn = Math.max(0, Math.min(1, damageMarks / CRASH_DAMAGE.visual.maxMarks));
    bodyMat.color.copy(cleanPaint).multiplyScalar(1 - CRASH_DAMAGE.visual.grime * worn);
  }

  function applyLoadout(next: CarLoadout): void {
    loadout = sanitizeLoadout(next);
    const old = body.geometry;
    body.geometry = buildBodyGeometry(true, loadout);
    old.dispose();
    wheelRig.applyLoadout(loadout);
    lights.applyLoadout(loadout);
    underglow.applyLoadout(loadout);
    interior.applyLoadout(loadout);
    // In a match the paint is the slot colour (D3): the paint shop does not exist there.
    if (paint) {
      paint.apply(loadout, bodyMat);
      cleanPaint.copy(bodyMat.color);
      applyGrime();
    }
  }

  if (options.loadout) applyLoadout(options.loadout);

  return {
    root,
    chassis,
    wheels: wheelRig.wheels,
    paint: slot !== undefined ? slotCss(slot) : 'livery',
    get loadout() {
      return loadout;
    },
    applyLoadout,
    setNitro(intensity) {
      lights.setNitro(intensity < 0 ? 0 : intensity > 1 ? 1 : intensity);
    },
    setCharge(level) {
      underglow.setCharge(level < 0 ? 0 : level > 1 ? 1 : level);
    },
    setMusic(spectrum) {
      interior.setMusic(spectrum);
    },
    setSteering(steerAngle) {
      interior.setSteering(steerAngle);
    },
    setBodyAccel(latAccel, longAccel) {
      attitude.setAccel(latAccel, longAccel);
    },
    shiftKick(strength) {
      attitude.kick(strength);
    },
    dischargeKick(strength) {
      attitude.discharge(strength);
    },
    resetBody() {
      attitude.reset();
      chassis.rotation.set(0, 0, 0);
      chassis.position.set(0, 0, 0);
    },
    setBrakeLights(on) {
      lights.setBraking(on);
    },
    setReverseLights(on) {
      lights.setReversing(on);
    },
    setDamage(marks) {
      damage.setMarks(marks);
      damageMarks = marks;
      applyGrime();
    },
    update(frameDt, time) {
      attitude.update(frameDt);
      chassis.rotation.z = attitude.roll;
      chassis.rotation.x = attitude.pitch;
      // The shell runs fore-aft on its mounts; the wheels below it never move. Ride height
      // (`wheelRig.rideHeight`, 0 on stock) lowers or lifts the sprung body only.
      chassis.position.z = attitude.surge;
      chassis.position.y = attitude.heave + wheelRig.rideHeight;
      wheelRig.sync();
      interior.update(frameDt);
      underglow.update(time);
    },
    dispose() {
      body.geometry.dispose();
      for (const d of disposables) d.dispose();
    },
  };
}
