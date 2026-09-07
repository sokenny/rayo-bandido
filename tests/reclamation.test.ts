import { describe, expect, it } from 'vitest';
import { builderStats, createBuilders } from '../src/render/scene/env/builders';
import { buildCity } from '../src/render/scene/env/cityBuilder';
import { buildLandmarks } from '../src/render/scene/env/landmarksBuilder';
import { buildProps } from '../src/render/scene/env/propsBuilder';
import { buildTrack } from '../src/render/scene/env/trackBuilder';
import { buildTransit } from '../src/render/scene/env/transitBuilder';
import { buildReclamation, onStreet, OVERHEAD_CLEAR } from '../src/render/scene/env/reclaimBuilder';
import { createReclaimField, isClear, RECLAIM, seedAt } from '../src/render/scene/env/reclaim';
import { buildGroundModule, GROUND_FLOOR, GROUND_MODULES, type GroundFace } from '../src/render/scene/env/groundFloor';
import { GRAFFITI_ART_COUNT, GRAFFITI_CELLS, graffitiArtIndex, graffitiCell, pickPaintCell } from '../src/render/scene/env/graffiti';
import { canopyTree, crookedTree, palm, PLANT_COST, PLANTS, weeds, OVERHANG_CLEAR } from '../src/render/scene/env/plants';
import { makeRng } from '../src/render/scene/env/meshBuilder';
import { createCityWorld } from '../src/world/cityWorld';
import { SIDEWALK_Y } from '../src/world/cityPlan';

/**
 * The reclamation: the deterministic field that says where the city has been let go
 * (`env/reclaim.ts`), the ground-floor modules it swaps in (`env/groundFloor.ts`), the plant
 * kit (`env/plants.ts`) and the graffiti atlas (`env/graffiti.ts`).
 *
 * What these tests pin is the part a screenshot cannot check: that the distribution is
 * pocketed rather than uniform, that it is the same on every machine, that no plant, tag or
 * plinth ever reaches the road, and that nothing is ever painted over a window.
 */

const { plan, layout } = createCityWorld();
const field = createReclaimField(plan);

/** Every builder the city runs, in order, with the reclamation last. */
function buildEverything() {
  const b = createBuilders(plan);
  buildCity(b);
  buildProps(b);
  buildTransit(b);
  buildTrack(b);
  buildLandmarks(b);
  buildReclamation(b);
  return b;
}

