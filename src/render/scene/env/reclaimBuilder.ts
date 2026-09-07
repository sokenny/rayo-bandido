import { inBusStop, inRect, type BlockRect, type GateDef, type SkybridgeDef } from '../../../world/cityPlan';
import { isOnPath, segmentCount } from '../../../world/track';
import { PAL } from './palette';
import { makeRng } from './meshBuilder';
import { type EnvBuilders } from './builders';
import { blockSetback } from './cityBuilder';
import { grimeSurface, paintSurface } from './graffiti';
import { canopyTree, crookedTree, deadTree, fern, palm, sapling, shrub, vine, weedLine, weeds } from './plants';
import { seedAt, type GraffitiSurface, type ReclaimField, type ReclaimProfile } from './reclaim';

/**
 * THE RECLAMATION PASS — everything the city grows and everything that has been written on
 * it, outside the buildings themselves (which `buildingReclaim.ts` handles as they are built).
 *
 * The old greenery pass planted a hedge or a palm every seven metres along every block ledge
 * in the city, which is exactly what a parks department does and exactly what this direction
 * is not. This one asks the reclamation field (`reclaim.ts`) at every candidate spot and
 * usually plants nothing at all: whole streets stay bare, and then one corner of one block is
 * a thicket. The asymmetry is the effect.
 *
 * What it dresses, in order:
 *   - block ledges: the pavement, the kerb joint, the abandoned planters
 *   - alley walls and street barriers: the big blank concrete the concept art paints on
 *     (the walls themselves are drawn by `trackBuilder.ts`; this pass only dresses them)
 *   - the perimeter retaining wall: the longest paintable surface in the city
 *   - viaduct columns, fences and deck skirts: paint, damp and vines under the highway
 *   - the quay parapet: the waterfront, where the growth is thickest
 *
 * Everything lands in the shared builders. No new draw calls beyond the one decal material,
 * no new lights, and nothing here is touched again after the city is generated.
 */

export const RECLAIM_SCATTER = {
  /**
   * How often a block's own ledge is sampled for a plant (m). Coarse on purpose: the verge
   * pass in front of it carries the look from the road, and most of what grows back here is
   * seen only through the gap between two buildings. This is where the triangles that would
   * otherwise be spent twice on the same street are saved.
   */
  ledgeStep: 12,
  /** How often the kerb joint at the block edge is sampled for a weed tuft (m). */
  weedStep: 7,
  /** Least clear pavement a plant needs behind the kerb (m). Weeds get in almost anywhere. */
  minRoom: 0.18,
  /** Chance a sampled ledge spot in a full pocket grows something with a stem. */
  ledgeChance: 1,
  /** How often a palm turns up among the trees. Occasional, as asked. */
  palmShare: 0.07,
  /** Chance a plant is a dead one. */
  deadShare: 0.1,
  /** Chance a spot in a pocket is an abandoned planter shell instead of bare pavement. */
  planterChance: 0.15,
  /** How often a wall segment is sampled for graffiti (m of wall per attempt). */
  wallStep: 7,
  /** Chance a viaduct column in a pocket is painted / has something growing at its foot. */
  columnChance: 0.85,
  /**
   * Plants per hit at full intensity. A single plant per sample reads as a planting scheme;
   * a clump of three or four with satellites around it reads as something that seeded itself.
   */
  clumpMax: 1,
  /** How far a clump spreads along the ledge from the spot that seeded it (m). */
  clumpSpread: 2.6,
  /** How often the elevated decks are sampled for something hanging off the fascia (m). */
  deckStep: 26,
  /**
   * The verge: how often the paved shoulder beside a ground-level street is sampled (m).
   *
   * This is the pass that decides whether the city looks reclaimed from the driving seat.
   * A block's own ledge is ten or fifteen metres back behind the shoulder, so what grows
   * there is scenery; what grows on the verge is a metre and a half off the white line and
   * fills the frame. The street lamps already stand on this strip, so it is ground the city
   * has always dressed.
   */
  vergeStep: 6.5,
  /** Least paved shoulder a plant needs, and how far its stem stands off the asphalt (m). */
  vergeMinWidth: 1.6,
  vergeGapMin: 1.2,
  /** Bare asphalt kept between a stem and the white line (m). */
  vergeClear: 0.65,
  /**
   * How much likelier the verge is to grow something than the field alone says. The strip
   * beside the road is the one the player actually sees, so it carries more than its share.
   */
  vergeChance: 1.45,
  /** Length of one section of kerb-side retaining wall (m), and how much pavement it needs. */
  ledgeWallStep: 11,
  ledgeWallPavement: 0.72,
  /** Chance a stretch of ledge inside a real pocket has one. */
  ledgeWallChance: 0.22,
} as const;

/**
 * Nothing may hang lower than this above a road: a bus is about 3.4 m, so a metre on top of
 * it. Everything the overhead passes place is clamped against it.
 */
export const OVERHEAD_CLEAR = 4.6;

export function buildReclamation(b: EnvBuilders): void {
  const field = b.reclaim;
  buildVerges(b, field);
  buildBlockGreenery(b, field);
  buildRailPaint(b, field);
  buildPerimeterPaint(b, field);
  buildViaductReclaim(b, field);
  buildOverhead(b, field);
  if (b.plan.water) buildQuayReclaim(b, field);
}

/* ------------------------------------------------------------------ helpers */

/**
 * True where a car actually drives at ground level.
 *
 * `plan.isRoad` cannot answer this on its own: it is a plan-space (x, z) test over every
 * ribbon, so the ground under the viaduct — fifteen metres under it — comes back as road.
 * That ground is a legitimate place for art (the stalls and junk under the deck already
 * stand there), while the street beside it is not. This is the test everything at ground
 * level goes through before it is planted.
 */
export function onStreet(b: EnvBuilders, x: number, z: number, pad = 0): boolean {
  if (!b.plan.isRoad(x, z, pad)) return false;
  // The arena and the circuit describe their roads as rectangles, all of them at grade.
  for (const r of b.plan.roads) if (inRect(r, x, z, pad)) return true;
  for (const rb of b.plan.ribbons) if (!rb.elevated && isOnPath(rb.path, x, z, pad)) return true;
  return false;
}

