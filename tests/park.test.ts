import { describe, expect, it } from 'vitest';
import type { SurfaceSample } from '../src/core/types';
import { VEHICLE } from '../src/config/tuning';
import { builderStats, createBuilders } from '../src/render/scene/env/builders';
import { buildParks } from '../src/render/scene/env/parkBuilder';
import { inRect } from '../src/world/cityPlan';
import { createOpenWorld } from '../src/world/openWorld';
import { METRO_SPEC } from '../src/world/metroSpec';
import { METRO_PARK, PARK_LAND, PARK_LAYBYS, PARK_ROADS, PARK_SOUTH } from '../src/world/metroPark';
import { insideContour, LAKE, lakeFieldOf, signedArea, triangulate } from '../src/world/park';
import { aimAlong, buildRoadGraph, createRouteAim, routeTo } from '../src/world/roadGraph';
import { createProjection, isOnPath, projectOntoPath } from '../src/world/track';

/**
 * The park (`src/world/park.ts`, `src/world/metroPark.ts`): the north edge of Bandido Metro
 * given up for lakes, trees and a loop road. What has to hold: the city's own grid is where
 * it was; the park's roads stay on the land and out of the water except on the bridge; the
 * lake is a hole the car can fall into and be pulled out of, never a wall; everything solid
 * in it is off the roads; and it is reachable from the city over the road graph.
 */
const world = createOpenWorld();
const { layout, plan } = world;
const park = plan.parks![0];
const field = lakeFieldOf(park);
const PROJ = createProjection();
const SAMPLE: SurfaceSample = { y: 0, gx: 0, gz: 0 };
const loop = plan.ribbons.find((rb) => rb.tag === 'park-loop')!;
const bridge = plan.ribbons.find((rb) => rb.tag === 'park-bridge')!;
const parkGround = plan.ribbons.filter((rb) => PARK_ROADS.some((r) => r.tag === rb.tag));

describe('the park is land the city gave up, not city', () => {
  it('extends the map north and keeps the grid exactly where it was', () => {
    expect(layout.bounds.minZ).toBe(-1150);
    expect(plan.parks!.length).toBe(1);
    expect(park.land).toEqual(PARK_LAND);
    // No block on the park's land, and the blocks north of st-n3 still end where the old wall was.
    for (const blk of plan.blocks) expect(blk.maxZ > PARK_LAND.minZ && blk.minZ < PARK_LAND.maxZ && blk.maxX > PARK_LAND.minX && blk.minX < PARK_LAND.maxX, blk.tag).toBe(false);
    expect(plan.blocks.some((blk) => blk.minZ < -630)).toBe(true);
    expect(METRO_SPEC.blockBounds!.minZ).toBe(-638);
    // The perimeter is three bands, the north one beyond the park.
    expect(plan.walls.find((w) => w.tag === 'wall-n')!.maxZ).toBe(-1138);
  });

  it('is level everywhere, lakes aside', () => {
    for (let x = PARK_LAND.minX; x <= PARK_LAND.maxX; x += 25) {
      for (let z = PARK_LAND.minZ; z <= PARK_LAND.maxZ; z += 25) expect(layout.groundY!(x, z), `(${x}, ${z})`).toBe(0);
    }
  });

  it('keeps every park road on the land, off the water, and the bridge over the strait', () => {
    for (const rb of parkGround) {
      for (const s of rb.path.samples) {
        expect(inRect(PARK_LAND, s.x, s.z, 12), `${rb.tag} at (${s.x.toFixed(0)}, ${s.z.toFixed(0)})`).toBe(true);
        if (s.z < PARK_SOUTH) expect(field.depthAt(s.x, s.z), `${rb.tag} at (${s.x.toFixed(0)}, ${s.z.toFixed(0)}) is in the water`).toBe(0);
      }
    }
    // The bridge: its feet on land, its middle over water it clears.
    const s = bridge.path.samples;
    expect(field.depthAt(s[0].x, s[0].z)).toBe(0);
    expect(field.depthAt(s[s.length - 1].x, s[s.length - 1].z)).toBe(0);
    const mid = s[Math.floor(s.length / 2)];
    expect(field.depthAt(mid.x, mid.z)).toBeGreaterThan(1);
    expect(mid.y).toBeGreaterThan(2);
    expect(Math.max(...s.map((q) => q.y))).toBeCloseTo(2.4, 1);
  });

  it('joins the city by three avenues and the cross road, each crossing the loop', () => {
    for (const tag of ['st-w3', 'st-e3', 'av-central', 'park-cross-s', 'park-cross-n']) {
      const rb = plan.ribbons.find((r) => r.tag === tag)!;
      const hits = rb.path.samples.filter((s) => isOnPath(loop.path, s.x, s.z, 0));
      expect(hits.length, `${tag} never meets the loop`).toBeGreaterThan(0);
      // Across it, not up to it: a sample on the far side.
      const first = rb.path.samples[0];
      projectOntoPath(loop.path, first.x, first.z, PROJ);
      expect(PROJ.dist, `${tag} stops at the loop`).toBeGreaterThan(PROJ.halfWidth);
    }
    // The cross road starts inside the central avenue's last metres.
    const cross = plan.ribbons.find((r) => r.tag === 'park-cross-s')!;
    const avenue = plan.ribbons.find((r) => r.tag === 'av-central')!;
    projectOntoPath(avenue.path, cross.path.samples[0].x, cross.path.samples[0].z, PROJ);
    expect(PROJ.dist).toBeLessThan(PROJ.halfWidth);
  });

  it('can be driven to from the spawn over the road graph, and round', () => {
    const graph = buildRoadGraph(layout.roadNetwork!);
    const aim = createRouteAim();
    for (const target of [PARK_LAYBYS[0], PARK_LAYBYS[1], { x: -45, z: -960 }]) {
      const route = routeTo(graph, target);
      expect(route, `no route to (${target.x}, ${target.z})`).not.toBeNull();
      expect(aimAlong(graph, route!, layout.playerSpawn.x, layout.playerSpawn.z, 30, aim), `no way from the spawn to (${target.x}, ${target.z})`).toBe(true);
      expect(aim.remaining).toBeGreaterThan(1000);
      expect(Number.isFinite(aim.remaining)).toBe(true);
    }
  });

  it('laps traffic round the loop', () => {
    let onLoop = 0;
    for (const s of layout.targetSpawns) {
      projectOntoPath(loop.path, s.x, s.z, PROJ);
      if (PROJ.dist <= PROJ.halfWidth) onLoop++;
    }
    expect(onLoop).toBe(8);
  });
});

