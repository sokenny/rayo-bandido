import type { ZoneId } from '../../../world/cityPlan';
import { PAL, zoneAccent } from './palette';
import { groundGlow, halo, type EnvBuilders } from './builders';
import { facadeCell, FACADE_GRID, FACADE_TILE, FLOOR, type FacadeStyle } from './facadeAtlas';
import { makeRng, subtractRect, type Rect2 } from './meshBuilder';

/**
 * The building kit. One call turns a plot into a building: a MASSING (a few axis-aligned
 * volumes stacked, stepped, offset, cantilevered, recessed or paired), each volume's walls
 * cut into FACADE BANDS (a lit lobby, a body pattern, a dark service floor, a different
 * pattern for the top storeys), and a ROOF (mechanical blocks, antennas, a lit crown, a spire,
 * navigation lights). Everything is boxes and quads into the shared merged builders: no mesh
 * of its own, no material of its own, no per-frame cost.
 *
 * Variety comes from combining a handful of each: eleven massing archetypes, sixteen atlas
 * styles (`facadeAtlas.ts`), the zone's window tints, a per-building wall brightness and a
 * per-building UV offset. Two buildings never look alike; nothing is unique.
 *
 * Every random choice comes from the rng the caller hands in, seeded from the plot's
 * position, so a building is the same on every machine and does not change when its
 * neighbours do.
 *
 * `detail` cuts the work down with distance: 'near' is a plot inside the city, 'mid' the
 * perimeter band, 'far' the backdrop skyline (massing, a top band, maybe a mast).
 */

export type Archetype = 'tower' | 'slab' | 'podium' | 'stepped' | 'offset' | 'cantilever' | 'recessed' | 'twin' | 'low' | 'shabby' | 'landmark';
export type Detail = 'near' | 'mid' | 'far';

export const ARCHETYPES: readonly Archetype[] = ['tower', 'slab', 'podium', 'stepped', 'offset', 'cantilever', 'recessed', 'twin', 'low', 'shabby', 'landmark'];

export interface BuildingSpec {
  zone: ZoneId;
  /** The block's height band; picks the archetype table. */
  massing: 1 | 2 | 3 | 4;
  /** Height of the tallest part above `base` (m). Snapped to whole floors inside. */
  height: number;
  /** Ground the building stands on (the pavement slab). */
  base: number;
  detail: Detail;
  /** Which walls meet a street: +x, -x, +z, -z. Lobbies, corner lights and signs face these. */
  street?: [boolean, boolean, boolean, boolean];
  /** One of the hand-drawn silhouettes (`LANDMARKS`), when the plot anchors the skyline. */
  landmark?: number;
  /** Force an archetype (tests, landmarks). */
  archetype?: Archetype;
}

export interface Band {
  y0: number;
  y1: number;
  style: FacadeStyle;
  tint: number;
  bright: number;
  wall: number;
}

export interface Volume extends Rect2 {
  y0: number;
  y1: number;
  /** Corners clipped by this much (m); 0 for a plain box. */
  chamfer: number;
  /** What the walls show, bottom to top. */
  bands: Band[];
  /** Style for the walls that do not meet a street, when they differ. */
  backStyle?: FacadeStyle;
  role: 'podium' | 'body' | 'top' | 'wing' | 'link';
}

export interface Building {
  archetype: Archetype;
  volumes: Volume[];
  /** Height of the highest roof. */
  top: number;
  /** Footprint of the highest volume: where the crown and the masts stand. */
  crown: Rect2;
  /** Every style any wall of it uses. */
  styles: FacadeStyle[];
  /** A building that is deliberately unlit: navigation lights only. */
  dark: boolean;
}

/* ------------------------------------------------------------------ tuning */

/**
 * The knobs. Probabilities are per building unless said otherwise; the archetype tables are
 * weights, normalised at pick time, and an archetype the plot cannot carry falls back to a
 * plain tower.
 */
export const KIT = {
  /** Chance a mid-rise or tower is a dark building: no lit windows, navigation lights only. */
  darkChance: { corporate: 0.1, urban: 0.12, jdm: 0.08 } as Record<ZoneId, number>,
  /** Chance a tall wall carries a dark service band part-way up, and the top storeys a second pattern. */
  serviceBandChance: 0.45,
  topBandChance: 0.4,
  /** Chance the ground floors facing a street are a lit lobby band / a blank service band. */
  lobbyChance: 0.36,
  groundServiceChance: 0.3,
  /** Chance the walls away from the street take a sparser pattern. */
  backStyleChance: 0.35,
  /** Chance a tower's corners are clipped (massing 3 and 4). */
  chamferChance: { 3: 0.22, 4: 0.4 } as Record<number, number>,
  /** Corner light strips, per tall building. */
  cornerLightChance: 0.3,
  /** Rooftop: mechanical blocks, antennas, and how rare a beacon is. */
  mechChance: 0.7,
  antennaChance: 0.45,
  beaconChance: 0.14,
  /** Crown (lit rim / frame / fins / spire) on a building this tall or taller, and its chance. */
  crownMinHeight: 26,
  crownChance: 0.55,
  /** Archetype weights per massing band. */
  archetypes: {
    1: { low: 0.75, shabby: 0.25 },
    2: { tower: 0.25, stepped: 0.2, slab: 0.15, offset: 0.15, recessed: 0.1, podium: 0.1, cantilever: 0.05 },
    3: { tower: 0.2, podium: 0.2, stepped: 0.15, slab: 0.12, offset: 0.1, cantilever: 0.08, recessed: 0.08, twin: 0.07 },
    4: { podium: 0.25, stepped: 0.25, tower: 0.15, offset: 0.12, cantilever: 0.08, twin: 0.08, recessed: 0.07 },
  } as Record<number, Partial<Record<Archetype, number>>>,
  /** The old town's low boxes are mostly the shabby kind. */
  jdmShabby: 0.6,
};

/** Facade styles per zone and per role of the volume. Most common first. */
const STYLE_POOLS: Record<ZoneId, Record<'body' | 'podium' | 'top' | 'back', FacadeStyle[]>> = {
  corporate: {
    body: ['grid', 'ribbon', 'strips', 'cluster', 'corner', 'curtain', 'stack', 'mixed', 'sparse', 'inset'],
    podium: ['stripe', 'louvre', 'service', 'inset', 'panels'],
    top: ['cluster', 'curtain', 'dark', 'strips', 'stack'],
    back: ['sparse', 'service', 'dark', 'grid'],
  },
  urban: {
    body: ['grid', 'ribbon', 'cluster', 'sparse', 'mixed', 'corner', 'deck', 'strips', 'service', 'panels'],
    podium: ['stripe', 'service', 'panels', 'louvre', 'deck'],
    top: ['cluster', 'sparse', 'dark', 'ribbon', 'mixed'],
    back: ['sparse', 'service', 'dark', 'mixed'],
  },
  jdm: {
    body: ['mixed', 'sparse', 'deck', 'grid', 'panels', 'service', 'cluster'],
    podium: ['panels', 'service', 'deck', 'stripe'],
    top: ['sparse', 'dark', 'deck', 'mixed'],
    back: ['sparse', 'dark', 'service'],
  },
};

