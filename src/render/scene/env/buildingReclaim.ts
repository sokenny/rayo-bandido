import type { ZoneId } from '../../../world/cityPlan';
import { PAL } from './palette';
import { makeRng, type Rect2 } from './meshBuilder';
import type { EnvBuilders } from './builders';
import { buildGroundModule, pickGroundModule, type GroundFace } from './groundFloor';
import { grimeSurface, paintSurface } from './graffiti';
import { canopyTree, crookedTree, fern, sapling, shrub, vine, weedLine, weeds } from './plants';
import { seedAt, type ReclaimAnchors, type ReclaimProfile } from './reclaim';

/**
 * What reclamation does to one building.
 *
 * `cityBuilder` calls this once per plot, after the tower is up. It decides — from the
 * reclamation field at that plot, not from a fresh coin toss — whether the street face gets
 * a blank ground-floor module (`groundFloor.ts`), then consumes the anchors that module hands
 * back: paint on its blank rectangles, vines off its lip, weeds and shrubs along its foot,
 * a utility box where it asked for one. On buildings that keep their shopfronts it does the
 * cheap half only: some paint low on the plinth, weeds in the joint, growth on the roof edge.
 *
 * Every random draw here comes from a seed made of the plot's own position, so a building
 * carries the same tags and the same weeds on every machine and in every session.
 */

/** How much of the reclamation a building shows. */
export const BUILDING_RECLAIM = {
  /** A face this short is not worth dressing at all. */
  minFaceWidth: 4,
  /** Weed tufts per metre along the foot of a dressed wall, at full intensity. */
  weedsPerMetre: 0.38,
  /** Chance a roof edge or unused terrace has something growing on it, at full intensity. */
  roofChance: 0.55,
  /** How tall a building may be before its roof is too far up to bother planting. */
  roofMaxHeight: 34,
  /** Chance a face with no module still takes a tag low down on it. */
  bareFaceGraffiti: 0.8,
  /** Facade creeper: how many curtains a fully reclaimed wall carries, and how far they fall. */
  creeperMax: 2,
  creeperDropMin: 2,
  creeperDropMax: 7,
  /** Highest a creeper starts (m). Above this it would be lost against the skyline. */
  creeperTop: 16,
  /**
   * A creeper hangs this far off the wall at most, which is inside the pavement the block
   * already owns and far above anything that drives on it. Nothing here has a collider.
   */
  creeperOut: 0.25,
} as const;

/**
 * The thing that actually reads from the driving seat: a curtain of creeper down a facade.
 *
 * A plant on a kerb is a few pixels at 80 km/h; six metres of ivy pouring down a wall is the
 * whole side of the street. This is what carries the reclaimed look in the concept art, and
 * it is also the cheapest growth in the kit — flat ribbons on a surface that already exists,
 * eight triangles a strand.
 *
 * All of it hugs the wall and starts above head height, so it can never reach the road, and
 * it stays clear of the ground floor where the lit shopfronts and signs are.
 */
function facadeCreepers(
  b: EnvBuilders,
  x: number,
  z: number,
  y: number,
  nx: number,
  nz: number,
  tx: number,
  tz: number,
  width: number,
  top: number,
  profile: ReclaimProfile,
  rng: () => number,
): void {
  if (profile.vines <= 0.03 || top < 8) return;
  const n = Math.round(BUILDING_RECLAIM.creeperMax * profile.vines * (0.5 + rng()));
  for (let i = 0; i < n; i++) {
    const w = Math.min(width * 0.55, 1.6 + rng() * 4.5);
    const across = (rng() - 0.5) * Math.max(0, width - w - 0.8);
    // Starts somewhere up the wall, never in the lit ground floor and never at the roofline.
    const hi = Math.min(BUILDING_RECLAIM.creeperTop, top - 1.5);
    if (hi < 5) return;
    const at = 5 + rng() * (hi - 5);
    const drop = Math.min(at - 3.4, BUILDING_RECLAIM.creeperDropMin + rng() * (BUILDING_RECLAIM.creeperDropMax - BUILDING_RECLAIM.creeperDropMin));
    if (drop < 1) continue;
    vine(
      b,
      x + tx * across + nx * BUILDING_RECLAIM.creeperOut,
      y + at,
      z + tz * across + nz * BUILDING_RECLAIM.creeperOut,
      nx, nz, tx, tz, w, drop, rng,
      { dry: 0.12 + (1 - profile.intensity) * 0.25 },
    );
    // Half of them are climbing from below as well as hanging from above, which is what makes
    // a wall read as taken rather than decorated.
    if (rng() < 0.45) {
      const climb = Math.min(at - 3.6, 1.5 + rng() * 3.5);
      if (climb > 0.8) {
        vine(
          b,
          x + tx * across + nx * BUILDING_RECLAIM.creeperOut,
          y + at - drop,
          z + tz * across + nz * BUILDING_RECLAIM.creeperOut,
          nx, nz, tx, tz, w * 0.8, -climb, rng,
          { dry: 0.15 },
        );
      }
    }
  }
}