describe('the lake', () => {
  it('is a bowl: dry at the shore, the bed in the middle, the islands dry again', () => {
    expect(field.depthAt(-250, -900)).toBeCloseTo(LAKE.depth, 4);
    expect(field.depthAt(120, -870)).toBeCloseTo(LAKE.depth, 4);
    expect(field.depthAt(-45, -877)).toBeGreaterThan(1);
    expect(field.depthAt(-300, -955)).toBe(0);
    expect(field.depthAt(-500, -900)).toBe(0);
    expect(field.depthAt(-250, -700)).toBe(0);
    // The bank falls at the slope the constants say.
    const shore = park.lakes[0].shore;
    expect(signedArea(shore)).toBeLessThan(0);
    expect(insideContour(shore, -250, -900)).toBe(true);
    expect(insideContour(shore, -250, -700)).toBe(false);
    // Every island is inside the shore, and its triangles are all there.
    for (const isl of park.lakes[0].islands) for (const p of isl) expect(insideContour(shore, p.x, p.z)).toBe(true);
    expect(triangulate(shore).length).toBe((shore.length - 2) * 3);
  });

  it('sinks the surface field: a car by the shore rolls in, and the game knows it is swimming', () => {
    layout.surface!.sample(-250, -900, 0, SAMPLE);
    expect(SAMPLE.y).toBeCloseTo(-LAKE.depth, 3);
    // Down the bank from the south shore: somewhere between dry and the bed, sloping toward the middle.
    let onBank = 0;
    for (let z = -796; z >= -812; z -= 0.5) {
      layout.surface!.sample(-250, z, 0, SAMPLE);
      if (SAMPLE.y < -0.05 && SAMPLE.y > -LAKE.depth + 0.05) {
        onBank++;
        expect(SAMPLE.gz, `no slope at z ${z}`).not.toBe(0);
      }
    }
    expect(onBank).toBeGreaterThan(4);
    layout.surface!.sample(-250, -700, 0, SAMPLE);
    expect(SAMPLE.y).toBe(0);
    // On the bridge, the deck: over the strait the car is carried, not dropped.
    const mid = bridge.path.samples[Math.floor(bridge.path.samples.length / 2)];
    layout.surface!.sample(mid.x, mid.z, mid.y, SAMPLE);
    expect(SAMPLE.y).toBeCloseTo(mid.y, 3);
    expect(layout.waterDepth).toBeDefined();
    expect(layout.waterDepth!(-250, -900)).toBeGreaterThan(LAKE.swim);
    expect(layout.waterDepth!(-250, -700)).toBe(0);
    // Not a wall: nothing solid stands along the shore but the parapets the spec names.
    const shoreTags = layout.walls.filter((w) => w.tag === 'quay' && w.az < 0);
    expect(shoreTags.length).toBe(0);
  });

  it('is on the minimap', () => {
    expect(layout.minimap.lakes!.length).toBe(1);
    expect(layout.minimap.lakes![0].length).toBe(park.lakes[0].shore.length);
  });
});

