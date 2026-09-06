import type { BlockRect, Rect, RoadRect, ZoneId } from '../../../world/cityPlan';
import { PAL, zoneAccent } from './palette';
import { inRect, makeRng, subtractRect, type MeshBuilder, type Rect2 } from './meshBuilder';
import { groundGlow, halo, type EnvBuilders } from './builders';
import { buildBuilding, buildLink, plotSeed, skylineField, snapFloors, subdividePlot, type BuildingSpec } from './buildingKit';
import { signCell } from './textures';

/**
 * Streets, sidewalks, blocks and skyline, all derived from the rectangles in the plan
 * (`b.plan`). Nothing here invents geometry the simulation does not know about: buildings
 * live strictly inside their collider, roads live strictly outside every one.
 */

/** Metres covered by one asphalt texture tile. */
export const ROAD_TILE = 8;
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

/** Every zone's facades land in the one facade builder; the zone only picks the light. */
export function facadeBuilder(b: EnvBuilders, _zone: ZoneId): MeshBuilder {
  return b.facade;
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
  buildBlocks(b);
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

/**
 * How a block turns into buildings. The knobs that shape the skyline:
 *
 * - `minPlot` / `bigStop` / `emptyChance`: how a block is cut into plots (see
 *   `subdividePlot`). Bigger `bigStop` = more large plots = more podiums and landmarks.
 * - `heights`: the height band for each massing tier (m). This is the hierarchy of low,
 *   medium, tall and skyscraper.
 * - `fieldDepth`: how much the smooth skyline field (`skylineField`) swings heights,
 *   0.5 = between -25 % and +25 %. The rhythm: districts rise and fall instead of scattering.
 * - `edgeDrop` / `innerRise`: on a block of several plots, the ones on the street lose up to
 *   `edgeDrop` and the ones behind gain up to `innerRise`, so the tall stuff stands behind
 *   the low stuff and the layers overlap.
 * - `landmarks`: how many plots anchor the skyline with one of the kit's landmark
 *   silhouettes, the least distance between two of them, and how much taller they stand.
 * - `linkChance`: enclosed bridges between neighbouring towers on one block.
 * - `districtScreens`: the screens on downtown facades, per face.
 */
export const BLOCKS = {
  minPlot: 9,
  bigStop: { 1: 0.15, 2: 0.2, 3: 0.35, 4: 0.4 } as Record<number, number>,
  emptyChance: 0.06,
  heights: { 1: [6, 15], 2: [14, 34], 3: [28, 62], 4: [70, 135] } as Record<number, [number, number]>,
  fieldDepth: 0.5,
  edgeDrop: 0.2,
  innerRise: 0.22,
  landmarks: { count: 6, spacing: 90, scale: 1.45, maxHeight: 150, minSide: 14 },
  linkChance: 0.3,
  linkMax: 30,
  districtScreens: { perFace: 2, faceChance: 0.6 },
};

interface Module {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  height: number;
}

/** A plot with everything decided about it, before anything is drawn. */
interface Plot extends Module {
  blk: BlockRect;
  inner: Rect2;
  spec: BuildingSpec;
  seed: number;
  /** Set once built. */
  top?: number;
  dark?: boolean;
}

function heightFor(massing: 1 | 2 | 3 | 4, rng: () => number): number {
  const [lo, hi] = BLOCKS.heights[massing];
  return lo + rng() * (hi - lo);
}

/** True when the plot's wall on side (dx, dz) is flush with the block edge and faces a road. */
function facesStreet(b: EnvBuilders, inner: Rect2, m: Rect2, dx: number, dz: number): boolean {
  const flush =
    dx === 1 ? m.maxX > inner.maxX - 1.2 : dx === -1 ? m.minX < inner.minX + 1.2 : dz === 1 ? m.maxZ > inner.maxZ - 1.2 : m.minZ < inner.minZ + 1.2;
  if (!flush) return false;
  const faceX = dx === 1 ? m.maxX : dx === -1 ? m.minX : (m.minX + m.maxX) / 2;
  const faceZ = dz === 1 ? m.maxZ : dz === -1 ? m.minZ : (m.minZ + m.maxZ) / 2;
  const isRoad = b.plan.isRoad;
  return isRoad(faceX + dx * 7, faceZ + dz * 7) || isRoad(faceX + dx * 11, faceZ + dz * 11) || isRoad(faceX + dx * 15, faceZ + dz * 15);
}

/** Pavement, kerb and the plots of one block. Nothing is drawn but the slab. */
function planBlock(b: EnvBuilders, blk: BlockRect): Plot[] {
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
  if (iw < 3 || id < 3) return [];

  const rng = makeRng(plotSeed(cx, cz));
  const rects = subdividePlot(inner, rng, { minPlot: BLOCKS.minPlot, bigStop: BLOCKS.bigStop[blk.massing] ?? 0.2, emptyChance: blk.massing <= 2 ? BLOCKS.emptyChance : 0 });
  const plots: Plot[] = [];
  for (const r of rects) {
    if (r.maxX - r.minX < 3 || r.maxZ - r.minZ < 3) continue;
    const px = (r.minX + r.maxX) / 2;
    const pz = (r.minZ + r.maxZ) / 2;
    const seed = plotSeed(px, pz);
    const prng = makeRng(seed);
    const street: [boolean, boolean, boolean, boolean] = [
      facesStreet(b, inner, r, 1, 0),
      facesStreet(b, inner, r, -1, 0),
      facesStreet(b, inner, r, 0, 1),
      facesStreet(b, inner, r, 0, -1),
    ];
    let h = heightFor(blk.massing, prng);
    // The skyline field: the district rises and falls instead of scattering.
    h *= 1 - BLOCKS.fieldDepth / 2 + BLOCKS.fieldDepth * skylineField(px, pz);
    // Low in front, tall behind: on a block of several plots the street edge drops and the
    // plots behind it rise. Downtown is a wall of towers either way.
    if (rects.length >= 4 && blk.massing >= 2 && blk.massing <= 3) {
      if (street.some(Boolean)) h *= 1 - BLOCKS.edgeDrop * prng();
      else h *= 1 + BLOCKS.innerRise * (0.5 + 0.5 * prng());
    }
    // Something passes overhead: nothing here may reach it.
    if (blk.maxHeight !== undefined) h = Math.max(4, Math.min(h, blk.maxHeight - 1));
    plots.push({
      ...r,
      height: h,
      blk,
      inner,
      seed,
      spec: { zone: blk.zone, massing: blk.massing, height: h, base: 0.22, detail: 'near', street },
    });
  }
  return plots;
}

/**
 * The landmark anchors: the biggest plots that can carry a tower, at least `spacing` apart,
 * each given one of the kit's silhouettes in turn and a head above the field. Deterministic:
 * the same plots every time, unless the block grid changes.
 */
function assignLandmarks(plots: Plot[]): void {
  const L = BLOCKS.landmarks;
  const candidates = plots
    .filter((p) => p.blk.massing >= 3 && p.blk.maxHeight === undefined && Math.min(p.maxX - p.minX, p.maxZ - p.minZ) >= L.minSide)
    .map((p) => ({ p, score: (p.maxX - p.minX) * (p.maxZ - p.minZ) * (p.blk.massing === 4 ? 1.3 : 1) }))
    .sort((a, c) => c.score - a.score || a.p.seed - c.p.seed);
  const taken: Plot[] = [];
  for (const { p } of candidates) {
    if (taken.length >= L.count) break;
    const cx = (p.minX + p.maxX) / 2;
    const cz = (p.minZ + p.maxZ) / 2;
    let clear = true;
    for (const t of taken) {
      if (Math.hypot((t.minX + t.maxX) / 2 - cx, (t.minZ + t.maxZ) / 2 - cz) < L.spacing) clear = false;
    }
    if (!clear) continue;
    p.spec.landmark = taken.length;
    p.spec.height = Math.min(L.maxHeight, p.height * L.scale);
    p.height = p.spec.height;
    taken.push(p);
  }
}

function buildPlot(b: EnvBuilders, p: Plot): void {
  const rng = makeRng(p.seed ^ 0x9e3779b9);
  const bld = buildBuilding(b, p, p.spec, rng);
  p.top = bld.top;
  p.dark = bld.dark;
  const h = bld.top - p.spec.base;
  const m: Module = { minX: p.minX, maxX: p.maxX, minZ: p.minZ, maxZ: p.maxZ, height: h };
  // A big screen standing on the roof, facing the street, on some of the taller buildings.
  if (!bld.dark && h > 24 && rng() < 0.22) rooftopSign(b, m, p.inner, bld.top, rng);
  // Street facades: shopfront bands, signs, the district's screens.
  if (!bld.dark) {
    tryFacade(b, p.blk, p.inner, m, 1, 0, rng);
    tryFacade(b, p.blk, p.inner, m, -1, 0, rng);
    tryFacade(b, p.blk, p.inner, m, 0, 1, rng);
    tryFacade(b, p.blk, p.inner, m, 0, -1, rng);
  }
}

/** Enclosed bridges between neighbouring towers on one block. */
function buildLinks(b: EnvBuilders, plots: Plot[]): void {
  let made = 0;
  for (let i = 0; i < plots.length && made < BLOCKS.linkMax; i++) {
    const a = plots[i];
    if (!a.top || a.dark || a.top < 30) continue;
    for (let j = i + 1; j < plots.length && made < BLOCKS.linkMax; j++) {
      const c = plots[j];
      if (c.blk !== a.blk || !c.top || c.dark || c.top < 30) continue;
      const gapX = Math.max(c.minX - a.maxX, a.minX - c.maxX);
      const gapZ = Math.max(c.minZ - a.maxZ, a.minZ - c.maxZ);
      const overlapX = Math.min(a.maxX, c.maxX) - Math.max(a.minX, c.minX);
      const overlapZ = Math.min(a.maxZ, c.maxZ) - Math.max(a.minZ, c.minZ);
      const sideBySide = (gapX > 0.3 && gapX < 6 && overlapZ >= 5) || (gapZ > 0.3 && gapZ < 6 && overlapX >= 5);
      if (!sideBySide) continue;
      const rng = makeRng((a.seed ^ c.seed) >>> 0);
      if (rng() > BLOCKS.linkChance) continue;
      const y = a.spec.base + snapFloors(Math.min(a.top, c.top) * (0.4 + rng() * 0.3));
      buildLink(b, a, c, y, a.blk.zone, rng);
      made++;
    }
  }
}

function buildBlocks(b: EnvBuilders): void {
  const plots: Plot[] = [];
  for (const blk of b.plan.blocks) plots.push(...planBlock(b, blk));
  assignLandmarks(plots);
  for (const p of plots) buildPlot(b, p);
  buildLinks(b, plots);
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
  if (inDistrict && rng() < BLOCKS.districtScreens.faceChance) {
    // A couple of big screens up the face, never a wall of them: the buildings behind them
    // now carry their own patterns and light, and the screens are the accents.
    const count = m.height > 30 ? BLOCKS.districtScreens.perFace : 1;
    let sy = 8 + rng() * 6;
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
      // The same kit as the blocks, at the middle level of detail: massing, bands and a
      // crown, none of the street furniture. Only the face toward the city meets a street.
      const street: [boolean, boolean, boolean, boolean] = horizontal ? [false, false, inward > 0, inward < 0] : [inward > 0, inward < 0, false, false];
      buildBuilding(
        b,
        { minX: x - bw / 2, maxX: x + bw / 2, minZ: z - bd / 2, maxZ: z + bd / 2 },
        { zone, massing: massingFor(h), height: h, base: 0.22, detail: 'mid', street },
        makeRng(plotSeed(x, z)),
      );
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

  let hero = 0;
  const place = (x: number, z: number, w: number, d: number, h: number, landmark?: number): void => {
    // The backdrop takes the zone of the city edge it stands behind, and the kit's far level
    // of detail: a silhouette with a top band and maybe a mast, nothing the haze would hide.
    const zone = b.plan.zoneAt(cx + (x - cx) * 0.4, cz + (z - cz) * 0.4);
    buildBuilding(
      b,
      { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 },
      { zone, massing: massingFor(h), height: h, base: 0, detail: 'far', ...(landmark !== undefined ? { landmark } : {}) },
      makeRng(plotSeed(x, z) ^ 0x51ab),
    );
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
  // A few hero towers to anchor the horizon, as in the approved reference: the kit's
  // landmark silhouettes, one each.
  place(cx - 52, cz - halfD - 94, 30, 30, 150, hero++);
  place(cx + 38, cz - halfD - 118, 26, 26, 128, hero++);
  place(cx + halfW + 86, cz + 64, 28, 28, 118, hero++);
}

/** The massing band a free-standing height falls in, for buildings the plan did not band. */
function massingFor(h: number): 1 | 2 | 3 | 4 {
  return h < 16 ? 1 : h < 36 ? 2 : h < 66 ? 3 : 4;
}