/**
 * Turn the anchors a ground module produced into paint, plants and clutter. Split out so the
 * viaduct and quay passes can feed the same consumer with their own anchors.
 */
export function consumeAnchors(
  b: EnvBuilders,
  anchors: ReclaimAnchors,
  profile: ReclaimProfile,
  seed: number,
  rng: () => number,
): void {
  for (const [i, s] of anchors.graffiti.entries()) {
    paintSurface(b, s, profile, (seed ^ (0x51ed * (i + 1))) >>> 0);
    // Dirt on about half of what gets painted, and on plenty that does not: streaks under a
    // coping, a stain low on the wall, a crack network where the concrete has gone.
    if (rng() < 0.55) {
      const r = rng();
      grimeSurface(b, s, profile, (seed ^ (0x9e37 * (i + 3))) >>> 0, r < 0.45 ? 'streak' : r < 0.78 ? 'stain' : 'crack');
    }
  }
  for (const v of anchors.vines) {
    if (rng() > profile.vines) continue;
    vine(b, v.x, v.y, v.z, v.nx, v.nz, v.tx, v.tz, v.width * (0.4 + rng() * 0.6), v.drop * (0.5 + rng() * 0.6), rng, {
      dry: 0.1 + (1 - profile.intensity) * 0.3,
    });
  }
  for (const g of anchors.ground) {
    // The joint between a wall and the pavement, where the water sits: weeds first.
    const count = Math.max(1, Math.round(g.width * BUILDING_RECLAIM.weedsPerMetre * profile.weeds));
    const y = g.y + 0.01;
    const ox = g.nx * (g.depth * 0.45);
    const oz = g.nz * (g.depth * 0.45);
    weedLine(
      b,
      g.x - g.tx * (g.width / 2) + ox, g.z - g.tz * (g.width / 2) + oz,
      g.x + g.tx * (g.width / 2) + ox, g.z + g.tz * (g.width / 2) + oz,
      y, count, rng,
      { scale: 0.7 + rng() * 0.8, dry: 0.3 + (1 - profile.intensity) * 0.4 },
    );
    // And then, only where a pocket is real, something with a stem in it.
    if (rng() < profile.vegetation) {
      const a = (rng() - 0.5) * g.width * 0.8;
      const px = g.x + g.tx * a + g.nx * g.depth * 0.5;
      const pz = g.z + g.tz * a + g.nz * g.depth * 0.5;
      const r = rng();
      const o = { room: g.depth + 0.6, outX: g.nx, outZ: g.nz, dry: 0.15 + (1 - profile.intensity) * 0.3 };
      if (r < 0.42) shrub(b, px, y, pz, rng, { ...o, scale: 0.8 + rng() * 0.7 });
      else if (r < 0.72) fern(b, px, y, pz, rng, { ...o, scale: 0.8 + rng() * 0.7 });
      else if (r < 0.9) sapling(b, px, y, pz, rng, { ...o, scale: 0.8 + rng() * 0.8 });
      else if (profile.bigTree) crookedTree(b, px, y, pz, rng, { ...o, scale: 0.65 + rng() * 0.4 });
    }
  }
  for (const p of anchors.props) {
    if (rng() > 0.5) continue;
    // A utility cabinet, a bin, a stack of pallets: the stuff that ends up against a blank
    // wall. Kept low and inside the pavement, on the same collider the building stands on.
    const h = 0.7 + rng() * 0.7;
    const w = 0.6 + rng() * 0.6;
    b.props.color(rng() < 0.5 ? PAL.metalDark : PAL.rust, 0.8 + rng() * 0.5);
    b.props.orientedBox(p.x + p.nx * (0.35 + w / 2), p.z + p.nz * (0.35 + w / 2), p.tx, p.tz, w * 1.4, w, p.y, p.y + h);
    if (rng() < 0.5) weeds(b, p.x + p.nx * (0.4 + w), p.y, p.z + p.nz * (0.4 + w), rng, { scale: 0.9 + rng() * 0.6, dry: 0.4 });
  }
}