/** Somewhere a plant may take root: off the street, or inside a collider the car cannot enter. */
function plantable(b: EnvBuilders, x: number, z: number): boolean {
  return !onStreet(b, x, z, 0.4) || b.plan.isSolid(x, z, 0.1);
}

/**
 * A paintable rectangle on a vertical face running from (ax, az) to (bx, bz). `rise` is how
 * much the run climbs end to end: a barrier on a ramp or a viaduct is built as a sloped box,
 * so its paint has to climb with it or it runs off the top of the concrete at one end and off
 * the bottom at the other. `y0` is the foot of the face at the run's midpoint.
 */
function runSurface(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  y0: number,
  height: number,
  side: number,
  out: number,
  rise = 0,
): GraffitiSurface {
  const dx = bx - ax;
  const dz = bz - az;
  const flat = Math.hypot(dx, dz) || 1;
  const tx = dx / flat;
  const tz = dz / flat;
  return {
    x: (ax + bx) / 2,
    y: y0,
    z: (az + bz) / 2,
    nx: -tz * side,
    nz: tx * side,
    tx,
    tz,
    ty: rise / flat,
    // The face is as long as the sloped run, not as its shadow on the ground.
    width: Math.hypot(flat, rise),
    height,
    out,
  };
}

/**
 * One plant, chosen for the place it stands in. `room` is how much clear space it has before
 * whatever is behind it, which is what keeps a canopy out of a wall.
 */
function scatterPlant(
  b: EnvBuilders,
  x: number,
  y: number,
  z: number,
  outX: number,
  outZ: number,
  room: number,
  profile: ReclaimProfile,
  rng: () => number,
  overhang = 0,
): void {
  const dry = 0.12 + (1 - profile.intensity) * 0.35;
  // `canopyRoom` lets a crown lean out over the kerb, but only once it is clear of a bus
  // (`OVERHANG_CLEAR` inside the kit); below that height everything stays inside `room`.
  const o = overhang > 0 ? { room, outX, outZ, dry, canopyRoom: room + overhang } : { room, outX, outZ, dry };
  const r = rng();
  if (rng() < RECLAIM_SCATTER.deadShare) {
    deadTree(b, x, y, z, rng, { ...o, scale: 0.7 + rng() * 0.7 });
    return;
  }
  // A sliver of pavement takes weeds and nothing else: no stem fits, and a shrub in a 20 cm
  // strip would stand half inside the wall behind it.
  if (room < 0.5) {
    weeds(b, x, y, z, rng, { scale: 0.7 + rng() * 0.8, dry });
    return;
  }
  /**
   * What grows here. Ground cover — shrubs, ferns, saplings — is the default everywhere, and
   * it is also what the whole city can afford: a shrub is twenty triangles and a full canopy
   * tree is nearer two hundred. Trees are rationed by how far gone the place is, so a merely
   * neglected street gets one now and then and a feral one is under them.
   */
  // A trunk needs less room than a crown: the crown is clamped on its own, and above a bus
  // it is allowed out over the road anyway. A metre of verge is enough for a street tree.
  const canTree = profile.bigTree && room > 0.9;
  const bigChance = canTree ? 0.06 + 0.22 * profile.intensity : 0;
  if (r < bigChance * 0.45) canopyTree(b, x, y, z, rng, { ...o, scale: 0.75 + rng() * 0.5 });
  else if (r < bigChance * 0.45 + RECLAIM_SCATTER.palmShare * (canTree ? 1 : 0)) palm(b, x, y, z, rng, { ...o, scale: 0.85 + rng() * 0.4, dry: 0.25 });
  else if (r < bigChance + RECLAIM_SCATTER.palmShare) crookedTree(b, x, y, z, rng, { ...o, scale: 0.8 + rng() * 0.5 });
  else if (r < 0.62) shrub(b, x, y, z, rng, { ...o, scale: 0.9 + rng() * 0.9 });
  else if (r < 0.84) fern(b, x, y, z, rng, { ...o, scale: 0.9 + rng() * 0.8 });
  else sapling(b, x, y, z, rng, { ...o, scale: 0.9 + rng() * 0.9 });
}

/**
 * The shell of a planter nobody empties any more: a cracked concrete box with the soil spilled
 * over one corner and whatever took root in it. A prop, not a collider — it stands on the
 * pavement inside the block, where the greenery has always stood.
 */
function abandonedPlanter(
  b: EnvBuilders,
  x: number,
  y: number,
  z: number,
  along: 'x' | 'z',
  outX: number,
  outZ: number,
  profile: ReclaimProfile,
  rng: () => number,
): void {
  const len = 1.6 + rng() * 1.8;
  const wide = 0.9 + rng() * 0.3;
  const h = 0.45 + rng() * 0.25;
  const dx = along === 'x' ? 1 : 0;
  const dz = along === 'x' ? 0 : 1;
  // Three or four low walls, one of them broken away: a shell, not a box. The side facing
  // the building is left off — nothing sees it, and this shape is common enough that its
  // triangles are worth counting.
  const broken = Math.floor(rng() * 4);
  b.concrete.color(PAL.concrete, 1.05 + rng() * 0.2);
  for (let s = 0; s < 4; s++) {
    if (s === broken) continue;
    const side = s % 2 === 0 ? 1 : -1;
    if (s < 2) b.concrete.orientedBox(x + dz * side * (wide / 2), z + dx * side * (wide / 2), dx, dz, len, 0.12, y, y + h * (s === broken ? 0.45 : 1));
    else b.concrete.orientedBox(x + dx * side * (len / 2), z + dz * side * (len / 2), dz, dx, wide, 0.12, y, y + h * (s === broken ? 0.45 : 1));
  }
  // The soil, standing proud, and what is growing out of it.
  b.concrete.color(PAL.ground, 1.2);
  b.concrete.orientedBox(x, z, dx, dz, len - 0.2, wide - 0.2, y, y + h * 0.8);
  const n = 1 + Math.floor(rng() * 2);
  for (let i = 0; i < n; i++) {
    const t = (rng() - 0.5) * (len - 0.5);
    const px = x + dx * t;
    const pz = z + dz * t;
    const r = rng();
    const o = { room: 1.4, outX, outZ, dry: 0.3 + (1 - profile.intensity) * 0.35 };
    if (r < 0.35) shrub(b, px, y + h * 0.8, pz, rng, { ...o, scale: 0.9 + rng() * 0.6 });
    else if (r < 0.6) fern(b, px, y + h * 0.8, pz, rng, { ...o, scale: 1 + rng() * 0.5 });
    else if (r < 0.85) sapling(b, px, y + h * 0.8, pz, rng, { ...o, scale: 1.1 + rng() * 0.9 });
    else deadTree(b, px, y + h * 0.8, pz, rng, { ...o, scale: 0.6 + rng() * 0.4 });
  }
  weedLine(b, x - dx * len / 2, z - dz * len / 2, x + dx * len / 2, z + dz * len / 2, y + h * 0.8, 3, rng, { scale: 0.8, dry: 0.5 });
  // A tag on the side facing the street: small, quick, and never more than one.
  paintSurface(
    b,
    { x, y, z, nx: outX, nz: outZ, tx: dx, tz: dz, width: len - 0.3, height: h, out: wide / 2 + 0.06 },
    profile,
    seedAt(x, z, 0x9a),
    'far',
  );
}

