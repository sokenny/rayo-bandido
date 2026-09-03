import {
  ARENA_BLOCKS,
  ARENA_ROADS,
  ARENA_WALLS,
  type BlockRect,
  type RoadRect,
  type ZoneId,
} from '../../../world/arenaLayout';
import { PAL, ZONE_ACCENT } from './palette';
import { makeRng, subtractRect, type MeshBuilder, type Rect2 } from './meshBuilder';
import { groundGlow, halo, isRoad, type EnvBuilders } from './builders';
import { signCell } from './textures';

/**
 * Streets, sidewalks, blocks and skyline, all derived from the rectangles in
 * `src/world/arenaLayout.ts`. Nothing here invents geometry the simulation does not know
 * about: buildings live strictly inside their collider, roads live strictly outside every one.
 */

/** Metres covered by one asphalt texture tile. */
const ROAD_TILE = 8;
/** Metres covered by one facade texture tile (horizontally / vertically). */
const FACADE_TILE_W = 12;
const FACADE_TILE_H = 10;
/** Sidewalk ledge kept between the collider edge and the nearest wall. */
const SIDEWALK = 3.4;

export function zoneAt(x: number, z: number): ZoneId {
  if (x < -30) return 'corporate';
  if (z > 30) return 'jdm';
  return 'urban';
}

function facadeBuilder(b: EnvBuilders, zone: ZoneId): MeshBuilder {
  return zone === 'corporate' ? b.corp : zone === 'jdm' ? b.jdm : b.urban;
}

function accent(zone: ZoneId, rng: () => number): number {
  const list = ZONE_ACCENT[zone];
  return list[Math.floor(rng() * list.length)];
}

export function buildCity(b: EnvBuilders, bounds: Rect2): void {
  const rng = makeRng(0x5a1d0);
  buildGround(b, bounds);
  buildRoads(b);
  buildRoadPaint(b, rng);
  for (const blk of ARENA_BLOCKS) buildBlock(b, blk, rng);
  buildPerimeter(b, rng);
  buildSkyline(b, rng);
}

/* ------------------------------------------------------------------ ground + roads */

function buildGround(b: EnvBuilders, bounds: Rect2): void {
  const size = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) * 2.2;
  b.concrete.color(PAL.ground);
  b.concrete.planeY((bounds.minX + bounds.maxX) / 2, -0.04, (bounds.minZ + bounds.maxZ) / 2, size, size);
}

function buildRoads(b: EnvBuilders): void {
  // The plaza is laid first so the open intersection stays one uncut slab; the rest of the
  // network is then cut against everything already placed, which removes all coplanar overlap.
  const ordered = [...ARENA_ROADS].sort((a, c) => (a.tag === 'plaza' ? -1 : c.tag === 'plaza' ? 1 : 0));
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
    const tint = road.zone === 'jdm' ? 0xe8dcea : road.zone === 'corporate' ? 0xf2f7ff : 0xe6eefb;
    for (const p of pieces) {
      const w = p.maxX - p.minX;
      const d = p.maxZ - p.minZ;
      b.road.color(tint, road.tag === 'alley-jdm' ? 0.72 : 1);
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
function inCrossing(self: RoadRect, x: number, z: number): boolean {
  for (const r of ARENA_ROADS) {
    if (r === self || r.lanes === 0) continue;
    if (x > r.minX - 1 && x < r.maxX + 1 && z > r.minZ - 1 && z < r.maxZ + 1) return true;
  }
  // The plaza swallows all markings.
  return x > -27 && x < 27 && z > -27 && z < 27;
}

const PAINT_Y = 0.014;

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
    if (inCrossing(road, x, z)) continue;
    if (along) b.lane.planeY(x, PAINT_Y, z, width, dashLen);
    else b.lane.planeY(x, PAINT_Y, z, dashLen, width);
  }
}

function buildRoadPaint(b: EnvBuilders, rng: () => number): void {
  for (const road of ARENA_ROADS) {
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
  buildPlazaPaint(b, rng);
}

/** The drift plaza gets a painted ring and corner hatching instead of lanes. */
function buildPlazaPaint(b: EnvBuilders, rng: () => number): void {
  const segments = 56;
  const r = 19.5;
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
      c0 * (r - w), PAINT_Y, s0 * (r - w),
      c1 * (r - w), PAINT_Y, s1 * (r - w),
      c1 * (r + w), PAINT_Y, s1 * (r + w),
      c0 * (r + w), PAINT_Y, s0 * (r + w),
    );
  }
  // Bold corner brackets: they frame the open square and give the eye something to aim at.
  const e = 23.2;
  for (let q = 0; q < 4; q++) {
    const sx = q % 2 === 0 ? 1 : -1;
    const sz = q < 2 ? 1 : -1;
    b.lane.color(PAL.laneCenter, 0.8 + rng() * 0.2);
    b.lane.planeY(sx * (e - 5.5), PAINT_Y, sz * e, 11, 0.55);
    b.lane.planeY(sx * e, PAINT_Y, sz * (e - 5.5), 0.55, 11);
  }
  // Faint neon rim so the plaza reads at night without lighting it up like a stage.
  groundGlow(b, 0, 0, 70, 70, PAL.neonCyan, 0.07, 0.018);
}

/* ------------------------------------------------------------------ city blocks */

interface Module {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  height: number;
}