describe('what stands in the park', () => {
  it('puts every person, prop, lamp and bench on dry land, off the roads', () => {
    const things: Array<{ x: number; z: number; what: string }> = [];
    for (const e of park.encounters) {
      for (const p of e.people) things.push({ x: p.x, z: p.z, what: `${e.id}/${p.name}` });
      for (const p of e.props) things.push({ x: p.x, z: p.z, what: `${e.id}/${p.kind}` });
    }
    for (const f of park.furniture) things.push({ x: f.x, z: f.z, what: `furniture/${f.kind}` });
    for (const l of park.lamps) things.push({ x: l.x, z: l.z, what: 'lamp' });
    for (const t of things) {
      expect(inRect(PARK_LAND, t.x, t.z), `${t.what} is off the land`).toBe(true);
      expect(field.inWater(t.x, t.z), `${t.what} is in the water`).toBe(false);
      for (const rb of plan.ribbons) expect(isOnPath(rb.path, t.x, t.z, 0.4), `${t.what} is on ${rb.tag}`).toBe(false);
    }
    // Four meeting places, eleven people, each with a name; the two in the trade are named.
    expect(park.encounters.length).toBe(4);
    expect(park.encounters.flatMap((e) => e.people).length).toBe(11);
    for (const p of park.encounters.flatMap((e) => e.people)) expect(p.name.length).toBeGreaterThan(1);
    expect(park.encounters.find((e) => e.id === 'bajo-los-arboles')!.people.map((p) => p.name)).toContain('Mili');
  });

  it('is solid where it is drawn and clear of every lane', () => {
    const tags = new Set([...layout.colliders, ...layout.walls].map((c) => c.tag));
    for (const t of ['park-wall', 'planetarium', 'park-person', 'park-bench', 'footbridge']) expect(tags.has(t), t).toBe(true);
    const r = VEHICLE.collisionRadius;
    const parkSolids = [...layout.colliders.filter((c) => c.tag?.startsWith('park') || c.tag === 'footbridge' || c.tag === 'planetarium')];
    const parkWalls = layout.walls.filter((w) => w.tag?.startsWith('park') || w.tag === 'footbridge' || w.tag === 'planetarium');
    expect(parkSolids.length + parkWalls.length).toBeGreaterThan(40);
    for (const rb of plan.ribbons) {
      for (const s of rb.path.samples) {
        for (const side of [-1, 1]) {
          const x = s.x + -s.tz * s.halfWidth * side;
          const z = s.z + s.tx * s.halfWidth * side;
          for (const c of parkSolids) {
            const dx = Math.max(c.minX - x, 0, x - c.maxX);
            const dz = Math.max(c.minZ - z, 0, z - c.maxZ);
            expect(Math.hypot(dx, dz), `${c.tag} at (${c.minX.toFixed(0)}, ${c.minZ.toFixed(0)}) touches ${rb.tag}`).toBeGreaterThanOrEqual(r);
          }
          for (const w of parkWalls) {
            const ex = w.bx - w.ax;
            const ez = w.bz - w.az;
            const len2 = ex * ex + ez * ez;
            let t = len2 > 0 ? ((x - w.ax) * ex + (z - w.az) * ez) / len2 : 0;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            expect(Math.hypot(w.ax + ex * t - x, w.az + ez * t - z), `${w.tag} at (${w.ax.toFixed(0)}, ${w.az.toFixed(0)}) touches ${rb.tag}`).toBeGreaterThanOrEqual(r);
          }
        }
      }
    }
  });

  it('leaves the ways in open through the south wall', () => {
    const wall = layout.walls.filter((w) => w.tag === 'park-wall' && Math.abs(w.az - (PARK_SOUTH - 1)) < 0.01);
    expect(wall.length).toBe(4);
    for (const x of [-480, -60, 480]) expect(wall.some((w) => x > Math.min(w.ax, w.bx) && x < Math.max(w.ax, w.bx)), `the wall crosses x ${x}`).toBe(false);
  });

  it('draws inside its budget, in the city\'s own batches', () => {
    const b = createBuilders(plan);
    buildParks(b);
    const { triangles, drawCalls } = builderStats(b);
    expect(triangles).toBeGreaterThan(80_000);
    expect(triangles).toBeLessThan(420_000);
    expect(drawCalls).toBeLessThanOrEqual(11);
    // Real trees: the greenery is most of it.
    expect(b.foliage.triangles + b.bark.triangles).toBeGreaterThan(triangles * 0.5);
  });

  it('describes the same park the spec does', () => {
    expect(park.tag).toBe(METRO_PARK.tag);
    expect(park.planetarium!.label).toBe('PLANETARIO');
  });
});
