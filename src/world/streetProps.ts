import type { ObstacleBox, ObstacleWall, SewerVentDef, StreetPropDef, StreetPropKind } from '../core/types';
import { SEWER_STEAM, STREET_PROPS } from '../config/tuning';
import type { World } from './arenaWorld';
import { inRect, planLots, type BlockRect, type Rect, type RibbonDef, type ZoneId } from './cityPlan';
import { hash01, onRibbonAtLevel, pathBox } from './cityGen';
import { createRectIndex } from './spatialIndex';
import { createProjection, offsetAtStation, pointAtStation, projectOntoPath } from './track';

/**
 * CRASHABLE STREET PROPS, as a LAYER over a city — the same one-way dependency as
 * `cityStreetSites.ts`: the city does not know its pavements carry anything.
 *
 * The city has no shop or entrance metadata on the simulation side (the ground floors are
 * decided by the renderer), so the anchors are derived here from what the world does know:
 *
 *  - every ground street's measured pavement (`plan.kerbs`), walked in stations on both sides.
 *    The pavement between the kerb and the block's face is flush and drivable — which is
 *    exactly where a car clipping a kerb goes, and nowhere near a lane,
 *  - the zone and massing of the block behind the station, and whether a viaduct is overhead,
 *    pick the arrangement: a shop entrance, a food frontage, a maintenance spot or a pair of EV
 *    chargers. A station that fits none of them stays empty, and most do,
 *  - every prop is then checked on its own against the streets (all levels), every collider the
 *    simulation has (buildings, pillars, shelters, the meets), every other prop, the height of
 *    the ground, and a clear radius round spawns and activity markers. An arrangement whose key
 *    piece fails is dropped whole rather than forced.
 *
 * Deterministic: `hash01` of positions, like the rest of the generator, so every client and
 * every run gets the same street.
 */

export interface StreetPropShape {
  /** Half extents of the prop's box (m), in its own frame: x across, y up, z front-to-back. */
  hx: number;
  hy: number;
  hz: number;
  /** Radius of the circle the car meets (m). */
  radius: number;
  /** How many looks the renderer has for it. */
  variants: number;
  /** The car meets it at all. Litter is drawn and rolled over, nothing more. */
  solid: boolean;
  /** Never moves: answered like a wall (`pushOutOfPost`), not kicked. */
  fixed: boolean;
}

/**
 * The props' sizes as the art is modelled (m). `STREET_PROP_SCALE` grows a kind as a whole;
 * placement and the rules read the scaled `STREET_PROP_SHAPES`, the art builds at this size and is scaled.
 */
export const STREET_PROP_BASE: Record<StreetPropKind, StreetPropShape> = {
  bag: { hx: 0.3, hy: 0.27, hz: 0.27, radius: 0.36, variants: 3, solid: true, fixed: false },
  box: { hx: 0.32, hy: 0.25, hz: 0.26, radius: 0.36, variants: 3, solid: true, fixed: false },
  cone: { hx: 0.2, hy: 0.36, hz: 0.2, radius: 0.3, variants: 1, solid: true, fixed: false },
  barrier: { hx: 0.62, hy: 0.5, hz: 0.22, radius: 0.58, variants: 2, solid: true, fixed: false },
  sign: { hx: 0.32, hy: 0.52, hz: 0.28, radius: 0.42, variants: 2, solid: true, fixed: false },
  chair: { hx: 0.24, hy: 0.42, hz: 0.24, radius: 0.32, variants: 3, solid: true, fixed: false },
  table: { hx: 0.42, hy: 0.37, hz: 0.42, radius: 0.5, variants: 2, solid: true, fixed: false },
  charger: { hx: 0.3, hy: 0.82, hz: 0.24, radius: 0.42, variants: 1, solid: true, fixed: true },
  // A galvanised can with its lid, and a green wheelie bin.
  bin: { hx: 0.29, hy: 0.46, hz: 0.29, radius: 0.34, variants: 2, solid: true, fixed: false },
  // Long side along local X. It answers the car as two posts along that side (`DUMPSTER_POSTS`).
  dumpster: { hx: 0.95, hy: 0.62, hz: 0.55, radius: 0.95, variants: 2, solid: true, fixed: true },
  litter: { hx: 0.35, hy: 0.02, hz: 0.3, radius: 0.22, variants: 3, solid: false, fixed: false },
};