/**
 * Dress one street face of a building. `pavement` is the clear ground in front of the wall,
 * `top` the height of the building above it.
 */
function dressFace(
  b: EnvBuilders,
  x: number,
  z: number,
  y: number,
  nx: number,
  nz: number,
  width: number,
  pavement: number,
  top: number,
  zone: ZoneId,
  profile: ReclaimProfile,
): void {
  if (width < BUILDING_RECLAIM.minFaceWidth) return;
  const seed = seedAt(x, z, 0x21);
  const rng = makeRng(seed);
  const tx = -nz;
  const tz = nx;
  const face: GroundFace = { x, y, z, nx, nz, tx, tz, width, pavement, maxHeight: top - y, zone };
  // The creeper goes on whatever the ground floor turns out to be: it lives above it.
  facadeCreepers(b, x, z, y, nx, nz, tx, tz, width, top - y, profile, rng);
  const kind = pickGroundModule(profile, zone, rng);
  if (kind) {
    consumeAnchors(b, buildGroundModule(b, face, kind, profile, rng), profile, seed, rng);
    return;
  }
  // No module: the shopfront stays. It still picks up what a working street picks up — a tag
  // on the plinth where nothing is lit, weeds in the joint, and a streak of damp.
  if (profile.graffiti > 0.05 && rng() < BUILDING_RECLAIM.bareFaceGraffiti) {
    const surface = {
      x, y: y + 0.15, z, nx, nz, tx, tz,
      width: width - 0.6,
      // The bottom three metres: reach height, below the first floor's windows and below
      // every lit band, sign and awning the facade builder hangs on this wall.
      height: 2.8,
      out: 0.12,
    };
    paintSurface(b, surface, profile, (seed ^ 0x3311) >>> 0);
    grimeSurface(b, { ...surface, height: 4 }, profile, (seed ^ 0x77aa) >>> 0, 'streak');
    // A given-up block has something big and badly placed up the blank part of a wall, well
    // above where anyone should be able to reach. Only where the place is really gone.
    if (profile.level >= 3 && top - y > 12 && rng() < 0.4) {
      paintSurface(
        b,
        { x, y: y + 4.5, z, nx, nz, tx, tz, width: width - 1.2, height: 4.5, out: 0.12 },
        profile,
        (seed ^ 0x1d5b) >>> 0,
      );
    }
  }
  if (profile.weeds > 0.08) {
    const count = Math.max(1, Math.round(width * BUILDING_RECLAIM.weedsPerMetre * profile.weeds * 0.7));
    weedLine(
      b,
      x - tx * (width / 2 - 0.4) + nx * 0.28, z - tz * (width / 2 - 0.4) + nz * 0.28,
      x + tx * (width / 2 - 0.4) + nx * 0.28, z + tz * (width / 2 - 0.4) + nz * 0.28,
      y + 0.01, count, rng,
      { scale: 0.6 + rng() * 0.6, dry: 0.35 + (1 - profile.intensity) * 0.4 },
    );
  }
}

/**
 * Everything reclamation adds to one building: the ground-floor face, and whatever has
 * seeded itself on the roof.
 *
 * `base` is the footprint of the volume standing on the ground, which is not always the whole
 * plot — a slab or an offset stack sits inside it — so a module is fixed to the wall that is
 * actually there, and the extra ground the volume leaves in front of it counts as pavement.
 * `street` is the kit's own [+x, -x, +z, -z] flags and `pave` the pavement each axis has
 * outside the plot, so nothing ever reaches past the kerb the block already owns.
 */