/* ------------------------------------------------------------------ verges */

/**
 * The paved shoulder beside every ground-level street: the strip between the kerb and the
 * block, which the kerb field (`world/kerbs.ts`) already knows the width of and which the
 * street lamps already stand on.
 *
 * Everything here is placed off the asphalt by at least `vergeClear`, and a canopy is only
 * allowed to lean out over the road once it is clear of a bus (`scatterPlant`'s overhang).
 * Nothing gets a collider — the same bargain the lamp posts on this strip already make.
 */
function buildVerges(b: EnvBuilders, field: ReclaimField): void {
  const kerbs = b.plan.kerbs;
  const shoulders = b.plan.shoulders;
  if (!kerbs && !shoulders) return;
  for (const rb of b.plan.ribbons) {
    if (rb.elevated) continue;
    const samples = rb.path.samples;
    const segs = segmentCount(rb.path);
    // Sample by segment rather than by station: the kerb field is indexed by segment, and
    // that is what says which side of which stretch is actually paved.
    let sinceLast = 0;
    for (let i = 0; i < segs; i++) {
      const a = samples[i];
      const c = samples[(i + 1) % samples.length];
      const len = Math.hypot(c.x - a.x, c.z - a.z);
      sinceLast += len;
      if (sinceLast < RECLAIM_SCATTER.vergeStep) continue;
      sinceLast = 0;
      // A ramp climbing away from the street has no pavement beside it.
      if (a.y > 0.5) continue;
      const nx = -a.tz;
      const nz = a.tx;
      for (const side of [-1, 1] as const) {
        if (kerbs && !kerbs.paved(rb, i, side)) continue;
        const width = kerbs ? kerbs.widthAt(rb, i, side) : (shoulders ? shoulders[a.zone] : 0);
        if (width < RECLAIM_SCATTER.vergeMinWidth) continue;
        const rng = makeRng(seedAt(a.x + nx * side * 10, a.z + nz * side * 10, 0xb1));
        const gap = RECLAIM_SCATTER.vergeGapMin + rng() * Math.max(0, width - RECLAIM_SCATTER.vergeGapMin - 0.5);
        const px = a.x + nx * side * (a.halfWidth + gap);
        const pz = a.z + nz * side * (a.halfWidth + gap);
        const room = gap - RECLAIM_SCATTER.vergeClear;
        if (room < 0.3) continue;
        // Nothing within reach of any street, not just of this one: a verge beside a diagonal
        // avenue can sit a metre from a cross street it is not parallel to, and the clamp
        // below only knows about the road this sample belongs to. The pad is the plant's own
        // reach, so a stem is rejected the moment its leaves could arrive on asphalt.
        if (onStreet(b, px, pz, room + 0.25) || inBusStop(b.plan, px, pz, 1.4)) continue;
        const profile = field.at(px, pz);
        if (profile.level === 0) continue;
        if (rng() > profile.vegetation * RECLAIM_SCATTER.vergeChance) continue;
        // The constrained direction is toward the ROAD: that is the way nothing may grow
        // past `room`, and the way a crown is allowed to lean once it clears a bus.
        scatterPlant(b, px, b.plan.padY(px, pz), pz, -nx * side, -nz * side, room, profile, rng, 3.2);
        // A run of weed along the kerb joint beside it: the cheapest half of the effect and
        // the one that reads at speed. Both ends are checked, not the middle — a three-metre
        // run can have one end across the mouth of a side street the other end is nowhere
        // near — and it keeps clear of the asphalt by the same margin the plant does.
        if (rng() < profile.weeds) {
          const jo = a.halfWidth + RECLAIM_SCATTER.vergeClear + 0.2;
          const jx = a.x + nx * side * jo;
          const jz = a.z + nz * side * jo;
          const e0x = jx - a.tx * 3;
          const e0z = jz - a.tz * 3;
          const e1x = jx + a.tx * 3;
          const e1z = jz + a.tz * 3;
          if (!onStreet(b, e0x, e0z, 0.2) && !onStreet(b, e1x, e1z, 0.2)) {
            weedLine(b, e0x, e0z, e1x, e1z, b.plan.padY(jx, jz) + 0.01, 4, rng, {
              scale: 0.6 + rng() * 0.7,
              dry: 0.35 + (1 - profile.intensity) * 0.35,
              room: 0.35,
            });
          }
        }
      }
    }
  }
}

/* ------------------------------------------------------------------ block ledges */

/**
 * The pavement around every block. Two passes at different steps: a coarse one that
 * occasionally plants something with a stem, and a fine one that runs weeds along the kerb
 * joint. Both are gated on the reclamation field, so most of the city gets neither.
 */
