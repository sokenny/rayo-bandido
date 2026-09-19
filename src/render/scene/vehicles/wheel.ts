import * as THREE from 'three';
import { box, mergeParts, part } from './geometryKit';

/**
 * THE WHEEL: tyre, barrel and one of eight rim faces, all vertex-coloured into ONE geometry so
 * the four wheels share one geometry, one material and (via InstancedMesh) one draw call.
 *
 * The returned geometry is centred on the origin with the axle along X, matching the
 * placeholder convention (`spin.rotation.x` rolls the wheel). The rim face is built on BOTH
 * sides of the wheel: the same geometry is instanced on the left (-X) and the right (+X), and
 * a mirrored instance would flip the winding.
 *
 * `buildWheelGeometry(radius, width, segments)` with no `look` is today's JDM dish exactly —
 * dark tyre, gunmetal barrel, polished lip, five graphite spokes and a magenta centre cap — and
 * the rivals, the meet and the props call it that way. The workshop (`wheelRig.ts`) passes a
 * `look`: which rim design, the rim colour (`CarLoadout.wheels.rimColor`, a palette hex) and
 * how much of the fixed outer radius is rim rather than tyre sidewall.
 *
 * Budget: every design stays under ~1,000 triangles (stock is 504), segments 16.
 */

/** Every rim design, by the part id the catalogue sells (`src/content/parts/wheels.ts`). */
export const RIM_DESIGNS = [
  'rims.stock',
  'rims.hart-10',
  'rims.mesh',
  'rims.dish-3p',
  'rims.twin-6',
  'rims.turbofan',
  'rims.concave-5',
  'rims.steelie',
] as const;
export type RimDesign = (typeof RIM_DESIGNS)[number];

export function isRimDesign(id: unknown): id is RimDesign {
  return typeof id === 'string' && (RIM_DESIGNS as readonly string[]).includes(id);
}

export interface WheelLook {
  /** Unknown ids draw stock. */
  design: RimDesign;
  /** The rim colour as `0xrrggbb` (sRGB, like every baked vertex colour). Stock: graphite. */
  rimColor: number;
  /** Rim radius over tyre radius. Stock 0.66; bigger = thinner sidewall. */
  rimRatio: number;
}

/** Today's wheel. `rimColor` is the palette's `graphite`, which IS the stock spoke colour. */
export const STOCK_WHEEL_LOOK: Readonly<WheelLook> = { design: 'rims.stock', rimColor: 0x8b93a4, rimRatio: 0.66 };

/* Fixed colours. */
const TREAD = 0x0a0a0d;
const SHOULDER = 0x0d0d11;
const SIDEWALL = 0x131318;
const POLISHED = 0xc2cbdb;
const POLISHED_DIM = 0x8e97a8;
const FACE_DARK = 0x1a1d24;
const HUB = 0x23262f;
const BARREL = 0x2b2f3a;
const CAP_MAGENTA = 0xff2fa8;
const WELL = 0x0e0f13;

/** The stock tyre width (m), what `extraWidth` is measured from. Same as `WHEEL_WIDTH`. */
const STOCK_WIDTH = 0.26;
/**
 * How deep a rim face may sit behind the tyre's outer plane (m). The hull has no wheel wells:
 * its side runs through the wheels at |x| ≈ 0.87 (front) and 0.89–0.90 (rear) at axle height,
 * so only the outer ~5 cm of a stock-track wheel is ever seen. Every design keeps its face in
 * front of that; a deeper face would show the bodywork through the spokes.
 */
const DEPTH = 0.036;

