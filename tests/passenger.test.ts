import { describe, expect, it } from 'vitest';
import {
  canBoard,
  canDropOff,
  createPassengerState,
  fareFor,
  farewellTier,
  planTrip,
  resetPassengerState,
  stepPassenger,
  stopById,
  tipFor,
} from '../src/sim/passenger';
import { PASSENGERS, preferenceLabel, validatePassengerCatalog, type PassengerDef } from '../src/content/passengers';
import { hasPortrait } from '../src/ui/portraits';
import { createDriftState, createInitialGameState, createVehicleState, stepGame } from '../src/sim/gameState';
import { createPlayerCommand } from '../src/core/input/keyboard';
import { PASSENGER, RUSH } from '../src/config/tuning';
import { kmhToMs } from '../src/core/math';
import { createCityWorld } from '../src/world/cityWorld';
import { RUSH_SITES } from '../src/world/citySpec';
import type { DriftState, GameEvent, PassengerStop, PlayerCommand, TargetState, VehicleState } from '../src/core/types';

/**
 * Passenger rides (`src/sim/passenger.ts`) and the catalogue that feeds them
 * (`src/content/passengers.ts`).
 *
 * Three things are worth pinning: that every character in the catalogue is playable (the
 * validator, and the stops it is validated against are really on roads); that the mood moves
 * for the reasons it should and not for the ones it should not (sitting still, farming one
 * event, a scrape); and that the lifecycle is clean — one payment per ride, none for a
 * cancelled one, and neither activity able to start while the other has the car.
 */

const DT = 1 / 60;

const STOPS: PassengerStop[] = [
  { id: 'a', x: 0, z: 0, y: 0, heading: 0, label: 'A', tags: ['downtown', 'industrial'] },
  { id: 'b', x: 300, z: 0, y: 0, heading: 0, label: 'B', tags: ['waterfront', 'residential', 'market'] },
  { id: 'c', x: 0, z: 300, y: 0, heading: 0, label: 'C', tags: ['market', 'outskirts', 'downtown'] },
  { id: 'd', x: 300, z: 300, y: 0, heading: 0, label: 'D', tags: ['residential', 'industrial', 'waterfront'] },
];

/** The subtitle texts in a run of events. */
function linesIn(events: readonly GameEvent[]): string[] {
  const out: string[] = [];
  for (const ev of events) if (ev.type === 'passengerLine') out.push(ev.text);
  return out;
}

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

/** A rig that steps the rules the way `stepGame` does, with the car parked far from every stop. */
function rig(catalog: readonly PassengerDef[] = PASSENGERS, targetCount = 6) {
  const s = createPassengerState(targetCount);
  const vehicle: VehicleState = createVehicleState(-500, -500, 0);
  const drift: DriftState = createDriftState();
  const cmd: PlayerCommand = createPlayerCommand();
  const targets: TargetState[] = [];
  for (let i = 0; i < targetCount; i++) targets.push(makeTarget(i, i * 4, -10));
  let time = 0;
  let events: GameEvent[] = [];
  /** The events of the most recent tick, for the helpers that swallow their own. */
  let last: GameEvent[] = [];

  /** One tick. `pre` are events the rest of the tick already raised. */
  function tick(pre: GameEvent[] = []): GameEvent[] {
    events = pre.slice();
    time += DT;
    stepPassenger(s, catalog, STOPS, vehicle, drift, cmd, targets, DT, time, events);
    cmd.activate = false;
    last = events;
    return events;
  }

  function idle(seconds: number): GameEvent[] {
    let all: GameEvent[] = [];
    for (let i = 0; i < Math.round(seconds / DT); i++) all = all.concat(tick());
    return all;
  }

  /** Wait for the pin, drive to it, stop, press the key. Returns the character who got in. */
  function board(): PassengerDef {
    idle(PASSENGER.offer.firstDelay + 0.5);
    expect(s.phase).toBe('offered');
    const pickup = stopById(STOPS, s.trip!.pickupId)!;
    vehicle.x = pickup.x;
    vehicle.z = pickup.z;
    vehicle.speed = 0;
    tick();
    expect(canBoard(s)).toBe(true);
    cmd.activate = true;
    tick();
    expect(s.phase).toBe('riding');
    return catalog.find((p) => p.id === s.trip!.passengerId)!;
  }

  /** Drive to the destination, stop, press the key. */
  function dropOff(): GameEvent[] {
    const dest = stopById(STOPS, s.trip!.destinationId)!;
    vehicle.x = dest.x;
    vehicle.z = dest.z;
    vehicle.speed = 0;
    tick();
    expect(canDropOff(s)).toBe(true);
    cmd.activate = true;
    return tick();
  }

  /** Put the car mid-trip at a speed (km/h), so the speed rules apply. */
  function cruise(kmh: number): void {
    vehicle.x = 150;
    vehicle.z = -150;
    vehicle.speed = kmh > 0 ? kmhToMs(kmh) : 0;
  }

  return { s, vehicle, drift, cmd, targets, tick, idle, board, dropOff, cruise, get time() { return time; }, get last() { return last; } };
}