describe('the reclamation field', () => {
  it('grows over most of the city and still keeps the pockets legible', () => {
    const hist = [0, 0, 0, 0];
    let n = 0;
    for (let x = plan.bounds.minX; x < plan.bounds.maxX; x += 5) {
      for (let z = plan.bounds.minZ; z < plan.bounds.maxZ; z += 5) {
        hist[field.at(x, z).level]++;
        n++;
      }
    }
    const clean = hist[0] / n;
    const light = hist[1] / n;
    const pockets = (hist[2] + hist[3]) / n;
    const heavy = hist[3] / n;
    // The city as a whole has been let go: nearly all of it grows something.
    expect(clean, `clean: ${(clean * 100).toFixed(1)}%`).toBeLessThan(0.2);
    // But it is not one uniform jungle. Light neglect is the commonest state, the properly
    // feral pockets are a minority, and the worst of them are rarer still — that spread is
    // what stops the greenery reading as a texture laid over the whole map.
    expect(light, `light: ${(light * 100).toFixed(1)}%`).toBeGreaterThan(0.2);
    expect(pockets, `pockets: ${(pockets * 100).toFixed(1)}%`).toBeGreaterThan(0.15);
    expect(pockets, `pockets: ${(pockets * 100).toFixed(1)}%`).toBeLessThan(0.75);
    expect(heavy, `heavy: ${(heavy * 100).toFixed(1)}%`).toBeLessThan(0.3);
    expect(hist[3], 'at least one heavily reclaimed area').toBeGreaterThan(0);
  });

  it('is spatially coherent: neighbours belong to the same pocket', () => {
    // Two points 4 m apart must be far closer in intensity than two random points, or the
    // "pocket" is really per-object noise and nothing will read as one place.
    let near = 0;
    let far = 0;
    let n = 0;
    const rng = makeRng(0x9111);
    for (let i = 0; i < 4000; i++) {
      const x = plan.bounds.minX + rng() * (plan.bounds.maxX - plan.bounds.minX);
      const z = plan.bounds.minZ + rng() * (plan.bounds.maxZ - plan.bounds.minZ);
      const a = field.intensityAt(x, z);
      near += Math.abs(a - field.intensityAt(x + 4, z + 4));
      far += Math.abs(a - field.intensityAt(x + 120, z - 90));
      n++;
    }
    expect(near / n, 'neighbouring intensity difference').toBeLessThan(0.06);
    expect(near / n).toBeLessThan(far / n / 3);
  });

  it('keeps the corporate core cleaner than the old town', () => {
    const mean = (fn: (x: number, z: number) => boolean): number => {
      let sum = 0;
      let n = 0;
      for (let x = plan.bounds.minX; x < plan.bounds.maxX; x += 6) {
        for (let z = plan.bounds.minZ; z < plan.bounds.maxZ; z += 6) {
          if (!fn(x, z)) continue;
          sum += field.intensityAt(x, z);
          n++;
        }
      }
      return n > 0 ? sum / n : 0;
    };
    const corporate = mean((x, z) => plan.zoneAt(x, z) === 'corporate');
    const jdm = mean((x, z) => plan.zoneAt(x, z) === 'jdm');
    expect(corporate, `corporate ${corporate.toFixed(3)} vs old town ${jdm.toFixed(3)}`).toBeLessThan(jdm);
  });

  it('is the same field twice, from the same numbers', () => {
    const other = createReclaimField(plan);
    for (let i = 0; i < 500; i++) {
      const x = -260 + i * 1.03;
      const z = -240 + i * 0.91;
      const a = field.at(x, z);
      const c = other.at(x, z);
      expect(c.intensity).toBe(a.intensity);
      expect(c.level).toBe(a.level);
      expect(c.bigTree).toBe(a.bigTree);
    }
    expect(seedAt(12.3, -45.6, 7)).toBe(seedAt(12.3, -45.6, 7));
    expect(seedAt(12.3, -45.6, 7)).not.toBe(seedAt(12.3, -45.6, 8));
  });

  it('paints and dirties even a maintained street, but never grows anything there', () => {
    // A clean block still has tags on its blank concrete — the floor in `RECLAIM` — while
    // the vegetation is genuinely zero, which is the contrast the whole direction rests on.
    let checked = 0;
    for (let x = plan.bounds.minX; x < plan.bounds.maxX && checked < 200; x += 7) {
      for (let z = plan.bounds.minZ; z < plan.bounds.maxZ && checked < 200; z += 7) {
        const p = field.at(x, z);
        if (p.level !== 0) continue;
        checked++;
        expect(p.graffiti).toBeGreaterThanOrEqual(RECLAIM.graffitiFloor);
        expect(p.decay).toBeGreaterThanOrEqual(RECLAIM.decayFloor);
        // Not zero: the top of the "clean" band shades into light neglect rather than
        // stopping dead at it, so the best-kept street still has the odd weed in a joint.
        expect(p.vegetation).toBeLessThan(0.12);
        expect(p.bigTree).toBe(false);
      }
    }
    expect(checked, 'found maintained blocks to check').toBeGreaterThan(50);
  });
});