export function buildWheelGeometry(
  radius: number,
  width: number,
  segments = 16,
  look: Readonly<WheelLook> = STOCK_WHEEL_LOOK,
): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const rimRadius = radius * look.rimRatio;
  const halfW = width / 2;

  // Tyre tread (axis Y by default -> rotate to axis Z).
  const tread = new THREE.CylinderGeometry(radius, radius, width * 0.94, segments, 1, true);
  tread.rotateX(Math.PI / 2);
  parts.push(part(tread, TREAD));

  // Slightly pinched shoulders so the tyre does not read as a plain cylinder.
  for (const sign of [-1, 1]) {
    const shoulder = new THREE.CylinderGeometry(radius, radius * 0.965, width * 0.03, segments, 1, true);
    shoulder.rotateX(Math.PI / 2);
    if (sign < 0) shoulder.rotateY(Math.PI);
    shoulder.translate(0, 0, sign * (width * 0.485));
    parts.push(part(shoulder, SHOULDER));
  }

  const ctx: RimContext = {
    radius,
    rimR: rimRadius,
    hubR: radius * 0.17,
    halfW,
    segments,
    rim: readableRim(look.rimColor),
    extraWidth: Math.max(0, width - STOCK_WIDTH),
  };
  const design = isRimDesign(look.design) ? look.design : 'rims.stock';
  for (const sign of [-1, 1] as const) {
    // Sidewall.
    const sidewall = new THREE.RingGeometry(rimRadius, radius * 0.965, segments, 1);
    if (sign < 0) sidewall.rotateY(Math.PI);
    sidewall.translate(0, 0, sign * halfW);
    parts.push(part(sidewall, SIDEWALL));

    FACES[design](parts, sign, ctx);
  }

  // Barrel closing the gap between the two rim faces.
  const barrel = new THREE.CylinderGeometry(rimRadius * 0.9, rimRadius * 0.9, width * 0.9, segments, 1, true);
  barrel.rotateX(Math.PI / 2);
  parts.push(part(barrel, BARREL));

  const merged = mergeParts(parts);
  // Axle Z -> axle X.
  merged.rotateY(Math.PI / 2);
  return merged;
}

/* ------------------------------------------------------------------ rim faces */

interface RimContext {
  radius: number;
  rimR: number;
  hubR: number;
  halfW: number;
  segments: number;
  /** The rim colour, 0xrrggbb. */
  rim: number;
  /** Tyre width beyond stock (m); a dish deepens with it. */
  extraWidth: number;
}

type FaceBuilder = (parts: THREE.BufferGeometry[], sign: 1 | -1, c: RimContext) => void;

/**
 * Each builder draws one side's rim face for the +Z side and turns it round for -Z with
 * `rotateY(π)` (a rotation, never a mirror, so the winding stays outward).
 */