/* ================================================================== the catalogue */

describe('passenger catalogue', () => {
  const { layout } = createCityWorld();

  it('is valid against the city, and every character has a face', () => {
    expect(validatePassengerCatalog(PASSENGERS, layout.passengerStops)).toEqual([]);
    expect(PASSENGERS.length).toBeGreaterThanOrEqual(3);
    for (const p of PASSENGERS) expect(hasPortrait(p.portrait), `${p.id} has no portrait`).toBe(true);
  });

  it('gives every rule a readable label', () => {
    for (const p of PASSENGERS) for (const pref of p.preferences) expect(preferenceLabel(pref)).not.toBe('');
    expect(preferenceLabel({ kind: 'slow', weight: 1, kmh: 80 })).toBe('STAY UNDER 80 KM/H');
  });

  it('refuses contradictory, over-long or under-written characters', () => {
    const base = PASSENGERS[0];
    const twoWays: PassengerDef = { ...base, id: 'x', preferences: [{ kind: 'drift', weight: 1 }, { kind: 'noDrift', weight: 1 }] };
    expect(validatePassengerCatalog([twoWays]).some((m) => m.includes('both'))).toBe(true);
    const three: PassengerDef = { ...base, id: 'y', preferences: [{ kind: 'drift', weight: 1 }, { kind: 'fast', weight: 1, kmh: 100 }, { kind: 'rayo', weight: 1 }] };
    expect(validatePassengerCatalog([three]).some((m) => m.includes('one or two'))).toBe(true);
    const mute: PassengerDef = { ...base, id: 'z', reactions: { ...base.reactions, collision: [] } };
    expect(validatePassengerCatalog([mute]).some((m) => m.includes('collision'))).toBe(true);
    const oneOpening: PassengerDef = { ...base, id: 'w', openings: ['Hi.'] };
    expect(validatePassengerCatalog([oneOpening]).some((m) => m.includes('two openings'))).toBe(true);
    const lost: PassengerDef = { ...base, id: 'v', destinationTags: ['moon'] };
    expect(validatePassengerCatalog([lost], STOPS).some((m) => m.includes('"moon"'))).toBe(true);
  });
});

describe('passenger stops in the city', () => {
  const { layout, plan } = createCityWorld();
  const stops = layout.passengerStops!;

  it('are all on a road with room to park, apart from each other and from the RUSH sites', () => {
    expect(stops.length).toBeGreaterThanOrEqual(4);
    const ids = new Set<string>();
    for (const stop of stops) {
      expect(ids.has(stop.id), `duplicate stop id ${stop.id}`).toBe(false);
      ids.add(stop.id);
      // Inside the road by more than the ring, so the whole zone is tarmac.
      expect(plan.isRoad(stop.x, stop.z, -PASSENGER.marker.promptRadius * 0.6), `${stop.id} is not on a road`).toBe(true);
      for (const site of RUSH_SITES) {
        expect(Math.hypot(site.x - stop.x, site.z - stop.z), `${stop.id} is on top of a RUSH site`).toBeGreaterThan(RUSH.marker.rearmRadius + PASSENGER.marker.exitRadius);
      }
      for (const other of stops) {
        if (other === stop) continue;
        expect(Math.hypot(other.x - stop.x, other.z - stop.z), `${stop.id} and ${other.id} are too close`).toBeGreaterThan(PASSENGER.marker.exitRadius * 6);
      }
    }
  });

  it('lets every character plan a trip from anywhere', () => {
    for (let i = 0; i < PASSENGERS.length * 3; i++) {
      const trip = planTrip(PASSENGERS, stops, i, -66, -20);
      expect(trip, `offer ${i}`).not.toBeNull();
      expect(trip!.pickupId).not.toBe(trip!.destinationId);
      expect(trip!.distance).toBeGreaterThanOrEqual(PASSENGER.offer.minTrip);
      expect(trip!.distance).toBeLessThanOrEqual(PASSENGER.offer.maxTrip);
      expect(trip!.fare).toBe(fareFor(trip!.distance));
    }
  });
});

