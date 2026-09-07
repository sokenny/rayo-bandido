import type { CityPlan, ZoneId } from '../../../world/cityPlan';
import { inRect } from './meshBuilder';

/**
 * RECLAMATION ZONES — where the city has been let go.
 *
 * The city is not uniformly overgrown and it is not uniformly clean: nature has taken
 * specific places, and the contrast between them is the whole effect. This module is the one
 * answer to "how neglected is this spot", and every plant, tag, stain and blank ground-floor
 * wall in the city is placed from it, so a vine, the weeds under it, the graffiti beside it
 * and the cracked kerb in front all belong to the same pocket instead of being three
 * independent coin flips.
 *
 * HOW THE FIELD WORKS
 * A coarse grid of `cell` metres. A minority of cells (`pocketChance`) seed a POCKET: a
 * centre jittered inside the cell, a radius, and a strength. The intensity at a point is the
 * strongest pocket reaching it, smoothly falling off to nothing at its rim — which is what
 * makes a reclaimed area read as one place with a dense middle and a thinning edge, and what
 * makes the long stretches between pockets genuinely bare.
 *
 * On top of that sits a low, slow "neglect" ripple so that even maintained streets are not
 * all identical, and a per-zone bias: the corporate core is swept, the old town by the water
 * is not. A pocket that lands in the corporate core survives (a neglected block downtown is
 * a good sight) but is thinned; one in the old town is boosted.
 *
 * Everything here is pure arithmetic over a position: no state, no allocation beyond the
 * profile it returns, no dependence on evaluation order. It runs at build time only — a few
 * thousand calls while the city is generated — and never in the render loop.
 */

/** How far gone a place is, in four readable steps. */
export type ReclaimLevel = 0 | 1 | 2 | 3;

export const RECLAIM_LEVELS = ['clean', 'light', 'pocket', 'heavy'] as const;

export interface ReclaimProfile {
  /** Continuous 0..1: what everything below is derived from. */
  intensity: number;
  /** 0 maintained, 1 light neglect, 2 overgrown pocket, 3 heavily reclaimed landmark. */
  level: ReclaimLevel;
  /** Chance a candidate spot on the pavement grows something at all. */
  vegetation: number;
  /** Chance a crack, seam or wall joint sprouts a weed tuft. */
  weeds: number;
  /** Chance a ledge, rail or soffit above carries a vine. */
  vines: number;
  /** Chance a blank surface is painted, and how big the piece is allowed to be (0..1). */
  graffiti: number;
  graffitiScale: number;
  /** Chance a concrete surface takes a stain, streak or crack decal. */
  decay: number;
  /** Chance a planting bed is a cracked, abandoned shell rather than a kept one. */
  planter: number;
  /** A full-sized tree may stand here: only real pockets get one. */
  bigTree: boolean;
  /** The architecture here should offer a blank, paintable ground floor. */
  grafWall: boolean;
}

/**
 * The knobs. Frequency first, then how strong a reclaimed place gets, then the per-zone bias.
 *
 * TWO NUMBERS DECIDE HOW GREEN THE CITY IS.
 *
 * `baseNeglect` is the floor: how far gone a street is with no pocket anywhere near it. At
 * 0.45 that is most of the city carrying weeds in its kerb joints, shrubs against its walls
 * and the odd small tree — the city has been let go generally, not in a few corners.
 *
 * `pocketChance` (against `cell`) is what sits on top of that floor: the places that have
 * gone properly feral, with big canopies, thickets and walls disappearing under creeper. At
 * 46 m and 0.42, roughly two cells in five seed one, so a drive across the city passes
 * through several of them.
 *
 * The contrast between the two is the point. Drop `baseNeglect` towards 0.1 and the city goes
 * back to clean-with-pockets; raise `pocketChance` and the pockets merge into one jungle.
 */
