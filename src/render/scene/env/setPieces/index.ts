import type { SetPieceSpec } from '../../../../world/setPieces/types';
import type { EnvBuilders } from '../builders';
import { buildParkade } from './parkadeBuilder';
import { buildRoadworks } from './roadworksBuilder';
import { buildStormDrain } from './stormDrainBuilder';

/**
 * SET-PIECES: THE CONTRACT. One set-piece = two files you own, nothing shared to edit.
 *
 *   DATA   `src/world/setPieces/<name>.ts` exports its `SetPieceSpec` (`world/setPieces/types.ts`).
 *          Node-loadable: type imports, or value imports spelt `./x.ts`; never three. It is
 *          already registered (`world/metroSetPieces.ts` → `METRO_SPEC.setPieces`, so the open
 *          world, La Curva and the Rush missions all carry it).
 *   ART    `src/render/scene/env/setPieces/<name>Builder.ts`, called below with that spec.
 *
 * What the spec's fields do (all assembled by `world/cityWorld.ts`, nothing else to wire):
 *   - `lots`       plots touching are deleted whole; the land is held level at y 0 (+6 m pad) and
 *                  kept clear of fences, cables, festoons, street props, sewer vents, micro-scenes.
 *                  `clipLots` the same, but plots are cut back to the edge (a gas station's corner).
 *   - `cut`        {bounds, depthAt} metres below the terrain: the surface field's ground drops by
 *                  it (dry; never water). The TERRAIN is untouched: `plan.padY`, `layout.groundY`,
 *                  draped roads and pavements stay at grade, so a ground road across the cut is
 *                  drawn at grade but has NO physical deck — add a `surfaces` slab for it.
 *   - `surfaces`   {bounds, heightAt → world y | null} slabs in the ceiling contest with the
 *                  elevated ribbons: the highest one ≤ the car's y + 0.6 wins; null = no slab.
 *                  A ramp is a slab whose height rises gently (≤ ~0.6 m per tick's travel).
 *   - `colliders`  ObstacleBox[] / `walls` ObstacleWall[], y-bounded by minY/maxY against the
 *                  car's y (a wall with maxY 0 under a car on a deck at 5 m does not stop it).
 *                  Appended before the buses' walls automatically. Tagged with the piece's tag.
 *   - `groundHoles` rects cut from the ground plane (and from the floor under decks) so a cut is
 *                  visible; you draw its floor and sides. Holes on level ground (inside `lots`).
 *   - `minimapRects` drawn as drivable ground on the minimap.
 * Traffic: nothing generic. If a road through your piece carries traffic, edit `metroSpec.ts`'s
 * traffic lists yourself (the storm drain's five stubs carry none).
 *
 * HEIGHTS. Everything is absolute world y. Inside `lots` the ground is exactly 0. Elsewhere read
 * `b.plan.padY(x, z)` (the terrain, at grade — never the cut); the cut's floor is
 * `b.plan.padY(x, z) - piece.cut.depthAt(x, z)`. In the sim, `layout.surface.sample(x, z, yHint, out)`
 * is the drivable truth (use a low yHint for the floor, a high one for the top slab).
 *
 * DRAWING. Into the shared batches on `b` (`env/builders.ts`), never a new mesh or material: each
 * non-empty batch is one draw call per render chunk, and `tests/metroWorld.test.ts` caps the metro
 * at ≤ 20 batches and < 1.6 M triangles for the whole static city. Useful ones:
 *   `b.wall` textured raw concrete (channel sides, garage slabs, piers) · `b.concrete` flat concrete
 *   trim and ground (floors, kerbs) · `b.road` asphalt (world-space UVs: pass x/ROAD_TILE, z/ROAD_TILE)
 *   · `b.lane` paint · `b.props` painted metal (barriers, rebar, signs' poles, rails) · `b.decal`
 *   grime/graffiti (`graffiti.ts`) · `b.neon`/`b.neonFlicker` unlit light · `b.glow` additive halos
 *   (`halo`, `groundGlow` in `builders.ts`) · `b.foliage`/`b.bark` weeds.
 * Each `MeshBuilder` (`meshBuilder.ts`): set `.color(hex, mul)` (palette in `palette.ts`, `PAL.*`),
 * then `box(cx, cy, cz, sx, sy, sz)`, `orientedBox`, `slopedBox`, `quad` (CCW seen from the front),
 * `planeY`, `panel`, `tube`. `drapedSlab` lays a slab over rolling ground. Register a solid volume
 * with `b.walls.add({minX, maxX, minZ, maxZ, y0, y1})` if screens/signs may hang on it.
 * Count your triangles: a set-piece should stay in the low tens of thousands.
 */
export function buildSetPieces(b: EnvBuilders): void {
  for (const piece of b.plan.setPieces ?? []) {
    const build = BUILDERS[piece.tag];
    if (build) build(b, piece);
  }
}

/** Each set-piece's art, by its tag. */
const BUILDERS: Record<string, (b: EnvBuilders, piece: SetPieceSpec) => void> = {
  roadworks: buildRoadworks,
  parkade: buildParkade,
  'storm-drain': buildStormDrain,
};
