import type {
  Transmission,
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
import { FLAIR, NITRO } from '../config/tuning';
import { stepVehicle } from './vehicle';
import { resolveCollisions, resolveTargetCollisions } from './collision';
import { resolveRivalCollisions } from './rivalCollision';
import { createStreetPropsState, resetStreetPropsState, stepStreetProps } from './streetProps';
import { breakDriftChain, stepDrift } from './drift';
import { crashStalled, createCrashDamageState, resetCrashDamageState, stepCrashDamage, type CrashRules } from './crashDamage';
import { stepNitro } from './nitro';
import { stepLightning } from './lightning';
import { createTargets, resetTargets, stepTargets } from './targets';
import { createBuses, resetBuses, stepBuses } from './buses';
import { createNearMissState, resetNearMissState, stepNearMiss } from './nearMiss';
import { applyPassengerFare, applyPoliceFine, applyRewards } from './economy';
import { createRaceState, resetRaceState, stepRace } from './race';
import { createTimeAttackState, resetTimeAttackState, stepTimeAttack } from './timeAttack';
import { createRushState, resetRushState, rushSiteFor, stepRush } from './rush';
import { createFlairState, resetFlairState, stepFlair } from './flair';
import { canBoard, canDropOff, cancelRide, createPassengerState, resetPassengerState, stepPassenger } from './passenger';
import { createHustlerState, resetHustlerState, stepHustlers, type HustlerContext } from './hustlers';
import { createBuhoState, endMoogul, resetBuhoState, stepBuho } from './buho';
import { createGarageState, resetGarageState, stepGarage } from './garage';
import { createCircuitGateState, resetCircuitGateState, stepCircuitGate } from './circuitGate';
import { createStreetGateState, resetStreetGateState, stepStreetGate } from './streetGate';
import { introEngaged, lockOtherActivities } from './activities';
import { createPoliceState, isPoliceEnabledForCurrentGameState, policeHoldsPlayer, resetPoliceState, stepPolice, type StepPoliceOptions } from './police';
import { createIntroState, introHoldsPlayer, resetIntroState, stepIntro } from './intro';
import { PASSENGERS } from '../content/passengers';
import { INTRO } from '../content/intro';
import { settleVehicle } from './surface';

/**
 * Simulation orchestrator. Pure data in, pure data out; no Three.js, no DOM.
 * Fixed order per tick so every rule sees a consistent view of the world.
 */

export function createVehicleState(x: number, z: number, heading: number, y = 0): VehicleState {
  return {
    x,
    z,
    y,
    heading,
    prevX: x,
    prevZ: z,
    prevY: y,
    prevHeading: heading,
    pitch: 0,
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
    reverseArm: 0,
    handbrake: false,
    handbrakeHold: 0,
    handbrakeYaw: 0,
    collided: false,
    collisionImpact: 0,
    slide: 0,
    gear: 0,
    rpm01: 0,
    spinRev: 0,
    wheelspin: 0,
    limiterTime: 0,
    limiterCut: 0,
    limiterPhase: 0,
    shiftHold: 0,
    counterSteer: 0,
  };
}

export function createDriftState(): DriftState {
  return { active: false, duration: 0, candidateTime: 0, lapseTime: 0, chain: 0, chainWindow: 0, chargeRate: 0 };
}

export function createNitroState(): NitroState {
  return { amount: NITRO.capacity, active: false, rechargeDelay: 0 };
}

export function createLightningState(): LightningState {
  return { charge: 0, acquiredTargetId: -1, hold: 0, spent: 0, charging: false, armed: true, cooldown: 0, arcTimer: 0, lastTargetId: -1 };
}

export function createEconomyState(): EconomyState {
  return { money: 0, destroyed: 0, lastReward: 0 };
}

/**
 * What the caller decides about a fresh state, beyond the layout.
 *
 * `timeAttack` is the circuit mission chain, and it is here rather than derived from the layout
 * because the layout cannot tell the two circuits apart: the solo lap and the versus race are
 * driven on the same course, and only the caller knows which one this is. It defaults to off,
 * so every world that has never heard of the chain is unaffected.
 */
export interface GameStateOptions {
  /** Run the circuit mission chain on this race, starting from `timeAttackCleared` missions done. */
  timeAttack?: boolean;
  timeAttackCleared?: number;
  /**
   * Build the police (`src/sim/police.ts`). Only the open world wants them, and only the caller
   * knows which world this is; defaults to off, so every other world is untouched.
   */
  police?: boolean;
  /** How many STREET RACE events are won, for the rings in the street (`src/sim/streetGate.ts`). */
  streetRaceCleared?: number;
  /**
   * Run the first-time introduction (`src/sim/intro.ts`), with the meet's furniture already
   * appended to the layout (`installIntroMeetup`). Defaults to off.
   */
  intro?: boolean;
}

export function createInitialGameState(
  layout: ArenaLayout,
  transmission: Transmission = 'auto',
  options: GameStateOptions = {},
): GameState {
  const s = layout.playerSpawn;
  const state: GameState = {
    transmission,
    time: 0,
    tick: 0,
    vehicle: createVehicleState(s.x, s.z, s.heading, s.y ?? 0),
    drift: createDriftState(),
    nitro: createNitroState(),
    lightning: createLightningState(),
    targets: createTargets(layout),
    buses: createBuses(layout),
    nearMiss: createNearMissState(layout.targetSpawns.length),
    economy: createEconomyState(),
    race: layout.race ? createRaceState(layout.race) : null,
    timeAttack: layout.race && options.timeAttack ? createTimeAttackState(options.timeAttackCleared ?? 0) : null,
    rush: layout.rushSites && layout.rushSites.length > 0 ? createRushState(layout.targetSpawns.length) : null,
    // The crash line is said wherever a crash can be charged, rush or no rush.
    flair: (layout.rushSites && layout.rushSites.length > 0) || layout.garageSite ? createFlairState() : null,
    passenger: layout.passengerStops && layout.passengerStops.length > 0 ? createPassengerState(layout.targetSpawns.length, layout.passengerTrip ?? undefined) : null,
    buho: layout.buhoSite ? createBuhoState() : null,
    garage: layout.garageSite ? createGarageState() : null,
    crash: layout.garageSite || layout.race ? createCrashDamageState() : null,
    circuitGate: layout.circuitSite ? createCircuitGateState() : null,
    streetGate: layout.streetSites && layout.streetSites.length > 0 ? createStreetGateState(options.streetRaceCleared ?? 0) : null,
    police: options.police ? createPoliceState(layout) : null,
    intro: options.intro ? createIntroState() : null,
    streetProps: createStreetPropsState(layout),
    hustlers: layout.hustlerSpots && layout.hustlerSpots.length > 0 ? createHustlerState(layout.hustlerSpots) : null,
    events: [],
  };
  return state;
}

/** Restore the initial playable state in place (instant restart). */
export function resetGameState(state: GameState, layout: ArenaLayout): void {
  const s = layout.playerSpawn;
  state.time = 0;
  state.tick = 0;
  state.vehicle = createVehicleState(s.x, s.z, s.heading, s.y ?? 0);
  state.drift = createDriftState();
  state.nitro = createNitroState();
  state.lightning = createLightningState();
  resetTargets(state.targets, layout);
  resetBuses(state.buses, layout);
  resetNearMissState(state.nearMiss);
  state.economy = createEconomyState();
  if (state.race && layout.race) resetRaceState(state.race, layout.race);
  // The chain's own progress survives this, the way the rush's does: a restart puts the car
  // back on the grid, it does not un-finish missions that were finished.
  if (state.timeAttack) resetTimeAttackState(state.timeAttack);
  if (state.rush) resetRushState(state.rush);
  if (state.flair) resetFlairState(state.flair);
  if (state.passenger) resetPassengerState(state.passenger);
  if (state.buho) resetBuhoState(state.buho);
  if (state.garage) resetGarageState(state.garage);
  if (state.crash) resetCrashDamageState(state.crash);
  if (state.circuitGate) resetCircuitGateState(state.circuitGate);
  if (state.streetGate) resetStreetGateState(state.streetGate);
  if (state.police) resetPoliceState(state.police);
  // The intro goes back to its safe beginning (`resetIntroState` leaves a finished one alone).
  if (state.intro) resetIntroState(state.intro);
  if (state.streetProps) resetStreetPropsState(state.streetProps);
  if (state.hustlers) resetHustlerState(state.hustlers);
  state.events.length = 0;
}

/** Speed (m/s) under which the intro's hold lets go of the brake: see the hold in `stepGame`. */
const INTRO_HOLD_BRAKE_SPEED = 1;

/**
 * The command applied while a race countdown holds the car on the grid: handbrake on, no
 * throttle. Steering and fire are copied from the player's command so the wheels turn and
 * the lightning still works. Each holder sets the brake it wants. One long-lived object,
 * never allocated per tick.
 */
const HOLD: PlayerCommand = {
  throttle: 0,
  brake: 0,
  steer: 0,
  handbrake: true,
  nitro: false,
  fire: false,
  restart: false,
  cruise: false,
  pov: false,
  shiftUp: false,
  shiftDown: false,
  transmission: false,
  activate: false,
};

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
  /** Cruise mode is driving: a manual box shifts itself, the autopilot has no hands for it. */
  cruising?: boolean;
  /**
   * Whether a RAYO RUSH run started this tick would be one of the day's ranked attempts. Owned
   * by the caller because the allowance lives outside the simulation
   * (`src/net/leaderboard.ts`); defaults to true, which is what a world with no board would
   * want. A run is identical either way — an unranked one simply is not submitted.
   */
  rushRanked?: boolean;
  /**
   * The car was put back somewhere by the caller this tick (a multiplayer rescue): a passenger
   * in it is let out with nothing paid. Consumed on the tick it is seen.
   */
  respawned?: boolean;
  /**
   * Whether police cars may shove the civilian traffic. False on a client that does not own the
   * traffic, so a local-only chase never fights the host's reports. Defaults to true.
   */
  policeShoveTraffic?: boolean;
}