export const RECLAIM = {
  /** Pocket grid (m). One pocket at most per cell. */
  cell: 46,
  /** Fraction of cells that seed a pocket: the places that have gone properly feral. */
  pocketChance: 0.42,
  /** Pocket reach (m), from the weakest to the strongest. */
  radiusMin: 26,
  radiusMax: 62,
  /** Of the pockets that exist, the fraction that are heavy, landmark-grade reclamations. */
  heavyChance: 0.22,
  /**
   * The floor under everything: how neglected a street is with no pocket on it. This is what
   * makes the whole city green rather than a few blocks of it.
   */
  baseNeglect: 0.45,
  /** Level thresholds on `intensity`. */
  lightAt: 0.14,
  pocketAt: 0.45,
  heavyAt: 0.78,
  /**
   * Per-zone multiplier on the intensity. The corporate core is the best-kept part of the
   * city, not a clean one: it still grows, just visibly less than the old town by the water.
   */
  zoneBias: { corporate: 0.78, urban: 1, jdm: 1.25 } as Record<ZoneId, number>,
  /** Extra multiplier inside the downtown rect: the square is swept more often than the rest. */
  downtownBias: 0.62,
  /** Vegetation, weed, vine, graffiti and decay density at intensity 1. */
  vegetationMax: 0.95,
  weedsMax: 0.9,
  vinesMax: 0.85,
  graffitiMax: 0.95,
  decayMax: 0.75,
  planterMax: 0.85,
  /**
   * The floor under paint and dirt. Nothing grows in a maintained street, but a working
   * cyberpunk city still has tags on its blank concrete and damp under its lips: without
   * this the clean 60 % of the map reads sterile rather than kept. Only paint and dirt have
   * a floor — a floor under the vegetation would undo the whole point of the pockets.
   */
  graffitiFloor: 0.12,
  decayFloor: 0.1,
  /** A tree needs at least this much intensity: ground cover is everywhere, canopies are not. */
  bigTreeAt: 0.5,
  /**
   * Where a building gives up its ground floor for a blank, paintable one. Well above the
   * base neglect: the plants are everywhere, the boarded-up shopfronts are not, and keeping
   * them apart is what stops the city reading as one uniform ruin.
   */
  grafWallAt: 0.5,
} as const;

/* ------------------------------------------------------------------ hashing */

/**
 * Deterministic 0..1 from two integers and a salt. Integer mixing rather than `sin`, so the
 * value is exactly the same on every machine and does not degrade for large coordinates.
 */
