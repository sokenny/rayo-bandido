import * as THREE from 'three';
import { STOCK_LOADOUT, type CarLoadout } from '../../../core/loadout';
import { box, glowPool, mergeParts, partRGBA } from './geometryKit';

/**
 * THE UNDERGLOW: the neon strips round the sills and the pool of light they throw on the road.
 * OWNED BY agent G (`docs/GARAGE_PLAN.md` §2.7 and decision D2, Ola 1). Extracted from
 * `carVisual.ts` unchanged.
 *
 * TODAY THE NEON IS THE LIGHTNING'S CHARGE METER. `setCharge` brightens both meshes with the
 * charge and, above 0.6, `update` makes them flicker. That behaviour is the gameplay reading of
 * the neon and must survive any colour the player picks (D2): at rest the strips show the
 * chosen colour; charging, they still swing to cyan/white and flicker exactly as now; `'off'`
 * turns the resting glow off but NOT the charge reading.
 *
 * CONTRACT
 * - `createUnderglow(root, chassis, loadout)` adds the ground pool to `root` (it stays on the
 *   road, it does not roll with the body) and then the strips to `chassis`, in that order. Two of
 *   the car's fourteen draw calls.
 * - `setCharge(level)` takes 0..1 already clamped; `update(time)` runs once per frame. Neither
 *   allocates.
 * - `applyLoadout(loadout)` is workshop-time. WAVE 0 STATE: a no-op (stock is built in). Agent G
 *   recolours from `loadout.lights.neon` — either by rebuilding the strips' vertex colours or
 *   by moving them to white × a material colour; the stock choice (`'rayo'`, cyan with a magenta
 *   accent) must stay exactly today's cyan sides and front with the magenta tail strip.
 */
export interface Underglow {
  readonly pool: THREE.Mesh;
  readonly strips: THREE.Mesh;
  setCharge(level: number): void;
  update(time: number): void;
  applyLoadout(loadout: CarLoadout): void;
  dispose(): void;
}

export function createUnderglow(root: THREE.Object3D, chassis: THREE.Object3D, _loadout: CarLoadout = STOCK_LOADOUT): Underglow {
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
  const pool = new THREE.Mesh(poolGeo, poolMat);
  pool.name = 'player-car-groundglow';
  pool.renderOrder = 1;
  root.add(pool);

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
  const strips = new THREE.Mesh(glowGeo, glowMat);
  strips.name = 'player-car-underglow';
  strips.renderOrder = 2;
  chassis.add(strips);

  let charge = 0;
  let flicker = 1;

  function refresh(): void {
    glowMat.opacity = (0.2 + charge * 0.85) * flicker;
    // Ground spill: always present for immersion, brightening with charge.
    poolMat.opacity = (0.45 + charge * 0.8) * flicker;
  }
  refresh();

  return {
    pool,
    strips,
    setCharge(level) {
      charge = level;
      refresh();
    },
    update(time) {
      if (charge > 0.6) {
        const t = time * 26;
        flicker = 1 + (Math.sin(t) + Math.sin(t * 2.7)) * 0.08 * (charge - 0.6) * 2.5;
      } else {
        flicker = 1;
      }
      refresh();
    },
    applyLoadout() {
      /* Wave 0: stock only. See the header. */
    },
    dispose() {
      poolGeo.dispose();
      poolMat.dispose();
      strips.geometry.dispose();
      glowMat.dispose();
    },
  };
}
