import type { RibbonDef } from '../../../world/cityPlan';
import {
  contourBounds,
  headingForward,
  lakeFieldOf,
  LAKE,
  offsetContour,
  PARK_PROP_SIZE,
  PARK_WALL_THICK,
  PLANETARIUM_SIDES,
  PLANETARIUM_STEP,
  triangulate,
  type Contour,
  type LakeField,
  type ParkPropSpec,
  type ParkSidewalkSpec,
  type ParkSpec,
  type Pt,
} from '../../../world/park';
import { createProjection, offsetAtStation, projectOntoPath } from '../../../world/track';
import { GRASS_TILE, groundGlow, halo, type EnvBuilders } from './builders';
import { neonText } from './gasStationBuilder';
import { grimeSurface, paintSurface } from './graffiti';
import { rollLampFault } from './lampFaults';
import { makeRng, type MeshBuilder } from './meshBuilder';
import { PAL } from './palette';
import { canopyTree, crookedTree, fern, palm, sapling, shrub, weeds, willow, type PlantOptions } from './plants';
import { lampPost } from './propsBuilder';
import type { GraffitiSurface, ReclaimProfile } from './reclaim';

/**
 * THE PARKS, drawn (`world/park.ts`): the grass, the lake beds and banks, the islands, the
 * trees in their masses and the tunnels of crowns over the roads, the footpaths and their
 * lamps, the low walls and their paint, the footbridge, the planetarium, the benches and the
 * things the people brought. All of it into the city's own batches, like the meets and the
 * stations: a park costs triangles, never a draw call. The water itself is the one mesh of
 * its own (`environment.ts`, next to the bay), and the people are a crowd
 * (`parkPeopleVisual.ts`).
 *
 * THE LOOK is the reference: a park at night under the city — warm sodium lamps along the
 * roads and paths with dark between them, broad canopies in irregular masses, willows at
 * the water, the lake a dark mirror with the skyline's colour smeared across it, and one
 * landmark, the planetarium's saucer with its ring lit cyan, to steer by. No neon on a tree.
 * The ground rolls (`parkRelief.ts`): the lawn is laid over the terrain cell by cell and shaded
 * a little by its slope, and the loop has a pavement with a row of bollard lamps along it —
 * short warm posts every few metres, the light a driver sees down the lake road at night.
 *
 * COST. Trees are the whole budget: about a thousand of them at ~100 triangles each. They
 * land in the greenery batches, which the metro splits into chunks and culls by distance
 * like everything else, so what is drawn is the stand in front of the car. The scatter is
 * deterministic (a seed per mass) and runs once, at build.
 */

/** Heights laid over the grass (m). */
const Y = { grass: -0.02, path: 0.012, island: 0.02, glow: 0.05 } as const;
/** Grass cells (m): the floor is these, split four ways at a shore. */
const GRASS_CELL = 8;
const SHORE_CELL = 2;
/** Grass: darker and bluer than a leaf, the lawn in the reference under a night sky, after rain. */
const GRASS = 0x4a7053;
const BANK = 0x1f2a1c;
const BED = 0x0b171e;
const WOOD = 0x6a4a2e;
/** How often the footpaths get a lamp (m), and a bench-side lamp's height. */
const PATH_LAMP_STEP = 46;
/** Least spacing between trunks when a mass says nothing (m). */
const SPACING = 7;
/** How far a tree keeps off a road's edge (m), and off the water. */
const TREE_ROAD_CLEAR = 2.2;
const TREE_WATER_CLEAR = 2.5;
/** Tunnels: a tree this far outside the edge every this far along, both sides. */
const TUNNEL_OUT = 2.6;
const TUNNEL_STEP = 8.5;
/** Bollards along a lit footpath (m): between its taller lamps, alternating sides. */
const PATH_BOLLARD_STEP = 13;
/** A bollard lamp: post height and section, the lit head on top (m). */
const BOLLARD = { post: 0.72, section: 0.18, head: 0.16, headSection: 0.24, cap: 0.05, capSection: 0.3, pool: 4.6 } as const;
/** The pavement: its kerb line on the road side, and the darker edging where it meets the lawn (m). */
const SIDEWALK_KERB = 0.45;
const SIDEWALK_EDGING = 0.3;
/** Stations along a pavement (m): short enough to follow the loop's arcs and the ground's roll. */
const SIDEWALK_STEP = 3;
/**
 * The walk's concrete: paler and warmer than a city pavement (`PAL.sidewalk`), which at night is
 * nearly the asphalt's colour. In the reference the lake road's pavement is the pale band that
 * separates the road from the dark lawn, and the bollards' pools land on it.
 */
const WALK = 0x5d6266;
const WALK_KERB = 0x858b8e;
const WALK_EDGING = 0x34393c;
/** Leaf tint for everything planted here (`PlantOptions.lit`): under 1, so the woods stand darker than the street trees, dark masses against the skyline. */
const LIT = 0.82;

/** Painted like a wall the city forgot: heavy paint, some grime. */
const PAINTED: ReclaimProfile = {
  intensity: 0.7,
  level: 2,
  vegetation: 0,
  weeds: 0,
  vines: 0,
  graffiti: 0.95,
  graffitiScale: 0.9,
  decay: 0.6,
  planter: 0,
  bigTree: false,
  grafWall: true,
};

const PROJ = createProjection();

export function buildParks(b: EnvBuilders): void {
  for (const park of b.plan.parks ?? []) buildPark(b, park);
}

function buildPark(b: EnvBuilders, park: ParkSpec): void {
  const rng = makeRng(seedOf(park.tag));
  const field = lakeFieldOf(park);
  const roads = parkRibbons(b, park);
  const paths = park.paths.map((p) => ({ ...p, points: smoothOpen(p.points, 2) }));
  buildGrass(b, park, field);
  for (const lake of park.lakes) buildLake(b, lake.shore, lake.islands, field, rng);
  for (const p of paths) buildPath(b, p.points, p.width ?? 2.6, !!p.lit, rng);
  const sidewalks = (park.sidewalks ?? []).flatMap((sw) => buildSidewalk(b, sw, field, rng));
  // What the trees keep off besides the roads: the footpaths, and the pavements beside the roads.
  const keepOff: Keepout[] = [
    ...paths.map((p) => ({ points: p.points, clear: (p.width ?? 2.6) / 2 + 1.1 })),
    ...sidewalks.map((run) => ({ points: run.points, clear: run.width / 2 + 1.2 })),
  ];
  const placed = new Placed();
  buildTunnels(b, park, roads, field, keepOff, placed, rng);
  buildMasses(b, park, roads, field, keepOff, placed, rng);
  for (const w of park.walls) buildWall(b, w, rng);
  for (const f of park.footbridges) buildFootbridge(b, f);
  for (const l of park.lamps) {
    const y0 = b.plan.padY(l.x, l.z);
    lampPost(b, l.x, l.z, y0, l.dx, l.dz, l.tall ? 3.4 : 0.9, l.tall ? 7.2 : 4.4, PAL.lampWarm, l.tall ? 9 : 5.5, rollLampFault(rng));
  }
  if (park.planetarium) buildPlanetarium(b, park.planetarium.x, park.planetarium.z, park.planetarium.radius, park.planetarium.label, rng);
  for (const pr of park.furniture) buildProp(b, pr);
  for (const e of park.encounters) for (const pr of e.props) buildProp(b, pr);
  buildWaterLight(b, park, field, rng);
}