describe('the city it produces', () => {
  const b = buildEverything();

  it('is the same city twice', () => {
    const again = buildEverything();
    expect(again.foliage.triangles).toBe(b.foliage.triangles);
    expect(again.bark.triangles).toBe(b.bark.triangles);
    expect(again.decal.triangles).toBe(b.decal.triangles);
    // Not just the counts: the same vertices, in the same order.
    for (let i = 0; i < b.foliage.positions.length; i += 997) {
      expect(again.foliage.positions[i]).toBe(b.foliage.positions[i]);
    }
    for (let i = 0; i < b.decal.positions.length; i += 331) {
      expect(again.decal.positions[i]).toBe(b.decal.positions[i]);
    }
  });

  it('grows a real amount of greenery and paints a real amount of wall', () => {
    expect(b.foliage.triangles, `foliage: ${b.foliage.triangles}`).toBeGreaterThan(6000);
    expect(b.bark.triangles, `bark: ${b.bark.triangles}`).toBeGreaterThan(500);
    // Two triangles a decal, so this is "several hundred pieces of paint and dirt".
    expect(b.decal.triangles / 2, `decals: ${b.decal.triangles / 2}`).toBeGreaterThan(300);
  });

  it('adds one draw call and no new light', () => {
    const { drawCalls } = builderStats(b);
    // Thirteen materials before the reclamation, plus the one decal material it introduces.
    expect(drawCalls, `draw calls: ${drawCalls}`).toBeLessThanOrEqual(20);
  });

  it('never puts a plant, a tag or a plinth on a road', () => {
    // Everything the reclamation draws at street level is either inside a collider the
    // simulation already has, within a hand's breadth of one (ivy on a wall, a tag on a
    // barrier — a car that reaches those has already hit the collider behind them), or high
    // enough over the road that a bus passes under it.
    const check = (name: string, positions: readonly number[]): void => {
      let offending = 0;
      let worst = '';
      for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i];
        const y = positions[i + 1];
        const z = positions[i + 2];
        // Anything over a bus's roof is scenery: a vine off a gantry, a canopy over the kerb.
        if (y > OVERHEAD_CLEAR) continue;
        // A vertex on an elevated deck is metres above the street it crosses; only its own
        // level matters, and `onStreet` is what tells the two apart.
        if (y > 8) continue;
        if (!onStreet({ plan } as never, x, z, -0.35)) continue;
        // Inside — or hugging the face of — a block, wall band or barrier the car cannot
        // reach anyway. The 0.4 m is what a vine on a wall or a tag on a barrier occupies.
        if (plan.isSolid(x, z, -0.4)) continue;
        offending++;
        if (!worst) worst = `${name} vertex at ${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}`;
      }
      expect(offending, worst || `${name} on the road`).toBe(0);
    };
    check('foliage', b.foliage.positions);
    check('bark', b.bark.positions);
    check('decal', b.decal.positions);
  });

  it('leaves the pavement walkable: nothing stands taller than a kerb on the driving line', () => {
    // The colliders are the contract. Nothing the reclamation adds may sit where the layout
    // says a car drives, so the surface height under every road sample is untouched.
    for (const rb of plan.ribbons) {
      for (let i = 0; i < rb.path.samples.length; i += 7) {
        const s = rb.path.samples[i];
        expect(plan.padY(s.x, s.z), `pad height on ${rb.tag ?? 'ribbon'}`).toBeLessThanOrEqual(SIDEWALK_Y + 1e-6);
      }
    }
    // And no collider was added: the reclamation is art only.
    expect(layout.colliders.length).toBe(createCityWorld().layout.colliders.length);
  });
});