/** Uniform size multiplier per kind: street junk reads bigger from a car at speed. */
export const STREET_PROP_SCALE: Record<StreetPropKind, number> = {
  bag: 1.25,
  box: 1.5,
  cone: 1,
  barrier: 1,
  sign: 1,
  chair: 1,
  table: 1,
  charger: 1,
  bin: 1.2,
  dumpster: 1,
  litter: 1.3,
};

/** The one place the props' sizes are read from: placement, the rules and the art all use it. */
export const STREET_PROP_SHAPES = Object.fromEntries(
  (Object.keys(STREET_PROP_BASE) as StreetPropKind[]).map((k) => {
    const b = STREET_PROP_BASE[k];
    const f = STREET_PROP_SCALE[k];
    return [k, { ...b, hx: b.hx * f, hy: b.hy * f, hz: b.hz * f, radius: b.radius * f }];
  }),
) as Record<StreetPropKind, StreetPropShape>;

/** A dumpster meets the car as two round posts this far either side of its centre (m), each of this radius. */
export const DUMPSTER_POSTS = { offset: 0.42, radius: 0.56 };

/** A flattened box's half height as modelled, and once a hard hit has squashed it (scaled). */
export const FLAT_BOX_BASE_HY = 0.07;
export const FLAT_BOX_HY = FLAT_BOX_BASE_HY * STREET_PROP_SCALE.box;

const P = {
  /** Metres between the stations tried along a street. */
  step: 11,
  /** Least pavement for any arrangement, and for the ones with furniture or chargers (m). */
  minPavement: 2.3,
  widePavement: 3.1,
  /** Always left clear between the props and the kerb (m): the walking line. */
  passage: 1.1,
  /** Nothing within this of another street's edge: junction corners stay clear (m). */
  junctionClear: 6,
  /** Least distance between two arrangements (m). */
  spacing: 26,
  /** Clear radius round the player's spawn and the activity markers (m). */
  spawnClear: 30,
  markerClear: 18,
  /** Base chance a station gets anything at all, before `STREET_PROPS.density`. */
  chance: 0.2,
  /**
   * Kerbside trash, where there is no pavement (downtown, under the deck): the least strip
   * between the road's edge and the wall (m), how far out to look for that wall, and how much of
   * the asphalt's edge a bag or a bin may stand on. Traffic's outer lane keeps clear of it.
   */
  kerbsideMinGap: 0.4,
  kerbsideReach: 4.5,
  gutter: 0.55,
} as const;

type Arrangement = 'shop' | 'food' | 'maintenance' | 'parking' | 'trash' | 'dumpster';

interface Piece {
  kind: StreetPropKind;
  variant: number;
  /** Along the wall (m) from the anchor, and out from the wall toward the road (m). */
  along: number;
  out: number;
  /** Extra yaw on top of facing the road (rad). */
  turn: number;
  /** The arrangement is dropped if this one does not fit. */
  key: boolean;
}

/** Put the props on a world's layout. Called for the open world. */
export function addStreetProps(world: World): World {
  world.layout.sewerVents = placeSewerVents(world);
  world.layout.streetProps = placeStreetProps(world);
  return world;
}

/** Keep the arrangements a quality preset can afford (`StreetPropDef.rank`). */
export function thinStreetProps(props: readonly StreetPropDef[], share: number): StreetPropDef[] {
  return share >= 1 ? props.slice() : props.filter((p) => p.rank < share);
}