function seedOf(tag: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < tag.length; i++) h = Math.imul(h ^ tag.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** The ground-level roads inside the park's land, elevated bridge included: what trees keep off. */
function parkRibbons(b: EnvBuilders, park: ParkSpec): RibbonDef[] {
  const l = park.land;
  return b.plan.ribbons.filter((rb) => rb.path.samples.some((s) => s.x > l.minX && s.x < l.maxX && s.z > l.minZ && s.z < l.maxZ));
}

/** Distance from a point to the nearest edge of any of `roads` (negative inside one), and the way off it. */
function roadClearance(roads: readonly RibbonDef[], x: number, z: number): { d: number; ox: number; oz: number } {
  let best = Infinity;
  let ox = 0;
  let oz = 0;
  for (const rb of roads) {
    projectOntoPath(rb.path, x, z, PROJ);
    const d = PROJ.dist - PROJ.halfWidth;
    if (d < best) {
      best = d;
      const len = PROJ.dist || 1;
      ox = (x - PROJ.x) / len;
      oz = (z - PROJ.z) / len;
    }
  }
  return { d: best, ox, oz };
}

/** A quad wound to face up whichever way its corners were given. */
function upQuad(mb: MeshBuilder, a: Pt, ay: number, c: Pt, cy: number, d: Pt, dy: number, e: Pt, ey: number, uv?: [number, number, number, number]): void {
  const nx = (c.x - a.x) * (d.z - a.z) - (c.z - a.z) * (d.x - a.x);
  const [u0, v0, u1, v1] = uv ?? [0, 0, 1, 1];
  // `MeshBuilder.quad` faces +Y when (b - a) x (c - a) has a negative x-z cross (see `planeY`).
  if (nx < 0) mb.quad(a.x, ay, a.z, c.x, cy, c.z, d.x, dy, d.z, e.x, ey, e.z, u0, v0, u1, v1);
  else mb.quad(e.x, ey, e.z, d.x, dy, d.z, c.x, cy, c.z, a.x, ay, a.z, u0, v0, u1, v1);
}

/* ------------------------------------------------------------------ the floor */

/**
 * The lawn: the grass photograph on its own batch (`EnvBuilders.grass`), tiled every
 * `GRASS_TILE` metres in world space so the cells join without a seam.
 * Cells at a shore are split four ways, and any piece whose middle is water is left out: the
 * bank ring covers the seam.
 */
function buildGrass(b: EnvBuilders, park: ParkSpec, field: LakeField): void {
  const l = park.land;
  const cell = GRASS_CELL;
  const padY = b.plan.padY;
  const wet = (x: number, z: number): boolean => field.inWater(x, z);
  const lay = (x0: number, z0: number, x1: number, z1: number): void => {
    const y00 = padY(x0, z0);
    const y10 = padY(x1, z0);
    const y01 = padY(x0, z1);
    const y11 = padY(x1, z1);
    // A little light on the rises and a little dark in the hollows and on the steep faces, so
    // the roll of the land reads at night from the road and not only in silhouette.
    // The faces toward the city (south, +z) catch its glow; the ones away from it are in shade.
    const rise = (y00 + y10 + y01 + y11) / 4;
    const gx = (y10 + y11 - y00 - y01) / (2 * (x1 - x0));
    const gz = (y01 + y11 - y00 - y10) / (2 * (z1 - z0));
    b.grass.color(GRASS, Math.max(0.6, Math.min(1.3, 0.97 + rise * 0.03 - Math.hypot(gx, gz) * 1.2 - gz * 2.2)));
    b.grass.quad(
      x0, y01 + Y.grass, z1, x1, y11 + Y.grass, z1, x1, y10 + Y.grass, z0, x0, y00 + Y.grass, z0,
      x0 / GRASS_TILE, z0 / GRASS_TILE, x1 / GRASS_TILE, z1 / GRASS_TILE,
    );
  };
  for (let z0 = l.minZ; z0 < l.maxZ; z0 += cell) {
    const z1 = Math.min(l.maxZ, z0 + cell);
    for (let x0 = l.minX; x0 < l.maxX; x0 += cell) {
      const x1 = Math.min(l.maxX, x0 + cell);
      const near = x1 > field.bounds.minX && x0 < field.bounds.maxX && z1 > field.bounds.minZ && z0 < field.bounds.maxZ;
      if (!near) {
        lay(x0, z0, x1, z1);
        continue;
      }
      const corners = [wet(x0, z0), wet(x1, z0), wet(x0, z1), wet(x1, z1), wet((x0 + x1) / 2, (z0 + z1) / 2)];
      const wets = corners.filter(Boolean).length;
      // Any cell that touches the water within the bank is split, not just the ones straddling it.
      if (wets === 0 && field.shoreDistance((x0 + x1) / 2, (z0 + z1) / 2) > cell) {
        lay(x0, z0, x1, z1);
        continue;
      }
      if (wets === 5) continue;
      for (let sz = z0; sz < z1; sz += SHORE_CELL) {
        for (let sx = x0; sx < x1; sx += SHORE_CELL) {
          const ex = Math.min(x1, sx + SHORE_CELL);
          const ez = Math.min(z1, sz + SHORE_CELL);
          if (wet((sx + ex) / 2, (sz + ez) / 2)) continue;
          lay(sx, sz, ex, ez);
        }
      }
    }
  }
}

/* ------------------------------------------------------------------ the lake */

/**
 * A lake: the bed as a dark plate at the bottom, the bank as a ring of quads falling from the
 * shore to it, each island the same ring turned outward with a grass top, and reeds along
 * every edge. The water is drawn over all of it by `environment.ts`.
 */
function buildLake(b: EnvBuilders, shore: Contour, islands: readonly Contour[], field: LakeField, rng: () => number): void {
  const bed = -LAKE.depth;
  // The bed.
  b.concrete.color(BED, 1);
  fan(b.concrete, shore, bed);
  // The bank, from the shore down to the bed's edge.
  bank(b, shore, offsetContour(shore, LAKE.bank), 0, bed);
  for (const isl of islands) {
    // An island's bank runs outward and down; its top is grass a hair over the ground.
    bank(b, isl, offsetContour(isl, -LAKE.bank), Y.island, bed);
    b.grass.color(GRASS, 1.05);
    const box = contourBounds(isl);
    fan(b.grass, isl, Y.island, [box.minX / GRASS_TILE, box.minZ / GRASS_TILE, box.maxX / GRASS_TILE, box.maxZ / GRASS_TILE]);
  }
  // Reeds and low growth along the water's edge, on the land side and a little into the shallows.
  for (const edge of [shore, ...islands]) reeds(b, edge, field, rng);
}

/** A contour filled flat at `y`, as its ear-clipped triangles. */
function fan(mb: MeshBuilder, c: Contour, y: number, uv?: [number, number, number, number]): void {
  const tris = triangulate(c);
  const box = contourBounds(c);
  const [u0, v0, u1, v1] = uv ?? [0, 0, 1, 1];
  const u = (p: Pt): number => u0 + ((u1 - u0) * (p.x - box.minX)) / Math.max(1e-6, box.maxX - box.minX);
  const v = (p: Pt): number => v0 + ((v1 - v0) * (p.z - box.minZ)) / Math.max(1e-6, box.maxZ - box.minZ);
  for (let i = 0; i < tris.length; i += 3) {
    const p = c[tris[i]];
    const q = c[tris[i + 1]];
    const r = c[tris[i + 2]];
    // A triangle as a quad with its fourth corner on the first: the second triangle is empty.
    const cross = (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
    if (cross < 0) mb.quad(p.x, y, p.z, q.x, y, q.z, r.x, y, r.z, p.x, y, p.z, u(p), v(p), u(r), v(r));
    else mb.quad(r.x, y, r.z, q.x, y, q.z, p.x, y, p.z, r.x, y, r.z, u(r), v(r), u(p), v(p));
  }
}

/** The ring of quads between two contours of the same length at two heights. */
function bank(b: EnvBuilders, outer: Contour, inner: Contour, yOuter: number, yInner: number): void {
  b.concrete.color(BANK, 1);
  const n = outer.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    upQuad(b.concrete, outer[i], yOuter, outer[j], yOuter, inner[j], yInner, inner[i], yInner);
  }
}

function reeds(b: EnvBuilders, edge: Contour, field: LakeField, rng: () => number): void {
  const n = edge.length;
  for (let i = 0; i < n; i++) {
    const p = edge[i];
    const q = edge[(i + 1) % n];
    const len = Math.hypot(q.x - p.x, q.z - p.z);
    for (let s = rng() * 3; s < len; s += 3 + rng() * 4) {
      const t = s / len;
      const x = p.x + (q.x - p.x) * t;
      const z = p.z + (q.z - p.z) * t;
      // Which way is land: the side the depth field says is dry.
      let nx = -(q.z - p.z) / (len || 1);
      let nz = (q.x - p.x) / (len || 1);
      if (field.inWater(x + nx * 1.5, z + nz * 1.5)) {
        nx = -nx;
        nz = -nz;
      }
      const r = rng();
      if (r < 0.45) {
        weeds(b, x + nx * (0.4 + rng() * 1.2), 0, z + nz * (0.4 + rng() * 1.2), rng, { scale: 1.3 + rng() * 0.8, dry: 0.15, lit: LIT });
      } else if (r < 0.7) {
        fern(b, x + nx * (0.6 + rng() * 1.4), 0, z + nz * (0.6 + rng() * 1.4), rng, { scale: 1.1 + rng() * 0.6, lit: LIT });
      } else if (r < 0.85) {
        shrub(b, x + nx * (1.2 + rng() * 2), 0, z + nz * (1.2 + rng() * 2), rng, { scale: 0.9 + rng() * 0.7, dry: 0.05, lit: LIT });
      } else {
        // In the shallows: reeds standing in the water, their feet on the bank.
        weeds(b, x - nx * (0.6 + rng() * 0.8), -0.22, z - nz * (0.6 + rng() * 0.8), rng, { scale: 1.6 + rng() * 0.9, dry: 0.3, lit: LIT });
      }
    }
  }
}

/* ------------------------------------------------------------------ paths */

/** Chaikin on an open polyline, the ends kept. */
function smoothOpen(points: readonly Pt[], passes: number): Pt[] {
  let out: Pt[] = points.slice();
  for (let k = 0; k < passes; k++) {
    if (out.length < 3) break;
    const next: Pt[] = [out[0]];
    for (let i = 0; i < out.length - 1; i++) {
      const p = out[i];
      const q = out[i + 1];
      next.push({ x: p.x * 0.75 + q.x * 0.25, z: p.z * 0.75 + q.z * 0.25 });
      next.push({ x: p.x * 0.25 + q.x * 0.75, z: p.z * 0.25 + q.z * 0.75 });
    }
    next.push(out[out.length - 1]);
    out = next;
  }
  return out;
}

/** Distance from a point to an open polyline. */
function polylineDistance(points: readonly Pt[], x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const c = points[i + 1];
    const dx = c.x - a.x;
    const dz = c.z - a.z;
    const len2 = dx * dx + dz * dz;
    let t = len2 > 0 ? ((x - a.x) * dx + (z - a.z) * dz) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const d = Math.hypot(a.x + dx * t - x, a.z + dz * t - z);
    if (d < best) best = d;
  }
  return best;
}

