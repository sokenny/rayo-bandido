import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MOOGUL } from '../../../config/tuning';
import type { ActivitySite } from '../../../core/types';
import { MeshBuilder } from './meshBuilder';

/**
 * El Búho, as seen from the road: a man in a parka with his hood up, standing in a ring of
 * paint under the deck with a cooler at his feet and two round amber lenses where his eyes
 * would be. The ring is the same shorthand a passenger stop uses (`passengerMarker.ts`) in
 * his own colour, and — as there — the ring IS the zone: its radius is `MOOGUL.marker`'s.
 *
 * LOW-POLY ON PURPOSE. He is nine boxes out of the city's own `MeshBuilder`, merged into one
 * geometry with vertex colours and lit by the same two lights as the kerb he stands on, so he
 * belongs to the street rather than to a cutscene. The lenses are unlit and the only thing
 * about him that moves, apart from the slightest shift of weight. Four draw calls in all,
 * nothing allocated per frame, and he is never hidden: he is part of the city.
 */
export interface BuhoFigureVisual {
  group: THREE.Group;
  /** How close the player is, 0 (far) .. 1 (in the ring). Brightens the ring. */
  setProximity(value: number): void;
  update(time: number): void;
  dispose(): void;
}

const AMBER = 0xf0b34a;
const AMBER_DEEP = 0xc9801a;
/** Above the concrete slab the elevated builder lays under the deck (0.02), not the road's 0. */
const PAINT_Y = 0.06;
/** Where he stands, back from the ring's centre along its facing (m): against the outer column line. */
const STAND_BACK = 4.3;