export function placeStreetProps(world: World): StreetPropDef[] {
  const { plan, layout } = world;
  const kerbs = plan.kerbs;
  if (!kerbs) return [];
  const ground = plan.ribbons.filter((rb) => !rb.elevated);
  const elevated = plan.ribbons.filter((rb) => rb.elevated);
  const density = STREET_PROPS.density;
  if (density <= 0) return [];

  // Everything solid at street level, bucketed: buildings, pillars, shelters, meet cars.
  const boxes = layout.colliders.filter((b) => (b.minY === undefined || b.minY < 0.5) && (b.maxY === undefined || b.maxY > 0.3));
  const boxIndex = createRectIndex<ObstacleBox>(boxes, 32, 2);
  const walls = layout.walls.filter((w) => w.tag !== 'bus' && (w.minY === undefined || w.minY < 0.5) && (w.maxY === undefined || w.maxY > 0.3));
  const wallRects = walls.map((w) => ({ minX: Math.min(w.ax, w.bx), maxX: Math.max(w.ax, w.bx), minZ: Math.min(w.az, w.bz), maxZ: Math.max(w.az, w.bz), w }));
  const wallIndex = createRectIndex(wallRects, 32, 2);
  const blockIndex = createRectIndex<BlockRect>(plan.blocks, 32, 2);
  const lots: Rect[] = planLots(plan);
  const downtownRect = plan.downtown ?? null;
  const megas: Rect[] = (plan.megastructures ?? []).map((m) => m.footprint);

  const markers: Array<{ x: number; z: number; r: number }> = [];
  markers.push({ x: layout.playerSpawn.x, z: layout.playerSpawn.z, r: P.spawnClear });
  for (const s of layout.rushSites ?? []) markers.push({ x: s.x, z: s.z, r: P.markerClear });
  for (const s of layout.passengerStops ?? []) markers.push({ x: s.x, z: s.z, r: P.markerClear });
  for (const s of layout.streetSites ?? []) markers.push({ x: s.x, z: s.z, r: P.markerClear + 6 });
  if (layout.circuitSite) markers.push({ x: layout.circuitSite.x, z: layout.circuitSite.z, r: P.markerClear + 10 });
  if (layout.buhoSite) markers.push({ x: layout.buhoSite.x, z: layout.buhoSite.z, r: P.markerClear });
  if (layout.garageSite) markers.push({ x: layout.garageSite.x, z: layout.garageSite.z, r: P.markerClear });
  for (const st of plan.busStops ?? []) markers.push({ x: st.x, z: st.z, r: 12 });
  // A trapito's patch and a washer's corner, with his light on it: nothing to trip over while he works.
  for (const h of layout.hustlerSpots ?? []) {
    markers.push({ x: h.x, z: h.z, r: 7 });
    // A sock seller's whole walk, end to end: he would stroll straight through a bin left on it.
    const b = h.beat;
    if (!b) continue;
    const steps = Math.ceil(Math.hypot(b.to.x - b.from.x, b.to.z - b.from.z) / 5);
    for (let k = 0; k <= steps; k++) markers.push({ x: b.from.x + ((b.to.x - b.from.x) * k) / steps, z: b.from.z + ((b.to.z - b.from.z) * k) / steps, r: 4 });
  }
  // Where a micro-scene may stand (`src/world/microSceneAnchors.ts`): a folding table of parts or
  // a car with its bonnet up needs the pavement it was measured for, not a dumpster in the middle
  // of it. The anchors are laid before this pass for exactly that reason.
  for (const a of layout.microSceneAnchors ?? []) markers.push({ x: a.transform.x, z: a.transform.z, r: 6 });

  const placed: StreetPropDef[] = [];
  const propCells = new Map<number, number[]>();
  const cellKey = (x: number, z: number): number => (Math.floor(x / 4) + 4096) * 8192 + (Math.floor(z / 4) + 4096);
  const surf = { y: 0, gx: 0, gz: 0 };
  const proj = createProjection();
  // The grates, filed in the props' own 4 m cells and the eight round each, for `fits`.
  const ventCells = new Map<number, SewerVentDef[]>();
  for (const v of layout.sewerVents ?? []) {
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        const k = cellKey(v.x + di * 4, v.z + dj * 4);
        const list = ventCells.get(k);
        if (list) list.push(v);
        else ventCells.set(k, [v]);
      }
    }
  }

  /** The ground's own height: the streets are draped over the terrain, and so is everything here. */
  const groundY = (x: number, z: number): number => (layout.groundY ? layout.groundY(x, z) : 0);

  const onAnyRoad = (x: number, z: number, pad: number, except: RibbonDef | null): boolean => {
    const y = groundY(x, z);
    for (const rb of plan.ribbons) {
      if (rb === except) continue;
      // A deck overhead is not in the way; its ramp coming down to the ground is.
      if (onRibbonAtLevel(rb, x, z, y, pad)) return true;
    }
    return false;
  };

  const fits = (kind: StreetPropKind, x: number, z: number, own: RibbonDef, kerbside = false): boolean => {
    const r = STREET_PROP_SHAPES[kind].radius;
    if (kerbside) {
      // Nothing solid past the gutter, and nothing at all on any other street.
      if (kind === 'dumpster') return false;
      if (onRibbonAtLevel(own, x, z, groundY(x, z), (STREET_PROP_SHAPES[kind].solid ? r : 0) - P.gutter)) return false;
      if (onAnyRoad(x, z, r + 0.25, own)) return false;
    } else if (onAnyRoad(x, z, r + 0.25, null)) return false;
    // Another street's edge nearby: a junction mouth or a corner.
    if (onAnyRoad(x, z, P.junctionClear, own)) return false;
    for (const b of boxIndex.at(x, z)) if (inRect(b, x, z, r + 0.15)) return false;
    for (const wr of wallIndex.at(x, z)) if (wallDistance(wr.w, x, z) < r + 0.3) return false;
    for (const l of lots) if (inRect(l, x, z, 8)) return false;
    // Kerbside the strip already stops at the megastructure's face (`gapToWall`).
    for (const m of megas) if (inRect(m, x, z, kerbside ? r * 0.5 : 1)) return false;
    for (const m of markers) if (Math.hypot(x - m.x, z - m.z) < m.r) return false;
    // Kerbside trash stays off the grates, so no column of steam rises through a bin.
    for (const v of ventCells.get(cellKey(x, z)) ?? []) if (Math.hypot(x - v.x, z - v.z) < SEWER_STEAM.grateLength / 2 + r + 0.3) return false;
    if (layout.surface) {
      const gy = groundY(x, z);
      layout.surface.sample(x, z, gy, surf);
      if (surf.y > gy + 0.05) return false;
    }
    const cx = Math.floor(x / 4);
    const cz = Math.floor(z / 4);
    for (let i = cx - 1; i <= cx + 1; i++) {
      for (let j = cz - 1; j <= cz + 1; j++) {
        const list = propCells.get((i + 4096) * 8192 + (j + 4096));
        if (!list) continue;
        for (const k of list) {
          const o = placed[k];
          if (Math.hypot(o.x - x, o.z - z) < r + STREET_PROP_SHAPES[o.kind].radius + 0.12) return false;
        }
      }
    }
    return true;
  };

  const overDeck = (x: number, z: number): boolean => {
    for (const e of elevated) {
      const box = pathBox(e.path);
      if (x < box.minX - 4 || x > box.maxX + 4 || z < box.minZ - 4 || z > box.maxZ + 4) continue;
      projectOntoPath(e.path, x, z, proj);
      if (proj.dist < proj.halfWidth + 1 && proj.y > 4.5) return true;
    }
    return false;
  };

  /** Metres from a road edge out along (nx, nz) to the first wall, or 0 when there is none within reach. */
  const gapToWall = (x: number, z: number, nx: number, nz: number): number => {
    for (let d = 0.25; d <= P.kerbsideReach; d += 0.25) {
      const px = x + nx * d;
      const pz = z + nz * d;
      for (const b of boxIndex.at(px, pz)) if (inRect(b, px, pz)) return d - 0.25;
      for (const m of megas) if (inRect(m, px, pz)) return d - 0.25;
      for (const wr of wallIndex.at(px, pz)) if (wallDistance(wr.w, px, pz) < 0.3) return d - 0.25;
    }
    return 0;
  };

  const blockBehind = (x: number, z: number): BlockRect | null => {
    for (const b of blockIndex.at(x, z)) if (inRect(b, x, z)) return b;
    return null;
  };

  for (const rb of ground) {
    const path = rb.path;
    for (const side of [-1, 1]) {
      let last = -Infinity;
      for (let s = P.step; s < path.length - P.step; s += P.step) {
        if (s - last < P.spacing) continue;
        const at = pointAtStation(path, s, proj);
        const index = at.index;
        const tt = at.t;
        const c = offsetAtStation(path, s, 0);
        const nx = -c.tz * side;
        const nz = c.tx * side;
        const edgeX = c.x + nx * c.halfWidth;
        const edgeZ = c.z + nz * c.halfWidth;
        let width = kerbs.paved(rb, index, side) ? kerbs.widthAt(rb, index, side, tt) : 0;
        // Paved a little either side too, or this is the lip of a junction.
        const paved = width >= P.minPavement && kerbs.paved(rb, pointAtStation(path, s - 5, proj).index, side) && kerbs.paved(rb, pointAtStation(path, s + 5, proj).index, side);
        const downtown = downtownRect !== null && inRect(downtownRect, edgeX, edgeZ);
        const underDeck = overDeck(edgeX, edgeZ);
        // KERBSIDE: downtown's buildings stand at the road with no pavement, so the trash goes out
        // in the strip before the wall and the edge of the gutter, the way it does on collection night.
        let kerbside = false;
        if (!paved) {
          if (!downtown && !underDeck) continue;
          const gap = gapToWall(edgeX, edgeZ, nx, nz);
          if (gap < P.kerbsideMinGap) continue;
          width = gap + P.gutter;
          kerbside = true;
        }

        const wallOff = c.halfWidth + width - (kerbside ? P.gutter : 0);
        const wx = c.x + nx * wallOff;
        const wz = c.z + nz * wallOff;
        const roll = hash01(wx * 0.731 + side, wz * 1.117);
        // Downtown, the old town and the viaduct's shade are busier: that is where the trash piles up.
        const boost = STREET_PROPS.trashBoost;
        const busy = Math.max(downtown ? boost.downtown : 1, c.zone === 'urban' ? boost.urban : 1, underDeck ? boost.underDeck : 1);
        if (roll > P.chance * density * busy) continue;

        const kind = kerbside
          ? 'trash'
          : pickArrangement(c.zone as ZoneId, blockBehind(wx + nx * 0.8, wz + nz * 0.8), underDeck, downtown, width, hash01(wx * 3.1, wz * 2.7 + side));
        if (!kind) continue;
        // Room from the wall out to where the walking line starts; kerbside, to the gutter's edge.
        const depth = kerbside ? width : width - P.passage;
        const pieces = arrangementPieces(kind, depth, hash01(wz * 5.3, wx * 4.9));
        // Facing the road: local +Z along -n.
        const yaw = Math.atan2(-nx, -nz);
        const accepted: StreetPropDef[] = [];
        const rank = hash01(wx * 9.7, wz * 8.3);
        let failed = false;
        for (const p of pieces) {
          const shape = STREET_PROP_SHAPES[p.kind];
          // Never closer to the wall than the building's collider allows.
          const out = Math.min(Math.max(p.out, shape.radius + 0.2), depth - shape.radius * 0.5);
          if (out < shape.radius + 0.2) {
            if (p.key) failed = true;
            if (failed) break;
            continue;
          }
          const x = wx - nx * out + c.tx * p.along;
          const z = wz - nz * out + c.tz * p.along;
          if (!fits(p.kind, x, z, rb, kerbside) || accepted.some((o) => Math.hypot(o.x - x, o.z - z) < shape.radius + STREET_PROP_SHAPES[o.kind].radius + 0.08)) {
            if (p.key) {
              failed = true;
              break;
            }
            continue;
          }
          accepted.push({ kind: p.kind, variant: p.variant, x, z, y: groundY(x, z), yaw: yaw + p.turn, rank });
        }
        if (failed || accepted.length < (kind === 'parking' || kind === 'dumpster' ? 1 : 2)) continue;
        for (const a of accepted) {
          const k = cellKey(a.x, a.z);
          const list = propCells.get(k);
          if (list) list.push(placed.length);
          else propCells.set(k, [placed.length]);
          placed.push(a);
        }
        last = s;
      }
    }
  }
  return placed;
}