/** A footpath: flush concrete, mitred at every vertex, and small warm lamps along it when lit. */
function buildPath(b: EnvBuilders, points: readonly Pt[], width: number, lit: boolean, rng: () => number): void {
  const n = points.length;
  if (n < 2) return;
  const padY = b.plan.padY;
  // Per-vertex normals: the average of the two edges' at each joint, so the quads share their edges.
  const nxs: number[] = [];
  const nzs: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = points[Math.max(0, i - 1)];
    const q = points[Math.min(n - 1, i + 1)];
    const dx = q.x - p.x;
    const dz = q.z - p.z;
    const len = Math.hypot(dx, dz) || 1;
    nxs.push(-dz / len);
    nzs.push(dx / len);
  }
  b.concrete.color(PAL.sidewalk, 1.05);
  const hw = width / 2;
  for (let i = 0; i < n - 1; i++) {
    const a = points[i];
    const c = points[i + 1];
    const al = { x: a.x + nxs[i] * hw, z: a.z + nzs[i] * hw };
    const ar = { x: a.x - nxs[i] * hw, z: a.z - nzs[i] * hw };
    const cl = { x: c.x + nxs[i + 1] * hw, z: c.z + nzs[i + 1] * hw };
    const cr = { x: c.x - nxs[i + 1] * hw, z: c.z - nzs[i + 1] * hw };
    upQuad(b.concrete, al, padY(al.x, al.z) + Y.path, ar, padY(ar.x, ar.z) + Y.path, cr, padY(cr.x, cr.z) + Y.path, cl, padY(cl.x, cl.z) + Y.path);
  }
  if (!lit) return;
  // Bollards: a low warm light every few metres, alternating sides, between the taller posts.
  let next = PATH_BOLLARD_STEP * 0.5;
  let walked = 0;
  let bSide = 1;
  for (let i = 0; i < n - 1; i++) {
    const a = points[i];
    const c = points[i + 1];
    const len = Math.hypot(c.x - a.x, c.z - a.z);
    for (; next < walked + len; next += PATH_BOLLARD_STEP) {
      bSide = -bSide;
      const u = (next - walked) / (len || 1);
      const x = a.x + (c.x - a.x) * u + nxs[i] * bSide * (hw + 0.35);
      const z = a.z + (c.z - a.z) * u + nzs[i] * bSide * (hw + 0.35);
      if (!b.plan.isRoad(x, z, 1)) bollard(b, x, z, rng);
    }
    walked += len;
  }
  // Lamps: taller posts alternating sides, the first one a little way in.
  let since = PATH_LAMP_STEP * 0.4;
  let side = 1;
  for (let i = 0; i < n - 1; i++) {
    const a = points[i];
    const c = points[i + 1];
    const len = Math.hypot(c.x - a.x, c.z - a.z);
    since += len;
    if (since < PATH_LAMP_STEP) continue;
    since = 0;
    side = -side;
    const t = 0.5;
    const x = a.x + (c.x - a.x) * t + nxs[i] * side * (hw + 0.9);
    const z = a.z + (c.z - a.z) * t + nzs[i] * side * (hw + 0.9);
    if (b.plan.isRoad(x, z, 1.2)) continue;
    lampPost(b, x, z, padY(x, z), -nxs[i] * side, -nzs[i] * side, 0.9, 4.4, PAL.lampWarm, 5.5, rollLampFault(rng));
  }
}