export function dressBuilding(
  b: EnvBuilders,
  base: Rect2,
  plot: Rect2,
  baseY: number,
  crown: Rect2,
  top: number,
  zone: ZoneId,
  street: [boolean, boolean, boolean, boolean],
  pave: { x: number; z: number },
  dark: boolean,
): void {
  const cx = (plot.minX + plot.maxX) / 2;
  const cz = (plot.minZ + plot.maxZ) / 2;
  const profile = b.reclaim.at(cx, cz);
  const bw = base.maxX - base.minX;
  const bd = base.maxZ - base.minZ;
  const bcx = (base.minX + base.maxX) / 2;
  const bcz = (base.minZ + base.maxZ) / 2;
  // A wall only counts as a street face when it is on the plot edge the kit called a street;
  // a volume set well back inside its plot is a courtyard wall and gets nothing.
  const gapPx = plot.maxX - base.maxX;
  const gapMx = base.minX - plot.minX;
  const gapPz = plot.maxZ - base.maxZ;
  const gapMz = base.minZ - plot.minZ;
  const FLUSH = 1.2;
  if (street[0] && gapPx < FLUSH) dressFace(b, base.maxX, bcz, baseY, 1, 0, bd, pave.x + gapPx, top, zone, profile);
  if (street[1] && gapMx < FLUSH) dressFace(b, base.minX, bcz, baseY, -1, 0, bd, pave.x + gapMx, top, zone, profile);
  if (street[2] && gapPz < FLUSH) dressFace(b, bcx, base.maxZ, baseY, 0, 1, bw, pave.z + gapPz, top, zone, profile);
  if (street[3] && gapMz < FLUSH) dressFace(b, bcx, base.minZ, baseY, 0, -1, bw, pave.z + gapMz, top, zone, profile);

  // The roof: a low roof in a pocket collects a drift of soil in one corner and grows out of
  // it. Only low ones — nothing seeds itself forty metres up, and nothing there would be seen.
  const height = top - baseY;
  if (height > BUILDING_RECLAIM.roofMaxHeight || height < 4 || dark) return;
  const rw = crown.maxX - crown.minX;
  const rd = crown.maxZ - crown.minZ;
  if (rw < 4 || rd < 4) return;
  const rcx = (crown.minX + crown.maxX) / 2;
  const rcz = (crown.minZ + crown.maxZ) / 2;
  const rng = makeRng(seedAt(rcx, rcz, 0x5a));
  if (rng() > BUILDING_RECLAIM.roofChance * profile.vegetation) return;
  // Along one edge, chosen once, so the growth is a drift in a corner and not a border.
  const along = rng() < 0.5;
  const side = rng() < 0.5 ? -1 : 1;
  const len = Math.min((along ? rw : rd) - 1.5, 3 + rng() * 7);
  if (len < 2) return;
  const t0 = (rng() - 0.5) * ((along ? rw : rd) - len - 1.4);
  const inset = 0.9;
  const ex = along ? rcx + t0 : side > 0 ? crown.maxX - inset : crown.minX + inset;
  const ez = along ? (side > 0 ? crown.maxZ - inset : crown.minZ + inset) : rcz + t0;
  const dx = along ? 1 : 0;
  const dz = along ? 0 : 1;
  weedLine(b, ex - (dx * len) / 2, ez - (dz * len) / 2, ex + (dx * len) / 2, ez + (dz * len) / 2, top + 0.02, Math.round(len * 0.9), rng, {
    scale: 0.8 + rng() * 0.7,
    dry: 0.45,
  });
  const n = 1 + Math.floor(rng() * 2);
  for (let i = 0; i < n; i++) {
    const t = (rng() - 0.5) * len;
    const px = ex + dx * t;
    const pz = ez + dz * t;
    if (rng() < 0.55) shrub(b, px, top + 0.02, pz, rng, { scale: 0.9 + rng() * 0.6, dry: 0.3 });
    else if (profile.bigTree && height > 10 && rng() < 0.4) canopyTree(b, px, top + 0.02, pz, rng, { scale: 0.55 + rng() * 0.3, room: 2.6, dry: 0.2 });
    else sapling(b, px, top + 0.02, pz, rng, { scale: 1 + rng() * 0.8, dry: 0.25 });
  }
  // Something hanging over the parapet, which is what makes a reclaimed roof read from below.
  if (rng() < profile.vines) {
    const nx = along ? 0 : side;
    const nz = along ? side : 0;
    vine(b, ex + nx * 0.6, top - 0.15, ez + nz * 0.6, nx, nz, dx, dz, len * 0.7, 1.4 + rng() * 2.6, rng, { dry: 0.2 });
  }
}
