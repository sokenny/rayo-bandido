import type { BlockRect, Rect, RoadRect, ZoneId } from '../../../world/cityPlan';
import { PAL, zoneAccent } from './palette';
import { inRect, makeRng, subtractRect, type MeshBuilder, type Rect2 } from './meshBuilder';
import { groundGlow, halo, type EnvBuilders } from './builders';
import { signCell } from './textures';

/**
 * Streets, sidewalks, blocks and skyline, all derived from the rectangles in the plan
 * (`b.plan`). Nothing here invents geometry the simulation does not know about: buildings
 * live strictly inside their collider, roads live strictly outside every one.
 */

/** Metres covered by one asphalt texture tile. */
export const ROAD_TILE = 8;
/** Metres covered by one facade texture tile (horizontally / vertically). */
const FACADE_TILE_W = 12;
const FACADE_TILE_H = 10;
/** Sidewalk ledge kept between the collider edge and the nearest wall. */
const SIDEWALK = 3.4;

/**
 * How far back from a block's collider edge its buildings stand, per axis. A thin plot (the
 * strips a viaduct leaves beside its corridor) keeps at least 6 m of building: the pavement
 * gives way, the pencil tower stays. The greenery reads the same numbers, so nothing is ever
 * planted inside a facade.
 */
export function blockSetback(w: number, d: number): { x: number; z: number } {
  return {
    x: Math.min(SIDEWALK, Math.max(0.8, (w - 6) / 2)),
    z: Math.min(SIDEWALK, Math.max(0.8, (d - 6) / 2)),
  };
}

export function facadeBuilder(b: EnvBuilders, zone: ZoneId): MeshBuilder {
  return zone === 'corporate' ? b.corp : zone === 'jdm' ? b.jdm : b.urban;
}

export function accent(zone: ZoneId, rng: () => number): number {
  const list = zoneAccent(zone);
  return list[Math.floor(rng() * list.length)];
}

export function buildCity(b: EnvBuilders): void {
  const rng = makeRng(0x5a1d0);
  buildGround(b, b.plan.bounds);
  buildRoads(b);
  buildRoadPaint(b, rng);
  for (const blk of b.plan.blocks) buildBlock(b, blk, rng);
  buildPerimeter(b, rng);
  buildSkyline(b, rng);
}

/* ------------------------------------------------------------------ ground + roads */

function buildGround(b: EnvBuilders, bounds: Rect2): void {
  const size = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) * 2.2;
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;
  b.concrete.color(PAL.ground);
  const ground: Rect2 = { minX: cx - size / 2, maxX: cx + size / 2, minZ: cz - size / 2, maxZ: cz + size / 2 };
  // The bay takes its own share: the ground plane is cut around it (the water is its own mesh).
  const pieces = b.plan.water ? subtractRect(ground, b.plan.water.rect) : [ground];
  for (const p of pieces) {
    if (p.maxX - p.minX < 1 || p.maxZ - p.minZ < 1) continue;
    b.concrete.planeY((p.minX + p.maxX) / 2, -0.04, (p.minZ + p.maxZ) / 2, p.maxX - p.minX, p.maxZ - p.minZ);
  }
}

/** Asphalt tint per zone: cold and clean on the highway, a touch of rose in the old town. */
export function roadTint(zone: ZoneId): number {
  return zone === 'jdm' ? 0xe8dcea : zone === 'corporate' ? 0xf2f7ff : 0xe6eefb;
}

function buildRoads(b: EnvBuilders): void {
  // The plaza is laid first so the open intersection stays one uncut slab; the rest of the
  // network is then cut against everything already placed, which removes all coplanar overlap.
  const ordered = [...b.plan.roads].sort((a, c) => (a.axis === 'open' ? -1 : c.axis === 'open' ? 1 : 0));
  const placed: Rect2[] = [];
  for (const road of ordered) {
    let pieces: Rect2[] = [road];
    for (const done of placed) {
      const next: Rect2[] = [];
      for (const p of pieces) {
        for (const s of subtractRect(p, done)) {
          if (s.maxX - s.minX > 1e-3 && s.maxZ - s.minZ > 1e-3) next.push(s);
        }
      }
      pieces = next;
      if (pieces.length === 0) break;
    }
    placed.push(road);
    const tint = roadTint(road.zone);
    for (const p of pieces) {
      const w = p.maxX - p.minX;
      const d = p.maxZ - p.minZ;
      b.road.color(tint, road.lanes === 0 && road.axis !== 'open' ? 0.72 : 1);
      b.road.planeY(
        (p.minX + p.maxX) / 2,
        0,
        (p.minZ + p.maxZ) / 2,
        w,
        d,
        // World-space UVs keep the asphalt continuous across every cut piece.
        p.minX / ROAD_TILE,
        p.maxZ / ROAD_TILE,
        p.maxX / ROAD_TILE,
        p.minZ / ROAD_TILE,
      );
    }
  }
}

/** True when the point is inside a road other than `self` (i.e. an intersection). */
function inCrossing(b: EnvBuilders, self: RoadRect, x: number, z: number): boolean {
  for (const r of b.plan.roads) {
    if (r === self || r.lanes === 0) continue;
    if (x > r.minX - 1 && x < r.maxX + 1 && z > r.minZ - 1 && z < r.maxZ + 1) return true;
  }
  // The plaza swallows all markings.
  const p = b.plan.plaza;
  return p !== null && x > p.minX - 2 && x < p.maxX + 2 && z > p.minZ - 2 && z < p.maxZ + 2;
}

export const PAINT_Y = 0.014;

function paintSegment(
  b: EnvBuilders,
  road: RoadRect,
  offset: number,
  width: number,
  color: number,
  bright: number,
  dashLen: number,
  gapLen: number,
): void {
  const along = road.axis === 'z';
  const min = along ? road.minZ : road.minX;
  const max = along ? road.maxZ : road.maxX;
  const cross = along ? (road.minX + road.maxX) / 2 + offset : (road.minZ + road.maxZ) / 2 + offset;
  const step = dashLen + gapLen;
  b.lane.color(color, bright);
  for (let t = min + 2; t + dashLen < max - 2; t += step) {
    const c = t + dashLen / 2;
    const x = along ? cross : c;
    const z = along ? c : cross;
    if (inCrossing(b, road, x, z)) continue;
    if (along) b.lane.planeY(x, PAINT_Y, z, width, dashLen);
    else b.lane.planeY(x, PAINT_Y, z, dashLen, width);
  }
}