/** Window tints per zone: the palette's window lights, plus a rare accent (red, amber). */
function tintFor(zone: ZoneId, rng: () => number): number {
  const list = zone === 'corporate' ? PAL.windowsCorp : zone === 'jdm' ? PAL.windowsJdm : PAL.windowsUrban;
  if (rng() < 0.08) {
    const accents = zoneAccent(zone);
    return accents[Math.floor(rng() * accents.length)];
  }
  return list[Math.floor(rng() * list.length)];
}

function pick<T>(list: readonly T[], rng: () => number, bias = 1): T {
  // `bias` > 1 leans on the front of the list, where the common styles are.
  return list[Math.floor(Math.pow(rng(), bias) * list.length)];
}

/** Whole floors, never less than one. */
export function snapFloors(h: number): number {
  return Math.max(FLOOR, Math.round(h / FLOOR) * FLOOR);
}

/** Deterministic seed for a plot, from where it stands. */
export function plotSeed(x: number, z: number): number {
  const h = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return Math.floor((h - Math.floor(h)) * 0xffffffff) >>> 0;
}

/* ------------------------------------------------------------------ skyline field */

/**
 * Smooth 0..1 value noise over the city, one octave of 140 m and one of 55 m: the hills and
 * valleys of the skyline. Heights are multiplied by `0.8 + 0.5 * field`, so a district reads
 * as a rise of towers falling away to lower streets, not a random scatter.
 */
export function skylineField(x: number, z: number): number {
  const lattice = (px: number, pz: number, period: number): number => {
    const gx = px / period;
    const gz = pz / period;
    const ix = Math.floor(gx);
    const iz = Math.floor(gz);
    const fx = gx - ix;
    const fz = gz - iz;
    const sx = fx * fx * (3 - 2 * fx);
    const sz = fz * fz * (3 - 2 * fz);
    const h = (a: number, b: number): number => {
      const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
      return v - Math.floor(v);
    };
    const top = h(ix, iz) + (h(ix + 1, iz) - h(ix, iz)) * sx;
    const bottom = h(ix, iz + 1) + (h(ix + 1, iz + 1) - h(ix, iz + 1)) * sx;
    return top + (bottom - top) * sz;
  };
  return lattice(x + 37, z - 91, 140) * 0.7 + lattice(x - 53, z + 17, 55) * 0.3;
}

/* ------------------------------------------------------------------ plots */

/**
 * Split a block's buildable rectangle into plots of uneven size. A block used to be a grid
 * of equal 17 m modules, which is the second thing (after the windows) that made every block
 * the same building repeated. Now it splits the longer axis at a random ratio, stops early
 * now and then to leave one big plot (a podium, a landmark), keeps a strip of pavement
 * between neighbours, and once in a while leaves a plot empty: a yard, a car park, air.
 */
export function subdividePlot(inner: Rect2, rng: () => number, opts: { minPlot: number; bigStop: number; emptyChance: number }): Rect2[] {
  const out: Rect2[] = [];
  const visit = (r: Rect2): void => {
    const w = r.maxX - r.minX;
    const d = r.maxZ - r.minZ;
    const longest = Math.max(w, d);
    const stop = longest <= opts.minPlot * 2.2 || (longest <= opts.minPlot * 4.4 && rng() < opts.bigStop);
    if (stop) {
      if (out.length > 0 && rng() < opts.emptyChance && longest < opts.minPlot * 2.2) return;
      out.push(r);
      return;
    }
    const gap = 0.6 + rng() * 1.2;
    const ratio = 0.36 + rng() * 0.28;
    if (w >= d) {
      const cut = r.minX + w * ratio;
      visit({ minX: r.minX, maxX: cut - gap / 2, minZ: r.minZ, maxZ: r.maxZ });
      visit({ minX: cut + gap / 2, maxX: r.maxX, minZ: r.minZ, maxZ: r.maxZ });
    } else {
      const cut = r.minZ + d * ratio;
      visit({ minX: r.minX, maxX: r.maxX, minZ: r.minZ, maxZ: cut - gap / 2 });
      visit({ minX: r.minX, maxX: r.maxX, minZ: cut + gap / 2, maxZ: r.maxZ });
    }
  };
  visit(inner);
  return out;
}

/* ------------------------------------------------------------------ massing */

interface Frame {
  plot: Rect2;
  spec: BuildingSpec;
  rng: () => number;
  h: number;
  base: number;
  w: number;
  d: number;
}

function vol(x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, role: Volume['role'], chamfer = 0): Volume {
  return { minX: Math.min(x0, x1), maxX: Math.max(x0, x1), minZ: Math.min(z0, z1), maxZ: Math.max(z0, z1), y0, y1, chamfer, bands: [], role };
}

/** The plot shrunk by `inset` on every side, never thinner than `minSide`. */
function shrink(r: Rect2, inset: number, minSide = 5): Rect2 {
  const w = r.maxX - r.minX;
  const d = r.maxZ - r.minZ;
  const ix = Math.min(inset, Math.max(0, (w - minSide) / 2));
  const iz = Math.min(inset, Math.max(0, (d - minSide) / 2));
  return { minX: r.minX + ix, maxX: r.maxX - ix, minZ: r.minZ + iz, maxZ: r.maxZ - iz };
}

/** A footprint of `fw` x `fd` inside the plot, placed at (tx, tz) in 0..1 of the free room. */
function place(r: Rect2, fw: number, fd: number, tx: number, tz: number): Rect2 {
  const w = r.maxX - r.minX;
  const d = r.maxZ - r.minZ;
  fw = Math.min(fw, w);
  fd = Math.min(fd, d);
  const x0 = r.minX + (w - fw) * tx;
  const z0 = r.minZ + (d - fd) * tz;
  return { minX: x0, maxX: x0 + fw, minZ: z0, maxZ: z0 + fd };
}

function chamferFor(f: Frame): number {
  const chance = KIT.chamferChance[f.spec.massing] ?? 0;
  if (Math.min(f.w, f.d) < 12 || f.rng() >= chance) return 0;
  return Math.min(f.w, f.d) * (0.12 + f.rng() * 0.1);
}

type Massing = (f: Frame) => Volume[];

