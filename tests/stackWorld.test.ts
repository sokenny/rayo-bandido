import { describe, expect, it } from 'vitest';
import type { ArenaLayout, SurfaceSample } from '../src/core/types';
import { SIM_STEP, VEHICLE } from '../src/config/tuning';
import { createPlayerCommand } from '../src/core/input/keyboard';
import { createCruiseController } from '../src/sim/cruise';
import { createInitialGameState, stepGame } from '../src/sim/gameState';
import { builderStats, createBuilders } from '../src/render/scene/env/builders';
import { buildCity } from '../src/render/scene/env/cityBuilder';
import { buildLandmarks } from '../src/render/scene/env/landmarksBuilder';
import { buildProps } from '../src/render/scene/env/propsBuilder';
import { buildTrack } from '../src/render/scene/env/trackBuilder';
import { buildTransit } from '../src/render/scene/env/transitBuilder';
import { buildReclamation } from '../src/render/scene/env/reclaimBuilder';
import { createCityWorld } from '../src/world/cityWorld';
import { cityRecovery } from '../src/world/cityRecovery';
import type { RibbonDef } from '../src/world/cityPlan';
import { STACK_DECK_TRAFFIC, STACK_ELEVATED, STACK_L1_Y, STACK_L2_Y, STACK_L3_Y, STACK_SPEC, STACK_TRAFFIC_LOOPS } from '../src/world/stackSpec';
import { createProjection, maxGrade, offsetAtStation, projectOntoPath } from '../src/world/track';

/**
 * The Stack (`src/world/stackSpec.ts`) through the same assembler as Bandido Bay. These are
 * `tests/cityWorld.test.ts`'s rules — clear at its own level, drivable underneath, a car's
 * height between crossing decks, climbable grades, pillars off the streets, traffic on a road
 * at its own height, the level kept — plus the ones the four-level brief adds
 * (`docs/CITY_V2_BRIEF.md`): no dead ends, every ramp a merge and not a T, every direction of
 * every loop with a way up and a way down, six stacked crossings, and the art budget.
 */
const { layout, plan } = createCityWorld(STACK_SPEC);
const ground = plan.ribbons.filter((rb) => !rb.elevated);
const elevated = plan.ribbons.filter((rb) => rb.elevated);
const loops = elevated.filter((rb) => rb.path.closed);
const ramps = elevated.filter((rb) => !rb.path.closed);
/** Room a car needs under a deck: its roof, the slab, and a margin. */
const DRIVE_UNDER = 5.5;
/** Two roads within this height of each other at a point are the same level (a merge). */
const MERGE = 3;
const PROJ = createProjection();
const SAMPLE: SurfaceSample = { y: 0, gx: 0, gz: 0 };

function blockedAt(l: ArenaLayout, x: number, z: number, y: number, r: number): string | null {
  for (const b of l.colliders) {
    if (b.maxY !== undefined && y > b.maxY) continue;
    if (b.minY !== undefined && y < b.minY) continue;
    const dx = Math.max(b.minX - x, 0, x - b.maxX);
    const dz = Math.max(b.minZ - z, 0, z - b.maxZ);
    if (Math.hypot(dx, dz) < r) return b.tag ?? 'box';
  }
  for (const w of l.walls) {
    if (w.maxY !== undefined && y > w.maxY) continue;
    if (w.minY !== undefined && y < w.minY) continue;
    const ex = w.bx - w.ax;
    const ez = w.bz - w.az;
    const len2 = ex * ex + ez * ez;
    let t = len2 > 0 ? ((x - w.ax) * ex + (z - w.az) * ez) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    if (Math.hypot(w.ax + ex * t - x, w.az + ez * t - z) < r) return w.tag ?? 'wall';
  }
  return null;
}

/** The road a ramp's end sample lies inside at that height, and the ramp's direction relative to it. */
function hostOf(end: { x: number; z: number; y: number; tx: number; tz: number }, self: RibbonDef): { rb: RibbonDef; dot: number } | null {
  for (const rb of plan.ribbons) {
    if (rb === self) continue;
    projectOntoPath(rb.path, end.x, end.z, PROJ);
    if (PROJ.dist <= PROJ.halfWidth && Math.abs(PROJ.y - end.y) < 1) return { rb, dot: end.tx * PROJ.tx + end.tz * PROJ.tz };
  }
  return null;
}