function buildRoadPaint(b: EnvBuilders, rng: () => number): void {
  for (const road of b.plan.roads) {
    if (road.lanes === 0 || road.axis === 'open') continue;
    const half = (road.axis === 'z' ? road.maxX - road.minX : road.maxZ - road.minZ) / 2;
    const worn = road.zone === 'jdm';
    const white = worn ? PAL.laneWorn : PAL.laneWhite;
    const bright = worn ? 0.55 : 1;
    // Outer edge lines.
    paintSegment(b, road, -(half - 1), 0.18, white, bright * 0.85, 7, 1);
    paintSegment(b, road, half - 1, 0.18, white, bright * 0.85, 7, 1);
    // Double centre line, cold and dim: the road paint is structure, not another colour.
    paintSegment(b, road, -0.35, 0.16, PAL.laneCenter, worn ? 0.5 : 0.8, 7, 1);
    paintSegment(b, road, 0.35, 0.16, PAL.laneCenter, worn ? 0.5 : 0.8, 7, 1);
    // Dashed lane dividers.
    paintSegment(b, road, -half / 2, 0.2, white, bright, 3.2, 5);
    paintSegment(b, road, half / 2, 0.2, white, bright, 3.2, 5);
  }
  if (b.plan.plaza) buildPlazaPaint(b, b.plan.plaza, rng);
}

/** The drift plaza gets a painted ring and corner hatching instead of lanes. */
function buildPlazaPaint(b: EnvBuilders, plaza: Rect, rng: () => number): void {
  const cx = (plaza.minX + plaza.maxX) / 2;
  const cz = (plaza.minZ + plaza.maxZ) / 2;
  const half = Math.min(plaza.maxX - plaza.minX, plaza.maxZ - plaza.minZ) / 2;
  const segments = 56;
  const r = half * 0.78;
  const w = 0.35;
  b.lane.color(PAL.laneWhite, 0.8);
  for (let i = 0; i < segments; i++) {
    if (i % 4 === 3) continue;
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    const c0 = Math.cos(a0);
    const s0 = Math.sin(a0);
    const c1 = Math.cos(a1);
    const s1 = Math.sin(a1);
    b.lane.quad(
      cx + c0 * (r - w), PAINT_Y, cz + s0 * (r - w),
      cx + c1 * (r - w), PAINT_Y, cz + s1 * (r - w),
      cx + c1 * (r + w), PAINT_Y, cz + s1 * (r + w),
      cx + c0 * (r + w), PAINT_Y, cz + s0 * (r + w),
    );
  }
  // Bold corner brackets: they frame the open square and give the eye something to aim at.
  const e = half * 0.928;
  for (let q = 0; q < 4; q++) {
    const sx = q % 2 === 0 ? 1 : -1;
    const sz = q < 2 ? 1 : -1;
    b.lane.color(PAL.laneCenter, 0.8 + rng() * 0.2);
    b.lane.planeY(cx + sx * (e - 5.5), PAINT_Y, cz + sz * e, 11, 0.55);
    b.lane.planeY(cx + sx * e, PAINT_Y, cz + sz * (e - 5.5), 0.55, 11);
  }
  // Faint neon rim so the plaza reads at night without lighting it up like a stage.
  groundGlow(b, cx, cz, half * 2.8, half * 2.8, PAL.neonCyan, 0.07, 0.018);
}

/* ------------------------------------------------------------------ city blocks */

interface Module {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  height: number;
}

function heightFor(massing: 1 | 2 | 3 | 4, rng: () => number): number {
  if (massing === 1) return 7 + rng() * 9;
  if (massing === 2) return 15 + rng() * 19;
  if (massing === 3) return 26 + rng() * 34;
  // Skyscrapers: the reference's wall of towers, twice the height of anything else.
  return 70 + rng() * 70;
}

function buildBlock(b: EnvBuilders, blk: BlockRect, rng: () => number): void {
  const w = blk.maxX - blk.minX;
  const d = blk.maxZ - blk.minZ;
  const cx = (blk.minX + blk.maxX) / 2;
  const cz = (blk.minZ + blk.maxZ) / 2;

  // Curb + sidewalk, kept 0.3 m inside the collider so the car stops before it touches art.
  b.concrete.color(PAL.curb);
  b.concrete.box(cx, 0.11, cz, w - 0.6, 0.22, d - 0.6, { top: true, bottom: false });
  b.concrete.color(PAL.sidewalk, blk.zone === 'jdm' ? 0.8 : 1);
  b.concrete.planeY(cx, 0.226, cz, w - 1.7, d - 1.7);

  const setback = blockSetback(w, d);
  const inner: Rect2 = {
    minX: blk.minX + setback.x,
    maxX: blk.maxX - setback.x,
    minZ: blk.minZ + setback.z,
    maxZ: blk.maxZ - setback.z,
  };
  const iw = inner.maxX - inner.minX;
  const id = inner.maxZ - inner.minZ;
  if (iw < 3 || id < 3) return;
  const nx = Math.max(1, Math.min(6, Math.round(iw / 17)));
  const nz = Math.max(1, Math.min(6, Math.round(id / 17)));

  for (let ix = 0; ix < nx; ix++) {
    for (let iz = 0; iz < nz; iz++) {
      const gap = 0.6;
      const m: Module = {
        minX: inner.minX + (iw / nx) * ix + (ix > 0 ? gap : 0) + rng() * 1.2,
        maxX: inner.minX + (iw / nx) * (ix + 1) - (ix < nx - 1 ? gap : 0) - rng() * 1.2,
        minZ: inner.minZ + (id / nz) * iz + (iz > 0 ? gap : 0) + rng() * 1.2,
        maxZ: inner.minZ + (id / nz) * (iz + 1) - (iz < nz - 1 ? gap : 0) - rng() * 1.2,
        height: heightFor(blk.massing, rng),
      };
      buildModule(b, blk, inner, m, rng);
    }
  }
}