const MASSINGS: Record<Exclude<Archetype, 'landmark'>, Massing> = {
  tower(f) {
    return [vol(f.plot.minX, f.plot.maxX, f.plot.minZ, f.plot.maxZ, f.base, f.base + f.h, 'body', chamferFor(f))];
  },
  low(f) {
    return [vol(f.plot.minX, f.plot.maxX, f.plot.minZ, f.plot.maxZ, f.base, f.base + f.h, 'body')];
  },
  shabby(f) {
    return [vol(f.plot.minX, f.plot.maxX, f.plot.minZ, f.plot.maxZ, f.base, f.base + f.h, 'body')];
  },
  slab(f) {
    // Thin across the short axis, taller than the plot's band would make it.
    const thin = f.w >= f.d ? 'z' : 'x';
    const frac = 0.34 + f.rng() * 0.18;
    const fw = thin === 'x' ? Math.max(4, f.w * frac) : f.w;
    const fd = thin === 'z' ? Math.max(4, f.d * frac) : f.d;
    const r = place(f.plot, fw, fd, f.rng() < 0.5 ? 0 : 1, f.rng() < 0.5 ? 0 : 1);
    return [vol(r.minX, r.maxX, r.minZ, r.maxZ, f.base, f.base + snapFloors(f.h * 1.15), 'body')];
  },
  podium(f) {
    const podium = snapFloors(Math.min(f.h * 0.35, 6 + f.rng() * 9));
    const tw = f.w * (0.42 + f.rng() * 0.25);
    const td = f.d * (0.42 + f.rng() * 0.25);
    // The tower sits centred or pushed into a corner of the podium.
    const corner = f.rng() < 0.5;
    const r = place(f.plot, Math.max(5, tw), Math.max(5, td), corner ? (f.rng() < 0.5 ? 0.08 : 0.92) : 0.5, corner ? (f.rng() < 0.5 ? 0.08 : 0.92) : 0.5);
    return [
      vol(f.plot.minX, f.plot.maxX, f.plot.minZ, f.plot.maxZ, f.base, f.base + podium, 'podium'),
      vol(r.minX, r.maxX, r.minZ, r.maxZ, f.base + podium, f.base + f.h, 'body', chamferFor(f)),
    ];
  },
  stepped(f) {
    const tiers = f.spec.massing >= 3 ? 3 + (f.rng() < 0.4 ? 1 : 0) : 2;
    const out: Volume[] = [];
    let y = f.base;
    let box: Rect2 = f.plot;
    let left = f.h;
    for (let i = 0; i < tiers; i++) {
      const last = i === tiers - 1;
      const hh = last ? left : snapFloors(left * (0.4 + f.rng() * 0.2));
      if (i > 0) box = shrink(box, Math.min(f.w, f.d) * (0.08 + f.rng() * 0.08));
      out.push(vol(box.minX, box.maxX, box.minZ, box.maxZ, y, y + hh, i === 0 ? 'body' : last ? 'top' : 'body'));
      y += hh;
      left -= hh;
      if (left < FLOOR) break;
    }
    return out;
  },
  offset(f) {
    // Two or three volumes stacked with a sideways shift each; the upper ones overhang.
    const n = f.h > 40 ? 3 : 2;
    const out: Volume[] = [];
    const fw = f.w * (0.7 + f.rng() * 0.15);
    const fd = f.d * (0.7 + f.rng() * 0.15);
    let y = f.base;
    let left = f.h;
    for (let i = 0; i < n; i++) {
      const last = i === n - 1;
      const hh = last ? left : snapFloors(left * (0.45 + f.rng() * 0.15));
      const r = place(f.plot, Math.max(5, fw), Math.max(5, fd), i % 2 === 0 ? 0.05 + f.rng() * 0.2 : 0.75 + f.rng() * 0.2, i % 2 === 0 ? 0.75 + f.rng() * 0.2 : 0.05 + f.rng() * 0.2);
      out.push(vol(r.minX, r.maxX, r.minZ, r.maxZ, y, y + hh, last ? 'top' : 'body'));
      y += hh;
      left -= hh;
    }
    return out;
  },
  cantilever(f) {
    // A narrower shaft, and the upper block pushed out past it on one side.
    const shaftH = snapFloors(f.h * (0.5 + f.rng() * 0.2));
    const shaft = shrink(f.plot, Math.min(f.w, f.d) * 0.16);
    const side = Math.floor(f.rng() * 4);
    const reach = Math.min(f.w, f.d) * (0.16 + f.rng() * 0.1);
    const upper: Rect2 = { ...shaft };
    if (side === 0) upper.maxX = Math.min(f.plot.maxX + reach * 0.4, shaft.maxX + reach);
    else if (side === 1) upper.minX = Math.max(f.plot.minX - reach * 0.4, shaft.minX - reach);
    else if (side === 2) upper.maxZ = Math.min(f.plot.maxZ + reach * 0.4, shaft.maxZ + reach);
    else upper.minZ = Math.max(f.plot.minZ - reach * 0.4, shaft.minZ - reach);
    return [
      vol(shaft.minX, shaft.maxX, shaft.minZ, shaft.maxZ, f.base, f.base + shaftH, 'body'),
      vol(upper.minX, upper.maxX, upper.minZ, upper.maxZ, f.base + shaftH, f.base + f.h, 'top'),
    ];
  },
  recessed(f) {
    // Two wings the full height with the centre set back and a little lower.
    const along = f.w >= f.d ? 'x' : 'z';
    const span = along === 'x' ? f.w : f.d;
    const wing = span * (0.24 + f.rng() * 0.1);
    const setback = Math.min(f.w, f.d) * (0.18 + f.rng() * 0.12);
    const centreH = snapFloors(f.h * (0.7 + f.rng() * 0.22));
    if (along === 'x') {
      return [
        vol(f.plot.minX, f.plot.minX + wing, f.plot.minZ, f.plot.maxZ, f.base, f.base + f.h, 'wing'),
        vol(f.plot.maxX - wing, f.plot.maxX, f.plot.minZ, f.plot.maxZ, f.base, f.base + f.h, 'wing'),
        vol(f.plot.minX + wing - 0.5, f.plot.maxX - wing + 0.5, f.plot.minZ + setback, f.plot.maxZ - setback, f.base, f.base + centreH, 'body'),
      ];
    }
    return [
      vol(f.plot.minX, f.plot.maxX, f.plot.minZ, f.plot.minZ + wing, f.base, f.base + f.h, 'wing'),
      vol(f.plot.minX, f.plot.maxX, f.plot.maxZ - wing, f.plot.maxZ, f.base, f.base + f.h, 'wing'),
      vol(f.plot.minX + setback, f.plot.maxX - setback, f.plot.minZ + wing - 0.5, f.plot.maxZ - wing + 0.5, f.base, f.base + centreH, 'body'),
    ];
  },
  twin(f) {
    // Two slender towers on one podium, one a few floors shorter, linked by a bridge.
    const along = f.w >= f.d ? 'x' : 'z';
    const span = along === 'x' ? f.w : f.d;
    const tw = span * (0.34 + f.rng() * 0.08);
    const podium = snapFloors(4 + f.rng() * 5);
    const h2 = snapFloors(f.h * (0.72 + f.rng() * 0.2));
    const a = along === 'x' ? place(f.plot, tw, f.d * 0.86, 0, 0.5) : place(f.plot, f.w * 0.86, tw, 0.5, 0);
    const b = along === 'x' ? place(f.plot, tw, f.d * 0.86, 1, 0.5) : place(f.plot, f.w * 0.86, tw, 0.5, 1);
    const linkY = f.base + podium + snapFloors((h2 - podium) * (0.45 + f.rng() * 0.3));
    const link =
      along === 'x'
        ? vol(a.maxX, b.minX, (a.minZ + a.maxZ) / 2 - 2, (a.minZ + a.maxZ) / 2 + 2, linkY, linkY + FLOOR, 'link')
        : vol((a.minX + a.maxX) / 2 - 2, (a.minX + a.maxX) / 2 + 2, a.maxZ, b.minZ, linkY, linkY + FLOOR, 'link');
    return [
      vol(f.plot.minX, f.plot.maxX, f.plot.minZ, f.plot.maxZ, f.base, f.base + podium, 'podium'),
      vol(a.minX, a.maxX, a.minZ, a.maxZ, f.base + podium, f.base + f.h, 'body'),
      vol(b.minX, b.maxX, b.minZ, b.maxZ, f.base + podium, f.base + h2, 'body'),
      link,
    ];
  },
};

