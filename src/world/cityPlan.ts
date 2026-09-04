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
  /** Rough height band: 1 = low industrial, 2 = mid-rise, 3 = tower. */
  massing: 1 | 2 | 3;
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
}

/**
 * A wall segment the car collides with, drawn as a guardrail (highway) or a concrete wall
 * (alleys). The layout's `walls` and these are the same segments.
 */
export interface RailDef {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  kind: 'rail' | 'wall';
  zone: ZoneId;
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
  variant: 0 | 1;
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