type Variant = 'plain' | 'tower' | 'slab' | 'stepped' | 'shabby' | 'skyscraper';

/**
 * Which silhouette a module gets. Towers are set back on a podium or stepped; mid-rises
 * are plain or stepped or a slab with a lit spine; the low stuff in the old town is a
 * shabby box hung with cages, awnings and a tank on the roof.
 */
function pickVariant(blk: BlockRect, rng: () => number): Variant {
  const r = rng();
  if (blk.massing === 4) return 'skyscraper';
  if (blk.massing === 3) return r < 0.45 ? 'tower' : r < 0.75 ? 'slab' : 'stepped';
  if (blk.massing === 2) return r < 0.45 ? 'plain' : r < 0.75 ? 'stepped' : 'slab';
  if (blk.zone === 'jdm') return r < 0.65 ? 'shabby' : 'plain';
  return r < 0.35 ? 'shabby' : 'plain';
}

function buildModule(b: EnvBuilders, blk: BlockRect, inner: Rect2, m: Module, rng: () => number): void {
  const w = m.maxX - m.minX;
  const d = m.maxZ - m.minZ;
  if (w < 3 || d < 3) return;
  const cx = (m.minX + m.maxX) / 2;
  const cz = (m.minZ + m.maxZ) / 2;
  const base = 0.22;
  let h = m.height;
  // Something passes overhead: nothing here may reach it.
  if (blk.maxHeight !== undefined) h = Math.max(4, Math.min(h, blk.maxHeight - 1));
  const fb = facadeBuilder(b, blk.zone);
  const zone = blk.zone;
  const uOffset = Math.floor(rng() * 4) * 0.25;

  /** One box of building with its roof, from y0 up by `height`. */
  const tier = (x0: number, x1: number, z0: number, z1: number, y0: number, height: number): void => {
    fb.box((x0 + x1) / 2, y0 + height / 2, (z0 + z1) / 2, x1 - x0, height, z1 - z0, {
      top: false,
      tileW: FACADE_TILE_W,
      tileH: FACADE_TILE_H,
      uOffset,
    });
    b.roof.color(PAL.concrete, 0.75 + rng() * 0.5);
    b.roof.planeY((x0 + x1) / 2, y0 + height, (z0 + z1) / 2, x1 - x0, z1 - z0);
  };
  /** A smaller footprint centred on the module, `inset` in on every side, never thinner than 5 m. */
  const shrink = (inset: number): [number, number, number, number] => {
    const ix = Math.min(inset, Math.max(0, (w - 5) / 2));
    const iz = Math.min(inset, Math.max(0, (d - 5) / 2));
    return [m.minX + ix, m.maxX - ix, m.minZ + iz, m.maxZ - iz];
  };

  const variant = pickVariant(blk, rng);
  /** Height of the top of the tallest part, for the masts and rims. */
  let top = base + h;
  /** Footprint of the top tier, where the crown and the masts go. */
  let crown: [number, number, number, number] = [m.minX, m.maxX, m.minZ, m.maxZ];

  if (variant === 'plain') {
    tier(m.minX, m.maxX, m.minZ, m.maxZ, base, h);
    if (zone === 'jdm' && rng() < 0.55) awning(b, m, base, rng);
  } else if (variant === 'skyscraper') {
    // Three tiers of setbacks, light strips up the corners, screens the size of a building
    // on the street faces, a lit crown and an antenna cluster.
    const [x0, x1, z0, z1] = shrink(0.4);
    const h1 = h * (0.55 + rng() * 0.15);
    const h2 = h * (0.25 + rng() * 0.1);
    const h3 = h - h1 - h2;
    tier(x0, x1, z0, z1, base, h1);
    const t2 = shrink(Math.min(w, d) * (0.08 + rng() * 0.08));
    tier(t2[0], t2[1], t2[2], t2[3], base + h1, h2);
    const t3 = shrink(Math.min(w, d) * (0.2 + rng() * 0.12));
    tier(t3[0], t3[1], t3[2], t3[3], base + h1 + h2, h3);
    crown = t3;
    top = base + h;
    const c = accent(zone, rng);
    // Vertical light strips on two corners of the base tier, the full height of it.
    const corners: Array<[number, number, number, number]> = [
      [x0, z0, -1, -1],
      [x1, z0, 1, -1],
      [x1, z1, 1, 1],
      [x0, z1, -1, 1],
    ];
    const first = Math.floor(rng() * 4);
    const lit = h > 100 ? [0, 1, 2, 3] : [first, (first + 2) % 4];
    for (const k of lit) {
      const [px, pz, sx, sz] = corners[k];
      const t = rng() < 0.5 ? b.neon : b.neonPulse;
      t.color(c, 0.85);
      t.tube(px + sx * 0.25, base + 3, pz + sz * 0.25, px + sx * 0.25, base + h1 - 1, pz + sz * 0.25, 0.4);
    }
    // A line of light where each tier steps back.
    for (const [bx0, bx1, bz0, bz1, by] of [
      [x0, x1, z0, z1, base + h1] as const,
      [t2[0], t2[1], t2[2], t2[3], base + h1 + h2] as const,
    ]) {
      b.neon.color(c, 0.55);
      b.neon.tube(bx0, by + 0.2, bz0, bx1, by + 0.2, bz0, 0.22);
      b.neon.tube(bx0, by + 0.2, bz1, bx1, by + 0.2, bz1, 0.22);
      b.neon.tube(bx0, by + 0.2, bz0, bx0, by + 0.2, bz1, 0.22);
      b.neon.tube(bx1, by + 0.2, bz0, bx1, by + 0.2, bz1, 0.22);
    }
    // Screens: one or two per street face, tall, alternating the two holographic textures.
    const faces: Array<[number, number]> = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    let screens = 0;
    for (const [dx, dz] of faces) {
      if (screens >= 3) break;
      const faceX = dx === 1 ? x1 : dx === -1 ? x0 : (x0 + x1) / 2;
      const faceZ = dz === 1 ? z1 : dz === -1 ? z0 : (z0 + z1) / 2;
      const flush = dx === 1 ? m.maxX > inner.maxX - 1.2 : dx === -1 ? m.minX < inner.minX + 1.2 : dz === 1 ? m.maxZ > inner.maxZ - 1.2 : m.minZ < inner.minZ + 1.2;
      if (!flush) continue;
      const isRoad = b.plan.isRoad;
      if (!isRoad(faceX + dx * 9, faceZ + dz * 9) && !isRoad(faceX + dx * 14, faceZ + dz * 14) && !isRoad(faceX + dx * 20, faceZ + dz * 20)) continue;
      if (rng() < 0.25) continue;
      const faceW = dx !== 0 ? z1 - z0 : x1 - x0;
      const sw = Math.min(faceW * 0.55, 9 + rng() * 8);
      const sh = sw * (1.6 + rng() * 1.2);
      const sy = base + 18 + rng() * Math.max(6, h1 - sh - 22);
      if (sy + sh / 2 > base + h1 - 2) continue;
      const rotY = dx === 1 ? Math.PI / 2 : dx === -1 ? -Math.PI / 2 : dz === 1 ? 0 : Math.PI;
      const target = rng() < 0.5 ? b.billA : b.billB;
      target.panel(faceX + dx * 0.5, sy, faceZ + dz * 0.5, sw, sh, rotY);
      const hc = target === b.billA ? PAL.neonCyan : PAL.neonMagenta;
      halo(b, faceX + dx * 1.1, sy, faceZ + dz * 1.1, sw * 1.9, sh * 1.5, rotY, hc, 0.12);
      screens++;
    }
    // Crown: a lit rim on the top tier and antennas.
    b.neonPulse.color(c, 1);
    const [cx0, cx1, cz0, cz1] = t3;
    const ry = top + 0.3;
    b.neonPulse.tube(cx0, ry, cz0, cx1, ry, cz0, 0.3);
    b.neonPulse.tube(cx0, ry, cz1, cx1, ry, cz1, 0.3);
    b.neonPulse.tube(cx0, ry, cz0, cx0, ry, cz1, 0.3);
    b.neonPulse.tube(cx1, ry, cz0, cx1, ry, cz1, 0.3);
    halo(b, (cx0 + cx1) / 2, top + 1, (cz0 + cz1) / 2, cx1 - cx0 + 6, 8, 0, c, 0.12);
    halo(b, (cx0 + cx1) / 2, top + 1, (cz0 + cz1) / 2, cz1 - cz0 + 6, 8, Math.PI / 2, c, 0.12);
    const masts = 2 + Math.floor(rng() * 3);
    for (let i = 0; i < masts; i++) {
      const mh = 6 + rng() * 14;
      const px = cx0 + 1 + rng() * Math.max(0.5, cx1 - cx0 - 2);
      const pz = cz0 + 1 + rng() * Math.max(0.5, cz1 - cz0 - 2);
      b.props.color(PAL.metalDark, 0.7);
      b.props.box(px, top + mh / 2, pz, 0.4, mh, 0.4);
      if (i === 0) {
        b.neonFlicker.color(PAL.neonMagenta, 0.9);
        b.neonFlicker.box(px, top + mh, pz, 0.9, 0.9, 0.9);
        halo(b, px, top + mh, pz, 6, 6, 0, PAL.neonMagenta, 0.14);
      }
    }
  } else if (variant === 'tower') {
    // A podium the full size of the plot, and the tower set back on top of it.
    const podium = 5 + rng() * 7;
    tier(m.minX, m.maxX, m.minZ, m.maxZ, base, podium);
    const [x0, x1, z0, z1] = shrink(Math.min(w, d) * (0.14 + rng() * 0.12));
    tier(x0, x1, z0, z1, base + podium, h - podium);
    crown = [x0, x1, z0, z1];
    // A lit crown: the rim of the roof, and a frame standing a couple of metres above it.
    const c = accent(zone, rng);
    b.props.color(PAL.metalDark, 0.8);
    for (const [px, pz] of [
      [x0 + 0.6, z0 + 0.6],
      [x1 - 0.6, z0 + 0.6],
      [x1 - 0.6, z1 - 0.6],
      [x0 + 0.6, z1 - 0.6],
    ]) {
      b.props.box(px, top + 1.2, pz, 0.4, 2.4, 0.4);
    }
    b.neonPulse.color(c, 0.9);
    b.neonPulse.tube(x0 + 0.6, top + 2.4, z0 + 0.6, x1 - 0.6, top + 2.4, z0 + 0.6, 0.22);
    b.neonPulse.tube(x0 + 0.6, top + 2.4, z1 - 0.6, x1 - 0.6, top + 2.4, z1 - 0.6, 0.22);
    b.neonPulse.tube(x0 + 0.6, top + 2.4, z0 + 0.6, x0 + 0.6, top + 2.4, z1 - 0.6, 0.22);
    b.neonPulse.tube(x1 - 0.6, top + 2.4, z0 + 0.6, x1 - 0.6, top + 2.4, z1 - 0.6, 0.22);
    halo(b, (x0 + x1) / 2, top + 2.4, (z0 + z1) / 2, x1 - x0 + 4, 6, 0, c, 0.1);
    halo(b, (x0 + x1) / 2, top + 2.4, (z0 + z1) / 2, z1 - z0 + 4, 6, Math.PI / 2, c, 0.1);
  } else if (variant === 'stepped') {
    const tiers = blk.massing === 3 ? 3 : 2;
    const share = tiers === 3 ? [0.45, 0.33, 0.22] : [0.6, 0.4];
    let y = base;
    let box: [number, number, number, number] = [m.minX, m.maxX, m.minZ, m.maxZ];
    for (let i = 0; i < tiers; i++) {
      if (i > 0) box = shrink(Math.min(w, d) * 0.11 * i);
      const hh = h * share[i];
      tier(box[0], box[1], box[2], box[3], y, hh);
      y += hh;
    }
    crown = box;
    top = y;
  } else if (variant === 'slab') {
    tier(m.minX, m.maxX, m.minZ, m.maxZ, base, h);
    // A lit spine running the full height of one street face.
    const dirs: Array<[number, number]> = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    const [dx, dz] = dirs[Math.floor(rng() * 4)];
    const faceX = dx === 1 ? m.maxX : dx === -1 ? m.minX : cx + (rng() - 0.5) * w * 0.5;
    const faceZ = dz === 1 ? m.maxZ : dz === -1 ? m.minZ : cz + (rng() - 0.5) * d * 0.5;
    const c = accent(zone, rng);
    b.neonPulse.color(c, 0.85);
    b.neonPulse.tube(faceX + dx * 0.3, base + 2.5, faceZ + dz * 0.3, faceX + dx * 0.3, top - 1, faceZ + dz * 0.3, 0.32);
    halo(b, faceX + dx * 0.7, (base + top) / 2, faceZ + dz * 0.7, 6, top - base - 2, dx !== 0 ? Math.PI / 2 : 0, c, 0.12);
  } else {
    // Shabby: the box, and everything bolted to it since.
    tier(m.minX, m.maxX, m.minZ, m.maxZ, base, h);
    const cages = 2 + Math.floor(rng() * 3);
    for (let i = 0; i < cages; i++) {
      const onX = rng() < 0.5;
      const side = rng() < 0.5 ? -1 : 1;
      const px = onX ? (side > 0 ? m.maxX : m.minX) : m.minX + 1.5 + rng() * (w - 3);
      const pz = onX ? m.minZ + 1.5 + rng() * (d - 3) : side > 0 ? m.maxZ : m.minZ;
      const py = base + 2.6 + rng() * Math.max(1, h - 4);
      const balcony = rng() < 0.4;
      b.props.color(balcony ? PAL.rust : PAL.metalDark, 0.8 + rng() * 0.4);
      const out = balcony ? 1.1 : 0.7;
      const len = balcony ? 2.4 + rng() * 1.6 : 0.9;
      const tall = balcony ? 0.5 : 0.9;
      b.props.box(px + (onX ? side * out * 0.5 : 0), py, pz + (onX ? 0 : side * out * 0.5), onX ? out : len, tall, onX ? len : out);
      if (balcony && rng() < 0.5) {
        b.neonFlicker.color(PAL.winWarm, 0.7);
        b.neonFlicker.box(px + (onX ? side * out : 0), py + 0.9, pz + (onX ? 0 : side * out), 0.3, 0.3, 0.3);
      }
    }
    // A shack and a water tank on legs up top.
    if (rng() < 0.7) {
      const sw = Math.min(3.2, w * 0.4);
      const sd = Math.min(2.6, d * 0.4);
      b.props.color(PAL.rust, 0.9);
      b.props.box(m.minX + sw / 2 + 0.5, top + 1.2, m.minZ + sd / 2 + 0.5, sw, 2.4, sd);
    }
    if (rng() < 0.6 && w > 6 && d > 6) {
      const tx = m.maxX - 2.2;
      const tz = m.maxZ - 2.2;
      b.props.color(PAL.metalDark, 0.75);
      for (const [ox, oz] of [
        [-0.6, -0.6],
        [0.6, -0.6],
        [0.6, 0.6],
        [-0.6, 0.6],
      ]) {
        b.props.box(tx + ox, top + 0.9, tz + oz, 0.14, 1.8, 0.14);
      }
      b.props.color(PAL.rust, 1);
      b.props.box(tx, top + 2.7, tz, 1.8, 1.8, 1.8);
    }
    // Awnings over the ground floor, lit from underneath.
    if (rng() < 0.6) awning(b, m, base, rng);
  }

  // Roof clutter on the top tier: plant boxes, vents and the occasional mast.
  const [tx0, tx1, tz0, tz1] = crown;
  const tw = tx1 - tx0;
  const td = tz1 - tz0;
  const tcx = (tx0 + tx1) / 2;
  const tcz = (tz0 + tz1) / 2;
  const clutter = 1 + Math.floor(rng() * 3);
  for (let i = 0; i < clutter; i++) {
    const bw = 1.6 + rng() * Math.min(5, tw * 0.35);
    const bd = 1.6 + rng() * Math.min(5, td * 0.35);
    const bh = 0.8 + rng() * 2.6;
    b.props.color(PAL.metalDark, 0.7 + rng() * 0.6);
    b.props.box(tx0 + bw / 2 + rng() * Math.max(0, tw - bw), top + bh / 2, tz0 + bd / 2 + rng() * Math.max(0, td - bd), bw, bh, bd);
  }
  // Masts are common, but a lit beacon on top is rare: a skyline peppered with blinking dots
  // is the single busiest thing a night city can do.
  if (variant !== 'skyscraper' && h > 20 && rng() < 0.45) {
    const mh = 4 + rng() * 9;
    b.props.color(PAL.metalDark, 0.6);
    b.props.box(tcx, top + mh / 2, tcz, 0.35, mh, 0.35);
    if (rng() < 0.16) {
      b.neonFlicker.color(PAL.neonMagenta, 0.8);
      b.neonFlicker.box(tcx, top + mh, tcz, 0.7, 0.7, 0.7);
      halo(b, tcx, top + mh, tcz, 5, 5, 0, PAL.neonMagenta, 0.12);
    }
  }
  // Neon roof rim, the cheapest way to read a silhouette against a dark sky.
  if (variant !== 'tower' && variant !== 'skyscraper' && rng() < 0.24) {
    const c = accent(zone, rng);
    const y = top + 0.25;
    const t = rng() < 0.5 ? b.neon : b.neonPulse;
    t.color(c, 1);
    t.tube(tx0, y, tz0, tx1, y, tz0, 0.25);
    t.tube(tx0, y, tz1, tx1, y, tz1, 0.25);
    t.tube(tx0, y, tz0, tx0, y, tz1, 0.25);
    t.tube(tx1, y, tz0, tx1, y, tz1, 0.25);
  }
  // A big screen standing on the roof, facing the street, on the taller buildings.
  if (h > 24 && rng() < 0.3) rooftopSign(b, m, inner, top, rng);

  // Street facades.
  tryFacade(b, blk, inner, m, 1, 0, rng);
  tryFacade(b, blk, inner, m, -1, 0, rng);
  tryFacade(b, blk, inner, m, 0, 1, rng);
  tryFacade(b, blk, inner, m, 0, -1, rng);
}

