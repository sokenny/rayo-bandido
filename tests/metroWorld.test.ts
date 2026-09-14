import { describe, expect, it } from 'vitest';
import type { ArenaLayout, SurfaceSample } from '../src/core/types';
import { MOOGUL, PASSENGER, RUSH, VEHICLE } from '../src/config/tuning';
import { builderStats, createBuilders } from '../src/render/scene/env/builders';
import { buildCity } from '../src/render/scene/env/cityBuilder';
import { buildLandmarks } from '../src/render/scene/env/landmarksBuilder';
import { buildCarMeets } from '../src/render/scene/env/meetBuilder';
import { buildProps } from '../src/render/scene/env/propsBuilder';
import { buildTrack } from '../src/render/scene/env/trackBuilder';
import { buildTransit } from '../src/render/scene/env/transitBuilder';
import { buildReclamation } from '../src/render/scene/env/reclaimBuilder';
import { buildScreens } from '../src/render/scene/env/screenBuilder';
import { PASSENGERS, validatePassengerCatalog } from '../src/content/passengers';
import { createCityWorld } from '../src/world/cityWorld';
import { inRect, type RibbonDef } from '../src/world/cityPlan';
import { METRO_BUS_ROUTES, METRO_MEET, METRO_RUSH_SITES, METRO_SPEC, METRO_VIADUCT_Y, STACK_OFFSET, STACK_RECT } from '../src/world/metroSpec';
import { MEET_EDGE, meetSolids, meetWalls, solidCorners } from '../src/world/carMeet';
import { STACK_ELEVATED, STACK_L1_Y, STACK_L2_Y, STACK_L3_Y, STACK_ROADS } from '../src/world/stackSpec';
import { STACK_SITES } from '../src/world/stackMassing';
import { createProjection, isOnPath, maxGrade, projectOntoPath } from '../src/world/track';

/**
 * Bandido Metro (`src/world/metroSpec.ts`): the Stack as the downtown of a city the Bay's
 * size four times over, through the same assembler as both. The rules are the two cities'
 * own — clear at its own level, drivable underneath, a car's height between crossing decks,
 * climbable grades, pillars off the streets, traffic on a road at its own height — plus what
 * the merge adds: the Stack arrives whole and where it was put, its streets run on to the
 * edge, its rules stop at its footprint and the Bay's begin, and the free-world activities
 * stand on roads.
 */
const { layout, plan } = createCityWorld(METRO_SPEC);
const ground = plan.ribbons.filter((rb) => !rb.elevated);
const elevated = plan.ribbons.filter((rb) => rb.elevated);
const loops = elevated.filter((rb) => rb.path.closed);
const ramps = elevated.filter((rb) => !rb.path.closed);
const DRIVE_UNDER = 5.5;
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

