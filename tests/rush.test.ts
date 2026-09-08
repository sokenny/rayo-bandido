import { describe, expect, it } from 'vitest';
import {
  canStartRush,
  chainMultiplier,
  createRushState,
  dismissRush,
  isRushTarget,
  markRushTargets,
  resetRushState,
  rushAllClear,
  rushLevelCount,
  rushLevelIndex,
  rushSiteFor,
  rushTargetScore,
  setRushProgress,
  startRush,
  stepRush,
  styleBonusFor,
} from '../src/sim/rush';
import { createVehicleState, createDriftState } from '../src/sim/gameState';
import { createPlayerCommand } from '../src/core/input/keyboard';
import { RUSH } from '../src/config/tuning';
import { createCityWorld } from '../src/world/cityWorld';
import type { ActivitySite, DriftState, GameEvent, PlayerCommand, TargetState, VehicleState } from '../src/core/types';

/**
 * RAYO RUSH's rules (`src/sim/rush.ts`).
 *
 * Everything here drives the module the way the orchestrator does — one `stepRush` per tick
 * with an event list that already carries whatever the rest of the tick raised — because the
 * two things most worth pinning down are both about ordering: that a kill on the very last
 * tick is paid and nothing after it is, and that one electric car can never pay twice.
 */

const DT = 1 / 60;
const SITE: ActivitySite = { x: 0, z: 0, y: 0, heading: 0, label: 'TEST STREET' };

function makeTarget(id: number, x: number, z: number): TargetState {
  return {
    id,
    x,
    z,
    y: 0,
    heading: 0,
    prevX: x,
    prevZ: z,
    prevY: 0,
    prevHeading: 0,
    vx: 0,
    vz: 0,
    status: 'active',
    hitTime: -1,
    patrolIndex: 0,
    patrolSpeed: 0,
    speed: 0,
    rewarded: false,
  };
}

/** A rig that steps the rules the way `stepGame` does, and lets a test inject a kill. */
function rig(targetCount = 8, cleared = 0) {
  const rush = createRushState(targetCount, cleared);
  const vehicle: VehicleState = createVehicleState(SITE.x, SITE.z, 0);
  const drift: DriftState = createDriftState();
  const cmd: PlayerCommand = createPlayerCommand();
  const targets: TargetState[] = [];
  for (let i = 0; i < targetCount; i++) targets.push(makeTarget(i, i * 4, -10));
  let events: GameEvent[] = [];

  /** One tick. `kills` are target ids destroyed by the lightning on this very tick. */
  function tick(kills: number[] = [], ranked = true): GameEvent[] {
    events = [];
    for (const id of kills) {
      targets[id].status = 'destroyed';
      events.push({ type: 'targetDestroyed', targetId: id, x: targets[id].x, y: 0, z: targets[id].z, reward: 0 });
    }
    stepRush(rush, SITE, vehicle, drift, cmd, targets, ranked, DT, events);
    cmd.activate = false;
    return events;
  }

  /** Run the count-in out so the next tick is inside a live run. */
  function begin(ranked = true): void {
    cmd.activate = true;
    tick([], ranked);
    for (let i = 0; i < Math.ceil(RUSH.countdownSeconds / DT) + 2 && rush.phase === 'countdown'; i++) tick();
  }

  /** Let `seconds` of the clock pass with nothing happening. */
  function idle(seconds: number): void {
    for (let i = 0; i < Math.round(seconds / DT); i++) tick();
  }

  /**
   * Take a run up, put `points` on the board and drive it to the flag; returns the events of
   * the tick the clock ran out on.
   *
   * The score is WRITTEN rather than earned. Scoring six thousand points honestly means sixty
   * distinct electric cars inside ninety seconds, and a test that arranged that would be a test
   * about how fast the rig can respawn traffic. What is under test here is the one decision
   * `endRun` makes about the number, so the number is simply put there.
   */
  function runScoring(points: number): GameEvent[] {
    begin();
    rush.score = points;
    let last: GameEvent[] = [];
    while (rush.phase === 'running') last = tick();
    return last;
  }

  return { rush, vehicle, drift, cmd, targets, tick, begin, idle, runScoring };
}