/**
 * THE SEWERS: storm grates in the gutter at the kerb, along every ground street, denser and
 * steamier downtown. Flush with the asphalt and art only, so the checks are
 * the painter's, not the driver's: never where another street runs through at the same level
 * (a junction's paint, or a ramp coming down), never on a meet's lot, and clear of the spawn
 * and the activity rings, whose markers own the ground they stand on.
 */
export function placeSewerVents(world: World): SewerVentDef[] {
  const { plan, layout } = world;
  const ground = plan.ribbons.filter((rb) => !rb.elevated);
  const downtownRect = plan.downtown ?? null;
  const lots: Rect[] = planLots(plan);
  const markers: Array<{ x: number; z: number; r: number }> = [{ x: layout.playerSpawn.x, z: layout.playerSpawn.z, r: 14 }];
  for (const s of layout.rushSites ?? []) markers.push({ x: s.x, z: s.z, r: 10 });
  for (const s of layout.passengerStops ?? []) markers.push({ x: s.x, z: s.z, r: 8 });
  for (const s of layout.streetSites ?? []) markers.push({ x: s.x, z: s.z, r: 16 });
  if (layout.circuitSite) markers.push({ x: layout.circuitSite.x, z: layout.circuitSite.z, r: 20 });

  const out: SewerVentDef[] = [];
  const cells = new Map<number, number[]>();
  const cellKey = (x: number, z: number): number => (Math.floor(x / 16) + 4096) * 8192 + (Math.floor(z / 16) + 4096);
  const tooClose = (x: number, z: number): boolean => {
    const ci = Math.floor(x / 16);
    const cj = Math.floor(z / 16);
    for (let i = ci - 2; i <= ci + 2; i++) {
      for (let j = cj - 2; j <= cj + 2; j++) {
        const list = cells.get((i + 4096) * 8192 + (j + 4096));
        if (!list) continue;
        for (const k of list) if (Math.hypot(out[k].x - x, out[k].z - z) < SEWER_STEAM.spacing) return true;
      }
    }
    return false;
  };

  for (const rb of ground) {
    const path = rb.path;
    const lift = rb.lift ?? (rb.kind === 'alley' ? 0.006 : 0);
    for (let s = SEWER_STEAM.step; s < path.length - SEWER_STEAM.step; s += SEWER_STEAM.step) {
      const c = offsetAtStation(path, s, 0);
      const downtown = downtownRect !== null && inRect(downtownRect, c.x, c.z);
      if (hash01(c.x * 1.37 + 0.5, c.z * 0.71) > (downtown ? SEWER_STEAM.chance.downtown : SEWER_STEAM.chance.other)) continue;
      const side = hash01(c.x * 0.53, c.z * 3.3) < 0.5 ? -1 : 1;
      // In the gutter, its long side against the kerb.
      const p = offsetAtStation(path, s, side * (c.halfWidth - SEWER_STEAM.grateWidth / 2 - 0.08));
      if (tooClose(p.x, p.z)) continue;
      if (markers.some((m) => Math.hypot(p.x - m.x, p.z - m.z) < m.r)) continue;
      if (lots.some((l) => inRect(l, p.x, p.z, 2))) continue;
      let crossed = false;
      for (const other of plan.ribbons) {
        if (other !== rb && onRibbonAtLevel(other, p.x, p.z, c.y, 3)) {
          crossed = true;
          break;
        }
      }
      if (crossed) continue;
      const steamRoll = hash01(p.x * 4.7, p.z * 5.9);
      const steamChance = downtown ? SEWER_STEAM.steamChance.downtown : SEWER_STEAM.steamChance.other;
      const steam = steamRoll < steamChance ? 0.55 + 0.45 * hash01(p.z * 7.1, p.x * 6.3) : 0;
      const k = cellKey(p.x, p.z);
      const list = cells.get(k);
      if (list) list.push(out.length);
      else cells.set(k, [out.length]);
      out.push({
        x: p.x,
        y: c.y + lift,
        z: p.z,
        // Local X along the road.
        yaw: Math.atan2(-c.tz, c.tx),
        steam,
        rank: hash01(p.x * 9.1, p.z * 2.3),
      });
    }
  }
  return out;
}

