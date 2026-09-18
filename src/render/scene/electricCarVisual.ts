import * as THREE from 'three';
import type { TargetStatus } from '../../core/types';
import { applyLengthwiseUVs, box, loft, mergeParts, part } from './vehicles/geometryKit';
import { attachTexture, type TextureHandle } from '../textures/load';
import { fleetPaintMaterial } from './vehicles/paintEnv';

/**
 * Electric-car target visual. Clean, homogeneous, corporate: white/cool-cyan, soft shapes,
 * a blinking network light. Contrast with the player's analog outlaw coupe.
 *
 * CONTRACT
 * - `root` origin on the ground, nose toward local -Z. Sync sets position/rotation.
 * - `setStatus` is called every frame with the sim status and seconds since the hit
 *   (0 when never hit). 'destroyed' plays the POWER-DOWN CASCADE below: the car is lit from
 *   inside, stutters, and goes out one system at a time. It must end up reading as a car with
 *   the power off — its own paint, unlit — and never as a black silhouette.
 * - `setRushTarget(true)` marks this car as worth points during a RAYO RUSH run
 *   (`src/sim/rush.ts`), with a slow amber ring on the ground. That is the only thing the
 *   ring ever means: aiming is the player's job and nothing locks on, so a car the beam
 *   happens to line up with wears no marking at all.
 * - Share geometries/materials across instances; dispose shared resources once via
 *   `disposeElectricCarResources()`.
 *
 * Four draw calls per target: body, light bars, roof beacon, rush ring.
 */
export interface ElectricCarVisual {
  root: THREE.Group;
  setStatus(status: TargetStatus, timeSinceHit: number): void;
  setRushTarget(marked: boolean): void;
  update(frameDt: number, time: number): void;
  dispose(): void;
}

const SHELL = 0xffffff;
const GLASS = 0x3b4557;
const TRIM = 0xb9c2ce;
const TYRE = 0x1a1c22;
const POD = 0xdfe6ef;

/**
 * The three paints the city's electric cars come in. Deliberately muted — the neon belongs
 * to the players, so a target reads as part of the traffic. Which one a car wears follows
 * its index, so the mix is the same every run.
 */
const BODY_COLORS = [
  new THREE.Color(0xe8f0ff), // ice white
  new THREE.Color(0x6f8296), // slate blue
  new THREE.Color(0xc9a172), // warm sand
];
const CLEAN_BAR = new THREE.Color(0x00e5ff);
/** The amber a Rayo Rush target wears on the ground. */
const RUSH_RING = new THREE.Color(0xfcee0a);
/** A dead light bar: not quite black, so the strip still reads as a strip. */
const DEAD_BAR = new THREE.Color(0x0c0f12);
/** What everything the surge is running through turns: arc white with cyan left in it. */
const SURGE = new THREE.Color(0xcdf6ff);
/** Hazard amber, for the wrecks whose bars come back for two blinks after the lights go. */
const HAZARD = new THREE.Color(0xffa326);
/** The cold the paint is left in once nothing is lighting it. */
const DEAD_TINT = new THREE.Color(0x14171c);

/**
 * THE POWER-DOWN CASCADE, in seconds since the hit. The bolt does not paint the car black; it
 * puts far too much through it and then the car loses its systems in order, which is the only
 * version of this that says ELECTRIC rather than BURNT.
 *
 *   0    -> T_SURGE    the whole car floods with light from inside, brighter than it is ever
 *                      allowed to be in service, and the roof beacon swells with it.
 *   ..   -> T_FLICKER   everything stutters: three detuned waves quantised to three levels,
 *                      which reads as a contact arcing rather than as a sine.
 *   ..   -> T_CABIN     the interior glow drains away first.
 *   ..   -> T_BARS      the light bars are cut.
 *   ..   -> T_BEACON    the beacon takes its last blink, and the car is dark.
 *
 * The whole thing is a pure function of the age of the hit, so a wreck looks the same at 30 fps
 * as at 240, a paused frame is a real frame of it, and `setStatus` can be called with any age
 * in any order — which is what lets the tests read the middle of it.
 */
const T_SURGE = 0.16;
const T_FLICKER = 0.58;
const T_CABIN = 0.74;
const T_BARS = 0.9;
const T_BEACON = 1.05;

/** Long enough after the hit that every phase above has finished. */
const SETTLED = 99;