/** An awning over the ground floor with a warm tube under it: the cosy note of the old town. */
function awning(b: EnvBuilders, m: Module, base: number, rng: () => number): void {
  const w = m.maxX - m.minX;
  const d = m.maxZ - m.minZ;
  const cx = (m.minX + m.maxX) / 2;
  const cz = (m.minZ + m.maxZ) / 2;
  const c = rng() < 0.55 ? PAL.neonAmber : rng() < 0.5 ? PAL.winWarm : PAL.neonPink;
  const onX = w >= d;
  const len = (onX ? w : d) * (0.4 + rng() * 0.4);
  const ax = onX ? cx + (rng() - 0.5) * (w - len) : m.maxX + 0.7;
  const az = onX ? m.maxZ + 0.7 : cz + (rng() - 0.5) * (d - len);
  b.props.color(PAL.rust, 1.1);
  b.props.box(ax, base + 3.1, az, onX ? len : 1.4, 0.16, onX ? 1.4 : len);
  b.neon.color(c, 0.7);
  if (onX) b.neon.tube(ax - len / 2, base + 2.95, az, ax + len / 2, base + 2.95, az, 0.12);
  else b.neon.tube(ax, base + 2.95, az - len / 2, ax, base + 2.95, az + len / 2, 0.12);
  groundGlow(b, onX ? ax : ax + 3, onX ? az + 3 : az, onX ? len * 1.2 : 8, onX ? 8 : len * 1.2, c, 0.1);
}