export function hash2(ix: number, iz: number, salt: number): number {
  let h = (Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iz | 0, 0x165667b1) ^ Math.imul(salt | 0, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** A stable seed for anything standing at (x, z), to a decimetre. */
export function seedAt(x: number, z: number, salt = 0): number {
  const ix = Math.round(x * 10);
  const iz = Math.round(z * 10);
  return (Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iz, 0x165667b1) ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0;
}

/** Smooth 0..1 value noise, one octave, over `scale` metres. The slow ripple of neglect. */
function ripple(x: number, z: number, scale: number, salt: number): number {
  const fx = x / scale;
  const fz = z / scale;
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  let tx = fx - ix;
  let tz = fz - iz;
  tx = tx * tx * (3 - 2 * tx);
  tz = tz * tz * (3 - 2 * tz);
  const a = hash2(ix, iz, salt);
  const b = hash2(ix + 1, iz, salt);
  const c = hash2(ix, iz + 1, salt);
  const d = hash2(ix + 1, iz + 1, salt);
  return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
}

/* ------------------------------------------------------------------ the field */

export interface ReclaimField {
  /** How reclaimed the point (x, z) is. */
  at(x: number, z: number): ReclaimProfile;
  /** Just the intensity, for the many places that only need a number. */
  intensityAt(x: number, z: number): number;
  /** The pockets that overlap a rectangle, strongest first: for placing a pocket's landmark. */
  pocketsIn(minX: number, minZ: number, maxX: number, maxZ: number): ReclaimPocket[];
}

export interface ReclaimPocket {
  x: number;
  z: number;
  radius: number;
  strength: number;
  heavy: boolean;
}

/** The pocket seeded by cell (ix, iz), or null when that cell holds none. */
function pocketOf(ix: number, iz: number): ReclaimPocket | null {
  const roll = hash2(ix, iz, 0x9e11);
  if (roll >= RECLAIM.pocketChance) return null;
  const jx = hash2(ix, iz, 0x51ab);
  const jz = hash2(ix, iz, 0x7c3d);
  const rr = hash2(ix, iz, 0x2f19);
  const heavy = hash2(ix, iz, 0x4d7f) < RECLAIM.heavyChance;
  return {
    x: (ix + 0.15 + jx * 0.7) * RECLAIM.cell,
    z: (iz + 0.15 + jz * 0.7) * RECLAIM.cell,
    radius: RECLAIM.radiusMin + rr * (RECLAIM.radiusMax - RECLAIM.radiusMin),
    // A heavy pocket saturates; an ordinary one only reaches the middle of the band.
    strength: heavy ? 1 : 0.5 + rr * 0.32,
    heavy,
  };
}

/**
 * Build the field for one world. It reads `zoneAt` and `downtown` from the plan, so the same
 * grid of pockets lands differently in a swept corporate core and in the old town, and it is
 * the plan — not a global — that decides where those are.
 */
export function createReclaimField(plan: Pick<CityPlan, 'zoneAt' | 'downtown'>): ReclaimField {
  const downtown = plan.downtown ?? null;

  const raw = (x: number, z: number): number => {
    // The strongest pocket reaching this point.
    const cx = Math.floor(x / RECLAIM.cell);
    const cz = Math.floor(z / RECLAIM.cell);
    // A pocket may reach `radiusMax`, which spans at most two cells either way.
    const span = Math.ceil(RECLAIM.radiusMax / RECLAIM.cell);
    let best = 0;
    for (let i = cx - span; i <= cx + span; i++) {
      for (let j = cz - span; j <= cz + span; j++) {
        const p = pocketOf(i, j);
        if (!p) continue;
        const d = Math.hypot(x - p.x, z - p.z) / p.radius;
        if (d >= 1) continue;
        // Smootherstep falloff: a dense middle, a soft rim, nothing outside.
        const t = 1 - d;
        best = Math.max(best, p.strength * t * t * (3 - 2 * t));
      }
    }
    // The ripple under everything, so a clean street still has a good and a tired end.
    const base = RECLAIM.baseNeglect * ripple(x, z, 70, 0x1234);
    return Math.min(1, Math.max(best, base * 1.6) + (best > 0 ? base * 0.5 : 0));
  };

  const bias = (x: number, z: number): number => {
    let m = RECLAIM.zoneBias[plan.zoneAt(x, z)];
    if (downtown && inRect(downtown, x, z, 10)) m *= RECLAIM.downtownBias;
    return m;
  };

  const intensityAt = (x: number, z: number): number => Math.min(1, raw(x, z) * bias(x, z));

  return {
    intensityAt,
    at(x: number, z: number): ReclaimProfile {
      const intensity = intensityAt(x, z);
      const level: ReclaimLevel =
        intensity < RECLAIM.lightAt ? 0 : intensity < RECLAIM.pocketAt ? 1 : intensity < RECLAIM.heavyAt ? 2 : 3;
      // Each kind of neglect has its own curve against intensity, and the exponents matter
      // more than the ceilings. Paint and weeds turn up in a working street — every real city
      // has both — so they rise fast and are already common at low intensity. Trees, vines and
      // planters are what a place looks like after years of nobody, so they stay near zero
      // until a genuine pocket and only then take over. That gap is the contrast the whole
      // direction rests on.
      const curve = (max: number, power: number): number => max * Math.pow(intensity, power);
      return {
        intensity,
        level,
        vegetation: curve(RECLAIM.vegetationMax, 1.15),
        weeds: curve(RECLAIM.weedsMax, 0.8),
        vines: curve(RECLAIM.vinesMax, 1.6),
        graffiti: Math.max(RECLAIM.graffitiFloor, curve(RECLAIM.graffitiMax, 0.6)),
        graffitiScale: 0.35 + 0.65 * intensity,
        decay: Math.max(RECLAIM.decayFloor, curve(RECLAIM.decayMax, 0.8)),
        planter: curve(RECLAIM.planterMax, 1.5),
        bigTree: intensity >= RECLAIM.bigTreeAt,
        grafWall: intensity >= RECLAIM.grafWallAt,
      };
    },
    pocketsIn(minX, minZ, maxX, maxZ) {
      const span = Math.ceil(RECLAIM.radiusMax / RECLAIM.cell);
      const out: ReclaimPocket[] = [];
      for (let i = Math.floor(minX / RECLAIM.cell) - span; i <= Math.floor(maxX / RECLAIM.cell) + span; i++) {
        for (let j = Math.floor(minZ / RECLAIM.cell) - span; j <= Math.floor(maxZ / RECLAIM.cell) + span; j++) {
          const p = pocketOf(i, j);
          if (!p) continue;
          const dx = Math.max(minX - p.x, 0, p.x - maxX);
          const dz = Math.max(minZ - p.z, 0, p.z - maxZ);
          if (Math.hypot(dx, dz) <= p.radius) out.push(p);
        }
      }
      out.sort((a, c) => c.strength - a.strength || a.x - c.x || a.z - c.z);
      return out;
    },
  };
}

/* ------------------------------------------------------------------ surface metadata */

/**
 * What a piece of architecture offers the reclamation. A ground-floor module, a retaining
 * wall or a viaduct column produces these, and the graffiti, vine and planting passes consume
 * them — so nothing is ever painted over a window and nothing grows out of a doorway.
 *
 * All of them are world-space and face-relative: `(x, y, z)` is the centre of the face,
 * `(nx, nz)` its outward normal, `(tx, tz)` the horizontal direction across it.
 */
export interface FaceFrame {
  x: number;
  y: number;
  z: number;
  nx: number;
  nz: number;
  tx: number;
  tz: number;
}

/** A flat, blank, paintable rectangle of wall. */
export interface GraffitiSurface extends FaceFrame {
  /**
   * Rise of the run per unit of `(tx, tz)`: 0 for a wall on level ground, non-zero for a
   * barrier climbing a ramp or a viaduct. Without it the paint on a sloping rail is laid out
   * level and runs off the top of the concrete at one end and off the bottom at the other.
   */
  ty?: number;
  width: number;
  height: number;
  /** How far in front of the wall the paint sits (m). */
  out: number;
  /** Rectangles on this face nothing may be painted over, in face-local (across, up) metres. */
  keepClear?: KeepClearZone[];
}

/** A rectangle on a face that must stay bare: a window, a door, a shutter, a lit sign. */
export interface KeepClearZone {
  /** Centre of the excluded rectangle in face-local metres: across the face, and up it. */
  across: number;
  up: number;
  width: number;
  height: number;
}

/** A lip, rail or soffit edge a vine can hang from, or a wall foot it can climb. */
export interface VineAnchor extends FaceFrame {
  width: number;
  /** How far the strands fall (m); negative means they climb instead. */
  drop: number;
}

/** A strip of ground at the foot of something where weeds and shrubs may take hold. */
export interface GroundPlantZone extends FaceFrame {
  width: number;
  /** How far out from the wall the strip reaches (m). */
  depth: number;
}

/** Somewhere a utility box, pipe stub or bollard belongs. */
export interface UtilityPropAnchor extends FaceFrame {}

/** Everything one built surface offers the reclamation passes. */
export interface ReclaimAnchors {
  graffiti: GraffitiSurface[];
  vines: VineAnchor[];
  ground: GroundPlantZone[];
  props: UtilityPropAnchor[];
}

export function emptyAnchors(): ReclaimAnchors {
  return { graffiti: [], vines: [], ground: [], props: [] };
}

/** True when a face-local point falls inside any keep-clear rectangle, grown by `pad`. */
export function isClear(zones: KeepClearZone[] | undefined, across: number, up: number, halfW: number, halfH: number): boolean {
  if (!zones) return true;
  for (const k of zones) {
    if (Math.abs(across - k.across) < k.width / 2 + halfW && Math.abs(up - k.up) < k.height / 2 + halfH) return false;
  }
  return true;
}
