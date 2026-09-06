import { MeshBuilder } from './meshBuilder';
import type { CityPlan } from '../../../world/cityPlan';

export { SIDEWALK_Y } from '../../../world/cityPlan';

/**
 * One MeshBuilder per material. Every piece of the city lands in one of these, so the whole
 * environment renders in about a dozen draw calls no matter how much clutter we add.
 *
 * The plan rides along: every builder function reads roads, blocks and the three placement
 * predicates (`isRoad`, `isSolid`, `padY`) from `b.plan`, so the same code dresses the test
 * arena and the racing circuit.
 */
export interface EnvBuilders {
  plan: CityPlan;
  /** Wet asphalt, tinted per zone through vertex colours. */
  road: MeshBuilder;
  /** Road paint: lane lines, plaza circle, hazard chevrons, the start line. */
  lane: MeshBuilder;
  /** Ground plane, sidewalks, curbs, perimeter walls. */
  concrete: MeshBuilder;
  /**
   * Every facade in the city: vertex colour = the building's window tint, `aFacadeCell` =
   * which atlas style the wall samples (`facadeAtlas.ts`). One builder, one material.
   */
  facade: MeshBuilder;
  /** Flat roofs (dark, no windows). */
  roof: MeshBuilder;
  /** Painted metal: barriers, containers, poles, pipes, AC units, roof boxes. */
  props: MeshBuilder;
  /**
   * Leaf mass: palm fronds and hedges. Its own builder rather than a corner of `props`
   * because it samples a leaf texture (`textures/manifest.ts`, slot `nature/foliage`) that
   * has no business on a shipping container. UVs are world-scaled, so a hedge and a frond
   * show leaves of the same size.
   */
  foliage: MeshBuilder;
  /** Palm trunks, sampling the bark texture (slot `nature/bark`) tiled up the shaft. */
  bark: MeshBuilder;
  /** Unlit neon, always on — except the lamp heads tagged with a fault seed. */
  neon: MeshBuilder;
  /** Unlit neon that breathes. */
  neonPulse: MeshBuilder;
  /** Unlit neon that stutters (broken tubes, aircraft beacons). */
  neonFlicker: MeshBuilder;
  /** Additive halos, light pools and wet reflections. */
  glow: MeshBuilder;
  /** Sign panels sampling the neon atlas. */
  signs: MeshBuilder;
  /** Bus-stop and bus panels sampling the transit atlas (`makeTransitAtlas`). */
  transit: MeshBuilder;
  /** The two animated holographic billboards. */
  billA: MeshBuilder;
  billB: MeshBuilder;
  /**
   * Every surface carrying the BADKALA WANTED ad: the portrait city billboards and the
   * poster bay of half the bus shelters, all sampling one texture (`badkalaPoster.ts`).
   */
  badkala: MeshBuilder;
}

/** Metres of leaf texture per tile. Shared by hedges and palm fronds, so a clipped bush and a
 * palm crown are made of leaves the same size — roughly the span of the source photograph. */
export const FOLIAGE_TILE = 1.3;

/** Metres of bark texture per tile up a trunk. A palm's old scar rings are about this far apart. */
export const BARK_TILE = 1.6;

/**
 * Fillet radii (m) the shading suggests on box edges, per material. Bigger, softer objects
 * carry a bigger radius; the bend itself is scaled against each face's own size inside
 * `MeshBuilder.soft`, so a 0.3 m radius rounds a kerb hard and a tower wall barely at all.
 *
 * Only the lit materials are worth setting: the neon, glow, sign and lane builders draw with
 * MeshBasicMaterial, which never reads a normal.
 *
 * Note what this can and cannot reach. The night lighting is a HemisphereLight at ~1.9
 * over a 0.42 key, and a hemisphere's contribution depends on normal.y alone -- so bending a
 * wall normal sideways, around a building's vertical corner, changes nothing at all, and on
 * the walls the key does reach it is worth about a percent. The payoff is on the horizontal
 * edges (roof rims, kerb tops, the tops of props) and on small geometry, where the bend hits
 * its cap: there it moves the shading by a few percent up to a quarter. Rounding a vertical
 * building corner visibly needs real geometry, not a normal.
 */