const FACES: Record<RimDesign, FaceBuilder> = {
  /** Today's dish: polished lip, dark face, five graphite spokes, magenta cap. Do not change. */
  'rims.stock'(parts, sign, c) {
    const { rimR: rimRadius, hubR: hubRadius, halfW, radius } = c;
    const lip = new THREE.RingGeometry(rimRadius * 0.9, rimRadius, c.segments, 1);
    if (sign < 0) lip.rotateY(Math.PI);
    lip.translate(0, 0, sign * (halfW - 0.004));
    parts.push(part(lip, POLISHED));

    const face = new THREE.CircleGeometry(rimRadius * 0.9, c.segments);
    if (sign < 0) face.rotateY(Math.PI);
    face.translate(0, 0, sign * (halfW - 0.055));
    parts.push(part(face, FACE_DARK));

    for (let i = 0; i < 5; i++) {
      const angle = (i / 5) * Math.PI * 2 + Math.PI / 10;
      const length = rimRadius * 0.9 - hubRadius;
      const spoke = box(radius * 0.2, length, 0.03);
      spoke.translate(0, hubRadius + length / 2, sign * (halfW - 0.04));
      spoke.rotateZ(angle);
      parts.push(part(spoke, c.rim));
    }

    const hub = new THREE.CylinderGeometry(hubRadius, hubRadius, 0.05, 10, 1, false);
    hub.rotateX(Math.PI / 2);
    hub.translate(0, 0, sign * (halfW - 0.03));
    parts.push(part(hub, HUB));

    const cap = new THREE.CircleGeometry(hubRadius * 0.55, 8);
    if (sign < 0) cap.rotateY(Math.PI);
    cap.translate(0, 0, sign * (halfW - 0.002));
    parts.push(part(cap, CAP_MAGENTA));
  },

  /** Racing Hart style: ten thin straight spokes, a shallow dish and a thin polished lip. */
  'rims.hart-10'(parts, sign, c) {
    const { rimR, hubR, halfW } = c;
    parts.push(side(ring(rimR * 0.9, rimR, halfW - 0.004, c.segments, POLISHED), sign));
    parts.push(side(disc(rimR * 0.9, halfW - DEPTH, c.segments, mix(c.rim, WELL, 0.85)), sign));
    for (let i = 0; i < 10; i++) {
      const s = spoke({ r0: hubR * 0.85, r1: rimR * 0.91, w0: 0.02, w1: 0.028, z0: halfW - 0.026, z1: halfW - 0.015, t: 0.014 });
      s.rotateZ((i / 10) * Math.PI * 2);
      parts.push(side(part(s, c.rim), sign));
    }
    parts.push(side(hub(hubR * 1.15, halfW - 0.022, 0.03, c.rim), sign));
    parts.push(side(disc(hubR * 0.6, halfW - 0.0065, 8, POLISHED), sign));
  },

  /** BBS-style cross mesh: sixteen thin bars in a lattice inside a wide polished lip. */
  'rims.mesh'(parts, sign, c) {
    const { rimR, hubR, halfW } = c;
    parts.push(side(ring(rimR * 0.84, rimR, halfW - 0.004, c.segments, POLISHED), sign));
    parts.push(side(disc(rimR * 0.84, halfW - DEPTH, c.segments, mix(c.rim, WELL, 0.9)), sign));
    // The outer ring the bars meet: rim coloured, just inside the lip.
    parts.push(side(ring(rimR * 0.77, rimR * 0.845, halfW - 0.018, c.segments, c.rim), sign));
    const n = 8;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      for (const turn of [-1, 1]) {
        const z = halfW - 0.026 + (turn > 0 ? 0.003 : 0);
        const b = bar(hubR * 0.95, a, rimR * 0.8, a + turn * 0.62, 0.014, z, z + 0.004, 0.012);
        parts.push(side(part(b, c.rim), sign));
      }
    }
    parts.push(side(hub(hubR * 1.05, halfW - 0.024, 0.03, c.rim), sign));
    // Bolted centre: a polished nut ring and a dark cap.
    parts.push(side(ring(hubR * 0.5, hubR * 0.8, halfW - 0.0085, 10, POLISHED), sign));
    parts.push(side(disc(hubR * 0.5, halfW - 0.009, 8, HUB), sign));
  },

  /**
   * Three-piece deep dish: a big polished lip, a polished dish wall, eight spokes at the bottom
   * of the dish, assembly bolts. The dish deepens with the wheel's extra width, as a real one does.
   */
  'rims.dish-3p'(parts, sign, c) {
    const { rimR, hubR, halfW } = c;
    const inner = rimR * 0.72;
    const depth = DEPTH + c.extraWidth;
    const faceZ = halfW - depth;
    parts.push(side(ring(inner, rimR, halfW - 0.004, c.segments, POLISHED), sign));
    // The dish wall, seen from outside the wheel: an open cylinder facing its own axis.
    const wallDepth = depth - 0.004;
    const wall = new THREE.CylinderGeometry(inner, inner, wallDepth, c.segments, 1, true);
    wall.rotateX(Math.PI / 2);
    wall.translate(0, 0, halfW - 0.004 - wallDepth / 2);
    parts.push(side(inward(part(wall, POLISHED_DIM)), sign));
    parts.push(side(disc(inner, faceZ, c.segments, mix(c.rim, WELL, 0.88)), sign));
    for (let i = 0; i < 8; i++) {
      const s = spoke({ r0: hubR * 0.9, r1: inner, w0: 0.028, w1: 0.034, z0: faceZ + 0.011, z1: faceZ + 0.009, t: 0.012 });
      s.rotateZ((i / 8) * Math.PI * 2 + Math.PI / 8);
      parts.push(side(part(s, c.rim), sign));
    }
    // The assembly bolts around the centre section's edge.
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const bolt = new THREE.CircleGeometry(0.0065, 4);
      bolt.translate(Math.cos(a) * inner * 0.92, Math.sin(a) * inner * 0.92, faceZ + 0.016);
      parts.push(side(part(bolt, POLISHED), sign));
    }
    parts.push(side(hub(hubR, faceZ + 0.014, 0.024, c.rim), sign));
    parts.push(side(disc(hubR * 0.55, faceZ + 0.0265, 8, CAP_MAGENTA), sign));
  },

  /** Six twin spokes: pairs of thin spokes, spread wider at the rim, the dark face between them. */
  'rims.twin-6'(parts, sign, c) {
    const { rimR, hubR, halfW } = c;
    parts.push(side(ring(rimR * 0.9, rimR, halfW - 0.004, c.segments, POLISHED), sign));
    parts.push(side(disc(rimR * 0.9, halfW - DEPTH, c.segments, mix(c.rim, WELL, 0.88)), sign));
    for (let i = 0; i < 6; i++) {
      for (const off of [-1, 1]) {
        const s = spoke({ r0: hubR * 0.9, r1: rimR * 0.91, w0: 0.02, w1: 0.024, z0: halfW - 0.026, z1: halfW - 0.015, t: 0.014 });
        s.translate(off * 0.022, 0, 0);
        s.rotateZ((i / 6) * Math.PI * 2 + off * 0.045);
        parts.push(side(part(s, c.rim), sign));
      }
    }
    parts.push(side(hub(hubR * 1.1, halfW - 0.022, 0.03, c.rim), sign));
    parts.push(side(disc(hubR * 0.55, halfW - 0.0065, 8, HUB), sign));
  },

  /** Eighties turbofan: a flat disc covering the face with twelve swept, twisted vanes. */
  'rims.turbofan'(parts, sign, c) {
    const { rimR, hubR, halfW } = c;
    const discZ = halfW - 0.03;
    parts.push(side(ring(rimR * 0.92, rimR, halfW - 0.004, c.segments, POLISHED), sign));
    parts.push(side(disc(rimR * 0.92, discZ, c.segments, mix(c.rim, WELL, 0.25)), sign));
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const vane = bar(rimR * 0.38, a, rimR * 0.88, a + 0.32, 0.05, discZ + 0.008, discZ + 0.008, 0.012, 0.55);
      parts.push(side(part(vane, c.rim), sign));
    }
    // A raised centre: a short dark cone and a polished cap.
    const nose = new THREE.CylinderGeometry(hubR * 0.7, rimR * 0.38, 0.022, 12, 1, true);
    nose.rotateX(Math.PI / 2);
    nose.translate(0, 0, discZ + 0.011);
    parts.push(side(part(nose, mix(c.rim, WELL, 0.45)), sign));
    parts.push(side(disc(hubR * 0.7, discZ + 0.022, 10, POLISHED), sign));
    parts.push(side(disc(hubR * 0.35, discZ + 0.023, 8, HUB), sign));
  },

  /**
   * Five-spoke concave: fat spokes that start flush with the lip and dive to a deep centre;
   * like the dish, deeper on a wider wheel.
   */
  'rims.concave-5'(parts, sign, c) {
    const { rimR, hubR, halfW } = c;
    const depth = DEPTH + 0.004 + c.extraWidth;
    parts.push(side(ring(rimR * 0.94, rimR, halfW - 0.004, c.segments, POLISHED), sign));
    parts.push(side(disc(rimR * 0.94, halfW - depth, c.segments, mix(c.rim, WELL, 0.9)), sign));
    for (let i = 0; i < 5; i++) {
      const s = spoke({ r0: hubR * 0.95, r1: rimR * 0.95, w0: 0.045, w1: 0.085, z0: halfW - depth + 0.012, z1: halfW - 0.011, t: 0.014 });
      s.rotateZ((i / 5) * Math.PI * 2 + Math.PI / 10);
      parts.push(side(part(s, c.rim), sign));
    }
    parts.push(side(hub(hubR * 1.1, halfW - depth + 0.014, 0.024, c.rim), sign));
    parts.push(side(disc(hubR * 0.55, halfW - depth + 0.0265, 8, CAP_MAGENTA), sign));
  },

  /** Drift steelie: a stamped steel face, four wide spokes, dark windows, all rim colour. */
  'rims.steelie'(parts, sign, c) {
    const { rimR, hubR, halfW } = c;
    const faceZ = halfW - 0.026;
    // No polished lip: the steel flange is painted with the rest.
    parts.push(side(ring(rimR * 0.8, rimR, halfW - 0.004, c.segments, c.rim), sign));
    const flange = new THREE.CylinderGeometry(rimR * 0.8, rimR * 0.8, 0.02, c.segments, 1, true);
    flange.rotateX(Math.PI / 2);
    flange.translate(0, 0, halfW - 0.014);
    parts.push(side(inward(part(flange, mix(c.rim, WELL, 0.35))), sign));
    parts.push(side(disc(rimR * 0.8, halfW - DEPTH, c.segments, WELL), sign));
    parts.push(side(disc(rimR * 0.46, faceZ, c.segments, c.rim), sign));
    for (let i = 0; i < 4; i++) {
      const s = spoke({ r0: rimR * 0.4, r1: rimR * 0.82, w0: 0.07, w1: 0.12, z0: faceZ, z1: faceZ + 0.006, t: 0.01 });
      s.rotateZ((i / 4) * Math.PI * 2 + Math.PI / 4);
      parts.push(side(part(s, c.rim), sign));
    }
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const nut = new THREE.CircleGeometry(0.011, 6);
      nut.translate(Math.cos(a) * hubR * 1.1, Math.sin(a) * hubR * 1.1, faceZ + 0.0015);
      parts.push(side(part(nut, POLISHED), sign));
    }
    parts.push(side(disc(hubR * 0.6, faceZ + 0.002, 8, POLISHED), sign));
  },
};