describe('rayo rush: taking it up', () => {
  it('offers nothing until the player is at the marker', () => {
    const r = rig();
    r.vehicle.x = RUSH.marker.promptRadius + 20;
    r.tick();
    expect(r.rush.atMarker).toBe(false);

    r.cmd.activate = true;
    r.tick();
    expect(r.rush.phase).toBe('idle');
  });

  it('counts in 3 - 2 - 1 - GO and then starts the clock at the tuned length', () => {
    const r = rig();
    r.tick(); // inside the marker
    expect(r.rush.atMarker).toBe(true);

    r.cmd.activate = true;
    const started = r.tick();
    expect(started.some((e) => e.type === 'rushStart')).toBe(true);
    expect(r.rush.phase).toBe('countdown');

    const numbers: number[] = [];
    for (let i = 0; i < 300 && r.rush.phase === 'countdown'; i++) {
      for (const ev of r.tick()) if (ev.type === 'rushCountdown') numbers.push(ev.seconds);
    }
    // The first number came with the start; the rest count down to the GO beat.
    expect(started.filter((e) => e.type === 'rushCountdown').map((e) => (e as { seconds: number }).seconds)).toEqual([3]);
    expect(numbers).toEqual([2, 1, 0]);
    expect(r.rush.phase).toBe('running');
    expect(r.rush.timeLeft).toBeCloseTo(RUSH.durationSeconds, 5);
  });

  it('scores nothing during the count-in', () => {
    const r = rig();
    r.tick();
    r.cmd.activate = true;
    r.tick();
    const events = r.tick([0]);
    expect(events.some((e) => e.type === 'rushScore')).toBe(false);
    expect(r.rush.score).toBe(0);
  });

  it('will not offer another run until the player has driven away from the marker', () => {
    const r = rig();
    r.begin();
    r.rush.timeLeft = DT;
    r.tick();
    expect(r.rush.phase).toBe('results');

    r.cmd.activate = true;
    r.tick();
    expect(r.rush.phase).toBe('idle');

    // Still standing in it: nothing on offer, and the prompt is told so rather than being
    // left up over a key that would do nothing.
    expect(r.rush.atMarker).toBe(true);
    expect(canStartRush(r.rush)).toBe(false);
    r.cmd.activate = true;
    r.tick();
    expect(r.rush.phase).toBe('idle');

    // Drive off and come back.
    r.vehicle.x = RUSH.marker.rearmRadius + 10;
    r.tick();
    r.vehicle.x = 0;
    r.tick();
    expect(canStartRush(r.rush)).toBe(true);
    r.cmd.activate = true;
    r.tick();
    expect(r.rush.phase).toBe('countdown');
  });
});

describe('rayo rush: the prompt follows the paint', () => {
  it('is only up while the car is standing on the circle', () => {
    const r = rig();
    // The trigger is the painted ring, not a catchment around it: a car a few metres off the
    // paint is not on the marker, however close that is in world terms.
    r.vehicle.x = RUSH.marker.exitRadius + 2;
    r.tick();
    expect(r.rush.atMarker).toBe(false);

    r.vehicle.x = RUSH.marker.promptRadius - 1;
    r.tick();
    expect(r.rush.atMarker).toBe(true);

    // And it goes the moment the car rolls off, not a block later.
    r.vehicle.x = RUSH.marker.exitRadius + 0.2;
    r.tick();
    expect(r.rush.atMarker).toBe(false);
  });

  it('raises an edge when the offer opens and when it closes', () => {
    const r = rig();
    r.vehicle.x = 100;
    expect(r.tick().filter((e) => e.type === 'rushPrompt')).toHaveLength(0);

    r.vehicle.x = 0;
    const arriving = r.tick().find((e) => e.type === 'rushPrompt') as { on: boolean } | undefined;
    expect(arriving?.on).toBe(true);

    // Standing still on it is not an event every tick — only the edge is.
    expect(r.tick().filter((e) => e.type === 'rushPrompt')).toHaveLength(0);

    r.vehicle.x = 100;
    const leaving = r.tick().find((e) => e.type === 'rushPrompt') as { on: boolean } | undefined;
    expect(leaving?.on).toBe(false);
  });

  it('closes the offer when the run is taken up, not only when the car leaves', () => {
    const r = rig();
    r.tick();
    r.cmd.activate = true;
    const events = r.tick();
    expect(events.some((e) => e.type === 'rushStart')).toBe(true);
    const closed = events.find((e) => e.type === 'rushPrompt') as { on: boolean } | undefined;
    expect(closed?.on).toBe(false);
  });
});

