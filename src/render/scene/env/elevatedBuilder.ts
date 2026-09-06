import type { FenceDef, PillarDef, RibbonDef } from '../../../world/cityPlan';
import { isOnPath, segmentCount } from '../../../world/track';
import { PAL, zoneAccent } from './palette';
import { groundGlow, halo, type EnvBuilders } from './builders';
import { signCell } from './textures';

/**
 * Viaducts: the parts of an elevated ribbon that are not the asphalt itself (which
 * `trackBuilder.ts` lays at the samples' own height).
 *
 * Per segment off the ground: a slab skirt either side, banded light-to-dark down its height
 * and capped by a pale fascia with a marker line let into it — that top edge is what keeps a
 * deck from reading as a black cut-out against the towers behind it — then an underside,
 * and under it the structure that makes the underside a place rather than a ceiling — an
 * edge beam under each fascia, a centre beam, two pipe runs, a lit strip along every bay,
 * and a hanging sign now and then. Where the deck is too low to drive under, the skirt runs
 * to the ground and reads as an embankment.
 *
 * Under it: the columns the plan placed (a pair with a cross beam and a barrier ring at the
 * foot), the fences between them, a concrete floor with pools of light, and stalls leaning
 * on the fences — the ground floor of the highway. Everything lands in the shared
 * per-material builders; no new draw calls.
 */

/** Slab thickness (m). */
export const DECK_THICKNESS = 1.4;
/** Below this deck height nothing drives under: the skirt runs to the ground. */
const EMBANKMENT_BELOW = 4.5;
/** A segment this low is street, not viaduct. */
const GROUND_BELOW = 0.12;

export function buildViaducts(b: EnvBuilders, rng: () => number): void {
  for (const rb of b.plan.ribbons) if (rb.elevated) buildDeck(b, rb, rng);
  for (const p of b.plan.pillars ?? []) buildPillar(b, p, rng);
  for (const f of b.plan.fences ?? []) buildFence(b, f, rng);
}

/** True when (x, z) is on a street at ground level (not merely under a deck). */
function onStreet(b: EnvBuilders, x: number, z: number, pad: number): boolean {
  for (const rb of b.plan.ribbons) {
    if (rb.elevated) continue;
    if (isOnPath(rb.path, x, z, pad)) return true;
  }
  return false;
}