/* ------------------------------------------------------------------ pavements and bollards */

/** One continuous stretch of a pavement as drawn: its centreline, for what keeps off it. */
interface SidewalkRun {
  points: Pt[];
  width: number;
}

/**
 * A pavement along a park road (`ParkSidewalkSpec`): flush concrete from the asphalt's edge out,
 * the way the city's are (`trackBuilder.ts`, `buildShoulders`) — a bright kerb line at the road,
 * the slab, a darker edging where it meets the lawn — each corner on the ground under it, so it
 * rides the swells with the road. It breaks where another road crosses and where the bank of a
 * lake would have it over the water, and a bollard stands at its back every so often.
 */
function buildSidewalk(b: EnvBuilders, sw: ParkSidewalkSpec, field: LakeField, rng: () => number): SidewalkRun[] {
  const rb = b.plan.ribbons.find((r) => r.tag === sw.road);
  if (!rb) return [];
  const path = rb.path;
  const L = path.length;
  let s0 = 0;
  let s1 = L;
  if (sw.from) s0 = projectOntoPath(path, sw.from.x, sw.from.z, PROJ).s;
  if (sw.to) s1 = projectOntoPath(path, sw.to.x, sw.to.z, PROJ).s;
  if (path.closed && sw.to && s1 <= s0) s1 += L;
  const steps = Math.max(1, Math.round((s1 - s0) / SIDEWALK_STEP));
  const ds = (s1 - s0) / steps;
  const lift = (rb.lift ?? 0) + 0.012;
  const padY = b.plan.padY;
  const side = sw.side;
  const W = sw.width;

  // Every station: the edge of the asphalt and the way out from it, or null where the pavement breaks.
  type Station = { x: number; z: number; ox: number; oz: number };
  const stations: Array<Station | null> = [];
  for (let k = 0; k <= steps; k++) {
    const s = path.closed ? (((s0 + k * ds) % L) + L) % L : Math.min(L, s0 + k * ds);
    const c = offsetAtStation(path, s, 0);
    const ox = -c.tz * side;
    const oz = c.tx * side;
    const ex = c.x + ox * c.halfWidth;
    const ez = c.z + oz * c.halfWidth;
    const mx = ex + ox * (W / 2);
    const mz = ez + oz * (W / 2);
    const bx = ex + ox * W;
    const bz = ez + oz * W;
    const broken = b.plan.isRoad(mx, mz, 0.6) || b.plan.isRoad(bx, bz, 0.2) || field.inWater(bx, bz) || field.shoreDistance(bx, bz) < 0.8;
    stations.push(broken ? null : { x: ex, z: ez, ox, oz });
  }

  const band = (a: Station, c: Station, o0: number, o1: number): void => {
    const p = (st: Station, o: number): Pt => ({ x: st.x + st.ox * o, z: st.z + st.oz * o });
    const a0 = p(a, o0);
    const a1 = p(a, o1);
    const c0 = p(c, o0);
    const c1 = p(c, o1);
    upQuad(b.concrete, a0, padY(a0.x, a0.z) + lift, a1, padY(a1.x, a1.z) + lift, c1, padY(c1.x, c1.z) + lift, c0, padY(c0.x, c0.z) + lift);
  };

  const runs: SidewalkRun[] = [];
  let current: Pt[] | null = null;
  let sinceBollard = sw.bollards ? sw.bollards * 0.5 : 0;
  for (let k = 0; k < steps; k++) {
    const a = stations[k];
    const c = stations[k + 1];
    if (!a || !c) {
      current = null;
      continue;
    }
    b.concrete.color(WALK_KERB, 1);
    band(a, c, -0.02, SIDEWALK_KERB);
    b.concrete.color(WALK, 1);
    band(a, c, SIDEWALK_KERB, W - SIDEWALK_EDGING);
    b.concrete.color(WALK_EDGING, 1);
    band(a, c, W - SIDEWALK_EDGING, W + 0.08);
    if (!current) {
      current = [{ x: a.x + a.ox * (W / 2), z: a.z + a.oz * (W / 2) }];
      runs.push({ points: current, width: W });
    }
    current.push({ x: c.x + c.ox * (W / 2), z: c.z + c.oz * (W / 2) });
    if (sw.bollards) {
      sinceBollard += Math.abs(ds);
      if (sinceBollard >= sw.bollards) {
        sinceBollard = 0;
        bollard(b, c.x + c.ox * (W - 0.55), c.z + c.oz * (W - 0.55), rng);
      }
    }
  }
  return runs;
}

/**
 * A bollard lamp, Palermo's: a dark square post not quite knee-high on a man, a warm lit head
 * under a flat cap, and the pool of light it throws on the ground round its foot. A handful of
 * triangles in the props, neon and glow batches: hundreds of them cost less than one tree stand.
 */
function bollard(b: EnvBuilders, x: number, z: number, rng: () => number): void {
  const y = b.plan.padY(x, z);
  const B = BOLLARD;
  b.props.color(PAL.metalDark, 1.2);
  b.props.box(x, y + B.post / 2, z, B.section, B.post, B.section);
  // A lamp or two in a long row is out, the way the street lamps' faults have it: dark head, no pool.
  const out = rng() < 0.06;
  b.neon.color(PAL.lampWarm, out ? 0.12 : 0.95);
  b.neon.box(x, y + B.post + B.head / 2, z, B.headSection, B.head, B.headSection);
  b.props.color(PAL.metalDark, 1.45);
  b.props.box(x, y + B.post + B.head + B.cap / 2, z, B.capSection, B.cap, B.capSection);
  if (!out) groundGlow(b, x, z, B.pool, B.pool, PAL.lampWarm, 0.075);
}