/**
 * The landmarks: five silhouettes the eye can name from across the bay. Which plot anchors
 * which is the caller's decision (`cityBuilder` keeps a list of anchors); the kit only draws.
 */
export const LANDMARKS = ['spire', 'crown', 'blade', 'twins', 'pagoda'] as const;

function landmarkMassing(f: Frame, which: number): Volume[] {
  const kind = LANDMARKS[((which % LANDMARKS.length) + LANDMARKS.length) % LANDMARKS.length];
  if (kind === 'spire') {
    // Five tiers shrinking fast into a needle.
    const out: Volume[] = [];
    let box: Rect2 = f.plot;
    let y = f.base;
    const shares = [0.34, 0.24, 0.18, 0.14, 0.1];
    for (let i = 0; i < shares.length; i++) {
      const hh = snapFloors(f.h * shares[i]);
      out.push(vol(box.minX, box.maxX, box.minZ, box.maxZ, y, y + hh, i === 0 ? 'body' : i === shares.length - 1 ? 'top' : 'body', i === 0 ? Math.min(f.w, f.d) * 0.12 : 0));
      y += hh;
      box = shrink(box, Math.min(box.maxX - box.minX, box.maxZ - box.minZ) * 0.17, 4);
    }
    return out;
  }
  if (kind === 'crown') {
    // A wide shaft, a narrower head that overhangs on every side: the crown frame goes on top.
    const shaftH = snapFloors(f.h * 0.78);
    const shaft = shrink(f.plot, Math.min(f.w, f.d) * 0.14);
    const head = shrink(f.plot, Math.min(f.w, f.d) * 0.06);
    return [
      vol(shaft.minX, shaft.maxX, shaft.minZ, shaft.maxZ, f.base, f.base + shaftH, 'body', Math.min(f.w, f.d) * 0.1),
      vol(head.minX, head.maxX, head.minZ, head.maxZ, f.base + shaftH, f.base + f.h, 'top'),
    ];
  }
  if (kind === 'blade') {
    // A very thin, very tall slab with a horizontal fin cantilevered off the top.
    const along = f.w >= f.d ? 'x' : 'z';
    const blade = along === 'x' ? place(f.plot, f.w, Math.max(5, f.d * 0.3), 0.5, 0.5) : place(f.plot, Math.max(5, f.w * 0.3), f.d, 0.5, 0.5);
    const finH = FLOOR * 2;
    const fin: Rect2 = along === 'x' ? { ...blade, minZ: blade.minZ - f.d * 0.2, maxZ: blade.maxZ + f.d * 0.2 } : { ...blade, minX: blade.minX - f.w * 0.2, maxX: blade.maxX + f.w * 0.2 };
    return [
      vol(blade.minX, blade.maxX, blade.minZ, blade.maxZ, f.base, f.base + f.h - finH, 'body'),
      vol(fin.minX, fin.maxX, fin.minZ, fin.maxZ, f.base + f.h - finH, f.base + f.h, 'top'),
    ];
  }
  if (kind === 'twins') {
    const twins = MASSINGS.twin(f);
    // A second bridge higher up.
    const a = twins[1];
    const b = twins[2];
    const link = twins[3];
    const y = Math.min(a.y1, b.y1) - FLOOR * 3;
    twins.push({ ...link, y0: y, y1: y + FLOOR, bands: [] });
    return twins;
  }
  // pagoda: stacked volumes, each shifted against the one below, with lit undersides.
  const out: Volume[] = [];
  const n = 5;
  const fw = f.w * 0.72;
  const fd = f.d * 0.72;
  let y = f.base;
  for (let i = 0; i < n; i++) {
    const hh = snapFloors(f.h / n);
    const r = place(f.plot, fw, fd, i % 2 === 0 ? 0.1 : 0.9, i % 2 === 1 ? 0.1 : 0.9);
    out.push(vol(r.minX, r.maxX, r.minZ, r.maxZ, y, y + hh, i === n - 1 ? 'top' : 'body'));
    y += hh;
  }
  return out;
}

/** Choose an archetype from the massing table, falling back when the plot cannot carry it. */
function pickArchetype(f: Frame): Archetype {
  if (f.spec.archetype) return f.spec.archetype;
  if (f.spec.landmark !== undefined) return 'landmark';
  const table = KIT.archetypes[f.spec.massing] ?? KIT.archetypes[2];
  let entries = Object.entries(table) as Array<[Archetype, number]>;
  if (f.spec.massing === 1 && f.spec.zone === 'jdm') entries = [['shabby', KIT.jdmShabby], ['low', 1 - KIT.jdmShabby]];
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = f.rng() * total;
  let picked: Archetype = 'tower';
  for (const [a, w] of entries) {
    r -= w;
    if (r <= 0) {
      picked = a;
      break;
    }
  }
  const short = Math.min(f.w, f.d);
  const long = Math.max(f.w, f.d);
  if (picked === 'slab' && short < 9) picked = 'tower';
  if (picked === 'recessed' && (long < 15 || short < 8)) picked = 'tower';
  if (picked === 'twin' && (long < 22 || short < 8)) picked = 'stepped';
  if ((picked === 'offset' || picked === 'cantilever' || picked === 'podium') && short < 8) picked = 'tower';
  if (picked === 'stepped' && short < 7) picked = 'tower';
  return picked;
}