describe('metro layout contract', () => {
  it('is 1.4 by 1.95 km with water to the south, the Stack downtown and a viaduct round the south', () => {
    const b = layout.bounds;
    expect(b.maxX - b.minX).toBe(1400);
    expect(b.maxZ - b.minZ).toBe(1950);
    expect(plan.water).not.toBeNull();
    expect(plan.walls.map((w) => w.tag).sort()).toEqual(['wall-e', 'wall-n', 'wall-w']);
    expect(ground.length).toBeGreaterThan(30);
    // Every one of the Stack's roads and levels, by name, then the viaduct and its ramps.
    for (const r of STACK_ROADS) expect(ground.some((rb) => rb.tag === r.tag), r.tag).toBe(true);
    expect(elevated.map((rb) => rb.tag)).toEqual([...STACK_ELEVATED.map((r) => r.tag), 'viaduct', 'ramp-w-n', 'ramp-w-s', 'ramp-e-s', 'ramp-e-n']);
    expect(loops.map((rb) => rb.tag)).toEqual(['deck', 'spine', 'ring', 'viaduct']);
    expect(ramps.length).toBe(12);
    expect(plan.blocks.length).toBeGreaterThan(250);
    expect(plan.pillars!.length).toBeGreaterThan(300);
    expect(layout.surface).not.toBeNull();
    expect(plan.render).toEqual(METRO_SPEC.render);
  });

  it('holds the four loops at their levels', () => {
    const level = (tag: string): number => loops.find((rb) => rb.tag === tag)!.path.samples[0].y;
    expect(level('deck')).toBe(STACK_L1_Y);
    expect(level('spine')).toBe(STACK_L2_Y);
    expect(level('ring')).toBe(STACK_L3_Y);
    expect(level('viaduct')).toBe(METRO_VIADUCT_Y);
    for (const rb of loops) for (const s of rb.path.samples) expect(s.y, rb.tag).toBeCloseTo(rb.path.samples[0].y, 6);
  });

  it('puts the Stack down whole where the spec says, streets run on to the edge', () => {
    // The spine's first node is the Stack's, moved.
    const spine = loops.find((rb) => rb.tag === 'spine')!;
    const stackSpine = STACK_ELEVATED.find((r) => r.tag === 'spine')!.spec.nodes[0];
    const first = spine.path.samples[0];
    expect(Math.hypot(first.x - (stackSpine.x + STACK_OFFSET.x), first.z - (stackSpine.z + STACK_OFFSET.z))).toBeLessThan(60);
    // The central avenue runs from the north wall to the shore; the cuts stop at the ring.
    const central = ground.find((rb) => rb.tag === 'av-central')!;
    expect(central.path.samples[0].z).toBeLessThan(-600);
    expect(central.path.samples[central.path.samples.length - 1].z).toBeGreaterThan(1100);
    const cut = ground.find((rb) => rb.tag === 'cut-d')!;
    expect(cut.path.samples[cut.path.samples.length - 1].z).toBeCloseTo(STACK_RECT.maxZ + 40, 1);
    // Every megastructure site is inside the Stack's footprint, moved with it.
    expect(plan.megastructures!.length).toBe(STACK_SITES.length);
    for (const m of plan.megastructures!) {
      expect(m.footprint.minX).toBeGreaterThanOrEqual(STACK_RECT.minX);
      expect(m.footprint.maxZ).toBeLessThanOrEqual(STACK_RECT.maxZ);
      expect(m.volumes.length).toBeGreaterThan(0);
    }
    expect(plan.passages!.length).toBeGreaterThan(20);
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
    for (const rb of elevated) {
      for (const s of rb.path.samples) {
        if (s.y < 0.5) continue;
        for (const lat of [-s.halfWidth + 0.3, 0, s.halfWidth - 0.3]) {
          const x = s.x + -s.tz * lat;
          const z = s.z + s.tx * lat;
          for (const other of ground) {
            projectOntoPath(other.path, x, z, PROJ);
            if (PROJ.dist > PROJ.halfWidth) continue;
            const gap = s.y - PROJ.y;
            if (gap > -MERGE && gap < MERGE) continue;
            expect(gap, `${rb.tag} over ${other.tag} at (${x.toFixed(0)}, ${z.toFixed(0)})`).toBeGreaterThanOrEqual(DRIVE_UNDER);
          }
        }
      }
    }
  });

  it('leaves a car of clearance wherever two decks cross, and merges the rest', () => {
    for (const rb of elevated) {
      for (const s of rb.path.samples) {
        for (const other of elevated) {
          if (other === rb) continue;
          projectOntoPath(other.path, s.x, s.z, PROJ);
          if (PROJ.dist > PROJ.halfWidth + s.halfWidth - 0.5) continue;
          const gap = Math.abs(s.y - PROJ.y);
          if (gap < MERGE) continue;
          expect(gap, `${rb.tag} and ${other.tag} at (${s.x.toFixed(0)}, ${s.z.toFixed(0)})`).toBeGreaterThanOrEqual(DRIVE_UNDER);
        }
      }
    }
  });

  it('keeps every grade drivable', () => {
    for (const rb of elevated) expect(maxGrade(rb.path), rb.tag).toBeLessThanOrEqual(0.17);
  });

  it('puts every pillar off the streets, under its deck, and wet only over the water', () => {
    for (const p of plan.pillars!) {
      expect(p.y).toBeGreaterThan(4);
      for (const rb of ground) {
        projectOntoPath(rb.path, p.x, p.z, PROJ);
        expect(PROJ.dist, `pillar at (${p.x.toFixed(0)}, ${p.z.toFixed(0)}) on ${rb.tag}`).toBeGreaterThan(PROJ.halfWidth);
      }
      expect(p.wet).toBe(p.z > METRO_SPEC.water!.quayZ);
    }
  });

  it('spawns traffic on every level, on a road at its own height, and gives cruise mode a road', () => {
    expect(layout.targetSpawns.length).toBeGreaterThan(120);
    expect(layout.targetSpawns.length).toBeLessThan(300);
    const levels = new Set<number>();
    for (let k = 0; k < layout.targetSpawns.length; k++) {
      const s = layout.targetSpawns[k];
      const y = s.y ?? 0;
      levels.add(Math.round(y / 12));
      let onRoad = false;
      for (const rb of plan.ribbons) {
        projectOntoPath(rb.path, s.x, s.z, PROJ);
        if (PROJ.dist <= PROJ.halfWidth && Math.abs(PROJ.y - y) < 1) onRoad = true;
      }
      expect(onRoad, `car ${k} at (${s.x.toFixed(0)}, ${s.z.toFixed(0)}, y ${y.toFixed(1)})`).toBe(true);
      expect(blockedAt(layout, s.x, s.z, y, VEHICLE.collisionRadius)).toBeNull();
    }
    expect([...levels].sort()).toEqual([0, 1, 2, 3]);
    for (const w of layout.cruiseRoute) expect(plan.isRoad(w.x, w.z)).toBe(true);
    const spawn = layout.playerSpawn;
    expect(plan.isRoad(spawn.x, spawn.z, -2)).toBe(true);
    expect(blockedAt(layout, spawn.x, spawn.z, 0, VEHICLE.collisionRadius)).toBeNull();
  });
});