describe('ground-floor modules', () => {
  const face = (over: Partial<GroundFace> = {}): GroundFace => ({
    x: 0,
    y: 0,
    z: 0,
    nx: 0,
    nz: 1,
    tx: 1,
    tz: 0,
    width: 14,
    pavement: 1.6,
    maxHeight: 24,
    zone: 'urban',
    ...over,
  });

  it('builds every archetype, and every one offers a blank surface to paint', () => {
    for (const kind of GROUND_MODULES) {
      const b = createBuilders(plan);
      // A module's slabs land in `wall` (they carry the concrete photograph, see
      // `env/wallDetail.ts`) and its metal in `props`; `concrete` is only the odd trim.
      const count = (): number => b.wall.triangles + b.concrete.triangles + b.props.triangles;
      const before = count();
      const anchors = buildGroundModule(b, face(), kind, field.at(0, 0), makeRng(0x4321));
      const drawn = count() - before;
      expect(drawn, `${kind} drew nothing`).toBeGreaterThan(0);
      expect(anchors.graffiti.length, `${kind} offers no graffiti surface`).toBeGreaterThan(0);
      for (const s of anchors.graffiti) {
        expect(s.width, `${kind} graffiti surface width`).toBeGreaterThan(0);
        expect(s.height, `${kind} graffiti surface height`).toBeGreaterThan(0);
      }
      // Every module offers somewhere for weeds; most offer a lip for a vine.
      expect(anchors.ground.length, `${kind} offers no planting strip`).toBeGreaterThan(0);
    }
  });

  it('never reaches past the pavement it stands on', () => {
    // Whatever the module, the front of it stops `kerbClearance` short of the block edge, so
    // it is inside the collider the simulation already has.
    for (const kind of GROUND_MODULES) {
      for (const pavement of [0.6, 1.0, 1.6, 3.4]) {
        const b = createBuilders(plan);
        buildGroundModule(b, face({ pavement }), kind, field.at(0, 0), makeRng(0x99));
        const limit = pavement - GROUND_FLOOR.kerbClearance + 0.2;
        for (const src of [b.concrete.positions, b.props.positions]) {
          for (let i = 0; i < src.length; i += 3) {
            // The face normal is +z, so anything the module drew must stay under `limit`.
            expect(src[i + 2], `${kind} at ${pavement} m of pavement reaches ${src[i + 2].toFixed(2)} m`).toBeLessThanOrEqual(limit);
          }
        }
      }
    }
  });

  it('declines a wall that is too small to be worth dressing', () => {
    const b = createBuilders(plan);
    const anchors = buildGroundModule(b, face({ width: 3 }), 'serviceWall', field.at(0, 0), makeRng(1));
    expect(anchors.graffiti.length).toBe(0);
    expect(b.concrete.triangles).toBe(0);
  });
});

describe('graffiti', () => {
  it('keeps every cell inside its own square of the atlas', () => {
    const all = [...GRAFFITI_CELLS.paint, ...GRAFFITI_CELLS.grime];
    expect(new Set(all).size, 'every atlas cell is used exactly once').toBe(16);
    for (const i of all) {
      const uv = graffitiCell(i);
      expect(uv.u1 - uv.u0).toBeGreaterThan(0);
      expect(uv.v1 - uv.v0).toBeGreaterThan(0);
      expect(uv.u1 - uv.u0).toBeLessThan(0.25);
      expect(uv.v1 - uv.v0).toBeLessThan(0.25);
    }
  });

  it('spreads the art evenly: no piece covers more of the city than another', () => {
    // Nine files across twelve cells: picking a cell rather than a file would hand the three
    // files that own a mirrored second cell twice the wall the other six get.
    const rng = makeRng(0x9e3d);
    const draws = 90_000;
    const perArt = new Array<number>(GRAFFITI_ART_COUNT).fill(0);
    for (let i = 0; i < draws; i++) perArt[graffitiArtIndex(pickPaintCell(rng))]++;
    const share = draws / GRAFFITI_ART_COUNT;
    for (let art = 0; art < GRAFFITI_ART_COUNT; art++) {
      expect(perArt[art], `art ${art} share`).toBeGreaterThan(share * 0.94);
      expect(perArt[art], `art ${art} share`).toBeLessThan(share * 1.06);
    }
  });

  it('never paints over a keep-clear rectangle', () => {
    const zones = [{ across: 0, up: 2, width: 3, height: 2 }];
    expect(isClear(zones, 0, 2, 0.1, 0.1)).toBe(false);
    expect(isClear(zones, 1.4, 2, 0.2, 0.2)).toBe(false);
    expect(isClear(zones, 2.2, 2, 0.4, 0.4)).toBe(true);
    expect(isClear(zones, 0, 3.6, 0.4, 0.4)).toBe(true);
    expect(isClear(undefined, 0, 0, 5, 5)).toBe(true);
  });
});

