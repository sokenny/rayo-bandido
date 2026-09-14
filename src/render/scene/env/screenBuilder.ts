import type { Rect, ScreenZoneDef } from '../../../world/cityPlan';
import { createProjection, offsetAtStation, projectOntoPath } from '../../../world/track';
import { DECK_THICKNESS } from './elevatedBuilder';
import { groundGlow, halo, type EnvBuilders, type WallVolume } from './builders';
import { makeRng, type MeshBuilder } from './meshBuilder';
import { PAL } from './palette';
import { channelsFor, screenAttributes, screenChannel } from './screenAtlas';

/**
 * THE SCREENS OF THE STACK: LED boards on the towers, blade signs off the street walls,
 * boards standing on the lower roofs and holograms over them, after the Cyberpunk street Juan
 * sent (2026-09-13). What each one shows is `content/screens.ts`; how it moves is
 * `screenMaterial.ts`; this module only decides where they are.
 *
 * WHERE A SCREEN GOES
 * Nothing is placed by hand. Every building volume the city registered (`WallIndex`) inside a
 * `CityPlan.screens` zone is a candidate, face by face, and a face earns a screen by being SEEN:
 *
 * - the wall has to be really there behind the whole board and nothing in front of it for a
 *   couple of metres (no neighbour's wall, no deck, no skybridge, no passage ceiling);
 * - a ray out of the board's centre, at its own height, measures how far the view is open
 *   before a building or a deck stops it, and how much of that run is over road. A long open
 *   run over road is a board at the end of a street, or one a whole avenue drives towards,
 *   which is the hero shot; a short one over a street is a board you pass;
 * - the best-seen candidates win, kept apart from each other, at most two per volume.
 *
 * Blades need a street wall (road within a few metres) and a corner to hang off, and hang
 * above the lamps. Rooftop boards and holograms need a roof with nothing over it and a view.
 *
 * Every placement is from the same seeded rng and the same registered walls, so the city
 * builds the same screens every time; `tests/screens.test.ts` holds them to their walls.
 *
 * COST
 * A board is 2 triangles of screen, 12 of frame and 2 of halo; the whole Stack is a few
 * thousand triangles in the `screens` and `holo` builders, which replaced the Bay's two
 * holographic billboard builders one for one, so the draw-call count did not move.
 */

/** Tuning for the placement. Sizes in metres. */
export const SCREENS = {
  /** Board sizes: [width, height], biggest first; a face takes the biggest that fits. */
  heroWide: [28, 15.8],
  heroTall: [13, 26.6],
  wide: [18, 10.1],
  tall: [9, 18.4],
  smallWide: [10, 5.6],
  smallTall: [5, 10.2],
  strip: [26, 3.2],
  /** Board bottoms tried up a face (m above the volume's footing): over the shopfronts, up to the decks and above. */
  bottoms: [3.6, 5.5, 9, 14, 21, 30, 42, 56],
  /** A board must be at least this far above the ground wherever it is: over the shutters and a truck. */
  minBottom: 3.6,
  /** Least open view in front of a board, and the run that makes it a hero. */
  minDepth: 18,
  heroDepth: 85,
  /** How far a sight ray is marched, and its step. */
  sightMax: 150,
  sightStep: 4,
  /** Least distance between board centres, and between two heroes; most boards on one volume. */
  spacing: 16,
  heroSpacing: 55,
  perVolume: 4,
  /** How far out in front of a board a viaduct column still counts as standing in its way (m). */
  columnReach: 22,
  /** Passage boards: spacing along a road inside a building. */
  passageStep: 34,
  /**
   * Blades: how far they stand out of the wall and the lowest bottom (over the street lamps). A
   * blade is two 1:2 panels stacked on each face, so it is as tall as four of its widths.
   */
  bladeOut: 3.7,
  bladeBottom: 8.5,
  bladeTopBottom: 30,
  bladeSpacing: 18,
  /** Rooftop boards and holograms: the roof heights they stand on. */
  roofTop: [9, 62],
  holoHeight: [20, 28],
  holoLevel: 1.5,
  holoSpacing: 110,
  /** Boards on a deck's fascia over a road crossing under it: least spacing along the deck. */
  crossingStep: 45,
  /** Share of skybridges that carry a screen: on their sides, or hung under them. */
  bridgeShare: 0.7,
  /**
   * The BADKALA WANTED poster on the big portrait boards: the chance a tall hero or a full-size
   * tall board takes it instead of an ad, and the least distance between two of them (m).
   */
  badkalaHeroShare: 0.6,
  badkalaShare: 0.4,
  badkalaSpacing: 80,
  /** The chance a blade's top panels carry it, and the highest a board carrying it may be centred (m): it is read from the road. */
  badkalaBladeShare: 0.3,
  badkalaTop: 50,
  /** Share of boards built faulty (tearing, stuttering). */
  faultyShare: 0.08,
  /** How bright a board is drawn (the material is not tone-mapped), a hero, and a blade. */
  level: 1.3,
  heroLevel: 1.45,
  /** How far the panel stands off its wall: past the kit's ribs and ledges. */
  standOff: 0.95,
  /** Halo strength around a lit board, and the pool it throws on the road. */
  haloStrength: 0.22,
  /** The wide, faint second halo round a big board: the haze it lights. */
  hazeStrength: 0.07,
  poolStrength: 0.12,
};

/* ------------------------------------------------------------------ drawing a screen */

/** The channel name a board carrying the BADKALA WANTED poster reports (it is not on the atlas). */
export const BADKALA = 'badkala-wanted';

