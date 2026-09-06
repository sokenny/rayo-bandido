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
import { createCityWorld } from '../src/world/cityWorld';
import { SIDEWALK_Y } from '../src/world/cityPlan';
import { KERB_HEIGHT, KERB_RAMP } from '../src/world/kerbs';
import { CITY_QUAY_Z, VIADUCT_Y } from '../src/world/citySpec';
import { createProjection, maxGrade, offsetAtStation, projectOntoPath } from '../src/world/track';

/**
 * The big city is generated from `citySpec.ts`; these tests pin the contract between the
 * art and the simulation with elevation in play: every road is clear of the obstacles that
 * are solid AT ITS OWN LEVEL, every street a viaduct crosses is still drivable underneath,
 * decks that cross each other leave a car's height between them, the ramps are climbable,
 * and a car keeps the level it is on.
 */
const { layout, plan } = createCityWorld();
const ground = plan.ribbons.filter((rb) => !rb.elevated);
const elevated = plan.ribbons.filter((rb) => rb.elevated);
/** Room a car needs under a deck: its roof, the slab, and a margin. */
const DRIVE_UNDER = 5.5;
/** Two roads within this height of each other at a point are the same level (a merge). */
const MERGE = 3;

/** Whether a circle of radius `r` at (x, z) on level `y` overlaps anything solid there. */
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

