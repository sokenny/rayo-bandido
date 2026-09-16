import type { ObstacleBox, ObstacleWall, SurfaceSample } from '../core/types';
import type { MeetPersonSpec } from './carMeet';
import type { Rect } from './cityPlan';

/**
 * A PARK: a district the city gives up for grass, water and trees instead of blocks. The first
 * one is Bandido Metro's north edge (`metroPark.ts`, after Buenos Aires' Bosques de Palermo):
 * two lakes joined by a strait, a loop road round them with a cross road over a short bridge,
 * a planetarium on a lawn, and the people who spend their nights there.
 *
 * Data only, plus the pure geometry a park needs and nothing else in the city has: a lake is
 * an irregular polygon, so this file carries the point-in-polygon test, the distance to a
 * shore, an ear-clipping triangulation (the water surface and the minimap both draw the
 * same triangles) and the DEPTH FIELD the simulation drives on (`createLakeField`). The
 * assembler (`cityWorld.ts`) makes the colliders from `parkColliders` and hands the depth
 * field to the surface field; the art (`render/scene/env/parkBuilder.ts`) draws from the same
 * spec. What can be seen, what can be hit and where the car sinks are one set of numbers.
 *
 * No runtime imports: `scripts/metro-preview.mjs` loads the metro's spec under plain Node.
 */

export interface Pt {
  x: number;
  z: number;
}

/** A closed contour, listed once round (the last point joins the first). */
export type Contour = Pt[];

export interface LakeSpec {
  tag: string;
  /** The shore. Irregular, simple (never self-crossing). */
  shore: Contour;
  /** Islands inside it: land again, with their own banks. */
  islands: Contour[];
}

/** How a lake falls away from its shore, the same for every lake. */
export const LAKE = {
  /** Water surface height (m): the Bay's half metre under the streets, which the wet-road mirror still lets through. */
  surfaceY: -0.55,
  /** The bed: how deep the bowl goes (m). A car in it is up to its windows in water. */
  depth: 1.6,
  /** How far in from the shore the bed is reached (m): the bank's run. */
  bank: 5,
  /** Depth past which a car is in the water rather than on the bank (`ArenaLayout.waterDepth`). */
  swim: 0.7,
} as const;

/** A stand of trees: a blob of `count` plants scattered inside an ellipse, jittered by `seed`. */
export interface TreeMassSpec {
  x: number;
  z: number;
  rx: number;
  rz: number;
  count: number;
  /** 'broad': canopy trees with some crooked ones · 'mixed': everything · 'willow': willows and shrubs, for a shore · 'palm': palms and broad trees · 'shrub': bushes, for a lawn's edge. */
  kind: 'broad' | 'mixed' | 'willow' | 'palm' | 'shrub';
  seed: number;
  /** Least spacing between trunks (m). Missing: 7. */
  spacing?: number;
}

/** A stretch of a road the crowns close over: `length` metres of the road tagged `road`, centred on the station nearest `at`. */
export interface TunnelSpec {
  road: string;
  at: Pt;
  length: number;
}

/** A footpath: a polyline of concrete, smoothed, `width` wide (missing: 2.6). */
export interface PathSpec {
  points: Pt[];
  width?: number;
  /** Lamps along it, every so often: a post now and then, and bollards between. */
  lit?: boolean;
}

/** A low wall: a parapet by the water, a painted wall behind a bench, the park's edge. Solid. */
export interface LowWallSpec {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  /** Height (m). Missing: 0.7. */
  height?: number;
  /** Paint on it, on the side (nx, nz) faces. Missing: bare. */
  graffiti?: boolean;
  /** A tubular rail along the top: a parapet by the water. */
  rail?: boolean;
}

/** A short arched footbridge from (ax, az) to (bx, bz): over a strait, or out to an island. */
export interface FootbridgeSpec {
  ax: number;
  az: number;
  bx: number;
  bz: number;
}