/* ------------------------------------------------------------------ trees */

/** Where trunks already stand, on a coarse grid, so the scatter keeps its spacing cheaply. */
class Placed {
  private readonly cells = new Map<number, Pt[]>();
  private key(x: number, z: number): number {
    return Math.floor(x / 16) * 65536 + Math.floor(z / 16) + 32768;
  }
  clear(x: number, z: number, spacing: number): boolean {
    const cx = Math.floor(x / 16);
    const cz = Math.floor(z / 16);
    for (let i = cx - 1; i <= cx + 1; i++) {
      for (let j = cz - 1; j <= cz + 1; j++) {
        const list = this.cells.get(i * 65536 + j + 32768);
        if (!list) continue;
        for (const p of list) if (Math.hypot(p.x - x, p.z - z) < spacing) return false;
      }
    }
    return true;
  }
  add(x: number, z: number): void {
    const k = this.key(x, z);
    let list = this.cells.get(k);
    if (!list) {
      list = [];
      this.cells.set(k, list);
    }
    list.push({ x, z });
  }
}

/** A strip the trees keep off: a footpath or a pavement, as its centreline and how far either side of it. */
interface Keepout {
  points: readonly Pt[];
  clear: number;
}

/** Somewhere a tree may stand: on the land, off the water and its bank, off every road, path, lamp, clearing, wall, podium and meeting place. */
function treeAllowed(
  park: ParkSpec,
  roads: readonly RibbonDef[],
  field: LakeField,
  keepOff: readonly Keepout[],
  x: number,
  z: number,
  waterClear: number,
): { ok: boolean; room: number; ox: number; oz: number } {
  const no = { ok: false, room: 0, ox: 0, oz: 0 };
  const l = park.land;
  if (x < l.minX + 5 || x > l.maxX - 5 || z < l.minZ + 5 || z > l.maxZ - 4) return no;
  if (field.inWater(x, z) || field.shoreDistance(x, z) < waterClear) return no;
  const road = roadClearance(roads, x, z);
  if (road.d < TREE_ROAD_CLEAR) return no;
  for (const k of keepOff) if (polylineDistance(k.points, x, z) < k.clear) return no;
  for (const c of park.clearings) if (Math.hypot(c.x - x, c.z - z) < c.r) return no;
  for (const e of park.encounters) if (Math.hypot(e.x - x, e.z - z) < e.clear) return no;
  for (const lp of park.lamps) if (Math.hypot(lp.x - x, lp.z - z) < 2.5) return no;
  for (const f of park.furniture) if (Math.hypot(f.x - x, f.z - z) < 2.2) return no;
  for (const w of park.walls) if (segmentDistance(w.ax, w.az, w.bx, w.bz, x, z) < 2.2) return no;
  for (const f of park.footbridges) if (segmentDistance(f.ax, f.az, f.bx, f.bz, x, z) < 4) return no;
  if (park.planetarium && Math.hypot(park.planetarium.x - x, park.planetarium.z - z) < park.planetarium.radius + 7) return no;
  return { ok: true, room: Math.min(9, Math.max(1.4, road.d - 0.6)), ox: road.ox, oz: road.oz };
}

function segmentDistance(ax: number, az: number, bx: number, bz: number, x: number, z: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 0 ? ((x - ax) * dx + (z - az) * dz) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(ax + dx * t - x, az + dz * t - z);
}

/** One tree of the mass's kind, sized and leaned by the rng. */
function plantOne(b: EnvBuilders, kind: ParkSpec['masses'][number]['kind'], x: number, z: number, rng: () => number, opts: PlantOptions): void {
  const r = rng();
  const y = b.plan.padY(x, z);
  const o: PlantOptions = { lit: LIT, dense: true, ...opts };
  switch (kind) {
    case 'shrub':
      if (r < 0.7) shrub(b, x, y, z, rng, { ...o, scale: 1.15 + rng() * 0.8, dry: 0.04 });
      else if (r < 0.85) sapling(b, x, y, z, rng, { ...o, scale: 1.6 + rng() * 0.8 });
      else fern(b, x, y, z, rng, { ...o, scale: 1.3 + rng() * 0.7 });
      return;
    case 'willow':
      if (r < 0.7) willow(b, x, y, z, rng, { ...o, scale: 0.9 + rng() * 0.5 });
      else shrub(b, x, y, z, rng, { ...o, scale: 1.2 + rng() * 0.8, dry: 0.05 });
      return;
    case 'palm':
      if (r < 0.7) palm(b, x, y, z, rng, { ...o, scale: 1 + rng() * 0.5, dry: 0.08 });
      else canopyTree(b, x, y, z, rng, { ...o, scale: 1.1 + rng() * 0.4 });
      return;
    case 'mixed':
      if (r < 0.5) canopyTree(b, x, y, z, rng, { ...o, scale: 1 + rng() * 0.55 });
      else if (r < 0.8) crookedTree(b, x, y, z, rng, { ...o, scale: 1.1 + rng() * 0.5 });
      else if (r < 0.9) sapling(b, x, y, z, rng, { ...o, scale: 1.4 + rng() * 0.8 });
      else shrub(b, x, y, z, rng, { ...o, scale: 1.3 + rng() * 0.8, dry: 0.05 });
      return;
    default:
      if (r < 0.78) canopyTree(b, x, y, z, rng, { ...o, scale: 1.05 + rng() * 0.6 });
      else if (r < 0.92) crookedTree(b, x, y, z, rng, { ...o, scale: 1.2 + rng() * 0.5 });
      else shrub(b, x, y, z, rng, { ...o, scale: 1.4 + rng() * 0.8, dry: 0.05 });
  }
}