function buildBlockGreenery(b: EnvBuilders, field: ReclaimField): void {
  /**
   * True when this edge of a block actually faces a street. Probed at three distances, the
   * same way `cityBuilder` decides which walls are street facades: the shoulder between a
   * block and the asphalt runs from 2.6 m in the old town to 5 m on the corporate highway,
   * so a single probe at 6 m misses every wide-shouldered block in the city.
   */
  const facesRoad = (x: number, z: number, ox: number, oz: number): boolean =>
    b.plan.isRoad(x + ox * 6, z + oz * 6) || b.plan.isRoad(x + ox * 10, z + oz * 10) || b.plan.isRoad(x + ox * 14, z + oz * 14);
  for (const blk of b.plan.blocks) {
    const setback = blockSetback(blk.maxX - blk.minX, blk.maxZ - blk.minZ);

    /** `outX/outZ` points from the block out at the street; `pave` is the pavement there. */
    const place = (edgeX: number, edgeZ: number, outX: number, outZ: number, pave: number, along: 'x' | 'z'): void => {
      // Halfway out on the ledge, never so close to the kerb that a bumper could clip it.
      const off = Math.min(1.6, Math.max(0.7, pave * 0.5));
      const x = edgeX - outX * off;
      const z = edgeZ - outZ * off;
      if (inBusStop(b.plan, x, z, 1.4) || !plantable(b, x, z)) return;
      const profile = field.at(x, z);
      if (profile.level === 0) return;
      const rng = makeRng(seedAt(x, z, 0x11));
      const y0 = b.plan.padY(x, z);
      /**
       * The clearance that matters is the one toward the STREET: that is the direction a
       * plant must not grow past, because past it is the block's collider edge and then the
       * road. The gap behind, toward the facade, is not a constraint at all — leaves against
       * a wall are what this whole direction is about. `off` is the street-side gap; a
       * margin comes off it so nothing ever reaches the edge itself.
       */
      const room = off - 0.2;
      if (room < RECLAIM_SCATTER.minRoom) return;
      if (rng() < profile.planter * RECLAIM_SCATTER.planterChance && pave - off > 0.8) {
        abandonedPlanter(b, x, y0, z, along, outX, outZ, profile, rng);
        return;
      }
      if (rng() > profile.vegetation * RECLAIM_SCATTER.ledgeChance) return;
      // A clump, not a specimen: one plant with satellites around it, spread unevenly along
      // the ledge and varying in size, so the eye reads a thing that seeded itself.
      const n = 1 + Math.round(RECLAIM_SCATTER.clumpMax * profile.vegetation * rng());
      const tx = along === 'x' ? 1 : 0;
      const tz = along === 'x' ? 0 : 1;
      for (let i = 0; i < n; i++) {
        const t = i === 0 ? 0 : (rng() - 0.5) * 2 * RECLAIM_SCATTER.clumpSpread;
        // Satellites drift back toward the facade, never toward the kerb.
        const back = i === 0 ? 0 : rng() * Math.max(0, pave - off - 0.3);
        const px = x + tx * t + outX * -back;
        const pz = z + tz * t + outZ * -back;
        if (inBusStop(b.plan, px, pz, 1.2) || !plantable(b, px, pz)) continue;
        scatterPlant(b, px, b.plan.padY(px, pz), pz, outX, outZ, room + back, profile, rng, 3.2);
      }
    };

    /** Weeds in the joint between the kerb and the pavement: the cheap half of the effect. */
    const joint = (edgeX: number, edgeZ: number, outX: number, outZ: number): void => {
      const x = edgeX - outX * 0.45;
      const z = edgeZ - outZ * 0.45;
      const profile = field.at(x, z);
      if (profile.weeds < 0.1 || !plantable(b, x, z)) return;
      const rng = makeRng(seedAt(x, z, 0x22));
      if (rng() > profile.weeds) return;
      weeds(b, x + (rng() - 0.5) * 0.5, b.plan.padY(x, z) + 0.01, z + (rng() - 0.5) * 0.5, rng, {
        scale: 0.55 + rng() * 0.7,
        dry: 0.35 + (1 - profile.intensity) * 0.4,
      });
    };

    for (let x = blk.minX + 3; x < blk.maxX - 3; x += RECLAIM_SCATTER.ledgeStep) {
      if (facesRoad(x, blk.minZ, 0, -1)) place(x, blk.minZ, 0, -1, setback.z, 'x');
      if (facesRoad(x, blk.maxZ, 0, 1)) place(x, blk.maxZ, 0, 1, setback.z, 'x');
    }
    for (let z = blk.minZ + 3; z < blk.maxZ - 3; z += RECLAIM_SCATTER.ledgeStep) {
      if (facesRoad(blk.minX, z, -1, 0)) place(blk.minX, z, -1, 0, setback.x, 'z');
      if (facesRoad(blk.maxX, z, 1, 0)) place(blk.maxX, z, 1, 0, setback.x, 'z');
    }
    for (let x = blk.minX + 2; x < blk.maxX - 2; x += RECLAIM_SCATTER.weedStep) {
      if (facesRoad(x, blk.minZ, 0, -1)) joint(x, blk.minZ, 0, -1);
      if (facesRoad(x, blk.maxZ, 0, 1)) joint(x, blk.maxZ, 0, 1);
    }
    for (let z = blk.minZ + 2; z < blk.maxZ - 2; z += RECLAIM_SCATTER.weedStep) {
      if (facesRoad(blk.minX, z, -1, 0)) joint(blk.minX, z, -1, 0);
      if (facesRoad(blk.maxX, z, 1, 0)) joint(blk.maxX, z, 1, 0);
    }
    dressBlockGap(b, field, blk);
    dressLedgeWalls(b, field, blk);
  }
}

/**
 * A low retaining wall along the kerb, where a pocket has taken a stretch of pavement.
 *
 * This is the shape both concept renders are built around: a waist-high concrete run beside
 * the road, painted end to end, with the growth spilling over the top of it. The city has
 * almost none of it naturally — its buildings come straight up to the pavement — so the
 * reclamation puts it in, and only where a pocket is genuinely strong.
 *
 * It stands 0.3 m inside the block's collider edge, on the pavement the block already owns,
 * so it changes nothing about what a car can hit: the collider was always there.
 */