/** Keep the steam a quality preset can afford; the covers all stay. */
export function thinSewerSteam(vents: readonly SewerVentDef[], share: number): SewerVentDef[] {
  return share >= 1 ? vents.slice() : vents.map((v) => (v.steam > 0 && v.rank >= share ? { ...v, steam: 0 } : v));
}

/** Distance (m) from a point to a wall segment on the ground plane. */
function wallDistance(w: ObstacleWall, x: number, z: number): number {
  const ex = w.bx - w.ax;
  const ez = w.bz - w.az;
  const len2 = ex * ex + ez * ez;
  let t = len2 > 0 ? ((x - w.ax) * ex + (z - w.az) * ez) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(x - (w.ax + ex * t), z - (w.az + ez * t));
}

/** Which arrangement a place asks for, or none. `r` is a fresh roll in 0..1. */
function pickArrangement(zone: ZoneId, block: BlockRect | null, underDeck: boolean, downtown: boolean, width: number, r: number): Arrangement | null {
  const wide = width >= P.widePavement;
  // The trash first: half of a downtown or under-deck station, a good share of the old town's.
  const trashShare = underDeck ? 0.5 : downtown ? 0.55 : zone === 'urban' ? 0.35 : zone === 'jdm' ? 0.22 : 0.12;
  if (r < trashShare) return wide && r < trashShare * 0.4 ? 'dumpster' : 'trash';
  r = (r - trashShare) / (1 - trashShare);
  if (underDeck) {
    // Under the viaduct: stalls and works, not shops.
    if (r < 0.45) return wide ? 'food' : 'maintenance';
    if (r < 0.8) return 'maintenance';
    return null;
  }
  const massing = block ? block.massing : 1;
  if (zone === 'corporate') {
    if (r < 0.3 && wide && massing >= 2) return 'parking';
    if (r < 0.55) return 'maintenance';
    if (r < 0.8) return 'shop';
    return null;
  }
  if (zone === 'jdm') {
    if (r < 0.35) return 'shop';
    if (r < 0.6) return wide ? 'food' : 'shop';
    if (r < 0.78) return 'maintenance';
    if (r < 0.88 && wide) return 'parking'; // a workshop's charger
    return null;
  }
  if (r < 0.32) return 'shop';
  if (r < 0.55) return wide ? 'food' : 'shop';
  if (r < 0.72) return 'maintenance';
  if (r < 0.84 && wide && massing >= 2) return 'parking';
  return null;
}