/** A billboard on the roof edge, turned toward whichever side has a street below. */
function rooftopSign(b: EnvBuilders, m: Module, inner: Rect2, top: number, rng: () => number): void {
  const w = m.maxX - m.minX;
  const d = m.maxZ - m.minZ;
  const cx = (m.minX + m.maxX) / 2;
  const cz = (m.minZ + m.maxZ) / 2;
  const isRoad = b.plan.isRoad;
  const dirs: Array<[number, number]> = [
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
  ];
  let pick: [number, number] | null = null;
  for (const [dx, dz] of dirs) {
    const faceX = dx === 1 ? m.maxX : dx === -1 ? m.minX : cx;
    const faceZ = dz === 1 ? m.maxZ : dz === -1 ? m.minZ : cz;
    const flush = dx === 1 ? m.maxX > inner.maxX - 1.2 : dx === -1 ? m.minX < inner.minX + 1.2 : dz === 1 ? m.maxZ > inner.maxZ - 1.2 : m.minZ < inner.minZ + 1.2;
    if (flush && (isRoad(faceX + dx * 8, faceZ + dz * 8) || isRoad(faceX + dx * 14, faceZ + dz * 14))) {
      pick = [dx, dz];
      break;
    }
  }
  if (!pick) return;
  const [dx, dz] = pick;
  const along = dx !== 0 ? d : w;
  const sw = Math.min(along * 0.85, 9 + rng() * 9);
  const sh = sw * (0.42 + rng() * 0.2);
  const sy = top + 1.4 + sh / 2;
  const px = dx !== 0 ? (dx === 1 ? m.maxX : m.minX) - dx * 1.2 : cx;
  const pz = dz !== 0 ? (dz === 1 ? m.maxZ : m.minZ) - dz * 1.2 : cz;
  const rotY = dx === 1 ? Math.PI / 2 : dx === -1 ? -Math.PI / 2 : dz === 1 ? 0 : Math.PI;
  const target = rng() < 0.5 ? b.billA : b.billB;
  target.panel(px, sy, pz, sw, sh, rotY);
  // Posts and a lit rail along the bottom edge.
  const tx = dx !== 0 ? 0 : 1;
  const tz = dx !== 0 ? 1 : 0;
  b.props.color(PAL.metalDark, 0.8);
  for (const s of [-1, 1]) {
    b.props.box(px + tx * s * (sw / 2 - 0.4), top + (sy + sh / 2 - top) / 2, pz + tz * s * (sw / 2 - 0.4), 0.4, sy + sh / 2 - top, 0.4);
  }
  const c = target === b.billA ? PAL.neonCyan : PAL.neonMagenta;
  b.neonPulse.color(c, 0.8);
  b.neonPulse.tube(px - tx * (sw / 2), sy - sh / 2 - 0.3, pz - tz * (sw / 2), px + tx * (sw / 2), sy - sh / 2 - 0.3, pz + tz * (sw / 2), 0.2);
  halo(b, px + dx * 0.6, sy, pz + dz * 0.6, sw * 1.8, sh * 2, rotY, c, 0.13);
}

