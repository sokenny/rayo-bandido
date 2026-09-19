import * as THREE from 'three';
import { STOCK_LOADOUT, type CarLoadout } from '../../../core/loadout';
import { box, glowPool, mergeParts, partRGBA } from './geometryKit';
import { lampColor } from './lights';

/**
 * THE UNDERGLOW: the neon strips round the sills and the pool of light they throw on the road.
 * OWNED BY agent G (`docs/GARAGE_PLAN.md` §2.7 and decision D2, Ola 1).
 *
 * THE NEON IS THE LIGHTNING'S CHARGE METER. `setCharge` brightens both meshes with the charge
 * and, above 0.6, `update` makes them flicker. That is the gameplay reading of the neon and it
 * survives any colour the player picks (D2, approved):
 * - `'rayo'` (stock): exactly today's car — cyan sides and front, magenta tail strip, a pool that
 *   runs cyan to magenta, brightening and flickering with the charge. Colours in the vertices,
 *   material colour white.
 * - any other palette colour: the vertices go white and the MATERIAL colour carries the hue. At
 *   rest it is the chosen colour; as the charge builds it swings toward `CHARGE_COLOR`
 *   (cyan/blue-white) and flickers exactly as stock does above 0.6.
 * - `'off'`: the same, but the resting colour is black (additive black is nothing), so the
 *   neon is dark until the Rayo charges — the charge reading is never switched off.
 *
 * CONTRACT
 * - `createUnderglow(root, chassis, loadout)` adds the ground pool to `root` (it stays on the
 *   road, it does not roll with the body) and then the strips to `chassis`, in that order. Two of
 *   the car's fourteen draw calls.
 * - `setCharge(level)` takes 0..1 already clamped; `update(time)` runs once per frame. Neither
 *   allocates: both colours are resolved in `applyLoadout` and lerped into the material's own.
 * - `applyLoadout(loadout)` is workshop-time: it rebuilds the two geometries when the neon moves
 *   between `'rayo'` and anything else (disposing the old ones) and re-resolves the colours.
 */
export interface Underglow {
  readonly pool: THREE.Mesh;
  readonly strips: THREE.Mesh;
  setCharge(level: number): void;
  update(time: number): void;
  applyLoadout(loadout: CarLoadout): void;
  dispose(): void;
}

/** What any neon colour swings to as the Rayo charges (D2): a cyan pushed toward blue-white. */
export const CHARGE_COLOR = 0x7ef0ff;

/** Stock neon colours, baked into the vertices when the choice is `'rayo'`. */
const RAYO_CYAN = 0x22e6ff;
const RAYO_MAGENTA = 0xff2fd0;

/**
 * How far toward `CHARGE_COLOR` the neon has swung at `charge` (0..1): nothing at rest, all the
 * way by a full charge, eased so a half charge already reads as "going blue".
 */
export function chargeShift(charge: number): number {
  const t = charge <= 0 ? 0 : charge >= 1 ? 1 : charge;
  return t * (2 - t);
}

function buildPoolGeometry(stock: boolean): THREE.BufferGeometry {
  const geo = stock ? glowPool(3.9, 6.2, 8, 12, RAYO_CYAN, RAYO_MAGENTA) : glowPool(3.9, 6.2, 8, 12, 0xffffff, 0xffffff);
  geo.translate(0, 0.02, 0.1);
  return geo;
}

function buildStripGeometry(stock: boolean): THREE.BufferGeometry {
  const side = stock ? RAYO_CYAN : 0xffffff;
  const rear = stock ? RAYO_MAGENTA : 0xffffff;
  const parts: THREE.BufferGeometry[] = [];
  for (const sign of [-1, 1]) {
    const rocker = box(0.02, 0.04, 1.62);
    rocker.translate(sign * 0.995, 0.11, 0);
    parts.push(partRGBA(rocker, side, 1));
  }
  const rearStrip = box(1.44, 0.035, 0.02);
  rearStrip.translate(0, 0.15, 2.13);
  parts.push(partRGBA(rearStrip, rear, 1));
  const frontStrip = box(1.3, 0.03, 0.02);
  frontStrip.translate(0, 0.11, -2.27);
  parts.push(partRGBA(frontStrip, side, 1));
  return mergeParts(parts);
}

export function createUnderglow(root: THREE.Object3D, chassis: THREE.Object3D, loadout: CarLoadout = STOCK_LOADOUT): Underglow {
  /** Whether the vertices carry the stock two-colour neon (`'rayo'`) or are white. */
  let stockVerts = true;

  /* ------------------------------------------ underglow: ground light spill */
  // A soft radial pool cast on the road beneath the car. Its own mesh/material so
  // the spill can read as light without over-brightening the hard neon strips.
  const poolMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const pool = new THREE.Mesh(buildPoolGeometry(true), poolMat);
  pool.name = 'player-car-groundglow';
  pool.renderOrder = 1;
  root.add(pool);

  /* ---------------------------------------------------------- underglow rim */
  const glowMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const strips = new THREE.Mesh(buildStripGeometry(true), glowMat);
  strips.name = 'player-car-underglow';
  strips.renderOrder = 2;
  chassis.add(strips);

  /** Material colour at rest and at full charge, resolved once per loadout. */
  const restColour = new THREE.Color(0xffffff);
  const chargeColour = new THREE.Color(0xffffff);

  let charge = 0;
  let flicker = 1;

  function refresh(): void {
    glowMat.opacity = (0.2 + charge * 0.85) * flicker;
    // Ground spill: always present for immersion, brightening with charge.
    poolMat.opacity = (0.45 + charge * 0.8) * flicker;
    // Stock: both colours are white, so this is a no-op on the stock picture.
    const shift = chargeShift(charge);
    glowMat.color.lerpColors(restColour, chargeColour, shift);
    poolMat.color.copy(glowMat.color);
  }

  function swap(mesh: THREE.Mesh, geometry: THREE.BufferGeometry): void {
    const old = mesh.geometry;
    mesh.geometry = geometry;
    old.dispose();
  }

  function applyLoadout(l: CarLoadout): void {
    const neon = l.lights.neon;
    const wantStock = neon === 'rayo';
    if (wantStock !== stockVerts) {
      stockVerts = wantStock;
      swap(pool, buildPoolGeometry(wantStock));
      swap(strips, buildStripGeometry(wantStock));
    }
    if (wantStock) {
      restColour.setRGB(1, 1, 1);
      chargeColour.setRGB(1, 1, 1);
    } else {
      if (neon === 'off') restColour.setRGB(0, 0, 0);
      else lampColor(neon, restColour);
      chargeColour.set(CHARGE_COLOR);
    }
    refresh();
  }

  applyLoadout(loadout);

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
    applyLoadout,
    dispose() {
      pool.geometry.dispose();
      poolMat.dispose();
      strips.geometry.dispose();
      glowMat.dispose();
    },
  };
}
