import { describe, expect, it } from 'vitest';
import {
  canStartRush,
  chainMultiplier,
  createRushState,
  dismissRush,
  isRushTarget,
  markRushTargets,
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
const SITE: ActivitySite = { x: 0, z: 0, y: 0, heading: 0 };

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
function rig(targetCount = 8) {
  const rush = createRushState(targetCount);
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

  return { rush, vehicle, drift, cmd, targets, tick, begin, idle };
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

describe('rayo rush: the marker in the city', () => {
  it('stands on a road, clear of anything solid, and away from the spawn', () => {
    const world = createCityWorld();
    const site = world.layout.rushSite;
    expect(site).toBeTruthy();
    if (!site) return;

    // On the drivable surface, and not inside a building or a barrier.
    expect(world.plan.isRoad(site.x, site.z)).toBe(true);
    expect(world.plan.isSolid(site.x, site.z)).toBe(false);

    // Far enough from the spawn to be come across rather than handed over, and inside the map.
    // An absolute distance, not a multiple of the trigger: the trigger is now the size of the
    // painted circle, so scaling off it would let this pass with the marker under the bumper.
    const spawn = world.layout.playerSpawn;
    expect(Math.hypot(site.x - spawn.x, site.z - spawn.z)).toBeGreaterThan(60);
    expect(site.x).toBeGreaterThan(world.layout.bounds.minX);
    expect(site.x).toBeLessThan(world.layout.bounds.maxX);

    // The art and the rules are given the same point, so they cannot disagree.
    expect(world.plan.rushMarker).toEqual(site);
  });

  it('is on the minimap, at the same point the rules and the art use', () => {
    const world = createCityWorld();
    const site = world.layout.rushSite;
    const marks = world.layout.minimap.activities ?? [];
    // A destination the player cannot find is not a destination — unlike the electric cars,
    // which the map deliberately leaves off because hunting them is the game.
    expect(marks).toHaveLength(1);
    expect(marks[0]).toEqual({ x: site?.x, z: site?.z });
    // And it is inside the area the map actually draws, or it would be marked off the edge.
    const b = world.layout.minimap.bounds;
    expect(marks[0].x).toBeGreaterThan(b.minX);
    expect(marks[0].x).toBeLessThan(b.maxX);
    expect(marks[0].z).toBeGreaterThan(b.minZ);
    expect(marks[0].z).toBeLessThan(b.maxZ);
  });

  it('gives the city a rush state sized to its traffic, and leaves the circuit without one', () => {
    const world = createCityWorld();
    const rush = createRushState(world.layout.targetSpawns.length);
    expect(rush.scored.length).toBe(world.layout.targetSpawns.length);
    expect(world.layout.targetSpawns.length).toBeGreaterThan(20);
  });

  it('has electric cars patrolling within reach of the marker', () => {
    const world = createCityWorld();
    const site = world.layout.rushSite;
    if (!site) throw new Error('the city has no rush marker');
    // The activity is only worth two minutes if there is traffic where it starts.
    const near = world.layout.targetSpawns.filter(
      (s) => Math.hypot(s.x - site.x, s.z - site.z) < RUSH.targets.markRadius * 4,
    );
    expect(near.length).toBeGreaterThan(3);
  });
});