/**
 * Dresses one wall of a building module when it actually faces a street: a shopfront light
 * band, sometimes a neon sign, and the wet reflection it throws onto the asphalt.
 */
function tryFacade(
  b: EnvBuilders,
  blk: BlockRect,
  inner: Rect2,
  m: Module,
  dx: number,
  dz: number,
  rng: () => number,
): void {
  const flush =
    dx === 1 ? m.maxX > inner.maxX - 1.2 : dx === -1 ? m.minX < inner.minX + 1.2 : dz === 1 ? m.maxZ > inner.maxZ - 1.2 : m.minZ < inner.minZ + 1.2;
  if (!flush) return;

  const cx = (m.minX + m.maxX) / 2;
  const cz = (m.minZ + m.maxZ) / 2;
  const faceX = dx === 1 ? m.maxX : dx === -1 ? m.minX : cx;
  const faceZ = dz === 1 ? m.maxZ : dz === -1 ? m.minZ : cz;
  const width = dx !== 0 ? m.maxZ - m.minZ : m.maxX - m.minX;
  // Only dress the wall if there is road across the sidewalk from it.
  const isRoad = b.plan.isRoad;
  if (!isRoad(faceX + dx * 7, faceZ + dz * 7) && !isRoad(faceX + dx * 11, faceZ + dz * 11) && !isRoad(faceX + dx * 15, faceZ + dz * 15)) return;

  const rotY = dx === 1 ? Math.PI / 2 : dx === -1 ? -Math.PI / 2 : dz === 1 ? 0 : Math.PI;
  const zone = blk.zone;
  const c = accent(zone, rng);

  // Shopfront band at ground level.
  const bandY = 3.2 + rng() * 1.4;
  const bandLen = width * (0.5 + rng() * 0.35);
  const bx = faceX + dx * 0.25;
  const bz = faceZ + dz * 0.25;
  // Split roughly half and half between the bass-driven mass and the mid-driven breathers,
  // so both bands have visible signage on every street rather than one dominating.
  const t = rng() < 0.55 ? b.neon : b.neonPulse;
  t.color(c, 1);
  if (dx !== 0) t.tube(bx, bandY, cz - bandLen / 2, bx, bandY, cz + bandLen / 2, 0.3);
  else t.tube(cx - bandLen / 2, bandY, bz, cx + bandLen / 2, bandY, bz, 0.3);
  halo(b, faceX + dx * 0.5, bandY, faceZ + dz * 0.5, bandLen * 1.4, 8, rotY, c, 0.13);
  groundGlow(
    b,
    faceX + dx * 7,
    faceZ + dz * 7,
    dx !== 0 ? 24 : bandLen * 1.8,
    dx !== 0 ? bandLen * 1.8 : 24,
    c,
    0.09,
  );

  // In the square every facade is a wall of screens: two or three stacked, alternating the
  // two holographic textures, and the sign below is no longer rare.
  const districts = b.plan.neonDistricts ?? [];
  let inDistrict = false;
  for (const r of districts) if (inRect(r, faceX, faceZ)) inDistrict = true;
  if (inDistrict) {
    // Up the whole face on a tall building: the wall of screens in the reference.
    const count = m.height > 60 ? 5 : m.height > 30 ? 4 : 2 + Math.floor(rng() * 2);
    let sy = 8 + rng() * 3;
    for (let k = 0; k < count; k++) {
      const sw = Math.min(width * 0.86, 7 + rng() * 9);
      const sh = sw * (0.5 + rng() * 0.45);
      if (sy + sh / 2 > m.height - 1.5) break;
      const target = (k + Math.floor(rng() * 2)) % 2 === 0 ? b.billA : b.billB;
      target.panel(faceX + dx * 0.45, sy, faceZ + dz * 0.45, sw, sh, rotY);
      b.props.color(PAL.metalDark, 0.7);
      if (dx !== 0) b.props.box(faceX + dx * 0.2, sy, faceZ, 0.3, sh + 0.6, sw + 0.6);
      else b.props.box(faceX, sy, faceZ + dz * 0.2, sw + 0.6, sh + 0.6, 0.3);
      const hc = target === b.billA ? PAL.neonCyan : PAL.neonMagenta;
      halo(b, faceX + dx * 0.9, sy, faceZ + dz * 0.9, sw * 1.9, sh * 1.9, rotY, hc, 0.13);
      sy += sh + 1.6 + rng() * 2;
    }
    groundGlow(b, faceX + dx * 10, faceZ + dz * 10, dx !== 0 ? 30 : width * 1.6, dx !== 0 ? width * 1.6 : 30, c, 0.08, 0.028);
  }

  // A neon sign, but only rarely: selective neon is the whole point.
  if (!inDistrict && rng() > (zone === 'urban' ? 0.2 : 0.32)) return;
  const pool = zone === 'jdm' ? [2, 10, 11, 13, 15] : zone === 'corporate' ? [1, 14, 4, 12, 7] : [0, 1, 3, 5, 6, 8, 9, 12];
  const cell = pool[Math.floor(rng() * pool.length)];
  const uv = signCell(cell);
  const tall = cell === 7 || cell === 13;
  const sw = tall ? 2.6 : Math.min(width * 0.7, 5 + rng() * 3.5);
  const sh = tall ? sw * 3 : sw * (0.75 + rng() * 0.4);
  const sy = 6 + rng() * Math.max(1, Math.min(14, m.height - 10));
  b.signs.panel(faceX + dx * 0.35, sy, faceZ + dz * 0.35, sw, sh, rotY, uv.u0, uv.v0, uv.u1, uv.v1);
  // The halo always takes the zone accent, so a sign can never introduce a hue of its own.
  halo(b, faceX + dx * 0.7, sy, faceZ + dz * 0.7, sw * 2.8, sh * 2.8, rotY, c, 0.17);
  // Wet reflection streak running away from the sign across the asphalt. Long and faint: this
  // is the smear on the road that does most of the work in the reference.
  groundGlow(b, faceX + dx * 12, faceZ + dz * 12, dx !== 0 ? 34 : sw * 1.6, dx !== 0 ? sw * 1.6 : 34, c, 0.11, 0.024);
}