describe('stack layout contract', () => {
  it('is 600 m square with four levels, four walls and no water', () => {
    const b = layout.bounds;
    expect(b.maxX - b.minX).toBe(600);
    expect(b.maxZ - b.minZ).toBe(600);
    expect(ground.length).toBeGreaterThan(18);
    expect(elevated.map((rb) => rb.tag)).toEqual(STACK_ELEVATED.map((r) => r.tag));
    expect(loops.map((rb) => rb.tag)).toEqual(['deck', 'spine', 'ring']);
    expect(ramps.length).toBe(8);
    expect(plan.walls.map((w) => w.tag).sort()).toEqual(['wall-e', 'wall-n', 'wall-s', 'wall-w']);
    expect(plan.water).toBeNull();
    expect(plan.blocks.length).toBeGreaterThan(50);
    expect(plan.pillars!.length).toBeGreaterThan(100);
    expect(layout.surface).not.toBeNull();
    expect(layout.busRoutes ?? []).toHaveLength(0);
    expect(layout.rushSites ?? []).toHaveLength(0);
    expect(layout.buhoSite ?? null).toBeNull();
  });

  it('holds the three loops at their levels', () => {
    const level = (tag: string): number => loops.find((rb) => rb.tag === tag)!.path.samples[0].y;
    expect(level('deck')).toBe(STACK_L1_Y);
    expect(level('spine')).toBe(STACK_L2_Y);
    expect(level('ring')).toBe(STACK_L3_Y);
    for (const rb of loops) for (const s of rb.path.samples) expect(s.y, rb.tag).toBeCloseTo(rb.path.samples[0].y, 6);
  });

  it('keeps every road clear of what is solid at its own level', () => {
    const r = VEHICLE.collisionRadius;
    for (const rb of plan.ribbons) {
      for (const s of rb.path.samples) {
        for (const lat of [-(s.halfWidth - r - 0.35), s.halfWidth - r - 0.35]) {
          const x = s.x + -s.tz * lat;
          const z = s.z + s.tx * lat;
          const hit = blockedAt(layout, x, z, s.y, r);
          expect(hit, `${rb.tag} at (${x.toFixed(0)}, ${z.toFixed(0)}) y ${s.y.toFixed(1)} hits ${hit}`).toBeNull();
        }
      }
    }
  });

  it('flies over every street it crosses high enough to drive under, edge to edge', () => {
    // The Bay's test walks the centreline. Here both edges of the slab are walked too: a ramp
    // that rises beside a street with its edge still over the street's lane is a wall in that
    // lane. A sample still at grade (under half a metre) is part of the junction, not a bridge.
    for (const rb of elevated) {
      const p = rb.path;
      for (const s of p.samples) {
        if (s.y < 0.5) continue;
        for (const lat of [-s.halfWidth, 0, s.halfWidth]) {
          const x = s.x + -s.tz * lat;
          const z = s.z + s.tx * lat;
          for (const g of ground) {
            projectOntoPath(g.path, x, z, PROJ);
            if (PROJ.dist > PROJ.halfWidth) continue;
            expect(s.y, `${rb.tag} over ${g.tag} at (${x.toFixed(0)}, ${z.toFixed(0)}), ${lat === 0 ? 'centre' : 'edge'}`).toBeGreaterThanOrEqual(DRIVE_UNDER);
          }
        }
      }
    }
  });

  it('leaves a car of clearance wherever two decks cross, and merges the rest', () => {
    for (const a of elevated) {
      for (const s of a.path.samples) {
        const fromEnd = a.path.closed ? Infinity : Math.min(s.s, a.path.length - s.s);
        for (const b of elevated) {
          if (a === b) continue;
          projectOntoPath(b.path, s.x, s.z, PROJ);
          if (PROJ.dist > PROJ.halfWidth) continue;
          const dy = Math.abs(PROJ.y - s.y);
          if (dy < MERGE) {
            const bFromEnd = b.path.closed ? Infinity : Math.min(PROJ.s, b.path.length - PROJ.s);
            expect(Math.min(fromEnd, bFromEnd), `${a.tag} sits inside ${b.tag} at (${s.x.toFixed(0)}, ${s.z.toFixed(0)}) away from both ends`).toBeLessThan(80);
          } else {
            expect(dy, `${a.tag} over ${b.tag} at (${s.x.toFixed(0)}, ${s.z.toFixed(0)})`).toBeGreaterThanOrEqual(DRIVE_UNDER);
          }
        }
      }
    }
  });

  it('keeps every grade drivable', () => {
    for (const rb of elevated) expect(maxGrade(rb.path), rb.tag).toBeLessThan(0.17);
    for (const rb of ground) expect(maxGrade(rb.path), rb.tag).toBe(0);
  });

  it('puts every pillar off the streets, under its deck, and on dry land', () => {
    for (const p of plan.pillars!) {
      for (const g of ground) {
        projectOntoPath(g.path, p.x, p.z, PROJ);
        expect(PROJ.dist, `pillar at (${p.x.toFixed(0)}, ${p.z.toFixed(0)}) on ${g.tag}`).toBeGreaterThan(PROJ.halfWidth + 2);
      }
      expect(p.y).toBeGreaterThanOrEqual(4.5);
      expect(p.wet).toBe(false);
    }
  });

  it('spawns traffic on every level, on a road at its own height, and gives cruise mode a road', () => {
    for (const s of layout.targetSpawns) {
      expect(plan.isRoad(s.x, s.z), `spawn at (${s.x}, ${s.z})`).toBe(true);
      layout.surface!.sample(s.x, s.z, s.y ?? 0, SAMPLE);
      // Within 15 cm: where a ramp leaves a loop its slab overlaps the loop's for a few metres
      // and eases up by that much, and the field answers with the ramp. The car settles.
      expect(Math.abs(SAMPLE.y - (s.y ?? 0)), `spawn at (${s.x}, ${s.z}) y ${s.y}`).toBeLessThan(0.15);
    }
    const at = (y: number): number => layout.targetSpawns.filter((s) => Math.abs((s.y ?? 0) - y) < 0.5).length;
    const lanes = 4;
    const expected = (tag: string): number => Math.floor(STACK_DECK_TRAFFIC.find((d) => d.tag === tag)!.cars / lanes) * lanes;
    expect(at(STACK_L1_Y)).toBe(expected('deck'));
    expect(at(STACK_L2_Y)).toBe(expected('spine'));
    expect(at(STACK_L3_Y)).toBe(expected('ring'));
    expect(at(0)).toBe(STACK_TRAFFIC_LOOPS.reduce((n, l) => n + l.cars, 0));
    for (const p of layout.cruiseRoute) expect(plan.isRoad(p.x, p.z)).toBe(true);
  });
});