/* ------------------------------------------------------------------ bands */

/** A band spanning [y0, y1) in one style, tinted. */
function band(y0: number, y1: number, style: FacadeStyle, tint: number, bright: number, wall: number): Band {
  return { y0, y1, style, tint, bright, wall };
}

/**
 * Cut a volume's walls into bands. Roles: a podium is one band from its own pool; a body
 * gets the primary style, maybe a lit lobby or a blank ground floor where it meets the
 * street, maybe a dark service band part-way up and a second pattern for the top storeys.
 */
function assignBands(v: Volume, f: Frame, primary: FacadeStyle, tint: number, bright: number, wall: number, dark: boolean, hasStreet: boolean): void {
  const pools = STYLE_POOLS[f.spec.zone];
  const rng = f.rng;
  const h = v.y1 - v.y0;
  if (dark) {
    v.bands.push(band(v.y0, v.y1, 'dark', tint, bright * 0.7, wall));
    return;
  }
  if (v.role === 'podium' || v.role === 'link') {
    v.bands.push(band(v.y0, v.y1, v.role === 'link' ? 'ribbon' : pick(pools.podium, rng, 1.3), tint, bright, wall));
    return;
  }
  let y = v.y0;
  // Ground floors on the street: a lit lobby or a blank plinth.
  if (v.y0 <= f.base + 0.01 && hasStreet && h > FLOOR * 3 && f.spec.detail !== 'far') {
    const r = rng();
    if (r < KIT.lobbyChance) {
      const hh = FLOOR * (h > FLOOR * 6 && rng() < 0.4 ? 2 : 1);
      v.bands.push(band(y, y + hh, 'stripe', tint, bright * 1.1, wall));
      y += hh;
    } else if (r < KIT.lobbyChance + KIT.groundServiceChance) {
      const hh = FLOOR * (rng() < 0.5 ? 2 : 1);
      v.bands.push(band(y, y + hh, rng() < 0.5 ? 'service' : 'louvre', tint, bright, wall));
      y += hh;
    }
  }
  const topStyle = (v.role === 'top' || rng() < KIT.topBandChance) && h > FLOOR * 6 && f.spec.detail !== 'far' ? pick(pools.top, rng, 1.2) : null;
  const topH = topStyle ? snapFloors((v.y1 - y) * (0.25 + rng() * 0.15)) : 0;
  const bodyEnd = v.y1 - topH;
  if (f.spec.detail !== 'far' && bodyEnd - y > FLOOR * 8 && rng() < KIT.serviceBandChance) {
    // A dark service floor part-way up the body.
    const at = y + snapFloors((bodyEnd - y) * (0.4 + rng() * 0.3));
    const hh = FLOOR * (rng() < 0.6 ? 1 : 2);
    v.bands.push(band(y, at, primary, tint, bright, wall));
    v.bands.push(band(at, Math.min(bodyEnd, at + hh), rng() < 0.5 ? 'service' : 'louvre', tint, bright, wall));
    y = Math.min(bodyEnd, at + hh);
  }
  if (bodyEnd > y) v.bands.push(band(y, bodyEnd, primary, tint, bright, wall));
  if (topStyle && topH > 0) {
    // The top storeys sometimes take their own light.
    const topTint = rng() < 0.3 ? tintFor(f.spec.zone, rng) : tint;
    v.bands.push(band(bodyEnd, v.y1, topStyle, topTint, bright, wall));
  }
}

/* ------------------------------------------------------------------ emission */

/**
 * One wall from (px, pz) to (qx, qz), bottom `y0`, top `y1`, facing the left of its
 * direction: walk a footprint clockwise (seen from above, x east, z south) and every wall
 * faces out. UVs tile by world metres; `uo`/`vo` shift the pattern per building.
 */
function wall(b: EnvBuilders, px: number, pz: number, qx: number, qz: number, y0: number, y1: number, yBase: number, uo: number, vo: number): void {
  const len = Math.hypot(qx - px, qz - pz);
  const u1 = uo + len / FACADE_TILE;
  const v0 = vo + (y0 - yBase) / FACADE_TILE;
  const v1 = vo + (y1 - yBase) / FACADE_TILE;
  b.facade.quad(px, y0, pz, qx, y0, qz, qx, y1, qz, px, y1, pz, uo, v0, u1, v1);
}

/** The footprint's outline, clockwise from above so every wall faces out. */
function outline(v: Volume): Array<[number, number, number]> {
  const c = v.chamfer;
  const { minX: x0, maxX: x1, minZ: z0, maxZ: z1 } = v;
  // Each edge carries which axis wall it belongs to: 0 +x, 1 -x, 2 +z, 3 -z; 4 for a corner.
  if (c <= 0) {
    return [
      [x1, z1, 0],
      [x1, z0, 3],
      [x0, z0, 1],
      [x0, z1, 2],
    ];
  }
  return [
    [x1, z1 - c, 0],
    [x1, z0 + c, 4],
    [x1 - c, z0, 3],
    [x0 + c, z0, 4],
    [x0, z0 + c, 1],
    [x0, z1 - c, 4],
    [x0 + c, z1, 2],
    [x1 - c, z1, 4],
  ];
}

function emitVolume(b: EnvBuilders, v: Volume, below: Volume | null, street: [boolean, boolean, boolean, boolean], uo: number, vo: number, rng: () => number): void {
  const pts = outline(v);
  for (let i = 0; i < pts.length; i++) {
    const [px, pz, face] = pts[i];
    const [qx, qz] = pts[(i + 1) % pts.length];
    const facesStreet = face < 4 ? street[face] : true;
    for (const bd of v.bands) {
      const style = !facesStreet && v.backStyle && bd.style !== 'dark' && bd.style !== 'stripe' ? v.backStyle : bd.style;
      const cell = facadeCell(style);
      b.facade.color(bd.tint, bd.bright).cell(cell.u0, cell.v0, bd.wall);
      wall(b, px, pz, qx, qz, bd.y0, bd.y1, v.y0, uo, vo);
    }
  }
  // Roof: the full rectangle, plus the corner triangles cut away by a chamfer left dark.
  b.roof.color(PAL.concrete, 0.7 + rng() * 0.5);
  const cx = (v.minX + v.maxX) / 2;
  const cz = (v.minZ + v.maxZ) / 2;
  if (v.chamfer <= 0) {
    b.roof.planeY(cx, v.y1, cz, v.maxX - v.minX, v.maxZ - v.minZ);
  } else {
    const c = v.chamfer;
    b.roof.planeY(cx, v.y1, cz, v.maxX - v.minX - 2 * c, v.maxZ - v.minZ);
    b.roof.planeY(v.minX + c / 2, v.y1, cz, c, v.maxZ - v.minZ - 2 * c);
    b.roof.planeY(v.maxX - c / 2, v.y1, cz, c, v.maxZ - v.minZ - 2 * c);
    const y = v.y1;
    // Corner triangles as quads with a doubled vertex.
    b.roof.quad(v.minX, y, v.minZ + c, v.minX + c, y, v.minZ, v.minX + c, y, v.minZ, v.minX, y, v.minZ + c);
    b.roof.quad(v.maxX - c, y, v.minZ, v.maxX, y, v.minZ + c, v.maxX, y, v.minZ + c, v.maxX - c, y, v.minZ);
    b.roof.quad(v.maxX, y, v.maxZ - c, v.maxX - c, y, v.maxZ, v.maxX - c, y, v.maxZ, v.maxX, y, v.maxZ - c);
    b.roof.quad(v.minX + c, y, v.maxZ, v.minX, y, v.maxZ - c, v.minX, y, v.maxZ - c, v.minX + c, y, v.maxZ);
  }
  // Underside wherever this volume overhangs the one it stands on (or the air, for a link).
  if (v.y0 > 0.5) {
    const pieces = below ? subtractRect(v, below) : [v];
    b.roof.color(PAL.concrete, 0.55);
    for (const p of pieces) {
      if (p.maxX - p.minX < 0.2 || p.maxZ - p.minZ < 0.2) continue;
      b.roof.quad(p.minX, v.y0, p.minZ, p.maxX, v.y0, p.minZ, p.maxX, v.y0, p.maxZ, p.minX, v.y0, p.maxZ);
    }
  }
}

