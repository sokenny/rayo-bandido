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
import { ATMOSPHERE } from '../src/config/tuning';
import { FACADE_STYLES, GROUND_STYLES, facadeCell, type FacadeStyle } from '../src/render/scene/env/facadeAtlas';
import { BAY_PALETTE, STACK_PALETTE } from '../src/render/scene/env/palette';
import { STACK_DECK_TRAFFIC, STACK_ELEVATED, STACK_FOG_DENSITY, STACK_L1_Y, STACK_L2_Y, STACK_L3_Y, STACK_SPEC, STACK_TRAFFIC_LOOPS } from '../src/world/stackSpec';
import { STACK_MASSING, STACK_SITES } from '../src/world/stackMassing';
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

describe('stack massing and enclosure', () => {
  const megas = plan.megastructures!;
  const passages = plan.passages!;
  const spine = loops.find((rb) => rb.tag === 'spine')!;
  const length = (f: (p: (typeof passages)[0]) => boolean): number => passages.filter(f).reduce((n, p) => n + (p.s1 - p.s0), 0);

  it('builds every site the plan places, carved round every road', () => {
    expect(megas.map((m) => m.tag)).toEqual(STACK_SITES.map((s) => `stack-${s.tag}`));
    for (const m of megas) expect(m.volumes.length, m.tag).toBeGreaterThan(3);
    // No volume reaches into a road's reservation: the asphalt, the margin beside it, two
    // metres under it and the camera's headroom over it (the same rule `megacity.test.ts`
    // holds for the Bay's district).
    for (const rb of plan.ribbons) for (const s of rb.path.samples) {
      for (const m of megas) for (const v of m.volumes) {
        if (v.y0 >= s.y + STACK_MASSING.cameraClearance - 0.001 || v.y1 <= s.y - 2 + 0.001) continue;
        const dx = Math.max(v.minX - s.x, 0, s.x - v.maxX);
        const dz = Math.max(v.minZ - s.z, 0, s.z - v.maxZ);
        expect(Math.hypot(dx, dz), `${m.tag} seals ${rb.tag} at (${s.x.toFixed(0)}, ${s.z.toFixed(0)}) y ${s.y.toFixed(1)}`).toBeGreaterThanOrEqual(s.halfWidth + STACK_MASSING.roadMargin - 0.01);
      }
    }
  });

  it('uses the exact carved volumes as height-bounded colliders', () => {
    for (const m of megas) {
      const boxes = layout.colliders.filter((c) => c.tag === m.tag);
      expect(boxes).toHaveLength(m.volumes.length);
      m.volumes.forEach((v, i) => {
        expect(boxes[i].minY).toBe(v.y0);
        expect(boxes[i].maxY).toBe(v.y1);
        expect(boxes[i].minX).toBe(v.minX);
        expect(boxes[i].maxZ).toBe(v.maxZ);
      });
    }
  });

  it('encloses at least 40 % of the spine on two sides, and puts 30 % of L1 + L2 inside or under a building', () => {
    // A passage is a ceiling; "two sides" is the ceiling and a wall at the kerb.
    const twoSided = length((p) => p.tag === 'spine' && (p.left || p.right));
    const l1l2 = elevated.filter((rb) => rb.tag !== 'ring' && !rb.tag!.startsWith('ring-'));
    const l1l2Length = l1l2.reduce((n, rb) => n + rb.path.length, 0);
    const inside = length((p) => l1l2.some((rb) => rb.tag === p.tag));
    console.log('stack enclosure', { spineTwoSided: `${Math.round(twoSided)} of ${Math.round(spine.path.length)} m (${((100 * twoSided) / spine.path.length).toFixed(1)} %)`, l1l2Inside: `${Math.round(inside)} of ${Math.round(l1l2Length)} m (${((100 * inside) / l1l2Length).toFixed(1)} %)`, passages: passages.length });
    expect(twoSided / spine.path.length).toBeGreaterThanOrEqual(0.4);
    expect(inside / l1l2Length).toBeGreaterThanOrEqual(0.3);
    // Every passage has a real ceiling: over the road, under the brief's "within 40 m", and
    // higher than the chase camera.
    for (const p of passages) {
      expect(p.clearance, `${p.tag} ceiling`).toBeGreaterThanOrEqual(STACK_MASSING.cameraClearance - 0.01);
      expect(p.clearance, `${p.tag} ceiling`).toBeLessThanOrEqual(12);
      // And the ceiling is really there: a volume over the middle of the run at that clearance.
      const rb = plan.ribbons.find((r) => r.tag === p.tag)!;
      const at = offsetAtStation(rb.path, (p.s0 + p.s1) / 2, 0);
      const over = megas.some((m) => m.volumes.some((v) => at.x >= v.minX && at.x <= v.maxX && at.z >= v.minZ && at.z <= v.maxZ && v.y0 >= at.y + p.clearance - 0.01 && v.y0 <= at.y + 12.01));
      expect(over, `${p.tag} passage at (${at.x.toFixed(0)}, ${at.z.toFixed(0)}) has no ceiling over it`).toBe(true);
    }
  });

  it('runs the spine through buildings on all four legs', () => {
    const on = (f: (x: number, z: number) => boolean): boolean =>
      passages.some((p) => {
        if (p.tag !== 'spine') return false;
        const at = offsetAtStation(spine.path, (p.s0 + p.s1) / 2, 0);
        return f(at.x, at.z);
      });
    expect(on((_x, z) => z < -100), 'north').toBe(true);
    expect(on((x) => x > 150), 'east').toBe(true);
    expect(on((_x, z) => z > 130), 'south').toBe(true);
    expect(on((x) => x < -150), 'west').toBe(true);
  });

  it('bridges the avenues at three heights, some lit and some bare, clear of every road', () => {
    const bridges = plan.skybridges!;
    expect(bridges.length).toBeGreaterThanOrEqual(10);
    expect(new Set(bridges.map((b) => b.y)).size).toBeGreaterThanOrEqual(3);
    expect(bridges.some((b) => b.kind === 'concrete')).toBe(true);
    expect(bridges.some((b) => b.kind === 'lit')).toBe(true);
    for (const b of bridges) {
      const minX = Math.min(b.ax, b.bx) - b.width, maxX = Math.max(b.ax, b.bx) + b.width;
      const minZ = Math.min(b.az, b.bz) - b.width, maxZ = Math.max(b.az, b.bz) + b.width;
      for (const rb of elevated) for (const s of rb.path.samples) {
        if (s.x < minX || s.x > maxX || s.z < minZ || s.z > maxZ) continue;
        const clear = s.y + STACK_MASSING.cameraClearance <= b.y - b.height / 2 || s.y - 2 >= b.y + b.height / 2;
        expect(clear, `bridge at (${b.ax.toFixed(0)}, ${b.az.toFixed(0)}) y ${b.y} meets ${rb.tag} at y ${s.y.toFixed(1)}`).toBe(true);
      }
    }
  });

  it('stands the buildings at the kerb, frames the open highway and anchors three landmarks', () => {
    expect(plan.setback).toBeLessThanOrEqual(0.6);
    for (const w of Object.values(plan.shoulders!)) expect(w).toBeLessThanOrEqual(0.8);
    expect(plan.portalFrames).toEqual(['spine', 'ring']);
    expect(plan.landmarkAnchors).toHaveLength(3);
    expect(plan.megaDetail).toBe('lean');
  });
});

