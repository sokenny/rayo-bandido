import { describe, expect, it } from 'vitest';
import type { GameEvent, PlayerCommand } from '../src/core/types';
import { createOpenWorld } from '../src/world/openWorld';
import { createInitialGameState, stepGame } from '../src/sim/gameState';
import { createPlayerCommand } from '../src/core/input/keyboard';
import { engagedActivity } from '../src/sim/activities';
import { isPoliceEnabledForCurrentGameState } from '../src/sim/police';
import { applyWorkshopCommand, WORKSHOP_TIMING } from '../src/sim/workshop';
import { LOCO_MUSTANG_SHOP } from '../src/content/shops';
import { restVehicle } from '../src/sim/surface';
import { SIM_STEP } from '../src/config/tuning';

/**
 * Loco Mustang's workshop as the open world runs it (`src/sim/gameState.ts`, Ola 2): the key on
 * the ring is the door, the visit holds the car and switches the rest of the city's offers and the
 * police off, and a world whose caller handed in no save keeps the garage from before it opened.
 */

const world = createOpenWorld();
const layout = world.layout;
const site = layout.garageSite!;

function onRing(withWorkshop: boolean) {
  const state = createInitialGameState(layout, 'auto', { police: true, workshop: withWorkshop ? {} : null });
  const v = state.vehicle;
  v.x = v.prevX = site.x;
  v.z = v.prevZ = site.z;
  v.y = v.prevY = site.y;
  restVehicle(v);
  v.heading = v.prevHeading = site.heading;
  return state;
}

function tick(state: ReturnType<typeof onRing>, cmd: PlayerCommand, seen: GameEvent[] = []): void {
  stepGame(state, cmd, layout, SIM_STEP);
  seen.push(...state.events);
}

describe('the workshop in the open world', () => {
  it('has the garage in this world', () => {
    expect(site).toBeTruthy();
  });

  it('opens on the key at the ring, holds the car and turns the police off', () => {
    const state = onRing(true);
    const idle = createPlayerCommand();
    const key = { ...createPlayerCommand(), activate: true };
    const seen: GameEvent[] = [];
    tick(state, idle, seen);
    expect(state.garage!.atSite).toBe(true);
    tick(state, key, seen);
    expect(seen.some((e) => e.type === 'workshopEnter')).toBe(true);
    expect(state.workshop!.phase).toBe('entering');
    expect(engagedActivity(state)).toBe('workshop');
    expect(isPoliceEnabledForCurrentGameState(state)).toBe(false);
    // Loco Mustang's welcome goes out as a line of its own kind (the showroom voices it).
    expect(state.garage!.lineKind).toBe('welcome');

    // Full throttle does nothing: the car is on the turntable.
    const gas = { ...createPlayerCommand(), throttle: 1, fire: true };
    const x = state.vehicle.x;
    const z = state.vehicle.z;
    for (let i = 0; i < Math.ceil(2 / SIM_STEP); i++) tick(state, gas, seen);
    expect(Math.hypot(state.vehicle.x - x, state.vehicle.z - z)).toBeLessThan(0.05);
    expect(state.workshop!.phase).toBe('browsing');
    expect(seen.some((e) => e.type === 'lightningFired')).toBe(false);
  });

  it('lets the car go when the visit is over, with a goodbye', () => {
    const state = onRing(true);
    const idle = createPlayerCommand();
    tick(state, idle);
    tick(state, { ...createPlayerCommand(), activate: true });
    for (let i = 0; i < Math.ceil((WORKSHOP_TIMING.enterSeconds + 0.1) / SIM_STEP); i++) tick(state, idle);
    const events: GameEvent[] = [];
    applyWorkshopCommand(state.workshop!, { type: 'exit' }, LOCO_MUSTANG_SHOP, state.economy, events);
    expect(state.workshop!.phase).toBe('leaving');
    const seen: GameEvent[] = [];
    for (let i = 0; i < Math.ceil((WORKSHOP_TIMING.leaveSeconds + 0.1) / SIM_STEP); i++) tick(state, idle, seen);
    expect(seen.some((e) => e.type === 'workshopExit')).toBe(true);
    expect(state.workshop!.phase).toBe('closed');
    expect(engagedActivity(state)).toBeNull();
    expect(state.garage!.lineKind).toBe('goodbye');
    // And drives again.
    const gas = { ...createPlayerCommand(), throttle: 1 };
    for (let i = 0; i < Math.ceil(1 / SIM_STEP); i++) tick(state, gas);
    expect(Math.abs(state.vehicle.speed)).toBeGreaterThan(1);
  });

  it('keeps its door shut with the police on the car', () => {
    const state = onRing(true);
    tick(state, createPlayerCommand());
    state.police!.phase = 'pursuit';
    const seen: GameEvent[] = [];
    tick(state, { ...createPlayerCommand(), activate: true }, seen);
    // The police step may have moved the phase on; the door answered before it ran.
    expect(seen.some((e) => e.type === 'workshopDenied' && e.reason === 'police')).toBe(true);
    expect(state.workshop!.phase).toBe('closed');
  });

  it('is the garage from before without a save handed in', () => {
    const state = onRing(false);
    expect(state.workshop).toBeNull();
    const seen: GameEvent[] = [];
    tick(state, createPlayerCommand(), seen);
    tick(state, { ...createPlayerCommand(), activate: true }, seen);
    const lines = seen.filter((e): e is Extract<GameEvent, { type: 'garageLine' }> => e.type === 'garageLine');
    expect(lines.map((l) => l.kind)).toEqual(['greeting', 'soon']);
    expect(engagedActivity(state)).toBeNull();
  });
});
