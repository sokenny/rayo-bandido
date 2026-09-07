import type { ZoneId } from '../../../world/cityPlan';
import { PAL } from './palette';
import { FLOOR } from './facadeAtlas';
import type { EnvBuilders } from './builders';
import {
  emptyAnchors,
  type GraffitiSurface,
  type KeepClearZone,
  type ReclaimAnchors,
  type ReclaimProfile,
} from './reclaim';

/**
 * GROUND-FLOOR MODULES — the bottom two storeys, swapped out.
 *
 * The tower kit (`buildingKit.ts`) is good at towers and bad at the thing this direction
 * needs: a broad, blank, human-height surface a wall can be painted on and a plant can come
 * out of. Its ground floors are lit lobbies and window grids, which are exactly what you must
 * not paint over.
 *
 * So rather than rebuild the towers, a building in a neglected place gets a MODULE bolted
 * across its street face: a plinth of its own that stands a little proud of the facade behind
 * it, in the same modular box language as everything else, occupying the pavement the block
 * already owns. The facade behind carries on unchanged above it.
 *
 * Nine of them, chosen from the reclamation profile and the zone. What matters is not that
 * they are architecturally distinct — a service wall and a utility facade are close cousins —
 * but that each one hands back different METADATA:
 *
 *   graffiti  the flat, blank rectangles that may be painted, with the windows, shutters and
 *             meter boxes on them listed as keep-clear so nothing is ever painted over glass
 *   vines     the lips, copings and lintels something can hang off
 *   ground    the strips of pavement at the foot where weeds and shrubs take hold
 *   props     where a utility box, a bollard or a pipe stub belongs
 *
 * The reclamation passes read only that metadata, so a wall never has to be understood twice.
 *
 * COLLISION: a module lives entirely inside the block collider the simulation already knows
 * about — it stands on the pavement, and `out` is clamped so its front face stops well short
 * of the kerb. Nothing here changes what a car can hit.
 */

export type GroundModuleKind =
  | 'serviceWall'
  | 'shutter'
  | 'podium'
  | 'maintenanceBay'
  | 'retaining'
  | 'utility'
  | 'underpass'
  | 'ruinedShop'
  | 'panelled';

export const GROUND_MODULES: readonly GroundModuleKind[] = [
  'serviceWall',
  'shutter',
  'podium',
  'maintenanceBay',
  'retaining',
  'utility',
  'underpass',
  'ruinedShop',
  'panelled',
];

/** One street-facing wall of a building, as the module kit sees it. */
export interface GroundFace {
  /** Centre of the wall at its base. */
  x: number;
  y: number;
  z: number;
  /** Outward normal of the wall (unit). */
  nx: number;
  nz: number;
  /** Across the wall (unit), so `x + tx * a` walks along it. */
  tx: number;
  tz: number;
  /** Length of the wall (m). */
  width: number;
  /** Clear pavement in front of it before the kerb (m). */
  pavement: number;
  /** Height of the building above this wall (m): a module never reaches the floor above it. */
  maxHeight: number;
  zone: ZoneId;
}

export const GROUND_FLOOR = {
  /** Least wall a module is worth building on, and least pavement in front of it (m). */
  minWidth: 4,
  /**
   * Least pavement a module needs in front of the facade (m). The city's plots are tight —
   * most keep between 0.8 m and 1.6 m of pavement between the wall and the block's collider
   * edge — so this has to be small or the modules never appear anywhere. What keeps it honest
   * is `kerbClearance` below, not this.
   */
  minPavement: 0.55,
  /** How far a module may stand proud of the facade, and how much bare pavement to leave. */
  maxOut: 0.45,
  /**
   * Bare pavement left between the front of a module and the block's collider edge (m).
   * Everything a module draws lives inside the collider the simulation already has, so it
   * cannot change what a car can hit; this margin is what guarantees it.
   */
  kerbClearance: 0.45,
  /** Module height band (m). Snapped against the storey height where it matters. */
  minHeight: 3.2,
  maxHeight: 7,
} as const;

/* ------------------------------------------------------------------ helpers */

/**
 * The hard limit on how far anything a module draws may stand out from the wall: the pavement
 * it stands on, less the strip of it left bare at the kerb. Every box and every painted
 * surface below is clamped to this, so a module cannot reach out of the collider the block
 * already has whatever its own numbers say. This is the one guarantee that keeps the modules
 * out of the simulation's business, and it is what `tests/reclamation.test.ts` checks.
 */