describe('stack surfaces and light', () => {
  it('draws in the stack palette: amber first in every window list, red nowhere in the accents but the old town', () => {
    expect(plan.palette).toBe('stack');
    expect(plan.finish).toBe('concrete');
    const AMBER = new Set([0xffc27a, 0xffb347]);
    for (const list of [STACK_PALETTE.windowsCorp, STACK_PALETTE.windowsUrban, STACK_PALETTE.windowsJdm]) {
      expect(AMBER.has(list[0])).toBe(true);
      const warm = list.filter((c) => c === 0xffc27a || c === 0xffd9a8 || c === 0xffb347).length;
      expect(warm / list.length).toBeGreaterThanOrEqual(0.5);
      // No violet, no pink.
      expect(list.includes(0x9fd0e8)).toBe(false);
    }
    for (const list of [STACK_PALETTE.accentCorporate, STACK_PALETTE.accentUrban]) expect(list.includes(STACK_PALETTE.neonMagenta)).toBe(false);
    // The bay is untouched: its lists and its air are what they were.
    expect(BAY_PALETTE.fog).toBe(0x163a41);
    expect(BAY_PALETTE.windowsCorp[0]).toBe(0xdff1ff);
  });

  it('fogs a tower at 250 m to 70-80 %, and keeps the road readable at 60 m', () => {
    const k = STACK_FOG_DENSITY * ATMOSPHERE.fogDensityScale;
    const fog = (d: number): number => 1 - Math.exp(-(d * k) * (d * k));
    expect(plan.fog).toEqual({ density: STACK_FOG_DENSITY });
    expect(fog(250)).toBeGreaterThanOrEqual(0.7);
    expect(fog(250)).toBeLessThanOrEqual(0.8);
    expect(fog(60)).toBeLessThan(0.12);
  });

  it('gives every street wall a concrete ground floor, and favours concrete over glass above it', () => {
    const b = createBuilders(plan);
    buildCity(b);
    // The atlas cell each wall quad samples is in `cells` (three floats a vertex, six vertices
    // a quad); the ground styles are the Stack's.
    const at = new Map<string, FacadeStyle>();
    for (const style of FACADE_STYLES) {
      const c = facadeCell(style);
      at.set(`${c.u0.toFixed(3)},${c.v0.toFixed(3)}`, style);
    }
    const count = new Map<FacadeStyle, number>();
    const cells = b.facade.cells;
    for (let i = 0; i < cells.length; i += 3 * 6) {
      const style = at.get(`${cells[i].toFixed(3)},${cells[i + 1].toFixed(3)}`);
      if (style) count.set(style, (count.get(style) ?? 0) + 1);
    }
    const total = [...count.values()].reduce((n, v) => n + v, 0);
    const ground = GROUND_STYLES.reduce((n, st) => n + (count.get(st) ?? 0), 0);
    const glass = (count.get('curtain') ?? 0) + (count.get('grid') ?? 0) + (count.get('ribbon') ?? 0) + (count.get('cluster') ?? 0) + (count.get('mixed') ?? 0);
    const concrete = (count.get('brut') ?? 0) + (count.get('panels') ?? 0) + (count.get('louvre') ?? 0) + (count.get('service') ?? 0) + (count.get('stack') ?? 0) + (count.get('strips') ?? 0) + ground;
    console.log('stack facade styles', Object.fromEntries([...count.entries()].sort((p, q) => q[1] - p[1])));
    expect(ground, 'ground-floor bands drawn').toBeGreaterThan(200);
    expect(count.get('shops') ?? 0, 'the odd lit shopfront').toBeGreaterThan(10);
    expect(concrete / total, 'concrete-dominant').toBeGreaterThan(0.55);
    expect(glass / total, 'glass second').toBeLessThan(0.3);
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
    // The brief's ceiling was 220k static triangles in at most 20 whole-city batches. Phase 2
    // (the megastructures, their passages, the portal frames and the skybridges) landed at
    // ~241k, and Juan raised the triangle ceiling on 2026-09-12 rather than have the
    // enclosure thinned to fit; the draw-call ceiling stands.
    // Raised again at the Phase 3 gate (2026-09-12): Juan asked for the city to look complete
    // before it looks cheap, so the Bay's full deck profile, its lamp density and greenery, the
    // wall equipment and the ground-floor modules all came back in. The draw-call ceiling stands.
    expect(all.triangles, `stack triangles: ${all.triangles}`).toBeLessThanOrEqual(500000);
    expect(all.triangles, 'the city is not empty').toBeGreaterThan(40000);
    expect(all.drawCalls, `stack draw calls: ${all.drawCalls}`).toBeLessThanOrEqual(20);
  });
});
