import type { BillboardDef, CityPlan, MegastructureDef, Rect, RibbonDef, RingBillboardDef, ZoneId } from './cityPlan';
import type { BlockOptions } from './cityGen';
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
  spawn: { x: number; z: number; heading: number };
  /** The free-world activities, in worlds that carry them. */
  rushSites: ActivitySiteSpec[];
  passengerStops: PassengerStopSpec[];
  buhoSite: ActivitySiteSpec | null;
  /** Exponential haze density. Missing: `HAZE.cityDensity`. */
  fogDensity?: number;
  /** Column spacing under the elevated roads (m). Missing: 12, the Bay's. */
  pillarStep?: number;
  /** Fences between the columns: 'most' is two bays in three (the Bay), 'few' one in three. */
  fenceBays?: 'most' | 'few';
  /** The art builders' economy knobs (`CityPlan`): rib spacing, girders, lamp spacing, greenery, setback, roof clutter. Missing: the Bay's. */
  art?: Pick<CityPlan, 'ribSpacing' | 'deckServices' | 'lampSpacing' | 'neglect' | 'setback' | 'roofClutter' | 'megaDetail'>;
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