function buildMasses(
  b: EnvBuilders,
  park: ParkSpec,
  roads: readonly RibbonDef[],
  field: LakeField,
  keepOff: readonly Keepout[],
  placed: Placed,
  rng: () => number,
): void {
  for (const m of park.masses) {
    const mr = makeRng(seedOf(park.tag) ^ (m.seed * 2654435761));
    const spacing = m.spacing ?? SPACING;
    const waterClear = m.kind === 'willow' ? 1.2 : TREE_WATER_CLEAR;
    let planted = 0;
    // Willows want the water: their tries are pulled toward the nearest shore.
    for (let tries = 0; tries < m.count * 6 && planted < m.count; tries++) {
      const a = mr() * Math.PI * 2;
      const rr = Math.sqrt(mr());
      const x = m.x + Math.cos(a) * m.rx * rr;
      const z = m.z + Math.sin(a) * m.rz * rr;
      if (m.kind === 'willow' && field.shoreDistance(x, z) > 9) continue;
      if (!placed.clear(x, z, spacing)) continue;
      const where = treeAllowed(park, roads, field, keepOff, x, z, waterClear);
      if (!where.ok) continue;
      placed.add(x, z);
      planted++;
      // Lean away from the road when there is one near, else any way at all.
      const near = where.room < 6;
      const la = mr() * Math.PI * 2;
      const o: PlantOptions = {
        room: where.room,
        canopyRoom: near ? where.room + 6 : undefined,
        outX: near ? where.ox : Math.cos(la),
        outZ: near ? where.oz : Math.sin(la),
      };
      plantOne(b, m.kind, x, z, mr, o);
    }
    // Low growth in and round a stand: shrubs and ferns under the crowns, thicker at the rim.
    if (m.kind === 'willow' || m.kind === 'shrub') continue;
    const under = Math.max(3, Math.round(m.count * 0.7));
    for (let i = 0; i < under; i++) {
      const a = mr() * Math.PI * 2;
      const rr = i % 2 === 0 ? 0.6 + mr() * 0.5 : Math.sqrt(mr());
      const x = m.x + Math.cos(a) * m.rx * rr;
      const z = m.z + Math.sin(a) * m.rz * rr;
      const where = treeAllowed(park, roads, field, keepOff, x, z, 1.5);
      if (!where.ok) continue;
      const y = b.plan.padY(x, z);
      if (mr() < 0.65) shrub(b, x, y, z, mr, { scale: 1.0 + mr() * 0.8, dry: 0.08, room: where.room, lit: LIT, dense: true });
      else fern(b, x, y, z, mr, { scale: 1.1 + mr() * 0.7, room: where.room, lit: LIT });
    }
    void rng;
  }
}

/** Crowns over the road: big canopy trees close to both edges, leaning in, their spread allowed out over the lanes above a bus's height. */
function buildTunnels(
  b: EnvBuilders,
  park: ParkSpec,
  roads: readonly RibbonDef[],
  field: LakeField,
  keepOff: readonly Keepout[],
  placed: Placed,
  rng: () => number,
): void {
  for (const t of park.tunnels) {
    const rb = b.plan.ribbons.find((r) => r.tag === t.road);
    if (!rb) continue;
    projectOntoPath(rb.path, t.at.x, t.at.z, PROJ);
    const s0 = PROJ.s - t.length / 2;
    const s1 = PROJ.s + t.length / 2;
    let side = 1;
    for (let s = s0; s <= s1; s += TUNNEL_STEP) {
      side = -side;
      const c = offsetAtStation(rb.path, ((s % rb.path.length) + rb.path.length) % rb.path.length, 0);
      let out = c.halfWidth + TUNNEL_OUT + rng() * 1.2;
      let p = offsetAtStation(rb.path, ((s % rb.path.length) + rb.path.length) % rb.path.length, side * out);
      // Where the road has a pavement on this side, the row stands behind it.
      const walk = keepOff.find((k) => polylineDistance(k.points, p.x, p.z) < k.clear);
      if (walk) {
        out += walk.clear * 2 - 1.2;
        p = offsetAtStation(rb.path, ((s % rb.path.length) + rb.path.length) % rb.path.length, side * out);
      }
      if (field.inWater(p.x, p.z) || field.shoreDistance(p.x, p.z) < 2) continue;
      if (roadClearance(roads, p.x, p.z).d < 1.6) continue;
      if (!placed.clear(p.x, p.z, 5)) continue;
      placed.add(p.x, p.z);
      // Away from the road: the opposite of the offset direction.
      const ox = side * -c.tz;
      const oz = side * c.tx;
      canopyTree(b, p.x, b.plan.padY(p.x, p.z), p.z, rng, { scale: 1.35 + rng() * 0.35, room: out - c.halfWidth - 0.6, canopyRoom: out + 8, outX: -ox, outZ: -oz, lit: LIT, dense: true });
    }
  }
}

/* ------------------------------------------------------------------ walls, bridges, props */

function buildWall(b: EnvBuilders, w: ParkSpec['walls'][number], rng: () => number): void {
  const dx = w.bx - w.ax;
  const dz = w.bz - w.az;
  const len = Math.hypot(dx, dz);
  if (len < 0.5) return;
  const tx = dx / len;
  const tz = dz / len;
  const cx = (w.ax + w.bx) / 2;
  const cz = (w.az + w.bz) / 2;
  const h = w.height ?? 0.7;
  const y0 = b.plan.padY(cx, cz);
  b.wall.color(PAL.concrete, w.graffiti ? 1.15 : 0.95);
  b.wall.orientedBox(cx, cz, tx, tz, len, PARK_WALL_THICK, y0 - 0.25, y0 + h, { tile: 4 });
  if (w.graffiti) {
    // Paint on both faces: whoever walks past on either side sees a piece.
    for (const side of [-1, 1]) {
      const nx = -tz * side;
      const nz = tx * side;
      const s: GraffitiSurface = { x: cx + nx * (PARK_WALL_THICK / 2), y: y0, z: cz + nz * (PARK_WALL_THICK / 2), nx, nz, tx: nz, tz: -nx, width: len, height: h, out: 0.03 };
      paintSurface(b, s, PAINTED, seedOf(`${w.ax},${w.az},${side}`));
      grimeSurface(b, s, PAINTED, seedOf(`${w.bx},${w.bz},${side}`), 'streak');
    }
  }
  if (w.rail) {
    b.props.color(PAL.metalDark, 0.9);
    b.props.tube(w.ax, y0 + h + 0.55, w.az, w.bx, y0 + h + 0.55, w.bz, 0.07);
    for (let s = 1; s < len; s += 3) b.props.box(w.ax + tx * s, y0 + h + 0.28, w.az + tz * s, 0.1, 0.56, 0.1);
  }
  void rng;
}

