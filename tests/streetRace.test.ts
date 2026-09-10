import { afterEach, describe, expect, it } from 'vitest';
import type { GameEvent, RaceCourse } from '../src/core/types';
import { MOOGUL, PASSENGER, RUSH, SIM_STEP, STREET_RACE, TIME_ATTACK } from '../src/config/tuning';
import { createPlayerCommand } from '../src/core/input/keyboard';
import { emptyStreetRaceProgress, readStreetRaceProgress, recordStreetRace, writeStreetRaceProgress } from '../src/core/progress';
import { createInitialGameState, createVehicleState, stepGame } from '../src/sim/gameState';
import { isPoliceEnabledForCurrentGameState } from '../src/sim/police';
import { createRaceState, stepRace } from '../src/sim/race';
import { canEnterStreetRace, createStreetGateState, stepStreetGate, streetEventOpen, streetNewestEvent } from '../src/sim/streetGate';
import {
  createStreetRaceState,
  resetStreetRace,
  stepStreetRace,
  streetEvent,
  streetPosition,
  streetTierFor,
} from '../src/sim/streetRace';
import { createCityWorld } from '../src/world/cityWorld';
import { addCircuitGate, circuitGateSite } from '../src/world/cityCircuitGate';
import { addStreetSites } from '../src/world/cityStreetSites';
import { BUHO_SITE, CITY_ROADS, PASSENGER_STOPS, RAMP_SPECS, RUSH_SITES, VIADUCT_SPEC } from '../src/world/citySpec';
import { STREET_SHORTCUTS, STREET_SITES, STREET_SPEC } from '../src/world/streetSpec';
import { createStreetWorld } from '../src/world/streetWorld';
import { buildTrackPath, createProjection, pointAtStation, projectOntoPath, type TrackPath } from '../src/world/track';

/**
 * STREET RACE: the Quay Circuit, the branch gates, the series and the rivals.
 *
 * Five promises are pinned: the ribbon stands on the city's own roads; a lap validates down
 * either branch and never by skipping both; the series unlocks only on a win and remembers it;
 * the police are off for the whole of it; and a rival drives the real car round the real lap.
 */

const DT = SIM_STEP;
const world = createStreetWorld(4321);
const course = world.layout.race as RaceCourse;
const path = course.path;

/* ------------------------------------------------------------------ the roads */

const roads: Array<{ tag: string; path: TrackPath }> = [
  ...CITY_ROADS.map((r) => ({ tag: r.tag, path: buildTrackPath(r.spec) })),
  ...RAMP_SPECS.map((r) => ({ tag: r.tag, path: buildTrackPath(r.spec) })),
  { tag: 'viaduct', path: buildTrackPath(VIADUCT_SPEC) },
];
const roadProj = createProjection();
function roadAt(x: number, z: number, y: number): string | null {
  for (const r of roads) {
    projectOntoPath(r.path, x, z, roadProj);
    if (roadProj.dist <= roadProj.halfWidth && Math.abs(roadProj.y - y) <= 2.5) return r.tag;
  }
  return null;
}

function offRoad(p: TrackPath): Array<{ x: number; z: number }> {
  const out: Array<{ x: number; z: number }> = [];
  for (const s of p.samples) {
    for (let k = 0; k < 9; k++) {
      const lat = (k / 8 - 0.5) * 2 * s.halfWidth;
      const x = s.x + -s.tz * lat;
      const z = s.z + s.tx * lat;
      if (!roadAt(x, z, s.y)) out.push({ x, z });
    }
  }
  return out;
}

