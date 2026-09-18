import type { ObstacleBox, ObstacleWall } from '../../core/types';
import type { Rect } from '../cityPlan';

/**
 * A SET-PIECE: a hand-built drivable place dropped into a city (`CitySpec.setPieces`) — a
 * roadworks jump, a collapsed parking garage, a storm drain. Data only and Node-loadable (type
 * imports only here; a set-piece file may import values with `.ts` extensions, never three), so
 * `metroSpec.ts` can carry it and `scripts/metro-preview.mjs` can still load the metro.
 *
 * The assembler (`cityWorld.ts`) turns every field below into the world generically; the art is
 * drawn by the set-piece's own builder (`render/scene/env/setPieces/`). Every field is in world
 * metres, north up (x east, z south). Heights are ABSOLUTE world y. Inside a set-piece's `lots`
 * the ground is held level at y 0 (`terrain.ts`), so there absolute y is height above grade.
 */
export interface SetPieceSpec {
  /** For logs, tests and colliders' tags. */
  tag: string;
  /**
   * Land the set-piece takes WHOLE, like a car meet: every generated plot touching one of these
   * is deleted. Each is also levelled (terrain held at y 0, plus a 6 m pad), paved to its edge by
   * the kerbs, kept free of fences under decks, cables, festoons, street props, sewer vents and
   * micro-scenes (`planLots`).
   */
  lots: Rect[];
  /**
   * Land taken like a gas station's corner: touching plots are CUT BACK to its edge rather than
   * deleted, and the buildings stand on behind it. Levelled and excluded like `lots`. Missing: none.
   */
  clipLots?: Rect[];
  /**
   * Dry ground dug below grade (a channel, a pit, a ramp down): the surface field's ground
   * candidate becomes terrain − `depthAt`. Not water (`layout.waterDepth` never sees it), not
   * the terrain (roads draped over the terrain, `padY` and `layout.groundY` keep the grade). The
   * ground mesh is only cut where `groundHoles` say. Missing: none.
   */
  cut?: SetPieceCut;
  /**
   * Drivable slabs above the (cut) ground: decks, ramps, a bridge over the cut, a garage's floors.
   * They join the ceiling contest exactly like elevated ribbons: of every candidate, the highest
   * one at most `STEP_UP` (0.6 m) above the body wins. Missing: none.
   */
  surfaces?: SetPieceSurface[];
  /** Solid boxes (y-bounded with minY/maxY vs the car's y). Added before the buses' walls. */
  colliders?: ObstacleBox[];
  /** Wall segments (y-bounded the same way): rails, kerbs, a drain's sides. Before the buses' walls. */
  walls?: ObstacleWall[];
  /**
   * Rectangles cut out of the ground plane (`env/cityBuilder.ts`) and out of the under-deck floor
   * (`env/elevatedBuilder.ts`), so a cut is not hidden under the visible ground. The builder must
   * draw whatever is seen in the hole. Keep holes on level ground (inside `lots`): a sloped
   * terrain cell is only skipped when a hole covers it whole. Missing: none.
   */
  groundHoles?: Rect[];
  /** Drawn on the minimap as drivable ground, like a meet's lot. Missing: none. */
  minimapRects?: Rect[];
  /**
   * Ground a set-piece runs UNDER (a tunnel beneath standing plots): every plot touching one keeps
   * its building, but its collider only stops what is above `minY` (world y), so a car in the
   * tunnel below passes under it. Put a `surfaces` slab at grade over the tunnel for everything on
   * top. Missing: none.
   */
  underpasses?: Array<Rect & { minY: number }>;
}

/** A dig below grade. */
export interface SetPieceCut {
  /** Nothing outside this is ever asked: the surface field rejects on it first. */
  bounds: Rect;
  /** Metres below the ground (≥ 0; 0 = untouched). Continuous, or the cars hop a step. */
  depthAt(x: number, z: number): number;
}

/** One drivable slab. */
export interface SetPieceSurface {
  /** Nothing outside this is ever asked. */
  bounds: Rect;
  /**
   * World y of the slab's top at a point, or null where there is none (a hole in a floor, past a
   * deck's edge). Grades come from finite differences of this, so keep it continuous where drivable.
   */
  heightAt(x: number, z: number): number | null;
  /** Add the terrain height to `heightAt` (for a slab on rolling ground outside the lots). Missing: false. */
  onGround?: boolean;
}

/** Every rectangle a set-piece takes from the city: its `lots` and its `clipLots`. */
export function setPieceLots(p: SetPieceSpec): Rect[] {
  return [...p.lots, ...(p.clipLots ?? [])];
}