describe('stack ramps and interchanges', () => {
  it('ends every ramp inside another road at that road\'s height: no dead ends', () => {
    for (const rb of ramps) {
      const smp = rb.path.samples;
      for (const end of [smp[0], smp[smp.length - 1]]) {
        expect(hostOf(end, rb), `${rb.tag} dead-ends at (${end.x.toFixed(0)}, ${end.z.toFixed(0)}) y ${end.y.toFixed(1)}`).not.toBeNull();
      }
    }
  });

  it('merges every ramp tangentially at the top, and peels off its street at no more than a slip road\'s angle', () => {
    for (const rb of ramps) {
      const smp = rb.path.samples;
      for (const end of [smp[0], smp[smp.length - 1]]) {
        const host = hostOf(end, rb)!;
        const high = end.y >= Math.max(smp[0].y, smp[smp.length - 1].y) - 0.01;
        // At the high end the merge is a merge: within 18 degrees of the deck. At the foot a
        // ramp may leave its street like a slip road, up to 32 degrees (the Bay's do too).
        expect(Math.abs(host.dot), `${rb.tag} meets ${host.rb.tag} at an angle`).toBeGreaterThan(high ? 0.95 : 0.85);
      }
    }
  });

  it('gives both directions of every loop a way up and a way down, as the Bay\'s viaduct has', () => {
    // A ramp driven backwards is the other direction's exit, so each ramp end contributes one
    // exit: leaving the host in the direction the ramp points (forward from its start, reversed
    // from its end), toward the height of its other end.
    const exits = new Set<string>();
    for (const rb of ramps) {
      const smp = rb.path.samples;
      const first = smp[0];
      const last = smp[smp.length - 1];
      const a = hostOf(first, rb)!;
      const b = hostOf(last, rb)!;
      exits.add(`${a.rb.tag}:${a.dot > 0 ? 1 : -1}:${last.y > first.y ? 'up' : 'down'}`);
      exits.add(`${b.rb.tag}:${-b.dot > 0 ? 1 : -1}:${first.y > last.y ? 'up' : 'down'}`);
    }
    for (const dir of [1, -1]) {
      expect(exits.has(`deck:${dir}:up`), `deck ${dir} cannot climb`).toBe(true);
      expect(exits.has(`deck:${dir}:down`), `deck ${dir} cannot come down`).toBe(true);
      expect(exits.has(`spine:${dir}:up`), `spine ${dir} cannot climb`).toBe(true);
      expect(exits.has(`spine:${dir}:down`), `spine ${dir} cannot come down`).toBe(true);
      expect(exits.has(`ring:${dir}:down`), `ring ${dir} cannot come down`).toBe(true);
    }
  });

  it('stacks three levels over a street in at least six places', () => {
    const stacked: Array<{ x: number; z: number; tag: string }> = [];
    for (const g of ground) {
      if (g.kind === 'alley') continue;
      for (const s of g.path.samples) {
        let l1 = false;
        let l2 = false;
        for (const e of elevated) {
          projectOntoPath(e.path, s.x, s.z, PROJ);
          if (PROJ.dist > PROJ.halfWidth + 30) continue;
          if (PROJ.y > 9 && PROJ.y < 16) l1 = true;
          if (PROJ.y >= 20) l2 = true;
        }
        if (l1 && l2 && !stacked.some((q) => Math.hypot(q.x - s.x, q.z - s.z) < 40)) stacked.push({ x: s.x, z: s.z, tag: g.tag ?? '' });
      }
    }
    expect(stacked.length, stacked.map((q) => `${q.tag}@(${q.x.toFixed(0)},${q.z.toFixed(0)})`).join(' ')).toBeGreaterThanOrEqual(6);
  });
});