/** A park lamp on its own, off the roads: by a bench, along a path, at a meeting place. Warm. */
export interface ParkLampSpec {
  x: number;
  z: number;
  /** Which way the arm points. */
  dx: number;
  dz: number;
  /** Missing: a short path lamp. */
  tall?: boolean;
}

export interface PlanetariumSpec {
  x: number;
  z: number;
  /** The podium's radius (m): the footprint the car cannot enter. */
  radius: number;
  label: string;
}

/**
 * One person in the park. The meet's person (`carMeet.ts`, `MeetPersonSpec`) with a name and,
 * for the characters who are somebody, a look of their own laid over the seed's
 * (`render/scene/parkPeopleVisual.ts`). Ambience for now: presence, a pose, an idle act.
 * Dialogue and interaction hang off the encounter later, the way the garage's owner got his.
 */
export interface ParkPersonSpec extends MeetPersonSpec {
  /** Who they are, for the tools and for whoever writes their lines. */
  name: string;
  /** Distinguishing looks, over what the seed picks: hair, coat, height, a lit band, a phone. */
  look?: ParkLook;
}

/** The handful of `HumanLook` fields a character is recognised by, kept here so this module stays free of the renderer's types. */
export interface ParkLook {
  height?: number;
  build?: number;
  skin?: number;
  hair?: number;
  hairAccent?: number;
  head?: 'crop' | 'fringe' | 'mop' | 'tied' | 'cap' | 'capBack' | 'hood' | 'bucket';
  coat?: number;
  coatLength?: number;
  legs?: number;
  boots?: number;
  shorts?: boolean;
  shortSleeves?: boolean;
  sleeveless?: boolean;
  legStripe?: number;
  tattoo?: number;
  band?: number;
  phone?: number;
  aura?: number;
}

export type ParkPropKind = 'bench' | 'bin' | 'speaker' | 'crate' | 'cooler';

export interface ParkPropSpec {
  kind: ParkPropKind;
  x: number;
  z: number;
  heading: number;
}

/**
 * A meeting place: a few people and what they brought, at a spot chosen by hand. Everything
 * about it is data — where, who, which way they face, what they are doing — so a dialogue or
 * a deal can be hung on it later without moving anybody.
 */
export interface ParkEncounterSpec {
  id: string;
  label: string;
  /** Roughly where it is: what the tools mark, and what the art keeps the trees clear of. */
  x: number;
  z: number;
  /** Radius the trees keep clear of it (m). */
  clear: number;
  people: ParkPersonSpec[];
  props: ParkPropSpec[];
}

/** A rise of the park's ground: a raised cosine `height` metres high at (x, z), 0 at `rx` / `rz` (`terrain.ts`, `HillDef`). */
export interface ParkRiseSpec {
  x: number;
  z: number;
  rx: number;
  rz: number;
  height: number;
}

/**
 * The lie of a park's land (`parkRelief.ts`). Two kinds of rise, because a road and a lawn
 * want different ones:
 *
 *  - SWELLS are broad and gentle — a few metres over a hundred and more — and the roads ride
 *    them: the loop climbs away from the water and comes back down to it,
 *  - KNOLLS are the lawn's own hillocks, steeper and a few tens of metres across, and they die
 *    away before they reach an asphalt edge or its pavement, so a road never leans on one.
 *
 * Both are held level at the water, round the planetarium, at every meeting place and bench,
 * and along the land's edge. A park without one is level, as parks were before.
 */
export interface ParkReliefSpec {
  swells: ParkRiseSpec[];
  knolls: ParkRiseSpec[];
}

/**
 * A pavement along a park road (`parkBuilder.ts`): flush concrete from the asphalt's edge out
 * `width` metres, a bright kerb line on the road side, and a row of bollard lamps along the
 * back. `from` / `to` pick a stretch by the stations nearest them (missing: the whole road);
 * `side` +1 is the right of the road's direction of travel — the inside, on a clockwise loop.
 * Art only: the car feels the ground it stands on, which is the terrain, as on every street.
 */