/** How long the chassis takes to settle onto its dead springs, in seconds. */
const SAG_TIME = 0.95;
/** The torque jerk as the motor cuts: how long it rings for (s) and its peak yaw (rad). */
const JERK_TIME = 0.35;
const JERK_YAW = 0.085;

/** The variant-2 hazards: two slow amber blinks after the beacon, over this many seconds. */
const HAZARD_TIME = 1.4;
/** The variant-1 beacon: how much longer than `T_BEACON` its contact holds on. */
const STUCK_BEACON = 0.9;

/**
 * Seconds after the hit from which every variant's cascade has finished and a wreck no longer
 * changes: the last thing to go out is the variant-2 hazard blink. From here on the car looks
 * exactly as it does at `SETTLED`, which is what lets the fleet (`electricFleet.ts`) draw it
 * instanced.
 */
export const ELECTRIC_CASCADE_END = Math.max(T_BEACON + HAZARD_TIME, T_BEACON + STUCK_BEACON, SAG_TIME, JERK_TIME);

const TAU = Math.PI * 2;

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Smoothstep, for a heavy settle rather than a linear slide. */
function smooth(x: number): number {
  return x * x * (3 - 2 * x);
}

/**
 * The electrical stutter. Three detuned waves summed and then quantised to full / a guttering
 * fraction / off, so the light JUMPS between states instead of breathing.
 *
 * The low states are deliberately very low. A flicker that only dips to half reads as a grey
 * wash over the paint — the car looks badly lit rather than electrically stricken — and what
 * sells this is the contrast between a body flooded with light and a body with none.
 *
 * `phase` is the car's own, which keeps six wrecks in the same street out of lockstep.
 */
function stutter(age: number, phase: number): number {
  const n =
    0.45 * Math.sin((age * 61 + phase) * TAU) +
    0.33 * Math.sin((age * 37.3 + phase * 2.1) * TAU) +
    0.22 * Math.sin((age * 23.7 + phase * 3.7) * TAU);
  if (n > 0.05) return 1;
  if (n > -0.3) return 0.18;
  return 0;
}

/** Where the roof beacon sits on the chassis. */
export const BEACON_OFFSET: Readonly<{ x: number; y: number; z: number }> = { x: 0, y: 1.56, z: 0.1 };

/** The chassis of a car: the sag, lean and jerk it carries under its root. Euler order XYZ. */
export interface ElectricChassisPose {
  rx: number;
  ry: number;
  rz: number;
  y: number;
}

/**
 * The chassis pose of car `index`, `age` seconds after its hit, or at rest when `age` is null
 * (a car in service). Pure: `setStatus` and the instanced fleet both read it.
 */
export function electricChassisPose(index: number, age: number | null, out: ElectricChassisPose): ElectricChassisPose {
  if (age === null) {
    out.rx = 0;
    out.ry = 0;
    out.rz = 0;
    out.y = 0;
    return out;
  }
  // Vary the collapse direction so six targets never go down in lockstep.
  const tiltSign = index % 2 === 0 ? 1 : -1;
  const tiltAmount = 0.16 + (index % 3) * 0.04;
  const sag = smooth(clamp01(age / SAG_TIME));
  // One twitch of torque as the motor cuts, rung out inside a third of a second, and under it
  // the car settling onto its springs and leaning off the lane.
  const jerk = age < JERK_TIME ? Math.sin((age / JERK_TIME) * Math.PI * 1.5) * (1 - age / JERK_TIME) : 0;
  out.ry = tiltSign * JERK_YAW * jerk;
  out.rz = tiltSign * tiltAmount * sag - tiltSign * 0.06 * jerk;
  out.rx = 0.05 * sag + 0.03 * jerk;
  out.y = -0.12 * sag;
  return out;
}

/** The paint car `index` wears in service. Shared: copy it, never write to it. */
export function electricBodyPaint(index: number): THREE.Color {
  return BODY_COLORS[index % BODY_COLORS.length];
}

/** The paint with nothing lighting it: its own hue, half the value, a little colder. */
export function electricDeadPaint(index: number, out: THREE.Color): THREE.Color {
  return out.copy(electricBodyPaint(index)).multiplyScalar(0.5).lerp(DEAD_TINT, 0.2);
}