/* ------------------------------------------------------------------ helpers */

/** Turn a +Z-side piece round to the -Z side (a rotation: the winding stays outward). */
function side(g: THREE.BufferGeometry, sign: 1 | -1): THREE.BufferGeometry {
  if (sign < 0) g.rotateY(Math.PI);
  return g;
}

function ring(r0: number, r1: number, z: number, segments: number, color: number): THREE.BufferGeometry {
  const g = new THREE.RingGeometry(r0, r1, segments, 1);
  g.translate(0, 0, z);
  return part(g, color);
}

function disc(r: number, z: number, segments: number, color: number): THREE.BufferGeometry {
  const g = new THREE.CircleGeometry(r, segments);
  g.translate(0, 0, z);
  return part(g, color);
}

/** A closed hub cylinder along Z, its outer face at `z + depth / 2`. */
function hub(r: number, z: number, depth: number, color: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, depth, 10, 1, false);
  g.rotateX(Math.PI / 2);
  g.translate(0, 0, z);
  return part(g, color);
}

/**
 * A tapered spoke along +Y from radius `r0` to `r1`: width `w0` → `w1`, its middle at depth
 * `z0` → `z1` (so a spoke can dive toward the hub), thickness `t`. Flat-shaded.
 */
function spoke(o: { r0: number; r1: number; w0: number; w1: number; z0: number; z1: number; t: number }): THREE.BufferGeometry {
  const g = box(1, 1, 1);
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i);
    const k = pos.getY(i) + 0.5;
    const w = pos.getZ(i);
    pos.setXYZ(i, u * (o.w0 + (o.w1 - o.w0) * k), o.r0 + (o.r1 - o.r0) * k, o.z0 + (o.z1 - o.z0) * k + w * o.t);
  }
  g.deleteAttribute('normal');
  g.computeVertexNormals();
  return g;
}