describe('rayo rush: scoring', () => {
  it('pays the base points for a kill with no streak and no drift', () => {
    const r = rig();
    r.begin();
    const events = r.tick([0]);
    const scored = events.find((e) => e.type === 'rushScore');
    expect(scored).toBeDefined();
    expect(r.rush.score).toBe(RUSH.scoring.disable);
    expect(r.rush.disabled).toBe(1);
    expect(r.rush.styleBonus).toBe(0);
  });

  it('builds a streak multiplier and caps it', () => {
    const r = rig(40);
    r.begin();
    for (let i = 0; i < 20; i++) {
      r.tick([i]);
      r.idle(0.2); // well inside the chain window
    }
    expect(r.rush.bestChain).toBe(20);
    expect(r.rush.multiplier).toBe(RUSH.scoring.chainMax);
    // The multiplier follows the published curve exactly.
    expect(chainMultiplier(3)).toBeCloseTo(1 + 2 * RUSH.scoring.chainStep, 6);
  });

  it('resets the streak when too long passes between eliminations', () => {
    const r = rig();
    r.begin();
    r.tick([0]);
    r.tick([1]);
    expect(r.rush.chain).toBe(2);
    r.idle(RUSH.scoring.chainWindow + 0.5);
    expect(r.rush.chain).toBe(0);
    expect(r.rush.multiplier).toBe(1);

    const events = r.tick([2]);
    const scored = events.find((e) => e.type === 'rushScore') as { points: number } | undefined;
    // Back to a bare hundred: the streak really was lost, not merely hidden.
    expect(scored?.points).toBe(RUSH.scoring.disable);
  });

  it('pays a style bonus for a shot charged out of a drift, and scales it with the drift', () => {
    const r = rig();
    r.begin();
    // A clean four-second drift held right up to the shot.
    r.drift.active = true;
    r.drift.duration = 4;
    r.tick();
    const events = r.tick([0]);
    const scored = events.find((e) => e.type === 'rushScore') as
      | { points: number; driftBonus: number; cleanDrift: boolean }
      | undefined;
    expect(scored?.cleanDrift).toBe(true);
    expect(scored?.driftBonus).toBe(styleBonusFor(4, true));
    expect(scored?.points).toBe(RUSH.scoring.disable + styleBonusFor(4, true));
    // A longer drift is worth more than a short one, up to the cap.
    expect(styleBonusFor(3, true)).toBeGreaterThan(styleBonusFor(1, true));
    expect(styleBonusFor(RUSH.scoring.driftBonusMaxSeconds + 5, true)).toBe(
      styleBonusFor(RUSH.scoring.driftBonusMaxSeconds, true),
    );
    // And a drift that took a hit is worth less than one that did not.
    expect(styleBonusFor(4, false)).toBeLessThan(styleBonusFor(4, true));
  });

  it('drops the drift credit once the grace has run out', () => {
    const r = rig();
    r.begin();
    r.drift.active = true;
    r.drift.duration = 3;
    r.tick();
    r.drift.active = false;
    r.idle(RUSH.scoring.driftChargeGrace + 0.2);
    const events = r.tick([0]);
    const scored = events.find((e) => e.type === 'rushScore') as { driftBonus: number } | undefined;
    expect(scored?.driftBonus).toBe(0);
  });

  it('voids the clean bonus when the drift took a hit', () => {
    const r = rig();
    r.begin();
    r.drift.active = true;
    r.drift.duration = 1;
    r.vehicle.collided = true;
    r.tick();
    r.vehicle.collided = false;
    r.drift.duration = 2;
    r.tick();
    const events = r.tick([0]);
    const scored = events.find((e) => e.type === 'rushScore') as { cleanDrift: boolean; driftBonus: number } | undefined;
    expect(scored?.cleanDrift).toBe(false);
    expect(scored?.driftBonus).toBeGreaterThan(0);
  });

  it('never pays twice for the same electric car, even after it respawns', () => {
    const r = rig();
    r.begin();
    r.tick([0]);
    const first = r.rush.score;
    expect(first).toBe(RUSH.scoring.disable);

    // The traffic brings it back, and the player shoots it again.
    r.targets[0].status = 'active';
    const events = r.tick([0]);
    expect(events.some((e) => e.type === 'rushScore')).toBe(false);
    expect(r.rush.score).toBe(first);
    expect(r.rush.disabled).toBe(1);
    // And it is no longer a marked target either: the ring and the rule agree.
    r.targets[0].status = 'active';
    expect(isRushTarget(r.rush, r.targets[0])).toBe(false);
  });
});