/* ================================================================== the lifecycle */

describe('passenger ride: the lifecycle', () => {
  it('offers, boards on a stopped car, talks, and pays once on drop-off', () => {
    const r = rig();
    const offered = r.idle(PASSENGER.offer.firstDelay + 0.5);
    expect(offered.filter((e) => e.type === 'passengerOffer')).toHaveLength(1);
    expect(r.s.trip!.passengerId).toBe(PASSENGERS[0].id);

    // Rolling through the pin is not a pickup.
    const pickup = stopById(STOPS, r.s.trip!.pickupId)!;
    r.vehicle.x = pickup.x;
    r.vehicle.z = pickup.z;
    r.vehicle.speed = 10;
    r.tick();
    expect(canBoard(r.s)).toBe(false);

    const who = r.board();
    // The opening plays first (on the boarding tick itself), then the brief with the
    // destination resolved.
    const lines = linesIn(r.last).concat(linesIn(r.idle(PASSENGER.dialogue.maxSeconds * 2 + 2)));
    expect(lines).toHaveLength(2);
    expect(who.openings).toContain(lines[0]);
    const dest = stopById(STOPS, r.s.trip!.destinationId)!;
    expect(lines[1]).toContain(dest.label);
    expect(lines[1]).not.toContain('{destination}');

    const done = r.dropOff();
    const complete = done.filter((e) => e.type === 'passengerComplete');
    expect(complete).toHaveLength(1);
    expect(r.s.phase).toBe('results');
    const results = (complete[0] as { results: { fare: number; tip: number; mood: number } }).results;
    expect(results.fare).toBe(r.s.results!.fare);
    expect(results.tip).toBe(tipFor(results.mood));
    // The farewell, and nothing after it.
    const after = linesIn(done).concat(linesIn(r.idle(PASSENGER.dialogue.maxSeconds + 1)));
    expect(after).toHaveLength(1);
    expect(who.farewell[r.s.results!.tier]).toContain(after[0]);

    r.cmd.activate = true;
    const dismissed = r.tick();
    expect(dismissed.some((e) => e.type === 'passengerDismissed')).toBe(true);
    expect(r.s.phase).toBe('idle');
    expect(r.s.line).toBe('');
    expect(r.s.queue).toHaveLength(0);
  });

  it('cancels on the second press of the key and pays nothing', () => {
    const r = rig();
    r.board();
    r.cruise(50);
    r.cmd.activate = true;
    r.tick();
    expect(r.s.phase).toBe('riding');
    expect(r.s.cancelArm).toBeGreaterThan(0);
    // Let the arm lapse: a lone press a while ago is not a cancellation.
    r.idle(PASSENGER.cancelArmSeconds + 0.2);
    expect(r.s.cancelArm).toBe(0);
    r.cmd.activate = true;
    r.tick();
    r.cmd.activate = true;
    const ev = r.tick();
    expect(ev.some((e) => e.type === 'passengerCancel')).toBe(true);
    expect(ev.some((e) => e.type === 'passengerComplete')).toBe(false);
    expect(r.s.phase).toBe('idle');
    expect(r.s.trip).toBeNull();
  });

  it('rotates through the catalogue and re-offers after a ride', () => {
    const r = rig();
    const seen: string[] = [];
    for (let i = 0; i < PASSENGERS.length + 1; i++) {
      r.idle(PASSENGER.offer.reofferSeconds + 0.5);
      expect(r.s.phase).toBe('offered');
      seen.push(r.s.trip!.passengerId);
      r.vehicle.x = -500;
      r.vehicle.z = -500;
      // Abandon the offer the only way there is: a restart.
      resetPassengerState(r.s);
    }
    expect(new Set(seen.slice(0, PASSENGERS.length)).size).toBe(PASSENGERS.length);
    expect(seen[PASSENGERS.length]).toBe(seen[0]);
  });
});