function outLimit(face: GroundFace): number {
  return Math.max(0.08, face.pavement - GROUND_FLOOR.kerbClearance);
}

/** How far a module on this face wants to stand out from the wall, inside that limit. */
function outFor(face: GroundFace, want: number): number {
  return Math.max(0.06, Math.min(want, GROUND_FLOOR.maxOut, outLimit(face)));
}

/** A box in face-local coordinates: `a0..a1` across the wall, `y0..y1` up, `d0..d1` out of it. */
function slab(
  b: EnvBuilders,
  face: GroundFace,
  a0: number,
  a1: number,
  y0: number,
  y1: number,
  d0: number,
  d1: number,
  color: number,
  bright: number,
  target: 'concrete' | 'props' = 'concrete',
): void {
  // 'concrete' goes to `b.wall`, not `b.concrete`: a module IS the eye-level blank wall the
  // concrete photograph exists for (`env/wallDetail.ts`). 'props' is painted metal as ever.
  const limit = outLimit(face);
  d0 = Math.min(d0, limit);
  d1 = Math.min(d1, limit);
  const ac = (a0 + a1) / 2;
  const dc = (d0 + d1) / 2;
  const x = face.x + face.tx * ac + face.nx * dc;
  const z = face.z + face.tz * ac + face.nz * dc;
  const along = Math.abs(a1 - a0);
  const deep = Math.max(0.02, Math.abs(d1 - d0));
  const mb = target === 'concrete' ? b.wall : b.props;
  mb.color(color, bright);
  mb.orientedBox(x, z, face.tx, face.tz, along, deep, face.y + y0, face.y + y1);
}

/** A paintable rectangle on this face, `out` metres in front of the wall plane. */
function surface(
  face: GroundFace,
  across: number,
  up0: number,
  up1: number,
  width: number,
  out: number,
  keepClear?: KeepClearZone[],
): GraffitiSurface {
  return {
    x: face.x + face.tx * across,
    y: face.y + up0,
    z: face.z + face.tz * across,
    nx: face.nx,
    nz: face.nz,
    tx: face.tx,
    tz: face.tz,
    width,
    height: up1 - up0,
    out: Math.min(out + 0.03, outLimit(face)),
    ...(keepClear ? { keepClear } : {}),
  };
}

/**
 * Which module a place asks for. Maintained streets keep their shopfronts and get nothing at
 * all; a neglected one takes whichever archetype the zone and the rng agree on. The old town
 * shutters and ruins, the corporate core podiums and service walls, the urban middle a bit
 * of everything.
 */
export function pickGroundModule(profile: ReclaimProfile, zone: ZoneId, rng: () => number): GroundModuleKind | null {
  if (!profile.grafWall) return null;
  // Even in a pocket, not every building gives up its ground floor: the street has to keep
  // some active frontage or it reads as a ruin rather than a working city.
  if (rng() > 0.45 + profile.intensity * 0.5) return null;
  const r = rng();
  if (zone === 'jdm') {
    if (r < 0.3) return 'shutter';
    if (r < 0.48) return 'ruinedShop';
    if (r < 0.62) return 'retaining';
    if (r < 0.76) return 'serviceWall';
    if (r < 0.88) return 'panelled';
    return 'utility';
  }
  if (zone === 'corporate') {
    if (r < 0.28) return 'podium';
    if (r < 0.5) return 'serviceWall';
    if (r < 0.66) return 'underpass';
    if (r < 0.8) return 'utility';
    if (r < 0.92) return 'panelled';
    return 'maintenanceBay';
  }
  if (r < 0.22) return 'serviceWall';
  if (r < 0.4) return 'shutter';
  if (r < 0.54) return 'panelled';
  if (r < 0.68) return 'maintenanceBay';
  if (r < 0.8) return 'podium';
  if (r < 0.9) return 'retaining';
  return 'ruinedShop';
}

/* ------------------------------------------------------------------ the modules */

/**
 * Build one module across `face` and hand back what it offers the reclamation. The caller
 * decides whether the face deserves one (`pickGroundModule`); this only draws it.
 */