describe('rayo rush: the clock', () => {
  it('pays a kill on the last tick and nothing after it', () => {
    const r = rig();
    r.begin();
    // One tick of clock left: this kill lands inside the run.
    r.rush.timeLeft = DT;
    const last = r.tick([0]);
    expect(last.some((e) => e.type === 'rushScore')).toBe(true);
    expect(last.some((e) => e.type === 'rushEnd')).toBe(true);
    expect(r.rush.phase).toBe('results');

    const after = r.tick([1]);
    expect(after.some((e) => e.type === 'rushScore')).toBe(false);
    expect(r.rush.score).toBe(RUSH.scoring.disable);
  });

  it('freezes the run into results the card can read', () => {
    const r = rig(20);
    r.begin();
    r.drift.active = true;
    r.drift.duration = 2;
    r.tick();
    r.tick([0]);
    r.tick([1]);
    r.drift.active = false;
    r.rush.timeLeft = DT;
    const events = r.tick();
    const end = events.find((e) => e.type === 'rushEnd') as { results: { score: number; disabled: number; bestChain: number; styleBonus: number; ranked: boolean } } | undefined;
    expect(end).toBeDefined();
    expect(end?.results.disabled).toBe(2);
    expect(end?.results.bestChain).toBe(2);
    expect(end?.results.score).toBe(r.rush.score);
    expect(end?.results.styleBonus).toBeGreaterThan(0);
    expect(end?.results.ranked).toBe(true);
  });

  it('records an unranked run identically, and only flags it as unranked', () => {
    const r = rig();
    r.tick();
    r.begin(false);
    r.tick([0]);
    r.rush.timeLeft = DT;
    r.tick();
    expect(r.rush.results?.ranked).toBe(false);
    expect(r.rush.results?.score).toBe(RUSH.scoring.disable);
  });

  it('hands the world back when the card is dismissed', () => {
    const r = rig();
    r.begin();
    r.rush.timeLeft = DT;
    r.tick();
    const events: GameEvent[] = [];
    expect(dismissRush(r.rush, events)).toBe(true);
    expect(events.some((e) => e.type === 'rushDismissed')).toBe(true);
    expect(r.rush.phase).toBe('idle');
    expect(r.rush.results).toBeNull();
    // A second dismissal is not an event.
    expect(dismissRush(r.rush, events)).toBe(false);
  });
});