function buildDeck(b: EnvBuilders, rb: RibbonDef, rng: () => number): void {
  const samples = rb.path.samples;
  const segs = segmentCount(rb.path);
  const wet = b.plan.water;
  let bay = 0;
  let sinceSign = 30;
  for (let i = 0; i < segs; i++) {
    const a = samples[i];
    const c = samples[(i + 1) % samples.length];
    if (a.y < GROUND_BELOW && c.y < GROUND_BELOW) continue;
    const alx = a.x + a.tz * a.halfWidth;
    const alz = a.z - a.tx * a.halfWidth;
    const arx = a.x - a.tz * a.halfWidth;
    const arz = a.z + a.tx * a.halfWidth;
    const clx = c.x + c.tz * c.halfWidth;
    const clz = c.z - c.tx * c.halfWidth;
    const crx = c.x - c.tz * c.halfWidth;
    const crz = c.z + c.tx * c.halfWidth;
    const overWater = !!wet && (a.z > wet.quayZ || c.z > wet.quayZ);
    const groundY = overWater ? -3 : -0.3;
    // The slab bottom; an embankment's skirt goes all the way down.
    const bottomA = a.y < EMBANKMENT_BELOW ? groundY : a.y - DECK_THICKNESS;
    const bottomC = c.y < EMBANKMENT_BELOW ? groundY : c.y - DECK_THICKNESS;
    const topA = a.y;
    const topC = c.y;
    const mx = (a.x + c.x) / 2;
    const mz = (a.z + c.z) / 2;
    const my = (a.y + c.y) / 2;
    const len = Math.hypot(c.x - a.x, c.z - a.z);
    const dx = (c.x - a.x) / (len || 1);
    const dz = (c.z - a.z) / (len || 1);
    const nx = -dz;
    const nz = dx;

    // Per-segment wear, walked off the segment index so it does not disturb `rng`: two
    // consecutive casting panels sit a few percent apart in tone, which is what makes the
    // deck's joints — and so its length — legible from the road below.
    const wear = 0.94 + ((i * 5) % 7) * 0.024;
    // The face is read as three tones down its height: a pale fascia at the parapet where
    // the deck's own lighting spills over, the skirt under it, and, on an embankment only,
    // a foot that falls away into the dark. Concrete, not shadow — the slab is the biggest
    // silhouette in the city and has to catch enough light to show its edges.
    const fasciaA = topA - 0.55;
    const fasciaC = topC - 0.55;
    const upperA = Math.max(bottomA, fasciaA - 1.8);
    const upperC = Math.max(bottomC, fasciaC - 1.8);
    // Skirts: left face outward is -normal (the left side), right face outward is +normal.
    if (upperA > bottomA + 0.05 || upperC > bottomC + 0.05) {
      b.concrete.color(PAL.concrete, 0.95 * wear);
      b.concrete.quad(clx, bottomC, clz, alx, bottomA, alz, alx, upperA, alz, clx, upperC, clz);
      b.concrete.quad(arx, bottomA, arz, crx, bottomC, crz, crx, upperC, crz, arx, upperA, arz);
    }
    b.concrete.color(PAL.curb, 1.0 * wear);
    b.concrete.quad(clx, upperC, clz, alx, upperA, alz, alx, fasciaA, alz, clx, fasciaC, clz);
    b.concrete.quad(arx, upperA, arz, crx, upperC, crz, crx, fasciaC, crz, arx, fasciaA, arz);
    // Fascia: a lighter band at the top edge, so the deck edge draws a clean line at night.
    // It stands 2 cm PROUD of the skirt; inset, the slab simply swallows it.
    const fx = a.tz * 0.02;
    const fz = -a.tx * 0.02;
    b.concrete.color(PAL.curb, 1.75 * wear);
    b.concrete.quad(clx + fx, fasciaC, clz + fz, alx + fx, fasciaA, alz + fz, alx + fx, topA + 0.02, alz + fz, clx + fx, topC + 0.02, clz + fz);
    b.concrete.quad(arx - fx, fasciaA, arz - fz, crx - fx, fasciaC, crz - fz, crx - fx, topC + 0.02, crz - fz, arx - fx, topA + 0.02, arz - fz);
    // A pale marker line let into each fascia, running the whole length of the deck: the
    // highway draws its own silhouette instead of reading as a hole in the skyline.
    const lx = a.tz * 0.05;
    const lz = -a.tx * 0.05;
    b.neon.color(PAL.neonWhite, 0.24);
    b.neon.quad(clx + lx, topC - 0.48, clz + lz, alx + lx, topA - 0.48, alz + lz, alx + lx, topA - 0.3, alz + lz, clx + lx, topC - 0.3, clz + lz);
    b.neon.quad(arx - lx, topA - 0.48, arz - lz, crx - lx, topC - 0.48, crz - lz, crx - lx, topC - 0.3, crz - lz, arx - lx, topA - 0.3, arz - lz);

    if (a.y < EMBANKMENT_BELOW && c.y < EMBANKMENT_BELOW) continue;
    const bottom = my - DECK_THICKNESS;
    // Underside, facing down: left-forward-right winding, the mirror of the road surface's,
    // or the slab is invisible from under the deck.
    b.concrete.color(PAL.concrete, 0.82 * wear);
    b.concrete.quad(alx, bottomA, alz, clx, bottomC, clz, crx, bottomC, crz, arx, bottomA, arz);
    // The structure under the slab: an edge beam under each fascia, a centre beam, and pipes.
    // Lighter than the soffit they hang off, so the ribs read from the street below.
    b.concrete.color(PAL.curb, 0.8);
    b.concrete.orientedBox(mx + nx * (a.halfWidth - 0.7), mz + nz * (a.halfWidth - 0.7), dx, dz, len + 0.05, 0.9, bottom - 0.9, bottom, { bottom: true });
    b.concrete.orientedBox(mx - nx * (a.halfWidth - 0.7), mz - nz * (a.halfWidth - 0.7), dx, dz, len + 0.05, 0.9, bottom - 0.9, bottom, { bottom: true });
    b.concrete.color(PAL.concrete, 0.95);
    b.concrete.orientedBox(mx, mz, dx, dz, len + 0.05, 1.1, bottom - 1.1, bottom, { bottom: true });
    b.props.color(PAL.metalDark, 0.9);
    for (const off of [-a.halfWidth * 0.42, a.halfWidth * 0.36]) {
      b.props.tube(a.x + nx * off, bottomA - 0.45, a.z + nz * off, c.x + nx * off, bottomC - 0.45, c.z + nz * off, 0.3);
    }
    // Lit strip along every bay, and a lit pipe on every other: the glow under the highway.
    bay++;
    const zone = a.zone;
    const accents = zoneAccent(zone);
    const strip = bay % 2 === 0 ? PAL.neonCyan : accents[Math.floor(rng() * accents.length)];
    b.neon.color(strip, 0.3);
    b.neon.tube(alx, bottomA + 0.3, alz, clx, bottomC + 0.3, clz, 0.16);
    b.neon.tube(arx, bottomA + 0.3, arz, crx, bottomC + 0.3, crz, 0.16);
    // Every other bay, a faint wash down the outside of the skirt: the marker line above it
    // pooling on the concrete, so the face is lit rather than merely a lighter grey.
    if (bay % 2 === 0) {
      halo(b, mx - nx * (a.halfWidth + 0.25), my - 1.1, mz - nz * (a.halfWidth + 0.25), len * 2.4, 3.4, Math.atan2(-nx, -nz), PAL.neonWhite, 0.05);
      halo(b, mx + nx * (a.halfWidth + 0.25), my - 1.1, mz + nz * (a.halfWidth + 0.25), len * 2.4, 3.4, Math.atan2(nx, nz), PAL.neonWhite, 0.05);
    }
    if (bay % 2 === 1) {
      const pipe = rng() < 0.6 ? PAL.neonCyan : PAL.neonAmber;
      b.neonFlicker.color(pipe, 0.35);
      b.neonFlicker.tube(a.x + nx * a.halfWidth * 0.1, bottomA - 0.5, a.z + nz * a.halfWidth * 0.1, c.x + nx * a.halfWidth * 0.1, bottomC - 0.5, c.z + nz * a.halfWidth * 0.1, 0.2);
    }
    // A sign hanging under the deck, edge-on, every ~70 m: reads along the corridor.
    sinceSign += len;
    if (sinceSign > 70 && !overWater) {
      sinceSign = 0;
      const uv = signCell(Math.floor(rng() * 16));
      const rot = Math.atan2(dx, dz);
      const sy = bottom - 2.4;
      const sx = mx + nx * (rng() - 0.5) * a.halfWidth;
      const sz = mz + nz * (rng() - 0.5) * a.halfWidth;
      b.props.color(PAL.metalDark, 0.8);
      b.props.box(sx, bottom - 0.6, sz, 0.2, 1.2, 0.2);
      b.signs.panel(sx, sy, sz, 2.4, 2.4, rot, uv.u0, uv.v0, uv.u1, uv.v1);
      b.signs.panel(sx, sy, sz, 2.4, 2.4, rot + Math.PI, uv.u0, uv.v0, uv.u1, uv.v1);
      halo(b, sx, sy, sz, 7, 5, rot, PAL.neonMagenta, 0.14);
    }
    // The floor under the deck and its pools of light — not on a street, not in the bay.
    if (!overWater && !onStreet(b, mx, mz, 2)) {
      const fw = a.halfWidth + 1.2;
      b.concrete.color(PAL.ground, 1.25);
      b.concrete.quad(a.x + nx * fw, 0.02, a.z + nz * fw, a.x - nx * fw, 0.02, a.z - nz * fw, c.x - nx * fw, 0.02, c.z - nz * fw, c.x + nx * fw, 0.02, c.z + nz * fw);
      if (bay % 2 === 0) {
        const pool = zone === 'corporate' ? PAL.neonCyan : rng() < 0.55 ? PAL.neonAmber : PAL.neonMagenta;
        groundGlow(b, mx, mz, a.halfWidth * 2.4, 14, pool, 0.1, 0.05);
      }
    }
  }
}

