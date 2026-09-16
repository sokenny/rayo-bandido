import type { CarMeetSpec } from './carMeet';
import type { GasStationSpec } from './gasStation';
import type { GarageSpec } from './garage';
import type { ParkSpec } from './park';
import type { BillboardDef, CityPlan, MegastructureDef, Rect, RibbonDef, RingBillboardDef, ScreenZoneDef, ZoneId } from './cityPlan';
import type { BlockOptions } from './cityGen';
import type { TerrainSpec } from './terrain';
import type { TrackSpec } from './track';

/**
 * What a free-roam city is made of, as data: the one shape `createCityWorld(spec)` turns into
 * colliders, blocks, viaducts, traffic and art. Bandido Bay (`citySpec.ts`) and The Stack
 * (`stackSpec.ts`) are two of these; the assembler in `cityWorld.ts` knows neither by name.
 *
 * Everything positional is in world metres, north up (x east, z south), as in `track.ts`.
 */

export interface CityRoadSpec {
  tag: string;
  kind: 'track' | 'alley';
  spec: TrackSpec;
}

/** An elevated road: a viaduct, a ramp, a skyway. Its nodes carry the heights. */
export interface ElevatedRoadSpec {
  tag: string;
  spec: TrackSpec;
  /**
   * Height the asphalt is drawn above the samples (m). Ramps merging into a deck overlap it
   * at the same level for their last stretch; a lift keeps the two slabs from z-fighting.
   */
  lift: number;
}

/** Cars lapping one elevated loop, split evenly between its lane files. */
export interface DeckTrafficSpec {
  /** Tag of a closed elevated road in `CitySpec.elevated`. */
  tag: string;
  cars: number;
  /** Offsets from the centreline (m) of the lanes the traffic runs in; mirrored for the oncoming files. */
  lanes: number[];
}

export interface ActivitySiteSpec {
  x: number;
  z: number;
  y: number;
  heading: number;
  label: string;
}

export interface PassengerStopSpec extends ActivitySiteSpec {
  id: string;
  tags: string[];
}

