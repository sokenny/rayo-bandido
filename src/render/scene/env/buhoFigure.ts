import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MOOGUL } from '../../../config/tuning';
import type { ActivitySite } from '../../../core/types';
import { createHumanFigure, type HumanFigureVisual, type HumanLook } from './humanFigure';

/**
 * El Búho, as seen from the road: a man in a parka with his hood up, standing in a ring of
 * paint under the deck with a cooler at his feet and two round amber lenses where his eyes
 * would be. The ring is the same shorthand a passenger stop uses (`passengerMarker.ts`) in
 * his own colour, and — as there — the ring IS the zone: its radius is `MOOGUL.marker`'s.
 *
 * LOW-POLY ON PURPOSE. He is boxes out of the city's own `MeshBuilder`, merged into a couple of
 * geometries with vertex colours and lit by the same two lights as the kerb he stands on, so he
 * belongs to the street rather than to a cutscene. The lenses are unlit and the only thing
 * about him that moves, apart from the slightest shift of weight. Six draw calls in all,
 * nothing allocated per frame, and he is never hidden: he is part of the city.
 *
 * HE IS NOT A SPECIAL CASE ANY MORE. The man himself is a `HumanLook` handed to the shared
 * body (`humanFigure.ts`) — the same object every side-mission passenger is built from. What is
 * left here is his own: the ring, the pool of warm light he stands in, and the look below.
 */
export interface BuhoFigureVisual {
  group: THREE.Group;
  /** How close the player is, 0 (far) .. 1 (in the ring). Brightens the ring. */
  setProximity(value: number): void;
  update(time: number): void;
  dispose(): void;
}

const AMBER = 0xf0b34a;
/** Above the concrete slab the elevated builder lays under the deck (0.02), not the road's 0. */
const PAINT_Y = 0.06;
/** Where he stands, back from the ring's centre along its facing (m): against the outer column line. */
const STAND_BACK = 4.3;

/**
 * The man: a heavy olive parka with the hood up, one hand in a pocket, work boots, and the
 * cooler he sells out of standing at his feet with a warm tube along the lid. The lenses are
 * the only bright thing about him, and they are the reason for the name.
 */
const BUHO_LOOK: HumanLook = {
  height: 1.02,
  build: 1.06,
  skin: 0xa8785a,
  hair: 0x24201a,
  head: 'hood',
  headwear: 0x2c3122,
  coat: 0x3a3f2c,
  coatLength: 0.25,
  legs: 0x1f2228,
  boots: 0x181b20,
  pose: 'pocket',
  eyes: 'lenses',
  eyeColor: AMBER,
  prop: 'cooler',
  propColor: 0x2a3a48,
  propAccent: AMBER,
};

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

  // He stands `STAND_BACK` behind the ring's centre, facing into it — which is the shared
  // body's own convention, so nothing here has to rotate him.
  const man: HumanFigureVisual = createHumanFigure(BUHO_LOOK, { name: 'el-buho-man' });
  man.group.position.z = STAND_BACK;
  group.add(man.group);

  // The light he stands in: a pool on the floor and a halo behind him, both from one soft
  // radial texture, additive, so from the street end of the corridor there is a warm spot
  // under the deck before there is a man in it.
  const glowTex = makeGlowTexture();
  const pool = new THREE.PlaneGeometry(7, 7);
  pool.rotateX(-Math.PI / 2);
  pool.translate(-0.4, PAINT_Y + 0.004, STAND_BACK - 0.2);
  const halo = new THREE.PlaneGeometry(3.2, 4);
  halo.rotateY(Math.PI);
  halo.translate(-0.2, 1.7, STAND_BACK + 0.55);
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
      glowMat.opacity = 0.28 + 0.05 * Math.sin(time * 0.9) + proximity * 0.1;
      // The shift of weight and the lenses catching the light belong to the body.
      man.update(time);
    },
    dispose() {
      group.clear();
      man.dispose();
      backingGeo.dispose();
      backingMat.dispose();
      ringGeo.dispose();
      ringMat.dispose();
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