/** Deterministic 0..1 seed for a screen from its position. */
export function screenSeed(x: number, y: number, z: number): number {
  const v = Math.sin(x * 12.9898 + y * 4.1414 + z * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

/**
 * A vertical screen of channel `id`, w x h centred at (x, y, z) and facing +Z turned by `rotY`
 * (`MeshBuilder.panel`). `u0..v1` crop the channel's frame, as the drum of screens does.
 */
export function screenPanel(
  mb: MeshBuilder,
  id: string,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  rotY: number,
  o: { seed?: number; faulty?: boolean; level?: number; u0?: number; v0?: number; u1?: number; v1?: number } = {},
): void {
  const a = screenAttributes(id, o.seed ?? screenSeed(x, y, z), o.faulty ?? false);
  mb.color(0xffffff, o.level ?? 1).screen(a.slot, a.info);
  mb.panel(x, y, z, w, h, rotY, o.u0 ?? 0, o.v0 ?? 0, o.u1 ?? 1, o.v1 ?? 1);
}

/** A screen as an arbitrary quad a-b-c-d (counter-clockwise from the front), cropped to `u0..v1`. */
export function screenQuad(
  mb: MeshBuilder,
  id: string,
  seed: number,
  q: [number, number, number, number, number, number, number, number, number, number, number, number],
  u0 = 0,
  v0 = 0,
  u1 = 1,
  v1 = 1,
): void {
  const a = screenAttributes(id, seed);
  mb.color(0xffffff, 1).screen(a.slot, a.info);
  mb.quad(q[0], q[1], q[2], q[3], q[4], q[5], q[6], q[7], q[8], q[9], q[10], q[11], u0, v0, u1, v1);
}

/* ------------------------------------------------------------------ what is in the way */

interface Seg {
  /** The ribbon's tag; null for a skybridge. */
  tag: string | null;
  ax: number;
  az: number;
  bx: number;
  bz: number;
  ay: number;
  by: number;
  hw: number;
  /** Clearance under and over the surface that counts as the structure (m). */
  below: number;
  above: number;
}

const DECK_CELL = 12;
/** Grid (m) the placement remembers road membership on. */
const ROAD_CELL = 2;

/**
 * Every elevated road and skybridge as segments in a grid: the decks with their slab, soffit
 * lamps, rails, portal frames and a car's height over them; the skybridges as their body.
 */
interface Obstacles {
  /** True when (x, y, z) is inside a deck's structure or a skybridge, grown sideways by `pad`. */
  blocked(x: number, y: number, z: number, pad?: number, ignore?: string | null): boolean;
  /** True when a viaduct column taller than `y` stands in the rectangle [x0, x1] x [z0, z1]. */
  column(x0: number, z0: number, x1: number, z1: number, y: number): boolean;
}

function createObstacles(b: EnvBuilders): Obstacles {
  const cells = new Map<number, Seg[]>();
  const key = (i: number, j: number): number => (i + 4096) * 8192 + (j + 4096);
  const file = (s: Seg): void => {
    const g = s.hw + 3;
    const i0 = Math.floor((Math.min(s.ax, s.bx) - g) / DECK_CELL);
    const i1 = Math.floor((Math.max(s.ax, s.bx) + g) / DECK_CELL);
    const j0 = Math.floor((Math.min(s.az, s.bz) - g) / DECK_CELL);
    const j1 = Math.floor((Math.max(s.az, s.bz) + g) / DECK_CELL);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const k = key(i, j);
        const list = cells.get(k);
        if (list) list.push(s);
        else cells.set(k, [s]);
      }
    }
  };
  for (const rb of b.plan.ribbons) {
    if (!rb.elevated) continue;
    const sm = rb.path.samples;
    const n = rb.path.closed ? sm.length : sm.length - 1;
    for (let i = 0; i < n; i++) {
      const p = sm[i];
      const q = sm[(i + 1) % sm.length];
      if (Math.max(p.y, q.y) < 0.5) continue;
      file({ tag: rb.tag ?? '', ax: p.x, az: p.z, bx: q.x, bz: q.z, ay: p.y, by: q.y, hw: Math.max(p.halfWidth, q.halfWidth) + 1.2, below: 2.9, above: 10.5 });
    }
  }
  // The columns under the decks, each a point with the deck height it holds up.
  const columns = new Map<number, Array<{ x: number; z: number; top: number }>>();
  for (const p of b.plan.pillars ?? []) {
    for (const side of [-1, 1]) {
      const out = (p.halfWidth - 1.6) * side;
      const c = { x: p.x - p.tz * out, z: p.z + p.tx * out, top: p.y };
      const k = key(Math.floor(c.x / DECK_CELL), Math.floor(c.z / DECK_CELL));
      const list = columns.get(k);
      if (list) list.push(c);
      else columns.set(k, [c]);
    }
  }
  for (const s of b.plan.skybridges ?? []) {
    file({ tag: null, ax: s.ax, az: s.az, bx: s.bx, bz: s.bz, ay: s.y, by: s.y, hw: s.width / 2 + 0.6, below: s.height / 2 + 0.8, above: s.height / 2 + 0.8 });
  }
  return {
    column(x0, z0, x1, z1, y) {
      for (let i = Math.floor((x0 - 1) / DECK_CELL); i <= Math.floor((x1 + 1) / DECK_CELL); i++) {
        for (let j = Math.floor((z0 - 1) / DECK_CELL); j <= Math.floor((z1 + 1) / DECK_CELL); j++) {
          for (const c of columns.get(key(i, j)) ?? []) {
            if (c.top > y && c.x >= x0 - 1 && c.x <= x1 + 1 && c.z >= z0 - 1 && c.z <= z1 + 1) return true;
          }
        }
      }
      return false;
    },
    // `ignore`: a ribbon's tag to look past (a board on that deck's own fascia), or null to look past the skybridges.
    blocked(x, y, z, pad = 0, ignore?: string | null) {
      const list = cells.get(key(Math.floor(x / DECK_CELL), Math.floor(z / DECK_CELL)));
      if (!list) return false;
      for (const s of list) {
        if (ignore !== undefined && s.tag === ignore) continue;
        const dx = s.bx - s.ax;
        const dz = s.bz - s.az;
        const len2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / len2));
        const px = s.ax + dx * t - x;
        const pz = s.az + dz * t - z;
        if (px * px + pz * pz > (s.hw + pad) * (s.hw + pad)) continue;
        const ry = s.ay + (s.by - s.ay) * t;
        if (y >= ry - s.below && y <= ry + s.above) return true;
      }
      return false;
    },
  };
}

/* ------------------------------------------------------------------ the pass */

interface Face {
  /** The volume the face belongs to; null for a passage wall found by probing. */
  v: WallVolume | null;
  /** Outward normal (a world axis). */
  nx: number;
  nz: number;
  /** The plane: x for an X face, z for a Z face. */
  plane: number;
  /** Extent along the face. */
  a0: number;
  a1: number;
}

/** One screen put up: its centre, size, which way it faces, what it shows. */
export interface PlacedScreen {
  kind: 'board' | 'hero' | 'blade' | 'roof' | 'holo' | 'crossing' | 'bridge';
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  /**
   * Facing: out of the wall for a board (whose centre is on the wall's plane), out of the wall it
   * hangs on for a blade (centre at the middle of the blade), along the road below for a board on
   * a deck or a bridge (centre at the panel). 0, 0 for a hologram.
   */
  nx: number;
  nz: number;
  channel: string;
}

interface Placed extends PlacedScreen {
  hero: boolean;
  v: WallVolume | null;
}


/** Puts up every zone's screens; returns what went up, for the tests and the QA scripts. */
export function buildScreens(b: EnvBuilders): PlacedScreen[] {
  const zones = b.plan.screens ?? [];
  if (zones.length === 0) return [];
  const obstacles = createObstacles(b);
  // Road membership, asked a hundred thousand times by the sight rays over the same streets:
  // remembered on a 2 m grid for this pass (the plan's own test walks every ribbon near a point).
  const roads = new Map<number, boolean>();
  const isRoad = b.plan.isRoad;
  const memo: EnvBuilders = {
    ...b,
    plan: {
      ...b.plan,
      isRoad(x, z, pad) {
        if (pad) return isRoad(x, z, pad);
        const i = Math.floor(x / ROAD_CELL);
        const j = Math.floor(z / ROAD_CELL);
        const k = (i + 32768) * 65536 + (j + 32768);
        let v = roads.get(k);
        if (v === undefined) {
          v = isRoad((i + 0.5) * ROAD_CELL, (j + 0.5) * ROAD_CELL);
          roads.set(k, v);
        }
        return v;
      },
    },
  };
  const out: PlacedScreen[] = [];
  for (let zi = 0; zi < zones.length; zi++) {
    for (const p of buildZone(memo, zones[zi], obstacles, makeRng(0x5c4ee2 + zi * 7919))) {
      out.push({ kind: p.kind, x: p.x, y: p.y, z: p.z, w: p.w, h: p.h, nx: p.nx, nz: p.nz, channel: p.channel });
    }
  }
  return out;
}

