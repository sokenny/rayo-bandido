import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { RoundaboutSpec } from '../../world/metroSouth';
import { buildBoltPoints, polylineToSegments } from '../fx/shapes';
import { createFxTextures } from '../fx/sprites';

/**
 * LA FLOR (Plaza Estrella, `world/metroSouth.ts`): the giant steel flower after the Floralis
 * Genérica, and the one piece of scenery the lightning gun talks to (Juan, 2026-09-17).
 *
 * It stands half closed. Put a bolt into it and it takes the charge: arcs crackle from its heart
 * out over the petals, the heart flares and stays lit — a core of cyan-white light breathing in
 * the middle, a halo round it and a column of light going up — and the petals slowly finish
 * opening, over several seconds, to where the real one opens at noon. A second bolt into an open
 * flower crackles and flares again; it has nowhere further to open.
 *
 * Presentation only, and local: the sim throws the bolt as it always did, `src/game.ts` asks
 * `hits` whether a missed bolt crossed the flower, draws the arc to its heart and calls `strike`.
 * Nothing here is a light source (a new light re-resolves every lit program in the metro): the
 * glow is additive sprites and the petals' own emissive tint.
 *
 * The pool and the floodlights under it are static scenery (`env/roundaboutBuilder.ts`).
 */

export interface FloralisVisual {
  root: THREE.Group;
  /** The heart, where a bolt that crossed the flower lands. */
  heart: { x: number; y: number; z: number };
  /** Whether a bolt along the ground segment (from → to) passes through the flower. */
  hits(fromX: number, fromZ: number, toX: number, toZ: number): boolean;
  /** A bolt went in: takes effect on the next `update`. */
  strike(): void;
  /** 0 closed as it stands, 1 fully open. For QA. */
  openness(): number;
  update(time: number, camX?: number, camZ?: number): void;
  dispose(): void;
}

/** The petals: azimuth, lean from upright when FULLY open (rad), length and width (m). */
const PETALS: ReadonlyArray<{ az: number; open: number; len: number; width: number }> = [
  { az: 0.1, open: 0.95, len: 34, width: 17 },
  { az: 1.12, open: 1.2, len: 31, width: 16 },
  { az: 2.18, open: 0.72, len: 35, width: 18 },
  { az: 3.2, open: 1.3, len: 30, width: 15 },
  { az: 4.22, open: 1.02, len: 33, width: 17 },
  { az: 5.25, open: 1.12, len: 32, width: 16 },
];
/** How much less open each petal stands before it is struck (rad): the room the animation opens through. */
const CLOSED_BY = 0.5;
/** How far each petal curls back toward upright over its length (rad), how deep its scoop is (m), where it is widest. */
const CURL = 0.75;
const SCOOP = 6;
const WIDEST = 0.58;
const NU = 18;
const NV = 10;
/** Hub height over the lawn (m). */
const HUB = 9;

export const FLORALIS = {
  /** A bolt within this of the flower's axis is caught by it (m): about the petals' reach. */
  hitRadius: 24,
  /** Seconds from the strike before the petals start to move, and how long they take to open. */
  openDelay: 0.5,
  openSeconds: 8,
  /** Seconds the arcs crackle after a strike. */
  crackle: 1.8,
  /** Seconds for the heart to come up to its steady glow. */
  heartRise: 1.4,
  /** Beyond this from the camera the flower is not drawn (m): the haze has it. */
  drawDistance: 1100,
} as const;

const ARCS = 7;
const ARC_SEGMENTS = 12;