describe('metro ramps', () => {
  it('ends every ramp inside another road at that road\'s height: no dead ends', () => {
    for (const rb of ramps) {
      const s = rb.path.samples;
      expect(hostOf(s[0], rb), `${rb.tag} start`).not.toBeNull();
      expect(hostOf(s[s.length - 1], rb), `${rb.tag} end`).not.toBeNull();
    }
  });

  it('gives both directions of the viaduct a way up and a way down', () => {
    const viaduct = loops.find((rb) => rb.tag === 'viaduct')!;
    let along = 0;
    let against = 0;
    for (const rb of ramps) {
      const s = rb.path.samples;
      const end = hostOf(s[s.length - 1], rb);
      if (!end || end.rb !== viaduct) continue;
      expect(Math.abs(end.dot), `${rb.tag} merges tangentially`).toBeGreaterThan(0.95);
      if (end.dot > 0) along++;
      else against++;
    }
    expect(along).toBeGreaterThanOrEqual(2);
    expect(against).toBeGreaterThanOrEqual(2);
  });
});

describe('metro districts: the Stack\'s rules inside its footprint, the Bay\'s outside', () => {
  it('stands the Stack\'s blocks at the kerb and the Bay\'s behind a pavement', () => {
    expect(plan.finishAt!(0, -120)).toBe('concrete');
    expect(plan.finishAt!(-600, -560)).toBe('glass');
    expect(plan.setbackAt!(0, -120)).toBe(0.5);
    expect(plan.setbackAt!(-600, 300)).toBe(3.4);
    expect(plan.shoulderAt!(0, -120, 'corporate')).toBeLessThan(1);
    expect(plan.shoulderAt!(-600, 300, 'urban')).toBe(3.2);
    // The kerb field agrees: a street in the Stack keeps no pavement, a boulevard outside does.
    const central = ground.find((rb) => rb.tag === 'av-central')!;
    const kerbs = plan.kerbs!;
    let insidePaved = 0;
    let outsidePaved = 0;
    for (let i = 0; i < central.path.samples.length - 1; i++) {
      const s = central.path.samples[i];
      const paved = kerbs.paved(central, i, 1) || kerbs.paved(central, i, -1);
      if (inRect(STACK_RECT, s.x, s.z, -20)) insidePaved += paved ? 1 : 0;
      else if (paved) outsidePaved++;
    }
    expect(insidePaved).toBe(0);
    expect(outsidePaved).toBeGreaterThan(20);
  });

  it('bridges the Stack\'s avenues at its tiers and the outer boulevards lower, both clear of every road', () => {
    const bridges = plan.skybridges!;
    const inside = bridges.filter((sb) => inRect(STACK_RECT, (sb.ax + sb.bx) / 2, (sb.az + sb.bz) / 2));
    const outside = bridges.filter((sb) => !inRect(STACK_RECT, (sb.ax + sb.bx) / 2, (sb.az + sb.bz) / 2));
    expect(inside.length).toBeGreaterThan(8);
    expect(outside.length).toBeGreaterThan(8);
    for (const sb of inside) expect([16, 27, 40]).toContain(sb.y);
    for (const sb of outside) expect([12, 15, 19, 24]).toContain(sb.y);
    expect(inside.some((sb) => sb.kind === 'concrete')).toBe(true);
    for (const sb of bridges) {
      const mx = (sb.ax + sb.bx) / 2;
      const mz = (sb.az + sb.bz) / 2;
      for (const rb of elevated) {
        projectOntoPath(rb.path, mx, mz, PROJ);
        if (PROJ.dist > PROJ.halfWidth + 4) continue;
        expect(Math.abs(PROJ.y - sb.y), `bridge at (${mx.toFixed(0)}, ${mz.toFixed(0)}) meets ${rb.tag}`).toBeGreaterThan(DRIVE_UNDER);
      }
    }
  });

  it('zones the water and the south-east as old town, the south-west as corporate, downtown as the Stack\'s', () => {
    expect(plan.zoneAt(-300, 1150)).toBe('jdm');
    expect(plan.zoneAt(600, 800)).toBe('jdm');
    expect(plan.zoneAt(-500, 700)).toBe('corporate');
    expect(plan.zoneAt(-30, -80)).toBe('corporate');
    expect(plan.zoneAt(175, 80)).toBe('jdm');
    expect(plan.zoneAt(-660, 300)).toBe('urban');
    expect(plan.neonDistricts!.length).toBe(1);
  });
});