const SOFT_EDGE = {
  concrete: 0.25,
  facade: 0.4,
  roof: 0.3,
  props: 0.15,
  // A hedge is the softest thing on the street; a trunk is a stiff cylinder faked with four
  // faces, and rounding its vertical corners is exactly the case the note above says a
  // hemisphere light cannot see, so it is left sharp.
  foliage: 0.3,
} as const;

/**
 * Real chamfers (m) cut into box edges, per builder. Off everywhere for now.
 *
 * `MeshBuilder.chamfer` works and is tested, but switching it on for the whole props and
 * concrete builders cost 103k triangles -- the city went from 157k to 259k, up two thirds --
 * for no difference anyone could see in a side-by-side at street level. Most of those boxes
 * are rooftop clutter and block detail seen from tens of metres away, where an 8 cm cut is
 * under a pixel, and the thin street furniture that IS close (lamp posts, railings) has its
 * chamfer clamped to a third of its smallest side anyway.
 *
 * If a chamfer is ever worth paying for it should be turned on around a specific group of
 * close, chunky boxes -- the sidewalk dumpsters and AC units in `propsBuilder` -- with
 * `b.props.chamfer(0.08)` before them and `.chamfer(0)` after, not builder-wide.
 */
const CHAMFER = {
  concrete: 0,
  props: 0,
} as const;

export function createBuilders(plan: CityPlan): EnvBuilders {
  return {
    plan,
    road: new MeshBuilder(true),
    lane: new MeshBuilder(true),
    concrete: new MeshBuilder(true).soft(SOFT_EDGE.concrete).chamfer(CHAMFER.concrete),
    facade: new MeshBuilder(true, false, true).soft(SOFT_EDGE.facade),
    roof: new MeshBuilder(true).soft(SOFT_EDGE.roof),
    props: new MeshBuilder(true).soft(SOFT_EDGE.props).chamfer(CHAMFER.props),
    foliage: new MeshBuilder(true).soft(SOFT_EDGE.foliage),
    bark: new MeshBuilder(true),
    neon: new MeshBuilder(true, true),
    neonPulse: new MeshBuilder(true),
    neonFlicker: new MeshBuilder(true),
    glow: new MeshBuilder(true, true),
    signs: new MeshBuilder(false),
    transit: new MeshBuilder(false),
    billA: new MeshBuilder(false),
    billB: new MeshBuilder(false),
    badkala: new MeshBuilder(false),
  };
}

/** Triangle count and non-empty builder (draw call) count, for the budget test. */
export function builderStats(b: EnvBuilders): { triangles: number; drawCalls: number } {
  let triangles = 0;
  let drawCalls = 0;
  for (const [key, value] of Object.entries(b)) {
    if (key === 'plan') continue;
    const mb = value as MeshBuilder;
    triangles += mb.triangles;
    if (!mb.empty) drawCalls++;
  }
  return { triangles, drawCalls };
}

/**
 * Additive pool of light on the ground (lamp spill, wet neon reflection). `fault` tags the
 * pool with a lamp's fault seed so it strobes with the head that casts it; see `lampFaults`.
 */
export function groundGlow(
  b: EnvBuilders,
  x: number,
  z: number,
  sx: number,
  sz: number,
  color: number,
  strength: number,
  y = 0.03,
  fault = 0,
): void {
  b.glow.color(color, strength).fault(fault);
  b.glow.planeY(x, y, z, sx, sz);
  b.glow.fault(0);
}

/** Additive halo standing in front of a sign or lamp. */
export function halo(
  b: EnvBuilders,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  rotY: number,
  color: number,
  strength: number,
  fault = 0,
): void {
  b.glow.color(color, strength).fault(fault);
  b.glow.panel(x, y, z, w, h, rotY);
  b.glow.fault(0);
}
