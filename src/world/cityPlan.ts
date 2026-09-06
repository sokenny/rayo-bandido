import type { TrackPath } from './track';

/**
 * What the renderer needs to draw a city. Pure data plus three predicates; no Three.js.
 *
 * Both worlds produce one of these next to their `ArenaLayout`: the test city from its
 * axis-aligned road/block rectangles (`arenaWorld.ts`), the circuit from a track path and the
 * blocks generated around it (`raceWorld.ts`). `src/render/scene/environment.ts` and the
 * builders under `env/` read only this, so the same facades, neon, props and skyline dress
 * either map. Everything the simulation can collide with is in the layout; everything the
 * player can see is derived from the plan; the two are built from the same rectangles and
 * paths, so they can never disagree.
 */

export type ZoneId = 'corporate' | 'urban' | 'jdm';

export interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface RoadRect extends Rect {
  tag: string;
  /** 'z' runs north-south, 'x' runs east-west, 'open' is a plaza (no lane markings). */
  axis: 'x' | 'z' | 'open';
  /** Number of painted lanes; 0 for a plaza or an alley. */
  lanes: number;
  zone: ZoneId;
}

export interface BlockRect extends Rect {
  tag: string;
  zone: ZoneId;
  /** Rough height band: 1 = low industrial, 2 = mid-rise, 3 = tower, 4 = skyscraper. */
  massing: 1 | 2 | 3 | 4;
  /**
   * Ceiling on anything built here (m), when something passes overhead. The block's collider
   * stops at the same height, so a car on the deck above never hits a roof it cannot see.
   */
  maxHeight?: number;
}

export interface WallRect extends Rect {
  tag: string;
}

export interface BarrierRect extends Rect {
  tag: string;
  zone: ZoneId;
}

/** A road drawn as a ribbon along a sampled path. */
export interface RibbonDef {
  path: TrackPath;
  /** 'track' gets lane paint and lamps; 'alley' is bare, dim asphalt. */
  kind: 'track' | 'alley';
  /**
   * Height the asphalt is drawn above the path's own `y` (m). Roads that cross at grade get
   * a different lift each, so their slabs never z-fight where they overlap.
   */
  lift?: number;
  /** True when any part of the path is off the ground: drawn as a viaduct, listed in the surface field. */
  elevated?: boolean;
  /** Name for tools and tests. */
  tag?: string;
}

/**
 * A wall segment the car collides with, drawn as a guardrail (highway) or a concrete wall
 * (alleys). The layout's `walls` and these are the same segments. `ay` / `by` are the road
 * heights at the two ends: a rail on a ramp climbs with it.
 */
export interface RailDef {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  ay: number;
  by: number;
  kind: 'rail' | 'wall';
  zone: ZoneId;
}

/**
 * A viaduct support: a pair of columns under the deck at station `s` of an elevated ribbon,
 * from the ground up to `y` (the deck height there). The columns are ground colliders.
 */
export interface PillarDef {
  x: number;
  z: number;
  /** Unit direction of the road overhead. The columns sit either side of it. */
  tx: number;
  tz: number;
  /** Deck height (m). */
  y: number;
  /** Half width of the deck: the columns stand `halfWidth - 1.6` out. */
  halfWidth: number;
  /** True when the columns stand in water: they are drawn down to the bed. */
  wet: boolean;
  zone: ZoneId;
}

/**
 * A fence between two viaduct columns, along the corridor's edge: a wall for the street, so
 * the space under the deck is entered through the bays left open.
 */
export interface FenceDef {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  /** Deck height overhead (m). */
  y: number;
  zone: ZoneId;
}

/** A lattice radio / transmission mast. */
export interface TowerDef {
  x: number;
  z: number;
  height: number;
  /** Footprint at the base (m). */
  base: number;
  kind: 'radio' | 'pylon';
  /** For a pylon: direction of the line it carries. */
  tx?: number;
  tz?: number;
}

/** The big drum of screens on a mast (the reference's circular billboard). */
export interface RingBillboardDef {
  x: number;
  z: number;
  /** Height of the drum's centre (m). */
  y: number;
  radius: number;
  height: number;
}

