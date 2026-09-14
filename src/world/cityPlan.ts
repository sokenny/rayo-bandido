import type { CarMeetSpec } from './carMeet';
import type { GasStationSpec } from './gasStation';
import type { GarageSpec } from './garage';
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
  /** 'lit' (missing): a ribbon of windows, the Bay's. 'concrete': a bare occupied slab, one dim strip under it. */
  kind?: 'lit' | 'concrete';
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

/**
 * One span of the versus circuit's barrier: the holographic edge of the track
 * (`src/world/circuitSpec.ts`). These are the two edges of the racing ribbon, segment by
 * segment, so the barrier is a pair of continuous curves round the whole lap — it never
 * branches, never stops and never stands across the road.
 *
 * `ay` / `by` are the heights of the road at the two ends, so a span climbs with the on-ramp
 * and rides the viaduct. `nx` / `nz` point in at the track: the lit face and the side the
 * light falls on. `curvature` is the racing line's here, signed, which is what turns a barrier
 * on the outside of a corner amber.
 */
export interface NeonWallDef {
  ax: number;
  az: number;
  ay: number;
  bx: number;
  bz: number;
  by: number;
  nx: number;
  nz: number;
  /** Which side of the racing line this is: -1 left, +1 right. */
  side: number;
  /** Signed curvature of the racing line here (1/m); positive turns right. */
  curvature: number;
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

/**
 * Where a world puts up LED screens and holograms (`env/screenBuilder.ts`): the walls inside
 * `within` are searched for the best-seen faces, and at most this many of each kind go up.
 */
export interface ScreenZoneDef {
  within: Rect;
  /** Boards flat on a facade, heroes included. */
  boards: number;
  /** Of those, the big ones at the end of a long view. */
  heroes: number;
  /** Double-sided blade signs standing out of a street wall. */
  blades: number;
  /** Boards on posts on a low roof. */
  roofBoards: number;
  /** Decks crossing over a road that carry a board on each fascia, facing the traffic below. */
  crossings: number;
  /** Skybridges that carry screens. */
  bridges: number;
  holograms: number;
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
  /** Height of the road under the line (m); omitted on the ground. A gate on a deck stands on it. */
  y?: number;
}

/** Exact occupied boxes, after reserving road and chase-camera corridors. */
export interface CityVolume extends Rect {
  y0: number;
  y1: number;
  role: 'podium' | 'body' | 'wing' | 'top';
}
export interface MegastructureDef {
  tag: string;
  footprint: Rect;
  volumes: CityVolume[];
  /** The stretches of road that run through this building (`PassageDef`), when it planned them. */
  passages?: PassageDef[];
}

/**
 * A stretch of one road that runs INSIDE a building: from station `s0` to `s1` along the
 * ribbon tagged `tag`, under a ceiling `clearance` metres over the road surface (over a
 * climbing ramp the building's underside is stepped and the ceiling follows the road up at
 * this clearance, never lower). `left` / `right` say whether a wall
 * stands at the kerb on that side of the direction of travel. The megastructure planner
 * derives these from the carved volumes, and the passage builder (`env/passageBuilder.ts`)
 * dresses them: soffit, ribs, ducts, strip lamps and their pools. "Enclosed on two sides" in
 * `docs/CITY_V2_BRIEF.md` is a passage with its ceiling and at least one wall.
 */
export interface PassageDef {
  tag: string;
  s0: number;
  s1: number;
  clearance: number;
  left: boolean;
  right: boolean;
  /** How far past the asphalt edge the building's reservation ends (m): where a wall can stand. */
  margin: number;
}

export interface CityPlan {
  megastructures?: MegastructureDef[];
  bounds: Rect;
  /** Which colour script the world is drawn in. Missing = the arena's. */
  palette?: 'arena' | 'bay' | 'stack';
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
  /** Where the LED boards, blades and holograms go up (`ScreenZoneDef`). Missing: nowhere. */
  screens?: ScreenZoneDef[];
  /** The versus circuit's barriers, when this world is hosting a race inside the city. */
  neonWalls?: NeonWallDef[];
  /**
   * Pavement between a road's edge and the first building, per zone (m), when the world
   * wants it drawn. The blocks already stand that far back; this is only the surface.
   */
  shoulders?: { corporate: number; urban: number; jdm: number; alley: number };
  /**
   * The pavement width at a point, in a world whose districts do not all keep the same
   * (Bandido Metro: the Stack's kerb-tight downtown inside the Bay's pavements). Missing:
   * `shoulders` by zone everywhere. `alley` is per world in both cases.
   */
  shoulderAt?(x: number, z: number, zone: ZoneId): number;
  /** Where that pavement stands proud of the road, when the world raises it. */
  kerbs?: KerbField | null;
  /** Open water. The ground stops at its edge; the quay wall runs along `quayZ`. */
  water?: { rect: Rect; quayZ: number } | null;
  /** Painted drift plaza, when the world has one. */
  plaza: Rect | null;
  /** Where the WANTED board stands (its panel faces local +Z, rotated by rotY). */
  wantedBoard: { x: number; z: number; rotY: number } | null;
  /**
   * Where the RAYO RUSH marker may be painted, when this world carries the activity: one site
   * per mission, in mission order. The same list `ArenaLayout.rushSites` gives the rules, so
   * what is drawn and what can be taken up are the same spots by construction.
   *
   * Only ONE of them is ever standing. The art is built at the first and moved by the game as
   * missions are cleared (`RushMarkerVisual.moveTo`), rather than three markers being built and
   * two hidden — a marker the player can see but cannot use is worse than no marker.
   */
  rushMarkers?: Array<{ x: number; z: number; y: number; heading: number; label?: string }> | null;
  /**
   * Where the circuit missions are entered from the street, when this world carries the door
   * (`src/sim/circuitGate.ts`). The same point `ArenaLayout.circuitSite` gives the rules, so
   * the ring that is painted and the ring that answers the key are one spot by construction.
   *
   * Null in the circuit itself, which is what stops the race being run past an invitation to
   * start the race.
   */
  circuitMarker?: { x: number; z: number; y: number; heading: number; label?: string } | null;
  /**
   * The STREET RACE rings (`src/sim/streetGate.ts`), one per event, in worlds that carry them.
   * The same points `ArenaLayout.streetSites` gives the rules. Null in the race worlds.
   */
  streetMarkers?: Array<{ x: number; z: number; y: number; heading: number; label?: string }> | null;
  /** Race dressing: the line and the checkpoint arches. */
  startLine: TrackLineDef | null;
  checkpoints: TrackLineDef[];
  /*
   * The economy knobs. Every one is optional and every builder falls back to the value it
   * was written with, which is Bandido Bay's, so a plan that says nothing is drawn exactly
   * as before. The Stack (`stackSpec.ts`) sets them: it carries half as much elevated road
   * again as the Bay under a tighter ceiling.
   */
  /** Transverse rib spacing under the decks (m). Missing: `elevatedBuilder`'s 10.5. */
  ribSpacing?: number;
  /** 'lean': the concrete edge girders and one conduit under a deck; missing or 'full': two steel girders, a drain and a cable tray as well. */
  deckServices?: 'full' | 'lean';
  /** Street lamp spacing along the ribbons (m), on the ground and on the decks. Missing: 38 and 38. */
  lampSpacing?: { street: number; deck: number };
  /** The reclamation floor (`RECLAIM.baseNeglect`) for this world. Missing: the tuning's. */
  neglect?: number;
  /**
   * Most pavement a block keeps between its collider edge and its buildings (m). Missing:
   * `cityBuilder`'s 3.4, the Bay's. The Stack stands its buildings at the kerb.
   */
  setback?: number;
  /** Multiplier on the rooftop clutter (mechanical blocks, antennas). Missing: 1. */
  roofClutter?: number;
  /** Roads inside buildings, gathered from the megastructures (`PassageDef`). */
  passages?: PassageDef[];
  /** The car meets (`carMeet.ts`): the lots, what stands on them and who is parked there. */
  meets?: CarMeetSpec[];
  /** The gas stations (`gasStation.ts`): their forecourts and what stands on them. */
  gasStations?: GasStationSpec[];
  /** Loco Mustang's garage (`garage.ts`): its lot and the building on it. */
  garage?: GarageSpec;
  /**
   * How the megastructures are dressed. Missing or 'full': the Bay's district — ribs on every
   * face, equipment, ledges. 'lean': the kit's facades only; the passages carry the detail.
   */
  megaDetail?: 'full' | 'lean';
  /** Tags of the elevated ribbons that carry portal frames over their open stretches. */
  portalFrames?: string[];
  /**
   * What the city is built of, as far as the art is concerned. Missing or 'glass': the Bay —
   * glass towers with lit lobbies, neon shopfront bands on every street wall, per-zone rail
   * strips, cold lamps. 'concrete': the Stack's brutalism (Phase 3 of `docs/CITY_V2_BRIEF.md`)
   * — concrete-dominant facade styles, the lower three storeys of every street wall a
   * concrete ground floor of shutters, grilles and doors with the odd lit shopfront, quiet
   * concrete parapets with amber markers for rails, sodium lamps, a red accent placed by hand
   * rather than a strip on every barrier.
   */
  finish?: 'glass' | 'concrete';
  /**
   * The finish at a point, in a world built of more than one (Bandido Metro: the Stack's
   * concrete downtown inside the Bay's glass). Missing: `finish` everywhere. Read through
   * `finishAt` in `env/builders.ts`, never directly.
   */
  finishAt?(x: number, z: number): 'glass' | 'concrete';
  /** The setback at a point, for the same reason. Missing: `setback` everywhere. */
  setbackAt?(x: number, z: number): number;
  /**
   * How much of the dressing a point gets, 0..1: the reclamation, the street lamps, the
   * rooftop clutter, the blade signs, the cables, the kerb-side junk. Missing: all of it,
   * everywhere. Bandido Metro keeps its downtown at 1 and thins the outer city, which is
   * twenty times the Bay's area and cannot carry the Bay's density of everything.
   */
  densityAt?(x: number, z: number): number;
  /**
   * How the static art is batched. Missing: one mesh per material spanning the whole world,
   * never frustum-culled (the Bay, the Stack). `chunk` (m) splits every material's geometry
   * into a grid of that cell, each cell its own mesh, so a world too big to draw whole is
   * drawn only where the camera can see it; `cullDistance` (m) is where the haze has taken
   * everything and a cell is switched off outright.
   */
  render?: { chunk: number; cullDistance: number };
  /**
   * Where the kit's landmark silhouettes stand, by hand: the plot nearest each point takes
   * `kind` (an index into `buildingKit`'s `LANDMARKS`). Missing: `cityBuilder` picks the
   * biggest plots itself.
   */
  landmarkAnchors?: Array<{ x: number; z: number; kind: number }>;
  zoneAt(x: number, z: number): ZoneId;
  /** True on any drivable surface, grown by `pad`. */
  isRoad(x: number, z: number, pad?: number): boolean;
  /** True inside a block, wall band or barrier footprint, shrunk by `pad`. Props live only here. */
  isSolid(x: number, z: number, pad?: number): boolean;
  /**
   * Height of the walkable surface (m). The pavement is flush with the road, so this is 0
   * everywhere at ground level today; it stays the seam a prop asks for its footing, for
   * whatever stands on something raised later.
   */
  padY(x: number, z: number): number;
}

/**
 * The pavement beside the ground-level roads: which stretches are paved, and how wide. Only
 * the renderer asks — the pavement is flush with the asphalt, so there is no height under it
 * for the simulation to read. Built by `src/world/kerbs.ts`.
 */
export interface KerbField {
  /**
   * Paved width beside `rb` on `side`, `t` of the way along segment `i` (m): the band tapers
   * from end to end to follow the blocks behind it. 0 where that stretch is not paved.
   */
  widthAt(rb: RibbonDef, i: number, side: number, t?: number): number;
  /** True when segment `i` of `rb` carries pavement on `side` (-1 left, +1 right of travel). */
  paved(rb: RibbonDef, i: number, side: number): boolean;
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
    padY() {
      return 0;
    },
  };
}