describe('the plant kit', () => {
  it('draws every archetype into the greenery builders and nothing else', () => {
    for (const [name, fn] of Object.entries(PLANTS)) {
      const b = createBuilders(plan);
      fn(b, 0, 0, 0, makeRng(0x77), { room: 3, canopyRoom: 6, outX: 0, outZ: 1 });
      const grown = b.foliage.triangles + b.bark.triangles;
      expect(grown, `${name} drew nothing`).toBeGreaterThan(0);
      // Nothing in the kit may leak into a material it does not belong to.
      expect(b.concrete.triangles + b.props.triangles + b.neon.triangles + b.glow.triangles, `${name} drew outside the greenery builders`).toBe(0);
    }
  });

  it('keeps a canopy inside its room until it is high enough to be over the traffic', () => {
    // With no `canopyRoom`, nothing may reach past `room` at any height.
    for (const tree of [canopyTree, crookedTree, palm]) {
      for (let seed = 0; seed < 40; seed++) {
        const b = createBuilders(plan);
        tree(b, 0, 0, 0, makeRng(seed * 7919 + 1), { room: 1.2, outX: 0, outZ: 1, scale: 1.4 });
        const p = b.foliage.positions;
        for (let i = 0; i < p.length; i += 3) {
          // `outZ` is +1, so the wall is behind at -z and the plant may only reach +z.
          expect(p[i + 2], `${tree.name} reached ${p[i + 2].toFixed(2)} m with 1.2 m of room`).toBeLessThan(1.2 + 0.9);
        }
      }
    }
  });

  it('only lets a crown out over the road once it clears a bus', () => {
    for (let seed = 0; seed < 60; seed++) {
      const b = createBuilders(plan);
      canopyTree(b, 0, 0, 0, makeRng(seed * 104729 + 3), { room: 1.2, canopyRoom: 4.5, outX: 0, outZ: 1, scale: 1 });
      const p = b.foliage.positions;
      for (let i = 0; i < p.length; i += 3) {
        if (p[i + 2] <= 1.2 + 0.9) continue;
        expect(p[i + 1], `leaf ${p[i + 2].toFixed(2)} m out at only ${p[i + 1].toFixed(2)} m up`).toBeGreaterThan(OVERHANG_CLEAR - 1.9);
      }
    }
  });

  it('costs what the budget table says it does, within a factor of two', () => {
    for (const [name, fn] of Object.entries(PLANTS)) {
      let total = 0;
      const runs = 25;
      for (let i = 0; i < runs; i++) {
        const b = createBuilders(plan);
        fn(b, 0, 0, 0, makeRng(i * 31337 + 11), { room: 3, canopyRoom: 6 });
        total += b.foliage.triangles + b.bark.triangles;
      }
      const mean = total / runs;
      const listed = PLANT_COST[name as keyof typeof PLANTS];
      expect(mean, `${name} averages ${mean.toFixed(0)} triangles, table says ${listed}`).toBeLessThan(listed * 2);
      expect(mean, `${name} averages ${mean.toFixed(0)} triangles, table says ${listed}`).toBeGreaterThan(listed / 2);
    }
  });

  it('grows a weed tuft from almost nothing', () => {
    const b = createBuilders(plan);
    weeds(b, 0, 0, 0, makeRng(5));
    expect(b.foliage.triangles).toBeLessThanOrEqual(12);
    expect(b.foliage.triangles).toBeGreaterThan(0);
  });
});