/** What `stepPolice` is told about the tick. One object, never reallocated. */
const POLICE_OPTIONS: StepPoliceOptions = { enabled: false, shoveTraffic: true };

/** What `stepCrashDamage` is told about the tick. One object, never reallocated. */
const CRASH_RULES: CrashRules = { enabled: false, atGarage: false, stall: false };

/** What `stepHustlers` is told about the car. One object, never reallocated. */
const HUSTLER_CONTEXT: HustlerContext = { damaged: false, pursued: false };

/**
 * Whether another activity's prompt is up right now, so the F key is already spoken for: a washer
 * never puts an offer up over a ring, a pin or a door that the same key would answer.
 */
function keyClaimed(state: GameState): boolean {
  if (state.rush && (state.rush.atMarker || state.rush.phase !== 'idle')) return true;
  if (state.passenger && (canBoard(state.passenger) || canDropOff(state.passenger))) return true;
  if (state.buho?.atSite || state.garage?.atSite || state.circuitGate?.atSite) return true;
  return !!state.streetGate && state.streetGate.atSite >= 0;
}

/**
 * The command a race crash stall applies (`src/sim/crashDamage.ts`): the engine is dead and the
 * brakes are on, but the wheel still turns, so the car can be pointed back up the road while it
 * waits. The handbrake only holds it once it has stopped — pulled at speed it would spin the car.
 */