function heightFor(massing: 1 | 2 | 3, rng: () => number): number {
  if (massing === 1) return 7 + rng() * 9;
  if (massing === 2) return 15 + rng() * 19;
  return 26 + rng() * 34;
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

  const inner: Rect2 = {
    minX: blk.minX + SIDEWALK,
    maxX: blk.maxX - SIDEWALK,
    minZ: blk.minZ + SIDEWALK,
    maxZ: blk.maxZ - SIDEWALK,
  };
  const iw = inner.maxX - inner.minX;
  const id = inner.maxZ - inner.minZ;
  const nx = Math.max(1, Math.min(3, Math.round(iw / 18)));
  const nz = Math.max(1, Math.min(4, Math.round(id / 18)));

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

function buildModule(b: EnvBuilders, blk: BlockRect, inner: Rect2, m: Module, rng: () => number): void {
  const w = m.maxX - m.minX;
  const d = m.maxZ - m.minZ;
  if (w < 3 || d < 3) return;
  const cx = (m.minX + m.maxX) / 2;
  const cz = (m.minZ + m.maxZ) / 2;
  const base = 0.22;
  const h = m.height;
  const fb = facadeBuilder(b, blk.zone);
  fb.box(cx, base + h / 2, cz, w, h, d, {
    top: false,
    tileW: FACADE_TILE_W,
    tileH: FACADE_TILE_H,
    uOffset: Math.floor(rng() * 4) * 0.25,
  });
  b.roof.color(PAL.concrete, 0.75 + rng() * 0.5);
  b.roof.planeY(cx, base + h, cz, w, d);

  // Roof clutter: plant boxes, vents and the occasional mast.
  const clutter = 1 + Math.floor(rng() * 3);
  for (let i = 0; i < clutter; i++) {
    const bw = 1.6 + rng() * Math.min(5, w * 0.35);
    const bd = 1.6 + rng() * Math.min(5, d * 0.35);
    const bh = 0.8 + rng() * 2.6;
    b.props.color(PAL.metalDark, 0.7 + rng() * 0.6);
    b.props.box(
      m.minX + bw / 2 + rng() * (w - bw),
      base + h + bh / 2,
      m.minZ + bd / 2 + rng() * (d - bd),
      bw,
      bh,
      bd,
    );
  }
  // Masts are common, but a lit beacon on top is rare: a skyline peppered with blinking dots
  // is the single busiest thing a night city can do.
  if (h > 20 && rng() < 0.45) {
    const mh = 4 + rng() * 9;
    b.props.color(PAL.metalDark, 0.6);
    b.props.box(cx, base + h + mh / 2, cz, 0.35, mh, 0.35);
    if (rng() < 0.16) {
      b.neonFlicker.color(PAL.neonMagenta, 0.8);
      b.neonFlicker.box(cx, base + h + mh, cz, 0.7, 0.7, 0.7);
      halo(b, cx, base + h + mh, cz, 5, 5, 0, PAL.neonMagenta, 0.12);
    }
  }
  // Neon roof rim, the cheapest way to read a silhouette against a dark sky.
  if (rng() < 0.24) {
    const c = accent(blk.zone, rng);
    const y = base + h + 0.25;
    const t = rng() < 0.5 ? b.neon : b.neonPulse;
    t.color(c, 1);
    t.tube(m.minX, y, m.minZ, m.maxX, y, m.minZ, 0.25);
    t.tube(m.minX, y, m.maxZ, m.maxX, y, m.maxZ, 0.25);
    t.tube(m.minX, y, m.minZ, m.minX, y, m.maxZ, 0.25);
    t.tube(m.maxX, y, m.minZ, m.maxX, y, m.maxZ, 0.25);
  }

  // Street facades.
  tryFacade(b, blk, inner, m, 1, 0, rng);
  tryFacade(b, blk, inner, m, -1, 0, rng);
  tryFacade(b, blk, inner, m, 0, 1, rng);
  tryFacade(b, blk, inner, m, 0, -1, rng);
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
  if (!isRoad(faceX + dx * 7, faceZ + dz * 7) && !isRoad(faceX + dx * 11, faceZ + dz * 11)) return;

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

  // A neon sign, but only rarely: selective neon is the whole point.
  if (rng() > (zone === 'urban' ? 0.2 : 0.32)) return;
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

/** Buildings packed into the 12 m wall band, so the arena is enclosed by city, not by a fence. */
function buildPerimeter(b: EnvBuilders, rng: () => number): void {
  for (const wall of ARENA_WALLS) {
    const horizontal = wall.maxX - wall.minX > wall.maxZ - wall.minZ;
    const min = horizontal ? wall.minX : wall.minZ;
    const max = horizontal ? wall.maxX : wall.maxZ;
    const bandMin = horizontal ? wall.minZ : wall.minX;
    const bandMax = horizontal ? wall.maxZ : wall.maxX;
    const bandMid = (bandMin + bandMax) / 2;
    // The band edge that faces the arena.
    const inward = bandMid < 0 ? 1 : -1;
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
      const zone = zoneAt(x, z);
      const h = zone === 'corporate' ? 24 + rng() * 34 : zone === 'jdm' ? 11 + rng() * 15 : 16 + rng() * 26;
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
  const place = (x: number, z: number, w: number, d: number, h: number): void => {
    const zone = zoneAt(x * 0.4, z * 0.4);
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

  for (let side = 0; side < 4; side++) {
    for (let i = 0; i < 13; i++) {
      const along = -190 + i * 31 + rng() * 14;
      const out = 122 + rng() * 62;
      const w = 12 + rng() * 20;
      const d = 12 + rng() * 20;
      const h = 34 + rng() * rng() * 105;
      if (side === 0) place(along, -out, w, d, h);
      else if (side === 1) place(along, out, w, d, h);
      else if (side === 2) place(-out, along, w, d, h);
      else place(out, along, w, d, h);
    }
  }
  // A couple of hero towers to anchor the horizon, as in the approved reference.
  place(-52, -214, 30, 30, 150);
  place(38, -238, 26, 26, 128);
  place(206, 64, 28, 28, 118);
}