export function createFloralisVisual(r: RoundaboutSpec, groundY: number): FloralisVisual {
  const root = new THREE.Group();
  root.name = 'floralis';
  const hubY = groundY + HUB;
  root.position.set(r.x, hubY, r.z);

  const chrome = new THREE.MeshStandardMaterial({
    color: 0xdfe3e8,
    metalness: 1,
    roughness: 0.12,
    envMapIntensity: 1.8,
    side: THREE.DoubleSide,
    emissive: 0x000000,
  });

  /* ------------------------------------------------------------ the petals */

  const hinges: THREE.Group[] = [];
  const petalGeos: THREE.BufferGeometry[] = [];
  for (const p of PETALS) {
    const pivot = new THREE.Group();
    // Local +X is the petal's radial direction: rotate it round to its azimuth (x east, z south).
    pivot.rotation.y = -p.az;
    const hinge = new THREE.Group();
    pivot.add(hinge);
    const geo = petalGeometry(p.open - CLOSED_BY, p.len, p.width);
    petalGeos.push(geo);
    const mesh = new THREE.Mesh(geo, chrome);
    mesh.name = 'floralis-petal';
    hinge.add(mesh);
    root.add(pivot);
    hinges.push(hinge);
  }

  /* ------------------------------------------------------------ stem, hub, stamens */

  const parts: THREE.BufferGeometry[] = [];
  const stem = new THREE.CylinderGeometry(1.4, 2.4, HUB, 16);
  stem.translate(0, -HUB / 2, 0);
  parts.push(stem);
  const hub = new THREE.SphereGeometry(3, 20, 12);
  hub.scale(1, 0.6, 1);
  parts.push(hub);
  const bulbs: THREE.Vector3[] = [];
  const stamens: Array<[number, number, number]> = [[0.4, 0.14, 24], [2.1, 0.22, 21], [3.9, 0.1, 26], [5.2, 0.2, 22]];
  for (const [az, lean, len] of stamens) {
    const tip = new THREE.Vector3(Math.cos(az) * Math.sin(lean) * len, Math.cos(lean) * len, Math.sin(az) * Math.sin(lean) * len);
    const rod = new THREE.CylinderGeometry(0.3, 0.45, len, 8);
    rod.translate(0, len / 2, 0);
    rod.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), tip.clone().normalize()));
    parts.push(rod);
    const bulb = new THREE.SphereGeometry(1.1, 14, 10);
    bulb.scale(1, 1.6, 1);
    bulb.translate(tip.x, tip.y + 0.8, tip.z);
    parts.push(bulb);
    bulbs.push(new THREE.Vector3(tip.x, tip.y + 0.8, tip.z));
  }
  const partsGeo = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)));
  for (const g of parts) g.dispose();
  const partsMesh = new THREE.Mesh(partsGeo, chrome);
  partsMesh.name = 'floralis-stem';
  root.add(partsMesh);

  /* ------------------------------------------------------------ the heart's light */

  const textures = createFxTextures();
  const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false } as const;
  const coreMat = new THREE.MeshBasicMaterial({ color: 0xd9fbff, opacity: 0, ...additive });
  const core = new THREE.Mesh(new THREE.SphereGeometry(2.4, 18, 12), coreMat);
  core.position.y = 1.2;
  core.visible = false;
  root.add(core);
  const haloMat = new THREE.SpriteMaterial({ map: textures.flare, color: 0x7fe8ff, opacity: 0, ...additive });
  const halo = new THREE.Sprite(haloMat);
  halo.position.y = 2;
  halo.visible = false;
  root.add(halo);
  const bulbMat = new THREE.SpriteMaterial({ map: textures.flare, color: 0xbff6ff, opacity: 0, ...additive });
  const bulbSprites = bulbs.map((p) => {
    const s = new THREE.Sprite(bulbMat);
    s.position.copy(p);
    s.scale.setScalar(7);
    s.visible = false;
    root.add(s);
    return s;
  });
  // The column of light going up out of the flower: open-ended, fading toward its top.
  const beamGeo = new THREE.CylinderGeometry(0.8, 3.2, 90, 20, 8, true);
  beamGeo.translate(0, 45, 0);
  const beamColors = new Float32Array(beamGeo.attributes.position.count * 3);
  for (let i = 0; i < beamGeo.attributes.position.count; i++) {
    const t = beamGeo.attributes.position.getY(i) / 90;
    const k = Math.pow(1 - t, 2);
    beamColors[i * 3] = 0.5 * k;
    beamColors[i * 3 + 1] = 0.9 * k;
    beamColors[i * 3 + 2] = 1 * k;
  }
  beamGeo.setAttribute('color', new THREE.BufferAttribute(beamColors, 3));
  const beamMat = new THREE.MeshBasicMaterial({ vertexColors: true, opacity: 0, side: THREE.DoubleSide, ...additive });
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.visible = false;
  root.add(beam);

  /* ------------------------------------------------------------ the arcs */

  const arcPoints = new Float32Array((ARC_SEGMENTS + 1) * 3);
  const arcLinePositions = new Float32Array(ARCS * ARC_SEGMENTS * 2 * 3);
  const arcGlowPositions = new Float32Array(ARCS * (ARC_SEGMENTS + 1) * 3);
  const lineGeo = new THREE.BufferGeometry();
  const lineAttr = new THREE.BufferAttribute(arcLinePositions, 3).setUsage(THREE.DynamicDrawUsage);
  lineGeo.setAttribute('position', lineAttr);
  const lineMat = new THREE.LineBasicMaterial({ color: 0xeaffff, opacity: 1, ...additive });
  const lines = new THREE.LineSegments(lineGeo, lineMat);
  lines.frustumCulled = false;
  lines.visible = false;
  lines.renderOrder = 4;
  const glowGeo = new THREE.BufferGeometry();
  const glowAttr = new THREE.BufferAttribute(arcGlowPositions, 3).setUsage(THREE.DynamicDrawUsage);
  glowGeo.setAttribute('position', glowAttr);
  const glowMat = new THREE.PointsMaterial({ map: textures.flare, color: 0x63dcff, size: 2.4, sizeAttenuation: true, opacity: 1, ...additive });
  const glow = new THREE.Points(glowGeo, glowMat);
  glow.frustumCulled = false;
  glow.visible = false;
  glow.renderOrder = 3;
  // In world space, not the flower's: the arcs are computed from the petals' world matrices.
  const arcsRoot = new THREE.Group();
  arcsRoot.add(lines, glow);

  const heart = { x: r.x, y: hubY + 1.2, z: r.z };
  const scratch = new THREE.Vector3();

  /** A point on petal `i`'s surface, in world space. */
  const petalPoint = (i: number, u: number, v: number): THREE.Vector3 => {
    const p = PETALS[i];
    const local = petalLocal(p.open - CLOSED_BY, p.len, p.width, u, v, scratch);
    return hinges[i].localToWorld(local);
  };

  /* ------------------------------------------------------------ state */

  let opened = 0;
  let openFrom = 0;
  let strikeAt = -Infinity;
  let lit = false;
  let pending = false;
  let lastArcs = -Infinity;

  const regenerateArcs = (strength: number): void => {
    root.updateMatrixWorld(true);
    let lw = 0;
    let gw = 0;
    for (let a = 0; a < ARCS; a++) {
      // Most arcs run from the heart out over a petal; a couple jump between the stamens' bulbs.
      let fx = heart.x;
      let fy = heart.y;
      let fz = heart.z;
      let to: THREE.Vector3;
      if (a >= ARCS - 2) {
        const b0 = bulbs[Math.floor(Math.random() * bulbs.length)];
        fx = r.x + b0.x;
        fy = hubY + b0.y;
        fz = r.z + b0.z;
        const b1 = bulbs[Math.floor(Math.random() * bulbs.length)];
        to = scratch.set(r.x + b1.x, hubY + b1.y, r.z + b1.z);
      } else {
        const i = Math.floor(Math.random() * PETALS.length);
        to = petalPoint(i, 0.35 + Math.random() * 0.6, Math.random() * 1.6 - 0.8);
      }
      const span = Math.hypot(to.x - fx, to.y - fy, to.z - fz);
      buildBoltPoints(arcPoints, ARC_SEGMENTS, fx, fy, fz, to.x, to.y, to.z, Math.min(3, 0.4 + span * 0.08) * strength, 0);
      lw += polylineToSegments(arcPoints, ARC_SEGMENTS + 1, arcLinePositions, lw);
      arcGlowPositions.set(arcPoints, gw * 3);
      gw += ARC_SEGMENTS + 1;
    }
    lineAttr.needsUpdate = true;
    glowAttr.needsUpdate = true;
    lineGeo.setDrawRange(0, lw);
    glowGeo.setDrawRange(0, gw);
  };

  const smooth = (t: number): number => {
    const c = Math.min(1, Math.max(0, t));
    return c * c * (3 - 2 * c);
  };

  return {
    root: (() => {
      const g = new THREE.Group();
      g.name = 'floralis-root';
      g.add(root, arcsRoot);
      return g;
    })(),
    heart,
    hits(fromX, fromZ, toX, toZ) {
      const dx = toX - fromX;
      const dz = toZ - fromZ;
      const len2 = dx * dx + dz * dz;
      let t = len2 > 0 ? ((r.x - fromX) * dx + (r.z - fromZ) * dz) / len2 : 0;
      t = Math.min(1, Math.max(0, t));
      return Math.hypot(fromX + dx * t - r.x, fromZ + dz * t - r.z) < FLORALIS.hitRadius;
    },
    strike() {
      pending = true;
    },
    openness() {
      return opened;
    },
    update(time, camX, camZ) {
      if (camX !== undefined && camZ !== undefined) {
        const far = Math.hypot(camX - r.x, camZ - r.z) > FLORALIS.drawDistance;
        root.visible = !far;
        if (far) {
          arcsRoot.visible = false;
          return;
        }
      }
      if (pending) {
        pending = false;
        strikeAt = time;
        openFrom = opened;
        lit = true;
      }
      const since = time - strikeAt;
      // Never struck: it stands as it was built, half closed.
      if (lit) opened = openFrom + (1 - openFrom) * smooth((since - FLORALIS.openDelay) / FLORALIS.openSeconds);
      const crackling = since >= 0 && since < FLORALIS.crackle;
      const flash = since >= 0 ? Math.exp(-since * 2.2) : 0;
      // The petals: open by the animation, shivering while the charge runs through them.
      for (let i = 0; i < hinges.length; i++) {
        const shiver = crackling ? Math.sin(time * 47 + i * 1.9) * 0.012 * (1 - since / FLORALIS.crackle) : 0;
        hinges[i].rotation.z = -(opened * CLOSED_BY + shiver);
      }
      // The heart: flares with the strike, then breathes at a steady glow, for good.
      const rise = lit ? smooth(since / FLORALIS.heartRise) : 0;
      const breath = 0.8 + 0.2 * Math.sin(time * 2.1) + 0.06 * Math.sin(time * 7.3);
      const level = Math.min(1.6, rise * breath + flash * 1.2);
      const on = level > 0.002;
      core.visible = on;
      halo.visible = on;
      beam.visible = on;
      for (const s of bulbSprites) s.visible = on;
      coreMat.opacity = Math.min(1, level);
      core.scale.setScalar(0.85 + 0.25 * level);
      haloMat.opacity = Math.min(1, 0.75 * level);
      halo.scale.setScalar(26 + 16 * level + 30 * flash);
      bulbMat.opacity = Math.min(1, 0.6 * level);
      beamMat.opacity = Math.min(1, 0.16 * level + 0.3 * flash);
      chrome.emissive.setRGB(0.1 * level + 0.35 * flash, 0.3 * level + 0.7 * flash, 0.38 * level + 0.9 * flash);
      chrome.emissiveIntensity = 0.35;
      // The arcs: a fresh set every few hundredths of a second while it crackles, and now and
      // then a short one after, so a lit flower is still visibly live.
      let arcs = crackling;
      if (!arcs && lit && Math.sin(time * 0.9) * Math.sin(time * 2.3) > 0.92) arcs = true;
      arcsRoot.visible = arcs;
      lines.visible = arcs;
      glow.visible = arcs;
      if (arcs && time - lastArcs > 0.045) {
        lastArcs = time;
        regenerateArcs(crackling ? 1 : 0.5);
      }
      lineMat.opacity = crackling ? 1 : 0.6;
      glowMat.opacity = crackling ? 0.9 : 0.4;
    },
    dispose() {
      chrome.dispose();
      for (const g of petalGeos) g.dispose();
      partsGeo.dispose();
      core.geometry.dispose();
      coreMat.dispose();
      haloMat.dispose();
      bulbMat.dispose();
      beamGeo.dispose();
      beamMat.dispose();
      lineGeo.dispose();
      lineMat.dispose();
      glowGeo.dispose();
      glowMat.dispose();
      textures.dispose();
    },
  };
}