export function createBuhoFigure(site: ActivitySite): BuhoFigureVisual {
  const group = new THREE.Group();
  group.name = 'el-buho';
  group.position.set(site.x, site.y, site.z);
  group.rotation.y = -site.heading;

  /* ---------------------------------------------------------------- the ring */

  const outer = MOOGUL.marker.promptRadius;
  const inner = outer - 0.7;
  const backingGeo = new THREE.RingGeometry(inner - 0.45, outer + 0.45, 40);
  const backingMat = new THREE.MeshBasicMaterial({ color: 0x05070c, transparent: true, opacity: 0.4, depthWrite: false });
  const backing = new THREE.Mesh(backingGeo, backingMat);
  backing.rotation.x = -Math.PI / 2;
  backing.position.y = PAINT_Y;
  backing.renderOrder = 1;
  group.add(backing);

  const ringGeo = new THREE.RingGeometry(inner, outer, 40, 1);
  const ringMat = new THREE.MeshBasicMaterial({
    color: AMBER,
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = PAINT_Y + 0.002;
  ring.renderOrder = 2;
  group.add(ring);

  /* ---------------------------------------------------------------- the man */

  // Built facing local -z (the ring's centre), standing `STAND_BACK` behind it.
  const b = new MeshBuilder(true);
  const z = STAND_BACK;
  // Boots and legs.
  b.color(0x1f2228, 1);
  b.box(-0.15, 0.43, z, 0.22, 0.86, 0.26);
  b.box(0.15, 0.43, z + 0.04, 0.22, 0.86, 0.26);
  // The parka, and the arms in its sleeves, one hand in a pocket.
  b.color(0x3a3f2c, 1.05);
  b.box(0, 1.24, z, 0.64, 0.78, 0.4);
  b.box(-0.42, 1.22, z + 0.02, 0.17, 0.66, 0.2);
  b.box(0.42, 1.28, z - 0.06, 0.17, 0.58, 0.22);
  // The head, and the hood round it, open at the front.
  b.color(0xa8785a, 1);
  b.box(0, 1.8, z - 0.02, 0.3, 0.32, 0.3);
  b.color(0x2c3122, 1);
  b.box(0, 1.86, z + 0.1, 0.42, 0.44, 0.3);
  b.box(0, 2.06, z - 0.02, 0.42, 0.08, 0.5);
  // The cooler at his feet: the whole shop.
  b.color(0x2a3a48, 1.1);
  b.box(-0.95, 0.24, z - 0.1, 0.7, 0.48, 0.5, { bottom: true });
  b.color(0x1c2732, 1);
  b.box(-0.95, 0.5, z - 0.1, 0.74, 0.05, 0.54);
  const bodyGeo = b.build();
  const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.05 });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.name = 'el-buho-body';
  group.add(body);

  // The lenses — two discs, unlit, in front of the face — and the one amber tube on the lid
  // of the cooler, the same warm strip the stalls under the deck run. One unlit geometry.
  const lensL = new THREE.CircleGeometry(0.09, 14);
  const lensR = new THREE.CircleGeometry(0.09, 14);
  // Discs face +z by default; he faces -z.
  lensL.rotateY(Math.PI);
  lensR.rotateY(Math.PI);
  lensL.translate(-0.09, 1.82, z - 0.18);
  lensR.translate(0.09, 1.82, z - 0.18);
  const tube = new THREE.BoxGeometry(0.72, 0.05, 0.05);
  tube.translate(-0.95, 0.55, z - 0.36);
  const lensGeo = mergeGeometries([lensL, lensR, tube]) ?? lensL;
  lensL.dispose();
  lensR.dispose();
  tube.dispose();
  const lensMat = new THREE.MeshBasicMaterial({ color: AMBER, toneMapped: false, transparent: true, opacity: 0.95 });
  const lenses = new THREE.Mesh(lensGeo, lensMat);
  lenses.name = 'el-buho-lenses';
  group.add(lenses);

  // The light he stands in: a pool on the floor and a halo behind him, both from one soft
  // radial texture, additive, so from the street end of the corridor there is a warm spot
  // under the deck before there is a man in it.
  const glowTex = makeGlowTexture();
  const pool = new THREE.PlaneGeometry(7, 7);
  pool.rotateX(-Math.PI / 2);
  pool.translate(-0.4, PAINT_Y + 0.004, z - 0.2);
  const halo = new THREE.PlaneGeometry(3.2, 4);
  halo.rotateY(Math.PI);
  halo.translate(-0.2, 1.7, z + 0.55);
  const glowGeo = mergeGeometries([pool, halo]) ?? pool;
  pool.dispose();
  halo.dispose();
  const glowMat = new THREE.MeshBasicMaterial({
    map: glowTex,
    color: AMBER,
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
  const glow = new THREE.Mesh(glowGeo, glowMat);
  glow.name = 'el-buho-glow';
  glow.renderOrder = 2;
  group.add(glow);

  let proximity = 0;
  const lensColor = new THREE.Color(AMBER);
  const lensDeep = new THREE.Color(AMBER_DEEP);

  return {
    group,
    setProximity(value) {
      proximity = value < 0 ? 0 : value > 1 ? 1 : value;
    },
    update(time) {
      // The ring holds steady, a place rather than a person; it warms as the car closes.
      const pulse = 0.5 + 0.5 * Math.sin(time * 1.2);
      ringMat.opacity = 0.2 + proximity * 0.28 + pulse * 0.06;
      backingMat.opacity = 0.3 + proximity * 0.18;
      // A shift of weight now and then, and the lenses catching the light.
      body.rotation.y = 0.05 * Math.sin(time * 0.37) + 0.02 * Math.sin(time * 1.3);
      lensMat.color.copy(lensDeep).lerp(lensColor, 0.7 + 0.3 * Math.sin(time * 0.9));
      glowMat.opacity = 0.28 + 0.05 * Math.sin(time * 0.9) + proximity * 0.1;
    },
    dispose() {
      group.clear();
      backingGeo.dispose();
      backingMat.dispose();
      ringGeo.dispose();
      ringMat.dispose();
      bodyGeo.dispose();
      bodyMat.dispose();
      lensGeo.dispose();
      lensMat.dispose();
      glowGeo.dispose();
      glowMat.dispose();
      glowTex.dispose();
    },
  };
}

/** A soft radial falloff, drawn once: the pool and the halo both sample it. */
function makeGlowTexture(): THREE.Texture {
  const size = 64;
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const ctx = cv.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
