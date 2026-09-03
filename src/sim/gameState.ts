import type {
  ArenaLayout,
  DriftState,
  EconomyState,
  GameState,
  LightningState,
  NitroState,
  PlayerCommand,
  VehicleState,
} from '../core/types';
import { NITRO } from '../config/tuning';
import { stepVehicle } from './vehicle';
import { resolveCollisions, resolveTargetCollisions } from './collision';
import { stepDrift } from './drift';
import { stepNitro } from './nitro';
import { stepLightning } from './lightning';
import { createTargets, resetTargets, stepTargets } from './targets';
import { applyRewards } from './economy';

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
    economy: createEconomyState(),
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
  state.economy = createEconomyState();
  state.events.length = 0;
}

export function stepGame(state: GameState, cmd: PlayerCommand, layout: ArenaLayout, dt: number): void {
  state.events.length = 0;
  if (cmd.restart) {
    resetGameState(state, layout);
    state.events.push({ type: 'restart' });
    return;
  }
  state.time += dt;
  state.tick++;
  state.economy.lastReward = 0;

  stepNitro(state.nitro, state.vehicle, cmd, dt, state.events);
  stepVehicle(state.vehicle, cmd, state.nitro.active, dt);
  resolveCollisions(state.vehicle, layout, state.events);
  stepDrift(state.drift, state.vehicle, dt, state.events);
  stepTargets(state.targets, layout, state.time, dt);
  resolveTargetCollisions(state.vehicle, state.targets, state.events);
  stepLightning(state.lightning, state.vehicle, state.targets, state.drift, cmd, state.time, dt, state.events);
  applyRewards(state.economy, state.targets, state.events);
}