/** Where in the network blink car `index` is: its own phase, so a street never pulses as one. */
function blinkPhaseOf(index: number): number {
  return (index * 0.37) % 1;
}

/** Whether the roof beacon of car `index`, in service, is in its flash at `time`. */
export function electricBeaconFlash(index: number, time: number): boolean {
  return (time * 0.85 + blinkPhaseOf(index)) % 1 < 0.14;
}

/** The beacon in service: full and swollen in the flash, a faint ember between. */
export const BEACON_FLASH = { opacity: 1, scale: 1.25 } as const;
export const BEACON_DIM = { opacity: 0.16, scale: 1 } as const;

/** The body in service: glossy enough to carry the street's reflection (`fleetPaintMaterial`). */
export const ALIVE_BODY_ROUGHNESS = 0.26;
export const ALIVE_BODY_METALNESS = 0.4;
/** A wreck's body once it has settled (`setStatus` at full sag): rougher and flatter. */
export const DEAD_BODY_ROUGHNESS = ALIVE_BODY_ROUGHNESS + 1 * 0.45;
export const DEAD_BODY_METALNESS = ALIVE_BODY_METALNESS - 1 * 0.25;

/** The Rush ring's motion: slow and dim on purpose — present, not insistent. */
export function electricRushRingSpin(time: number): number {
  return time * 0.18;
}
export function electricRushRingOpacity(time: number): number {
  return 0.2 + 0.06 * Math.sin(time * 1.3);
}

/** The amber a Rayo Rush target wears on the ground. */
export const ELECTRIC_RUSH_RING: Readonly<THREE.Color> = RUSH_RING;

interface SharedResources {
  body: THREE.BufferGeometry;
  bars: THREE.BufferGeometry;
  beacon: THREE.BufferGeometry;
  ring: THREE.BufferGeometry;
  bodyMat: THREE.MeshStandardMaterial;
  barMat: THREE.MeshStandardMaterial;
  beaconMat: THREE.MeshBasicMaterial;
  ringMat: THREE.MeshBasicMaterial;
  /** The body's detail map. Owns the texture; the per-car materials only borrow it. */
  bodyArt: TextureHandle;
}

let shared: SharedResources | null = null;

function buildBody(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  // Soft, homogeneous crossover hull. The chamfer is deliberately small: it takes the hard
  // edge off the shoulder and rocker without touching the silhouette, which is what keeps the
  // car reading as a modern EV rather than a rounded-off old hatchback.
  parts.push(
    part(
      loft([
        { z: -2.2, bottomY: 0.34, topY: 0.72, bottomHalfWidth: 0.62, topHalfWidth: 0.7 },
        { z: -1.95, bottomY: 0.2, topY: 0.8, bottomHalfWidth: 0.78, topHalfWidth: 0.84 },
        { z: -1.35, bottomY: 0.18, topY: 0.88, bottomHalfWidth: 0.86, topHalfWidth: 0.9 },
        { z: -0.6, bottomY: 0.18, topY: 0.94, bottomHalfWidth: 0.9, topHalfWidth: 0.92 },
        { z: 0.6, bottomY: 0.18, topY: 0.96, bottomHalfWidth: 0.9, topHalfWidth: 0.92 },
        { z: 1.35, bottomY: 0.18, topY: 0.94, bottomHalfWidth: 0.88, topHalfWidth: 0.9 },
        { z: 1.95, bottomY: 0.22, topY: 0.88, bottomHalfWidth: 0.82, topHalfWidth: 0.86 },
        { z: 2.2, bottomY: 0.36, topY: 0.76, bottomHalfWidth: 0.7, topHalfWidth: 0.74 },
      ], { chamfer: 0.1 }),
      SHELL,
    ),
  );

  // Tapered one-box greenhouse, dark glass all round.
  parts.push(
    part(
      loft([
        { z: -1.1, bottomY: 0.9, topY: 0.96, bottomHalfWidth: 0.8, topHalfWidth: 0.8 },
        { z: -0.4, bottomY: 0.92, topY: 1.44, bottomHalfWidth: 0.8, topHalfWidth: 0.7 },
        { z: 0.95, bottomY: 0.92, topY: 1.46, bottomHalfWidth: 0.8, topHalfWidth: 0.7 },
        { z: 1.75, bottomY: 0.92, topY: 1.0, bottomHalfWidth: 0.8, topHalfWidth: 0.74 },
      ], { chamfer: 0.07 }),
      GLASS,
    ),
  );

  // Bumper trims.
  const frontTrim = box(1.66, 0.1, 0.06);
  frontTrim.translate(0, 0.3, -2.22);
  parts.push(part(frontTrim, TRIM));
  const rearTrim = box(1.62, 0.1, 0.06);
  rearTrim.translate(0, 0.32, 2.22);
  parts.push(part(rearTrim, TRIM));

  // Mirrors.
  for (const sign of [-1, 1]) {
    const mirror = box(0.14, 0.07, 0.1);
    mirror.translate(sign * 0.95, 1.0, -0.7);
    parts.push(part(mirror, TRIM));
  }

  // Roof sensor pod and shark fin.
  const pod = box(0.34, 0.08, 0.5);
  pod.translate(0, 1.49, 0.1);
  parts.push(part(pod, POD));
  const fin = box(0.05, 0.12, 0.22);
  fin.translate(0, 1.12, 1.3);
  parts.push(part(fin, POD));

  // Wheels: static, merged into the body (nothing spins them).
  for (const z of [-1.35, 1.35]) {
    for (const sign of [-1, 1]) {
      const wheel = new THREE.CylinderGeometry(0.34, 0.34, 0.2, 16);
      wheel.rotateZ(Math.PI / 2);
      wheel.translate(sign * 0.86, 0.34, z);
      parts.push(part(wheel, TYRE));
    }
  }

  const merged = mergeParts(parts);
  applyLengthwiseUVs(merged);
  merged.computeBoundingSphere();
  return merged;
}

