import { describe, expect, it } from 'vitest';
import type { GameEvent, RaceCourse } from '../src/core/types';
import { SIM_STEP, STREET_RACE } from '../src/config/tuning';
import { createPlayerCommand } from '../src/core/input/keyboard';
import { emptyStreetRaceProgress, recordStreetRace } from '../src/core/progress';
import { INTRO } from '../src/content/intro';
import { createInitialGameState, createVehicleState, stepGame } from '../src/sim/gameState';
import { createRaceState, gateCrossing, stepRace } from '../src/sim/race';
import { canEnterStreetRace, createStreetGateState, stepStreetGate, streetEventCount, streetEventOpen, streetEventStandalone } from '../src/sim/streetGate';
import { createStreetRaceState, stepStreetRace, streetEvent, streetPosition } from '../src/sim/streetRace';
import { meetSolids } from '../src/world/carMeet';
import { CURVA_LAPS, CURVA_SHORTCUTS, CURVA_SITE } from '../src/world/curvaSpec';
import { createCurvaWorld } from '../src/world/curvaWorld';
import { METRO_MEET, METRO_MEET_LOT, METRO_STREET_SITES } from '../src/world/metroSpec';
import { createProjection, pointAtStation, projectOntoPath, type TrackPath } from '../src/world/track';

/**
 * LA CURVA: the Street Race series on Bandido Metro, met at one ring on the car meet's lot.
 *
 * Pinned: the ribbon is on the city's roads and decks at their own heights with nothing solid in
 * it; the lap climbs onto the viaduct over the meet and runs The Stack's deck; no straight is
 * long; the fence is closed everywhere but the branch mouths; each branch validates a lap; the
 * ring is on the lot and offers each harder event in place; and three rivals drive it home.
 */

const DT = SIM_STEP;
/** The first and the hardest event of the series, both on this course. */
const CURVA = 0;
const HARD = STREET_RACE.events.length - 1;
const world = createCurvaWorld(4321);
const course = world.layout.race as RaceCourse;
const path = course.path;
const ribbons: TrackPath[] = [path, ...course.shortcuts.map((sc) => sc.path)];

/* ------------------------------------------------------------------ the ribbon */

const roads = (world.plan.ribbons ?? []).map((r) => r.path);
const roadProj = createProjection();
function drivable(x: number, z: number, y: number): boolean {
  for (const p of roads) {
    projectOntoPath(p, x, z, roadProj, -1, 12, y);
    if (roadProj.dist <= roadProj.halfWidth && Math.abs(roadProj.y - y) <= 1.5) return true;
  }
  return false;
}

function offRoad(p: TrackPath): string[] {
  const out: string[] = [];
  for (const s of p.samples) {
    for (let k = 0; k < 9; k++) {
      const lat = (k / 8 - 0.5) * 2 * s.halfWidth;
      const x = s.x + -s.tz * lat;
      const z = s.z + s.tx * lat;
      if (!drivable(x, z, s.y)) out.push(`${x.toFixed(1)},${z.toFixed(1)}@${s.y.toFixed(1)}`);
    }
  }
  return out;
}

const inProj = createProjection();
/** The course ribbon (if any) a point at height lo..hi of something solid would stand in. */
function insideRibbon(x: number, z: number, lo: number, hi: number): boolean {
  for (const p of ribbons) {
    projectOntoPath(p, x, z, inProj, -1, 12, (lo + hi) / 2);
    if (inProj.dist < inProj.halfWidth - 0.3 && lo < inProj.y + 1.5 && hi > inProj.y + 0.3) return true;
  }
  return false;
}

/** Whether segment p0-p1 meets segment a-b. */
function hits(p0x: number, p0z: number, p1x: number, p1z: number, ax: number, az: number, bx: number, bz: number): boolean {
  const dx = p1x - p0x;
  const dz = p1z - p0z;
  return gateCrossing(p0x, p0z, p1x, p1z, ax, az, bx, bz, dx, dz) !== 0;
}

/** Only what comes within a street's width of the course is walked in detail. */
function nearCourse(minX: number, maxX: number, minZ: number, maxZ: number): boolean {
  return ribbons.some((p) => p.samples.some((s) => s.x > minX - 12 && s.x < maxX + 12 && s.z > minZ - 12 && s.z < maxZ + 12));
}