function dressLedgeWalls(b: EnvBuilders, field: ReclaimField, blk: BlockRect): void {
  const setback = blockSetback(blk.maxX - blk.minX, blk.maxZ - blk.minZ);
  const facesRoad = (x: number, z: number, ox: number, oz: number): boolean =>
    b.plan.isRoad(x + ox * 6, z + oz * 6) || b.plan.isRoad(x + ox * 10, z + oz * 10) || b.plan.isRoad(x + ox * 14, z + oz * 14);

  const run = (
    edgeX: number,
    edgeZ: number,
    outX: number,
    outZ: number,
    pave: number,
    t0: number,
    t1: number,
    along: 'x' | 'z',
  ): void => {
    if (pave < RECLAIM_SCATTER.ledgeWallPavement) return;
    const dx = along === 'x' ? 1 : 0;
    const dz = along === 'x' ? 0 : 1;
    const len = t1 - t0;
    const mid = (t0 + t1) / 2;
    const cx = along === 'x' ? mid : edgeX;
    const cz = along === 'x' ? edgeZ : mid;
    if (!facesRoad(cx, cz, outX, outZ)) return;
    const profile = field.at(cx, cz);
    if (profile.level < 2) return;
    const rng = makeRng(seedAt(cx, cz, 0x55));
    if (rng() > RECLAIM_SCATTER.ledgeWallChance) return;
    // Set back from the collider edge, thin, and never in front of a bus shelter.
    const thick = 0.28;
    const off = 0.22 + thick / 2;
    const wx = cx - outX * off;
    const wz = cz - outZ * off;
    if (inBusStop(b.plan, wx, wz, 1.6)) return;
    const y0 = b.plan.padY(wx, wz);
    const h = 0.95 + rng() * 0.5;
    b.wall.color(PAL.concrete, 1.0 + rng() * 0.2);
    b.wall.orientedBox(wx, wz, dx, dz, len - 0.4, thick, y0, y0 + h);
    // Coping, and the earth behind it that everything is growing out of.
    b.concrete.color(PAL.curb, 1.25);
    b.concrete.orientedBox(wx, wz, dx, dz, len - 0.3, thick + 0.16, y0 + h, y0 + h + 0.14);
    const bedDepth = Math.min(pave - off - thick / 2, 1.1);
    if (bedDepth > 0.25) {
      b.concrete.color(PAL.ground, 1.15);
      b.concrete.orientedBox(
        wx - outX * (thick / 2 + bedDepth / 2), wz - outZ * (thick / 2 + bedDepth / 2),
        dx, dz, len - 0.4, bedDepth, y0, y0 + h - 0.05,
      );
    }
    // The wall is the canvas: paint the road side of it end to end.
    const s = runSurface(
      cx - outX * 0.22 - dx * (len / 2 - 0.2), cz - outZ * 0.22 - dz * (len / 2 - 0.2),
      cx - outX * 0.22 + dx * (len / 2 - 0.2), cz - outZ * 0.22 + dz * (len / 2 - 0.2),
      y0 + 0.08, h - 0.14,
      // `runSurface` turns the run direction left; the road is on the `out` side.
      along === 'x' ? (outZ > 0 ? 1 : -1) : outX > 0 ? -1 : 1,
      0.05,
    );
    paintSurface(b, s, profile, seedAt(cx, cz, 0x56));
    grimeSurface(b, s, profile, seedAt(cx, cz, 0x57), rng() < 0.5 ? 'streak' : 'crack');
    // And the growth pouring over it, which is the whole point of the wall.
    const top = y0 + h + 0.14;
    const plants = 2 + Math.round(3 * profile.vegetation * rng());
    for (let i = 0; i < plants; i++) {
      const t = (rng() - 0.5) * (len - 1.2);
      const px = wx + dx * t - outX * (thick / 2 + bedDepth * 0.5);
      const pz = wz + dz * t - outZ * (thick / 2 + bedDepth * 0.5);
      scatterPlant(b, px, top, pz, outX, outZ, Math.max(0.5, bedDepth), profile, rng, 2.6);
    }
    weedLine(b, wx - dx * (len / 2 - 0.4), wz - dz * (len / 2 - 0.4), wx + dx * (len / 2 - 0.4), wz + dz * (len / 2 - 0.4), top, Math.round(len * 0.7), rng, {
      scale: 0.7 + rng() * 0.7,
      dry: 0.3,
    });
    if (rng() < profile.vines) {
      vine(b, cx - outX * 0.22, top - 0.06, cz - outZ * 0.22, outX, outZ, dx, dz, len * 0.5, h * 0.85, rng, { dry: 0.2 });
    }
  };

  const step = RECLAIM_SCATTER.ledgeWallStep;
  for (let t = blk.minX + 4; t < blk.maxX - 4 - step; t += step) {
    run(0, blk.minZ, 0, -1, setback.z, t, t + step, 'x');
    run(0, blk.maxZ, 0, 1, setback.z, t, t + step, 'x');
  }
  for (let t = blk.minZ + 4; t < blk.maxZ - 4 - step; t += step) {
    run(blk.minX, 0, -1, 0, setback.x, t, t + step, 'z');
    run(blk.maxX, 0, 1, 0, setback.x, t, t + step, 'z');
  }
}

/**
 * The inside of a block: the gap behind the buildings a pocket turns into a thicket. One
 * clump per block at most, well away from every street, so it is glimpsed down an alley
 * rather than driven past.
 */
function dressBlockGap(b: EnvBuilders, field: ReclaimField, blk: BlockRect): void {
  const cx = (blk.minX + blk.maxX) / 2;
  const cz = (blk.minZ + blk.maxZ) / 2;
  const w = blk.maxX - blk.minX;
  const d = blk.maxZ - blk.minZ;
  if (w < 22 || d < 22) return;
  const profile = field.at(cx, cz);
  if (profile.level < 2) return;
  const rng = makeRng(seedAt(cx, cz, 0x33));
  if (rng() > profile.vegetation) return;
  const n = 1 + Math.floor(rng() * 2);
  for (let i = 0; i < n; i++) {
    const x = cx + (rng() - 0.5) * w * 0.4;
    const z = cz + (rng() - 0.5) * d * 0.4;
    if (b.plan.isRoad(x, z, 3) || !plantable(b, x, z)) continue;
    scatterPlant(b, x, b.plan.padY(x, z), z, 0, 0, 3.5, profile, rng);
  }
}

/* ------------------------------------------------------------------ walls and barriers */