function buildZone(b: EnvBuilders, zone: ScreenZoneDef, obstacles: Obstacles, rng: () => number): Placed[] {
  // A megastructure's volumes are registered by the city and again by the kit: each once here.
  const volumes = [...new Set(b.walls.volumes)].filter((v) => inside(zone.within, (v.minX + v.maxX) / 2, (v.minZ + v.maxZ) / 2) && v.y1 - v.y0 > 6);
  const faces: Face[] = [];
  for (const v of volumes) {
    const ch = v.chamfer ?? 0;
    faces.push({ v, nx: 1, nz: 0, plane: v.maxX, a0: v.minZ + ch, a1: v.maxZ - ch });
    faces.push({ v, nx: -1, nz: 0, plane: v.minX, a0: v.minZ + ch, a1: v.maxZ - ch });
    faces.push({ v, nx: 0, nz: 1, plane: v.maxZ, a0: v.minX + ch, a1: v.maxX - ch });
    faces.push({ v, nx: 0, nz: -1, plane: v.minZ, a0: v.minX + ch, a1: v.maxX - ch });
  }
  const placed: Placed[] = [];
  const perVolume = new Map<WallVolume | null, number>();
  const usage = new Map<string, Array<{ x: number; z: number }>>();

  // What the driver sees head on first: boards inside the buildings the road runs through, on
  // the decks crossing over it and on the skybridges across it. The walls fill in round them.
  placePassageBoards(b, zone, rng, placed, usage);
  placeCrossingBoards(b, zone, obstacles, rng, placed, usage);
  placeBridgeBoards(b, zone, obstacles, rng, placed, usage);
  placeBlades(b, zone, faces, obstacles, rng, placed, usage);
  placeBoards(b, zone, faces, obstacles, rng, placed, perVolume, usage);
  placeRoofBoards(b, zone, volumes, obstacles, rng, placed, usage);
  placeHolograms(b, zone, volumes, obstacles, rng, placed, usage);
  return placed;
}

function inside(r: Rect, x: number, z: number): boolean {
  return x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ;
}

/** A point on a face: `along` the face, `out` metres in front of it. */
function facePoint(f: Face, along: number, out: number): [number, number] {
  return f.nx !== 0 ? [f.plane + f.nx * out, along] : [along, f.plane + f.nz * out];
}

function open(b: EnvBuilders, obstacles: Obstacles, x: number, y: number, z: number, pad = 0): boolean {
  return !b.walls.inside(x, y, z) && !obstacles.blocked(x, y, z, pad);
}

/**
 * How the view out of (x, y, z) along (nx, nz) runs: the open distance before a building or a
 * deck stops it, how many steps of it are over road, and how many of those are past 30 m.
 */
function sight(b: EnvBuilders, obstacles: Obstacles, x: number, y: number, z: number, nx: number, nz: number): { depth: number; road: number; far: number; steps: number } {
  const bounds = b.plan.bounds;
  let road = 0;
  let far = 0;
  let steps = 0;
  let depth = SCREENS.sightMax;
  for (let d = SCREENS.sightStep; d <= SCREENS.sightMax; d += SCREENS.sightStep) {
    const px = x + nx * d;
    const pz = z + nz * d;
    if (px < bounds.minX || px > bounds.maxX || pz < bounds.minZ || pz > bounds.maxZ || !open(b, obstacles, px, y, pz)) {
      depth = d;
      break;
    }
    steps++;
    if (b.plan.isRoad(px, pz)) {
      road++;
      if (d > 30) far++;
    }
  }
  return { depth, road, far, steps };
}

/** The channel of `shape` for `use` least shown within 160 m of (x, z). */
function pickChannel(shape: 'wide' | 'tall' | 'strip', use: 'facade' | 'blade' | 'roof' | 'holo', x: number, z: number, usage: Map<string, Array<{ x: number; z: number }>>, rng: () => number): string {
  const ids = channelsFor(shape, use);
  let best = ids[0];
  let bestScore = Infinity;
  for (const id of ids) {
    let near = 0;
    for (const p of usage.get(id) ?? []) {
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < 160) near += 1 + (160 - d) / 40;
    }
    const score = near + rng() * 0.5;
    if (score < bestScore) {
      bestScore = score;
      best = id;
    }
  }
  const list = usage.get(best);
  if (list) list.push({ x, z });
  else usage.set(best, [{ x, z }]);
  return best;
}