describe('the La Curva circuit', () => {
  it('stands on the metro roads, ramps and decks at their own heights, lap and branches alike', () => {
    for (const p of ribbons) expect(offRoad(p)).toEqual([]);
  });

  it('has nothing solid inside the ribbon at its height: no column, rail, shelter or wall', () => {
    const hits: string[] = [];
    for (const b of world.layout.colliders) {
      if (!nearCourse(b.minX, b.maxX, b.minZ, b.maxZ)) continue;
      for (let x = b.minX; x <= b.maxX; x += 0.5) {
        for (let z = b.minZ; z <= b.maxZ; z += 0.5) if (insideRibbon(x, z, b.minY ?? -100, b.maxY ?? 1000)) hits.push(`${b.tag} ${x},${z}`);
      }
    }
    for (const w of world.layout.walls) {
      if (w.tag === 'neon-wall' || w.tag === 'bus') continue;
      if (!nearCourse(Math.min(w.ax, w.bx), Math.max(w.ax, w.bx), Math.min(w.az, w.bz), Math.max(w.az, w.bz))) continue;
      const steps = Math.max(1, Math.ceil(Math.hypot(w.bx - w.ax, w.bz - w.az) / 0.5));
      for (let i = 0; i <= steps; i++) {
        const x = w.ax + ((w.bx - w.ax) * i) / steps;
        const z = w.az + ((w.bz - w.az) * i) / steps;
        if (insideRibbon(x, z, w.minY ?? -100, w.maxY ?? 1000)) {
          hits.push(`${w.tag} ${x.toFixed(1)},${z.toFixed(1)}`);
          break;
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it('climbs onto the viaduct, takes its curve over La Curva, and runs The Stack deck', () => {
    const lot = METRO_MEET_LOT;
    const overMeet = path.samples.filter((s) => s.y > 14 && s.x > lot.minX && s.x < lot.maxX && s.z > lot.minZ && s.z < lot.maxZ);
    expect(overMeet.length).toBeGreaterThan(10);
    const onDeck = path.samples.filter((s) => Math.abs(s.y - 12) < 0.5);
    let deckLength = 0;
    for (let i = 1; i < path.samples.length; i++) {
      if (Math.abs(path.samples[i].y - 12) < 0.5 && Math.abs(path.samples[i - 1].y - 12) < 0.5) deckLength += path.samples[i].s - path.samples[i - 1].s;
    }
    expect(onDeck.length).toBeGreaterThan(50);
    expect(deckLength).toBeGreaterThan(1000);
  });

  it('has no long plain straight and plenty of corners', () => {
    const straights = path.pieces.filter((p) => p.kind === 'straight').map((p) => p.length);
    expect(Math.max(...straights)).toBeLessThan(340);
    expect(path.pieces.filter((p) => p.kind === 'arc').length).toBeGreaterThanOrEqual(25);
    expect(path.length).toBeGreaterThan(3000);
  });

  it('is fenced shut: from anywhere on the course, the only way out of the ribbon is into a branch', () => {
    const walls = world.plan.neonWalls ?? [];
    // Walls bucketed on a 10 m grid, so every half metre of both edges can be probed.
    const CELL = 10;
    const buckets = new Map<string, typeof walls>();
    for (const w of walls) {
      for (let cx = Math.floor(Math.min(w.ax, w.bx) / CELL); cx <= Math.floor(Math.max(w.ax, w.bx) / CELL); cx++) {
        for (let cz = Math.floor(Math.min(w.az, w.bz) / CELL); cz <= Math.floor(Math.max(w.az, w.bz) / CELL); cz++) {
          const k = `${cx},${cz}`;
          const list = buckets.get(k) ?? [];
          list.push(w);
          buckets.set(k, list);
        }
      }
    }
    const probe = createProjection();
    const at = createProjection();
    const gaps: string[] = [];
    for (let r = 0; r < ribbons.length; r++) {
      const p = ribbons[r];
      for (let st = 0; st <= p.length; st += 0.5) {
        const s = pointAtStation(p, st, at);
        for (const side of [-1, 1]) {
          const nx = -s.tz * side;
          const nz = s.tx * side;
          // From just inside the edge to 2.5 m past it, on three lines half a metre apart along
          // the edge: a car only gets out where all three do, which is a hole 1.5 m wide or more.
          // Anything that does get out has to be on another ribbon of the course.
          const bx = s.x + nx * (s.halfWidth + 2.5);
          const bz = s.z + nz * (s.halfWidth + 2.5);
          const ex = s.x + nx * s.halfWidth;
          const ez = s.z + nz * s.halfWidth;
          const near: typeof walls = [];
          for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) near.push(...(buckets.get(`${Math.floor(ex / CELL) + dx},${Math.floor(ez / CELL) + dz}`) ?? []));
          }
          const crosses = (off: number): boolean => {
            const ox = s.tx * off;
            const oz = s.tz * off;
            const x0 = s.x + nx * (s.halfWidth - 1) + ox;
            const z0 = s.z + nz * (s.halfWidth - 1) + oz;
            const test = (w: (typeof walls)[number]): boolean => Math.abs(Math.min(w.ay, w.by) - s.y) < 3 && hits(x0, z0, bx + ox, bz + oz, w.ax, w.az, w.bx, w.bz);
            return near.some(test);
          };
          let blocked = crosses(-0.5) || crosses(0) || crosses(0.5);
          if (!blocked) {
            for (let o = 0; o < ribbons.length && !blocked; o++) {
              if (o === r) continue;
              projectOntoPath(ribbons[o], bx, bz, probe, -1, 12, s.y);
              const pastEnd = !ribbons[o].closed && (probe.s <= 0.01 || probe.s >= ribbons[o].length - 0.01);
              if (!pastEnd && probe.dist < probe.halfWidth && Math.abs(probe.y - s.y) < 3) blocked = true;
            }
          }
          if (!blocked) gaps.push(`ribbon ${r} ${s.x.toFixed(1)},${s.z.toFixed(1)}@${s.y.toFixed(1)} side ${side}`);
        }
      }
    }
    expect(gaps).toEqual([]);
  });

  it('carries no other activity and no city traffic on the decks', () => {
    const l = world.layout;
    expect(l.rushSites).toBeNull();
    expect(l.passengerStops).toBeNull();
    expect(l.buhoSite).toBeNull();
    expect(l.garageSite).toBeNull();
    expect(l.streetSites).toBeNull();
    expect(l.busRoutes).toEqual([]);
    expect(l.targetSpawns.length).toBe(STREET_RACE.trafficCount);
  });
});

/* ------------------------------------------------------------------ branch gates */

function startAt(s: number): { race: ReturnType<typeof createRaceState>; v: ReturnType<typeof createVehicleState>; time: number; events: GameEvent[] } {
  const race = createRaceState(course);
  const p = pointAtStation(path, s, createProjection());
  const v = createVehicleState(p.x, p.z, Math.atan2(p.tx, -p.tz), p.y);
  const d = { race, v, time: 0, events: [] as GameEvent[] };
  while (race.phase === 'countdown') {
    d.time += DT;
    stepRace(race, course, v, d.time, DT, d.events);
  }
  return d;
}

/** Teleport along a path, a few metres a tick, at the road's own height. */
function follow(d: ReturnType<typeof startAt>, p: TrackPath, from: number, to: number, step = 3): void {
  const out = createProjection();
  if (p.closed && to < from) to += p.length;
  const move = (s: number): void => {
    pointAtStation(p, s, out);
    d.v.prevX = d.v.x;
    d.v.prevZ = d.v.z;
    d.v.x = out.x;
    d.v.z = out.z;
    d.v.y = out.y;
    d.v.vx = (out.x - d.v.prevX) / DT;
    d.v.vz = (out.z - d.v.prevZ) / DT;
    d.time += DT;
    d.events.length = 0;
    stepRace(d.race, course, d.v, d.time, DT, d.events);
  };
  for (let s = from; s <= to; s += step) move(s);
  move(to);
}

const lineS = course.gates[0].s;
const branches = course.gates.map((g, i) => (g.alt ? i : -1)).filter((i) => i >= 0);

describe('La Curva branch gates', () => {
  it('has two branch gates, each between two mandatory ones', () => {
    expect(course.shortcuts).toHaveLength(CURVA_SHORTCUTS.length);
    expect(branches).toHaveLength(2);
    for (const b of branches) {
      expect(course.gates[b - 1].alt).toBeUndefined();
      expect(course.gates[(b + 1) % course.gates.length].alt).toBeUndefined();
    }
  });

  it('validates the whole lap on the main road, over and under itself, and takes the flag', () => {
    const d = startAt(lineS - 10);
    let at = lineS - 10;
    for (let k = 1; k < course.gates.length; k++) {
      let to = course.gates[k].s + 4;
      if (to < at) to += path.length;
      follow(d, path, at, to);
      expect(d.race.nextGate).toBe(k + 1 < course.gates.length ? k + 1 : 0);
      at = to;
    }
    follow(d, path, at, lineS + path.length + 5);
    expect(d.race.phase).toBe('finished');
  });

  it('validates each branch, and counts its gate exactly once', () => {
    for (let i = 0; i < course.shortcuts.length; i++) {
      const sc = course.shortcuts[i];
      const b = branches.find((k) => {
        const alt = course.gates[k].alt!;
        return projectOntoPath(sc.path, (alt.ax + alt.bx) / 2, (alt.az + alt.bz) / 2, createProjection()).dist < 2;
      });
      expect(b).toBeDefined();
      const d = startAt(lineS - 10);
      follow(d, path, lineS - 10, course.gates[b! - 1].s + 4);
      expect(d.race.nextGate).toBe(b);
      follow(d, sc.path, 0, sc.path.length);
      expect(d.race.nextGate).toBe(b! + 1);
      follow(d, path, sc.sOut, course.gates[(b! + 1) % course.gates.length].s + 4);
      expect(d.race.nextGate === (b! + 2) % course.gates.length || d.race.phase === 'finished').toBe(true);
    }
  });

  it('keeps the race station on the level the car is on where the lap passes over itself', () => {
    const proj = createProjection();
    for (const s of path.samples) {
      projectOntoPath(path, s.x, s.z, proj, -1, 12, s.y);
      let d = Math.abs(proj.s - s.s);
      d = Math.min(d, path.length - d);
      expect(d).toBeLessThan(6);
    }
  });
});

/* ------------------------------------------------------------------ the ring and the rules */

describe('La Curva as the series', () => {
  it('runs every event on La Curva, one lap each, from one ring, each harder than the last', () => {
    expect(STREET_RACE.events.every((e) => e.course === 'curva' && !e.standalone)).toBe(true);
    expect(streetEventCount()).toBe(STREET_RACE.events.length);
    for (let i = 0; i < STREET_RACE.events.length; i++) {
      expect(streetEvent(i).laps).toBe(CURVA_LAPS);
      expect(streetEventStandalone(i)).toBe(false);
      if (i > 0) expect(streetEvent(i).rivals).toBeGreaterThan(streetEvent(i - 1).rivals);
    }
    expect(streetEvent(HARD).rivals).toBe(3);
    expect(streetEventOpen(0, 1)).toBe(false);
    expect(course.laps).toBe(CURVA_LAPS);
    expect(METRO_STREET_SITES).toEqual([CURVA_SITE]);
  });

  it('puts its ring on La Curva lot, clear of the cars, the people, the props and the intro', () => {
    const l = METRO_MEET_LOT;
    const r = STREET_RACE.marker.promptRadius;
    expect(CURVA_SITE.x - r).toBeGreaterThan(l.minX);
    expect(CURVA_SITE.x + r).toBeLessThan(l.maxX);
    expect(CURVA_SITE.z - r).toBeGreaterThan(l.minZ);
    expect(CURVA_SITE.z + r).toBeLessThan(l.maxZ);
    for (const s of meetSolids(METRO_MEET)) {
      expect(Math.hypot(s.x - CURVA_SITE.x, s.z - CURVA_SITE.z) - Math.max(s.halfAlong, s.halfAcross)).toBeGreaterThan(r + 2);
    }
    expect(Math.hypot(INTRO.route.meetup.x - CURVA_SITE.x, INTRO.route.meetup.z - CURVA_SITE.z)).toBeGreaterThan(r + INTRO.route.meetup.radius + 20);
  });

  it('offers the newest event on the same ring, and enters it', () => {
    const cmd = createPlayerCommand();
    const events: GameEvent[] = [];
    for (let cleared = 0; cleared <= STREET_RACE.events.length; cleared++) {
      const s = createStreetGateState(cleared);
      const v = createVehicleState(CURVA_SITE.x, CURVA_SITE.z, 0);
      cmd.activate = false;
      stepStreetGate(s, METRO_STREET_SITES, v, cmd, events);
      expect(canEnterStreetRace(s)).toBe(true);
      expect(s.atSite).toBe(Math.min(cleared, HARD));
      cmd.activate = true;
      events.length = 0;
      stepStreetGate(s, METRO_STREET_SITES, v, cmd, events);
      expect(events).toContainEqual({ type: 'streetRaceEnter', event: Math.min(cleared, HARD) });
    }
  });

  it('pays a win once, moves the series on, and fields three rivals at the top', () => {
    const sr = createStreetRaceState(course, HARD, HARD);
    expect(sr.event).toBe(HARD);
    expect(sr.rivals).toHaveLength(3);
    const state = createInitialGameState(world.layout, 'auto', {});
    sr.phase = 'racing';
    state.race!.phase = 'finished';
    state.race!.finishTime = 150;
    stepStreetRace(sr, world.layout, state, DT, state.events);
    expect(sr.results?.won).toBe(true);
    expect(sr.results?.advanced).toBe(true);
    expect(sr.results?.allClear).toBe(true);
    expect(sr.results?.unlockedName).toBeNull();
    expect(sr.results?.reward).toBe(streetEvent(HARD).reward);
    expect(state.economy.money).toBe(streetEvent(HARD).reward);

    // A replay of an event already won pays nothing and leaves the series where it is.
    const again = createStreetRaceState(course, 0, 1);
    const state2 = createInitialGameState(world.layout, 'auto', {});
    again.phase = 'racing';
    state2.race!.phase = 'finished';
    state2.race!.finishTime = 150;
    stepStreetRace(again, world.layout, state2, DT, state2.events);
    expect(again.results?.reward).toBe(0);
    expect(again.cleared).toBe(1);

    const p = recordStreetRace(emptyStreetRaceProgress(), CURVA, 1, true);
    expect(p.cleared).toBe(1);
    expect(p.best[CURVA]).toBe(1);
  });
});

/* ------------------------------------------------------------------ the rivals */

describe('La Curva rivals', () => {
  it('drive the real cars round the lap, up and down the highways, on the route, and take the flag', () => {
    const state = createInitialGameState(world.layout, 'auto', {});
    const sr = createStreetRaceState(course, HARD, HARD);
    const cmd = createPlayerCommand();
    const proj = createProjection();
    let worstOff = 0;
    let highest = 0;
    let finishedAt = -1;
    const limit = 240;
    for (let t = 0; t < limit && finishedAt < 0; t += DT) {
      stepGame(state, cmd, world.layout, DT);
      stepStreetRace(sr, world.layout, state, DT, state.events);
      for (const r of sr.rivals) {
        const p = r.ai.route >= 0 ? course.shortcuts[r.ai.route].path : path;
        projectOntoPath(p, r.v.x, r.v.z, proj, -1, 12, r.v.y);
        worstOff = Math.max(worstOff, proj.dist - proj.halfWidth);
        highest = Math.max(highest, r.v.y);
      }
      if (sr.rivals.every((r) => r.race.phase === 'finished')) finishedAt = state.time;
    }
    expect(finishedAt).toBeGreaterThan(0);
    expect(highest).toBeGreaterThan(14);
    expect(worstOff).toBeLessThan(STREET_RACE.recovery.offRouteMetres);
    for (const r of sr.rivals) expect(r.race.phase).toBe('finished');
    expect(streetPosition(sr, state.race!)).toBe(sr.rivals.length + 1);
  }, 120000);
});