describe('the Quay Circuit', () => {
  it('stands on the city roads edge to edge, main lap and alleys alike', () => {
    expect(offRoad(path)).toEqual([]);
    for (const sc of course.shortcuts) expect(offRoad(sc.path)).toEqual([]);
  });

  it('is a different lap from the Bandido Grid, at ground level, with two real shortcuts', () => {
    expect(STREET_SPEC.nodes.length).toBeGreaterThanOrEqual(8);
    expect(path.length).toBeGreaterThan(900);
    expect(course.shortcuts).toHaveLength(STREET_SHORTCUTS.length);
    expect(course.shortcuts.length).toBeGreaterThanOrEqual(2);
    for (const sc of course.shortcuts) {
      // Each alley saves real distance against the stretch of lap it skips.
      let span = sc.sOut - sc.sIn;
      if (span < 0) span += path.length;
      expect(sc.path.length).toBeLessThan(span - 40);
    }
    expect(course.grid.length).toBe(STREET_RACE.gridSlots);
  });

  it('fences the corners and the mouths, not the whole lap, and never a shortcut entrance', () => {
    const walls = world.plan.neonWalls ?? [];
    const segs = path.samples.length;
    expect(walls.length).toBeGreaterThan(20);
    expect(walls.length).toBeLessThan(segs * 2 * 0.7);
    const mouths = course.shortcuts.flatMap((sc) => [sc.path.samples[0], sc.path.samples[sc.path.samples.length - 1]]);
    for (const w of walls) {
      for (const m of mouths) {
        const d = Math.hypot((w.ax + w.bx) / 2 - m.x, (w.az + w.bz) / 2 - m.z);
        expect(d).toBeGreaterThan(4);
      }
    }
  });

  it('carries no other activity, and keeps the viaduct traffic only', () => {
    const l = world.layout;
    expect(l.rushSites).toBeNull();
    expect(l.passengerStops).toBeNull();
    expect(l.buhoSite).toBeNull();
    expect(l.circuitSite).toBeNull();
    expect(l.streetSites).toBeNull();
    expect(l.busRoutes).toEqual([]);
    const ground = l.targetSpawns.filter((s) => (s.y ?? 0) < 5);
    expect(ground.length).toBe(STREET_RACE.trafficCount);
  });
});

/* ------------------------------------------------------------------ branch gates */

interface Drive {
  race: ReturnType<typeof createRaceState>;
  v: ReturnType<typeof createVehicleState>;
  time: number;
  events: GameEvent[];
}

function startAt(s: number): Drive {
  const race = createRaceState(course);
  const p = pointAtStation(path, s, createProjection());
  const v = createVehicleState(p.x, p.z, Math.atan2(p.tx, -p.tz));
  const d: Drive = { race, v, time: 0, events: [] };
  while (race.phase === 'countdown') {
    d.time += DT;
    stepRace(race, course, v, d.time, DT, d.events);
  }
  return d;
}

function moveTo(d: Drive, x: number, z: number): void {
  d.v.prevX = d.v.x;
  d.v.prevZ = d.v.z;
  d.v.x = x;
  d.v.z = z;
  d.v.vx = (x - d.v.prevX) / DT;
  d.v.vz = (z - d.v.prevZ) / DT;
  d.time += DT;
  d.events.length = 0;
  stepRace(d.race, course, d.v, d.time, DT, d.events);
}

/** Teleport along a path from station `from` to station `to`, a few metres a tick. */
function follow(d: Drive, p: TrackPath, from: number, to: number, step = 3): void {
  const out = createProjection();
  // Stations wrap on the closed lap: a leg that crosses sample 0 is driven the long way round.
  if (p.closed && to < from) to += p.length;
  for (let s = from; s <= to; s += step) {
    pointAtStation(p, s, out);
    moveTo(d, out.x, out.z);
  }
  pointAtStation(p, to, out);
  moveTo(d, out.x, out.z);
}

const lineS = course.gates[0].s;
const branches = course.gates.map((g, i) => (g.alt ? i : -1)).filter((i) => i >= 0);

