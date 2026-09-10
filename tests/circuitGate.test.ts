import { describe, expect, it } from 'vitest';
import { MOOGUL, PASSENGER, RUSH, TIME_ATTACK } from '../src/config/tuning';
import { createPlayerCommand } from '../src/core/input/keyboard';
import type { ActivitySite, GameEvent } from '../src/core/types';
import { activitySuppressed, engagedActivity, moogulActive, passengerEngaged, rushEngaged } from '../src/sim/activities';
import { canEnterCircuit, createCircuitGateState, resetCircuitGateState, stepCircuitGate } from '../src/sim/circuitGate';
import { createInitialGameState, createVehicleState, stepGame } from '../src/sim/gameState';
import { createCityWorld } from '../src/world/cityWorld';
import { createCircuitWorld } from '../src/world/circuitWorld';
import { BUHO_SITE, PASSENGER_STOPS, RUSH_SITES } from '../src/world/citySpec';
import { addCircuitGate, circuitGateSite } from '../src/world/cityCircuitGate';
import { CIRCUIT_GATES } from '../src/world/circuitSpec';

/**
 * THE DOOR INTO THE CIRCUIT MISSIONS (`src/sim/circuitGate.ts`), and ONE ACTIVITY AT A TIME
 * (`src/sim/activities.ts`).
 *
 * Two things are worth pinning here, and they are the two that would be invisible until a player
 * hit them:
 *
 *   THE DOOR itself — that it is only open where the paint is, that one press opens it once, and
 *   that coming back out of the circuit does not immediately throw you back into it.
 *
 *   THE EXCLUSION — that whichever activity has the car is the only one offering anything. Not
 *   as three expressions that happen to agree, but as one answer every activity is derived from,
 *   which is the part that would otherwise rot the next time a fifth activity is added.
 *
 * And one fact about the city: that the ring is painted where the race actually starts, and far
 * enough from every other ring that two signs can never argue over the same key press.
 */

const DT = 1 / 60;
const SITE: ActivitySite = { x: 0, z: 0, y: 0, heading: 0, label: 'START LINE' };

function rig() {
  const s = createCircuitGateState();
  const vehicle = createVehicleState(-200, -200, 0);
  const cmd = createPlayerCommand();
  const events: GameEvent[] = [];
  const tick = (activate = false): GameEvent[] => {
    events.length = 0;
    cmd.activate = activate;
    stepCircuitGate(s, SITE, vehicle, cmd, events);
    return events.slice();
  };
  const at = (x: number, z = 0): void => {
    vehicle.x = x;
    vehicle.z = z;
  };
  return { s, vehicle, cmd, tick, at };
}

const ofType = (events: readonly GameEvent[], type: GameEvent['type']): GameEvent[] => events.filter((e) => e.type === type);

/* ================================================================== the door */

describe('the circuit missions’ door', () => {
  it('offers nothing until the car is standing on the paint', () => {
    const r = rig();
    expect(r.tick()).toEqual([]);
    expect(canEnterCircuit(r.s)).toBe(false);

    r.at(TIME_ATTACK.marker.promptRadius - 0.5);
    expect(r.tick()).toEqual([{ type: 'circuitPrompt', on: true }]);
    expect(canEnterCircuit(r.s)).toBe(true);

    // Standing still on it is not a second offer.
    expect(r.tick()).toEqual([]);
  });

  it('is harder to leave than to enter, so a car parked on the line cannot flicker the sign', () => {
    const r = rig();
    r.at(TIME_ATTACK.marker.promptRadius - 0.2);
    r.tick();
    expect(r.s.atSite).toBe(true);

    // Past the prompt radius but inside the exit radius: still on it.
    r.at((TIME_ATTACK.marker.promptRadius + TIME_ATTACK.marker.exitRadius) / 2);
    expect(r.tick()).toEqual([]);
    expect(r.s.atSite).toBe(true);

    r.at(TIME_ATTACK.marker.exitRadius + 0.2);
    expect(r.tick()).toEqual([{ type: 'circuitPrompt', on: false }]);
    expect(canEnterCircuit(r.s)).toBe(false);
  });

  it('opens once on the press, and not again while the key is held', () => {
    const r = rig();
    r.at(0);
    r.tick();

    const opened = r.tick(true);
    expect(ofType(opened, 'circuitEnter')).toHaveLength(1);
    // And the sign comes down on the same tick: the offer has been accepted.
    expect(ofType(opened, 'circuitPrompt')).toEqual([{ type: 'circuitPrompt', on: false }]);
    expect(r.s.entering).toBe(true);

    // The world takes as many frames to change as it takes, and the key is still down for them.
    expect(ofType(r.tick(true), 'circuitEnter')).toHaveLength(0);
    expect(ofType(r.tick(true), 'circuitEnter')).toHaveLength(0);
  });

  it('will not offer again until the car has driven clear of it', () => {
    const r = rig();
    r.at(0);
    r.tick();
    r.tick(true);
    // Back out of the circuit, put down near the line: still no sign.
    resetEntering(r.s);
    r.at(TIME_ATTACK.marker.rearmRadius - 1);
    r.tick();
    expect(canEnterCircuit(r.s)).toBe(false);

    r.at(TIME_ATTACK.marker.rearmRadius + 1);
    r.tick();
    expect(r.s.rearmed).toBe(true);
    r.at(0);
    expect(r.tick()).toEqual([{ type: 'circuitPrompt', on: true }]);
  });

  it('says nothing at all while another activity has the car', () => {
    const r = rig();
    r.at(0);
    r.tick();
    expect(canEnterCircuit(r.s)).toBe(true);

    // The lock is written by the orchestrator BEFORE the tick runs, so the sign is already down
    // when this module opens its eyes and there is no edge left for it to raise — the same way
    // RAYO RUSH's is. The overlay reads the offer off the snapshot every frame, so the sign
    // still goes away; what does not happen is a chime for it, which is right: being interrupted
    // is not an invitation.
    r.s.locked = true;
    expect(r.tick()).toEqual([]);
    expect(canEnterCircuit(r.s)).toBe(false);
    expect(ofType(r.tick(true), 'circuitEnter')).toHaveLength(0);

    // And back: the offer is live again on the next tick, silently, for the same reason.
    r.s.locked = false;
    expect(r.tick()).toEqual([]);
    expect(canEnterCircuit(r.s)).toBe(true);
  });

  it('is a fresh door after a restart', () => {
    const r = rig();
    r.at(0);
    r.tick();
    r.tick(true);
    expect(r.s.entering).toBe(true);
    resetCircuitGateState(r.s);
    expect(r.s.entering).toBe(false);
    expect(r.s.rearmed).toBe(true);
    expect(r.s.atSite).toBe(false);
  });
});

