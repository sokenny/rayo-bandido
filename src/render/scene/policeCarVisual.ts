import * as THREE from 'three';
import { box, mergeParts, part } from './vehicles/geometryKit';
import { electricCarGeometry } from './electricCarVisual';

/**
 * A police car (`src/sim/police.ts`). PLACEHOLDER BODY: the electric car's own hull, worn in a
 * dark cyberpunk navy with white door panels and a bonnet band, a roof light bar with a red and
 * a blue lens, white headlights, red tail lights, and — only while chasing — a strobing bar
 * with a coloured pool of light on the road under the car, the cheapest reflection there is.
 *
 * MODULAR ON PURPOSE. Everything police-specific is built here: swap `buildMarkings` and the
 * body material for a dedicated model later and nothing outside this file changes.
 *
 * CONTRACT
 * - `root` origin on the ground, nose toward local -Z. `syncPolice` (`src/render/sync.ts`)
 *   sets position/rotation and calls `setActive` / `setLights` every frame.
 * - `setAimed(true)` while the Rayo is lined up on this car: the hex shield ring shows, dim.
 * - `flashShield()` when a bolt met the car: the ring flares and fades.
 * - Geometries and the static materials are shared; dispose them once via
 *   `disposePoliceCarResources()`.
 *
 * Draw calls: 3 for a patrol (body, markings, lights), 6 while chasing (+ two lenses and the
 * ground pool), +1 while the shield ring is visible. Hidden cars cost nothing.
 */
export interface PoliceCarVisual {
  root: THREE.Group;
  setActive(active: boolean): void;
  setLights(on: boolean): void;
  setAimed(aimed: boolean): void;
  flashShield(): void;
  update(frameDt: number, time: number): void;
  dispose(): void;
}

const NAVY = 0x121a33;
const PANEL = 0xe6ecf5;
const BAR_BASE = 0x0a0d16;
const RED = new THREE.Color(0xff2b3d);
const BLUE = new THREE.Color(0x3d7bff);
const RED_DIM = new THREE.Color(0x3a0810);
const BLUE_DIM = new THREE.Color(0x0a1638);
const SHIELD = 0x4ff3ff;
/** Strobe rate (Hz) of the red/blue alternation while chasing. */
const STROBE_HZ = 3;
/** How long the shield flare lasts (s). */
const FLASH_TIME = 0.45;

interface SharedResources {
  markings: THREE.BufferGeometry;
  lights: THREE.BufferGeometry;
  lensRed: THREE.BufferGeometry;
  lensBlue: THREE.BufferGeometry;
  pool: THREE.BufferGeometry;
  shield: THREE.BufferGeometry;
  bodyMat: THREE.MeshStandardMaterial;
  markingsMat: THREE.MeshStandardMaterial;
  lightsMat: THREE.MeshBasicMaterial;
}

let shared: SharedResources | null = null;

function buildMarkings(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  // Door panels, both sides: the classic two-tone read, in one plane each.
  for (const sign of [-1, 1]) {
    const panel = box(0.03, 0.34, 1.5);
    panel.translate(sign * 0.905, 0.6, 0.15);
    parts.push(part(panel, PANEL));
  }
  // Bonnet band.
  const bonnet = box(1.2, 0.02, 0.55);
  bonnet.translate(0, 0.955, -1.45);
  parts.push(part(bonnet, PANEL));
  // Light bar base, low on the roof.
  const bar = box(1.16, 0.09, 0.3);
  bar.translate(0, 1.5, 0.05);
  parts.push(part(bar, BAR_BASE));
  return mergeParts(parts);
}

/** Headlights white, tail lights red: one unlit geometry, vertex-coloured. */
function buildLights(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const front = box(1.5, 0.07, 0.05);
  front.translate(0, 0.62, -2.24);
  parts.push(part(front, 0xeaf6ff));
  const rear = box(1.46, 0.08, 0.05);
  rear.translate(0, 0.66, 2.24);
  parts.push(part(rear, 0xff1e2e));
  return mergeParts(parts);
}

function buildLens(sign: number): THREE.BufferGeometry {
  const lens = box(0.5, 0.1, 0.26);
  lens.translate(sign * 0.3, 1.58, 0.05);
  return lens;
}

function getShared(): SharedResources {
  if (!shared) {
    const pool = new THREE.CircleGeometry(3.4, 20);
    pool.rotateX(-Math.PI / 2);
    const shield = new THREE.RingGeometry(1.75, 2.0, 6, 1);
    shield.rotateX(-Math.PI / 2);
    shared = {
      markings: buildMarkings(),
      lights: buildLights(),
      lensRed: buildLens(-1),
      lensBlue: buildLens(1),
      pool,
      shield,
      bodyMat: new THREE.MeshStandardMaterial({ color: NAVY, vertexColors: true, roughness: 0.42, metalness: 0.38 }),
      markingsMat: new THREE.MeshStandardMaterial({
        color: 0xffffff,
        vertexColors: true,
        emissive: 0x1a2238,
        emissiveIntensity: 0.35,
        roughness: 0.5,
      }),
      lightsMat: new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, toneMapped: false }),
    };
  }
  return shared;
}