describe('stack surface and recovery', () => {
  /** The west corridor, where the gran via passes under the deck. */
  const under = { x: -215, z: -60 };

  it('answers with the highest level a body can step onto from where it is', () => {
    layout.surface!.sample(under.x, under.z, 0, SAMPLE);
    expect(SAMPLE.y).toBe(0);
    layout.surface!.sample(under.x, under.z, STACK_L1_Y, SAMPLE);
    expect(SAMPLE.y).toBeCloseTo(STACK_L1_Y, 3);
    layout.surface!.sample(under.x, under.z, 6, SAMPLE);
    expect(SAMPLE.y).toBe(0);
    // Where the spine's north leg crosses over the deck's north-west leg, three answers.
    const deck = loops.find((rb) => rb.tag === 'deck')!;
    const spine = loops.find((rb) => rb.tag === 'spine')!;
    const cross = deck.path.samples.find((s) => {
      projectOntoPath(spine.path, s.x, s.z, PROJ);
      return PROJ.dist < 2;
    })!;
    expect(cross).toBeDefined();
    layout.surface!.sample(cross.x, cross.z, STACK_L2_Y, SAMPLE);
    expect(SAMPLE.y).toBeCloseTo(STACK_L2_Y, 3);
    layout.surface!.sample(cross.x, cross.z, STACK_L1_Y, SAMPLE);
    expect(SAMPLE.y).toBeCloseTo(STACK_L1_Y, 3);
    layout.surface!.sample(cross.x, cross.z, 0, SAMPLE);
    expect(SAMPLE.y).toBe(0);
  });

  it('lets a car pass under and over the same crossing', () => {
    const r = VEHICLE.collisionRadius;
    for (const y of [0, STACK_L1_Y]) {
      for (let d = -12; d <= 12; d += 2) {
        const x = y === 0 ? under.x + d : under.x;
        const z = y === 0 ? under.z : under.z + d;
        expect(blockedAt(layout, x, z, y, r), `level ${y} at (${x}, ${z})`).toBeNull();
      }
    }
  });

  it('recovers onto the level the car was on', () => {
    expect(cityRecovery(plan, under.x, under.z, STACK_L1_Y, 0).y).toBeCloseTo(STACK_L1_Y, 3);
    expect(cityRecovery(plan, under.x, under.z, 0, 0).y).toBe(0);
    const ring = loops.find((rb) => rb.tag === 'ring')!.path.samples[3];
    expect(cityRecovery(plan, ring.x + 1, ring.z, STACK_L3_Y, 0).y).toBeCloseTo(STACK_L3_Y, 3);
  });
});