/**
 * A point of a petal in its hinge's frame: +X out along its azimuth, +Y up, +Z across. The spine
 * leans `lean0` from upright at the hub and curls back up toward the tip; the petal is an oval,
 * widest a little past halfway, round at the tip, scooped so its hollow faces the flower's middle.
 */
function petalLocal(lean0: number, len: number, width: number, u: number, v: number, out: THREE.Vector3): THREE.Vector3 {
  // Integrate the spine to `u` (a few steps: the curl is gentle).
  const steps = Math.max(1, Math.ceil(u * NU));
  let rho = 1.6;
  let h = 0;
  let lean = lean0;
  for (let k = 0; k < steps; k++) {
    const uu = (k / steps) * u;
    lean = lean0 - CURL * uu * uu;
    rho += (Math.sin(lean) * len * u) / steps;
    h += (Math.cos(lean) * len * u) / steps;
  }
  lean = lean0 - CURL * u * u;
  const t = u < WIDEST ? (u - WIDEST) / WIDEST : (u - WIDEST) / (1 - WIDEST);
  const round = Math.sqrt(Math.max(0, 1 - t * t));
  const w = (width / 2) * round;
  const depth = SCOOP * (1 - v * v) * round;
  return out.set(rho + Math.cos(lean) * depth, h - Math.sin(lean) * depth, v * w);
}

function petalGeometry(lean0: number, len: number, width: number): THREE.BufferGeometry {
  const positions = new Float32Array((NU + 1) * (NV + 1) * 3);
  const p = new THREE.Vector3();
  for (let i = 0; i <= NU; i++) {
    for (let j = 0; j <= NV; j++) {
      petalLocal(lean0, len, width, i / NU, (j / NV) * 2 - 1, p);
      const o = (i * (NV + 1) + j) * 3;
      positions[o] = p.x;
      positions[o + 1] = p.y;
      positions[o + 2] = p.z;
    }
  }
  const index: number[] = [];
  for (let i = 0; i < NU; i++) {
    for (let j = 0; j < NV; j++) {
      const a = i * (NV + 1) + j;
      const b = a + 1;
      const c = a + NV + 1;
      const d = c + 1;
      index.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}