const STALL: PlayerCommand = { ...HOLD, handbrake: false };

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
    // A passenger aboard is let out unpaid. The reset wipes the event list along with the
    // ride, so the cancellation is raised after it, ahead of the restart itself.
    const aboard = state.passenger && state.passenger.phase === 'riding' && state.passenger.trip ? state.passenger.trip.passengerId : null;
    // The Moogul does not survive a restart either; the reset clears it, so the end is
    // raised afterwards, the same way the ride's cancellation is.
    const tripping = !!state.buho && state.buho.moogulActive;
    resetGameState(state, layout);
    if (aboard !== null) state.events.push({ type: 'passengerCancel', passengerId: aboard, reason: 'restart' });
    if (tripping) state.events.push({ type: 'moogulEnd', reason: 'restart' });
    state.events.push({ type: 'restart' });
    return;
  }
  if (cmd.transmission) {
    state.transmission = state.transmission === 'auto' ? 'manual' : 'auto';
    state.events.push({ type: 'transmission', mode: state.transmission });
  }
  const manual = state.transmission === 'manual' && !options?.cruising;
  state.time += dt;
  state.tick++;
  state.economy.lastReward = 0;

  // Race countdown: the car is held on the grid until GO.
  const race = state.race;
  let input = cmd;
  if (race && race.phase === 'countdown') {
    HOLD.steer = cmd.steer;
    HOLD.brake = 0;
    HOLD.fire = cmd.fire;
    HOLD.activate = cmd.activate;
    input = HOLD;
  }
  // Under arrest (`src/sim/police.ts`): the car is held the way the grid holds it, and the
  // weapon is holstered too — a BUSTED card is not a moment to be firing.
  if (policeHoldsPlayer(state.police)) {
    HOLD.steer = 0;
    HOLD.brake = 0;
    HOLD.fire = false;
    HOLD.activate = false;
    input = HOLD;
  }
  // The opening cinematic (`src/sim/intro.ts`): the car waits under the deck until it is over.
  // Unlike the grid and the arrest, this one brakes as well as pulling the handbrake — pulling
  // into the meet has to END at the meet, not twenty metres past it in a handbrake slide. The
  // brake comes off again at walking pace, because holding it at a standstill arms reverse.
  if (introHoldsPlayer(state.intro)) {
    HOLD.steer = 0;
    HOLD.brake = state.vehicle.speed > INTRO_HOLD_BRAKE_SPEED || state.vehicle.speed < -INTRO_HOLD_BRAKE_SPEED ? 1 : 0;
    HOLD.fire = false;
    HOLD.activate = false;
    input = HOLD;
  }
  // A race crash stall (`src/sim/crashDamage.ts`): brakes down to walking pace, then the handbrake,
  // the same release the intro's hold uses so a standing car never arms reverse.
  if (crashStalled(state.crash)) {
    const moving = state.vehicle.speed > INTRO_HOLD_BRAKE_SPEED || state.vehicle.speed < -INTRO_HOLD_BRAKE_SPEED;
    STALL.steer = cmd.steer;
    STALL.brake = moving ? 1 : 0;
    STALL.handbrake = !moving;
    input = STALL;
  }

  stepNitro(state.nitro, state.vehicle, input, dt, state.events);
  stepVehicle(state.vehicle, input, state.nitro.active, dt, state.drift.active, manual);
  // The buses are moving walls: they are stepped before the collision pass, so the car is
  // pushed off where a bus IS this tick and not off where it was last tick.
  stepBuses(state.buses, layout, dt);
  // Which level the car is on decides which walls are walls for it, so the road height is
  // read before the collision pass.
  settleVehicle(state.vehicle, layout);
  resolveCollisions(state.vehicle, layout, state.events, dt);
  // The pavement's light clutter and chargers, right behind the walls (`src/sim/streetProps.ts`).
  if (state.streetProps) stepStreetProps(state.streetProps, state.vehicle, layout, state.time, dt, state.events);
  if (rivals) resolveRivalCollisions(state.vehicle, rivals, state.events);
  stepDrift(state.drift, state.vehicle, dt, state.events);
  stepTargets(state.targets, layout, state.time, dt, respawnTraffic);
  resolveTargetCollisions(state.vehicle, state.targets, state.events);
  stepNearMiss(state.nearMiss, state.vehicle, state.targets, state.events);
  stepLightning(state.lightning, state.vehicle, state.targets, state.drift, input, state.time, dt, state.events);
  // The introduction (`src/sim/intro.ts`), right behind the shot: it sees the kill the beam
  // just made on this very tick.
  if (state.intro) stepIntro(state.intro, INTRO, state, dt, state.events);
  // A RAYO RUSH run has no police on the car, so its kills pay the reduced bounty.
  const rushOn = state.rush?.phase === 'countdown' || state.rush?.phase === 'running';
  applyRewards(state.economy, state.targets, state.events, rushOn);
  if (race && layout.race) stepRace(race, layout.race, state.vehicle, state.time, dt, state.events);
  // Right behind the race, and only ever watching it: the circuit mission chain judges the
  // finish `stepRace` decided on this tick against the crashes the collision pass raised
  // earlier on it (`src/sim/timeAttack.ts`). It cannot change the outcome of a lap.
  if (race && state.timeAttack) stepTimeAttack(state.timeAttack, race, dt, state.events);
  // Last, and deliberately so: the free-world activity scores what the tick already decided
  // (`src/sim/rush.ts`). It reads the `targetDestroyed` events raised above and changes
  // nothing about the car, the traffic or the weapon.
  // Which site the marker stands on is a function of how far through the mission chain the
  // player is, so it is looked up per tick rather than captured once: clearing a level moves
  // the marker on the very next tick, with nothing to rebuild and nothing to notify.
  // ONE ACTIVITY AT A TIME, decided in one place (`src/sim/activities.ts`): whichever of them
  // has the car locks the other three out of offering, starting or taking the key. Asked again
  // before each one rather than once for the tick, so an activity that began on THIS tick
  // already has the car by the time the next is stepped — which is what makes the order below
  // the tie-break for a tick on which two of them could have started.
  const passenger = state.passenger;
  lockOtherActivities(state);
  const rushSite = state.rush ? rushSiteFor(layout.rushSites, state.rush.cleared) : null;
  if (state.rush && rushSite) {
    stepRush(
      state.rush,
      rushSite,
      state.vehicle,
      state.drift,
      cmd,
      state.targets,
      options?.rushRanked ?? true,
      dt,
      state.events,
    );
  }
  lockOtherActivities(state);
  if (passenger && layout.passengerStops && layout.passengerStops.length > 0) {
    if (options?.respawned) cancelRide(passenger, 'respawn', state.events);
    const from = state.events.length;
    stepPassenger(
      passenger,
      PASSENGERS,
      layout.passengerStops,
      state.vehicle,
      state.drift,
      cmd,
      state.targets,
      dt,
      state.time,
      state.events,
    );
    // Paid here and only here, on the event the rules raise exactly once per ride.
    applyPassengerFare(state.economy, state.events, from);
  }
  // El Búho (`src/sim/buho.ts`). He sells only while nobody else has the car — no run in any
  // phase but idle, no passenger aboard or settling up, nobody on their way to the circuit —
  // and a run, a ride or a departure that started THIS tick ends the Moogul before it starts,
  // on the very event that began it, so the two never overlap for even a frame.
  const buho = state.buho;
  lockOtherActivities(state);
  if (buho && layout.buhoSite) {
    if (options?.respawned) endMoogul(buho, 'respawn', state.events);
    const events = state.events;
    for (let i = 0; i < events.length; i++) {
      const t = events[i].type;
      if (t === 'rushStart' || t === 'passengerBoard' || t === 'circuitEnter' || t === 'streetRaceEnter') {
        endMoogul(buho, 'interrupted', state.events);
        break;
      }
    }
    stepBuho(buho, layout.buhoSite, state.vehicle, state.economy, cmd, dt, state.events);
  }
  // Loco Mustang's garage (`src/sim/garage.ts`): not open yet, and he says so. Never holds the car.
  lockOtherActivities(state);
  if (state.garage && layout.garageSite) {
    stepGarage(state.garage, layout.garageSite, state.vehicle, cmd, dt, state.events);
  }
  // The door to the circuit missions (`src/sim/circuitGate.ts`), last of all: it is the one
  // activity that ends this world rather than happening inside it, so it is offered only once
  // everything else has had its say about whether the car is free.
  lockOtherActivities(state);
  if (state.circuitGate && layout.circuitSite) {
    stepCircuitGate(state.circuitGate, layout.circuitSite, state.vehicle, cmd, state.events);
  }
  // The STREET RACE rings (`src/sim/streetGate.ts`): the same kind of door, to a different race.
  lockOtherActivities(state);
  if (state.streetGate && layout.streetSites && layout.streetSites.length > 0) {
    stepStreetGate(state.streetGate, layout.streetSites, state.vehicle, cmd, state.events);
  }
  // The police, after everything: whether they may exist is a function of what the activities
  // above decided (`isPoliceEnabledForCurrentGameState`), and an activity that began THIS tick
  // switches them off on the same tick. Reads the tick's kills; raises its own events; the fine
  // an arrest asks for is taken right behind it, in the one place money is taken.
  if (state.police) {
    POLICE_OPTIONS.enabled = isPoliceEnabledForCurrentGameState(state);
    POLICE_OPTIONS.shoveTraffic = options?.policeShoveTraffic ?? true;
    const from = state.events.length;
    stepPolice(state.police, layout, state.vehicle, state.targets, state.lightning, state.time, dt, state.events, POLICE_OPTIONS);
    applyPoliceFine(state.economy, state.police, state.events, from);
  }
  // Crash damage (`src/sim/crashDamage.ts`), after every pass that can put the car into something
  // — the police's shove included — so a tick's accident is judged on all of it at once. A punished
  // crash ends the drift chain here; the flair streak is cut right below. Never during the intro;
  // in a race only while it is actually being raced, and there it stalls the car instead of fining it.
  let crashed = false;
  if (state.crash) {
    CRASH_RULES.stall = !!race;
    CRASH_RULES.enabled = race ? race.phase === 'racing' : !introEngaged(state.intro);
    CRASH_RULES.atGarage = !!state.garage && state.garage.atSite;
    crashed = stepCrashDamage(state.crash, state.economy, CRASH_RULES, state.time, dt, state.events) !== null;
    if (crashed) breakDriftChain(state.drift, state.events);
  }
  // The trapitos and the washers (`src/sim/hustlers.ts`), once the tick has decided whether the car
  // is dented and whether the police are on it. Never an activity that holds the car: they go quiet
  // while one does, never take the key from another prompt, and never talk over anyone else.
  if (state.hustlers && layout.hustlerSpots) {
    const h = state.hustlers;
    h.locked = lockOtherActivities(state) !== null;
    h.keyBusy = keyClaimed(state);
    h.othersTalking = (!!state.passenger && state.passenger.lineTimeLeft > 0) || (!!state.buho && state.buho.lineTimeLeft > 0) || (!!state.garage && state.garage.lineTimeLeft > 0);
    HUSTLER_CONTEXT.damaged = !!state.crash && (state.crash.marks > 0 || state.crash.heavy);
    HUSTLER_CONTEXT.pursued = !!state.police && (state.police.phase === 'pursuit' || state.police.phase === 'escaping');
    // `input`, not `cmd`: a hold (the grid, an arrest, a stall) has already taken the key away.
    stepHustlers(h, layout.hustlerSpots, state.vehicle, input, state.economy, HUSTLER_CONTEXT, state.time, dt, state.events);
  }
  // The phrases (`src/sim/flair.ts`). Last of the things that watch the driving, and the most
  // thoroughly a watcher of them all: it reads the drift, the near misses, the collisions and the
  // crash verdict this tick already raised, and writes nothing but its own line. `RUSH` is the only
  // place it celebrates, so the run's phase is what switches that on; a charged crash is said anywhere.
  if (state.flair) {
    const talking = !FLAIR.duringRushOnly || (!!state.rush && state.rush.phase === 'running');
    stepFlair(state.flair, state.drift, talking, state.time, dt, state.events, state.events.length, state.crash ? crashed : null);
  }
}