describe('metro bus network and activities', () => {
  it('puts shelters on the ring and the boulevards, each on the kerb and clear of every road', () => {
    const stops = plan.busStops!;
    expect(stops.length).toBeGreaterThan(20);
    expect(stops.length).toBeLessThan(80);
    expect(layout.busRoutes!.length).toBe(METRO_SPEC.busRouteLoops.length);
    for (const st of stops) {
      expect(plan.isSolid(st.x, st.z, 0.4)).toBe(false);
      for (const rb of plan.ribbons) expect(plan.isRoad(st.x, st.z, -0.1) && rb.elevated ? false : true).toBe(true);
    }
    for (const tag of METRO_BUS_ROUTES) expect(ground.some((rb) => rb.tag === tag), tag).toBe(true);
    for (const route of layout.busRoutes!) expect(route.stops.length).toBeGreaterThan(0);
  });

  it('paints the RUSH sites and the passenger stops on roads, apart from each other', () => {
    for (const site of layout.rushSites!) {
      expect(plan.isRoad(site.x, site.z, -RUSH.marker.promptRadius * 0.6), site.label).toBe(true);
      expect(blockedAt(layout, site.x, site.z, 0, RUSH.marker.promptRadius), site.label).toBeNull();
    }
    expect(layout.rushSites!.length).toBe(METRO_RUSH_SITES.length);
    const stops = layout.passengerStops!;
    expect(validatePassengerCatalog(PASSENGERS, stops)).toEqual([]);
    for (const stop of stops) {
      expect(plan.isRoad(stop.x, stop.z, -PASSENGER.marker.promptRadius * 0.6), `${stop.id} is not on a road`).toBe(true);
      expect(blockedAt(layout, stop.x, stop.z, 0, PASSENGER.marker.promptRadius), stop.id).toBeNull();
      for (const site of layout.rushSites!) {
        expect(Math.hypot(site.x - stop.x, site.z - stop.z), `${stop.id} is on top of a RUSH site`).toBeGreaterThan(RUSH.marker.rearmRadius + PASSENGER.marker.exitRadius);
      }
      for (const other of stops) {
        if (other === stop) continue;
        expect(Math.hypot(other.x - stop.x, other.z - stop.z), `${stop.id} and ${other.id} are too close`).toBeGreaterThan(PASSENGER.marker.exitRadius * 6);
      }
    }
  });

  it('stands El Búho under the viaduct on level, drivable, empty ground', () => {
    const site = layout.buhoSite!;
    const m = MOOGUL.marker;
    for (const [ox, oz] of [
      [0, 0],
      [m.promptRadius * 0.7, 0],
      [-m.promptRadius * 0.7, 0],
      [0, m.promptRadius * 0.7],
      [0, -m.promptRadius * 0.7],
    ]) {
      const x = site.x + ox;
      const z = site.z + oz;
      expect(plan.isRoad(x, z), `(${x}, ${z}) is not drivable`).toBe(true);
      expect(plan.isSolid(x, z), `(${x}, ${z}) is inside something`).toBe(false);
      layout.surface!.sample(x, z, 0, SAMPLE);
      expect(SAMPLE.y).toBe(0);
      expect(blockedAt(layout, x, z, 0, VEHICLE.collisionRadius), `(${x}, ${z})`).toBeNull();
    }
    // Under the deck, not beside it.
    const viaduct = loops.find((rb) => rb.tag === 'viaduct')!;
    projectOntoPath(viaduct.path, site.x, site.z, PROJ);
    expect(PROJ.dist).toBeLessThan(2);
    expect(PROJ.y).toBe(METRO_VIADUCT_Y);
  });
});