/** An enclosed bridge between two buildings across a street. */
export interface SkybridgeDef {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  y: number;
  width: number;
  height: number;
  zone: ZoneId;
}

/**
 * A bus stop: the shelter on the pavement, and which way it faces.
 *
 * Axis-aligned, because the collider is: `tx/tz` is the unit direction of the street it
 * serves (always a world axis) and `nx/nz` points from the shelter out at the road, so the
 * shelter's footprint is an exact box rather than a fattened one. The sizes live in
 * `BUS_STOP` so the collider in `cityWorld.ts` and the geometry in `env/transitBuilder.ts`
 * are cut from the same numbers. The buses that call here are not part of the shelter: they
 * drive routes (`ArenaLayout.busRoutes`) and are simulated in `src/sim/buses.ts`.
 */
export interface BusStopDef {
  /** Centre of the shelter (m). */
  x: number;
  z: number;
  /** Height of the pavement it stands on (m). */
  y: number;
  /** Unit direction along the street. */
  tx: number;
  tz: number;
  /** Unit normal from the shelter toward the road. */
  nx: number;
  nz: number;
  zone: ZoneId;
  /** Which route this stop belongs to: picks its name board and its poster. */
  route: number;
}

/**
 * The one description of a bus stop's size. Read by the collider (`cityWorld.ts`) and by the
 * geometry (`env/transitBuilder.ts`), so what you can see and what you can hit are the same
 * box, and by `inBusStop` below, which keeps lamp posts and palm trees out of the shelter.
 */
export const BUS_STOP = {
  /** Shelter: along the street, across it, and to the top of the roof (m). */
  length: 8,
  depth: 2.2,
  height: 3.05,
} as const;

/** True inside a shelter's footprint, grown by `pad`. The bus is on the road; this is not. */
export function inBusStop(plan: CityPlan, x: number, z: number, pad = 0): boolean {
  const stops = plan.busStops;
  if (!stops) return false;
  for (const st of stops) {
    const dx = x - st.x;
    const dz = z - st.z;
    const along = Math.abs(dx * st.tx + dz * st.tz);
    const across = Math.abs(dx * st.nx + dz * st.nz);
    if (along <= BUS_STOP.length / 2 + pad && across <= BUS_STOP.depth / 2 + pad) return true;
  }
  return false;
}

/** Neon route gate spanning the road from (x0, z0) to (x1, z1). */
export interface GateDef {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  height: number;
  left: number;
  right: number;
  /** Skip the "is the pylon on solid ground" check: the caller placed it off the road. */
  trusted?: boolean;
}

export interface BillboardDef {
  /** 0 and 1 are the scrolling holograms; 2 is the BADKALA WANTED ad, which is portrait. */
  variant: 0 | 1 | 2;
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  rotY: number;
  color: number;
}

export interface PylonDef {
  x: number;
  z: number;
  color: number;
}

/** A line across a ribbon: the start/finish line or a checkpoint arch. */
export interface TrackLineDef {
  x: number;
  z: number;
  tx: number;
  tz: number;
  halfWidth: number;
}

