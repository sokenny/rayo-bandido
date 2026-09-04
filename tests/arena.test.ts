import { describe, expect, it } from 'vitest';
import {
  ARENA_BARRIERS,
  ARENA_BLOCKS,
  ARENA_ROADS,
  ARENA_WALLS,
  createArenaLayout,
} from '../src/world/arenaLayout';
import { builderStats, createBuilders } from '../src/render/scene/env/builders';
import { buildCity } from '../src/render/scene/env/cityBuilder';
import { buildProps } from '../src/render/scene/env/propsBuilder';
import { buildTrack } from '../src/render/scene/env/trackBuilder';
import { createArenaWorld } from '../src/world/arenaWorld';
import { createRaceWorld } from '../src/world/raceWorld';
import type { ObstacleBox } from '../src/core/types';
import { VEHICLE } from '../src/config/tuning';

/**
 * The arena is the one place where art and simulation share a source of truth. These tests
 * defend that contract: nothing the player can spawn on, patrol through or drive at may sit
 * inside a collider, and the merged environment must stay inside its performance budget.
 */

const layout = createArenaLayout();
const { plan } = createArenaWorld();
const { isRoad, isSolid } = plan;

/** Distance from a point to an axis-aligned box, 0 when inside. */
function distanceToBox(b: ObstacleBox, x: number, z: number): number {
  const dx = Math.max(b.minX - x, 0, x - b.maxX);
  const dz = Math.max(b.minZ - z, 0, z - b.maxZ);
  return Math.hypot(dx, dz);
}

function nearestCollider(x: number, z: number): { dist: number; tag: string } {
  let dist = Infinity;
  let tag = '';
  for (const c of layout.colliders) {
    const d = distanceToBox(c, x, z);
    if (d < dist) {
      dist = d;
      tag = c.tag ?? '';
    }
  }
  return { dist, tag };
}

function inBounds(x: number, z: number): boolean {
  const b = layout.bounds;
  return x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ;
}

/** Every point the sim ever puts a car on. */
function drivablePoints(): Array<{ x: number; z: number; what: string }> {
  const pts: Array<{ x: number; z: number; what: string }> = [
    { x: layout.playerSpawn.x, z: layout.playerSpawn.z, what: 'playerSpawn' },
  ];
  layout.targetSpawns.forEach((s, i) => pts.push({ x: s.x, z: s.z, what: `targetSpawn[${i}]` }));
  layout.targetPatrols.forEach((loop, i) =>
    loop.forEach((p, j) => pts.push({ x: p.x, z: p.z, what: `patrol[${i}][${j}]` })),
  );
  return pts;
}

