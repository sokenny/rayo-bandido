import { MeshBuilder } from './meshBuilder';
import { LAMP_SPARKS, lampSparkSeed } from './lampFaults';
import { createReclaimField, type ReclaimField } from './reclaim';
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
  /**
   * Where the city has been let go (`reclaim.ts`). Rides along beside the plan so every
   * builder asks the same field the same question and a vine, the weeds under it and the
   * graffiti beside it all belong to the same pocket. Built once, read everywhere, never
   * touched after the city is generated.
   */
  reclaim: ReclaimField;
  /**
   * Every building wall the city actually built, registered as it is drawn. Anything hung on
   * a facade after the buildings exist — a blade sign, a pipe run, an AC unit — must ask this
   * whether there is a wall where it wants to mount, instead of assuming one at the block's
   * edge. Most archetypes stand well inside their plot and some plots are empty, so the block
   * ledge is not a wall; hanging on it is how things end up floating over the setback.
   */
  walls: WallIndex;
  /** Wet asphalt, tinted per zone through vertex colours. */
  road: MeshBuilder;
  /** Road paint: lane lines, plaza circle, hazard chevrons, the start line. */
  lane: MeshBuilder;
  /** Ground plane, sidewalks, curbs, kerbs, fascias and every other flat concrete trim. */
  concrete: MeshBuilder;
  /**
   * The big blank concrete a car drives past at arm's length: ground-floor modules
   * (`groundFloor.ts`), viaduct skirts and piers (`elevatedBuilder.ts`), alley walls
   * (`trackBuilder.ts`), the kerb-side retaining walls the reclamation puts in
   * (`reclaimBuilder.ts`) and the perimeter wall (`cityBuilder.ts`).
   *
   * Split out of `concrete` for one reason: it samples the concrete photograph
   * (`textures/manifest.ts`, slot `buildings/concrete`) through `wallDetail.ts`, and the
   * sidewalks and kerb tops in `concrete` do not want it — a 4 m tile projected down a
   * pavement reads as blotches, and the trim is small enough that the detail is wasted on it.
   * One extra draw call for every eye-level wall in the city.
   */
  wall: MeshBuilder;
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
   * Leaf mass: canopies, fronds, shrubs, vines and weeds (`plants.ts`). Its own builder rather
   * than a corner of `props` because it samples a leaf texture (`textures/manifest.ts`, slot
   * `nature/foliage`) that has no business on a shipping container. UVs are world-scaled, so
   * a weed tuft and a tree canopy show leaves of the same size.
   */
  foliage: MeshBuilder;
  /** Trunks and branches, sampling the bark texture (slot `nature/bark`) tiled up the shaft. */
  bark: MeshBuilder;
  /**
   * Graffiti and grime: every tag, piece, damp streak, stain and crack in the city, all from
   * one white-on-transparent atlas (`graffiti.ts`) tinted per quad. Alpha-blended without
   * writing depth and offset off the surface behind it, so a decal can neither z-fight the
   * wall it is on nor punch a hole in what is behind it.
   */
  decal: MeshBuilder;
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

/**
 * One built volume, as far as the wall index cares. The buildings register their full
 * `Volume` (`buildingKit.ts`), so the optional fields are there for any city building and
 * absent only for a volume registered by hand: `chamfer` is how far each corner is clipped
 * (the axis walls start that far in) and `bands` is what the walls show at each height, both
 * of which the Moogul's faces need to find a real pane (`render/scene/moogulTrip.ts`).
 */
export interface WallVolume {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  y0: number;
  y1: number;
  chamfer?: number;
  bands?: ReadonlyArray<{ y0: number; y1: number; style: string }>;
}

/** Grid cell (m) the index buckets footprints into. About one building. */
const WALL_CELL = 16;

/**
 * Where the city's walls actually are. Volumes are registered as the buildings are drawn and
 * looked up by the builders that run afterwards.
 */
export class WallIndex {
  private readonly cells = new Map<number, WallVolume[]>();

  private static key(x: number, z: number): number {
    return (Math.floor(x / WALL_CELL) + 2048) * 4096 + Math.floor(z / WALL_CELL) + 2048;
  }

  add(v: WallVolume): void {
    for (let x = v.minX; x <= v.maxX + WALL_CELL; x += WALL_CELL) {
      for (let z = v.minZ; z <= v.maxZ + WALL_CELL; z += WALL_CELL) {
        const k = WallIndex.key(Math.min(x, v.maxX), Math.min(z, v.maxZ));
        const list = this.cells.get(k);
        if (list) list.push(v);
        else this.cells.set(k, [v]);
      }
    }
  }

  /**
   * Every registered volume whose footprint comes within `radius` of (x, z), into `out`
   * (cleared first; each volume once). A handful of cells and a few dozen volumes, so this is
   * for something asked every few seconds, not every frame.
   */
  collect(x: number, z: number, radius: number, out: WallVolume[]): void {
    out.length = 0;
    const n = Math.ceil(radius / WALL_CELL);
    for (let ox = -n; ox <= n; ox++) {
      for (let oz = -n; oz <= n; oz++) {
        const list = this.cells.get(WallIndex.key(x + ox * WALL_CELL, z + oz * WALL_CELL));
        if (!list) continue;
        for (const v of list) {
          if (out.includes(v)) continue;
          const dx = x < v.minX ? v.minX - x : x > v.maxX ? x - v.maxX : 0;
          const dz = z < v.minZ ? v.minZ - z : z > v.maxZ ? z - v.maxZ : 0;
          if (dx * dx + dz * dz <= radius * radius) out.push(v);
        }
      }
    }
  }