function buildBars(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const front = box(1.5, 0.07, 0.05);
  front.translate(0, 0.62, -2.24);
  parts.push(part(front, 0xffffff));
  const rear = box(1.46, 0.08, 0.05);
  rear.translate(0, 0.66, 2.24);
  parts.push(part(rear, 0xffffff));
  return mergeParts(parts);
}

function buildRing(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const outer = new THREE.RingGeometry(1.62, 1.86, 32, 1);
  outer.rotateX(-Math.PI / 2);
  parts.push(part(outer, 0xffffff));
  const inner = new THREE.RingGeometry(1.16, 1.2, 24, 1);
  inner.rotateX(-Math.PI / 2);
  parts.push(part(inner, 0xffffff));
  for (let i = 0; i < 4; i++) {
    const tick = box(0.07, 0.01, 0.32);
    tick.translate(0, 0, 1.42);
    tick.rotateY((i / 4) * Math.PI * 2);
    parts.push(part(tick, 0xffffff));
  }
  return mergeParts(parts);
}

function getShared(): SharedResources {
  if (!shared) {
    const res = {
      body: buildBody(),
      bars: buildBars(),
      beacon: new THREE.SphereGeometry(0.075, 8, 4),
      ring: buildRing(),
      bodyMat: fleetPaintMaterial({
        color: BODY_COLORS[0].getHex(),
        vertexColors: true,
        roughness: ALIVE_BODY_ROUGHNESS,
        metalness: ALIVE_BODY_METALNESS,
      }),
      barMat: new THREE.MeshStandardMaterial({
        color: 0x081014,
        emissive: CLEAN_BAR.getHex(),
        emissiveIntensity: 2.2,
        vertexColors: true,
        roughness: 0.3,
      }),
      beaconMat: new THREE.MeshBasicMaterial({
        color: 0x8ff6ff,
        transparent: true,
        opacity: 1,
        toneMapped: false,
      }),
      ringMat: new THREE.MeshBasicMaterial({
        color: 0x00e5ff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
        forceSinglePass: true,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    };
    // The shared material is the template every car clones, so it carries the map for cars
    // built after the art lands; the ones built before it get it in `createElectricCarVisual`.
    shared = { ...res, bodyArt: attachTexture(res.bodyMat, 'vehicles/electric', null) };
  }
  return shared;
}

/**
 * The electric car's hull and light bars, for a visual that wears the same body in other
 * colours (the police, `policeCarVisual.ts`). Shared: the caller must not dispose them.
 */
export function electricCarGeometry(): { body: THREE.BufferGeometry; bars: THREE.BufferGeometry } {
  const s = getShared();
  return { body: s.body, bars: s.bars };
}

/**
 * Everything the instanced fleet (`electricFleet.ts`) is built from: the shared geometries and
 * the template materials every per-car visual clones. Shared: the caller clones the materials
 * and must not dispose any of it.
 */
export function electricFleetKit(): Readonly<SharedResources> {
  return getShared();
}

export function disposeElectricCarResources(): void {
  if (!shared) return;
  shared.body.dispose();
  shared.bars.dispose();
  shared.beacon.dispose();
  shared.ring.dispose();
  shared.bodyMat.dispose();
  shared.barMat.dispose();
  shared.beaconMat.dispose();
  shared.ringMat.dispose();
  shared.bodyArt.dispose();
  shared = null;
}

export function createElectricCarVisual(index: number): ElectricCarVisual {
  const s = getShared();
  const root = new THREE.Group();
  root.name = `electric-car-${index}`;

  // Everything that reacts to the hit lives under `chassis` so it can sag as one piece.
  const chassis = new THREE.Group();
  root.add(chassis);

  const cleanBody = BODY_COLORS[index % BODY_COLORS.length];
  const bodyMat = s.bodyMat.clone();
  bodyMat.color.copy(cleanBody);
  // `clone()` copies whatever map the template has right now, which is nothing until the file
  // lands. Cars built before then pick it up here.
  let disposed = false;
  if (!bodyMat.map) {
    void s.bodyArt.ready.then(() => {
      if (disposed) return;
      bodyMat.map = s.bodyArt.texture;
      bodyMat.needsUpdate = true;
    });
  }
  const barMat = s.barMat.clone();
  const beaconMat = s.beaconMat.clone();
  const ringMat = s.ringMat.clone();

  const body = new THREE.Mesh(s.body, bodyMat);
  chassis.add(body);
  const bars = new THREE.Mesh(s.bars, barMat);
  chassis.add(bars);
  const beacon = new THREE.Mesh(s.beacon, beaconMat);
  beacon.position.set(BEACON_OFFSET.x, BEACON_OFFSET.y, BEACON_OFFSET.z);
  beacon.renderOrder = 2;
  chassis.add(beacon);

  const ring = new THREE.Mesh(s.ring, ringMat);
  ring.position.y = 0.04;
  ring.renderOrder = 1;
  ring.visible = false;
  root.add(ring);

  // Vary the collapse direction (`electricChassisPose`) and the blink phase so six targets never
  // move in lockstep.
  const blinkPhase = blinkPhaseOf(index);
  const pose: ElectricChassisPose = { rx: 0, ry: 0, rz: 0, y: 0 };

  /**
   * How this car's power-down goes wrong, by index rather than at random: the mix on a street
   * is the same every run, and the player learns the fleet rather than waiting on a dice roll.
   *
   *   0  clean: every system out on the beat.
   *   1  the beacon's contact does not let go, and it stutters on for another beat.
   *   2  the hazards come up after everything else is dead: two slow amber blinks.
   *   3  a short circuit — the stutter is over early and the car is dark sooner.
   */
  const variant = index % 4;
  const flickerEnd = variant === 3 ? 0.42 : T_FLICKER;
  const beaconEnd = variant === 1 ? T_BEACON + STUCK_BEACON : T_BEACON;

  const deadBody = electricDeadPaint(index, new THREE.Color());

  let alive = true;
  let rushTarget = false;

  return {
    root,
    setStatus(status, timeSinceHit) {
      const nowAlive = status === 'active';
      if (nowAlive) {
        if (!alive) {
          bodyMat.color.copy(cleanBody);
          bodyMat.emissive.setRGB(0, 0, 0);
          bodyMat.emissiveIntensity = 1;
          bodyMat.roughness = ALIVE_BODY_ROUGHNESS;
          bodyMat.metalness = ALIVE_BODY_METALNESS;
          barMat.emissive.copy(CLEAN_BAR);
          barMat.emissiveIntensity = 2.2;
          beaconMat.opacity = 1;
          beacon.scale.setScalar(1);
          alive = true;
        }
        chassis.rotation.set(0, 0, 0);
        chassis.position.y = 0;
        return;
      }
      alive = false;
      // A car that was already a wreck when this client first heard about it (no `hitTime`:
      // the host reporting traffic that died before we arrived) has no cascade to play. It
      // starts at the end of one.
      const age = timeSinceHit > 0 ? timeSinceHit : SETTLED;

      // THE PAINT keeps its own colour and only loses the light in it. A wreck is a car with
      // the power off, not a shape burnt into the street — which is also what lets the player
      // still read, at a glance, which of the three liveries they just took out.
      const sag = smooth(clamp01(age / SAG_TIME));
      bodyMat.color.lerpColors(cleanBody, deadBody, sag);
      bodyMat.roughness = ALIVE_BODY_ROUGHNESS + sag * (DEAD_BODY_ROUGHNESS - ALIVE_BODY_ROUGHNESS);
      bodyMat.metalness = ALIVE_BODY_METALNESS + sag * (DEAD_BODY_METALNESS - ALIVE_BODY_METALNESS);

      // 1. THE SURGE. Nothing lights the body from inside while the car is in service, so any
      // glow here is unmistakably the bolt going through it: it floods, stutters, and drains.
      let glow: number;
      if (age < T_SURGE) glow = 1.4 * (age / T_SURGE);
      else if (age < flickerEnd) glow = 0.1 + 1.3 * stutter(age, blinkPhase);
      else if (age < T_CABIN) glow = 0.55 * (1 - clamp01((age - flickerEnd) / (T_CABIN - flickerEnd)));
      else glow = 0;
      bodyMat.emissive.copy(SURGE);
      bodyMat.emissiveIntensity = glow;

      // 2. THE LIGHT BARS ride the same surge well past the brightness they are allowed in
      // service, stutter with it, and are cut after the cabin has gone dark.
      let hazard = 0;
      if (variant === 2 && age > T_BEACON && age < T_BEACON + HAZARD_TIME) {
        const since = age - T_BEACON;
        hazard = since % 0.7 < 0.28 ? 1 - since / HAZARD_TIME : 0;
      }
      let barLevel: number;
      if (age < T_SURGE) barLevel = 1 + 1.6 * (age / T_SURGE);
      else if (age < flickerEnd) barLevel = 0.05 + 2.4 * stutter(age, blinkPhase + 0.31);
      else if (age < T_BARS) barLevel = 0.8 * (1 - clamp01((age - flickerEnd) / (T_BARS - flickerEnd)));
      else barLevel = 0;
      if (hazard > 0) {
        barMat.emissive.copy(HAZARD);
        barMat.emissiveIntensity = 2.6 * hazard;
      } else if (age < flickerEnd) {
        barMat.emissive.lerpColors(CLEAN_BAR, SURGE, clamp01(age / T_SURGE));
        barMat.emissiveIntensity = 2.2 * barLevel;
      } else {
        barMat.emissive.lerpColors(SURGE, DEAD_BAR, clamp01((age - flickerEnd) / (T_BARS - flickerEnd)));
        barMat.emissiveIntensity = 2.2 * barLevel;
      }

      // 3. THE BEACON is last out, and on one car in four its contact never quite lets go.
      if (age < beaconEnd) {
        beacon.visible = true;
        const s = stutter(age, blinkPhase + 0.63);
        const fade = 1 - clamp01(age / beaconEnd);
        beaconMat.opacity = age < T_SURGE ? 1 : s * (0.35 + 0.65 * fade);
        beacon.scale.setScalar(age < T_SURGE ? 1 + 0.6 * (age / T_SURGE) : 1 + 0.3 * s);
      } else {
        beacon.visible = false;
      }

      // 4. THE JERK as the motor cuts, and the car settling onto its springs.
      electricChassisPose(index, age, pose);
      chassis.rotation.set(pose.rx, pose.ry, pose.rz);
      chassis.position.y = pose.y;
    },
    setRushTarget(value) {
      if (value === rushTarget) return;
      rushTarget = value;
      ring.visible = value;
      if (value) ringMat.color.copy(RUSH_RING);
      else ringMat.opacity = 0;
    },
    update(_frameDt, time) {
      if (alive) {
        const look = electricBeaconFlash(index, time) ? BEACON_FLASH : BEACON_DIM;
        beacon.visible = true;
        beaconMat.opacity = look.opacity;
        beacon.scale.setScalar(look.scale);
      }
      if (rushTarget) {
        ring.rotation.y = electricRushRingSpin(time);
        ringMat.opacity = electricRushRingOpacity(time);
      }
    },
    dispose() {
      disposed = true;
      bodyMat.dispose();
      barMat.dispose();
      beaconMat.dispose();
      ringMat.dispose();
    },
  };
}
