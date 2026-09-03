import * as THREE from 'three';
import type { TargetStatus } from '../../core/types';
import { box, loft, mergeParts, part } from './vehicles/geometryKit';

/**
 * Electric-car target visual. Clean, homogeneous, corporate: white/cool-cyan, soft shapes,
 * a blinking network light. Contrast with the player's analog outlaw coupe.
 *
 * CONTRACT
 * - `root` origin on the ground, nose toward local -Z. Sync sets position/rotation.
 * - `setStatus` is called every frame with the sim status and seconds since the hit
 *   (0 when never hit). 'destroyed' should read clearly: dark, sparking, tilted or sunk.
 * - `setAcquired(true)` is called when this target is the current auto-aim pick.
 * - Share geometries/materials across instances; dispose shared resources once via
 *   `disposeElectricCarResources()`.
 *
 * Four draw calls per target: body, light bars, roof beacon, acquisition ring.
 */
export interface ElectricCarVisual {
  root: THREE.Group;
  setStatus(status: TargetStatus, timeSinceHit: number): void;
  setAcquired(acquired: boolean): void;
  update(frameDt: number, time: number): void;
  dispose(): void;
}

const SHELL = 0xffffff;
const GLASS = 0x3b4557;
const TRIM = 0xb9c2ce;
const TYRE = 0x1a1c22;
const POD = 0xdfe6ef;

const CLEAN_BODY = new THREE.Color(0xe8f0ff);
const CHARRED_BODY = new THREE.Color(0x1d1b1a);
const CLEAN_BAR = new THREE.Color(0x00e5ff);
const DEAD_BAR = new THREE.Color(0x0c0f12);

/** Fall-over animation length after a hit, in seconds. */
const SAG_TIME = 0.5;

interface SharedResources {
  body: THREE.BufferGeometry;
  bars: THREE.BufferGeometry;
  beacon: THREE.BufferGeometry;
  ring: THREE.BufferGeometry;
  bodyMat: THREE.MeshStandardMaterial;
  barMat: THREE.MeshStandardMaterial;
  beaconMat: THREE.MeshBasicMaterial;
  ringMat: THREE.MeshBasicMaterial;
}

let shared: SharedResources | null = null;

function buildBody(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  // Soft, homogeneous crossover hull.
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
      ]),
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
      ]),
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
      const wheel = new THREE.CylinderGeometry(0.34, 0.34, 0.2, 12);
      wheel.rotateZ(Math.PI / 2);
      wheel.translate(sign * 0.86, 0.34, z);
      parts.push(part(wheel, TYRE));
    }
  }

  const merged = mergeParts(parts);
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
    shared = {
      body: buildBody(),
      bars: buildBars(),
      beacon: new THREE.SphereGeometry(0.075, 8, 4),
      ring: buildRing(),
      bodyMat: new THREE.MeshStandardMaterial({
        color: CLEAN_BODY.getHex(),
        vertexColors: true,
        roughness: 0.35,
        metalness: 0.2,
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
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    };
  }
  return shared;
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
  shared = null;
}

export function createElectricCarVisual(index: number): ElectricCarVisual {
  const s = getShared();
  const root = new THREE.Group();
  root.name = `electric-car-${index}`;

  // Everything that reacts to the hit lives under `chassis` so it can sag as one piece.
  const chassis = new THREE.Group();
  root.add(chassis);

  const bodyMat = s.bodyMat.clone();
  const barMat = s.barMat.clone();
  const beaconMat = s.beaconMat.clone();
  const ringMat = s.ringMat.clone();

  const body = new THREE.Mesh(s.body, bodyMat);
  chassis.add(body);
  const bars = new THREE.Mesh(s.bars, barMat);
  chassis.add(bars);
  const beacon = new THREE.Mesh(s.beacon, beaconMat);
  beacon.position.set(0, 1.56, 0.1);
  beacon.renderOrder = 2;
  chassis.add(beacon);

  const ring = new THREE.Mesh(s.ring, ringMat);
  ring.position.y = 0.04;
  ring.renderOrder = 1;
  ring.visible = false;
  root.add(ring);

  // Vary the collapse direction and the blink phase so six targets never move in lockstep.
  const tiltSign = index % 2 === 0 ? 1 : -1;
  const tiltAmount = 0.16 + (index % 3) * 0.04;
  const blinkPhase = (index * 0.37) % 1;

  let alive = true;
  let acquired = false;

  return {
    root,
    setStatus(status, timeSinceHit) {
      const nowAlive = status === 'active';
      if (nowAlive) {
        if (!alive) {
          bodyMat.color.copy(CLEAN_BODY);
          bodyMat.roughness = 0.35;
          bodyMat.metalness = 0.2;
          barMat.emissive.copy(CLEAN_BAR);
          barMat.emissiveIntensity = 2.2;
          alive = true;
        }
        chassis.rotation.set(0, 0, 0);
        chassis.position.y = 0;
        return;
      }
      alive = false;
      const raw = timeSinceHit <= 0 ? 1 : Math.min(1, timeSinceHit / SAG_TIME);
      // Smoothstep for a heavy settle rather than a linear slide.
      const t = raw * raw * (3 - 2 * raw);
      bodyMat.color.lerpColors(CLEAN_BODY, CHARRED_BODY, t);
      bodyMat.roughness = 0.35 + t * 0.6;
      bodyMat.metalness = 0.2 - t * 0.15;
      barMat.emissive.lerpColors(CLEAN_BAR, DEAD_BAR, t);
      barMat.emissiveIntensity = 2.2 * (1 - t);
      chassis.rotation.z = tiltSign * tiltAmount * t;
      chassis.rotation.x = 0.05 * t;
      chassis.position.y = -0.12 * t;
      beacon.visible = false;
    },
    setAcquired(value) {
      acquired = value;
      ring.visible = value;
      if (!value) ringMat.opacity = 0;
    },
    update(_frameDt, time) {
      if (alive) {
        const phase = (time * 0.85 + blinkPhase) % 1;
        const flash = phase < 0.14;
        beacon.visible = true;
        beaconMat.opacity = flash ? 1 : 0.16;
        const scale = flash ? 1.25 : 1;
        beacon.scale.set(scale, scale, scale);
      }
      if (acquired) {
        ring.rotation.y = time * 0.9;
        ringMat.opacity = 0.55 + 0.35 * Math.sin(time * 6.5);
      }
    },
    dispose() {
      bodyMat.dispose();
      barMat.dispose();
      beaconMat.dispose();
      ringMat.dispose();
    },
  };
}