export interface CitySpec {
  /** For logs and tools. */
  name: string;
  bounds: Rect;
  /** Perimeter band thickness (m): packed with towers, and the wall the roads stop at. */
  wallBand: number;
  /**
   * Open water along the south edge, when the city has a shore: land ends at `quayZ` and the
   * perimeter band runs down the three land sides only. Null: towers on all four sides.
   */
  water: { quayZ: number } | null;
  /** District of a point: what the block generator, the kit and the reclamation field ask. */
  zoneOf(x: number, z: number): ZoneId;
  /** Ground roads (y 0), in draw order: each gets its own tiny lift so crossings never z-fight. */
  roads: CityRoadSpec[];
  /** Elevated roads, in the order tools and tests expect them. Every one must actually leave the ground. */
  elevated: ElevatedRoadSpec[];
  blockOptions: BlockOptions;
  /** Buildings a road passes through, planned around the ribbons. Missing: none. */
  planMegastructures?: (ribbons: readonly RibbonDef[]) => MegastructureDef[];
  /** The skyscraper district: the perimeter behind it and the skyline beyond grow to match. */
  downtown: Rect | null;
  /** Districts where every street facade is stacked with screens. */
  neonDistricts: Rect[];
  /** Where the LED boards, blades and holograms go up (`env/screenBuilder.ts`). Missing: nowhere. */
  screens?: ScreenZoneDef[];
  ringBillboards: RingBillboardDef[];
  radioTowers: Array<{ x: number; z: number; height: number; base: number }>;
  /** A transmission line of pylons along `z`, or none. */
  powerLine: { z: number; xs: number[]; height: number; base: number } | null;
  /** Holographic boards on the perimeter walls. A function: the colours come off the live palette. */
  billboards(bounds: Rect): BillboardDef[];
  /** Neon route gates over the boulevards: [street tag, station, left colour, right colour]. */
  gates(): Array<[string, number, number, number]>;
  /** Streets that get enclosed bridges between the buildings either side. */
  skybridgeStreets: string[];
  /** Rectangles of street centrelines the electric cars drive round, clockwise in the right-hand lane. */
  trafficLoops: Array<{ rect: Rect; cars: number }>;
  /** Cars lapping the elevated loops. */
  deckTraffic: DeckTrafficSpec[];
  /** The rectangle cruise mode follows. */
  cruiseLoop: Rect;
  /** Streets with bus shelters, and the rectangles the buses drive. Empty: no bus network. */
  busRoutes: string[];
  busRouteLoops: Rect[];
  /** Least distance between shelters on one route (m). Missing: 130, the Bay's. */
  busStopSpacing?: number;
  spawn: { x: number; z: number; heading: number };
  /** The free-world activities, in worlds that carry them. */
  rushSites: ActivitySiteSpec[];
  passengerStops: PassengerStopSpec[];
  /** Straight-line trip range between those stops (m). Missing: `PASSENGER.offer`, Bandido Metro's. */
  passengerTrip?: { minTrip: number; maxTrip: number };
  buhoSite: ActivitySiteSpec | null;
  /**
   * Car meets (`carMeet.ts`): blocks given up as lots, with the cars and people on them. Each
   * lot clears the blocks it touches and the fences under any deck through it. Missing: none.
   */
  meets?: CarMeetSpec[];
  /**
   * Gas stations (`gasStation.ts`): corners of blocks given up as forecourts. Each lot cuts the
   * plots it touches back to its edge. Missing: none.
   */
  gasStations?: GasStationSpec[];
  /**
   * Loco Mustang's garage (`garage.ts`): a corner of a block given up for a workshop, with its
   * owner out front. Cuts the plots it touches back to its edge, like a station. Missing: none.
   */
  garage?: GarageSpec;
  /**
   * Parks (`park.ts`): land given up for grass, lakes and trees. No blocks are generated on a
   * park's land, the ground is held level there, its lakes sink the surface field, and its
   * walls, podium and people are solid. The park's own roads are ordinary entries of `roads`
   * (and `elevated`, for a bridge). Missing: none.
   */
  parks?: ParkSpec[];
  /**
   * Where the block generator runs, when it is not the whole land inside the wall band: a
   * world with a park across one edge keeps its grid exactly where it was by naming the city's
   * own rectangle here. Missing: everything inside the wall band (and above the quay).
   */
  blockBounds?: Rect;
  /**
   * The lie of the land (`terrain.ts`): the relief the ground follows, and what the world wants
   * kept level besides its lots and elevated corridors. Missing: flat, everything at y 0.
   */
  terrain?: TerrainSpec;
  /** Exponential haze density. Missing: `HAZE.cityDensity`. */
  fogDensity?: number;
  /** Column spacing under the elevated roads (m). Missing: 12, the Bay's. */
  pillarStep?: number;
  /** Fences between the columns: 'most' is two bays in three (the Bay), 'few' one in three. */
  fenceBays?: 'most' | 'few';
  /** The art builders' economy knobs (`CityPlan`): rib spacing, girders, lamp spacing, greenery, setback, roof clutter, what the city is built of. Missing: the Bay's. */
  art?: Pick<CityPlan, 'ribSpacing' | 'deckServices' | 'lampSpacing' | 'neglect' | 'setback' | 'roofClutter' | 'megaDetail' | 'finish'>;
  /** Which colour script the city is drawn in. Missing: 'bay'. */
  palette?: 'bay' | 'stack';
  /**
   * A world built of more than one city (Bandido Metro, `metroSpec.ts`): the finish and the
   * setback at a point, when they are not `art.finish` / `art.setback` everywhere.
   */
  finishAt?(x: number, z: number): 'glass' | 'concrete';
  setbackAt?(x: number, z: number): number;
  /** How much of the dressing a point gets, 0..1 (`CityPlan.densityAt`). Missing: all of it. */
  densityAt?(x: number, z: number): number;
  /**
   * Skybridges chosen by more than one rule: each set is its own streets and its own tiers
   * (`skybridges`), so a world can bridge its downtown the Stack's way and its avenues the
   * Bay's. Missing: one set, `skybridgeStreets` with `skybridges`.
   */
  skybridgeSets?: Array<{ streets: string[]; style?: CitySpec['skybridges']; within?: Rect }>;
  /** How the static art is batched (`CityPlan.render`). Missing: whole-world meshes. */
  render?: { chunk: number; cullDistance: number };
  /** Elevated ribbons whose open stretches carry portal frames. Missing: none. */
  portalFrames?: string[];
  /** Hand-placed landmark silhouettes (`CityPlan.landmarkAnchors`). Missing: the builder picks its own. */
  landmarks?: Array<{ x: number; z: number; kind: number }>;
  /**
   * How the skybridges over `skybridgeStreets` are chosen. `heights`: the tiers a bridge may
   * sit at (m); `concreteShare`: the fraction that are bare concrete rather than lit;
   * `max`: how many at most; `step`: stations between attempts (m). Missing: the Bay's rule
   * (two heights by district, all lit, 22 at most, every 55 m).
   */
  skybridges?: { heights: number[]; concreteShare: number; max: number; step: number };
}