/** The one thing a caller cannot do through the module's own API: come back from the circuit. */
function resetEntering(s: { entering: boolean }): void {
  s.entering = false;
}

/* ================================================================== the city */

describe('where the door stands', () => {
  const { layout, plan } = addCircuitGate(createCityWorld());

  it('is the Bandido Grid’s own start line, not a spot near it', () => {
    const site = layout.circuitSite!;
    expect(site).toBeTruthy();
    // Within a metre of the gate the circuit is specified at — it is the same point, projected
    // onto the racing line so the ring is squared up with the lap rather than with the street.
    expect(Math.hypot(site.x - CIRCUIT_GATES[0].x, site.z - CIRCUIT_GATES[0].z)).toBeLessThan(1);
    // And facing the way the lap goes: north up av-main, which is heading 0.
    expect(Math.abs(site.heading)).toBeLessThan(0.05);
    expect(plan.circuitMarker).toEqual(layout.circuitSite);
  });

  it('is not written into the city itself: the city does not know the circuit exists', () => {
    // `AGENTS.md`: `citySpec.ts` and `cityWorld.ts` must stay unaware of the race. The door is a
    // layer over the city, exactly as the circuit is — so a plain city carries none of it.
    const plain = createCityWorld();
    expect(plain.layout.circuitSite ?? null).toBeNull();
    expect(plain.plan.circuitMarker ?? null).toBeNull();
  });

  it('is painted on a road, clear of anything solid', () => {
    const site = layout.circuitSite!;
    const r = TIME_ATTACK.marker.promptRadius;
    expect(plan.isRoad(site.x, site.z)).toBe(true);
    // The whole ring, not just its centre: a marker you can only stand on half of is a marker
    // that offers a run from a pavement.
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
      const x = site.x + Math.cos(a) * r;
      const z = site.z + Math.sin(a) * r;
      expect(plan.isRoad(x, z), `ring at ${x.toFixed(0)}, ${z.toFixed(0)}`).toBe(true);
      expect(plan.isSolid(x, z), `ring at ${x.toFixed(0)}, ${z.toFixed(0)}`).toBe(false);
    }
  });

  it('is far enough from every other activity that two signs can never argue', () => {
    const site = circuitGateSite();
    const reach = TIME_ATTACK.marker.rearmRadius;
    for (const rush of RUSH_SITES) {
      expect(Math.hypot(rush.x - site.x, rush.z - site.z)).toBeGreaterThan(RUSH.marker.rearmRadius + reach);
    }
    for (const stop of PASSENGER_STOPS) {
      expect(Math.hypot(stop.x - site.x, stop.z - site.z)).toBeGreaterThan(PASSENGER.marker.exitRadius + reach);
    }
    expect(Math.hypot(BUHO_SITE.x - site.x, BUHO_SITE.z - site.z)).toBeGreaterThan(MOOGUL.marker.exitRadius + reach);
  });

  it('is not in the circuit, and neither is anything else the city does', () => {
    const circuit = createCircuitWorld(7);
    // A race is a race: no door back into itself, and none of the free world's activities
    // standing on the racing line.
    expect(circuit.layout.circuitSite ?? null).toBeNull();
    expect(circuit.layout.rushSites ?? null).toBeNull();
    expect(circuit.layout.passengerStops ?? null).toBeNull();
    expect(circuit.layout.buhoSite ?? null).toBeNull();
    expect(circuit.plan.circuitMarker ?? null).toBeNull();
    expect(circuit.plan.rushMarkers ?? null).toBeNull();

    // And the state built from it carries none of them either, so nothing has to be hidden.
    const state = createInitialGameState(circuit.layout);
    expect(state.circuitGate).toBeNull();
    expect(state.rush).toBeNull();
    expect(state.passenger).toBeNull();
    expect(state.buho).toBeNull();
  });
});