describe('metro art budget', () => {
  it('builds the whole city in chunks inside a ceiling the machine can hold', () => {
    const b = createBuilders(plan);
    buildCity(b);
    buildProps(b);
    buildTransit(b);
    buildTrack(b);
    buildLandmarks(b);
    const screens = buildScreens(b);
    buildCarMeets(b);
    buildReclamation(b);
    const { triangles, drawCalls } = builderStats(b);
    // Downtown's screens, and only downtown's.
    expect(screens.length).toBeGreaterThan(150);
    for (const p of screens) expect(p.x > STACK_RECT.minX - 20 && p.x < STACK_RECT.maxX + 20 && p.z > STACK_RECT.minZ - 20 && p.z < STACK_RECT.maxZ + 20, `${p.kind} at (${p.x}, ${p.z})`).toBe(true);
    // Nine times the Bay's area with the Stack at the top. Drawn in chunks and culled by
    // distance (`CityPlan.render`), so what the GPU sees per frame is a Stack's worth; the
    // whole must still fit in memory as one set of arrays while it is built.
    expect(triangles).toBeLessThan(1_600_000);
    expect(drawCalls).toBeLessThanOrEqual(20);
  }, 120_000);
});

/* ------------------------------------------------------------------ the car meet */

type Pt = { x: number; z: number };