describe('branch gates', () => {
  it('has two branch gates, each between two mandatory ones', () => {
    expect(branches).toHaveLength(2);
    for (const b of branches) {
      expect(course.gates[b - 1].alt).toBeUndefined();
      expect(course.gates[(b + 1) % course.gates.length].alt).toBeUndefined();
    }
  });

  it('validates a lap driven entirely on the main road', () => {
    const d = startAt(lineS - 10);
    follow(d, path, lineS - 10, lineS + path.length + 5);
    expect(d.race.lap).toBe(2);
    expect(d.race.lapTimes[0]).toBeGreaterThan(0);
  });

  it('validates each shortcut, and counts the branch gate exactly once', () => {
    for (let i = 0; i < course.shortcuts.length; i++) {
      const sc = course.shortcuts[i];
      const b = branches.find((k) => {
        const g = course.gates[k];
        const alt = g.alt!;
        const mid = projectOntoPath(sc.path, (alt.ax + alt.bx) / 2, (alt.az + alt.bz) / 2, createProjection());
        return mid.dist < 2;
      });
      expect(b).toBeDefined();
      const gateBefore = course.gates[b! - 1];
      const gateAfter = course.gates[b! + 1];
      const d = startAt(lineS - 10);
      // Up the lap to just past the gate before the branch...
      follow(d, path, lineS - 10, gateBefore.s + 4);
      expect(d.race.nextGate).toBe(b);
      // ...then down the alley...
      follow(d, sc.path, 0, sc.path.length);
      expect(d.race.nextGate).toBe(b! + 1);
      expect(d.race.shortcut === i || d.race.shortcut === -1).toBe(true);
      // ...and on through the gate after it.
      follow(d, path, sc.sOut, gateAfter.s + 4);
      expect(d.race.nextGate).toBe((b! + 2) % course.gates.length);
    }
  });

  it('refuses a lap that skips both branches', () => {
    const b = branches[0];
    const gateBefore = course.gates[b - 1];
    const gateAfter = course.gates[b + 1];
    const d = startAt(lineS - 10);
    follow(d, path, lineS - 10, gateBefore.s + 4);
    // Straight across the city to the far side of the gate after the branch, crossing it forwards.
    const p = pointAtStation(path, gateAfter.s - 3, createProjection());
    moveTo(d, p.x, p.z);
    follow(d, path, gateAfter.s - 3, gateAfter.s + 4);
    expect(d.race.nextGate).toBe(b);
  });
});

/* ------------------------------------------------------------------ the series */

function installStorage(seed: Record<string, string> = {}): Map<string, string> {
  const store = new Map<string, string>(Object.entries(seed));
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  };
  return store;
}

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

/** A state on the street world whose race is parked at `phase`. */
function streetState() {
  return createInitialGameState(world.layout, 'auto', {});
}