export function disposePoliceCarResources(): void {
  if (!shared) return;
  shared.markings.dispose();
  shared.lights.dispose();
  shared.lensRed.dispose();
  shared.lensBlue.dispose();
  shared.pool.dispose();
  shared.shield.dispose();
  shared.bodyMat.dispose();
  shared.markingsMat.dispose();
  shared.lightsMat.dispose();
  shared = null;
}

export function createPoliceCarVisual(index: number): PoliceCarVisual {
  const s = getShared();
  const geo = electricCarGeometry();
  const root = new THREE.Group();
  root.name = `police-car-${index}`;
  root.visible = false;

  const body = new THREE.Mesh(geo.body, s.bodyMat);
  root.add(body);
  const markings = new THREE.Mesh(s.markings, s.markingsMat);
  root.add(markings);
  const lights = new THREE.Mesh(s.lights, s.lightsMat);
  root.add(lights);

  // Per-car materials: the two lenses and the pool change colour every frame while chasing,
  // and the shield ring fades on its own clock.
  const redMat = new THREE.MeshBasicMaterial({ color: RED_DIM.getHex(), toneMapped: false });
  const blueMat = new THREE.MeshBasicMaterial({ color: BLUE_DIM.getHex(), toneMapped: false });
  const lensRed = new THREE.Mesh(s.lensRed, redMat);
  const lensBlue = new THREE.Mesh(s.lensBlue, blueMat);
  root.add(lensRed);
  root.add(lensBlue);

  const poolMat = new THREE.MeshBasicMaterial({
    color: RED.getHex(),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const pool = new THREE.Mesh(s.pool, poolMat);
  pool.position.y = 0.05;
  pool.renderOrder = 1;
  pool.visible = false;
  root.add(pool);

  const shieldMat = new THREE.MeshBasicMaterial({
    color: SHIELD,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const shield = new THREE.Mesh(s.shield, shieldMat);
  shield.position.y = 0.06;
  shield.renderOrder = 1;
  shield.visible = false;
  root.add(shield);

  let active = false;
  let lightsOn = false;
  let aimed = false;
  let flash = 0;
  // Spread the strobes so a pack of chasers does not blink as one.
  const strobePhase = (index * 0.29) % 1;

  function setLensesIdle(): void {
    redMat.color.copy(RED_DIM);
    blueMat.color.copy(BLUE_DIM);
    pool.visible = false;
    poolMat.opacity = 0;
  }

  return {
    root,
    setActive(value) {
      if (value === active) return;
      active = value;
      root.visible = value;
      if (!value) {
        lightsOn = false;
        aimed = false;
        flash = 0;
        shield.visible = false;
        setLensesIdle();
      }
    },
    setLights(on) {
      if (on === lightsOn) return;
      lightsOn = on;
      if (!on) setLensesIdle();
      else pool.visible = true;
    },
    setAimed(value) {
      aimed = value;
    },
    flashShield() {
      flash = FLASH_TIME;
    },
    update(frameDt, time) {
      if (!active) return;
      if (lightsOn) {
        // Red, then blue, each with a double flick: the strobe rather than a slow alternation.
        const cycle = (time * STROBE_HZ + strobePhase) % 1;
        const red = cycle < 0.5;
        const flick = (cycle * 2) % 1;
        const lit = flick < 0.3 || (flick > 0.4 && flick < 0.7);
        redMat.color.copy(red && lit ? RED : RED_DIM);
        blueMat.color.copy(!red && lit ? BLUE : BLUE_DIM);
        poolMat.color.copy(red ? RED : BLUE);
        poolMat.opacity = lit ? 0.26 : 0.06;
      }
      if (flash > 0) flash = Math.max(0, flash - frameDt);
      const show = aimed || flash > 0;
      shield.visible = show;
      if (show) {
        const flare = flash / FLASH_TIME;
        shieldMat.opacity = Math.min(1, (aimed ? 0.28 + 0.08 * Math.sin(time * 9) : 0) + flare * 0.9);
        shield.rotation.y = time * 0.9;
        const scale = 1 + flare * 0.35;
        shield.scale.set(scale, 1, scale);
      }
    },
    dispose() {
      redMat.dispose();
      blueMat.dispose();
      poolMat.dispose();
      shieldMat.dispose();
    },
  };
}
