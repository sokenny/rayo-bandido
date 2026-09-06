import * as THREE from 'three';
import { LIGHTNING } from '../../config/tuning';
import { buildBoltPoints, polylineToSegments } from './shapes';
import type { FxTextures } from './sprites';

/**
 * The cyan / blue-white arc that connects the car to the electric car it just hit.
 *
 * Three draw calls sharing two preallocated buffers:
 *  - a crisp white-cyan core `THREE.Line`,
 *  - a soft cyan glow `THREE.Points` reusing the SAME geometry (Three's line width is
 *    always one pixel in WebGL, so a sprite cloud is what actually makes the bolt look
 *    thick), and
 *  - one `THREE.LineSegments` holding up to two short branches.
 *
 * The point set is regenerated in place three times across the life for a flicker; nothing
 * is allocated after creation.
 */
export const BOLT_SEGMENTS = 24;
export const BOLT_POINTS = BOLT_SEGMENTS + 1;
const BRANCH_POINTS = 4;
const MAX_BRANCHES = 2;
const BRANCH_VERTS = MAX_BRANCHES * (BRANCH_POINTS - 1) * 2;

/** Height of the muzzle (roof / wing area) and of the impact point. */
export const BOLT_FROM_Y = 0.9;
export const BOLT_TO_Y = 0.8;

const REGENERATIONS = 3;

export interface LightningArc {
  core: THREE.Line;
  glow: THREE.Points;
  branches: THREE.LineSegments;
  fire(fromX: number, fromY: number, fromZ: number, toX: number, toY: number, toZ: number): void;
  update(dt: number): void;
  reset(): void;
  dispose(): void;
}

export function createLightningArc(parent: THREE.Object3D, textures: FxTextures): LightningArc {
  const boltPositions = new Float32Array(BOLT_POINTS * 3);
  const boltGeo = new THREE.BufferGeometry();
  const boltAttr = new THREE.BufferAttribute(boltPositions, 3);
  boltAttr.setUsage(THREE.DynamicDrawUsage);
  boltGeo.setAttribute('position', boltAttr);

  const coreMat = new THREE.LineBasicMaterial({
    color: 0xe8ffff,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const core = new THREE.Line(boltGeo, coreMat);
  core.name = 'fx-bolt-core';
  core.frustumCulled = false;
  core.visible = false;
  core.renderOrder = 4;

  const glowMat = new THREE.PointsMaterial({
    map: textures.flare,
    color: 0x63dcff,
    // Sized so consecutive bolt points overlap at typical target ranges and the glow reads
    // as a plasma tube rather than a string of beads.
    size: 1.35,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  // Shares `boltGeo`: one buffer upload feeds both the core line and the glow cloud.
  const glow = new THREE.Points(boltGeo, glowMat);
  glow.name = 'fx-bolt-glow';
  glow.frustumCulled = false;
  glow.visible = false;
  glow.renderOrder = 3;

  const branchPositions = new Float32Array(BRANCH_VERTS * 3);
  const branchGeo = new THREE.BufferGeometry();
  const branchAttr = new THREE.BufferAttribute(branchPositions, 3);
  branchAttr.setUsage(THREE.DynamicDrawUsage);
  branchGeo.setAttribute('position', branchAttr);
  branchGeo.setDrawRange(0, 0);
  const branchMat = new THREE.LineBasicMaterial({
    color: 0x9beeff,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const branches = new THREE.LineSegments(branchGeo, branchMat);
  branches.name = 'fx-bolt-branches';
  branches.frustumCulled = false;
  branches.visible = false;
  branches.renderOrder = 4;

  parent.add(glow, core, branches);

  // Scratch buffer for one branch polyline. Allocated once.
  const branchScratch = new Float32Array(BRANCH_POINTS * 3);

  let timer = 0;
  let regenTimer = 0;
  let fromX = 0;
  let fromY = 0;
  let fromZ = 0;
  let toX = 0;
  let toY = 0;
  let toZ = 0;
  let flicker = 1;

  const duration = LIGHTNING.arcDuration;
  const regenInterval = duration / REGENERATIONS;

  function regenerate(): void {
    const dx = toX - fromX;
    const dz = toZ - fromZ;
    const span = Math.sqrt(dx * dx + dz * dz);
    const amplitude = Math.min(1.4, 0.14 + span * 0.045);
    buildBoltPoints(
      boltPositions,
      BOLT_SEGMENTS,
      fromX,
      fromY + BOLT_FROM_Y,
      fromZ,
      toX,
      toY + BOLT_TO_Y,
      toZ,
      amplitude,
      amplitude * 0.55,
    );
    boltAttr.needsUpdate = true;

    // Branches fork off two interior points and die a short way off-axis.
    const branchCount = Math.random() < 0.45 ? 1 : MAX_BRANCHES;
    let written = 0;
    for (let b = 0; b < branchCount; b++) {
      const anchor = 4 + Math.floor(Math.random() * (BOLT_SEGMENTS - 8));
      const a3 = anchor * 3;
      const ax = boltPositions[a3];
      const ay = boltPositions[a3 + 1];
      const az = boltPositions[a3 + 2];
      const reach = 0.9 + Math.random() * 1.6;
      const angle = Math.random() * Math.PI * 2;
      const ex = ax + Math.cos(angle) * reach;
      const ey = ay + (Math.random() - 0.3) * reach * 0.7;
      const ez = az + Math.sin(angle) * reach;
      buildBoltPoints(branchScratch, BRANCH_POINTS - 1, ax, ay, az, ex, ey, ez, reach * 0.22, 0);
      written += polylineToSegments(branchScratch, BRANCH_POINTS, branchPositions, written);
    }
    branchGeo.setDrawRange(0, written);
    branchAttr.needsUpdate = true;

    flicker = 0.72 + Math.random() * 0.28;
  }

  function setOpacity(value: number): void {
    coreMat.opacity = value;
    glowMat.opacity = value * 0.85;
    branchMat.opacity = value * 0.7;
    const visible = value > 0.001;
    core.visible = visible;
    glow.visible = visible;
    branches.visible = visible;
  }

  return {
    core,
    glow,
    branches,
    fire(x0, y0, z0, x1, y1, z1) {
      fromX = x0;
      fromY = y0;
      fromZ = z0;
      toX = x1;
      toY = y1;
      toZ = z1;
      timer = duration;
      regenTimer = regenInterval;
      regenerate();
      setOpacity(flicker);
    },
    update(dt) {
      if (timer <= 0) return;
      timer -= dt;
      if (timer <= 0) {
        timer = 0;
        setOpacity(0);
        return;
      }
      regenTimer -= dt;
      if (regenTimer <= 0) {
        regenTimer += regenInterval;
        regenerate();
      }
      // Full brightness for the first two thirds, then fade.
      const remaining = timer / duration;
      const fade = remaining > 1 / 3 ? 1 : remaining * 3;
      setOpacity(fade * flicker);
    },
    reset() {
      timer = 0;
      setOpacity(0);
      branchGeo.setDrawRange(0, 0);
    },
    dispose() {
      parent.remove(core);
      parent.remove(glow);
      parent.remove(branches);
      boltGeo.dispose();
      branchGeo.dispose();
      coreMat.dispose();
      glowMat.dispose();
      branchMat.dispose();
    },
  };
}