function buildPillar(b: EnvBuilders, p: PillarDef, rng: () => number): void {
  const nx = -p.tz;
  const nz = p.tx;
  const out = p.halfWidth - 1.6;
  const top = p.y - DECK_THICKNESS;
  const base = p.wet ? -6 : -0.4;
  // Two columns, with a barrier ring at the foot. Lighter than the slab, so the forest of
  // columns reads from the road, and one of each pair carries a lit edge.
  const litSide = rng() < 0.5 ? -1 : 1;
  for (const side of [-1, 1]) {
    const cx = p.x + nx * out * side;
    const cz = p.z + nz * out * side;
    b.concrete.color(PAL.curb, 1.2 + rng() * 0.2);
    b.concrete.box(cx, (base + top) / 2, cz, 1.7, top - base, 1.7, { top: false });
    if (side === litSide && !p.wet) {
      const c = rng() < 0.6 ? PAL.neonCyan : rng() < 0.5 ? PAL.neonAmber : PAL.neonMagenta;
      b.neon.color(c, 0.3);
      // On the face that looks along the road, so it is seen coming.
      b.neon.tube(cx - p.tx * 0.9, base + 1.4, cz - p.tz * 0.9, cx - p.tx * 0.9, top - 0.6, cz - p.tz * 0.9, 0.12);
    }
    b.concrete.color(p.wet ? PAL.night : PAL.curb, 0.95);
    b.concrete.box(cx, base + 0.45, cz, 2.6, 0.9, 2.6, { top: true });
    if (!p.wet) {
      // Hazard line round the foot, so the column reads from the road.
      b.neon.color(rng() < 0.5 ? PAL.neonAmber : PAL.neonMagenta, 0.4);
      b.neon.tube(cx - 1.3, base + 0.95, cz - 1.3, cx + 1.3, base + 0.95, cz - 1.3, 0.1);
      b.neon.tube(cx - 1.3, base + 0.95, cz + 1.3, cx + 1.3, base + 0.95, cz + 1.3, 0.1);
      b.neon.tube(cx - 1.3, base + 0.95, cz - 1.3, cx - 1.3, base + 0.95, cz + 1.3, 0.1);
      b.neon.tube(cx + 1.3, base + 0.95, cz - 1.3, cx + 1.3, base + 0.95, cz + 1.3, 0.1);
    }
  }
  // Cross beam under the slab, the full width of the deck, and a brace to each column.
  b.concrete.color(PAL.concrete, 0.72);
  b.concrete.orientedBox(p.x, p.z, nx, nz, out * 2 + 1.7, 1.6, top - 1.3, top, { bottom: true });
  b.concrete.color(PAL.concrete, 0.6);
  for (const side of [-1, 1]) {
    const cx = p.x + nx * out * side;
    const cz = p.z + nz * out * side;
    b.concrete.tube(cx + nx * 0.6 * -side, top - 6, cz + nz * 0.6 * -side, cx - nx * 4 * side, top - 1.3, cz - nz * 4 * side, 0.5);
  }
  // The odd pillar carries a strip of light under the beam.
  if (rng() < 0.35) {
    const c = rng() < 0.5 ? PAL.neonCyan : rng() < 0.5 ? PAL.neonMagenta : PAL.neonAmber;
    b.neonPulse.color(c, 0.7);
    b.neonPulse.tube(p.x - nx * out, top - 0.7, p.z - nz * out, p.x + nx * out, top - 0.7, p.z + nz * out, 0.2);
    halo(b, p.x, top - 0.7, p.z, out * 2, 3, Math.atan2(-p.tx, -p.tz), c, 0.1);
    if (!p.wet) groundGlow(b, p.x, p.z, out * 2.6, 16, c, 0.09);
  }
}