describe('rayo rush: which cars are marked', () => {
  it('marks nothing outside a run', () => {
    const r = rig();
    const out = new Uint8Array(r.targets.length);
    markRushTargets(r.rush, r.targets, 0, 0, out);
    expect(Array.from(out).every((f) => f === 0)).toBe(true);
  });

  it('marks the nearest eligible cars only, and never more than the cap', () => {
    const count = RUSH.targets.maxMarked + 6;
    const rush = createRushState(count);
    const targets: TargetState[] = [];
    // A line of cars marching away from the player, all inside the radius.
    for (let i = 0; i < count; i++) targets.push(makeTarget(i, 0, -(i + 1) * 2));
    startRush(rush, true, []);
    rush.phase = 'running';

    const out = new Uint8Array(count);
    markRushTargets(rush, targets, 0, 0, out);
    let marked = 0;
    for (let i = 0; i < count; i++) marked += out[i];
    expect(marked).toBe(RUSH.targets.maxMarked);
    // The nearest are the ones marked, and the far ones are not.
    expect(out[0]).toBe(1);
    expect(out[count - 1]).toBe(0);
  });

  it('drops a car beyond the mark radius, one already scored, and one that is down', () => {
    const rush = createRushState(3);
    const targets = [makeTarget(0, 0, -5), makeTarget(1, 0, -(RUSH.targets.markRadius + 20)), makeTarget(2, 0, -8)];
    startRush(rush, true, []);
    rush.phase = 'running';
    rush.scored[2] = 1;
    const out = new Uint8Array(3);
    markRushTargets(rush, targets, 0, 0, out);
    expect(Array.from(out)).toEqual([1, 0, 0]);

    targets[0].status = 'destroyed';
    markRushTargets(rush, targets, 0, 0, out);
    expect(Array.from(out)).toEqual([0, 0, 0]);
  });
});

describe('rayo rush: the markers in the city', () => {
  it('gives every mission a site, on a road, clear of anything solid', () => {
    const world = createCityWorld();
    const sites = world.layout.rushSites ?? [];
    // One site per mission: a chain that runs out of streets would replay its last one, which
    // is legal (`rushSiteFor` clamps) but is not what this city is supposed to ship.
    expect(sites).toHaveLength(RUSH.levels.length);

    for (const site of sites) {
      // On the drivable surface, and not inside a building or a barrier.
      expect(world.plan.isRoad(site.x, site.z)).toBe(true);
      expect(world.plan.isSolid(site.x, site.z)).toBe(false);
      // The painted circle IS the trigger, so the whole of it has to be on the road too — a
      // marker whose far edge is inside a block is one the player can only half stand on.
      for (const [dx, dz] of [
        [RUSH.marker.promptRadius, 0],
        [-RUSH.marker.promptRadius, 0],
        [0, RUSH.marker.promptRadius],
        [0, -RUSH.marker.promptRadius],
      ]) {
        expect(world.plan.isSolid(site.x + dx, site.z + dz)).toBe(false);
      }
      // Inside the map, and named, because the prompt says where the player is standing.
      expect(site.x).toBeGreaterThan(world.layout.bounds.minX);
      expect(site.x).toBeLessThan(world.layout.bounds.maxX);
      expect(site.label && site.label.length).toBeTruthy();
    }

    // Far enough from the spawn to be come across rather than handed over. An absolute
    // distance, not a multiple of the trigger: the trigger is the size of the painted circle,
    // so scaling off it would let this pass with the marker under the bumper.
    const spawn = world.layout.playerSpawn;
    expect(Math.hypot(sites[0].x - spawn.x, sites[0].z - spawn.z)).toBeGreaterThan(60);

    // The art and the rules are given the same points, so they cannot disagree.
    expect(world.plan.rushMarkers).toEqual(sites);
  });

  it('puts the missions in different places, far enough apart to be a journey', () => {
    const world = createCityWorld();
    const sites = world.layout.rushSites ?? [];
    for (let i = 1; i < sites.length; i++) {
      const from = sites[i - 1];
      const to = sites[i];
      // Moving the marker is the reward for clearing a mission. A hop the player could make
      // without noticing they had moved would not read as one.
      expect(Math.hypot(to.x - from.x, to.z - from.z)).toBeGreaterThan(RUSH.marker.rearmRadius * 5);
    }
  });

  it('marks exactly the site the chain is currently on, and nothing else', () => {
    const world = createCityWorld();
    const sites = world.layout.rushSites ?? [];
    const marks = world.layout.minimap.activities ?? [];
    // A destination the player cannot find is not a destination — unlike the electric cars,
    // which the map deliberately leaves off because hunting them is the game. But only ONE is
    // marked: the other two are missions that do not exist yet, and a mark on a marker that is
    // not there is worse than no mark. `Minimap.setActivities` moves this as they are cleared.
    expect(marks).toHaveLength(1);
    expect(marks[0]).toEqual({ x: sites[0].x, z: sites[0].z });
    // And every site is inside the area the map actually draws, or it would be marked off the
    // edge the moment the chain moved on to it.
    const b = world.layout.minimap.bounds;
    for (const site of sites) {
      expect(site.x).toBeGreaterThan(b.minX);
      expect(site.x).toBeLessThan(b.maxX);
      expect(site.z).toBeGreaterThan(b.minZ);
      expect(site.z).toBeLessThan(b.maxZ);
    }
  });

  it('gives the city a rush state sized to its traffic, and leaves the circuit without one', () => {
    const world = createCityWorld();
    const rush = createRushState(world.layout.targetSpawns.length);
    expect(rush.scored.length).toBe(world.layout.targetSpawns.length);
    expect(world.layout.targetSpawns.length).toBeGreaterThan(20);
  });

  it('has electric cars patrolling within reach of every mission', () => {
    const world = createCityWorld();
    const sites = world.layout.rushSites ?? [];
    // A mission is only worth ninety seconds if there is traffic where it starts — and that has
    // to hold for the ones the player unlocks later, not just the one they are handed.
    for (const site of sites) {
      const near = world.layout.targetSpawns.filter(
        (s) => Math.hypot(s.x - site.x, s.z - site.z) < RUSH.targets.markRadius * 4,
      );
      expect(near.length).toBeGreaterThan(3);
    }
  });
});