/* ================================================================== the mood */

describe('passenger mood', () => {
  it('sits still for free, for everybody', () => {
    for (let i = 0; i < PASSENGERS.length; i++) {
      const r = rig(PASSENGERS.slice(i).concat(PASSENGERS.slice(0, i)));
      r.board();
      r.cruise(0);
      const before = r.s.mood;
      r.idle(20);
      expect(r.s.mood, PASSENGERS[i].id).toBe(before);
    }
  });

  it('rewards the calm driver and nags the fast one, after a grace, for Vera', () => {
    const r = rig([PASSENGERS.find((p) => p.id === 'vera')!]);
    r.board();
    r.cruise(60);
    const start = r.s.mood;
    r.idle(5);
    expect(r.s.mood).toBeGreaterThan(start);
    expect(r.s.prefStatus[0]).toBe('good');
    // A spike over the limit inside the grace costs nothing.
    const calm = r.s.mood;
    r.cruise(95);
    r.idle(PASSENGER.speed.limitGraceSeconds * 0.5);
    expect(r.s.mood).toBe(calm);
    // Held over it, it does, and she says so once.
    const ev = r.idle(4);
    expect(r.s.mood).toBeLessThan(calm);
    expect(r.s.prefStatus[0]).toBe('bad');
    expect(ev.filter((e) => e.type === 'passengerLine').length).toBe(1);
  });

  it('caps what continuous driving can earn', () => {
    const r = rig([PASSENGERS.find((p) => p.id === 'vera')!]);
    r.board();
    r.cruise(60);
    r.idle(120);
    expect(r.s.mood).toBeLessThanOrEqual(PASSENGER.mood.start + PASSENGER.mood.maxFlowGain + 1e-6);
    expect(r.s.flowGain).toBeCloseTo(PASSENGER.mood.maxFlowGain, 5);
  });

  it('pays a drift once, rate-limited and capped, and never for a tiny slide, for Mika', () => {
    const r = rig([PASSENGERS.find((p) => p.id === 'mika')!]);
    r.board();
    r.cruise(80);
    const start = r.s.mood;
    // A tiny slide is nobody's business.
    r.tick([{ type: 'driftEnd', duration: PASSENGER.drift.minSeconds * 0.5, chain: 1 }]);
    expect(r.s.mood).toBe(start);
    // A real one pays.
    const ev = r.tick([{ type: 'driftEnd', duration: 2, chain: 1 }]);
    expect(r.s.mood).toBeGreaterThan(start);
    expect(ev.some((e) => e.type === 'passengerMood' && e.reason === 'driftGood')).toBe(true);
    // The same tick again pays nothing: the cooldown.
    const paid = r.s.mood;
    r.tick([{ type: 'driftEnd', duration: 2, chain: 1 }]);
    expect(r.s.mood).toBe(paid);
    // Farm it and the ceiling holds.
    for (let i = 0; i < 40; i++) {
      r.idle(PASSENGER.drift.cooldown + 0.1);
      r.tick([{ type: 'driftEnd', duration: 4, chain: 1 }]);
    }
    expect(r.s.eventGain).toBeCloseTo(PASSENGER.mood.maxEventGain, 5);
  });

  it('counts a Rayo kill once per car for Nico, and dislikes drifting', () => {
    const r = rig([PASSENGERS.find((p) => p.id === 'nico')!]);
    r.board();
    r.cruise(50);
    const start = r.s.mood;
    const kill = (id: number): GameEvent => ({ type: 'targetDestroyed', targetId: id, x: 0, y: 0, z: 0, reward: 0 });
    r.tick([kill(2)]);
    const once = r.s.mood;
    expect(once).toBeGreaterThan(start);
    r.idle(PASSENGER.rayo.cooldown + 0.1);
    r.tick([kill(2)]);
    expect(r.s.mood).toBe(once);
    r.tick([{ type: 'driftEnd', duration: 2, chain: 1 }]);
    expect(r.s.mood).toBeLessThan(once);
    expect(r.s.penalties).toBe(1);
  });

  it('costs everybody a crash, but a scrape and a grind are not sixty crashes', () => {
    for (const who of PASSENGERS) {
      const r = rig([who]);
      r.board();
      // Parked, so no speed rule moves the mood and only the hits do.
      r.cruise(0);
      const start = r.s.mood;
      const hit = (impact: number): GameEvent => ({ type: 'collision', x: 0, y: 0, z: 0, impact });
      r.tick([hit(PASSENGER.collision.minImpact * 0.5)]);
      expect(r.s.mood, `${who.id} scrape`).toBe(start);
      for (let i = 0; i < 60; i++) r.tick([hit(6)]);
      expect(r.s.mood, `${who.id} grind`).toBeCloseTo(start - PASSENGER.collision.penalty, 5);
      expect(r.s.penalties).toBe(1);
    }
  });

  it('does not repeat a line back to back and drops stale reactions', () => {
    const r = rig([PASSENGERS.find((p) => p.id === 'mika')!]);
    r.board();
    r.idle(PASSENGER.dialogue.maxSeconds * 2 + 2);
    r.cruise(80);
    const texts: string[] = [];
    for (let i = 0; i < 8; i++) {
      r.idle(PASSENGER.dialogue.reactionCooldown + PASSENGER.dialogue.maxSeconds + 1);
      for (const ev of r.tick([{ type: 'driftEnd', duration: 3, chain: 1 }])) if (ev.type === 'passengerLine') texts.push(ev.text);
      for (const ev of r.idle(0.2)) if (ev.type === 'passengerLine') texts.push(ev.text);
    }
    for (let i = 1; i < texts.length; i++) expect(texts[i]).not.toBe(texts[i - 1]);
    // A reaction queued behind a long line that outlives `reactionStale` is dropped.
    r.idle(PASSENGER.dialogue.maxSeconds + 1);
    r.idle(PASSENGER.dialogue.reactionCooldown + 0.1);
    r.tick([{ type: 'collision', x: 0, y: 0, z: 0, impact: 6 }]);
    // The line started at once (nothing was playing) — so queue a second while it plays.
    expect(r.s.line).not.toBe('');
    r.idle(PASSENGER.dialogue.reactionCooldown + 0.1);
    r.s.lineTimeLeft = PASSENGER.dialogue.reactionStale + 2;
    r.tick([{ type: 'collision', x: 0, y: 0, z: 0, impact: 6 }]);
    expect(r.s.queue.length).toBe(1);
    const stale = r.idle(PASSENGER.dialogue.reactionStale + 3).filter((e) => e.type === 'passengerLine');
    expect(stale).toHaveLength(0);
  });

  it('tips nothing under the floor and the maximum at a hundred', () => {
    expect(tipFor(PASSENGER.reward.tipFloor)).toBe(0);
    expect(tipFor(0)).toBe(0);
    expect(tipFor(100)).toBe(PASSENGER.reward.maxTip);
    expect(tipFor(70)).toBeGreaterThan(0);
    expect(tipFor(70)).toBeLessThan(PASSENGER.reward.maxTip);
    expect(farewellTier(PASSENGER.mood.highTier)).toBe('high');
    expect(farewellTier(PASSENGER.mood.mediumTier - 1)).toBe('low');
  });
});