export function buildGroundModule(
  b: EnvBuilders,
  face: GroundFace,
  kind: GroundModuleKind,
  profile: ReclaimProfile,
  rng: () => number,
): ReclaimAnchors {
  const anchors = emptyAnchors();
  if (face.width < GROUND_FLOOR.minWidth || face.pavement < GROUND_FLOOR.minPavement) return anchors;
  const w = face.width - 0.4;
  const half = w / 2;
  const grime = PAL.concrete;

  switch (kind) {
    /* A blank concrete service wall: the plainest thing in the kit and the best canvas. */
    case 'serviceWall': {
      const h = Math.min(face.maxHeight - 0.4, FLOOR * (rng() < 0.5 ? 1 : 2) + 0.6);
      const out = outFor(face, 0.32);
      slab(b, face, -half, half, 0, h, 0, out, grime, 1.02 + rng() * 0.2);
      // A coping along the top so it catches the street light and reads as a built thing.
      slab(b, face, -half, half, h, h + 0.18, -0.02, out + 0.08, PAL.curb, 1.25);
      // A vent grille and a downpipe: the only detail, both kept dark.
      const va = (rng() - 0.5) * w * 0.5;
      slab(b, face, va - 0.7, va + 0.7, h * 0.55, h * 0.55 + 0.7, out, out + 0.06, PAL.metalDark, 0.9, 'props');
      const pa = (rng() < 0.5 ? -1 : 1) * (half - 0.6);
      slab(b, face, pa - 0.09, pa + 0.09, 0, h, out, out + 0.18, PAL.metalDark, 0.85, 'props');
      anchors.graffiti.push(
        surface(face, 0, 0.15, h - 0.25, w - 0.3, out, [
          { across: va, up: h * 0.55 + 0.35, width: 1.8, height: 1.1 },
          { across: pa, up: h / 2, width: 0.5, height: h },
        ]),
      );
      anchors.vines.push({ x: face.x, y: face.y + h + 0.16, z: face.z, nx: face.nx, nz: face.nz, tx: face.tx, tz: face.tz, width: w * 0.8, drop: h * 0.65 });
      anchors.ground.push({ x: face.x, y: face.y, z: face.z, nx: face.nx, nz: face.nz, tx: face.tx, tz: face.tz, width: w, depth: out + 0.5 });
      anchors.props.push({ x: face.x + face.tx * -pa, y: face.y, z: face.z + face.tz * -pa, nx: face.nx, nz: face.nz, tx: face.tx, tz: face.tz });
      break;
    }

    /* A closed roller shutter over a loading entrance, in a concrete frame. */
    case 'shutter': {
      const h = Math.min(face.maxHeight - 0.4, 3.6 + rng() * 0.9);
      const out = outFor(face, 0.3);
      const doorW = Math.min(w * 0.62, 3.4 + rng() * 2.6);
      const doorA = (rng() - 0.5) * (w - doorW) * 0.7;
      // The frame: the wall either side of the opening, and the lintel over it.
      slab(b, face, -half, doorA - doorW / 2, 0, h, 0, out, grime, 1.05);
      slab(b, face, doorA + doorW / 2, half, 0, h, 0, out, grime, 1.05);
      slab(b, face, -half, half, h - 0.5, h + 0.2, 0, out + 0.12, PAL.curb, 1.2);
      // The shutter itself: a ribbed metal panel set a little back into the opening.
      const back = out - 0.16;
      slab(b, face, doorA - doorW / 2, doorA + doorW / 2, 0, h - 0.5, back - 0.06, back, PAL.metalDark, 0.85 + rng() * 0.2, 'props');
      for (let y = 0.35; y < h - 0.7; y += 0.55) {
        slab(b, face, doorA - doorW / 2 + 0.05, doorA + doorW / 2 - 0.05, y, y + 0.07, back, back + 0.05, PAL.metalDark, 1.15, 'props');
      }
      // Bollards guarding the opening, and the kerb ramp up to it.
      for (const s of [-1, 1]) {
        slab(b, face, doorA + s * (doorW / 2 + 0.35) - 0.11, doorA + s * (doorW / 2 + 0.35) + 0.11, 0, 0.85, out + 0.25, out + 0.47, PAL.metalDark, 1.1, 'props');
      }
      // The shutter is the best surface on the street; the piers beside it take the overflow.
      anchors.graffiti.push(surface(face, doorA, 0.1, h - 0.65, doorW - 0.2, back));
      if (doorA - doorW / 2 > -half + 1.4) anchors.graffiti.push(surface(face, (-half + doorA - doorW / 2) / 2, 0.15, h - 0.7, doorA - doorW / 2 + half - 0.3, out));
      if (half - (doorA + doorW / 2) > 1.4) anchors.graffiti.push(surface(face, (half + doorA + doorW / 2) / 2, 0.15, h - 0.7, half - doorA - doorW / 2 - 0.3, out));
      anchors.vines.push({ x: face.x, y: face.y + h + 0.18, z: face.z, nx: face.nx, nz: face.nz, tx: face.tx, tz: face.tz, width: w * 0.7, drop: h * 0.5 });
      anchors.ground.push({ x: face.x + face.tx * (doorA > 0 ? -half * 0.55 : half * 0.55), y: face.y, z: face.z + face.tz * (doorA > 0 ? -half * 0.55 : half * 0.55), nx: face.nx, nz: face.nz, tx: face.tx, tz: face.tz, width: w * 0.35, depth: out + 0.5 });
      break;
    }

    /* A parking podium: a solid plinth, a band of louvres where the decks breathe, and a
       blind wall above. Tall, so it is the one that reads from across a junction. */
    case 'podium': {
      const h = Math.min(face.maxHeight - 0.6, 5.2 + rng() * 1.8);
      const out = outFor(face, 0.38);
      const bandY0 = h * 0.42;
      const bandY1 = h * 0.72;
      slab(b, face, -half, half, 0, bandY0, 0, out, grime, 1.0 + rng() * 0.15);
      slab(b, face, -half, half, bandY1, h, 0, out, grime, 0.94);
      // The louvres: horizontal fins over a dark void, so the band reads as open, not solid.
      slab(b, face, -half, half, bandY0, bandY1, out - 0.35, out - 0.28, PAL.metalDark, 0.4);
      const fins = Math.max(3, Math.round((bandY1 - bandY0) / 0.38));
      for (let i = 0; i < fins; i++) {
        const y = bandY0 + ((i + 0.5) / fins) * (bandY1 - bandY0);
        slab(b, face, -half + 0.15, half - 0.15, y, y + 0.08, out - 0.28, out, PAL.metalDark, 1.05, 'props');
      }
      slab(b, face, -half, half, h, h + 0.22, -0.02, out + 0.1, PAL.curb, 1.25);
      // Only the plinth below the louvres is paintable; the band above it is out of reach.
      anchors.graffiti.push(surface(face, 0, 0.15, bandY0 - 0.2, w - 0.4, out));
      anchors.vines.push({ x: face.x, y: face.y + h + 0.2, z: face.z, nx: face.nx, nz: face.nz, tx: face.tx, tz: face.tz, width: w * 0.9, drop: h * 0.7 });
      anchors.vines.push({ x: face.x, y: face.y + bandY0, z: face.z, nx: face.nx, nz: face.nz, tx: face.tx, tz: face.tz, width: w * 0.6, drop: -bandY0 * 0.8 });
      anchors.ground.push({ x: face.x, y: face.y, z: face.z, nx: face.nx, nz: face.nz, tx: face.tx, tz: face.tz, width: w, depth: out + 0.55 });
      break;
    }

    /* A recessed maintenance bay: two piers, a deep dark recess between them, a lintel over.
       The recess is the best planting spot on the street — nothing sweeps it and nothing
       parks in it. */
    case 'maintenanceBay': {
      const h = Math.min(face.maxHeight - 0.4, 3.8 + rng() * 1.2);
      const out = outFor(face, 0.42);
      const bayW = Math.min(w * 0.55, 3 + rng() * 2.4);
      const bayA = (rng() - 0.5) * (w - bayW) * 0.6;
      slab(b, face, -half, bayA - bayW / 2, 0, h, 0, out, grime, 1.05);
      slab(b, face, bayA + bayW / 2, half, 0, h, 0, out, grime, 1.05);
      slab(b, face, -half, half, h - 0.45, h + 0.16, 0, out + 0.14, PAL.curb, 1.15);
      // The back of the recess, dark, and a step up into it.
      slab(b, face, bayA - bayW / 2, bayA + bayW / 2, 0, h - 0.45, -0.12, -0.05, PAL.concrete, 0.5);
      slab(b, face, bayA - bayW / 2, bayA + bayW / 2, 0, 0.2, -0.05, out * 0.6, PAL.curb, 0.8);
      // A gantry rail and a couple of drums, so the bay reads as a place work happens.
      slab(b, face, bayA - bayW / 2 + 0.2, bayA + bayW / 2 - 0.2, h - 0.75, h - 0.63, -0.02, 0.08, PAL.metalDark, 0.9, 'props');
      anchors.graffiti.push(surface(face, bayA, 0.25, h - 0.7, bayW - 0.3, -0.03));
      anchors.graffiti.push(surface(face, (-half + bayA - bayW / 2) / 2, 0.15, h - 0.65, Math.max(0.5, bayA - bayW / 2 + half - 0.3), out));
      anchors.vines.push({ x: face.x + face.tx * bayA, y: face.y + h - 0.5, z: face.z + face.tz * bayA, nx: face.nx, nz: face.nz, tx: face.tx, tz: face.tz, width: bayW * 0.9, drop: h * 0.5 });
      anchors.ground.push({ x: face.x + face.tx * bayA, y: face.y + 0.2, z: face.z + face.tz * bayA, nx: face.nx, nz: face.nz, tx: face.tx, tz: face.tz, width: bayW - 0.4, depth: 0.5 });
      anchors.props.push({ x: face.x + face.tx * bayA, y: face.y + 0.2, z: face.z + face.tz * bayA, nx: face.nx, nz: face.nz, tx: face.tx, tz: face.tz });
      break;
    }

    /* A retaining wall: low, capped, with the ground behind it standing higher than the
       street. Everything grows over the top of it, which is the single most useful shape in
       this whole direction. */
    case 'retaining': {
      const h = 1.5 + rng() * 1.1;
      const out = outFor(face, 0.4);
      slab(b, face, -half, half, 0, h, 0, out, grime, 1.08 + rng() * 0.14);
      // Coping, standing proud both ways.
      slab(b, face, -half - 0.1, half + 0.1, h, h + 0.22, -0.06, out + 0.12, PAL.curb, 1.3);
      // The raised earth behind it, which is what the plants stand on.
      slab(b, face, -half, half, 0, h - 0.05, -1.6, -0.02, PAL.ground, 1.15);
      // Weep holes: a row of dark slots at the foot, where the water and the weeds come out.
      for (let i = 0; i < 4; i++) {
        const a = -half + ((i + 0.5) / 4) * w;
        slab(b, face, a - 0.12, a + 0.12, 0.28, 0.46, out - 0.03, out + 0.02, PAL.metalDark, 0.4, 'props');
      }
      anchors.graffiti.push(surface(face, 0, 0.12, h - 0.12, w - 0.2, out));
      // The top of the wall: the planting bed, and where anything hanging starts.
      anchors.ground.push({ x: face.x - face.nx * 0.7, y: face.y + h + 0.22, z: face.z - face.nz * 0.7, nx: face.nx, nz: face.nz, tx: face.tx, tz: face.tz, width: w - 0.4, depth: 1.2 });
      anchors.ground.push({ x: face.x, y: face.y, z: face.z, nx: face.nx, nz: face.nz, tx: face.tx, tz: face.tz, width: w, depth: out + 0.5 });
      anchors.vines.push({ x: face.x, y: face.y + h + 0.2, z: face.z, nx: face.nx, nz: face.nz, tx: face.tx, tz: face.tz, width: w * 0.85, drop: h * 0.8 });
      break;
    }

    /* A dark utility facade: meter cupboards, conduit, an extract louvre, no windows. */
    case 'utility': {
      const h = Math.min(face.maxHeight - 0.4, FLOOR + 0.8 + rng() * 1.4);
      const out = outFor(face, 0.26);
      slab(b, face, -half, half, 0, h, 0, out, PAL.metalDark, 0.85 + rng() * 0.25);
      slab(b, face, -half, half, h - 0.2, h + 0.14, -0.02, out + 0.1, PAL.curb, 1.05);
      // Two meter cupboards and the conduit running between them.
      const boxes: KeepClearZone[] = [];
      const n = 2 + Math.floor(rng() * 2);
      for (let i = 0; i < n; i++) {
        const a = -half + ((i + 0.5) / n) * w + (rng() - 0.5) * 0.6;
        const bw = 0.7 + rng() * 0.5;
        const by = 1.1 + rng() * 0.5;
        slab(b, face, a - bw / 2, a + bw / 2, by - 0.55, by + 0.55, out, out + 0.22, PAL.metalDark, 1.15, 'props');
        boxes.push({ across: a, up: by, width: bw + 0.3, height: 1.4 });
      }
      slab(b, face, -half + 0.4, half - 0.4, h - 0.75, h - 0.68, out, out + 0.08, PAL.metalDark, 0.95, 'props');
      anchors.graffiti.push(surface(face, 0, 0.15, h - 0.35, w - 0.3, out, boxes));
      anchors.ground.push({ x: face.x, y: face.y, z: face.z, nx: face.nx, nz: face.nz, tx: face.tx, tz: face.tz, width: w, depth: out + 0.45 });
      anchors.props.push({ x: face.x + face.tx * (half - 0.8), y: face.y, z: face.z + face.tz * (half - 0.8), nx: face.nx, nz: face.nz, tx: face.tx, tz: face.tz });
      break;
    }

    /* A column-and-wall underpass: a colonnade with the wall set back behind it. Deep
       shadow between the columns, and every column is a canvas on four sides. */
    case 'underpass': {
      const h = Math.min(face.maxHeight - 0.5, 4.2 + rng() * 1.4);
      const out = outFor(face, 0.45);
      const bays = Math.max(2, Math.round(w / (3 + rng() * 1.5)));
      // The back wall, set into the facade so the bays are genuinely deep.
      slab(b, face, -half, half, 0, h, -0.3, -0.1, PAL.concrete, 0.62);
      // The beam over the columns.
      slab(b, face, -half, half, h - 0.6, h + 0.18, -0.3, out + 0.1, PAL.curb, 1.15);
      const colW = 0.55 + rng() * 0.25;
      for (let i = 0; i <= bays; i++) {
        const a = -half + (i / bays) * w;
        slab(b, face, a - colW / 2, a + colW / 2, 0, h - 0.6, -0.3, out, grime, 1.05 + rng() * 0.15);
      }
      anchors.graffiti.push(surface(face, 0, 0.2, h - 0.85, w - colW * 2, -0.08));
      for (let i = 0; i <= bays; i += Math.max(1, Math.round(bays / 3))) {
        const a = -half + (i / bays) * w;
        anchors.graffiti.push(surface(face, a, 0.2, Math.min(2.8, h - 0.9), colW - 0.05, out));
      }
      anchors.vines.push({ x: face.x, y: face.y + h - 0.62, z: face.z, nx: face.nx, nz: face.nz, tx: face.tx, tz: face.tz, width: w * 0.9, drop: h * 0.55 });
      anchors.ground.push({ x: face.x - face.nx * 0.1, y: face.y, z: face.z - face.nz * 0.1, nx: face.nx, nz: face.nz, tx: face.tx, tz: face.tz, width: w - 0.6, depth: out + 0.3 });
      break;
    }

    /* A damaged storefront shell: the frame is still there, the glass is not. Kept mostly
       dark — a lit ruin reads as a shop, and this is not one. */
    case 'ruinedShop': {
      const h = Math.min(face.maxHeight - 0.4, 3.6 + rng() * 0.8);
      const out = outFor(face, 0.3);
      const openW = Math.min(w * 0.66, 4 + rng() * 2.5);
      const openA = (rng() - 0.5) * (w - openW) * 0.5;
      slab(b, face, -half, openA - openW / 2, 0, h, 0, out, grime, 1.0);
      slab(b, face, openA + openW / 2, half, 0, h, 0, out, grime, 1.0);
      slab(b, face, -half, half, h - 0.42, h + 0.16, 0, out + 0.14, PAL.curb, 1.1);
      // The void where the shopfront was: black, set well back.
      slab(b, face, openA - openW / 2, openA + openW / 2, 0.35, h - 0.42, -0.5, -0.35, PAL.night, 1);
      // Boarding across the bottom half of the opening, sagging and off-square.
      const boardH = 1.1 + rng() * 0.7;
      slab(b, face, openA - openW / 2, openA + openW / 2, 0, boardH, out - 0.22, out - 0.14, PAL.rust, 0.9 + rng() * 0.3, 'props');
      // A mullion or two still standing in the opening.
      for (let i = 1; i < 3; i++) {
        if (rng() < 0.4) continue;
        const a = openA - openW / 2 + (i / 3) * openW;
        slab(b, face, a - 0.05, a + 0.05, boardH, h - 0.42, out - 0.2, out - 0.12, PAL.metalDark, 0.8, 'props');
      }
      anchors.graffiti.push(
        surface(face, openA, 0.1, h - 0.6, openW - 0.15, out - 0.13, [
          // Nothing may be painted on the void above the boarding.
          { across: 0, up: boardH + (h - boardH) / 2 + 0.2, width: openW, height: h - boardH },
        ]),
      );
      anchors.graffiti.push(surface(face, (-half + openA - openW / 2) / 2, 0.15, h - 0.6, Math.max(0.6, openA - openW / 2 + half - 0.3), out));
      anchors.ground.push({ x: face.x + face.tx * openA, y: face.y, z: face.z + face.tz * openA, nx: face.nx, nz: face.nz, tx: face.tx, tz: face.tz, width: openW, depth: out + 0.6 });
      anchors.vines.push({ x: face.x + face.tx * openA, y: face.y + h - 0.45, z: face.z + face.tz * openA, nx: face.nx, nz: face.nz, tx: face.tx, tz: face.tz, width: openW * 0.85, drop: h * 0.6 });
      break;
    }

    /* Narrow wall panels between slim structural columns: a rhythm rather than one slab, and
       every panel is its own canvas. */
    case 'panelled': {
      const h = Math.min(face.maxHeight - 0.4, FLOOR + 0.6 + rng() * 1.6);
      const out = outFor(face, 0.34);
      const bays = Math.max(2, Math.round(w / (2.4 + rng() * 1.4)));
      const colW = 0.34 + rng() * 0.18;
      for (let i = 0; i < bays; i++) {
        const a0 = -half + (i / bays) * w + colW / 2;
        const a1 = -half + ((i + 1) / bays) * w - colW / 2;
        // Each panel takes its own tone: the wall reads as panels, not as one pour.
        slab(b, face, a0, a1, 0, h, 0, out - 0.1, grime, 0.9 + rng() * 0.35);
        anchors.graffiti.push(surface(face, (a0 + a1) / 2, 0.15, h - 0.35, a1 - a0 - 0.15, out - 0.1));
      }
      for (let i = 0; i <= bays; i++) {
        const a = -half + (i / bays) * w;
        slab(b, face, a - colW / 2, a + colW / 2, 0, h + 0.1, 0, out, PAL.curb, 1.12);
      }
      slab(b, face, -half, half, h + 0.1, h + 0.28, -0.02, out + 0.1, PAL.curb, 1.22);
      anchors.vines.push({ x: face.x, y: face.y + h + 0.26, z: face.z, nx: face.nx, nz: face.nz, tx: face.tx, tz: face.tz, width: w * 0.85, drop: h * 0.6 });
      anchors.ground.push({ x: face.x, y: face.y, z: face.z, nx: face.nx, nz: face.nz, tx: face.tx, tz: face.tz, width: w, depth: out + 0.45 });
      break;
    }
  }

  // What has broken off. A shallow dark bite out of the concrete at the foot, where the water
  // stands and the frost gets in: sized by the profile, so a lightly neglected wall shows
  // nothing and a given-up one has lost a corner. Two triangles' worth of damage, and the
  // crack decals the reclamation pass lays over it do the rest.
  const canvasSurface = anchors.graffiti[0];
  if (canvasSurface && rng() < profile.decay) {
    const out = outFor(face, 0.46);
    const n = 1 + (profile.level >= 3 && rng() < 0.5 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const a = (rng() - 0.5) * (w - 1);
      const bw = 0.35 + rng() * 0.9;
      const bh = 0.2 + rng() * 0.5;
      const low = rng() < 0.7;
      const y0 = low ? 0.02 : 0.9 + rng() * 1.4;
      slab(b, face, a - bw / 2, a + bw / 2, y0, y0 + bh, out - 0.14, out - 0.02, PAL.night, 1.1);
    }
  }
  return anchors;
}