describe('rayo rush: the mission chain', () => {
  it('starts at the first mission and asks for its target', () => {
    const r = rig();
    expect(r.rush.cleared).toBe(0);
    expect(rushLevelIndex(r.rush.cleared)).toBe(0);
    expect(rushTargetScore(r.rush.cleared)).toBe(RUSH.levels[0].target);
    expect(rushAllClear(r.rush.cleared)).toBe(false);
    // Three of them, and each asks for more than the one before — the whole shape of the ramp.
    expect(rushLevelCount()).toBe(3);
    for (let i = 1; i < RUSH.levels.length; i++) {
      expect(RUSH.levels[i].target).toBeGreaterThan(RUSH.levels[i - 1].target);
    }
  });

  it('moves on when a run meets the target, and says so before it says the run is over', () => {
    const r = rig();
    const events = r.runScoring(RUSH.levels[0].target);

    const up = events.find((e) => e.type === 'rushLevelUp');
    const end = events.find((e) => e.type === 'rushEnd');
    expect(up).toBeTruthy();
    expect(end).toBeTruthy();
    // The promotion is raised BEFORE the run it came out of, so a listener that moves the
    // marker and one that puts the card up see them in the order they happened.
    expect(events.indexOf(up!)).toBeLessThan(events.indexOf(end!));
    if (up?.type === 'rushLevelUp') {
      expect(up.level).toBe(0);
      expect(up.cleared).toBe(1);
      expect(up.allClear).toBe(false);
    }

    expect(r.rush.cleared).toBe(1);
    expect(rushTargetScore(r.rush.cleared)).toBe(RUSH.levels[1].target);
    if (end?.type === 'rushEnd') {
      // The card describes the run that just ended, not the mission now on offer.
      expect(end.results.level).toBe(0);
      expect(end.results.targetScore).toBe(RUSH.levels[0].target);
      expect(end.results.levelLabel).toBe(SITE.label);
      expect(end.results.cleared).toBe(true);
      expect(end.results.advanced).toBe(true);
    }
  });

  it('stays put one point short, and says how the run went without moving the chain', () => {
    const r = rig();
    const events = r.runScoring(RUSH.levels[0].target - 1);

    expect(events.some((e) => e.type === 'rushLevelUp')).toBe(false);
    expect(r.rush.cleared).toBe(0);
    const end = events.find((e) => e.type === 'rushEnd');
    if (end?.type === 'rushEnd') {
      expect(end.results.cleared).toBe(false);
      expect(end.results.advanced).toBe(false);
    }
  });

  it('does not skip a mission when an already-cleared one is beaten again', () => {
    // Standing on mission 2 and scoring enough for mission 1 is not clearing mission 2.
    const r = rig(8, 1);
    const events = r.runScoring(RUSH.levels[0].target);
    expect(events.some((e) => e.type === 'rushLevelUp')).toBe(false);
    expect(r.rush.cleared).toBe(1);
    const end = events.find((e) => e.type === 'rushEnd');
    if (end?.type === 'rushEnd') {
      // It cleared nothing, because the target it was measured against is mission 2's.
      expect(end.results.level).toBe(1);
      expect(end.results.targetScore).toBe(RUSH.levels[1].target);
      expect(end.results.cleared).toBe(false);
    }
  });

  it('replaying a cleared mission scores and records but never advances the chain', () => {
    // The last mission, already done. Its site is still there and still worth driving.
    const r = rig(8, RUSH.levels.length);
    expect(rushAllClear(r.rush.cleared)).toBe(true);
    // Clamped to the last mission rather than falling off the end of the list.
    expect(rushLevelIndex(r.rush.cleared)).toBe(RUSH.levels.length - 1);

    const events = r.runScoring(RUSH.levels[RUSH.levels.length - 1].target * 10);
    expect(events.some((e) => e.type === 'rushLevelUp')).toBe(false);
    expect(r.rush.cleared).toBe(RUSH.levels.length);
    const end = events.find((e) => e.type === 'rushEnd');
    if (end?.type === 'rushEnd') {
      expect(end.results.cleared).toBe(true);
      // Cleared, but not the run that unlocked anything: the card must not promise a next site.
      expect(end.results.advanced).toBe(false);
    }
  });

  it('keeps progress across a restart, and takes a stored count only through the front door', () => {
    const r = rig();
    r.runScoring(RUSH.levels[0].target);
    expect(r.rush.cleared).toBe(1);

    // A restart puts the car back at the spawn; it does not un-finish a finished mission.
    resetRushState(r.rush);
    expect(r.rush.phase).toBe('idle');
    expect(r.rush.cleared).toBe(1);

    // A stored number is an untrusted number, wherever it comes in.
    setRushProgress(r.rush, 99);
    expect(r.rush.cleared).toBe(RUSH.levels.length);
    setRushProgress(r.rush, -4);
    expect(r.rush.cleared).toBe(0);
    setRushProgress(r.rush, Number.NaN);
    expect(r.rush.cleared).toBe(0);
    expect(createRushState(4, 2).cleared).toBe(2);
  });

  it('picks the site of the mission on offer, and survives a world with fewer of them', () => {
    const sites: ActivitySite[] = [
      { x: 1, z: 0, y: 0, heading: 0 },
      { x: 2, z: 0, y: 0, heading: 0 },
      { x: 3, z: 0, y: 0, heading: 0 },
    ];
    expect(rushSiteFor(sites, 0)).toBe(sites[0]);
    expect(rushSiteFor(sites, 2)).toBe(sites[2]);
    // Chain finished: the marker stays on the last site rather than vanishing.
    expect(rushSiteFor(sites, RUSH.levels.length)).toBe(sites[2]);
    // A world that ships fewer sites than there are missions runs the rest at its last one,
    // which is the whole reason the clamp is here and not in every caller.
    expect(rushSiteFor([sites[0]], 2)).toBe(sites[0]);
    // And a world with none is a world without the activity.
    expect(rushSiteFor([], 0)).toBeNull();
    expect(rushSiteFor(null, 0)).toBeNull();
  });
});
