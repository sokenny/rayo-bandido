import * as THREE from 'three';
import { box, loft, part, type LoftSection } from '../geometryKit';
import { HULL_SECTIONS } from './hull';

/**
 * Small helpers shared by the sold body slots (bumpers, skirts, hood, trunk, spoiler, tips).
 *
 * Nothing here draws a part on its own; it places boxes, follows the hull's surface and
 * mirrors a side. Everything returned has been through `part()`, so it merges like any slot
 * output (`./common.ts`).
 *
 * THE KEEP-OUT ZONES every sold part is drawn around (car frame, metres, stock stance):
 * - Front wheels: centre z = -1.3, radius 0.33, steering up to 0.55 rad sweeps the tyre to
 *   z ≈ -1.66 … -0.95 → nose parts stay at z ≤ -1.72 outboard of x = 0.55, skirts at |z| ≤ 0.9.
 * - Rear wheels: centre z = 1.3 → tail parts stay at z ≥ 1.68 outboard of x = 0.55.
 * - Ride height: the lowest stance step drops the body 0.048 m, so nothing new sits below
 *   y = 0.108 (0.06 m of daylight at the bottom of the range).
 * - Head lamps z ≈ -2.13, x 0.26…0.62, y 0.36…0.57 (lamp + DRL); front neon strip z = -2.27,
 *   y 0.11, |x| ≤ 0.65; sill neon x = ±0.995, y 0.09…0.13, |z| ≤ 0.81; rear neon strip z 2.12…2.14,
 *   y 0.13…0.17, |x| ≤ 0.72; plate (0, 0.53, 2.145) 0.46 × 0.15; reverse lamps x 0.385…0.535,
 *   y 0.365…0.435, z ≥ 2.135; tail lamps y ≥ 0.53.
 * - Exhaust tips (`./exhaustTips.ts`) sit at y ≥ 0.17 and are the only thing allowed through a
 *   rear bumper's face; diffuser fins stay clear of every tip layout's x bands.
 */

/** The hull's cross-section at `z`, interpolated between `HULL_SECTIONS` (clamped at the ends). */
export function hullAt(z: number): LoftSection {
  const s = HULL_SECTIONS;
  if (z <= s[0].z) return { ...s[0], z };
  for (let i = 0; i < s.length - 1; i++) {
    const a = s[i];
    const b = s[i + 1];
    if (z <= b.z) {
      const t = (z - a.z) / (b.z - a.z);
      const l = (u: number, v: number): number => u + (v - u) * t;
      return {
        z,
        bottomY: l(a.bottomY, b.bottomY),
        topY: l(a.topY, b.topY),
        bottomHalfWidth: l(a.bottomHalfWidth, b.bottomHalfWidth),
        topHalfWidth: l(a.topHalfWidth, b.topHalfWidth),
      };
    }
  }
  return { ...s[s.length - 1], z };
}

/** Height of the hull's flat top (hood, roof line of the body, deck) at `z`. */
export function hullTopY(z: number): number {
  return hullAt(z).topY;
}

/** Rotate (Z, then X, then Y) and move a geometry in place. Returns it. */
export function place(
  g: THREE.BufferGeometry,
  x: number,
  y: number,
  z: number,
  rx = 0,
  ry = 0,
  rz = 0,
): THREE.BufferGeometry {
  if (rz) g.rotateZ(rz);
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return g;
}

/** A coloured box, placed. 12 tris. */
export function boxPart(
  w: number,
  h: number,
  d: number,
  color: THREE.ColorRepresentation,
  x: number,
  y: number,
  z: number,
  rx = 0,
  ry = 0,
  rz = 0,
): THREE.BufferGeometry {
  return part(place(box(w, h, d), x, y, z, rx, ry, rz), color);
}

/** Both sides of the car: `fn(-1)` then `fn(1)`, flattened. */
export function mirrored(fn: (sign: -1 | 1) => THREE.BufferGeometry[]): THREE.BufferGeometry[] {
  return [...fn(-1), ...fn(1)];
}

/**
 * A panel laid on the hull's top from `zs[0]` to the last z: at each station its top is
 * `lift(z)` above the hull, its bottom `sink` below it (so it never shows a gap), half as wide
 * as `halfWidth(z)`. Symmetric about x = 0, like everything a loft builds.
 */
export function onHullTop(
  zs: readonly number[],
  halfWidth: (z: number) => number,
  lift: (z: number) => number,
  color: THREE.ColorRepresentation,
  opts: { sink?: number; topInset?: number; base?: (z: number) => number } = {},
): THREE.BufferGeometry {
  const sink = opts.sink ?? 0.015;
  const inset = opts.topInset ?? 0;
  const base = opts.base ?? hullTopY;
  return part(
    loft(
      zs.map((z) => {
        const y = base(z);
        const hw = halfWidth(z);
        return { z, bottomY: y - sink, topY: y + lift(z), bottomHalfWidth: hw, topHalfWidth: hw - inset };
      }),
    ),
    color,
  );
}

/** Overwrite a part's vertex colours with `fn(x, y, z)` (a gradient, a two-tone). Returns it. */
export function recolor(
  g: THREE.BufferGeometry,
  fn: (x: number, y: number, z: number, out: THREE.Color) => void,
): THREE.BufferGeometry {
  const pos = g.getAttribute('position');
  const col = g.getAttribute('color');
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    fn(pos.getX(i), pos.getY(i), pos.getZ(i), c);
    col.setXYZ(i, c.r, c.g, c.b);
  }
  col.needsUpdate = true;
  return g;
}