/** Least distance between two convex quads, 0 when they overlap. */
function quadGap(a: Pt[], b: Pt[]): number {
  const axes = (q: Pt[]): Pt[] => q.map((p, i) => {
    const n = q[(i + 1) % q.length];
    const len = Math.hypot(n.x - p.x, n.z - p.z) || 1;
    return { x: -(n.z - p.z) / len, z: (n.x - p.x) / len };
  });
  let separated = false;
  for (const ax of [...axes(a), ...axes(b)]) {
    const pa = a.map((p) => p.x * ax.x + p.z * ax.z);
    const pb = b.map((p) => p.x * ax.x + p.z * ax.z);
    if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) separated = true;
  }
  if (!separated) return 0;
  const segDist = (p: Pt, u: Pt, v: Pt): number => {
    const ex = v.x - u.x;
    const ez = v.z - u.z;
    const t = Math.max(0, Math.min(1, ((p.x - u.x) * ex + (p.z - u.z) * ez) / (ex * ex + ez * ez || 1)));
    return Math.hypot(u.x + ex * t - p.x, u.z + ez * t - p.z);
  };
  let best = Infinity;
  for (const [q, r] of [[a, b], [b, a]]) {
    for (const p of q) for (let i = 0; i < r.length; i++) best = Math.min(best, segDist(p, r[i], r[(i + 1) % r.length]));
  }
  return best;
}

const boxQuad = (b: { minX: number; maxX: number; minZ: number; maxZ: number }): Pt[] => [
  { x: b.minX, z: b.minZ }, { x: b.maxX, z: b.minZ }, { x: b.maxX, z: b.maxZ }, { x: b.minX, z: b.maxZ },
];