/* ------------------------------------------------------------------ roof furniture */

function rim(b: EnvBuilders, r: Rect2, y: number, color: number, strength: number, w: number, pulse: boolean): void {
  const t = pulse ? b.neonPulse : b.neon;
  t.color(color, strength);
  t.tube(r.minX, y, r.minZ, r.maxX, y, r.minZ, w);
  t.tube(r.minX, y, r.maxZ, r.maxX, y, r.maxZ, w);
  t.tube(r.minX, y, r.minZ, r.minX, y, r.maxZ, w);
  t.tube(r.maxX, y, r.minZ, r.maxX, y, r.maxZ, w);
}

function mast(b: EnvBuilders, x: number, z: number, y: number, h: number, w: number, beacon: boolean): void {
  b.props.color(PAL.metalDark, 0.65);
  b.props.box(x, y + h / 2, z, w, h, w);
  if (beacon) {
    b.neonFlicker.color(PAL.neonMagenta, 0.85);
    b.neonFlicker.box(x, y + h, z, w * 2, w * 2, w * 2);
    halo(b, x, y + h, z, 5, 5, 0, PAL.neonMagenta, 0.12);
  }
}

/** Two to four small red lights on the roof corners: the only light a dark building shows. */
function navLights(b: EnvBuilders, r: Rect2, y: number, rng: () => number): void {
  const corners: Array<[number, number]> = [
    [r.minX + 0.5, r.minZ + 0.5],
    [r.maxX - 0.5, r.minZ + 0.5],
    [r.maxX - 0.5, r.maxZ - 0.5],
    [r.minX + 0.5, r.maxZ - 0.5],
  ];
  const n = rng() < 0.5 ? 2 : 4;
  const first = Math.floor(rng() * 4);
  for (let i = 0; i < n; i++) {
    const [x, z] = corners[(first + i * (4 / n)) % 4];
    b.neonFlicker.color(PAL.neonMagenta, 0.7);
    b.neonFlicker.box(x, y + 0.6, z, 0.4, 0.4, 0.4);
  }
}

/**
 * What stands on the roof. A crown on the tall ones (a lit rim, a frame, a row of fins or a
 * spire), mechanical blocks and antennas on most, a beacon on very few: a skyline of
 * blinking dots is the busiest thing a night city can do.
 */
function roofFurniture(b: EnvBuilders, bld: Building, spec: BuildingSpec, rng: () => number, accent: number): void {
  const r = bld.crown;
  const top = bld.top;
  const w = r.maxX - r.minX;
  const d = r.maxZ - r.minZ;
  const h = top - spec.base;
  const far = spec.detail === 'far';
  const cx = (r.minX + r.maxX) / 2;
  const cz = (r.minZ + r.maxZ) / 2;

  if (bld.dark) {
    navLights(b, r, top, rng);
    if (!far && h > 30 && rng() < 0.5) mast(b, cx, cz, top, 5 + rng() * 8, 0.35, false);
    return;
  }

  // Crown.
  const crownKind = h >= KIT.crownMinHeight && rng() < (far ? KIT.crownChance * 0.5 : KIT.crownChance) ? pick(['rim', 'frame', 'fins', 'spire', 'ring'] as const, rng) : null;
  if (crownKind === 'rim') {
    rim(b, shrink(r, 0.15, 1), top + 0.25, accent, 1, 0.25, rng() < 0.5);
  } else if (crownKind === 'frame') {
    const inner = shrink(r, 0.6, 1);
    b.props.color(PAL.metalDark, 0.8);
    for (const [px, pz] of [
      [inner.minX, inner.minZ],
      [inner.maxX, inner.minZ],
      [inner.maxX, inner.maxZ],
      [inner.minX, inner.maxZ],
    ]) {
      b.props.box(px, top + 1.2, pz, 0.4, 2.4, 0.4);
    }
    rim(b, inner, top + 2.4, accent, 0.9, 0.22, true);
    halo(b, cx, top + 2.4, cz, w + 4, 6, 0, accent, 0.1);
    halo(b, cx, top + 2.4, cz, d + 4, 6, Math.PI / 2, accent, 0.1);
  } else if (crownKind === 'fins') {
    // A row of thin blades along the long edge, each with a lit top.
    const alongX = w >= d;
    const n = 3 + Math.floor(rng() * 3);
    const span = (alongX ? w : d) * 0.8;
    const fh = 2.5 + rng() * 3.5;
    for (let i = 0; i < n; i++) {
      const t = -span / 2 + (span * (i + 0.5)) / n;
      const px = alongX ? cx + t : cx;
      const pz = alongX ? cz : cz + t;
      b.props.color(PAL.metalDark, 0.75);
      b.props.box(px, top + fh / 2, pz, alongX ? 0.4 : Math.min(d * 0.7, 6), fh, alongX ? Math.min(w * 0.7, 6) : 0.4);
      b.neon.color(accent, 0.8);
      if (alongX) b.neon.tube(px, top + fh + 0.1, pz - Math.min(w * 0.7, 6) / 2, px, top + fh + 0.1, pz + Math.min(w * 0.7, 6) / 2, 0.16);
      else b.neon.tube(px - Math.min(d * 0.7, 6) / 2, top + fh + 0.1, pz, px + Math.min(d * 0.7, 6) / 2, top + fh + 0.1, pz, 0.16);
    }
  } else if (crownKind === 'spire') {
    const sh = 8 + rng() * 16;
    mast(b, cx, cz, top, sh, 0.7, rng() < KIT.beaconChance * 2);
    b.neonPulse.color(accent, 0.7);
    b.neonPulse.tube(cx, top + 0.5, cz, cx, top + sh * 0.7, cz, 0.3);
  } else if (crownKind === 'ring') {
    // A lit ring floating a floor above the roof on four thin posts: the reference's crowns.
    const ring = shrink(r, -1.2, 1);
    const ry = top + 3.2;
    b.props.color(PAL.metalDark, 0.7);
    for (const [px, pz] of [
      [r.minX + 0.8, r.minZ + 0.8],
      [r.maxX - 0.8, r.minZ + 0.8],
      [r.maxX - 0.8, r.maxZ - 0.8],
      [r.minX + 0.8, r.maxZ - 0.8],
    ]) {
      b.props.box(px, top + 1.6, pz, 0.3, 3.2, 0.3);
    }
    rim(b, ring, ry, accent, 1, 0.35, true);
    halo(b, cx, ry, cz, w + 8, 9, 0, accent, 0.12);
    halo(b, cx, ry, cz, d + 8, 9, Math.PI / 2, accent, 0.12);
  }
  if (far) {
    if (h > 62) mast(b, cx, cz, top, 6 + rng() * 14, 0.6, h > 105 && rng() < 0.4);
    return;
  }

  // Mechanical blocks, off to one side so the crown keeps the centre.
  if (rng() < KIT.mechChance && w > 4 && d > 4) {
    const n = 1 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) {
      const bw = 1.6 + rng() * Math.min(5, w * 0.35);
      const bd = 1.6 + rng() * Math.min(5, d * 0.35);
      const bh = 0.8 + rng() * 2.6;
      b.props.color(PAL.metalDark, 0.7 + rng() * 0.6);
      b.props.box(r.minX + bw / 2 + rng() * Math.max(0, w - bw), top + bh / 2, r.minZ + bd / 2 + rng() * Math.max(0, d - bd), bw, bh, bd);
    }
  }
  // Antennas: a cluster of thin masts, one of them lit once in a while.
  if (h > 18 && rng() < KIT.antennaChance) {
    const n = crownKind === 'spire' ? 1 : 1 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) {
      const mh = 3 + rng() * (h > 60 ? 14 : 8);
      const px = r.minX + 0.6 + rng() * Math.max(0.2, w - 1.2);
      const pz = r.minZ + 0.6 + rng() * Math.max(0.2, d - 1.2);
      mast(b, px, pz, top, mh, 0.3, i === 0 && rng() < KIT.beaconChance);
    }
  }
}