export interface ParkSidewalkSpec {
  road: string;
  side: 1 | -1;
  width: number;
  from?: Pt;
  to?: Pt;
  /** Bollard lamps along the back edge every so many metres. Missing: none. */
  bollards?: number;
}

export interface ParkSpec {
  tag: string;
  label: string;
  /** The land: no blocks are generated on it, and the grass is drawn over it. Level, unless `relief` rolls it. */
  land: Rect;
  /** The hills of the land (`parkRelief.ts`). Missing: level. */
  relief?: ParkReliefSpec;
  /** Pavements along the park's roads. Missing: none, the grass runs to the asphalt. */
  sidewalks?: ParkSidewalkSpec[];
  lakes: LakeSpec[];
  masses: TreeMassSpec[];
  tunnels: TunnelSpec[];
  paths: PathSpec[];
  walls: LowWallSpec[];
  footbridges: FootbridgeSpec[];
  lamps: ParkLampSpec[];
  planetarium: PlanetariumSpec | null;
  encounters: ParkEncounterSpec[];
  /** Benches and bins on their own, along the paths: solid, like an encounter's. */
  furniture: ParkPropSpec[];
  /** Clearings the trees stay out of besides the roads, the water, the paths and the encounters: lawns with a view. */
  clearings: Array<{ x: number; z: number; r: number }>;
}

/* ------------------------------------------------------------------ contours */

/** Signed area by the shoelace, in (x, z). Negative is the winding whose triangles face up (`MeshBuilder.quad`). */
export function signedArea(c: Contour): number {
  let a = 0;
  for (let i = 0; i < c.length; i++) {
    const p = c[i];
    const q = c[(i + 1) % c.length];
    a += p.x * q.z - q.x * p.z;
  }
  return a / 2;
}

/** The same contour, wound so its triangles face up. */
export function windUp(c: Contour): Contour {
  return signedArea(c) < 0 ? c : c.slice().reverse();
}

/**
 * Chaikin's corner cutting, `passes` times: a hand-drawn polygon of a dozen control points
 * becomes a smooth, still irregular shore of four times as many. Closed.
 */
export function smoothContour(c: Contour, passes = 2): Contour {
  let out = c;
  for (let k = 0; k < passes; k++) {
    const next: Contour = [];
    for (let i = 0; i < out.length; i++) {
      const p = out[i];
      const q = out[(i + 1) % out.length];
      next.push({ x: p.x * 0.75 + q.x * 0.25, z: p.z * 0.75 + q.z * 0.25 });
      next.push({ x: p.x * 0.25 + q.x * 0.75, z: p.z * 0.25 + q.z * 0.75 });
    }
    out = next;
  }
  return out;
}

/**
 * A rough ellipse of `n` points about (cx, cz), its radius wobbled by a couple of low
 * harmonics so it reads as an island and never as a stamp. `seed` picks the phases.
 */
export function blobContour(cx: number, cz: number, rx: number, rz: number, n: number, seed: number): Contour {
  const p1 = seed * 1.7;
  const p2 = seed * 2.9;
  const p3 = seed * 0.6;
  const out: Contour = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const w = 1 + 0.12 * Math.sin(2 * a + p1) + 0.08 * Math.sin(3 * a + p2) + 0.05 * Math.sin(5 * a + p3);
    out.push({ x: cx + Math.cos(a) * rx * w, z: cz + Math.sin(a) * rz * w });
  }
  return out;
}

export function contourBounds(c: Contour): Rect {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of c) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  return { minX, maxX, minZ, maxZ };
}

/** Ray casting: true inside the contour. */
export function insideContour(c: Contour, x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = c.length - 1; i < c.length; j = i++) {
    const a = c[i];
    const b = c[j];
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/** Distance from a point to the contour's nearest edge. */
export function contourDistance(c: Contour, x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i < c.length; i++) {
    const a = c[i];
    const b = c[(i + 1) % c.length];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len2 = dx * dx + dz * dz;
    let t = len2 > 0 ? ((x - a.x) * dx + (z - a.z) * dz) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = a.x + dx * t - x;
    const pz = a.z + dz * t - z;
    const d2 = px * px + pz * pz;
    if (d2 < best) best = d2;
  }
  return Math.sqrt(best);
}