/**
 * Chain-link between two columns: posts, a dark mesh panel, a top rail, and on some a poster
 * or a stall leaning against it with its own warm light. The stall sits in the fenced bay,
 * on the far side of the wall from the street, so nothing here is ever driven into.
 */
function buildFence(b: EnvBuilders, f: FenceDef, rng: () => number): void {
  let dx = f.bx - f.ax;
  let dz = f.bz - f.az;
  const len = Math.hypot(dx, dz);
  if (len < 3) return;
  dx /= len;
  dz /= len;
  const cx = (f.ax + f.bx) / 2;
  const cz = (f.az + f.bz) / 2;
  const h = 2.2;
  b.props.color(PAL.metalDark, 0.55);
  b.props.orientedBox(cx, cz, dx, dz, len - 2.8, 0.06, 0.05, h);
  b.props.color(PAL.metalDark, 0.9);
  b.props.orientedBox(cx, cz, dx, dz, len - 2.8, 0.14, h, h + 0.14);
  for (const t of [-0.5, 0.5]) {
    b.props.box(cx + dx * len * t * 0.86, h / 2, cz + dz * len * t * 0.86, 0.16, h, 0.16);
  }
  const r = rng();
  // Which side the deck's centre is: the stall goes there, into the bay.
  const nx = -dz;
  const nz = dx;
  if (r < 0.3) {
    // A poster on the mesh.
    const uv = signCell(Math.floor(rng() * 16));
    const rot = Math.atan2(nx, nz);
    b.signs.panel(cx + nx * 0.08, 1.35, cz + nz * 0.08, 2.2, 1.6, rot, uv.u0, uv.v0, uv.u1, uv.v1);
    b.signs.panel(cx - nx * 0.08, 1.35, cz - nz * 0.08, 2.2, 1.6, rot + Math.PI, uv.u0, uv.v0, uv.u1, uv.v1);
    halo(b, cx, 1.35, cz, 6, 4, rot, PAL.neonMagenta, 0.12);
  } else if (r < 0.55) {
    // A stall: a counter box, an awning, an amber tube under it, crates beside it.
    const inward = fenceInward(b, f);
    const sx = cx + nx * 1.6 * inward;
    const sz = cz + nz * 1.6 * inward;
    b.props.color(PAL.rust, 1.05);
    b.props.orientedBox(sx, sz, dx, dz, 3.2, 2.0, 0.05, 2.3);
    b.props.color(PAL.rust, 0.85);
    b.props.orientedBox(sx + nx * 0.6 * inward, sz + nz * 0.6 * inward, dx, dz, 3.8, 3.2, 2.3, 2.45);
    const warm = rng() < 0.7 ? PAL.neonAmber : PAL.neonPink;
    b.neon.color(warm, 0.8);
    b.neon.tube(sx - dx * 1.7 + nx * 1.6 * inward, 2.2, sz - dz * 1.7 + nz * 1.6 * inward, sx + dx * 1.7 + nx * 1.6 * inward, 2.2, sz + dz * 1.7 + nz * 1.6 * inward, 0.14);
    halo(b, sx + nx * 1.8 * inward, 1.5, sz + nz * 1.8 * inward, 5, 3.5, Math.atan2(nx * inward, nz * inward), warm, 0.18);
    groundGlow(b, sx + nx * 2.6 * inward, sz + nz * 2.6 * inward, 9, 9, warm, 0.14, 0.06);
    b.props.color(PAL.metalDark, 0.8);
    b.props.box(sx + dx * 2.4, 0.5, sz + dz * 2.4, 0.9, 0.9, 0.9);
    b.props.box(sx + dx * 2.4, 1.3, sz + dz * 2.4, 0.7, 0.7, 0.7);
  } else if (r < 0.62) {
    // A hedge along the fence, on the street side.
    const inward = fenceInward(b, f);
    const hl = Math.min(len - 4, 3 + rng() * 4);
    b.props.color(PAL.foliage, 0.9 + rng() * 0.3);
    b.props.orientedBox(cx - nx * 0.8 * inward, cz - nz * 0.8 * inward, dx, dz, hl, 1.0, 0.05, 1.1 + rng() * 0.4);
  } else if (r < 0.74) {
    // Junk against the fence.
    const inward = fenceInward(b, f);
    for (let i = 0; i < 3; i++) {
      const t = (rng() - 0.5) * (len - 4);
      b.props.color(rng() < 0.5 ? PAL.rust : PAL.metalDark, 0.7 + rng() * 0.5);
      b.props.box(cx + dx * t + nx * 0.7 * inward, 0.45, cz + dz * t + nz * 0.7 * inward, 0.7, 0.9, 0.7);
    }
  }
  if (rng() < 0.4) {
    b.neon.color(PAL.neonCyan, 0.22);
    b.neon.tube(f.ax + dx * 1.4, h + 0.2, f.az + dz * 1.4, f.bx - dx * 1.4, h + 0.2, f.bz - dz * 1.4, 0.08);
  }
}

/** +1 when the deck's centre is on the fence's +normal side, else -1: which way is "into the bay". */
function fenceInward(b: EnvBuilders, f: FenceDef): number {
  const cx = (f.ax + f.bx) / 2;
  const cz = (f.az + f.bz) / 2;
  const dx = f.bx - f.ax;
  const dz = f.bz - f.az;
  const nx = -dz;
  const nz = dx;
  // Probe both sides: the one under a deck is inward.
  for (const rb of b.plan.ribbons) {
    if (!rb.elevated) continue;
    if (isOnPath(rb.path, cx + nx * 0.2, cz + nz * 0.2, 0)) return 1;
    if (isOnPath(rb.path, cx - nx * 0.2, cz - nz * 0.2, 0)) return -1;
  }
  return 1;
}