/** An arched footbridge: eight sloped deck pieces rising to a metre and a half over the middle, railed. */
function buildFootbridge(b: EnvBuilders, f: ParkSpec['footbridges'][number]): void {
  const dx = f.bx - f.ax;
  const dz = f.bz - f.az;
  const len = Math.hypot(dx, dz) || 1;
  const tx = dx / len;
  const tz = dz / len;
  const nx = -tz;
  const nz = tx;
  const N = 8;
  const rise = 1.5;
  const yAt = (t: number): number => 0.3 + rise * Math.sin(Math.PI * t);
  const W = 2.4;
  b.wall.color(PAL.concrete, 1.05);
  for (let i = 0; i < N; i++) {
    const t0 = i / N;
    const t1 = (i + 1) / N;
    b.wall.slopedBox(f.ax + dx * t0, f.az + dz * t0, f.ax + dx * t1, f.az + dz * t1, yAt(t0) - 0.22, yAt(t1) - 0.22, W, 0.22);
  }
  // Rails: a top tube each side, posts every deck piece.
  b.props.color(PAL.metalDark, 0.95);
  for (const side of [-1, 1]) {
    for (let i = 0; i < N; i++) {
      const t0 = i / N;
      const t1 = (i + 1) / N;
      const x0 = f.ax + dx * t0 + nx * side * (W / 2 - 0.08);
      const z0 = f.az + dz * t0 + nz * side * (W / 2 - 0.08);
      const x1 = f.ax + dx * t1 + nx * side * (W / 2 - 0.08);
      const z1 = f.az + dz * t1 + nz * side * (W / 2 - 0.08);
      b.props.tube(x0, yAt(t0) + 1.05, z0, x1, yAt(t1) + 1.05, z1, 0.06);
      b.props.box(x0, yAt(t0) + 0.5, z0, 0.08, 1.05, 0.08);
    }
  }
  // A warm strip under each rail, the one light on the water this side of the lamps.
  b.neon.color(PAL.lampWarm, 0.35);
  for (const side of [-1, 1]) {
    const ox = nx * side * (W / 2 + 0.05);
    const oz = nz * side * (W / 2 + 0.05);
    b.neon.tube(f.ax + dx * 0.08 + ox, yAt(0.08) - 0.12, f.az + dz * 0.08 + oz, f.ax + dx * 0.92 + ox, yAt(0.92) - 0.12, f.az + dz * 0.92 + oz, 0.05);
  }
  groundGlow(b, (f.ax + f.bx) / 2, (f.az + f.bz) / 2, Math.abs(tx) > 0.5 ? len : 10, Math.abs(tx) > 0.5 ? 10 : len, PAL.lampWarm, 0.05, LAKE.surfaceY + 0.06);
}

/** A bench, a bin, a speaker, a crate, a cooler: the meet's kind of clutter, on the grass. */
function buildProp(b: EnvBuilders, p: ParkPropSpec): void {
  const { fx, fz } = headingForward(p.heading);
  const y0 = b.plan.padY(p.x, p.z);
  const size = PARK_PROP_SIZE[p.kind];
  // Right of forward.
  const rx = -fz;
  const rz = fx;
  switch (p.kind) {
    case 'bench': {
      // The seat across the heading (a bench faces forward), slats of wood on dark legs, a backrest behind.
      b.props.color(WOOD, 1.0);
      b.props.orientedBox(p.x, p.z, rx, rz, size.along, 0.48, y0 + 0.42, y0 + 0.5);
      b.props.orientedBox(p.x - fx * 0.24, p.z - fz * 0.24, rx, rz, size.along, 0.08, y0 + 0.5, y0 + 0.95);
      b.props.color(PAL.metalDark, 0.7);
      for (const s of [-0.8, 0.8]) {
        b.props.orientedBox(p.x + rx * s, p.z + rz * s, rx, rz, 0.1, 0.44, y0, y0 + 0.42);
      }
      return;
    }
    case 'bin':
      b.props.color(PAL.metalDark, 1.1);
      b.props.orientedBox(p.x, p.z, fx, fz, size.along, size.across, y0, y0 + size.height);
      b.props.color(PAL.rust, 1.2);
      b.props.orientedBox(p.x, p.z, fx, fz, size.along + 0.06, size.across + 0.06, y0 + size.height - 0.12, y0 + size.height);
      return;
    case 'speaker': {
      b.props.color(0x141418, 1.0);
      b.props.orientedBox(p.x, p.z, fx, fz, size.along, size.across, y0, y0 + size.height);
      // A lit dot on the front, and its little pool: the one bit of magenta the park allows itself.
      b.neonPulse.color(PAL.neonMagenta, 0.8);
      b.neonPulse.panel(p.x + fx * (size.along / 2 + 0.01), y0 + 0.5, p.z + fz * (size.along / 2 + 0.01), 0.08, 0.08, Math.atan2(fx, fz));
      groundGlow(b, p.x, p.z, 4, 4, PAL.neonMagenta, 0.08);
      return;
    }
    case 'crate':
      b.props.color(0x5a4632, 1.0);
      b.props.orientedBox(p.x, p.z, fx, fz, size.along, size.across, y0, y0 + size.height);
      return;
    default:
      b.props.color(0x2d6fb8, 1.0);
      b.props.orientedBox(p.x, p.z, fx, fz, size.along, size.across, y0, y0 + size.height - 0.08);
      b.props.color(0xd8d8d0, 1.0);
      b.props.orientedBox(p.x, p.z, fx, fz, size.along + 0.04, size.across + 0.04, y0 + size.height - 0.08, y0 + size.height);
  }
}

/* ------------------------------------------------------------------ the planetarium */

/**
 * After Palermo's: a round podium with steps, three legs and a core, a saucer, and the dome
 * on top of it, the ring under the dome lit cyan and breathing, the name in magenta tubes on
 * the podium's face toward the city. No more light than that: it has to be the one thing in
 * the park that glows, not one more.
 */