/**
 * The contour moved along its own normals by `d`: inward for a positive `d` on an up-wound
 * contour. A bowl's inner ring, an island's foot.
 */
export function offsetContour(c: Contour, d: number): Contour {
  const n = c.length;
  const sign = signedArea(c) < 0 ? 1 : -1;
  const out: Contour = [];
  for (let i = 0; i < n; i++) {
    const p = c[(i - 1 + n) % n];
    const q = c[i];
    const r = c[(i + 1) % n];
    // Normals of the two edges at this vertex, averaged. Right of (dx, dz) is (-dz, dx).
    let ax = q.x - p.x;
    let az = q.z - p.z;
    let al = Math.hypot(ax, az) || 1;
    ax /= al;
    az /= al;
    let bx = r.x - q.x;
    let bz = r.z - q.z;
    let bl = Math.hypot(bx, bz) || 1;
    bx /= bl;
    bz /= bl;
    let nx = -(az + bz);
    let nz = ax + bx;
    const nl = Math.hypot(nx, nz) || 1;
    nx /= nl;
    nz /= nl;
    // Which way is in: for an up-wound (clockwise on the map) contour the right-hand normal points out.
    out.push({ x: q.x - sign * nx * d, z: q.z - sign * nz * d });
  }
  return out;
}

/**
 * Ear clipping: the triangles of a simple polygon, as index triples into `c`, wound like `c`.
 * Quadratic in the point count, which is fine for a shore of a hundred points built once.
 */
export function triangulate(c: Contour): number[] {
  const n = c.length;
  if (n < 3) return [];
  const clockwise = signedArea(c) < 0;
  const idx: number[] = [];
  for (let i = 0; i < n; i++) idx.push(i);
  const out: number[] = [];
  const cross = (a: Pt, b: Pt, p: Pt): number => (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x);
  const convex = (a: Pt, b: Pt, p: Pt): boolean => (clockwise ? cross(a, b, p) < 0 : cross(a, b, p) > 0);
  const inTri = (a: Pt, b: Pt, p: Pt, t: Pt): boolean => {
    const s1 = cross(a, b, t);
    const s2 = cross(b, p, t);
    const s3 = cross(p, a, t);
    const neg = s1 < 0 || s2 < 0 || s3 < 0;
    const pos = s1 > 0 || s2 > 0 || s3 > 0;
    return !(neg && pos);
  };
  let guard = 0;
  while (idx.length > 3 && guard++ < n * n) {
    let cut = false;
    for (let k = 0; k < idx.length; k++) {
      const i0 = idx[(k - 1 + idx.length) % idx.length];
      const i1 = idx[k];
      const i2 = idx[(k + 1) % idx.length];
      const a = c[i0];
      const b = c[i1];
      const p = c[i2];
      if (!convex(a, b, p)) continue;
      let clear = true;
      for (const j of idx) {
        if (j === i0 || j === i1 || j === i2) continue;
        if (inTri(a, b, p, c[j])) {
          clear = false;
          break;
        }
      }
      if (!clear) continue;
      out.push(i0, i1, i2);
      idx.splice(k, 1);
      cut = true;
      break;
    }
    // A degenerate contour (collinear runs): cut the first ear regardless rather than spin.
    if (!cut) {
      out.push(idx[0], idx[1], idx[2]);
      idx.splice(1, 1);
    }
  }
  if (idx.length === 3) out.push(idx[0], idx[1], idx[2]);
  return out;
}

/* ------------------------------------------------------------------ the depth field */