/**
 * Alley walls and street barriers. The tall concrete alley walls are the best canvas in the
 * city — long, blank, at eye level from the road — and they are what the concept art paints.
 *
 * THE LOW BARRIERS ARE DELIBERATELY LEFT BARE. A guardrail or a jersey barrier offers about
 * half a metre of paintable face, which is not enough wall for a piece to read as paint: at
 * that size a tag comes out as a small bright rectangle stuck on the concrete — a sticker,
 * not graffiti — and a run of them along a highway shoulder is the first thing the eye
 * catches. They still get their weeds and their vines; they just do not get painted.
 */
function buildRailPaint(b: EnvBuilders, field: ReclaimField): void {
  for (const r of b.plan.rails) {
    const len = Math.hypot(r.bx - r.ax, r.bz - r.az);
    if (len < 3) continue;
    const cx = (r.ax + r.bx) / 2;
    const cz = (r.az + r.bz) / 2;
    // No level gate on the paint: a blank concrete wall gets tagged in any part of any city,
    // and `profile.graffiti` carries its own floor. The growth below is gated, and is what
    // tells a reclaimed alley from a merely grubby one.
    const profile = field.at(cx, cz);
    const rng = makeRng(seedAt(cx, cz, 0x44));
    const y0 = (r.ay + r.by) / 2;
    const wall = r.kind === 'wall';
    // Both sides: which one faces the road depends on the segment, and an alley wall's back
    // is another alley. `rise` keeps the paint on the concrete where the run climbs.
    if (wall) {
      for (const side of [-1, 1] as const) {
        const s = runSurface(r.ax, r.az, r.bx, r.bz, y0 + 0.08, 2.7 - 0.16, side, 0.28, r.by - r.ay);
        paintSurface(b, s, profile, seedAt(cx, cz, 0x44 + side), side > 0 ? 'near' : 'far');
        grimeSurface(b, s, profile, seedAt(cx, cz, 0x55 + side), rng() < 0.5 ? 'streak' : 'stain');
      }
    }
    if (!wall) continue;
    // An alley wall in a pocket: a vine over the top and a weed line at the foot, on the
    // side away from the road, so nothing hangs where a car goes.
    const dx = (r.bx - r.ax) / len;
    const dz = (r.bz - r.az) / len;
    if (rng() < profile.vines) {
      vine(b, cx - dz * 0.28, y0 + 2.68, cz + dx * 0.28, -dz, dx, dx, dz, Math.min(len - 0.6, 2 + rng() * 4), 1.2 + rng() * 1.4, rng, { dry: 0.2 });
    }
    if (rng() < profile.weeds) {
      weedLine(b, r.ax + dz * 0.35, r.az - dx * 0.35, r.bx + dz * 0.35, r.bz - dx * 0.35, y0 + 0.01, Math.round(len * 0.35), rng, {
        scale: 0.6 + rng() * 0.6,
        dry: 0.4,
      });
    }
  }
}

/**
 * The perimeter band's retaining wall: a 3 m concrete run around the whole city, three metres
 * back from the road. The single longest paintable surface there is, and in the concept art
 * the one that carries the biggest pieces.
 */
function buildPerimeterPaint(b: EnvBuilders, field: ReclaimField): void {
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
    const inward = bandMid < (horizontal ? centreZ : centreX) ? 1 : -1;
    const innerEdge = inward > 0 ? bandMax : bandMin;
    // `buildPerimeter` stands the wall 1.7 m in from the band edge and 3.4 m thick, so its
    // face toward the city lands exactly on `innerEdge`, from y 0.22 to 3.22.
    for (let t = min + 2; t < max - RECLAIM_SCATTER.wallStep; t += RECLAIM_SCATTER.wallStep) {
      const len = Math.min(RECLAIM_SCATTER.wallStep, max - 2 - t);
      if (len < 3) break;
      const ax = horizontal ? t : innerEdge;
      const az = horizontal ? innerEdge : t;
      const bx = horizontal ? t + len : ax;
      const bz = horizontal ? az : t + len;
      const cx = (ax + bx) / 2;
      const cz = (az + bz) / 2;
      const profile = field.at(cx, cz);
      const rng = makeRng(seedAt(cx, cz, 0x66));
      const dirX = horizontal ? 1 : 0;
      const dirZ = horizontal ? 0 : 1;
      // `runSurface`'s normal is the run direction turned left times `side`; the city is in
      // the `inward` direction from the band, which is +z for a horizontal run and -x for a
      // vertical one.
      const side = horizontal ? inward : -inward;
      const s = runSurface(ax, az, bx, bz, 0.45, 2.5, side, 0.06);
      paintSurface(b, s, profile, seedAt(cx, cz, 0x66));
      grimeSurface(b, s, profile, seedAt(cx, cz, 0x67), rng() < 0.5 ? 'streak' : 'stain');
      // Over the top of it: this is a retaining wall with the perimeter band behind, so
      // anything growing up there hangs into the street.
      // Over the top of it: the perimeter band behind is 3.22 m up, so anything growing on
      // the wall head hangs out over the street below.
      if (rng() < profile.vines) {
        vine(b, cx + s.nx * 0.04, 3.2, cz + s.nz * 0.04, s.nx, s.nz, dirX, dirZ, len * (0.4 + rng() * 0.5), 1.2 + rng() * 1.8, rng, { dry: 0.2 });
      }
      if (rng() < profile.vegetation) {
        const t2 = (rng() - 0.5) * len * 0.7;
        const px = cx + dirX * t2 - s.nx * 1.2;
        const pz = cz + dirZ * t2 - s.nz * 1.2;
        // Standing on the wall head, a metre back from its face, and only allowed to lean out
        // over the street once it is well above it.
        scatterPlant(b, px, 3.22, pz, s.nx, s.nz, 1.0, profile, rng, 3);
      }
      if (rng() < profile.weeds) {
        // In the joint at the foot of the wall, on the band side: outside it is the street.
        weedLine(b, ax - s.nx * 0.35, az - s.nz * 0.35, bx - s.nx * 0.35, bz - s.nz * 0.35, 0.24, Math.round(len * 0.5), rng, {
          scale: 0.6 + rng() * 0.7,
          dry: 0.4,
        });
      }
    }
  }
}

/* ------------------------------------------------------------------ under the viaduct */