describe('the stack in the simulation', () => {
  it.each(ramps.map((rb) => [rb.tag ?? '', rb] as const))('drives %s under its own power and arrives at the far road without touching a rail', (_tag, ramp) => {
    const smp = ramp.path.samples;
    const first = smp[0];
    const last = smp[smp.length - 1];
    // Route: the ramp's centreline, then on along the road it ends in, the way it points.
    const route: Array<{ x: number; z: number }> = [];
    for (let s = 0; s <= ramp.path.length; s += 6) {
      const p = offsetAtStation(ramp.path, s, 0);
      route.push({ x: p.x, z: p.z });
    }
    const host = hostOf(last, ramp)!;
    projectOntoPath(host.rb.path, last.x, last.z, PROJ);
    const dir = host.dot > 0 ? 1 : -1;
    for (let s = 10; s < 140; s += 8) {
      const p = offsetAtStation(host.rb.path, PROJ.s + dir * s, 0);
      route.push({ x: p.x, z: p.z });
    }

    const state = createInitialGameState(layout);
    for (const t of state.targets) {
      t.status = 'destroyed';
      t.hitTime = -1;
    }
    const v = state.vehicle;
    v.x = v.prevX = first.x;
    v.z = v.prevZ = first.z;
    v.y = v.prevY = first.y;
    v.heading = v.prevHeading = Math.atan2(first.tx, -first.tz);
    const cmd = createPlayerCommand();
    const cruise = createCruiseController(route);
    cruise.reset(v);
    let collisions = 0;
    let maxPitch = 0;
    let ticks = 0;
    while (ticks < 60 * 90 && cruise.waypoint < route.length - 2) {
      cruise.step(v, cmd, SIM_STEP);
      stepGame(state, cmd, layout, SIM_STEP, { cruising: true });
      for (const e of state.events) if (e.type === 'collision') collisions++;
      if (Math.abs(v.pitch) > maxPitch) maxPitch = Math.abs(v.pitch);
      ticks++;
    }
    expect(collisions, 'rail contacts on the way').toBe(0);
    expect(v.y).toBeCloseTo(last.y, 0);
    expect(maxPitch).toBeLessThan(0.25);
    expect(ticks, 'never reached the far road').toBeLessThan(60 * 90);
  });
});

describe('stack art budget', () => {
  it('builds the whole city inside the brief\'s triangle and draw-call ceiling', () => {
    const measure = (build: (b: ReturnType<typeof createBuilders>) => void): { triangles: number; drawCalls: number } => {
      const b = createBuilders(plan);
      build(b);
      return builderStats(b);
    };
    const parts = {
      track: measure(buildTrack),
      city: measure(buildCity),
      props: measure(buildProps),
      landmarks: measure(buildLandmarks),
      reclamation: measure(buildReclamation),
      transit: measure(buildTransit),
    };
    const all = measure((b) => {
      buildCity(b);
      buildProps(b);
      buildTransit(b);
      buildTrack(b);
      buildLandmarks(b);
      buildReclamation(b);
    });
    // The track's own split, for the phase report: what the decks, the rails, the columns and
    // the ground roads (with their lamps) each cost.
    const noPillars = measure((b) => buildTrack({ ...b, plan: { ...plan, pillars: [], fences: [] } }));
    const noRails = measure((b) => buildTrack({ ...b, plan: { ...plan, rails: [] } }));
    const groundOnly = measure((b) => buildTrack({ ...b, plan: { ...plan, ribbons: ground, rails: [], pillars: [], fences: [] } }));
    const km = elevated.reduce((n, rb) => n + rb.path.length, 0) / 1000;
    const track = {
      decks: parts.track.triangles - (parts.track.triangles - noPillars.triangles) - (parts.track.triangles - noRails.triangles) - groundOnly.triangles,
      rails: parts.track.triangles - noRails.triangles,
      pillarsAndFences: parts.track.triangles - noPillars.triangles,
      groundRoadsAndLamps: groundOnly.triangles,
      railSegments: plan.rails.length,
      pillars: plan.pillars!.length,
      fences: plan.fences!.length,
    };
    console.log('stack budget', { ...all, perSystem: parts, track, elevatedKm: km.toFixed(2), elevatedTrisPerMetre: ((parts.track.triangles - groundOnly.triangles) / (km * 1000)).toFixed(1) });
    // The brief's ceiling: 220k static triangles in at most 20 whole-city batches.
    expect(all.triangles, `stack triangles: ${all.triangles}`).toBeLessThanOrEqual(220000);
    expect(all.triangles, 'the city is not empty').toBeGreaterThan(40000);
    expect(all.drawCalls, `stack draw calls: ${all.drawCalls}`).toBeLessThanOrEqual(20);
  });
});