describe('the series', () => {
  it('picks progressively stronger configurations per event', () => {
    const tiers = STREET_RACE.events.map((_, i) => streetTierFor(i));
    expect(streetEvent(0).rivals).toBe(1);
    expect(streetEvent(1).rivals).toBe(2);
    expect(streetEvent(2).rivals).toBe(3);
    expect(tiers[0].topSpeed).toBeLessThan(tiers[1].topSpeed);
    expect(tiers[1].topSpeed).toBeLessThan(tiers[2].topSpeed);
    expect(tiers[0].shortcutChance).toBeLessThan(tiers[2].shortcutChance);
    expect(tiers[0].mistakeChance).toBeGreaterThan(tiers[2].mistakeChance);
    expect(streetEvent(0).reward).toBeLessThan(streetEvent(2).reward);
  });

  it('clamps the event asked for to the ones unlocked, and fields the configured rivals', () => {
    expect(createStreetRaceState(course, 2, 0).event).toBe(0);
    expect(createStreetRaceState(course, 1, 1).event).toBe(1);
    expect(createStreetRaceState(course, 7, 3).event).toBe(2);
    const sr = createStreetRaceState(course, 2, 2);
    expect(sr.rivals).toHaveLength(3);
    expect(sr.cars.map((c) => c.slot)).toEqual([1, 2, 3]);
    expect(sr.cars.map((c) => c.name)).toEqual(streetEvent(2).rivalNames);
  });

  it('unlocks the next event only on a win of the outstanding one, and pays once', () => {
    const state = streetState();
    const sr = createStreetRaceState(course, 0, 0);
    // Run the countdown down through the real tick so the phase tracking is honest.
    const cmd = createPlayerCommand();
    while (state.race!.phase === 'countdown') {
      stepGame(state, cmd, world.layout, DT);
      stepStreetRace(sr, world.layout, state, DT, state.events);
    }
    // The player takes the flag first: the rules would set this; here it is set by hand.
    state.race!.phase = 'finished';
    state.race!.finishTime = 100;
    state.events.length = 0;
    stepStreetRace(sr, world.layout, state, DT, state.events);
    const end = state.events.find((e) => e.type === 'streetRaceEnd');
    expect(end && end.type === 'streetRaceEnd' && end.results.won).toBe(true);
    expect(end && end.type === 'streetRaceEnd' && end.results.advanced).toBe(true);
    expect(end && end.type === 'streetRaceEnd' && end.results.reward).toBe(streetEvent(0).reward);
    expect(end && end.type === 'streetRaceEnd' && end.results.unlockedName).toBe(streetEvent(1).name);
    expect(sr.cleared).toBe(1);
    expect(state.economy.money).toBe(streetEvent(0).reward);
    // Judged once, however many ticks the card is up.
    state.events.length = 0;
    stepStreetRace(sr, world.layout, state, DT, state.events);
    expect(state.events.some((e) => e.type === 'streetRaceEnd')).toBe(false);
  });

  it('does not advance on a loss, nor on a replay of a won event', () => {
    const state = streetState();
    const lost = createStreetRaceState(course, 0, 0);
    state.race!.phase = 'racing';
    lost.phase = 'racing';
    lost.rivals[0].race.phase = 'finished';
    lost.rivals[0].race.finishTime = 90;
    state.race!.phase = 'finished';
    state.race!.finishTime = 100;
    stepStreetRace(lost, world.layout, state, DT, state.events);
    expect(lost.results?.placement).toBe(2);
    expect(lost.results?.won).toBe(false);
    expect(lost.cleared).toBe(0);
    expect(state.economy.money).toBe(0);

    const replay = createStreetRaceState(course, 0, 2);
    const again = streetState();
    replay.phase = 'racing';
    again.race!.phase = 'finished';
    again.race!.finishTime = 100;
    stepStreetRace(replay, world.layout, again, DT, again.events);
    expect(replay.results?.won).toBe(true);
    expect(replay.results?.advanced).toBe(false);
    expect(replay.results?.reward).toBe(0);
    expect(replay.cleared).toBe(2);
  });

  it('remembers wins across a reload through storage, and refuses to go backwards', () => {
    installStorage();
    let p = emptyStreetRaceProgress();
    p = recordStreetRace(p, 0, 1, true);
    writeStreetRaceProgress(p);
    expect(readStreetRaceProgress()).toEqual({ cleared: 1, best: [1, -1, -1] });
    p = recordStreetRace(readStreetRaceProgress(), 1, 3, false);
    writeStreetRaceProgress(p);
    expect(readStreetRaceProgress()).toEqual({ cleared: 1, best: [1, 3, -1] });
    // A replayed loss of event 0 cannot un-win it.
    p = recordStreetRace(readStreetRaceProgress(), 0, 2, false);
    expect(p).toEqual({ cleared: 1, best: [1, 3, -1] });
    installStorage({ 'rb.street.races': '{"cleared": 99, "best": ["x", 0]}' });
    expect(readStreetRaceProgress()).toEqual({ cleared: 3, best: [-1, -1, -1] });
  });

  it('opens the rings one win at a time', () => {
    expect(streetNewestEvent(0)).toBe(0);
    expect(streetNewestEvent(2)).toBe(2);
    expect(streetNewestEvent(3)).toBe(2);
    expect(streetEventOpen(0, 1)).toBe(false);
    expect(streetEventOpen(1, 1)).toBe(true);
    expect(streetEventOpen(1, 0)).toBe(true);
  });

  it('puts the field back on the grid on a restart, with nothing counted', () => {
    const sr = createStreetRaceState(course, 2, 2);
    for (const r of sr.rivals) {
      r.v.x += 50;
      r.race.phase = 'finished';
      r.race.finishTime = 80;
    }
    sr.results = { event: 2, eventName: 'x', placement: 4, field: 4, time: 1, won: false, advanced: false, reward: 0, unlockedName: null, allClear: false };
    resetStreetRace(sr, course);
    for (const r of sr.rivals) {
      const g = course.grid[r.car.slot];
      expect(r.v.x).toBeCloseTo(g.x, 5);
      expect(r.race.phase).toBe('countdown');
      expect(r.car.finishTime).toBe(-1);
    }
    expect(sr.results).toBeNull();
    expect(sr.phase).toBe('countdown');
  });
});

/* ------------------------------------------------------------------ the city side */