/** Vertical light strips up two (or four) corners of the lowest street-facing volume. */
function cornerLights(b: EnvBuilders, v: Volume, accent: number, rng: () => number): void {
  const all = v.y1 - v.y0 > 90;
  const corners: Array<[number, number, number, number]> = [
    [v.minX, v.minZ, -1, -1],
    [v.maxX, v.minZ, 1, -1],
    [v.maxX, v.maxZ, 1, 1],
    [v.minX, v.maxZ, -1, 1],
  ];
  const first = Math.floor(rng() * 4);
  const lit = all ? [0, 1, 2, 3] : [first, (first + 2) % 4];
  const t = rng() < 0.5 ? b.neon : b.neonPulse;
  for (const k of lit) {
    const [px, pz, sx, sz] = corners[k];
    const off = v.chamfer > 0 ? v.chamfer * 0.5 : 0.25;
    t.color(accent, 0.85);
    t.tube(px + sx * off, v.y0 + 3, pz + sz * off, px + sx * off, v.y1 - 1, pz + sz * off, 0.4);
  }
}

/** Lit under-edges where a tier steps back, as on the reference's setbacks. */
function setbackLights(b: EnvBuilders, v: Volume, accent: number): void {
  const y = v.y1 + 0.2;
  b.neon.color(accent, 0.5);
  b.neon.tube(v.minX, y, v.minZ, v.maxX, y, v.minZ, 0.2);
  b.neon.tube(v.minX, y, v.maxZ, v.maxX, y, v.maxZ, 0.2);
  b.neon.tube(v.minX, y, v.minZ, v.minX, y, v.maxZ, 0.2);
  b.neon.tube(v.maxX, y, v.minZ, v.maxX, y, v.maxZ, 0.2);
}