export interface LakeField {
  /** How far below the ground the bed is here (m): 0 on land and on an island, `LAKE.depth` in the middle. */
  depthAt(x: number, z: number): number;
  /** Depth and its gradient, for the surface field. Allocation-free. */
  sample(x: number, z: number, out: SurfaceSample): void;
  /** True inside the shore and outside every island: the water, bank included. */
  inWater(x: number, z: number): boolean;
  /** Distance to the nearest shore or island edge (m), on either side of it. */
  shoreDistance(x: number, z: number): number;
  /** The rectangle everything above can be non-zero in. */
  readonly bounds: Rect;
}

/** Grid cell of the depth field (m): the bank is two and a half cells wide, and the bilinear read between them is the slope. */
const FIELD_CELL = 2;
const FIELD_PAD = 8;

/** A field that says "dry land everywhere", for a park without a lake and for worlds without a park. */
export const DRY_FIELD: LakeField = {
  depthAt: () => 0,
  sample(_x, _z, out) {
    out.y = 0;
    out.gx = 0;
    out.gz = 0;
  },
  inWater: () => false,
  shoreDistance: () => Infinity,
  bounds: { minX: 0, maxX: 0, minZ: 0, maxZ: 0 },
};

/**
 * The depth of the water under every point of a park, on a grid computed once. Inside a shore
 * and outside its islands the bed falls from 0 at the water's edge to `LAKE.depth` over
 * `LAKE.bank` metres; everywhere else 0. The surface field subtracts it from the ground, so a
 * car that leaves the road by a lake rolls down the bank into the water instead of driving on
 * it (`cityWorld.ts` hands `layout.waterDepth` to the game, which sinks the car and calls the
 * recovery).
 */
export function createLakeField(lakes: readonly LakeSpec[]): LakeField {
  if (lakes.length === 0) return DRY_FIELD;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const l of lakes) {
    const r = contourBounds(l.shore);
    minX = Math.min(minX, r.minX);
    maxX = Math.max(maxX, r.maxX);
    minZ = Math.min(minZ, r.minZ);
    maxZ = Math.max(maxZ, r.maxZ);
  }
  const bounds: Rect = { minX: minX - FIELD_PAD, maxX: maxX + FIELD_PAD, minZ: minZ - FIELD_PAD, maxZ: maxZ + FIELD_PAD };
  const cell = FIELD_CELL;
  const nx = Math.ceil((bounds.maxX - bounds.minX) / cell) + 1;
  const nz = Math.ceil((bounds.maxZ - bounds.minZ) / cell) + 1;
  const depth = new Float32Array(nx * nz);
  const lakeBoxes = lakes.map((l) => contourBounds(l.shore));
  const slope = LAKE.depth / LAKE.bank;

  const wet = (x: number, z: number): LakeSpec | null => {
    for (let k = 0; k < lakes.length; k++) {
      const r = lakeBoxes[k];
      if (x < r.minX || x > r.maxX || z < r.minZ || z > r.maxZ) continue;
      const l = lakes[k];
      if (!insideContour(l.shore, x, z)) continue;
      let island = false;
      for (const isl of l.islands) {
        if (insideContour(isl, x, z)) {
          island = true;
          break;
        }
      }
      if (!island) return l;
    }
    return null;
  };
  const edgeDistance = (x: number, z: number): number => {
    let best = Infinity;
    for (let k = 0; k < lakes.length; k++) {
      const r = lakeBoxes[k];
      // A lake whose box is further off than the best so far cannot beat it.
      const dx = Math.max(r.minX - x, 0, x - r.maxX);
      const dz = Math.max(r.minZ - z, 0, z - r.maxZ);
      if (Math.hypot(dx, dz) >= best) continue;
      const l = lakes[k];
      best = Math.min(best, contourDistance(l.shore, x, z));
      for (const isl of l.islands) best = Math.min(best, contourDistance(isl, x, z));
    }
    return best;
  };

  for (let j = 0; j < nz; j++) {
    const z = bounds.minZ + j * cell;
    for (let i = 0; i < nx; i++) {
      const x = bounds.minX + i * cell;
      if (!wet(x, z)) continue;
      depth[j * nx + i] = Math.min(LAKE.depth, edgeDistance(x, z) * slope);
    }
  }

  const depthAt = (x: number, z: number): number => {
    if (x <= bounds.minX || x >= bounds.maxX || z <= bounds.minZ || z >= bounds.maxZ) return 0;
    const fx = (x - bounds.minX) / cell;
    const fz = (z - bounds.minZ) / cell;
    let i = Math.floor(fx);
    let j = Math.floor(fz);
    if (i > nx - 2) i = nx - 2;
    if (j > nz - 2) j = nz - 2;
    const u = fx - i;
    const v = fz - j;
    const k = j * nx + i;
    return (depth[k] * (1 - u) + depth[k + 1] * u) * (1 - v) + (depth[k + nx] * (1 - u) + depth[k + nx + 1] * u) * v;
  };
  const d = 0.5;
  return {
    bounds,
    depthAt,
    sample(x, z, out) {
      out.y = depthAt(x, z);
      out.gx = (depthAt(x + d, z) - depthAt(x - d, z)) / (2 * d);
      out.gz = (depthAt(x, z + d) - depthAt(x, z - d)) / (2 * d);
    },
    inWater: (x, z) => wet(x, z) !== null,
    shoreDistance: edgeDistance,
  };
}