/* ------------------------------------------------------------------ perimeter + skyline */

/** Buildings packed into the wall band, so the city is enclosed by city, not by a fence. */
function buildPerimeter(b: EnvBuilders, rng: () => number): void {
  const bounds = b.plan.bounds;
  const centreX = (bounds.minX + bounds.maxX) / 2;
  const centreZ = (bounds.minZ + bounds.maxZ) / 2;
  for (const wall of b.plan.walls) {
    const horizontal = wall.maxX - wall.minX > wall.maxZ - wall.minZ;
    const min = horizontal ? wall.minX : wall.minZ;
    const max = horizontal ? wall.maxX : wall.maxZ;
    const bandMin = horizontal ? wall.minZ : wall.minX;
    const bandMax = horizontal ? wall.maxZ : wall.maxX;
    const bandMid = (bandMin + bandMax) / 2;
    // The band edge that faces the city.
    const inward = bandMid < (horizontal ? centreZ : centreX) ? 1 : -1;
    const innerEdge = inward > 0 ? bandMax : bandMin;
    const along = (t: number, off: number): [number, number] =>
      horizontal ? [t, innerEdge - inward * off] : [innerEdge - inward * off, t];

    // Raised pavement across the whole band so props sit at sidewalk height.
    {
      const [px, pz] = along((min + max) / 2, (bandMax - bandMin) / 2);
      const w = horizontal ? max - min - 0.6 : bandMax - bandMin - 0.6;
      const d = horizontal ? bandMax - bandMin - 0.6 : max - min - 0.6;
      b.concrete.color(PAL.curb);
      b.concrete.box(px, 0.11, pz, w, 0.22, d, { top: true, bottom: false });
      b.concrete.color(PAL.sidewalk);
      b.concrete.planeY(px, 0.226, pz, w - 1.2, d - 1.2);
    }

    // Low retaining wall hugging the road edge; it closes the gaps between buildings.
    {
      const [wx, wz] = along((min + max) / 2, 1.7);
      const w = horizontal ? max - min - 0.8 : 3.4;
      const d = horizontal ? 3.4 : max - min - 0.8;
      b.concrete.color(PAL.concrete, 1.15);
      b.concrete.box(wx, 1.72, wz, w, 3, d);
    }

    const depth = 7.4;
    let t = min + 1;
    while (t < max - 8) {
      const len = Math.min(11 + rng() * 18, max - 1 - t);
      if (len < 8) break;
      const [x, z] = along(t + len / 2, 3.4 + depth / 2);
      const zone = b.plan.zoneAt(x, z);
      let h = zone === 'corporate' ? 24 + rng() * 34 : zone === 'jdm' ? 11 + rng() * 15 : 16 + rng() * 26;
      // Behind downtown the band is more of the same: towers, twice as tall.
      const dt = b.plan.downtown;
      if (dt && x > dt.minX - 30 && x < dt.maxX + 30 && z < dt.maxZ) h = 50 + rng() * 60;
      const bw = horizontal ? len - 1.5 : depth;
      const bd = horizontal ? depth : len - 1.5;
      facadeBuilder(b, zone).box(x, 0.22 + h / 2, z, bw, h, bd, {
        top: false,
        tileW: FACADE_TILE_W,
        tileH: FACADE_TILE_H,
        uOffset: Math.floor(rng() * 4) * 0.25,
      });
      b.roof.color(PAL.concrete, 0.7 + rng() * 0.5);
      b.roof.planeY(x, 0.22 + h, z, bw, bd);
      if (rng() < 0.28) {
        const c2 = accent(zone, rng);
        const [nx2, nz2] = along(t + len / 2, 3.3);
        b.neon.color(c2, 1);
        if (horizontal) b.neon.tube(x - bw / 2, 4.4, nz2, x + bw / 2, 4.4, nz2, 0.28);
        else b.neon.tube(nx2, 4.4, z - bd / 2, nx2, 4.4, z + bd / 2, 0.28);
        const [gx, gz] = along(t + len / 2, -6);
        groundGlow(b, gx, gz, horizontal ? bw * 1.4 : 20, horizontal ? 20 : bd * 1.4, c2, 0.08);
      }
      t += len + 1.5 + rng() * 3;
    }
  }
}