/* ================================================================== one at a time */

describe('one activity at a time', () => {
  it('counts having the car, not being on offer', () => {
    expect(rushEngaged({ phase: 'idle' } as never)).toBe(false);
    expect(rushEngaged({ phase: 'countdown' } as never)).toBe(true);
    expect(rushEngaged({ phase: 'running' } as never)).toBe(true);
    expect(rushEngaged({ phase: 'results' } as never)).toBe(true);
    // Somebody standing at a kerb hoping for a lift has not taken anything.
    expect(passengerEngaged({ phase: 'offered' } as never)).toBe(false);
    expect(passengerEngaged({ phase: 'riding' } as never)).toBe(true);
    expect(passengerEngaged({ phase: 'results' } as never)).toBe(true);
    // And the Moogul never has the car at all: it is bought, not driven, so it is interrupted
    // rather than obeyed.
    expect(moogulActive({ moogulActive: false } as never)).toBe(false);
    expect(moogulActive({ moogulActive: true } as never)).toBe(true);
    expect(engagedActivity({})).toBeNull();
  });

  it('suppresses everything but the activity in hand', () => {
    expect(activitySuppressed(null, 'rush')).toBe(false);
    expect(activitySuppressed('rush', 'rush')).toBe(false);
    expect(activitySuppressed('rush', 'passenger')).toBe(true);
    expect(activitySuppressed('rush', 'circuit')).toBe(true);
    expect(activitySuppressed('passenger', 'moogul')).toBe(true);
  });

  it('shuts the door while a RAYO RUSH run is on, and opens it again afterwards', () => {
    const { layout } = addCircuitGate(createCityWorld());
    const state = createInitialGameState(layout);
    const cmd = createPlayerCommand();
    const v = state.vehicle;

    // Take up a run at the first mission's marker.
    const rushSite = layout.rushSites![0];
    v.x = v.prevX = rushSite.x;
    v.z = v.prevZ = rushSite.z;
    stepGame(state, cmd, layout, DT);
    cmd.activate = true;
    stepGame(state, cmd, layout, DT);
    cmd.activate = false;
    expect(state.rush!.phase).not.toBe('idle');

    // Drive to the start line mid-run: no sign, and the key does nothing.
    const site = layout.circuitSite!;
    v.x = v.prevX = site.x;
    v.z = v.prevZ = site.z;
    stepGame(state, cmd, layout, DT);
    expect(state.circuitGate!.locked).toBe(true);
    expect(canEnterCircuit(state.circuitGate!)).toBe(false);
    cmd.activate = true;
    stepGame(state, cmd, layout, DT);
    cmd.activate = false;
    expect(ofType(state.events, 'circuitEnter')).toHaveLength(0);

    // The run ends; the door is a door again.
    state.rush!.phase = 'idle';
    stepGame(state, cmd, layout, DT);
    expect(state.circuitGate!.locked).toBe(false);
    expect(canEnterCircuit(state.circuitGate!)).toBe(true);
    cmd.activate = true;
    stepGame(state, cmd, layout, DT);
    cmd.activate = false;
    expect(ofType(state.events, 'circuitEnter')).toHaveLength(1);
  });

  it('locks the other three the moment the door is taken', () => {
    const { layout } = addCircuitGate(createCityWorld());
    const state = createInitialGameState(layout);
    const cmd = createPlayerCommand();
    const site = layout.circuitSite!;
    const v = state.vehicle;
    v.x = v.prevX = site.x;
    v.z = v.prevZ = site.z;
    stepGame(state, cmd, layout, DT);
    cmd.activate = true;
    stepGame(state, cmd, layout, DT);
    cmd.activate = false;
    expect(state.circuitGate!.entering).toBe(true);

    // The world is on its way out; nothing else may start in the frames it takes to go.
    stepGame(state, cmd, layout, DT);
    expect(engagedActivity(state)).toBe('circuit');
    expect(state.rush!.locked).toBe(true);
    expect(state.passenger!.locked).toBe(true);
    expect(state.buho!.locked).toBe(true);
  });

  it('keeps a waiting fare from boarding mid-run, without cancelling their ride', () => {
    const { layout } = addCircuitGate(createCityWorld());
    const state = createInitialGameState(layout);
    const cmd = createPlayerCommand();
    const v = state.vehicle;
    const rushSite = layout.rushSites![0];
    v.x = v.prevX = rushSite.x;
    v.z = v.prevZ = rushSite.z;
    stepGame(state, cmd, layout, DT);
    cmd.activate = true;
    stepGame(state, cmd, layout, DT);
    cmd.activate = false;

    const pax = state.passenger!;
    expect(pax.locked).toBe(true);
    // Whatever they were doing, they go on doing it: locking is not cancelling.
    expect(pax.phase === 'idle' || pax.phase === 'offered').toBe(true);
  });
});