export interface CityPlan {
  bounds: Rect;
  /** Which colour script the world is drawn in. Missing = the arena's. */
  palette?: 'arena' | 'bay';
  /**
   * The world's haze, when it wants other than the default linear fog. `exp2` never fully
   * saturates, so a big world keeps some contrast in its skyline all the way to the far clip
   * instead of clamping to flat fog colour at `far`.
   */
  fog?: { near: number; far: number } | { density: number } | null;
  /** The skyscraper district: the perimeter and the skyline behind it grow to match. */
  downtown?: Rect | null;
  /** Axis-aligned drivable rectangles (the test city). */
  roads: RoadRect[];
  /** Path-shaped roads (the circuit and its alleys). */
  ribbons: RibbonDef[];
  rails: RailDef[];
  blocks: BlockRect[];
  /** Perimeter bands packed with buildings. */
  walls: WallRect[];
  /** Axis-aligned free-standing guardrails (the test city's highway shoulders). */
  barriers: BarrierRect[];
  gates: GateDef[];
  billboards: BillboardDef[];
  cableRuns: Array<[number, number, number, number]>;
  pylons: PylonDef[];
  /** Viaduct supports (the big city). */
  pillars?: PillarDef[];
  /** Fences between the supports. */
  fences?: FenceDef[];
  /** Lattice masts: radio towers and power pylons. */
  towers?: TowerDef[];
  /** Power lines strung between consecutive pylons: pairs of tower indices. */
  powerLines?: Array<[number, number]>;
  ringBillboards?: RingBillboardDef[];
  skybridges?: SkybridgeDef[];
  /** Bus stops on the kerb, and the buses parked at them. */
  busStops?: BusStopDef[];
  /** Districts where every street facade is stacked with screens. */
  neonDistricts?: Rect[];
  /**
   * Pavement between a road's edge and the first building, per zone (m), when the world
   * wants it drawn. The blocks already stand that far back; this is only the surface.
   */
  shoulders?: { corporate: number; urban: number; jdm: number; alley: number };
  /** Where that pavement stands proud of the road, when the world raises it. */
  kerbs?: KerbField | null;
  /** Open water. The ground stops at its edge; the quay wall runs along `quayZ`. */
  water?: { rect: Rect; quayZ: number } | null;
  /** Painted drift plaza, when the world has one. */
  plaza: Rect | null;
  /** Where the WANTED board stands (its panel faces local +Z, rotated by rotY). */
  wantedBoard: { x: number; z: number; rotY: number } | null;
  /** Race dressing: the line and the checkpoint arches. */
  startLine: TrackLineDef | null;
  checkpoints: TrackLineDef[];
  zoneAt(x: number, z: number): ZoneId;
  /** True on any drivable surface, grown by `pad`. */
  isRoad(x: number, z: number, pad?: number): boolean;
  /** True inside a block, wall band or barrier footprint, shrunk by `pad`. Props live only here. */
  isSolid(x: number, z: number, pad?: number): boolean;
  /** Height of the walkable surface: sidewalks and the perimeter band are raised. */
  padY(x: number, z: number): number;
}

/** Height of a sidewalk / perimeter slab above the road. */
export const SIDEWALK_Y = 0.22;

/**
 * The raised pavement beside the ground-level roads: where it is, and how high the ground
 * stands there. One object answers both the renderer (which segments to pave, how wide) and
 * the simulation (the height under a point), so a car that mounts the kerb rises by exactly
 * as much as the kerb you can see. Built by `src/world/kerbs.ts`.
 */
export interface KerbField {
  /** Paved width beside `rb` at sample `i` (m). 0 where that stretch is not paved. */
  widthAt(rb: RibbonDef, i: number): number;
  /** True when segment `i` of `rb` carries pavement on `side` (-1 left, +1 right of travel). */
  paved(rb: RibbonDef, i: number, side: number): boolean;
  /**
   * Height of the pavement at (x, z) above the road (m): 0 on the asphalt and past the
   * pavement's outer edge, `KERB_HEIGHT` on it, ramped across the kerb face between. Writes
   * the grade of that face into `out`, which is what tilts a car climbing it.
   */
  heightAt(x: number, z: number, out: { gx: number; gz: number }): number;
}

export function inRect(r: Rect, x: number, z: number, pad = 0): boolean {
  return x >= r.minX - pad && x <= r.maxX + pad && z >= r.minZ - pad && z <= r.maxZ + pad;
}

/** Shared implementation of the three predicates for rectangle-based worlds. */
export function rectPredicates(roads: readonly Rect[], solids: readonly Rect[]): Pick<CityPlan, 'isRoad' | 'isSolid' | 'padY'> {
  return {
    isRoad(x, z, pad = 0) {
      for (const r of roads) if (inRect(r, x, z, pad)) return true;
      return false;
    },
    isSolid(x, z, pad = 0) {
      for (const b of solids) if (inRect(b, x, z, -pad)) return true;
      return false;
    },
    padY(x, z) {
      for (const b of solids) if (inRect(b, x, z)) return SIDEWALK_Y;
      return 0;
    },
  };
}
