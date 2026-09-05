import type {
  ArenaLayout,
  DriftState,
  EconomyState,
  GameState,
  LightningState,
  NitroState,
  PlayerCommand,
  RivalCar,
  VehicleState,
} from '../core/types';
import { NITRO } from '../config/tuning';
import { stepVehicle } from './vehicle';
import { resolveCollisions, resolveTargetCollisions } from './collision';
import { resolveRivalCollisions } from './rivalCollision';
import { stepDrift } from './drift';
import { stepNitro } from './nitro';
import { stepLightning } from './lightning';
import { createTargets, resetTargets, stepTargets } from './targets';
import { createNearMissState, resetNearMissState, stepNearMiss } from './nearMiss';
import { applyRewards } from './economy';
import { createRaceState, resetRaceState, stepRace } from './race';

/**
 * Simulation orchestrator. Pure data in, pure data out; no Three.js, no DOM.
 * Fixed order per tick so every rule sees a consistent view of the world.
 */

export function createVehicleState(x: number, z: number, heading: number): VehicleState {
  return {
    x,
    z,
    heading,
    prevX: x,
    prevZ: z,
    prevHeading: heading,
    vx: 0,
    vz: 0,
    yawRate: 0,
    speed: 0,
    lateralSpeed: 0,
    slipAngle: 0,
    latAccel: 0,
    longAccel: 0,
    steerAngle: 0,
    wheelSpin: 0,
    throttleApplied: 0,
    brakeApplied: 0,
    handbrake: false,
    collided: false,
    collisionImpact: 0,
  };
}

export function createDriftState(): DriftState {
  return { active: false, duration: 0, candidateTime: 0, lapseTime: 0, chain: 0, chainWindow: 0, chargeRate: 0 };
}

export function createNitroState(): NitroState {
  return { amount: NITRO.capacity, active: false, rechargeDelay: 0 };
}

export function createLightningState(): LightningState {
  return { charge: 0, acquiredTargetId: -1, cooldown: 0, arcTimer: 0, lastTargetId: -1 };
}

export function createEconomyState(): EconomyState {
  return { money: 0, destroyed: 0, lastReward: 0 };
}

export function createInitialGameState(layout: ArenaLayout): GameState {
  const s = layout.playerSpawn;
  return {
    time: 0,
    tick: 0,
    vehicle: createVehicleState(s.x, s.z, s.heading),
    drift: createDriftState(),
    nitro: createNitroState(),
    lightning: createLightningState(),
    targets: createTargets(layout),
    nearMiss: createNearMissState(layout.targetSpawns.length),
    economy: createEconomyState(),
    race: layout.race ? createRaceState(layout.race) : null,
    events: [],
  };
}

/** Restore the initial playable state in place (instant restart). */
export function resetGameState(state: GameState, layout: ArenaLayout): void {
  const s = layout.playerSpawn;
  state.time = 0;
  state.tick = 0;
  state.vehicle = createVehicleState(s.x, s.z, s.heading);
  state.drift = createDriftState();
  state.nitro = createNitroState();
  state.lightning = createLightningState();
  resetTargets(state.targets, layout);
  resetNearMissState(state.nearMiss);
  state.economy = createEconomyState();
  if (state.race && layout.race) resetRaceState(state.race, layout.race);
  state.events.length = 0;
}

/**
 * The command applied while a race countdown holds the car on the grid: handbrake on, no
 * throttle. Steering and fire are copied from the player's command so the wheels turn and
 * the lightning still works. One long-lived object, never allocated per tick.
 */
const HOLD: PlayerCommand = { throttle: 0, brake: 0, steer: 0, handbrake: true, nitro: false, fire: false, restart: false, cruise: false, pov: false };

/** What a multiplayer race adds to a tick. Absent in single player. */
export interface StepOptions {
  /** The other players' cars, already interpolated onto this instant by `src/net/rivals.ts`. */
  rivals?: readonly RivalCar[] | null;
  /**
   * Whether destroyed electric cars come back on this client's own clock. False for a
   * client that does not own the traffic: the host's report brings a car back, so the two
   * copies never disagree about whether it is there.
   */
  respawnTraffic?: boolean;
}

/**
 * One simulation tick.
 *
 * `options.rivals` is the other players' cars in a multiplayer race; it is null in single
 * player. They are resolved right after the world collision and before the electric cars,
 * so the order a tick sees is: walls first (they never move), then the other humans, then
 * traffic, then the rules. Everything else is unchanged by their presence.
 */
export function stepGame(
  state: GameState,
  cmd: PlayerCommand,
  layout: ArenaLayout,
  dt: number,
  options: StepOptions | null = null,
): void {
  const rivals = options?.rivals ?? null;
  const respawnTraffic = options?.respawnTraffic ?? true;
  state.events.length = 0;
  if (cmd.restart) {
    resetGameState(state, layout);
    state.events.push({ type: 'restart' });
    return;
  }
  state.time += dt;
  state.tick++;
  state.economy.lastReward = 0;

  // Race countdown: the car is held on the grid until GO.
  const race = state.race;
  let input = cmd;
  if (race && race.phase === 'countdown') {
    HOLD.steer = cmd.steer;
    HOLD.fire = cmd.fire;
    input = HOLD;
  }

  stepNitro(state.nitro, state.vehicle, input, dt, state.events);
  stepVehicle(state.vehicle, input, state.nitro.active, dt);
  resolveCollisions(state.vehicle, layout, state.events);
  if (rivals) resolveRivalCollisions(state.vehicle, rivals, state.events);
  stepDrift(state.drift, state.vehicle, dt, state.events);
  stepTargets(state.targets, layout, state.time, dt, respawnTraffic);
  resolveTargetCollisions(state.vehicle, state.targets, state.events);
  stepNearMiss(state.nearMiss, state.vehicle, state.targets, state.events);
  stepLightning(state.lightning, state.vehicle, state.targets, state.drift, input, state.time, dt, state.events);
  applyRewards(state.economy, state.targets, state.events);
  if (race && layout.race) stepRace(race, layout.race, state.vehicle, state.time, dt, state.events);
}