/** An awning over the ground floor with a warm tube under it: the cosy note of the old town. */
export function awning(b: EnvBuilders, m: Rect2, base: number, rng: () => number): void {
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

/** The old town's box, and everything bolted to it since: cages, balconies, a shack, a tank. */
function shabbyClutter(b: EnvBuilders, m: Rect2, base: number, top: number, rng: () => number): void {
  const w = m.maxX - m.minX;
  const d = m.maxZ - m.minZ;
  const h = top - base;
  const cages = 2 + Math.floor(rng() * 3);
  for (let i = 0; i < cages; i++) {
    const onX = rng() < 0.5;
    const side = rng() < 0.5 ? -1 : 1;
    const px = onX ? (side > 0 ? m.maxX : m.minX) : m.minX + 1.5 + rng() * Math.max(0.5, w - 3);
    const pz = onX ? m.minZ + 1.5 + rng() * Math.max(0.5, d - 3) : side > 0 ? m.maxZ : m.minZ;
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
  if (rng() < 0.6) awning(b, m, base, rng);
}

/* ------------------------------------------------------------------ entry point */

/**
 * Build one building on `plot`. Returns what the caller needs to dress it further (signs,
 * shopfronts) and what the tests count.
 */
export function buildBuilding(b: EnvBuilders, plot: Rect2, spec: BuildingSpec, rng: () => number): Building {
  const w = plot.maxX - plot.minX;
  const d = plot.maxZ - plot.minZ;
  const h = snapFloors(spec.height);
  const f: Frame = { plot, spec, rng, h, base: spec.base, w, d };
  const street = spec.street ?? [true, true, true, true];
  const hasStreet = street.some(Boolean);

  const archetype = pickArchetype(f);
  const volumes = archetype === 'landmark' ? landmarkMassing(f, spec.landmark ?? 0) : MASSINGS[archetype](f);

  // The building's own light: one tint, one wall brightness, one pattern offset.
  const zone = spec.zone;
  const tint = tintFor(zone, rng);
  const bright = 0.75 + rng() * 0.4;
  const wallBright = (zone === 'corporate' ? 0.7 : zone === 'jdm' ? 0.9 : 0.8) + rng() * 0.35;
  const dark = spec.massing >= 2 && spec.landmark === undefined && rng() < KIT.darkChance[zone];
  const pools = STYLE_POOLS[zone];
  const primary = pick(pools.body, rng, 1.25);
  const backStyle = spec.detail === 'near' && rng() < KIT.backStyleChance ? pick(pools.back, rng) : undefined;
  const uo = Math.floor(rng() * FACADE_GRID.cols) / FACADE_GRID.cols;
  const vo = Math.floor(rng() * FACADE_GRID.rows) / FACADE_GRID.rows;

  for (const v of volumes) {
    // Wings and second towers may take their own pattern, so a pair never reads as one box.
    const style = v.role === 'wing' || (archetype === 'twin' && v.role === 'body' && rng() < 0.5) ? pick(pools.body, rng, 1.25) : primary;
    assignBands(v, f, style, tint, bright, wallBright, dark, hasStreet);
    if (backStyle) v.backStyle = backStyle;
  }

  // Emit, each volume against the one under it so overhangs get an underside.
  const stacked = [...volumes].sort((p, q) => p.y0 - q.y0);
  for (const v of stacked) {
    let below: Volume | null = null;
    for (const o of stacked) {
      if (o === v || o.y1 < v.y0 - 0.01 || o.y1 > v.y0 + 0.01) continue;
      if (o.maxX <= v.minX || o.minX >= v.maxX || o.maxZ <= v.minZ || o.minZ >= v.maxZ) continue;
      below = o;
      break;
    }
    emitVolume(b, v, below, street, uo, vo, rng);
  }

  let top = -Infinity;
  let crown: Rect2 = plot;
  for (const v of volumes) {
    if (v.role === 'link') continue;
    if (v.y1 > top) {
      top = v.y1;
      crown = v;
    }
  }
  const styles: FacadeStyle[] = [];
  for (const v of volumes) {
    for (const bd of v.bands) if (!styles.includes(bd.style)) styles.push(bd.style);
    if (v.backStyle && !styles.includes(v.backStyle)) styles.push(v.backStyle);
  }
  const bld: Building = { archetype, volumes, top, crown, styles, dark };

  /* ------------------------------------------------ light and furniture */

  const accents = zoneAccent(zone);
  const accent = accents[Math.floor(rng() * accents.length)];
  if (spec.detail !== 'far' && !dark) {
    // Setback edges glow on the stepped and offset kinds; corners on the tall street faces.
    if ((archetype === 'stepped' || archetype === 'offset' || archetype === 'landmark') && h > 30) {
      for (const v of volumes) if (v.role === 'body' && v.y1 < top - 0.01) setbackLights(b, v, accent);
    }
    const base = stacked[0];
    if (h > 40 && hasStreet && rng() < KIT.cornerLightChance) cornerLights(b, base.role === 'podium' ? stacked[1] ?? base : base, accent, rng);
    if (archetype === 'twin' || (archetype === 'landmark' && spec.landmark !== undefined && LANDMARKS[spec.landmark % LANDMARKS.length] === 'twins')) {
      for (const v of volumes) {
        if (v.role !== 'link') continue;
        b.neonPulse.color(accent, 0.8);
        b.neonPulse.tube(v.minX, v.y0 - 0.05, v.minZ - 0.2, v.maxX, v.y0 - 0.05, v.minZ - 0.2, 0.16);
        b.neonPulse.tube(v.minX, v.y0 - 0.05, v.maxZ + 0.2, v.maxX, v.y0 - 0.05, v.maxZ + 0.2, 0.16);
      }
    }
  }
  if (spec.detail === 'near' && archetype === 'shabby') shabbyClutter(b, plot, spec.base, top, rng);
  if (spec.detail === 'near' && archetype === 'low' && zone === 'jdm' && rng() < 0.5) awning(b, plot, spec.base, rng);
  roofFurniture(b, bld, spec, rng, accent);
  return bld;
}

/**
 * An enclosed bridge between two neighbouring buildings on one block, at height `y`:
 * the same body as the street skybridges (`landmarksBuilder`), axis-aligned.
 */
export function buildLink(b: EnvBuilders, a: Rect2, c: Rect2, y: number, zone: ZoneId, rng: () => number): void {
  const alongX = a.maxX <= c.minX || c.maxX <= a.minX;
  const tint = tintFor(zone, rng);
  let v: Volume;
  if (alongX) {
    const left = a.maxX <= c.minX ? a : c;
    const right = left === a ? c : a;
    const z0 = Math.max(left.minZ, right.minZ);
    const z1 = Math.min(left.maxZ, right.maxZ);
    if (z1 - z0 < 4) return;
    const mz = (z0 + z1) / 2;
    v = vol(left.maxX - 0.3, right.minX + 0.3, mz - 1.8, mz + 1.8, y, y + FLOOR, 'link');
  } else {
    const near = a.maxZ <= c.minZ ? a : c;
    const farSide = near === a ? c : a;
    const x0 = Math.max(near.minX, farSide.minX);
    const x1 = Math.min(near.maxX, farSide.maxX);
    if (x1 - x0 < 4) return;
    const mx = (x0 + x1) / 2;
    v = vol(mx - 1.8, mx + 1.8, near.maxZ - 0.3, farSide.minZ + 0.3, y, y + FLOOR, 'link');
  }
  v.bands.push(band(v.y0 + 0.3, v.y1 - 0.3, 'ribbon', tint, 1, 1));
  emitVolume(b, v, null, [true, true, true, true], 0, 0, rng);
  b.props.color(PAL.metalDark, 0.85);
  b.props.box((v.minX + v.maxX) / 2, v.y0 + 0.15, (v.minZ + v.maxZ) / 2, v.maxX - v.minX, 0.3, v.maxZ - v.minZ + 0.4, { bottom: true });
  b.props.box((v.minX + v.maxX) / 2, v.y1 - 0.15, (v.minZ + v.maxZ) / 2, v.maxX - v.minX, 0.3, v.maxZ - v.minZ + 0.4);
  const accents = zoneAccent(zone);
  const accent = accents[Math.floor(rng() * accents.length)];
  b.neonPulse.color(accent, 0.7);
  if (alongX) {
    b.neonPulse.tube(v.minX, v.y0 - 0.05, v.minZ - 0.25, v.maxX, v.y0 - 0.05, v.minZ - 0.25, 0.14);
    b.neonPulse.tube(v.minX, v.y0 - 0.05, v.maxZ + 0.25, v.maxX, v.y0 - 0.05, v.maxZ + 0.25, 0.14);
  } else {
    b.neonPulse.tube(v.minX - 0.25, v.y0 - 0.05, v.minZ, v.minX - 0.25, v.y0 - 0.05, v.maxZ, 0.14);
    b.neonPulse.tube(v.maxX + 0.25, v.y0 - 0.05, v.minZ, v.maxX + 0.25, v.y0 - 0.05, v.maxZ, 0.14);
  }
}

/** Test helper: a fresh rng for a plot. */
export function rngForPlot(x: number, z: number): () => number {
  return makeRng(plotSeed(x, z));
}