describe('the car meet under the viaduct corner', () => {
  const meet = plan.meets![0];
  const lot = meet.lot;
  const solids = meetSolids(meet);
  const overlapsLot = (r: { minX: number; maxX: number; minZ: number; maxZ: number }): boolean =>
    r.maxX > lot.minX && r.minX < lot.maxX && r.maxZ > lot.minZ && r.minZ < lot.maxZ;
  const columns = layout.colliders.filter((c) => c.tag === 'pillar' && overlapsLot(c));

  it('gives up the block inside the corner: no building, no fence, the curve still on its columns', () => {
    expect(meet).toEqual(METRO_SPEC.meets![0]);
    expect(plan.meets).toHaveLength(1);
    expect(plan.blocks.filter(overlapsLot)).toEqual([]);
    for (const f of plan.fences!) {
      const mx = (f.ax + f.bx) / 2;
      const mz = (f.az + f.bz) / 2;
      expect(inRect(lot, mx, mz, 2), `fence at (${mx.toFixed(0)}, ${mz.toFixed(0)})`).toBe(false);
    }
    // The viaduct's corner crosses the lot: seven piers of it stand on it.
    const viaduct = loops.find((rb) => rb.tag === 'viaduct')!;
    expect(viaduct.path.samples.filter((sm) => inRect(lot, sm.x, sm.z)).length).toBeGreaterThan(10);
    expect(columns.length).toBeGreaterThanOrEqual(12);
    // The map shows it.
    expect(layout.minimap.rects).toContainEqual(lot);
  });

  it('parks sixteen cars, and stands everything on the lot clear of the columns, the edges and each other', () => {
    expect(meet.cars).toHaveLength(16);
    const inner = MEET_EDGE.thick + 0.3;
    const quads = solids.map((sd) => ({ sd, q: solidCorners(sd) }));
    for (const { sd, q } of quads) {
      const name = `${sd.tag} at (${sd.x.toFixed(1)}, ${sd.z.toFixed(1)})`;
      for (const p of q) {
        expect(inRect(lot, p.x, p.z, -inner), `${name} inside the lot`).toBe(true);
        for (const rb of ground) expect(isOnPath(rb.path, p.x, p.z), `${name} on ${rb.tag}`).toBe(false);
      }
      for (const c of columns) expect(quadGap(q, boxQuad(c)), `${name} against a column`).toBeGreaterThan(0.4);
    }
    for (let i = 0; i < quads.length; i++) {
      for (let j = i + 1; j < quads.length; j++) {
        const a = quads[i].sd;
        const b = quads[j].sd;
        // People stand close to what they are looking at; cars and props keep a door's width.
        const need = a.tag === 'meet-person' || b.tag === 'meet-person' ? 0.25 : 0.7;
        // The vending machines stand against the kiosk on purpose.
        if ([a.tag, b.tag].includes('meet-kiosk') && [a.tag, b.tag].includes('meet-vending')) continue;
        expect(quadGap(quads[i].q, quads[j].q), `${a.tag} (${a.x}, ${a.z}) and ${b.tag} (${b.x}, ${b.z})`).toBeGreaterThan(need);
      }
    }
  });

  it('can be driven into through every opening and across to every corner of it', () => {
    const r = VEHICLE.collisionRadius;
    const pad = 12;
    const near = {
      ...layout,
      colliders: layout.colliders.filter((c) => c.maxX > lot.minX - pad && c.minX < lot.maxX + pad && c.maxZ > lot.minZ - pad && c.minZ < lot.maxZ + pad),
      walls: layout.walls.filter((w) => Math.max(w.ax, w.bx) > lot.minX - pad && Math.min(w.ax, w.bx) < lot.maxX + pad && Math.max(w.az, w.bz) > lot.minZ - pad && Math.min(w.az, w.bz) < lot.maxZ + pad),
    };
    const x0 = lot.minX - 6;
    const z0 = lot.minZ - 6;
    const nx = Math.ceil(lot.maxX - lot.minX + 12);
    const nz = Math.ceil(lot.maxZ - lot.minZ + 12);
    const open = new Uint8Array(nx * nz);
    for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) open[i + k * nx] = blockedAt(near, x0 + i + 0.5, z0 + k + 0.5, 0.5, r) === null ? 1 : 0;
    const cell = (x: number, z: number): number => Math.floor(x - x0) + Math.floor(z - z0) * nx;
    // Flood from the boulevard outside the main gate, moving only on the lot or on a road.
    const seen = new Uint8Array(nx * nz);
    const queue = [cell(-577, lot.minZ - 3)];
    seen[queue[0]] = 1;
    while (queue.length) {
      const c = queue.pop()!;
      const ci = c % nx;
      const ck = Math.floor(c / nx);
      for (const [di, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const i = ci + di;
        const k = ck + dk;
        if (i < 0 || k < 0 || i >= nx || k >= nz) continue;
        const n = i + k * nx;
        if (seen[n] || !open[n]) continue;
        const x = x0 + i + 0.5;
        const z = z0 + k + 0.5;
        if (!inRect(lot, x, z) && !plan.isRoad(x, z, 4)) continue;
        seen[n] = 1;
        queue.push(n);
      }
    }
    const reached = (x: number, z: number): boolean => seen[cell(x, z)] === 1;
    // Outside the other three ways in: the avenue, and the two streets the curve leaves by.
    expect(reached(lot.minX - 3, 307), 'from av-w1').toBe(true);
    expect(reached(-549.5, lot.maxZ + 3), 'from st-s3, under the deck').toBe(true);
    expect(reached(lot.maxX + 3, 291), 'from st-w3, under the deck').toBe(true);
    // And the lot itself: the open middle, the cars' fan, the pocket inside the curve.
    expect(reached(-565, 265), 'the middle').toBe(true);
    expect(reached(-576, 305), 'in front of the fan').toBe(true);
    expect(reached(-518, 330), 'the pocket').toBe(true);
  });

  it('closes the lot everywhere but its four ways in', () => {
    const walls = meetWalls(METRO_MEET);
    const covered = (side: string, v: number): boolean => walls.some((w) => w.side === side && v >= Math.min(w.from, w.to) && v <= Math.max(w.from, w.to));
    const gaps = (side: string, from: number, to: number): number => {
      let n = 0;
      let open = false;
      for (let v = from + 0.25; v < to; v += 0.5) {
        const o = !covered(side, v);
        if (o && !open) n++;
        open = o;
      }
      return n;
    };
    expect(gaps('n', lot.minX, lot.maxX)).toBe(1);
    expect(gaps('w', lot.minZ, lot.maxZ)).toBe(1);
    expect(gaps('s', lot.minX, lot.maxX)).toBe(1);
    expect(gaps('e', lot.minZ, lot.maxZ)).toBe(1);
  });
});