/* ================================================================== with the whole tick */

describe('passenger ride in the city tick', () => {
  const { layout } = createCityWorld();

  it('pays the fare into the money once, and a restart lets the passenger out unpaid', () => {
    const state = createInitialGameState(layout);
    const cmd = createPlayerCommand();
    expect(state.passenger).not.toBeNull();
    const s = state.passenger!;
    const steps = (n: number): void => {
      for (let i = 0; i < n; i++) {
        stepGame(state, cmd, layout, DT);
        cmd.activate = false;
        cmd.restart = false;
      }
    };
    steps(Math.ceil((PASSENGER.offer.firstDelay + 0.5) / DT));
    expect(s.phase).toBe('offered');
    const pickup = stopById(layout.passengerStops, s.trip!.pickupId)!;
    const v = state.vehicle;
    v.x = v.prevX = pickup.x;
    v.z = v.prevZ = pickup.z;
    v.speed = v.vx = v.vz = 0;
    steps(2);
    expect(canBoard(s)).toBe(true);
    cmd.activate = true;
    steps(1);
    expect(s.phase).toBe('riding');

    const money = state.economy.money;
    const dest = stopById(layout.passengerStops, s.trip!.destinationId)!;
    v.x = v.prevX = dest.x;
    v.z = v.prevZ = dest.z;
    v.speed = v.vx = v.vz = 0;
    steps(2);
    expect(canDropOff(s)).toBe(true);
    cmd.activate = true;
    steps(1);
    expect(s.phase).toBe('results');
    const paid = s.results!.fare + s.results!.tip;
    expect(paid).toBeGreaterThan(0);
    expect(state.economy.money).toBe(money + paid);
    steps(30);
    expect(state.economy.money).toBe(money + paid);

    // A second ride, abandoned by a restart: nothing paid, nothing left behind.
    cmd.activate = true;
    steps(1);
    steps(Math.ceil((PASSENGER.offer.reofferSeconds + 0.5) / DT));
    expect(s.phase).toBe('offered');
    const pickup2 = stopById(layout.passengerStops, s.trip!.pickupId)!;
    v.x = v.prevX = pickup2.x;
    v.z = v.prevZ = pickup2.z;
    v.speed = v.vx = v.vz = 0;
    steps(2);
    cmd.activate = true;
    steps(1);
    expect(s.phase).toBe('riding');
    cmd.restart = true;
    stepGame(state, cmd, layout, DT);
    expect(state.events.some((e) => e.type === 'passengerCancel')).toBe(true);
    expect(state.events.some((e) => e.type === 'restart')).toBe(true);
    expect(state.passenger!.phase).toBe('idle');
    expect(state.economy.money).toBe(0);
  });

  it('keeps RAYO RUSH and a ride from overlapping', () => {
    const state = createInitialGameState(layout);
    const cmd = createPlayerCommand();
    const s = state.passenger!;
    const rush = state.rush!;
    const steps = (n: number): void => {
      for (let i = 0; i < n; i++) {
        stepGame(state, cmd, layout, DT);
        cmd.activate = false;
      }
    };
    steps(Math.ceil((PASSENGER.offer.firstDelay + 0.5) / DT));
    const pickup = stopById(layout.passengerStops, s.trip!.pickupId)!;
    const v = state.vehicle;
    v.x = v.prevX = pickup.x;
    v.z = v.prevZ = pickup.z;
    v.speed = v.vx = v.vz = 0;
    steps(2);
    cmd.activate = true;
    steps(1);
    expect(s.phase).toBe('riding');

    // Drive onto the RUSH marker with the passenger aboard: it offers nothing.
    const site = layout.rushSites![0];
    v.x = v.prevX = site.x;
    v.z = v.prevZ = site.z;
    steps(2);
    expect(rush.atMarker).toBe(true);
    expect(rush.locked).toBe(true);
    cmd.activate = true;
    steps(1);
    expect(rush.phase).toBe('idle');
    expect(s.phase).toBe('riding');

    // And the other way: with a run on, a pin cannot be boarded.
    cmd.activate = true;
    steps(1);
    expect(s.phase).toBe('idle');
    steps(2);
    cmd.activate = true;
    steps(1);
    expect(rush.phase).toBe('countdown');
    steps(Math.ceil((PASSENGER.offer.reofferSeconds + 1) / DT));
    expect(rush.phase).toBe('running');
    if (s.phase === 'offered') {
      const pin = stopById(layout.passengerStops, s.trip!.pickupId)!;
      v.x = v.prevX = pin.x;
      v.z = v.prevZ = pin.z;
      v.speed = v.vx = v.vz = 0;
      steps(2);
      expect(canBoard(s)).toBe(false);
      cmd.activate = true;
      steps(1);
      expect(s.phase).toBe('offered');
    } else {
      // The offer waits while the run holds the car.
      expect(s.locked).toBe(true);
    }
  });
});