/**
 * The highway's underside: columns, the fences between them, and the deck skirt overhead.
 * Nothing here is on the driving surface — the columns stand outside the corridor, the
 * fences close the bays, and the skirt is fifteen metres up — so a vine on any of it is
 * scenery from below and never a hazard.
 */
function buildViaductReclaim(b: EnvBuilders, field: ReclaimField): void {
  for (const p of b.plan.pillars ?? []) {
    if (p.wet) continue;
    const profile = field.at(p.x, p.z);
    if (profile.level === 0) continue;
    const rng = makeRng(seedAt(p.x, p.z, 0x77));
    if (rng() > RECLAIM_SCATTER.columnChance) continue;
    const nx = -p.tz;
    const nz = p.tx;
    const y0 = b.plan.padY(p.x, p.z);
    const stand = p.halfWidth - 1.6;
    for (const side of [-1, 1] as const) {
      const cx = p.x + nx * stand * side;
      const cz = p.z + nz * stand * side;
      // Each column is a square section: paint the two faces along the road.
      for (const f of [-1, 1] as const) {
        const s: GraffitiSurface = {
          x: cx, y: y0 + 0.4, z: cz,
          nx: p.tx * f, nz: p.tz * f,
          tx: nx, tz: nz,
          width: 1.6, height: 3.2, out: 0.85,
        };
        paintSurface(b, s, profile, seedAt(cx, cz, 0x78 + f));
        grimeSurface(b, s, profile, seedAt(cx, cz, 0x79 + f), 'streak');
      }
      if (rng() < profile.vines) {
        vine(b, cx + nx * 0.85 * side, y0 + 0.5, cz + nz * 0.85 * side, nx * side, nz * side, p.tx, p.tz, 1.5, -(2.4 + rng() * 2.2), rng, { dry: 0.25 });
      }
      // Growth at the foot of a column stays inside the column's own collider footprint,
      // which the car cannot enter: a bush half a metre outside it would be something to
      // drive through.
      if (rng() < profile.weeds) {
        weedLine(b, cx - p.tx * 0.8, cz - p.tz * 0.8, cx + p.tx * 0.8, cz + p.tz * 0.8, y0 + 0.01, 3, rng, { scale: 0.7 + rng() * 0.6, dry: 0.45 });
      }
      if (rng() < profile.vegetation * 0.5) {
        const sx = cx + nx * 0.85 * side;
        const sz = cz + nz * 0.85 * side;
        if (plantable(b, sx, sz)) shrub(b, sx, y0, sz, rng, { scale: 0.9 + rng() * 0.7, dry: 0.35 });
      }
    }
  }

  for (const f of b.plan.fences ?? []) {
    const cx = (f.ax + f.bx) / 2;
    const cz = (f.az + f.bz) / 2;
    const len = Math.hypot(f.bx - f.ax, f.bz - f.az);
    if (len < 4) continue;
    const profile = field.at(cx, cz);
    if (profile.level === 0) continue;
    const rng = makeRng(seedAt(cx, cz, 0x88));
    const y0 = b.plan.padY(cx, cz);
    for (const side of [-1, 1] as const) {
      const s = runSurface(f.ax, f.az, f.bx, f.bz, y0 + 0.15, 1.9, side, 0.1);
      paintSurface(b, s, profile, seedAt(cx, cz, 0x89 + side), side < 0 ? 'far' : 'near');
    }
    const dx = (f.bx - f.ax) / len;
    const dz = (f.bz - f.az) / len;
    if (rng() < profile.vines) {
      vine(b, cx - dz * 0.12, y0 + 0.2, cz + dx * 0.12, -dz, dx, dx, dz, Math.min(len - 2, 2 + rng() * 4), -(1.6 + rng() * 0.7), rng, { dry: 0.2 });
    }
    // A fence stands on the corridor edge with the street on one side and the space under
    // the deck on the other. Both are checked: the growth goes wherever a car is not.
    if (rng() < profile.weeds && plantable(b, cx - dz * 0.4, cz + dx * 0.4)) {
      weedLine(b, f.ax - dz * 0.4, f.az + dx * 0.4, f.bx - dz * 0.4, f.bz + dx * 0.4, y0 + 0.01, Math.round(len * 0.3), rng, {
        scale: 0.7 + rng() * 0.7,
        dry: 0.4,
      });
    }
    if (rng() < profile.vegetation * 0.6) {
      const t = (rng() - 0.5) * (len - 2);
      const px = cx + dx * t - dz * 0.9;
      const pz = cz + dz * t + dx * 0.9;
      if (plantable(b, px, pz)) scatterPlant(b, px, y0, pz, -dz, dx, 1.8, profile, rng);
    }
  }
}

/* ------------------------------------------------------------------ overhead */

/**
 * What hangs over the street: off the route gates, off the enclosed skybridges, and off the
 * outer edge of every elevated deck. This is the half of the direction that reads from the
 * driving seat — a vine falling out of a gantry is in frame for seconds, where a shrub on a
 * kerb is gone in one.
 *
 * Every drop is clamped so its tip stays `OVERHEAD_CLEAR` above the road under it, which is a
 * metre over the tallest thing in the city. None of it has a collider, and none of it is
 * attached to anything a car can reach.
 */
function buildOverhead(b: EnvBuilders, field: ReclaimField): void {
  for (const g of b.plan.gates as GateDef[]) buildGateVines(b, field, g);
  for (const s of (b.plan.skybridges ?? []) as SkybridgeDef[]) buildSkybridgeVines(b, field, s);
  for (const rb of b.plan.ribbons) if (rb.elevated) buildDeckEdge(b, field, rb);
}