function buildPlanetarium(b: EnvBuilders, x: number, z: number, R: number, label: string, rng: () => number): void {
  const N = PLANETARIUM_SIDES;
  const y0 = b.plan.padY(x, z);
  // Everything is drawn for a 24 m podium and grows with the spec's radius, so the building
  // keeps its proportions at whatever size the park asks for.
  const S = R / 24;
  const ring = (r: number): Contour => {
    const out: Contour = [];
    for (let i = 0; i < N; i++) out.push({ x: x + Math.cos((i / N) * Math.PI * 2) * r, z: z + Math.sin((i / N) * Math.PI * 2) * r });
    return out;
  };
  /** A drum wall between two heights at radius `r`, faces out. */
  const drum = (mb: MeshBuilder, r: number, ya: number, yb: number): void => {
    const c = ring(r);
    for (let i = 0; i < N; i++) {
      const p = c[i];
      const q = c[(i + 1) % N];
      mb.quad(q.x, ya, q.z, p.x, ya, p.z, p.x, yb, p.z, q.x, yb, q.z, 0, 0, 1, 1);
    }
  };
  /** A cone between two rings at two heights (a saucer's underside, a step's riser). */
  const cone = (mb: MeshBuilder, r0: number, ya: number, r1: number, yb: number): void => {
    const a = ring(r0);
    const c = ring(r1);
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      mb.quad(a[j].x, ya, a[j].z, a[i].x, ya, a[i].z, c[i].x, yb, c[i].z, c[j].x, yb, c[j].z, 0, 0, 1, 1);
    }
  };
  /** A flat annulus at `y` between two radii, facing up; `r1` 0 is a disc. */
  const annulus = (mb: MeshBuilder, r0: number, r1: number, y: number): void => {
    const a = ring(r0);
    const c = r1 > 0 ? ring(r1) : null;
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      if (c) upQuad(mb, a[i], y, a[j], y, c[j], y, c[i], y);
      else upQuad(mb, a[i], y, a[j], y, { x, z }, y, { x, z }, y);
    }
  };
  // The podium: two steps and the top, pale concrete.
  const step = R * (PLANETARIUM_STEP - 1);
  const tread = y0 + 0.42 * S;
  const top = y0 + 0.95 * S;
  b.wall.color(PAL.concrete, 1.0);
  drum(b.wall, R + step, y0 - 0.3, tread);
  drum(b.wall, R, tread, top);
  b.concrete.color(PAL.sidewalk, 1.1);
  annulus(b.concrete, R + step, R, tread);
  annulus(b.concrete, R, 0, top);
  // The core and the three legs.
  const base = top;
  const saucerY = base + 6.6 * S;
  b.wall.color(PAL.concrete, 0.85);
  drum(b.wall, 4.2 * S, base, saucerY + 0.2 * S);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + Math.PI / 2;
    const lx = x + Math.cos(a) * 9 * S;
    const lz = z + Math.sin(a) * 9 * S;
    b.wall.orientedBox(lx, lz, Math.cos(a), Math.sin(a), 1.7 * S, 1.4 * S, base, saucerY + 0.3 * S);
  }
  // The lobby: a warm band of glass round the core, at the foot of the legs.
  b.neon.color(PAL.winWarm, 0.28);
  drum(b.neon, 4.28 * S, base + 0.9 * S, base + 3.1 * S);
  // The saucer: underside cone up to the rim, the rim's drum, the deck on top.
  b.wall.color(0x2c3a46, 0.9);
  cone(b.wall, 5.5 * S, saucerY - 1.4 * S, 15.5 * S, saucerY);
  drum(b.wall, 15.5 * S, saucerY, saucerY + 1.7 * S);
  b.concrete.color(PAL.curb, 1.2);
  annulus(b.concrete, 15.5 * S, 12.6 * S, saucerY + 1.7 * S);
  // The dome: five rings of facets up to the pole.
  const domeR = 12.6 * S;
  const domeY = saucerY + 1.7 * S;
  const rings = 5;
  b.wall.color(0x1c2a36, 0.85);
  for (let k = 0; k < rings; k++) {
    const a0 = (k / rings) * (Math.PI / 2);
    const a1 = ((k + 1) / rings) * (Math.PI / 2);
    const r0 = Math.cos(a0) * domeR;
    const r1 = Math.cos(a1) * domeR;
    const h0 = domeY + Math.sin(a0) * domeR * 0.78;
    const h1 = domeY + Math.sin(a1) * domeR * 0.78;
    if (k === rings - 1) {
      // The cap: triangles to the pole.
      const c = ring(r0);
      for (let i = 0; i < N; i++) {
        const j = (i + 1) % N;
        b.wall.quad(c[j].x, h0, c[j].z, c[i].x, h0, c[i].z, x, h1, z, x, h1, z, 0, 0, 1, 1);
      }
    } else cone(b.wall, r0, h0, r1, h1);
  }
  // The ring: cyan, breathing, under the dome's foot, with a halo each way and a wash on the lawn.
  const rc = ring(15.7 * S);
  b.neonPulse.color(PAL.neonCyan, 0.9);
  for (let i = 0; i < N; i++) {
    const p = rc[i];
    const q = rc[(i + 1) % N];
    b.neonPulse.tube(p.x, saucerY + 1.85 * S, p.z, q.x, saucerY + 1.85 * S, q.z, 0.22 * S);
  }
  for (let k = 0; k < 4; k++) {
    const rot = (k * Math.PI) / 2 + Math.PI / 4;
    halo(b, x + Math.sin(rot) * 16.5 * S, saucerY + 1.6 * S, z + Math.cos(rot) * 16.5 * S, 22 * S, 7 * S, rot, PAL.neonCyan, 0.1);
  }
  b.glow.color(PAL.neonCyan, 0.09);
  b.glow.planeY(x, saucerY - 1.5 * S, z, 34 * S, 34 * S);
  groundGlow(b, x, z, R * 3.2, R * 3.2, PAL.neonCyan, 0.05, 0.03);
  // The name, on the podium's south face, in magenta tubes; a red beacon on the pole.
  neonText(b.neon, label, x, y0 + 1.25 * S, z + R + step + 0.02, 0, 1, 0.9 * S, PAL.neonMagenta, 0.8);
  groundGlow(b, x, z + R + 6 * S, 16 * S, 8 * S, PAL.neonMagenta, 0.06);
  b.neonFlicker.color(0xff2e2e, 1);
  b.neonFlicker.box(x, domeY + domeR * 0.78 + 0.5 * S, z, 0.3 * S, 0.3 * S, 0.3 * S);
  void rng;
}

/* ------------------------------------------------------------------ light on the water */

/**
 * The skyline in the lake: long streaks in the city's colours running away from the south
 * shore toward the north, the way the bay does it, and warm smears under the lamps that stand
 * near the water. A few quads for the whole reflection; the wet-road mirror adds the facades
 * and the neon on top.
 */
function buildWaterLight(b: EnvBuilders, park: ParkSpec, field: LakeField, rng: () => number): void {
  const y = LAKE.surfaceY + Y.glow;
  for (const lake of park.lakes) {
    const box = contourBounds(lake.shore);
    let laid = 0;
    for (let tries = 0; tries < 600 && laid < 40; tries++) {
      const x = box.minX + rng() * (box.maxX - box.minX);
      const z = box.minZ + rng() * (box.maxZ - box.minZ);
      if (field.depthAt(x, z) < LAKE.depth * 0.9) continue;
      const len = 26 + rng() * 60;
      // The streak runs north-south (the city is south of the park); it must stay in the water.
      if (field.depthAt(x, z - len / 2) < 0.4 || field.depthAt(x, z + len / 2) < 0.4) continue;
      const r = rng();
      const c = r < 0.4 ? PAL.neonCyan : r < 0.7 ? PAL.neonMagenta : r < 0.85 ? PAL.neonViolet : PAL.lampWarm;
      groundGlow(b, x, z, 1.5 + rng() * 4, len, c, 0.06 + rng() * 0.08, y);
      laid++;
    }
    // A violet wash over the whole lake, the sky's own colour in it.
    groundGlow(b, (box.minX + box.maxX) / 2, (box.minZ + box.maxZ) / 2, (box.maxX - box.minX) * 0.9, (box.maxZ - box.minZ) * 0.9, PAL.neonViolet, 0.045, y - 0.01);
  }
  // The lamps by the water throw warm light onto it.
  for (const l of park.lamps) {
    if (field.shoreDistance(l.x, l.z) > 14 || field.inWater(l.x, l.z)) continue;
    groundGlow(b, l.x, l.z, 12, 12, PAL.lampWarm, 0.05, y);
  }
}