function tooClose(placed: readonly Placed[], x: number, y: number, z: number, spacing: number, heroSpacing = 0): boolean {
  for (const p of placed) {
    const d = Math.hypot(p.x - x, (p.y - y) * 0.6, p.z - z);
    if (d < spacing || (heroSpacing > 0 && p.hero && d < heroSpacing)) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ facade boards */

interface BoardCandidate {
  f: Face;
  along: number;
  yc: number;
  w: number;
  h: number;
  shape: 'wide' | 'tall' | 'strip';
  hero: boolean;
  score: number;
}

function placeBoards(
  b: EnvBuilders,
  zone: ScreenZoneDef,
  faces: readonly Face[],
  obstacles: Obstacles,
  rng: () => number,
  placed: Placed[],
  perVolume: Map<WallVolume | null, number>,
  usage: Map<string, Array<{ x: number; z: number }>>,
): void {
  const candidates: BoardCandidate[] = [];
  for (const f of faces) {
    const width = f.a1 - f.a0;
    if (width < 8) continue;
    const v = f.v!;
    // A face that looks at nothing (a courtyard, the back of the next tower) is skipped cheaply.
    const mid = (f.a0 + f.a1) / 2;
    const probeY = Math.min(v.y1 - 1, Math.max(v.y0 + 1, SCREENS.minBottom + 4));
    const [px, pz] = facePoint(f, mid, 3);
    if (!open(b, obstacles, px, probeY, pz)) continue;
    let seesRoad = false;
    for (let d = 2; d <= 42 && !seesRoad; d += 5) {
      const [rx, rz] = facePoint(f, mid, d);
      if (b.plan.isRoad(rx, rz)) seesRoad = true;
    }
    if (!seesRoad) continue;

    const alongs = width > 44 ? [f.a0 + width * 0.25, mid, f.a0 + width * 0.75] : [mid];
    for (const along of alongs) {
      for (const bottom of SCREENS.bottoms) {
        const base = v.y0 + bottom;
        if (base < SCREENS.minBottom) continue;
        // The biggest board that fits this stretch of wall, a hero if the view earns it.
        const sizes: Array<[number, number, 'wide' | 'tall' | 'strip', boolean]> = [
          [SCREENS.heroWide[0], SCREENS.heroWide[1], 'wide', true],
          [SCREENS.heroTall[0], SCREENS.heroTall[1], 'tall', true],
          [SCREENS.wide[0], SCREENS.wide[1], 'wide', false],
          [SCREENS.tall[0], SCREENS.tall[1], 'tall', false],
          [SCREENS.smallWide[0], SCREENS.smallWide[1], 'wide', false],
          [SCREENS.smallTall[0], SCREENS.smallTall[1], 'tall', false],
          [SCREENS.strip[0], SCREENS.strip[1], 'strip', false],
        ];
        const room = alongs.length > 1 ? width / 2 : width;
        for (const [w, h, shape, hero] of sizes) {
          if (w > room - 2 || base + h > v.y1 - 1.5) continue;
          // Tall boards stand on narrow walls; strips run along podium tops, low.
          if (shape === 'tall' && room > w * 2.6) continue;
          if (shape === 'strip' && bottom > 21) continue;
          // At shopfront height only a small board: a big one there is a wall of light at the driver's shoulder.
          if (base < 5 && h > SCREENS.smallWide[1] + 0.1) continue;
          const yc = base + h / 2;
          const s = sight(b, obstacles, ...xyz(f, along, yc, 0.8), f.nx, f.nz);
          if (s.depth < SCREENS.minDepth || s.road === 0) continue;
          if (hero && (s.depth < SCREENS.heroDepth || s.far < 6)) continue;
          if (!boardClear(b, obstacles, f, along, yc, w, h)) continue;
          const score =
            0.35 * Math.min(s.depth, SCREENS.sightMax) / SCREENS.sightMax +
            0.45 * (s.far / Math.max(1, s.steps)) +
            0.2 * Math.min(1, s.road / 6) +
            (yc > 8 && yc < 36 ? 0.12 : 0) -
            (base < 5 ? 0.1 : 0) +
            0.1 * Math.min(1, (w * h) / 180) +
            (hero ? 0.25 : 0) -
            (shape === 'strip' ? 0.12 : 0) +
            rng() * 0.08;
          candidates.push({ f, along, yc, w, h, shape, hero, score });
          break;
        }
      }
    }
  }
  candidates.sort((p, q) => q.score - p.score);

  let boards = 0;
  let heroes = 0;
  for (const c of candidates) {
    if (boards >= zone.boards) break;
    if (c.hero && heroes >= zone.heroes) continue;
    if ((perVolume.get(c.f.v) ?? 0) >= SCREENS.perVolume) continue;
    const [x, y, z] = xyz(c.f, c.along, c.yc, 0);
    if (tooClose(placed, x, y, z, c.hero ? SCREENS.spacing * 1.4 : SCREENS.spacing, SCREENS.heroSpacing * (c.hero ? 1 : 0.5))) continue;
    // The big portrait boards now and then carry the BADKALA WANTED campaign the bus shelters
    // show, kept far enough apart that every one of them is a sighting rather than wallpaper.
    const wanted =
      c.shape === 'tall' &&
      c.h >= SCREENS.tall[1] - 0.01 &&
      c.yc < SCREENS.badkalaTop &&
      rng() < (c.hero ? SCREENS.badkalaHeroShare : SCREENS.badkalaShare) &&
      !placed.some((p) => p.channel === BADKALA && Math.hypot(p.x - x, p.z - z) < SCREENS.badkalaSpacing);
    const channel = wanted ? BADKALA : pickChannel(c.shape, 'facade', x, z, usage, rng);
    drawBoard(b, c, channel, rng() < SCREENS.faultyShare);
    placed.push({ kind: c.hero ? 'hero' : 'board', x, y, z, w: c.w, h: c.h, nx: c.f.nx, nz: c.f.nz, hero: c.hero, channel, v: c.f.v });
    perVolume.set(c.f.v, (perVolume.get(c.f.v) ?? 0) + 1);
    boards++;
    if (c.hero) heroes++;
  }
}

function xyz(f: Face, along: number, y: number, out: number): [number, number, number] {
  const [x, z] = facePoint(f, along, out);
  return [x, y, z];
}

/**
 * The wall is there behind the whole board, nothing stands within two metres in front of it, and
 * no viaduct column stands in the street in front of it to cut it in two from every lane.
 */
function boardClear(b: EnvBuilders, obstacles: Obstacles, f: Face, along: number, yc: number, w: number, h: number): boolean {
  if (along - w / 2 < f.a0 + 0.6 || along + w / 2 > f.a1 - 0.6) return false;
  const [ax, az] = facePoint(f, along - w / 2, 1);
  const [bx, bz] = facePoint(f, along + w / 2, SCREENS.columnReach);
  if (obstacles.column(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz), yc - h / 2)) return false;
  for (const da of [-w / 2, 0, w / 2]) {
    for (const dy of [-h / 2, 0, h / 2]) {
      for (const out of [0.7, 2.2]) {
        const [x, z] = facePoint(f, along + da, out);
        if (!open(b, obstacles, x, yc + dy, z, 0.5)) return false;
      }
    }
  }
  return true;
}

function drawBoard(b: EnvBuilders, c: Pick<BoardCandidate, 'f' | 'along' | 'yc' | 'w' | 'h' | 'hero'>, channel: string, faulty: boolean, floorY = 0): void {
  const { f, along, yc, w, h } = c;
  const rotY = Math.atan2(f.nx, f.nz);
  const off = SCREENS.standOff;
  const [sx, sz] = facePoint(f, along, off);
  // The cabinet: a dark box bolted to the wall and standing out past its ribs, a little bigger than the diodes.
  const [cx, cz] = facePoint(f, along, (off - 0.02) / 2);
  b.props.color(PAL.metalDark, 0.75);
  if (f.nx !== 0) b.props.box(cx, yc, cz, off - 0.02, h + 0.6, w + 0.6);
  else b.props.box(cx, yc, cz, w + 0.6, h + 0.6, off - 0.02);
  // The poster is its own texture and material (`badkalaPoster.ts`), portrait like a tall board.
  if (channel === BADKALA) b.badkala.panel(sx, yc, sz, w, h, rotY);
  else screenPanel(b.screens, channel, sx, yc, sz, w, h, rotY, { faulty, level: c.hero ? SCREENS.heroLevel : SCREENS.level });
  const glow = channel === BADKALA ? PAL.neonMagenta : screenChannel(channel).glow;
  const [hx, hz] = facePoint(f, along, off + 0.7);
  halo(b, hx, yc, hz, w * 1.7, h * 1.9, rotY, glow, SCREENS.haloStrength * (c.hero ? 1.2 : 1));
  if (w * h > 60) halo(b, hx + f.nx * 1.5, yc, hz + f.nz * 1.5, w * 3.2, h * 3.6, rotY, glow, SCREENS.hazeStrength);
  // The light it throws on the road below, when there is road below and it is near enough to reach.
  if (yc - h / 2 - floorY < 36) {
    const reach = 6 + h * 0.5;
    const [gx, gz] = facePoint(f, along, reach);
    if (b.plan.isRoad(gx, gz)) {
      const across = w * 1.4;
      groundGlow(b, gx, gz, f.nx !== 0 ? reach * 1.5 : across, f.nx !== 0 ? across : reach * 1.5, glow, SCREENS.poolStrength, floorY + 0.03);
    }
  }
}

/* ------------------------------------------------------------------ passages */

/**
 * Boards on the walls of the roads that run inside the buildings (`PassageDef`): one every
 * `passageStep` metres, alternating sides where both are walled, at eye height for the lane
 * and sized to the ceiling. Only where the road runs along a world axis, like the walls do.
 */
function placePassageBoards(b: EnvBuilders, zone: ScreenZoneDef, rng: () => number, placed: Placed[], usage: Map<string, Array<{ x: number; z: number }>>): void {
  let k = 0;
  for (const pd of b.plan.passages ?? []) {
    const rb = b.plan.ribbons.find((r) => r.tag === pd.tag);
    if (!rb) continue;
    const h = Math.min(pd.clearance - 3, 7.3);
    if (h < 3.2) continue;
    const w = h * 1.78;
    for (let s = pd.s0 + 12; s < pd.s1 - 12; s += SCREENS.passageStep) {
      const c = offsetAtStation(rb.path, s, 0);
      if (!inside(zone.within, c.x, c.z)) continue;
      if (Math.abs(c.tx) < 0.985 && Math.abs(c.tz) < 0.985) continue;
      const first = k++ % 2 === 0 ? 1 : -1;
      for (const side of [first, -first]) {
        if (side > 0 ? !pd.right : !pd.left) continue;
        // Out from the kerb until the wall is found, at the board's own height.
        const bottom = c.y + Math.max(2.4, (pd.clearance - h) * 0.5);
        const yc = bottom + h / 2;
        let wallOff = -1;
        for (let off = c.halfWidth + 0.4; off < c.halfWidth + pd.margin + 3; off += 0.25) {
          const p = offsetAtStation(rb.path, s, side * off);
          if (b.walls.inside(p.x, yc, p.z)) {
            wallOff = off;
            break;
          }
        }
        if (wallOff < 0) continue;
        const wall = offsetAtStation(rb.path, s, side * wallOff);
        // The wall's outward normal is back toward the road, snapped to its axis.
        const ex = c.x - wall.x;
        const ez = c.z - wall.z;
        const nx = Math.abs(ex) > Math.abs(ez) ? Math.sign(ex) : 0;
        const nz = nx === 0 ? Math.sign(ez) : 0;
        const plane = nx !== 0 ? Math.round((wall.x - nx * 0.125) * 8) / 8 : Math.round((wall.z - nz * 0.125) * 8) / 8;
        const along = nx !== 0 ? c.z : c.x;
        const f: Face = { v: null, nx, nz, plane, a0: along - 1000, a1: along + 1000 };
        // The wall behind the whole board, metre by metre (a carved building has slots in it), open air in front of it.
        let ok = true;
        for (let da = -w / 2; da <= w / 2 + 0.01 && ok; da += Math.min(1, w / 2)) {
          for (const dy of [-h / 2, 0, h / 2]) {
            const [bx, bz] = facePoint(f, along + da, -0.35);
            const [fx, fz] = facePoint(f, along + da, 1.4);
            if (!b.walls.inside(bx, yc + dy, bz) || b.walls.inside(fx, yc + dy, fz)) ok = false;
          }
        }
        if (!ok || tooClose(placed, c.x, yc, c.z, 18)) continue;
        const channel = pickChannel('wide', 'facade', c.x, c.z, usage, rng);
        drawBoard(b, { f, along, yc, w, h, hero: false }, channel, rng() < SCREENS.faultyShare, c.y);
        const [px, pz] = facePoint(f, along, 0);
        placed.push({ kind: 'board', x: px, y: yc, z: pz, w, h, nx, nz, hero: false, channel, v: null });
        break;
      }
    }
  }
}

/* ------------------------------------------------------------------ blades */

function placeBlades(
  b: EnvBuilders,
  zone: ScreenZoneDef,
  faces: readonly Face[],
  obstacles: Obstacles,
  rng: () => number,
  placed: Placed[],
  usage: Map<string, Array<{ x: number; z: number }>>,
): void {
  const candidates: Array<{ f: Face; along: number; end: -1 | 1; bottom: number; h: number; score: number }> = [];
  for (const f of faces) {
    if (f.a1 - f.a0 < 10) continue;
    const v = f.v!;
    // A street wall: road right in front of it.
    const mid = (f.a0 + f.a1) / 2;
    let street = false;
    for (const d of [2, 4, 6.5]) {
      const [rx, rz] = facePoint(f, mid, d);
      if (b.plan.isRoad(rx, rz)) street = true;
    }
    if (!street) continue;
    for (const end of [-1, 1] as const) {
      const along = end < 0 ? f.a0 + 1.6 : f.a1 - 1.6;
      const h = bladeHeight();
      const bottom = Math.max(SCREENS.bladeBottom, v.y0 + 8) + rng() * 5;
      // A blade is read from the street or a deck: never up a tower where only the sky sees it.
      if (bottom > SCREENS.bladeTopBottom || bottom + h > v.y1 - 1) continue;
      let clear = true;
      for (const out of [0.4, SCREENS.bladeOut / 2, SCREENS.bladeOut + 0.2]) {
        for (const y of [bottom, bottom + h / 2, bottom + h]) {
          const [x, z] = facePoint(f, along, out);
          if (!open(b, obstacles, x, y, z, 1)) clear = false;
        }
      }
      // The wall it hangs on is there at both ends of the bracket.
      if (!clear || !b.walls.inside(...inWall(f, along, bottom + 0.2)) || !b.walls.inside(...inWall(f, along, bottom + h - 0.2))) continue;
      // Seen along the street, both ways.
      const tx = f.nz;
      const tz = -f.nx;
      const [x, z] = facePoint(f, along, SCREENS.bladeOut / 2 + 0.4);
      const y = bottom + h / 2;
      const s1 = sight(b, obstacles, x, y, z, tx, tz);
      const s2 = sight(b, obstacles, x, y, z, -tx, -tz);
      if (Math.max(s1.depth, s2.depth) < 40) continue;
      candidates.push({ f, along, end, bottom, h, score: (s1.far + s2.far) / 30 + (s1.depth + s2.depth) / 300 + rng() * 0.2 });
    }
  }
  candidates.sort((p, q) => q.score - p.score);
  let count = 0;
  for (const c of candidates) {
    if (count >= zone.blades) break;
    const [x, z] = facePoint(c.f, c.along, SCREENS.bladeOut / 2 + 0.4);
    const y = c.bottom + c.h / 2;
    if (tooClose(placed, x, y, z, SCREENS.bladeSpacing)) continue;
    const channels = [0, 1, 2, 3].map((i) => pickChannel('tall', 'blade', x + i, z + i, usage, rng));
    // The poster's shape is a blade panel's: now and then the top panel on both faces is BADKALA WANTED.
    if (rng() < SCREENS.badkalaBladeShare && !placed.some((p) => p.channel === BADKALA && Math.hypot(p.x - x, p.z - z) < SCREENS.badkalaSpacing)) {
      channels[0] = BADKALA;
      channels[2] = BADKALA;
    }
    drawBlade(b, c.f, c.along, c.bottom, channels, rng() < SCREENS.faultyShare);
    placed.push({ kind: 'blade', x, y, z, w: bladeWidth(), h: c.h, nx: c.f.nx, nz: c.f.nz, hero: false, channel: channels[0], v: c.f.v });

    count++;
  }
}

/** A point just inside the wall behind `along` at height y. */
function inWall(f: Face, along: number, y: number): [number, number, number] {
  const [x, z] = facePoint(f, along, -0.3);
  return [x, y, z];
}

/** A blade's panel width, and its whole height: two 1:2 panels and the rail between them. */
function bladeWidth(): number {
  return SCREENS.bladeOut - 0.5;
}
function bladeHeight(): number {
  return bladeWidth() * 4 + 0.35;
}

/** `channels`: front top, front bottom, back top, back bottom. */
function drawBlade(b: EnvBuilders, f: Face, along: number, bottom: number, channels: string[], faulty: boolean): void {
  const w = bladeWidth();
  const h = bladeHeight();
  const y = bottom + h / 2;
  const [cx, cz] = facePoint(f, along, 0.5 + w / 2);
  const tx = f.nz;
  const tz = -f.nx;
  // The cabinet, and the two brackets into the wall.
  b.props.color(PAL.metalDark, 0.8);
  if (f.nx !== 0) b.props.box(cx, y, cz, w + 0.3, h + 0.35, 0.34);
  else b.props.box(cx, y, cz, 0.34, h + 0.35, w + 0.3);
  for (const by of [bottom + 0.6, y, bottom + h - 0.6]) {
    const [bx, bz] = facePoint(f, along, 0.25);
    if (f.nx !== 0) b.props.box(bx, by, bz, 0.5, 0.22, 0.22);
    else b.props.box(bx, by, bz, 0.22, 0.22, 0.5);
  }
  // Two panels on each side, each side facing down the street its own way.
  const rot = Math.atan2(tx, tz);
  const ph = w * 2;
  for (const [i, side] of [[0, 1], [2, -1]] as const) {
    for (const [k, py] of [[0, y + 0.175 + ph / 2], [1, y - 0.175 - ph / 2]] as const) {
      const id = channels[i + k];
      const px = cx + tx * 0.18 * side;
      const pz = cz + tz * 0.18 * side;
      const face = rot + (side < 0 ? Math.PI : 0);
      if (id === BADKALA) b.badkala.panel(px, py, pz, w, ph, face);
      else screenPanel(b.screens, id, px, py, pz, w, ph, face, { faulty, level: SCREENS.level });
    }
    const glow = channels[i] === BADKALA ? PAL.neonMagenta : screenChannel(channels[i]).glow;
    halo(b, cx + tx * 0.8 * side, y, cz + tz * 0.8 * side, w * 2.4, h * 1.3, rot, glow, SCREENS.haloStrength);
  }
  if (bottom < 26) {
    const [gx, gz] = facePoint(f, along, 5);
    if (b.plan.isRoad(gx, gz)) groundGlow(b, gx, gz, 12, 12, channels[0] === BADKALA ? PAL.neonMagenta : screenChannel(channels[0]).glow, SCREENS.poolStrength);
  }
}

/* ------------------------------------------------------------------ crossings */

const CROSS = createProjection();
const CROSS_END = createProjection();

/**
 * Boards on the fascias of a deck where it crosses over another road, one on each side, each
 * facing the traffic coming at it along the road below: the one screen in a canyon a driver
 * looks straight at. Over a street with room under the deck, a board hangs below the fascia;
 * over a low clearance, a strip runs along the fascia itself.
 */
function placeCrossingBoards(b: EnvBuilders, zone: ScreenZoneDef, obstacles: Obstacles, rng: () => number, placed: Placed[], usage: Map<string, Array<{ x: number; z: number }>>): void {
  let count = 0;
  for (const deck of b.plan.ribbons) {
    if (!deck.elevated || count >= zone.crossings) continue;
    let last = -Infinity;
    for (let s = 0; s < deck.path.length && count < zone.crossings; s += 4) {
      if (s - last < SCREENS.crossingStep) continue;
      const c = offsetAtStation(deck.path, s, 0);
      if (c.y < 9 || !inside(zone.within, c.x, c.z)) continue;
      for (const road of b.plan.ribbons) {
        if (road === deck) continue;
        const p = projectOntoPath(road.path, c.x, c.z, CROSS);
        if (p.dist > p.halfWidth * 0.6 || p.y > c.y - 8) continue;
        if (Math.abs(p.tx * c.tx + p.tz * c.tz) > 0.4) continue;
        const underside = c.y - DECK_THICKNESS - 0.95;
        const room = underside - p.y;
        const tall = room > 16;
        const w = tall ? 16 : Math.min(2 * p.halfWidth + 2, 26);
        const h = tall ? 9 : w / 7.5;
        const shape = tall ? 'wide' : 'strip';
        const yc = tall ? underside - 0.3 - h / 2 : c.y - 0.55;
        const sides = [-1, 1].map((side) => {
          const nx = -c.tz * side;
          const nz = c.tx * side;
          const out = c.halfWidth + 0.9;
          const x = c.x + nx * out;
          const z = c.z + nz * out;
          let ok = true;
          // The panel itself and the air in front of it: no wall, and no other deck or ramp through it.
          for (const da of [-w / 2, 0, w / 2]) {
            for (const dy of [-h / 2, 0, h / 2]) {
              for (const o of [0, 1.5]) {
                const px = x + c.tx * da + nx * o;
                const pz = z + c.tz * da + nz * o;
                if (b.walls.inside(px, yc + dy, pz) || obstacles.blocked(px, yc + dy, pz, 0, deck.tag ?? '')) ok = false;
              }
            }
          }
          // A straight board along a curving deck: both its ends must still be off the slab.
          for (const da of [-w / 2, w / 2]) {
            const e = projectOntoPath(deck.path, x + c.tx * da, z + c.tz * da, CROSS_END);
            if (e.dist < e.halfWidth + 0.5) ok = false;
          }
          ok = ok && !tooClose(placed, x, yc, z, 16) && sight(b, obstacles, x + nx * 2, yc, z + nz * 2, nx, nz).depth >= 40;
          return { nx, nz, x, z, ok };
        });
        // A board hung below the fascia shows its bare back to the traffic on the other side of the
        // deck, so it goes up only where that side gets its own. A ticker sits on the fascia: either side alone is fine.
        if (tall && !sides.every((d) => d.ok)) break;
        let made = false;
        for (const { nx, nz, x, z, ok } of sides) {
          if (!ok) continue;
          const channel = pickChannel(shape, 'facade', x, z, usage, rng);
          drawHungBoard(b, x, yc, z, nx, nz, c.tx, c.tz, w, h, channel, tall ? underside : yc + h / 2, p.y);
          placed.push({ kind: 'crossing', x, y: yc, z, w, h, nx, nz, hero: tall, channel, v: null });
          made = true;
        }
        if (made) {
          count++;
          last = s;
        }
        break;
      }
    }
  }
}

/**
 * A board facing (nx, nz), running along (tx, tz), hung from `hangY` (a fascia or a bridge's
 * underside) on two hangers when it hangs below it. The pool is thrown on the road at `floorY`.
 */
function drawHungBoard(b: EnvBuilders, x: number, yc: number, z: number, nx: number, nz: number, tx: number, tz: number, w: number, h: number, channel: string, hangY: number, floorY: number): void {
  const rotY = Math.atan2(nx, nz);
  b.props.color(PAL.metalDark, 0.75);
  b.props.orientedBox(x - nx * 0.25, z - nz * 0.25, tx, tz, w + 0.5, 0.5, yc - h / 2 - 0.3, yc + h / 2 + 0.3);
  if (hangY > yc + h / 2 + 0.35) {
    for (const s of [-0.4, 0.4]) {
      b.props.box(x - nx * 0.25 + tx * s * w, (yc + h / 2 + hangY) / 2, z - nz * 0.25 + tz * s * w, 0.16, hangY - yc - h / 2, 0.16);
    }
  }
  screenPanel(b.screens, channel, x + nx * 0.02, yc, z + nz * 0.02, w, h, rotY, { level: SCREENS.heroLevel });
  const glow = screenChannel(channel).glow;
  halo(b, x + nx * 0.8, yc, z + nz * 0.8, w * 1.5, Math.max(h * 2.2, 6), rotY, glow, SCREENS.haloStrength);
  halo(b, x + nx * 2.2, yc, z + nz * 2.2, w * 2.6, Math.max(h * 4, 12), rotY, glow, SCREENS.hazeStrength);
  const reach = 9 + Math.max(0, yc - floorY) * 0.4;
  groundGlow(b, x + nx * reach, z + nz * reach, Math.abs(nx) > 0.5 ? reach * 1.6 : w * 1.2, Math.abs(nx) > 0.5 ? w * 1.2 : reach * 1.6, glow, SCREENS.poolStrength, floorY + 0.03);
}

/* ------------------------------------------------------------------ skybridges */

/**
 * Screens on the skybridges across the streets: most take a board on each side, facing along
 * the street both ways; where the bridge is too shallow for one, it gets a board hung under it.
 */
function placeBridgeBoards(b: EnvBuilders, zone: ScreenZoneDef, obstacles: Obstacles, rng: () => number, placed: Placed[], usage: Map<string, Array<{ x: number; z: number }>>): void {
  let count = 0;
  for (const s of b.plan.skybridges ?? []) {
    if (count >= zone.bridges) break;
    const cx = (s.ax + s.bx) / 2;
    const cz = (s.az + s.bz) / 2;
    if (!inside(zone.within, cx, cz) || rng() > SCREENS.bridgeShare) continue;
    const len = Math.hypot(s.bx - s.ax, s.bz - s.az);
    if (len < 8) continue;
    const tx = (s.bx - s.ax) / len;
    const tz = (s.bz - s.az) / len;
    const bottom = s.y - s.height / 2;
    // On its sides when it is deep enough for a board worth the name; hung under it otherwise.
    const sideH = s.height * 0.78;
    const side = sideH >= 3.2;
    const w = side ? Math.min(len * 0.8, sideH * 1.78 > len * 0.8 ? len * 0.8 : Math.max(sideH * 1.78, Math.min(len * 0.8, sideH * 7.5))) : Math.min(len * 0.6, 14);
    const h = side ? Math.min(sideH, w / 1.78) : w * 0.5625;
    const shape: 'wide' | 'strip' = w / h > 4 ? 'strip' : 'wide';
    const hh = shape === 'strip' ? Math.min(h, w / 7.5) : h;
    const yc = side ? s.y : bottom - 0.4 - hh / 2;
    if (!side && yc - hh / 2 < 7) continue;
    const sides = [-1, 1].map((dir) => {
      const nx = -tz * dir;
      const nz = tx * dir;
      const out = side ? s.width / 2 + 0.35 : 0.3;
      const x = cx + nx * out;
      const z = cz + nz * out;
      let ok = true;
      for (const da of [-w / 2, 0, w / 2]) {
        for (const dy of [-hh / 2, hh / 2]) {
          const px = x + tx * da + nx * 1.2;
          const pz = z + tz * da + nz * 1.2;
          if (b.walls.inside(px, yc + dy, pz) || obstacles.blocked(px, yc + dy, pz, 0, null)) ok = false;
        }
      }
      ok = ok && !tooClose(placed, x, yc, z, 14) && sight(b, obstacles, x + nx * 2, yc, z + nz * 2, nx, nz).depth >= 30;
      return { nx, nz, x, z, ok };
    });
    // A board hung under the bridge is one cabinet with a face each way: both faces or neither,
    // or the street is shown the bare back of it.
    if (!side && !sides.every((d) => d.ok)) continue;
    let made = false;
    for (const { nx, nz, x, z, ok } of sides) {
      if (!ok) continue;
      const channel = pickChannel(shape, 'facade', x, z, usage, rng);
      drawHungBoard(b, x, yc, z, nx, nz, tx, tz, w, hh, channel, side ? yc + hh / 2 : bottom, 0);
      placed.push({ kind: 'bridge', x, y: yc, z, w, h: hh, nx, nz, hero: false, channel, v: null });
      made = true;
    }
    if (made) count++;
  }
}

/* ------------------------------------------------------------------ roofs */

/** The roof of `v` is open over (x, z) from its top to `height` above it. */
function roofOpen(b: EnvBuilders, obstacles: Obstacles, v: WallVolume, x: number, z: number, height: number): boolean {
  for (let y = v.y1 + 0.6; y <= v.y1 + height; y += 3) if (!open(b, obstacles, x, y, z, 1)) return false;
  return open(b, obstacles, x, v.y1 + height, z, 1);
}

function placeRoofBoards(
  b: EnvBuilders,
  zone: ScreenZoneDef,
  volumes: readonly WallVolume[],
  obstacles: Obstacles,
  rng: () => number,
  placed: Placed[],
  usage: Map<string, Array<{ x: number; z: number }>>,
): void {
  const candidates: Array<{ v: WallVolume; f: Face; w: number; h: number; score: number }> = [];
  for (const v of volumes) {
    if (v.y1 < SCREENS.roofTop[0] || v.y1 > SCREENS.roofTop[1] || v.y0 > 1) continue;
    const ch = v.chamfer ?? 0;
    const faces: Face[] = [
      { v, nx: 1, nz: 0, plane: v.maxX, a0: v.minZ + ch, a1: v.maxZ - ch },
      { v, nx: -1, nz: 0, plane: v.minX, a0: v.minZ + ch, a1: v.maxZ - ch },
      { v, nx: 0, nz: 1, plane: v.maxZ, a0: v.minX + ch, a1: v.maxX - ch },
      { v, nx: 0, nz: -1, plane: v.minZ, a0: v.minX + ch, a1: v.maxX - ch },
    ];
    for (const f of faces) {
      const width = f.a1 - f.a0;
      if (width < 10) continue;
      const w = Math.min(width * 0.8, 12 + rng() * 6);
      const h = w * 0.5625;
      const mid = (f.a0 + f.a1) / 2;
      const [x, z] = facePoint(f, mid, -1.2);
      if (!roofOpen(b, obstacles, v, x, z, h + 2.5)) continue;
      let ok = true;
      for (const da of [-w / 2, w / 2]) {
        const [ex, ez] = facePoint(f, mid + da, -1.2);
        if (!roofOpen(b, obstacles, v, ex, ez, h + 2.5)) ok = false;
      }
      if (!ok) continue;
      const s = sight(b, obstacles, ...xyz(f, mid, v.y1 + 1.6 + h / 2, 0.5), f.nx, f.nz);
      if (s.depth < 45 || s.road < 2) continue;
      candidates.push({ v, f, w, h, score: s.depth / SCREENS.sightMax + s.far / Math.max(1, s.steps) + rng() * 0.15 });
    }
  }
  candidates.sort((p, q) => q.score - p.score);
  let count = 0;
  const used = new Set<WallVolume>();
  for (const c of candidates) {
    if (count >= zone.roofBoards) break;
    if (used.has(c.v)) continue;
    const mid = (c.f.a0 + c.f.a1) / 2;
    const [x, z] = facePoint(c.f, mid, -1.2);
    const y = c.v.y1 + 1.6 + c.h / 2;
    if (tooClose(placed, x, y, z, SCREENS.spacing)) continue;
    const channel = pickChannel('wide', 'roof', x, z, usage, rng);
    drawRoofBoard(b, c.f, mid, c.w, c.h, channel);
    placed.push({ kind: 'roof', x, y, z, w: c.w, h: c.h, nx: c.f.nx, nz: c.f.nz, hero: false, channel, v: c.v });
    used.add(c.v);
    count++;
  }
}

function drawRoofBoard(b: EnvBuilders, f: Face, along: number, w: number, h: number, channel: string): void {
  const top = f.v!.y1;
  const y = top + 1.6 + h / 2;
  const rotY = Math.atan2(f.nx, f.nz);
  const [cx, cz] = facePoint(f, along, -1.2);
  const tx = f.nz;
  const tz = -f.nx;
  b.props.color(PAL.metalDark, 0.8);
  // The back of the board, the posts and a catwalk along its foot.
  if (f.nx !== 0) b.props.box(cx - f.nx * 0.25, y, cz, 0.4, h + 0.5, w + 0.5);
  else b.props.box(cx, y, cz - f.nz * 0.25, w + 0.5, h + 0.5, 0.4);
  for (const s of [-0.38, 0, 0.38]) {
    const px = cx + tx * s * w - f.nx * 0.9;
    const pz = cz + tz * s * w - f.nz * 0.9;
    b.props.box(px, top + (1.6 + h * 0.6) / 2, pz, 0.35, 1.6 + h * 0.6, 0.35);
  }
  if (f.nx !== 0) b.props.box(cx - f.nx * 0.6, top + 1.3, cz, 1.4, 0.12, w + 0.4);
  else b.props.box(cx, top + 1.3, cz - f.nz * 0.6, w + 0.4, 0.12, 1.4);
  screenPanel(b.screens, channel, cx + f.nx * 0.02, y, cz + f.nz * 0.02, w, h, rotY, { level: SCREENS.level });
  const glow = screenChannel(channel).glow;
  b.neonPulse.color(glow, 0.7);
  b.neonPulse.tube(cx - tx * w / 2 + f.nx * 0.2, top + 1.35, cz - tz * w / 2 + f.nz * 0.2, cx + tx * w / 2 + f.nx * 0.2, top + 1.35, cz + tz * w / 2 + f.nz * 0.2, 0.16);
  halo(b, cx + f.nx * 0.8, y, cz + f.nz * 0.8, w * 1.6, h * 1.8, rotY, glow, SCREENS.haloStrength);
}

/* ------------------------------------------------------------------ holograms */

function placeHolograms(
  b: EnvBuilders,
  zone: ScreenZoneDef,
  volumes: readonly WallVolume[],
  obstacles: Obstacles,
  rng: () => number,
  placed: Placed[],
  usage: Map<string, Array<{ x: number; z: number }>>,
): void {
  const candidates: Array<{ v: WallVolume; h: number; score: number }> = [];
  for (const v of volumes) {
    if (v.y1 < SCREENS.roofTop[0] || v.y1 > SCREENS.roofTop[1]) continue;
    if (v.maxX - v.minX < 14 || v.maxZ - v.minZ < 14) continue;
    const h = SCREENS.holoHeight[0] + rng() * (SCREENS.holoHeight[1] - SCREENS.holoHeight[0]);
    const w = h * 0.49;
    const x = (v.minX + v.maxX) / 2;
    const z = (v.minZ + v.maxZ) / 2;
    let ok = roofOpen(b, obstacles, v, x, z, h + 3);
    for (const [ox, oz] of [[w / 2, 0], [-w / 2, 0], [0, w / 2], [0, -w / 2]]) if (ok && !roofOpen(b, obstacles, v, x + ox, z + oz, h + 3)) ok = false;
    if (!ok) continue;
    // Seen from the streets on at least two sides.
    const y = v.y1 + 2 + h / 2;
    let sides = 0;
    let score = 0;
    for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const s = sight(b, obstacles, x, y, z, nx, nz);
      if (s.depth - (nx !== 0 ? (v.maxX - v.minX) / 2 : (v.maxZ - v.minZ) / 2) > 40 && s.road > 2) sides++;
      score += s.far;
    }
    if (sides < 2) continue;
    candidates.push({ v, h, score: score / 40 + sides * 0.3 + rng() * 0.2 });
  }
  candidates.sort((p, q) => q.score - p.score);
  let count = 0;
  for (const c of candidates) {
    if (count >= zone.holograms) break;
    const x = (c.v.minX + c.v.maxX) / 2;
    const z = (c.v.minZ + c.v.maxZ) / 2;
    const y = c.v.y1 + 2 + c.h / 2;
    let far = true;
    for (const p of placed) if (p.kind === 'holo' && Math.hypot(p.x - x, p.z - z) < SCREENS.holoSpacing) far = false;
    if (!far || tooClose(placed, x, y, z, 20)) continue;
    const channel = pickChannel('tall', 'holo', x, z, usage, rng);
    drawHologram(b, x, c.v.y1, z, c.h, channel);
    placed.push({ kind: 'holo', x, y, z, w: c.h * 0.49, h: c.h, nx: 0, nz: 0, hero: false, channel, v: c.v });
    count++;
  }
}

function drawHologram(b: EnvBuilders, x: number, top: number, z: number, h: number, channel: string): void {
  const w = h * 0.49;
  const y = top + 2 + h / 2;
  const glow = screenChannel(channel).glow;
  const seed = screenSeed(x, top, z);
  // Two crossed projections, square to neither street, so it reads from every approach.
  for (const rot of [Math.PI / 4, -Math.PI / 4]) {
    const a = screenAttributes(channel, seed);
    b.holo.color(0xffffff, SCREENS.holoLevel).screen(a.slot, a.info);
    b.holo.panel(x, y, z, w, h, rot);
  }
  // The projector: a plinth, its lens ring, and the cone of light up into the figure.
  b.props.color(PAL.metalDark, 0.9);
  b.props.box(x, top + 0.45, z, 3.2, 0.9, 3.2);
  b.neon.color(glow, 0.9);
  b.neon.box(x, top + 0.95, z, 1.6, 0.12, 1.6);
  for (const rot of [0, Math.PI / 2]) halo(b, x, top + 1 + h * 0.18, z, w * 0.5, h * 0.36, rot, glow, 0.12);
  groundGlow(b, x, z, 9, 9, glow, 0.16, top + 0.04);
}