/** Growth over a neon route gate: off the top beam, and up the pylons at each end. */
function buildGateVines(b: EnvBuilders, field: ReclaimField, g: GateDef): void {
  const mx = (g.x0 + g.x1) / 2;
  const mz = (g.z0 + g.z1) / 2;
  const profile = field.at(mx, mz);
  const rng = makeRng(seedAt(mx, mz, 0xa1));
  if (rng() > profile.vines) return;
  let dx = g.x1 - g.x0;
  let dz = g.z1 - g.z0;
  const span = Math.hypot(dx, dz) || 1;
  dx /= span;
  dz /= span;
  // The beam's underside, and how far anything may fall from it.
  const beam = g.height - 0.8;
  const drop = Math.min(beam - OVERHEAD_CLEAR, 1.4 + rng() * 2.2);
  if (drop < 0.6) return;
  const n = 1 + Math.floor(rng() * 3);
  for (let i = 0; i < n; i++) {
    const t = (rng() - 0.6) * (span - 4);
    const w = 1.4 + rng() * 3;
    for (const side of [-1, 1] as const) {
      if (side < 0 && rng() < 0.45) continue;
      vine(b, mx + dx * t - dz * 0.42 * side, beam, mz + dz * t + dx * 0.42 * side, -dz * side, dx * side, dx, dz, w, drop, rng, {
        dry: 0.2,
      });
    }
  }
  // And climbing the pylons, which stand on the pavement well outside the road.
  for (const [px, pz] of [[g.x0, g.z0], [g.x1, g.z1]] as const) {
    if (rng() > profile.vines) continue;
    vine(b, px - dz * 0.5, b.plan.padY(px, pz), pz + dx * 0.5, -dz, dx, dx, dz, 0.9, -(2.5 + rng() * 3.5), rng, { dry: 0.25 });
  }
}

/** Growth off an enclosed skybridge: it is twelve metres up at the least, so nothing is near. */
function buildSkybridgeVines(b: EnvBuilders, field: ReclaimField, s: SkybridgeDef): void {
  const cx = (s.ax + s.bx) / 2;
  const cz = (s.az + s.bz) / 2;
  const profile = field.at(cx, cz);
  const rng = makeRng(seedAt(cx, cz, 0xa2));
  if (rng() > profile.vines) return;
  let dx = s.bx - s.ax;
  let dz = s.bz - s.az;
  const len = Math.hypot(dx, dz) || 1;
  if (len < 5) return;
  dx /= len;
  dz /= len;
  const under = s.y - s.height / 2 - 0.1;
  const drop = Math.min(under - OVERHEAD_CLEAR, 2 + rng() * 4);
  if (drop < 0.8) return;
  const hw = s.width / 2 + 0.3;
  for (const side of [-1, 1] as const) {
    if (rng() < 0.35) continue;
    const t = (rng() - 0.5) * (len - 3);
    vine(b, cx + dx * t - dz * hw * side, under, cz + dz * t + dx * hw * side, -dz * side, dx * side, dx, dz, 1.5 + rng() * 3.5, drop, rng, {
      dry: 0.15,
    });
  }
}

/**
 * The outer edge of an elevated deck: vines off the fascia, and damp running down the skirt.
 * Everything attaches at the fascia line, which is the outside of the guardrail, so nothing
 * here is on or over the driving surface of the deck itself — it hangs into the air beside it.
 */
function buildDeckEdge(b: EnvBuilders, field: ReclaimField, rb: { path: import('../../../world/track').TrackPath }): void {
  const samples = rb.path.samples;
  const segs = segmentCount(rb.path);
  const water = b.plan.water;
  for (let i = 0; i < segs; i += Math.max(1, Math.round(RECLAIM_SCATTER.deckStep / 6))) {
    const a = samples[i];
    if (a.y < 6) continue;
    if (water && a.z > water.quayZ) continue;
    const profile = field.at(a.x, a.z);
    const rng = makeRng(seedAt(a.x, a.z, 0xa3));
    const nx = a.tz;
    const nz = -a.tx;
    for (const side of [-1, 1] as const) {
      if (rng() > profile.vines) continue;
      const ex = a.x + nx * a.halfWidth * side;
      const ez = a.z + nz * a.halfWidth * side;
      // The fascia is the pale band just under the deck edge; a vine starts there and falls
      // into open air beside the viaduct. The ground below is a street, so it is clamped.
      const groundY = b.plan.padY(ex, ez);
      const drop = Math.min(a.y - 0.6 - groundY - OVERHEAD_CLEAR, 2 + rng() * 5);
      if (drop < 1) continue;
      vine(b, ex + nx * 0.08 * side, a.y - 0.6, ez + nz * 0.08 * side, nx * side, nz * side, a.tx, a.tz, 1.5 + rng() * 3.5, drop, rng, {
        dry: 0.2,
      });
      // Damp coming down the skirt under it.
      grimeSurface(
        b,
        {
          x: ex, y: a.y - 4.4, z: ez,
          nx: nx * side, nz: nz * side,
          tx: a.tx, tz: a.tz,
          width: 7, height: 3.6, out: 0.1,
        },
        profile,
        seedAt(ex, ez, 0xa4),
        'streak',
      );
    }
  }
}

/* ------------------------------------------------------------------ the waterfront */

/**
 * The quay: the wettest, least swept edge of the city, and the one place the growth is
 * allowed to be continuous rather than pocketed — the water keeps everything alive whatever
 * the field says. All of it stands on the six metres of quay pavement between the boulevard
 * and the wall, which is inside the quay's own collider and nowhere a car can be.
 */
function buildQuayReclaim(b: EnvBuilders, field: ReclaimField): void {
  const water = b.plan.water!;
  const bounds = b.plan.bounds;
  const qz = water.quayZ;
  for (let x = bounds.minX + 6; x < bounds.maxX - 6; x += 7) {
    if (b.plan.isRoad(x, qz - 1, 2)) continue;
    const profile = field.at(x, qz);
    const rng = makeRng(seedAt(x, qz, 0x99));
    const y0 = 0.2;
    // Damp and green along the wall foot whatever the field says.
    // Both ends, not the middle: a seven-metre run of weed can have one end on the mouth of
    // a street that the other end is nowhere near.
    if (rng() < Math.max(profile.weeds, 0.35) && plantable(b, x, qz - 0.55) && plantable(b, x + 7, qz - 0.55)) {
      weedLine(b, x, qz - 0.55, x + 7, qz - 0.55, y0 + 0.01, 4, rng, { scale: 0.6 + rng() * 0.7, dry: 0.3 });
    }
    if (rng() < profile.vegetation + 0.14) {
      const px = x + rng() * 6;
      const pz = qz - 2 - rng() * 2;
      if (plantable(b, px, pz)) scatterPlant(b, px, y0, pz, 0, -1, 3, profile, rng);
    }
  }
}