describe('city layout contract', () => {
  it('is about five times the test arena and carries every kind of road', () => {
    const b = layout.bounds;
    expect((b.maxX - b.minX) * (b.maxZ - b.minZ)).toBeGreaterThan(240 * 240 * 4);
    expect(ground.length).toBeGreaterThan(12);
    expect(elevated.map((rb) => rb.tag)).toEqual(['viaduct', 'ramp-w-on', 'ramp-e-on', 'ramp-n-off', 'ramp-s-off', 'skyway']);
    expect(plan.blocks.length).toBeGreaterThan(50);
    expect(plan.pillars!.length).toBeGreaterThan(40);
    expect(plan.water).not.toBeNull();
    expect(layout.surface).not.toBeNull();
  });

  it('keeps every road clear of what is solid at its own level', () => {
    const r = VEHICLE.collisionRadius;
    for (const rb of plan.ribbons) {
      for (const s of rb.path.samples) {
        // The two lanes' centres, a car's width inside the rails.
        for (const lat of [-(s.halfWidth - r - 0.35), s.halfWidth - r - 0.35]) {
          const x = s.x + -s.tz * lat;
          const z = s.z + s.tx * lat;
          const hit = blockedAt(layout, x, z, s.y, r);
          expect(hit, `${rb.tag} at (${x.toFixed(0)}, ${z.toFixed(0)}) y ${s.y.toFixed(1)} hits ${hit}`).toBeNull();
        }
      }
    }
  });

  it('flies over every street it crosses high enough to drive under', () => {
    for (const rb of elevated) {
      const p = rb.path;
      for (const s of p.samples) {
        const fromEnd = p.closed ? Infinity : Math.min(s.s, p.length - s.s);
        // A ramp starts and ends inside a street: that is the merge, not a crossing.
        if (fromEnd < 40) continue;
        for (const g of ground) {
          projectOntoPath(g.path, s.x, s.z, PROJ);
          if (PROJ.dist > PROJ.halfWidth) continue;
          expect(s.y, `${rb.tag} over ${g.tag} at (${s.x.toFixed(0)}, ${s.z.toFixed(0)})`).toBeGreaterThanOrEqual(DRIVE_UNDER);
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
            // Same level: one of the two must be ending here (a ramp merging into the deck).
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

  it('puts every pillar off the streets and under its deck', () => {
    for (const p of plan.pillars!) {
      for (const g of ground) {
        projectOntoPath(g.path, p.x, p.z, PROJ);
        expect(PROJ.dist, `pillar at (${p.x.toFixed(0)}, ${p.z.toFixed(0)}) on ${g.tag}`).toBeGreaterThan(PROJ.halfWidth + 2);
      }
      expect(p.y).toBeGreaterThanOrEqual(4.5);
      expect(p.wet).toBe(p.z > CITY_QUAY_Z);
    }
  });

  it('spawns the traffic on a road at its level and gives cruise mode a road to follow', () => {
    for (const s of layout.targetSpawns) {
      expect(plan.isRoad(s.x, s.z), `spawn at (${s.x}, ${s.z})`).toBe(true);
      layout.surface!.sample(s.x, s.z, s.y ?? 0, SAMPLE);
      expect(SAMPLE.y).toBeCloseTo(s.y ?? 0, 1);
    }
    expect(layout.targetSpawns.filter((s) => (s.y ?? 0) > 10).length).toBe(8);
    expect(layout.targetSpawns.length).toBeGreaterThanOrEqual(36);
    for (const p of layout.cruiseRoute) expect(plan.isRoad(p.x, p.z)).toBe(true);
  });
});

const PROJ = createProjection();
const SAMPLE: SurfaceSample = { y: 0, gx: 0, gz: 0 };

describe('city surface', () => {
  const viaduct = elevated.find((rb) => rb.tag === 'viaduct')!;
  const street = ground.find((rb) => rb.tag === 'av-main')!;
  /** Where the main avenue passes under the viaduct's north leg. */
  const crossing = (() => {
    for (const s of street.path.samples) {
      projectOntoPath(viaduct.path, s.x, s.z, PROJ);
      if (PROJ.dist < 4.5) return { x: PROJ.x, z: PROJ.z };
    }
    throw new Error('no crossing found');
  })();

  it('answers with the highest level a body can step onto from where it is', () => {
    layout.surface!.sample(crossing.x, crossing.z, 0, SAMPLE);
    expect(SAMPLE.y).toBe(0);
    layout.surface!.sample(crossing.x, crossing.z, VIADUCT_Y, SAMPLE);
    expect(SAMPLE.y).toBeCloseTo(VIADUCT_Y, 3);
    // A little below the deck is still the deck (a bump, a rail); well below it is the street.
    layout.surface!.sample(crossing.x, crossing.z, VIADUCT_Y - 0.4, SAMPLE);
    expect(SAMPLE.y).toBeCloseTo(VIADUCT_Y, 3);
    layout.surface!.sample(crossing.x, crossing.z, 6, SAMPLE);
    expect(SAMPLE.y).toBe(0);
    // The foot of a ramp is a step the car takes: the ramp wins over the ground under it.
    const ramp = elevated.find((rb) => rb.tag === 'ramp-w-on')!;
    const foot = offsetAtStation(ramp.path, 8, 0);
    layout.surface!.sample(foot.x, foot.z, 0, SAMPLE);
    expect(SAMPLE.y).toBeGreaterThan(0.02);
    expect(SAMPLE.y).toBeCloseTo(foot.y, 3);
  });

  it('reports the grade of a ramp along its direction', () => {
    const ramp = elevated.find((rb) => rb.tag === 'ramp-w-on')!;
    const mid = offsetAtStation(ramp.path, ramp.path.length * 0.45, 0);
    layout.surface!.sample(mid.x, mid.z, mid.y, SAMPLE);
    const along = SAMPLE.gx * mid.tx + SAMPLE.gz * mid.tz;
    expect(along).toBeGreaterThan(0.05);
    expect(along).toBeLessThan(0.17);
  });

  it('lets a car on the street pass under the viaduct, and a car on the deck pass over the street', () => {
    const r = VEHICLE.collisionRadius;
    for (const y of [0, VIADUCT_Y]) {
      for (let d = -12; d <= 12; d += 2) {
        // Along the street on the ground, along the deck up top.
        const x = y === 0 ? crossing.x : crossing.x + d;
        const z = y === 0 ? crossing.z + d : crossing.z;
        expect(blockedAt(layout, x, z, y, r), `level ${y} at (${x}, ${z})`).toBeNull();
      }
    }
  });
});

describe('city in the simulation', () => {
  it('drives up the west ramp under its own power and arrives on the deck without touching a rail', () => {
    const ramp = elevated.find((rb) => rb.tag === 'ramp-w-on')!;
    const viaduct = elevated.find((rb) => rb.tag === 'viaduct')!;
    // Route: the ramp's centreline, then on along the deck for a while.
    const route: Array<{ x: number; z: number }> = [];
    for (let s = 0; s <= ramp.path.length; s += 6) {
      const p = offsetAtStation(ramp.path, s, 0);
      route.push({ x: p.x, z: p.z });
    }
    const end = route[route.length - 1];
    projectOntoPath(viaduct.path, end.x, end.z, PROJ);
    for (let s = PROJ.s + 10; s < PROJ.s + 160; s += 8) {
      const p = offsetAtStation(viaduct.path, s, 0);
      route.push({ x: p.x, z: p.z });
    }

    const state = createInitialGameState(layout);
    for (const t of state.targets) {
      t.status = 'destroyed';
      t.hitTime = -1;
    }
    const v = state.vehicle;
    const first = offsetAtStation(ramp.path, 0, 0);
    v.x = v.prevX = first.x;
    v.z = v.prevZ = first.z;
    v.y = v.prevY = 0;
    v.heading = v.prevHeading = Math.atan2(first.tx, -first.tz);
    const cmd = createPlayerCommand();
    const cruise = createCruiseController(route);
    cruise.reset(v);
    let collisions = 0;
    let topY = 0;
    let maxPitch = 0;
    let ticks = 0;
    while (ticks < 60 * 60 && cruise.waypoint < route.length - 2) {
      cruise.step(v, cmd, SIM_STEP);
      stepGame(state, cmd, layout, SIM_STEP, { cruising: true });
      for (const e of state.events) if (e.type === 'collision') collisions++;
      if (v.y > topY) topY = v.y;
      if (v.pitch > maxPitch) maxPitch = v.pitch;
      ticks++;
    }
    expect(collisions, 'rail contacts on the way up').toBe(0);
    expect(topY).toBeGreaterThan(VIADUCT_Y - 0.1);
    expect(v.y).toBeCloseTo(VIADUCT_Y, 1);
    expect(maxPitch).toBeGreaterThan(0.08);
    expect(maxPitch).toBeLessThan(0.2);
    expect(ticks).toBeLessThan(60 * 60);
  });

  it('keeps a shot from reaching a car on another level', () => {
    const state = createInitialGameState(layout);
    const v = state.vehicle;
    // Park under the viaduct's north leg, on the main avenue, with a target right overhead.
    v.x = v.prevX = -66;
    v.z = v.prevZ = -190;
    v.heading = v.prevHeading = 0;
    for (const t of state.targets) {
      t.status = 'destroyed';
      t.hitTime = -1;
    }
    const overhead = state.targets[0];
    overhead.status = 'active';
    overhead.x = overhead.prevX = -66;
    overhead.z = overhead.prevZ = -205;
    overhead.y = overhead.prevY = VIADUCT_Y;
    layout.targetPatrols[0] = [];
    const cmd = createPlayerCommand();
    stepGame(state, cmd, layout, SIM_STEP);
    expect(state.lightning.acquiredTargetId).toBe(-1);
    // The same car down on the street is in the cone.
    overhead.y = overhead.prevY = 0;
    stepGame(state, cmd, layout, SIM_STEP);
    expect(state.lightning.acquiredTargetId).toBe(0);
  });
});

describe('city kerbs', () => {
  const kerbs = plan.kerbs!;
  /** A paved stretch of street, well clear of any junction: the segment and the side to test. */
  const spot = (() => {
    for (const rb of ground) {
      if (rb.kind === 'alley') continue;
      const samples = rb.path.samples;
      for (let i = 2; i < samples.length - 2; i++) {
        if (!kerbs.paved(rb, i, 1) || !kerbs.paved(rb, i - 1, 1) || !kerbs.paved(rb, i + 1, 1)) continue;
        const a = samples[i];
        const c = samples[i + 1];
        return { rb, i, x: (a.x + c.x) / 2, z: (a.z + c.z) / 2, tx: a.tx, tz: a.tz, halfWidth: a.halfWidth };
      }
    }
    throw new Error('no paved stretch found');
  })();
  /** The surface height `off` metres to the right of the centreline there. */
  const at = (off: number, yHint = 0): number => {
    layout.surface!.sample(spot.x + -spot.tz * off, spot.z + spot.tx * off, yHint, SAMPLE);
    return SAMPLE.y;
  };
  const width = kerbs.widthAt(spot.rb, spot.i);

  it('leaves the asphalt flat and raises the pavement beside it by a full step', () => {
    expect(width).toBeGreaterThan(0.8);
    expect(at(0)).toBe(0);
    expect(at(spot.halfWidth - 0.5)).toBe(0);
    // The kerb face climbs over its own short run, then the pavement runs flat to the blocks.
    expect(at(spot.halfWidth + KERB_RAMP / 2)).toBeCloseTo(KERB_HEIGHT / 2, 3);
    expect(at(spot.halfWidth + KERB_RAMP + 0.1)).toBeCloseTo(KERB_HEIGHT, 3);
    expect(at(spot.halfWidth + width - 0.1)).toBeCloseTo(KERB_HEIGHT, 3);
    expect(KERB_HEIGHT).toBe(SIDEWALK_Y);
  });

  it('tips a car climbing the face and levels it once it is up', () => {
    at(spot.halfWidth + KERB_RAMP / 2);
    // The grade points away from the road, and is the face's own rise per metre.
    expect(Math.hypot(SAMPLE.gx, SAMPLE.gz)).toBeCloseTo(KERB_HEIGHT / KERB_RAMP, 3);
    expect(SAMPLE.gx * -spot.tz + SAMPLE.gz * spot.tx).toBeGreaterThan(0);
    at(spot.halfWidth + KERB_RAMP + 0.5);
    expect(Math.hypot(SAMPLE.gx, SAMPLE.gz)).toBe(0);
  });

  it('never lifts a car that is still on the asphalt', () => {
    // The pavement stops at every junction mouth, so no point on a street is ever raised.
    let checked = 0;
    for (const rb of ground) {
      for (const sm of rb.path.samples) {
        for (const off of [0, 0.5, 0.9]) {
          for (const side of [-1, 1]) {
            const d = sm.halfWidth * off * side;
            expect(kerbs.heightAt(sm.x + -sm.tz * d, sm.z + sm.tx * d, SAMPLE)).toBe(0);
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it('paves the back alleys flush: no kerb to trip a car in a lane that narrow', () => {
    /** True when only the alley's own pavement reaches this point (no street's beside it). */
    const alleyOnly = (x: number, z: number): boolean =>
      ground.every((rb) => {
        if (rb.kind === 'alley') return true;
        projectOntoPath(rb.path, x, z, PROJ);
        return PROJ.dist > PROJ.halfWidth + 12;
      });
    let checked = 0;
    for (const alley of ground.filter((rb) => rb.kind === 'alley')) {
      const samples = alley.path.samples;
      for (let i = 1; i < samples.length - 1; i++) {
        const sm = samples[i];
        for (const side of [-1, 1]) {
          if (!kerbs.paved(alley, i, side)) continue;
          const d = (sm.halfWidth + 1) * side;
          const x = sm.x + -sm.tz * d;
          const z = sm.z + sm.tx * d;
          if (!alleyOnly(x, z)) continue;
          expect(kerbs.heightAt(x, z, SAMPLE)).toBe(0);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(4);
  });

  it('leaves the mouth of a crossing street bare, and the deck above alone', () => {
    // Where the main avenue meets a cross street, the avenue's pavement gives way to asphalt.
    const av = ground.find((rb) => rb.tag === 'av-main')!;
    const cross = ground.find((rb) => rb.tag === 'st-n2')!;
    projectOntoPath(av.path, 0, -60, PROJ);
    const mouth = { x: PROJ.x, z: PROJ.z, halfWidth: PROJ.halfWidth };
    expect(cross.path.samples[0].halfWidth).toBeGreaterThan(4);
    expect(kerbs.heightAt(mouth.x + mouth.halfWidth + 1, mouth.z, SAMPLE)).toBe(0);
    expect(kerbs.heightAt(mouth.x - mouth.halfWidth - 1, mouth.z, SAMPLE)).toBe(0);
    // A car on the viaduct is on the viaduct: the kerbs below are not in its way.
    layout.surface!.sample(spot.x, spot.z, VIADUCT_Y, SAMPLE);
    expect(SAMPLE.y).toBeLessThan(KERB_HEIGHT);
  });
});

describe('city art budget', () => {
  it('builds the whole city inside the triangle and draw-call budget', () => {
    const b = createBuilders(plan);
    buildCity(b);
    buildProps(b);
    buildTrack(b);
    buildLandmarks(b);
    const { triangles, drawCalls } = builderStats(b);
    // The headroom above 157k is the vertical corner fillet every building now carries
    // (`buildingKit`'s `cornerFillet`): four extra wall strips a volume, ~3.6k triangles.
    expect(triangles, `city triangles: ${triangles}`).toBeLessThan(170000);
    expect(triangles, 'the city is not empty').toBeGreaterThan(40000);
    expect(drawCalls, `city draw calls: ${drawCalls}`).toBeLessThanOrEqual(20);
  });
});