/** Silhouette towers outside the playable area. Pure backdrop: no colliders, no detail. */
function buildSkyline(b: EnvBuilders, rng: () => number): void {
  const bounds = b.plan.bounds;
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;
  const halfW = (bounds.maxX - bounds.minX) / 2;
  const halfD = (bounds.maxZ - bounds.minZ) / 2;

  const place = (x: number, z: number, w: number, d: number, h: number): void => {
    // The backdrop takes the zone of the city edge it stands behind.
    const zone = b.plan.zoneAt(cx + (x - cx) * 0.4, cz + (z - cz) * 0.4);
    facadeBuilder(b, zone).box(x, h / 2, z, w, h, d, {
      top: false,
      tileW: 10,
      tileH: 8.5,
      uOffset: Math.floor(rng() * 4) * 0.25,
    });
    b.roof.color(PAL.concrete, 0.6);
    b.roof.planeY(x, h, z, w, d);
    if (h > 62) {
      const mh = 6 + rng() * 14;
      b.props.color(PAL.metalDark, 0.5);
      b.props.box(x, h + mh / 2, z, 0.6, mh, 0.6);
      // Only the true hero towers get a beacon; the backdrop stays a silhouette in haze.
      if (h > 105 && rng() < 0.4) {
        b.neonFlicker.color(PAL.neonMagenta, 0.7);
        b.neonFlicker.box(x, h + mh, z, 1.4, 1.4, 1.4);
      }
    }
  };

  // Across the bay the far shore is its own skyline: further out, bigger, taller. Behind
  // downtown (the north edge) the towers keep going, as tall as the district itself.
  const bay = !!b.plan.water;
  const downtown = !!b.plan.downtown;
  for (let side = 0; side < 4; side++) {
    const horizontal = side < 2;
    const farShore = bay && side === 1;
    const behindDowntown = downtown && side === 0;
    const span = (horizontal ? halfW : halfD) + (farShore ? 160 : 70);
    const count = Math.max(8, Math.round((span * 2) / (farShore ? 36 : behindDowntown ? 24 : 31)));
    for (let i = 0; i < count; i++) {
      const along = -span + i * ((span * 2) / count) + rng() * 14;
      const out = (horizontal ? halfD : halfW) + (farShore ? 150 : 2) + rng() * 62;
      const w = (farShore ? 16 : 12) + rng() * 20;
      const d = (farShore ? 16 : 12) + rng() * 20;
      const tall = behindDowntown && cx + along < (b.plan.downtown?.maxX ?? 0) + 40;
      const h = (farShore ? 50 : tall ? 70 : 34) + rng() * rng() * (farShore ? 140 : tall ? 120 : 105);
      if (side === 0) place(cx + along, cz - out, w, d, h);
      else if (side === 1) place(cx + along, cz + out, w, d, h);
      else if (side === 2) place(cx - out, cz + along, w, d, h);
      else place(cx + out, cz + along, w, d, h);
    }
  }
  // A couple of hero towers to anchor the horizon, as in the approved reference.
  place(cx - 52, cz - halfD - 94, 30, 30, 150);
  place(cx + 38, cz - halfD - 118, 26, 26, 128);
  place(cx + halfW + 86, cz + 64, 28, 28, 118);
}