/** The pieces of an arrangement in its own frame. `depth` is the room out from the wall. */
function arrangementPieces(kind: Arrangement, depth: number, seed: number): Piece[] {
  let n = Math.floor(seed * 1e6);
  const rnd = (): number => {
    n = (n * 1103515245 + 12345) & 0x7fffffff;
    return n / 0x7fffffff;
  };
  const out: Piece[] = [];
  const add = (k: StreetPropKind, along: number, o: number, turn: number, key = false): void => {
    out.push({ kind: k, variant: Math.floor(rnd() * STREET_PROP_SHAPES[k].variants), along, out: o, turn, key });
  };
  const jitter = (s: number): number => (rnd() - 0.5) * s;
  switch (kind) {
    case 'shop': {
      // The sign out front of the door, boxes stacked to one side, bags to the other.
      add('sign', jitter(0.6), Math.min(1.3, depth - 0.45), jitter(0.5), true);
      const boxes = 1 + Math.floor(rnd() * 3);
      for (let i = 0; i < boxes; i++) add('box', 1.5 + i * 0.7 + jitter(0.2), 0.4 + jitter(0.15), jitter(0.8));
      const bags = 1 + Math.floor(rnd() * 3);
      for (let i = 0; i < bags; i++) add('bag', -1.6 - i * 0.62 + jitter(0.2), 0.42 + (i % 2) * 0.35, jitter(3));
      break;
    }
    case 'food': {
      // One table, chairs round it, the bin bags a few steps off.
      const o = Math.min(1.25, depth - 0.55);
      add('table', 0, o, jitter(0.4), true);
      add('chair', -0.95, o + jitter(0.2), Math.PI / 2 + jitter(0.5));
      add('chair', 0.95, o + jitter(0.2), -Math.PI / 2 + jitter(0.5));
      if (rnd() < 0.5) add('chair', jitter(0.3), o + 0.95, Math.PI + jitter(0.5));
      if (rnd() < 0.5) add('sign', -2.1, Math.min(1.1, depth - 0.45), jitter(0.4));
      const bags = 1 + Math.floor(rnd() * 2);
      for (let i = 0; i < bags; i++) add('bag', 2.4 + i * 0.62, 0.42, jitter(3));
      break;
    }
    case 'maintenance': {
      // A barrier or two along the pavement, cones on the kerb side of them.
      add('barrier', 0, 0.55, 0, true);
      if (rnd() < 0.5) add('barrier', 1.4 + jitter(0.2), 0.55, jitter(0.3));
      const cones = 2 + Math.floor(rnd() * 3);
      for (let i = 0; i < cones; i++) add('cone', -1.2 + i * 1.1 + jitter(0.3), Math.min(1.45, depth - 0.3) + jitter(0.15), jitter(1));
      break;
    }
    case 'trash': {
      // Bins against the wall, the bags heaped round their feet, a box, and the papers blown
      // out toward the kerb.
      const bins = 1 + Math.floor(rnd() * 3);
      const start = -((bins - 1) * 0.66) / 2;
      for (let i = 0; i < bins; i++) add('bin', start + i * 0.66 + jitter(0.12), 0.4 + jitter(0.1), jitter(2), i === 0);
      const bags = 2 + Math.floor(rnd() * 4);
      for (let i = 0; i < bags; i++) {
        const sideways = i % 2 === 0 ? 1 : -1;
        add('bag', sideways * (bins * 0.33 + 0.62 + Math.floor(i / 2) * 0.72) + jitter(0.12), 0.38 + rnd() * 0.45, jitter(3));
      }
      if (rnd() < 0.6) add('box', -bins * 0.33 - 1.6 + jitter(0.3), 0.4 + jitter(0.1), jitter(1));
      const papers = 2 + Math.floor(rnd() * 3);
      for (let i = 0; i < papers; i++) add('litter', jitter(3.6), 0.9 + rnd() * Math.max(0.2, depth - 0.9), rnd() * Math.PI * 2);
      break;
    }
    case 'dumpster': {
      // Long side to the wall, bags slumped at one end, a can at the other, what missed the lid.
      add('dumpster', jitter(0.4), 0.62, jitter(0.08), true);
      const end = rnd() < 0.5 ? -1 : 1;
      const bags = 1 + Math.floor(rnd() * 3);
      for (let i = 0; i < bags; i++) add('bag', end * (1.45 + i * 0.6) + jitter(0.2), 0.4 + (i % 2) * 0.4, jitter(3));
      if (rnd() < 0.5) add('bin', -end * 1.4, 0.4, jitter(2));
      const papers = 1 + Math.floor(rnd() * 3);
      for (let i = 0; i < papers; i++) add('litter', jitter(3.2), 1.3 + rnd() * Math.max(0.2, depth - 1.3), rnd() * Math.PI * 2);
      break;
    }
    case 'parking': {
      // Backed onto the wall, facing the kerb lane the cars pull into.
      add('charger', -1.6, 0.35, 0, true);
      if (rnd() < 0.6) add('charger', 1.6, 0.35, 0);
      break;
    }
  }
  return out;
}