/** One field per spec, built once: the assembler, the art and the tests all ask for the same one. */
const FIELDS = new WeakMap<ParkSpec, LakeField>();
export function lakeFieldOf(park: ParkSpec): LakeField {
  let f = FIELDS.get(park);
  if (!f) {
    f = createLakeField(park.lakes);
    FIELDS.set(park, f);
  }
  return f;
}

/* ------------------------------------------------------------------ solids */

/** Sizes of the props (m), along and across their heading, and how tall they are solid. */
export const PARK_PROP_SIZE: Record<ParkPropKind, { along: number; across: number; height: number }> = {
  bench: { along: 2.0, across: 0.7, height: 0.95 },
  bin: { along: 0.55, across: 0.55, height: 1.0 },
  speaker: { along: 0.5, across: 0.4, height: 0.7 },
  crate: { along: 0.8, across: 0.6, height: 0.6 },
  cooler: { along: 0.7, across: 0.45, height: 0.5 },
};

/** How far a person is solid round their feet (m), the meet's. */
const PERSON_HALF = 0.35;
/** The low walls' thickness (m). */
export const PARK_WALL_THICK = 0.36;
/** A footbridge is solid at its two feet only: the rest of it is over the water. */
const FOOTBRIDGE_FOOT = 2.2;
/** Sides of the planetarium's podium collider. */
export const PLANETARIUM_SIDES = 24;
/** The podium's lower step, as a multiple of its radius. */
export const PLANETARIUM_STEP = 1.1;

export function headingForward(heading: number): { fx: number; fz: number } {
  return { fx: Math.sin(heading), fz: -Math.cos(heading) };
}

/** The four corners of a box `halfAlong` by `halfAcross` at (x, z) facing (fx, fz), anticlockwise from its back left. */
function corners(x: number, z: number, fx: number, fz: number, halfAlong: number, halfAcross: number): Pt[] {
  const rx = -fz;
  const rz = fx;
  const at = (a: number, c: number): Pt => ({ x: x + fx * a + rx * c, z: z + fz * a + rz * c });
  return [at(-halfAlong, -halfAcross), at(halfAlong, -halfAcross), at(halfAlong, halfAcross), at(-halfAlong, halfAcross)];
}

/**
 * The colliders of a park: its low walls, the planetarium's podium, the footbridges' feet, and
 * the people and props at every encounter. Every turned box is its four sides as walls, the
 * way a meet's parked cars are, so what is solid is what is drawn.
 */