describe('the rings in the street', () => {
  const city = addStreetSites(addCircuitGate(createCityWorld()));
  const sites = city.layout.streetSites!;

  it('are on the road, mid-block, and clear of every other ring', () => {
    expect(sites).toHaveLength(STREET_RACE.events.length);
    const others = [
      ...RUSH_SITES.map((s) => ({ ...s, r: RUSH.marker.promptRadius })),
      ...PASSENGER_STOPS.map((s) => ({ ...s, r: PASSENGER.marker.promptRadius })),
      { ...BUHO_SITE, r: MOOGUL.marker.promptRadius },
      { ...circuitGateSite(), r: TIME_ATTACK.marker.promptRadius },
    ];
    for (const site of sites) {
      expect(city.plan.isRoad(site.x, site.z, -STREET_RACE.marker.promptRadius)).toBe(true);
      for (const o of others) {
        expect(Math.hypot(site.x - o.x, site.z - o.z)).toBeGreaterThan(STREET_RACE.marker.promptRadius + o.r + 6);
      }
    }
    expect(STREET_SITES.length).toBe(sites.length);
  });

  it('offer only the events already reached, and one press takes the key once', () => {
    const s = createStreetGateState(0);
    const v = createVehicleState(-300, -300, 0);
    const cmd = createPlayerCommand();
    const events: GameEvent[] = [];
    const tick = (activate = false): void => {
      cmd.activate = activate;
      events.length = 0;
      stepStreetGate(s, sites, v, cmd, events);
    };
    // Event II's ring is not open yet: standing on it offers nothing.
    v.x = sites[1].x;
    v.z = sites[1].z;
    tick();
    expect(canEnterStreetRace(s)).toBe(false);
    v.x = sites[0].x;
    v.z = sites[0].z;
    tick();
    expect(canEnterStreetRace(s)).toBe(true);
    expect(events).toContainEqual({ type: 'streetRacePrompt', on: true, event: 0 });
    tick(true);
    expect(events).toContainEqual({ type: 'streetRaceEnter', event: 0 });
    tick(true);
    expect(events.some((e) => e.type === 'streetRaceEnter')).toBe(false);
    // With two wins, ring II opens and reports its own event.
    const s2 = createStreetGateState(2);
    v.x = sites[1].x;
    v.z = sites[1].z;
    stepStreetGate(s2, sites, v, cmd, events);
    expect(s2.atSite).toBe(1);
  });

  it('switch the police off from the key press, and keep them out of the race world', () => {
    const state = createInitialGameState(city.layout, 'auto', { police: true, streetRaceCleared: 0 });
    expect(isPoliceEnabledForCurrentGameState(state)).toBe(true);
    state.streetGate!.entering = true;
    expect(isPoliceEnabledForCurrentGameState(state)).toBe(false);
    state.streetGate!.entering = false;
    expect(isPoliceEnabledForCurrentGameState(state)).toBe(true);
    // The race world never builds them; and a race present would refuse them anyway.
    const race = createInitialGameState(world.layout, 'auto', {});
    expect(race.police).toBeNull();
    const forced = createInitialGameState(world.layout, 'auto', { police: true });
    expect(isPoliceEnabledForCurrentGameState(forced)).toBe(false);
  });
});

/* ------------------------------------------------------------------ the rivals */

describe('a rival', () => {
  it('drives the real car round the real lap, stays on the route and takes the flag', () => {
    const state = streetState();
    const sr = createStreetRaceState(course, 2, 2);
    const cmd = createPlayerCommand();
    const proj = createProjection();
    let worstOff = 0;
    let finishedAt = -1;
    const limit = 240;
    for (let t = 0; t < limit && finishedAt < 0; t += DT) {
      stepGame(state, cmd, world.layout, DT);
      stepStreetRace(sr, world.layout, state, DT, state.events);
      for (const r of sr.rivals) {
        const p = r.ai.route >= 0 ? course.shortcuts[r.ai.route].path : path;
        projectOntoPath(p, r.v.x, r.v.z, proj);
        worstOff = Math.max(worstOff, proj.dist - proj.halfWidth);
      }
      if (sr.rivals.every((r) => r.race.phase === 'finished')) finishedAt = state.time;
    }
    // Every rival completes two laps well inside the budget, and none leaves its road.
    expect(finishedAt).toBeGreaterThan(0);
    expect(finishedAt).toBeLessThan(limit);
    expect(worstOff).toBeLessThan(STREET_RACE.recovery.offRouteMetres);
    for (const r of sr.rivals) {
      expect(r.race.lap).toBe(course.laps);
      expect(r.car.finishTime).toBeGreaterThan(0);
    }
    // The player, parked on the grid, is last.
    expect(streetPosition(sr, state.race!)).toBe(sr.rivals.length + 1);
  }, 60000);
});
