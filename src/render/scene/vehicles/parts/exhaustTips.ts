import * as THREE from 'three';
import type { PartId } from '../../../../core/loadout';
import { part } from '../geometryKit';
import { BODY_COLORS, type SlotModule } from './common';
import { recolor } from './kit';

/**
 * Exhaust tips. Sold (`exhaustTips.*`: the stock twin rounds, single, cannon, quad, side exit,
 * burnt titanium).
 *
 * `exhaustOutlets(partId)` is this slot's second export and a CONTRACT with `../lights.ts`:
 * the nitro/exhaust glow discs are drawn at exactly these points, so a new tip layout must list
 * its outlets here or the flame will hang in the air where the old pipes were.
 *
 * Every layout is described once, in `LAYOUTS`, and both the pipes and the outlets are read off
 * it, so the two can never disagree. Tips keep to y ≥ 0.17 (over the rear neon strip), clear of
 * the plate and of the reverse lamps (x 0.385–0.535, y ≥ 0.365), and inside the x bands the
 * rear bumpers keep free of diffuser fins (`./rearBumper.ts`).
 */
export interface ExhaustOutlet {
  x: number;
  y: number;
  /** The mouth of the pipe, where the glow disc sits (it faces +Z). */
  z: number;
  /** Radius of the glow disc. */
  radius: number;
}

const STOCK_OUTLETS: readonly ExhaustOutlet[] = [
  { x: -0.34, y: 0.33, z: 2.245, radius: 0.072 },
  { x: 0.34, y: 0.33, z: 2.245, radius: 0.072 },
];

/** Burnt titanium: straw, then blue-violet toward the mouth. */
const TI_BASE = new THREE.Color(0xa7a9b4);
const TI_STRAW = new THREE.Color(0xc8a060);
const TI_BLUE = new THREE.Color(0x6c62c8);

type Finish = 'chrome' | 'titanium';

/** One pipe: its mouth (x, y, z), radius, length, yaw (rad, 0 = straight back) and look. */
interface Pipe {
  x: number;
  y: number;
  z: number;
  radius: number;
  length: number;
  segments: number;
  yaw?: number;
  finish?: Finish;
  /** A dark disc a little way up the pipe, so a big bore does not show daylight. */
  plug?: boolean;
}

const LAYOUTS: Readonly<Record<string, readonly Pipe[]>> = {
  'exhaustTips.single': [{ x: -0.36, y: 0.3, z: 2.22, radius: 0.055, length: 0.2, segments: 10 }],
  'exhaustTips.cannon': [{ x: 0, y: 0.335, z: 2.27, radius: 0.1, length: 0.28, segments: 14, plug: true }],
  'exhaustTips.quad': [-0.43, -0.27, 0.27, 0.43].map((x) => ({ x, y: 0.3, z: 2.24, radius: 0.055, length: 0.2, segments: 8 })),
  // A drift-car side dump: one pipe out of the right-hand rear corner, angled outward.
  'exhaustTips.side': [{ x: 0.76, y: 0.235, z: 2.2, radius: 0.06, length: 0.3, segments: 10, yaw: 0.35, plug: true }],
  'exhaustTips.titanium': [-0.3, 0.3].map((x) => ({
    x,
    y: 0.31,
    z: 2.26,
    radius: 0.082,
    length: 0.26,
    segments: 12,
    finish: 'titanium' as const,
    plug: true,
  })),
};

/** Where the flame comes out, per tip part. Unknown ids get stock's. */
export function exhaustOutlets(partId: PartId): readonly ExhaustOutlet[] {
  const layout = LAYOUTS[partId];
  if (!layout) return STOCK_OUTLETS;
  return layout.map((p) => ({ x: p.x, y: p.y, z: p.z + 0.005, radius: p.radius * 0.92 }));
}

/** Dual round tips: a chrome pipe and a dark rim each side. */
function stock(): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (const sign of [-1, 1]) {
    const tip = new THREE.CylinderGeometry(0.078, 0.078, 0.2, 10, 1, true);
    tip.rotateX(Math.PI / 2);
    tip.translate(sign * 0.34, 0.33, 2.14);
    out.push(part(tip, BODY_COLORS.CHROME));
    const rim = new THREE.RingGeometry(0.05, 0.078, 10, 1);
    rim.translate(sign * 0.34, 0.33, 2.24);
    out.push(part(rim, BODY_COLORS.CARBON_DARK));
  }
  return out;
}

/** A pipe, its rim at the mouth and (optionally) a plug inside, built along +Z then aimed. */
function pipe(p: Pipe): THREE.BufferGeometry[] {
  const aim = (g: THREE.BufferGeometry): THREE.BufferGeometry => {
    if (p.yaw) g.rotateY(p.yaw);
    g.translate(p.x, p.y, p.z);
    return g;
  };
  const out: THREE.BufferGeometry[] = [];
  const body = new THREE.CylinderGeometry(p.radius, p.radius * 0.92, p.length, p.segments, 1, true);
  body.rotateX(Math.PI / 2); // +Y (top radius) → +Z: the mouth is the full-size end
  body.translate(0, 0, -p.length / 2);
  const tube = part(aim(body), BODY_COLORS.CHROME);
  if (p.finish === 'titanium') {
    // Colour by distance back from the mouth (0 at the mouth, 1 at the far end).
    const dirX = Math.sin(p.yaw ?? 0);
    const dirZ = Math.cos(p.yaw ?? 0);
    recolor(tube, (x, _y, z, c) => {
      const t = THREE.MathUtils.clamp(((p.x - x) * dirX + (p.z - z) * dirZ) / p.length, 0, 1);
      if (t < 0.45) c.copy(TI_BLUE).lerp(TI_STRAW, t / 0.45);
      else c.copy(TI_STRAW).lerp(TI_BASE, (t - 0.45) / 0.55);
    });
  }
  out.push(tube);
  const rim = new THREE.RingGeometry(p.radius * 0.7, p.radius, p.segments, 1);
  out.push(part(aim(rim), p.finish === 'titanium' ? TI_BLUE.getHex() : BODY_COLORS.CARBON_DARK));
  if (p.plug) {
    const plug = new THREE.CircleGeometry(p.radius * 0.72, p.segments);
    plug.translate(0, 0, -0.05);
    out.push(part(aim(plug), BODY_COLORS.GRILLE));
  }
  return out;
}

export const exhaustTipsSlot: SlotModule = {
  slot: 'exhaustTips',
  variants: [
    'exhaustTips.stock',
    'exhaustTips.single',
    'exhaustTips.cannon',
    'exhaustTips.quad',
    'exhaustTips.side',
    'exhaustTips.titanium',
  ],
  build(partId) {
    const layout = LAYOUTS[partId];
    if (!layout) return stock();
    return layout.flatMap(pipe);
  },
};