  /**
   * True when a wall facing (dx, dz) stands within `reach` metres behind (x, z) at height y —
   * that is, when something mounted there would have a building to hang on.
   */
  faceAt(x: number, y: number, z: number, dx: number, dz: number, reach = 1.6): boolean {
    for (let ox = -1; ox <= 1; ox++) {
      for (let oz = -1; oz <= 1; oz++) {
        const list = this.cells.get(WallIndex.key(x + ox * WALL_CELL, z + oz * WALL_CELL));
        if (!list) continue;
        for (const v of list) {
          if (y < v.y0 - 0.01 || y > v.y1 + 0.01) continue;
          const gap = dx === 1 ? x - v.maxX : dx === -1 ? v.minX - x : dz === 1 ? z - v.maxZ : v.minZ - z;
          if (gap > reach || gap < -0.6) continue;
          const across = dx !== 0 ? z : x;
          const lo = dx !== 0 ? v.minZ : v.minX;
          const hi = dx !== 0 ? v.maxZ : v.maxX;
          if (across >= lo - 0.3 && across <= hi + 0.3) return true;
        }
      }
    }
    return false;
  }
}

/** Metres of leaf texture per tile. Shared by every plant in the kit, so a weed tuft and a
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
  // Shared by `concrete` and `wall`: they are the same material, split only by whether the
  // concrete photograph lands on them.
  concrete: 0.25,
  facade: 0.4,
  roof: 0.3,
  props: 0.15,
  // A canopy is the softest thing on the street; a trunk is a stiff cylinder faked with four
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

/**
 * How far the normals of the two flat-facet families are tilted toward the sky
 * (`MeshBuilder.normalUp`). The night here is a hemisphere light, so `normal.y` is very
 * nearly the only thing that decides how bright a surface comes out: a vertical facet sits
 * at the midpoint between sky and ground, and the sky is worth several times the ground.
 *
 * - LEAVES: a low-poly canopy is a handful of flat facets standing in for thousands of leaves
 *   at every angle. Without the bias its vertical facets read as black holes in the plant.
 * - DECALS: a tag is paint on a wall, but a wall's own normal is horizontal, so an unbiased
 *   decal is as dark as the concrete it is on and the graffiti simply is not there at night.
 *   The bias, with the small emissive on the decal material, is what makes paint read.
 */
const NORMAL_UP = {
  // Enough that leaves are not black, not so much that a canopy loses all its internal
  // shading: the light and dark sides of the same lump are what make it read as a volume.
  foliage: 0.52,
  decal: 0.5,
} as const;

export function createBuilders(plan: CityPlan): EnvBuilders {
  return {
    plan,
    reclaim: createReclaimField(plan),
    walls: new WallIndex(),
    road: new MeshBuilder(true),
    lane: new MeshBuilder(true),
    concrete: new MeshBuilder(true).soft(SOFT_EDGE.concrete).chamfer(CHAMFER.concrete),
    wall: new MeshBuilder(true).soft(SOFT_EDGE.concrete).chamfer(CHAMFER.concrete),
    facade: new MeshBuilder(true, false, true).soft(SOFT_EDGE.facade),
    roof: new MeshBuilder(true).soft(SOFT_EDGE.roof),
    props: new MeshBuilder(true).soft(SOFT_EDGE.props).chamfer(CHAMFER.props),
    foliage: new MeshBuilder(true).soft(SOFT_EDGE.foliage).normalUp(NORMAL_UP.foliage),
    bark: new MeshBuilder(true),
    decal: new MeshBuilder(true).normalUp(NORMAL_UP.decal),
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
    if (key === 'plan' || key === 'reclaim' || key === 'walls') continue;
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

/**
 * The shower of sparks off a faulty lamp head: `LAMP_SPARKS.count` specks clustered at the
 * lens at (x, y, z), each a pair of crossed additive quads carrying its own spark seed.
 *
 * They are built STANDING STILL at the lens and go nowhere on the CPU. The lamp-fault vertex
 * shader throws them: it reads the seed, dims the speck across its life and displaces it along
 * a ballistic arc that ends on the pavement (`lampFaults.ts`). So the whole effect is geometry
 * that already existed in the city mesh, and a burst costs exactly as much as a burst that is
 * not happening.
 *
 * The cluster is tight and the specks are small — the throw is what reads, not the flash — and
 * the scatter is derived from the lamp's own fault seed rather than an rng, so a lamp's sparks
 * are a property of that lamp and every builder that places one gets them for free.
 */
export function lampSparks(
  b: EnvBuilders,
  x: number,
  y: number,
  z: number,
  color: number,
  fault: number,
  strength = 1,
): void {
  for (let i = 0; i < LAMP_SPARKS.count; i++) {
    // A hand's width of scatter around the lens: enough that the flash has a shape, small
    // enough that the specks still read as leaving one point.
    const sx = x + (sparkHash(fault, i * 4 + 1) * 2 - 1) * 0.16;
    const sz = z + (sparkHash(fault, i * 4 + 2) * 2 - 1) * 0.16;
    const sy = y - sparkHash(fault, i * 4 + 3) * 0.12;
    const size = 0.1 + sparkHash(fault, i * 4 + 4) * 0.1;
    b.glow.color(color, strength).fault(lampSparkSeed(fault, i));
    // Crossed, because a glow panel is flat: one speck seen edge-on would simply not be there.
    b.glow.panel(sx, sy, sz, size, size, 0);
    b.glow.panel(sx, sy, sz, size, size, Math.PI / 2);
  }
  b.glow.fault(0);
}

/** Deterministic scatter for one spark off its lamp's fault seed. */
function sparkHash(seed: number, i: number): number {
  const v = Math.sin(seed * 91.7 + i * 17.31) * 43758.5453;
  return v - Math.floor(v);
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