export function parkColliders(park: ParkSpec): { boxes: ObstacleBox[]; walls: ObstacleWall[] } {
  const boxes: ObstacleBox[] = [];
  const walls: ObstacleWall[] = [];
  const turned = (x: number, z: number, heading: number, halfAlong: number, halfAcross: number, height: number, tag: string): void => {
    const { fx, fz } = headingForward(heading);
    const square = Math.abs(fx) < 1e-6 || Math.abs(fz) < 1e-6;
    if (square) {
      const hx = Math.abs(fx) > 0.5 ? halfAlong : halfAcross;
      const hz = Math.abs(fx) > 0.5 ? halfAcross : halfAlong;
      boxes.push({ minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz, maxY: height, tag });
      return;
    }
    const k = corners(x, z, fx, fz, halfAlong, halfAcross);
    for (let i = 0; i < 4; i++) {
      const a = k[i];
      const c = k[(i + 1) % 4];
      walls.push({ ax: a.x, az: a.z, bx: c.x, bz: c.z, maxY: height, tag });
    }
  };
  for (const w of park.walls) walls.push({ ax: w.ax, az: w.az, bx: w.bx, bz: w.bz, maxY: w.height ?? 0.7, tag: 'park-wall' });
  if (park.planetarium) {
    const p = park.planetarium;
    // The podium's lower step reaches a tenth past its radius (`parkBuilder.ts`): the wall is at the step's face.
    const r = p.radius * PLANETARIUM_STEP;
    for (let i = 0; i < PLANETARIUM_SIDES; i++) {
      const a0 = (i / PLANETARIUM_SIDES) * Math.PI * 2;
      const a1 = ((i + 1) / PLANETARIUM_SIDES) * Math.PI * 2;
      walls.push({
        ax: p.x + Math.cos(a0) * r,
        az: p.z + Math.sin(a0) * r,
        bx: p.x + Math.cos(a1) * r,
        bz: p.z + Math.sin(a1) * r,
        maxY: 6,
        tag: 'planetarium',
      });
    }
  }
  for (const f of park.footbridges) {
    const dx = f.bx - f.ax;
    const dz = f.bz - f.az;
    const len = Math.hypot(dx, dz) || 1;
    const heading = Math.atan2(dx / len, -(dz / len));
    turned(f.ax + (dx / len) * (FOOTBRIDGE_FOOT / 2), f.az + (dz / len) * (FOOTBRIDGE_FOOT / 2), heading, FOOTBRIDGE_FOOT / 2, 1.3, 1.2, 'footbridge');
    turned(f.bx - (dx / len) * (FOOTBRIDGE_FOOT / 2), f.bz - (dz / len) * (FOOTBRIDGE_FOOT / 2), heading, FOOTBRIDGE_FOOT / 2, 1.3, 1.2, 'footbridge');
  }
  for (const pr of park.furniture) {
    const s = PARK_PROP_SIZE[pr.kind];
    turned(pr.x, pr.z, pr.heading, s.along / 2, s.across / 2, s.height, `park-${pr.kind}`);
  }
  for (const e of park.encounters) {
    for (const p of e.people) {
      if (p.to) {
        const dx = p.to.x - p.x;
        const dz = p.to.z - p.z;
        const len = Math.hypot(dx, dz);
        if (len > 0.01) {
          turned((p.x + p.to.x) / 2, (p.z + p.to.z) / 2, Math.atan2(dx / len, -(dz / len)), len / 2 + PERSON_HALF, PERSON_HALF, 2, 'park-person');
          continue;
        }
      }
      boxes.push({ minX: p.x - PERSON_HALF, maxX: p.x + PERSON_HALF, minZ: p.z - PERSON_HALF, maxZ: p.z + PERSON_HALF, maxY: 2, tag: 'park-person' });
    }
    for (const pr of e.props) {
      const s = PARK_PROP_SIZE[pr.kind];
      turned(pr.x, pr.z, pr.heading, s.along / 2, s.across / 2, s.height, `park-${pr.kind}`);
    }
  }
  return { boxes, walls };
}