/**
 * A straight bar from polar point (r0, a0) to (r1, a1) in the face plane, width `w`, thickness
 * `t`, its middle at depth `z0` at the start and `z1` at the end, optionally twisted `twist`
 * rad about its own length (a fan vane).
 */
function bar(r0: number, a0: number, r1: number, a1: number, w: number, z0: number, z1: number, t: number, twist = 0): THREE.BufferGeometry {
  const x0 = Math.cos(a0) * r0;
  const y0 = Math.sin(a0) * r0;
  const x1 = Math.cos(a1) * r1;
  const y1 = Math.sin(a1) * r1;
  const len = Math.hypot(x1 - x0, y1 - y0);
  const g = spoke({ r0: 0, r1: len, w0: w, w1: w, z0: 0, z1: z1 - z0, t });
  if (twist !== 0) g.rotateY(twist);
  // Point +Y along the bar, then move its start to (x0, y0).
  g.rotateZ(Math.atan2(y1 - y0, x1 - x0) - Math.PI / 2);
  g.translate(x0, y0, z0);
  return g;
}

/** Flip a merged-ready part inside out, for walls seen from inside (a dish, a steel flange). */
function inward(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const nrm = g.getAttribute('normal') as THREE.BufferAttribute;
  const col = g.getAttribute('color') as THREE.BufferAttribute;
  for (let t = 0; t < pos.count; t += 3) {
    for (const a of [pos, nrm, col]) {
      for (let c = 0; c < a.itemSize; c++) {
        const tmp = a.getComponent(t + 1, c);
        a.setComponent(t + 1, c, a.getComponent(t + 2, c));
        a.setComponent(t + 2, c, tmp);
      }
    }
  }
  for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, -nrm.getX(i), -nrm.getY(i), -nrm.getZ(i));
  return g;
}

/**
 * A rim colour dark enough to vanish into the tyre (the palette's `black`, `navy`) is lifted to
 * a satin charcoal of its own hue, so a black wheel still reads as a wheel. Anything brighter,
 * the stock graphite included, is returned unchanged.
 */
function readableRim(color: number): number {
  const brightest = Math.max((color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff);
  return brightest >= 0x40 ? color : mix(color, 0x3a3d46, 1 - brightest / 0x40);
}

/** Blend two 0xrrggbb colours in sRGB: `t` = 0 gives `a`, 1 gives `b`. */
export function mix(a: number, b: number, t: number): number {
  const ch = (shift: number): number => {
    const ca = (a >> shift) & 0xff;
    const cb = (b >> shift) & 0xff;
    return Math.round(ca + (cb - ca) * t) & 0xff;
  };
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}