describe('arena layout', () => {
  it('is compact: no larger than 280 x 280 m', () => {
    const b = layout.bounds;
    expect(b.maxX - b.minX).toBeLessThanOrEqual(280);
    expect(b.maxZ - b.minZ).toBeLessThanOrEqual(280);
    expect(b.maxX - b.minX).toBeGreaterThanOrEqual(180);
  });

  it('every collider is a well-formed box inside the bounds', () => {
    expect(layout.colliders.length).toBeGreaterThan(8);
    for (const c of layout.colliders) {
      expect(c.minX, `${c.tag} minX < maxX`).toBeLessThan(c.maxX);
      expect(c.minZ, `${c.tag} minZ < maxZ`).toBeLessThan(c.maxZ);
      expect(c.minX).toBeGreaterThanOrEqual(layout.bounds.minX);
      expect(c.maxX).toBeLessThanOrEqual(layout.bounds.maxX);
      expect(c.minZ).toBeGreaterThanOrEqual(layout.bounds.minZ);
      expect(c.maxZ).toBeLessThanOrEqual(layout.bounds.maxZ);
    }
  });

  it('offers at least six target spawns, each with a patrol loop', () => {
    expect(layout.targetSpawns.length).toBeGreaterThanOrEqual(6);
    expect(layout.targetPatrols.length).toBe(layout.targetSpawns.length);
    for (let i = 0; i < layout.targetPatrols.length; i++) {
      const loop = layout.targetPatrols[i];
      expect(loop.length, `patrol ${i} has 3..6 waypoints`).toBeGreaterThanOrEqual(3);
      expect(loop.length).toBeLessThanOrEqual(6);
    }
  });

  it('starts every target on the first waypoint of its own loop', () => {
    for (let i = 0; i < layout.targetSpawns.length; i++) {
      const s = layout.targetSpawns[i];
      const w = layout.targetPatrols[i][0];
      expect(Math.hypot(s.x - w.x, s.z - w.z), `target ${i} spawns on patrol[0]`).toBeLessThan(0.001);
    }
  });

  it('keeps every spawn and waypoint inside the bounds and clear of colliders', () => {
    for (const p of drivablePoints()) {
      expect(inBounds(p.x, p.z), `${p.what} inside bounds`).toBe(true);
      const near = nearestCollider(p.x, p.z);
      expect(near.dist, `${p.what} is ${near.dist.toFixed(2)} m from ${near.tag}`).toBeGreaterThanOrEqual(2.5);
    }
  });

  it('places every spawn and waypoint on a road', () => {
    for (const p of drivablePoints()) {
      expect(isRoad(p.x, p.z), `${p.what} is on a road`).toBe(true);
    }
  });

  it('never runs a patrol leg through a collider', () => {
    for (let i = 0; i < layout.targetPatrols.length; i++) {
      const loop = layout.targetPatrols[i];
      for (let j = 0; j < loop.length; j++) {
        const a = loop[j];
        const b = loop[(j + 1) % loop.length];
        const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 2) + 1;
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          const x = a.x + (b.x - a.x) * t;
          const z = a.z + (b.z - a.z) * t;
          const near = nearestCollider(x, z);
          expect(near.dist, `patrol ${i} leg ${j} passes ${near.dist.toFixed(2)} m from ${near.tag}`).toBeGreaterThanOrEqual(2.5);
        }
      }
    }
  });

  it('gives the player a long straight to launch into', () => {
    const s = layout.playerSpawn;
    // heading 0 faces -Z.
    expect(s.heading).toBe(0);
    let clear = 0;
    for (let d = 0; d < 260; d += 0.5) {
      const z = s.z - d;
      if (!inBounds(s.x, z)) break;
      if (nearestCollider(s.x, z).dist <= VEHICLE.collisionRadius + 0.5) break;
      clear = d;
    }
    expect(clear, 'clear straight ahead of the player spawn').toBeGreaterThan(180);
  });

  it('never puts a collider on a road', () => {
    for (const road of ARENA_ROADS) {
      const step = 2;
      for (let x = road.minX + 1; x < road.maxX; x += step) {
        for (let z = road.minZ + 1; z < road.maxZ; z += step) {
          expect(isSolid(x, z), `road ${road.tag} is clear at (${x}, ${z})`).toBe(false);
        }
      }
    }
  });

  it('describes the same world to the renderer and to the simulation', () => {
    // Every visual rectangle exported for the renderer must exist as a collider.
    const tags = new Set(layout.colliders.map((c) => c.tag));
    for (const r of [...ARENA_BLOCKS, ...ARENA_WALLS, ...ARENA_BARRIERS]) expect(tags.has(r.tag)).toBe(true);
    expect(layout.colliders.length).toBe(ARENA_BLOCKS.length + ARENA_WALLS.length + ARENA_BARRIERS.length);
  });

  it('has an open plaza big enough to drift in', () => {
    const plaza = ARENA_ROADS.find((r) => r.tag === 'plaza');
    expect(plaza).toBeDefined();
    if (!plaza) return;
    expect(plaza.maxX - plaza.minX).toBeGreaterThanOrEqual(45);
    expect(plaza.maxZ - plaza.minZ).toBeGreaterThanOrEqual(45);
    for (let x = plaza.minX; x <= plaza.maxX; x += 2.5) {
      for (let z = plaza.minZ; z <= plaza.maxZ; z += 2.5) {
        expect(isSolid(x, z)).toBe(false);
      }
    }
  });

  it('keeps roads between 16 and 20 m wide', () => {
    for (const r of ARENA_ROADS) {
      if (r.axis === 'open' || r.tag === 'alley-jdm') continue;
      const w = r.axis === 'z' ? r.maxX - r.minX : r.maxZ - r.minZ;
      expect(w, `${r.tag} width`).toBeGreaterThanOrEqual(16);
      expect(w, `${r.tag} width`).toBeLessThanOrEqual(20);
    }
  });
});

describe('environment budget', () => {
  it('builds the whole arena inside the triangle and draw-call budget', () => {
    const b = createBuilders(plan);
    buildCity(b);
    buildProps(b);
    buildTrack(b);
    const { triangles, drawCalls } = builderStats(b);
    expect(triangles, `environment triangles: ${triangles}`).toBeLessThan(100000);
    expect(triangles, 'the arena is not empty').toBeGreaterThan(4000);
    // Plus the background pass; still far below the 60 draw call ceiling.
    expect(drawCalls, `environment draw calls: ${drawCalls}`).toBeLessThanOrEqual(20);
  });

  it('builds the whole circuit inside the triangle and draw-call budget', () => {
    const race = createRaceWorld();
    const b = createBuilders(race.plan);
    buildCity(b);
    buildProps(b);
    buildTrack(b);
    const { triangles, drawCalls } = builderStats(b);
    expect(triangles, `circuit triangles: ${triangles}`).toBeLessThan(150000);
    expect(triangles, 'the circuit is not empty').toBeGreaterThan(10000);
    expect(drawCalls, `circuit draw calls: ${drawCalls}`).toBeLessThanOrEqual(20);
  });
});
