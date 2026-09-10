import type {
  ArenaLayout,
  GameEvent,
  GameState,
  PlayerCommand,
  RaceCourse,
  RaceState,
  RivalCar,
  StreetRaceResults,
  VehicleState,
} from '../core/types';
import { STREET_RACE, VEHICLE } from '../config/tuning';
import { lerp, lerpAngle, wrapAngle } from '../core/math';
import { createPlayerCommand } from '../core/input/keyboard';
import { createVehicleState } from './gameState';
import { stepVehicle } from './vehicle';
import { resolveCollisions, resolveTargetCollisions } from './collision';
import { resolveRivalCollisions } from './rivalCollision';
import { settleVehicle } from './surface';
import { createRaceState, resetRaceState, stepRace } from './race';
import { createRivalAiState, resetRivalAiState, stepRivalAi, type RivalAiState } from './rivalAi';
import { clampStreetCleared, streetEventCount } from './streetGate';

/**
 * STREET RACE: the PvE race against AI rivals, and the series it belongs to.
 *
 * WHAT IT IS. The race that already exists (`src/sim/race.ts`), driven on the Quay Circuit
 * (`src/world/streetWorld.ts`) by the player AND one to three rivals. Each rival is a real
 * `VehicleState` driven by the shared controller (`src/sim/rivalAi.ts`) through the same vehicle
 * model, wall pass and traffic pass the player's car goes through, with its own `RaceState` so
 * the race rules count its laps and its finish exactly as they count the player's.
 *
 * HOW THE REST OF THE GAME SEES THEM. Each rival is mirrored into a `RivalCar` — the plain record
 * a multiplayer opponent already is — so the rival visuals, the name tags, the minimap, the
 * standings and the player's collision pass work on them unchanged. Nothing in the renderer
 * knows a rival is local.
 *
 * WHERE IT SITS IN A TICK. After `stepGame`: the player's car and race have moved for this tick,
 * so a rival that collides with the player collides with where the player IS, and the flag is
 * judged against the finish `stepRace` decided on this very tick.
 *
 * THE SERIES. `cleared` is the whole progression, as it is for the other chains: it moves forward
 * by exactly one, when the player WINS the event that was still outstanding. Losing changes
 * nothing; replaying a won event changes nothing. The reward is paid once, with the promotion.
 *
 * MULTIPLAYER. A Street Race is driven alone — the world is loaded with no session, the way the
 * solo circuit is — so the rivals, the results and the progress belong to this browser only.
 *
 * RAYO. Rivals are not `TargetState`s, so the Rayo cannot lock onto them (the same rule as
 * multiplayer rivals, decided by Juan). The integration point, if that ever changes, is a
 * `TargetState`-shaped view of `StreetRival.v` fed to `stepLightning`; a hit would then need
 * `placeOnLine`-style recovery here. Not built.
 */

export interface StreetRival {
  v: VehicleState;
  race: RaceState;
  ai: RivalAiState;
  /** The public face: what the renderer, the map, the standings and the player's collision read. */
  car: RivalCar;
  cmd: PlayerCommand;
}

export interface StreetRaceState {
  /** The event being driven, 0-based, and the series' progress on entry. */
  event: number;
  cleared: number;
  rivals: StreetRival[];
  /** `rivals[i].car`, as one array the caller can hand to anything that wants `RivalCar[]`. */
  cars: RivalCar[];
  /** The player's own car, mirrored, so the rivals can collide with it. */
  playerCar: RivalCar;
  /** Which race phase this module has already reacted to (`src/sim/timeAttack.ts` pattern). */
  phase: RaceState['phase'];
  /** The shortcut the player was in last tick, to raise the enter/leave event once. */
  playerShortcut: number;
  results: StreetRaceResults | null;
}

/** The scratch event list every rival's collision passes write into and nobody reads. */
const SCRATCH: GameEvent[] = [];
/** Rivals other than the one being stepped, plus the player: the field it can hit. */
const OTHERS: RivalCar[] = [];

function makeCar(id: string, name: string, slot: number): RivalCar {
  return {
    id,
    name,
    slot,
    present: true,
    x: 0,
    z: 0,
    heading: 0,
    vx: 0,
    vz: 0,
    speed: 0,
    steerAngle: 0,
    wheelSpin: 0,
    latAccel: 0,
    longAccel: 0,
    drifting: false,
    nitro: false,
    braking: false,
    reversing: false,
    charge: 0,
    lap: 1,
    progress: 0,
    lapTime: 0,
    bestLap: -1,
    finishTime: -1,
    money: 0,
  };
}

/** The event's configuration, clamped into the series. */
export function streetEvent(event: number): (typeof STREET_RACE.events)[number] {
  const i = Math.max(0, Math.min(STREET_RACE.events.length - 1, Math.floor(event) || 0));
  return STREET_RACE.events[i];
}

/** The AI tier an event drives its rivals with. */
export function streetTierFor(event: number): (typeof STREET_RACE.ai)[keyof typeof STREET_RACE.ai] {
  return STREET_RACE.ai[streetEvent(event).ai];
}

/**
 * Build the field for `event` on `course`. `cleared` is how many events are won, read back from
 * storage by the caller; the event is clamped to the ones that are open, so a URL cannot ask
 * for a race the player has not unlocked.
 */
export function createStreetRaceState(course: RaceCourse, event: number, cleared = 0): StreetRaceState {
  const safeCleared = clampStreetCleared(cleared);
  const safeEvent = Math.max(0, Math.min(Math.floor(event) || 0, safeCleared, streetEventCount() - 1));
  const spec = streetEvent(safeEvent);
  const tier = STREET_RACE.ai[spec.ai];
  const count = Math.max(1, Math.min(spec.rivals, course.grid.length - 1));
  const rivals: StreetRival[] = [];
  const cars: RivalCar[] = [];
  for (let i = 0; i < count; i++) {
    const slot = i + 1;
    const g = course.grid[slot];
    const name = spec.rivalNames[i] ?? `RIVAL ${i + 1}`;
    const rival: StreetRival = {
      v: createVehicleState(g.x, g.z, g.heading, g.y ?? 0),
      race: createRaceState(course),
      ai: createRivalAiState(tier, 7919 * (safeEvent + 1) + 104729 * (i + 1)),
      car: makeCar(`ai-${i}`, name, slot),
      cmd: createPlayerCommand(),
    };
    mirror(rival);
    rivals.push(rival);
    cars.push(rival.car);
  }
  return {
    event: safeEvent,
    cleared: safeCleared,
    rivals,
    cars,
    playerCar: makeCar('you', 'YOU', 0),
    phase: 'countdown',
    playerShortcut: -1,
    results: null,
  };
}

/** Back on the grid, nothing counted. A restart, alongside the game's own reset. */
export function resetStreetRace(sr: StreetRaceState, course: RaceCourse): void {
  for (let i = 0; i < sr.rivals.length; i++) {
    const r = sr.rivals[i];
    const g = course.grid[r.car.slot];
    r.v = createVehicleState(g.x, g.z, g.heading, g.y ?? 0);
    resetRaceState(r.race, course);
    resetRivalAiState(r.ai);
    mirror(r);
  }
  sr.phase = 'countdown';
  sr.playerShortcut = -1;
  sr.results = null;
}

/** Write the car's tick pose onto its public record. */
function mirror(r: StreetRival): void {
  const v = r.v;
  const c = r.car;
  c.x = v.x;
  c.z = v.z;
  c.heading = v.heading;
  c.vx = v.vx;
  c.vz = v.vz;
  c.speed = v.speed;
  c.steerAngle = v.steerAngle;
  c.latAccel = v.latAccel;
  c.longAccel = v.longAccel;
  c.braking = v.brakeApplied > 0 && v.speed > 0.5;
  c.reversing = v.speed < -0.5;
  c.lap = r.race.lap;
  c.progress = rankingProgress(r.race);
  c.lapTime = 0;
  c.bestLap = r.race.bestLap;
  c.finishTime = r.race.finishTime;
}

/** The player's car onto its mirror; only what the rival collision pass reads. */
function mirrorPlayer(sr: StreetRaceState, v: VehicleState): void {
  const c = sr.playerCar;
  c.x = v.x;
  c.z = v.z;
  c.heading = v.heading;
  c.vx = v.vx;
  c.vz = v.vz;
  c.speed = v.speed;
}

/**
 * Put every rival's public record back on its TICK pose. Called before `stepGame`, because the
 * renderer blends the records between ticks (`interpolateStreetRivals`) and the player's
 * collision pass must see where the rivals are, not where they were drawn.
 */
export function snapStreetRivals(sr: StreetRaceState): void {
  for (let i = 0; i < sr.rivals.length; i++) mirror(sr.rivals[i]);
}

/**
 * Blend the public records between the previous and the current tick pose for drawing. The
 * wheel spin is rolled from the speed, as the network rivals' is.
 */
export function interpolateStreetRivals(sr: StreetRaceState, alpha: number, frameDt: number): void {
  for (let i = 0; i < sr.rivals.length; i++) {
    const r = sr.rivals[i];
    const v = r.v;
    const c = r.car;
    c.x = lerp(v.prevX, v.x, alpha);
    c.z = lerp(v.prevZ, v.z, alpha);
    c.heading = lerpAngle(v.prevHeading, v.heading, alpha);
    c.wheelSpin = wrapAngle(c.wheelSpin + (v.speed / VEHICLE.wheelRadius) * frameDt);
  }
}

/**
 * A car's progress for RANKING. `RaceState.progress` reads ~0.99 for a car still behind the line
 * on lap 1 (the fraction wraps), which would put a car parked on the grid ahead of one that has
 * just crossed it. Before the first gate of the first lap the fraction is taken as negative.
 */
export function rankingProgress(race: RaceState): number {
  const frac = race.progress - Math.floor(race.progress);
  if (race.lap === 1 && race.nextGate === 1 && race.phase !== 'finished' && frac > 0.5) return frac - 1;
  return race.progress;
}

/** Rubber band: the speed scale a rival gets from its gap to the player (metres of lap). */
export function rubberBandScale(rivalProgress: number, playerProgress: number, lapLength: number): number {
  const rb = STREET_RACE.rubberBand;
  if (!rb.enabled || lapLength <= 0 || rb.span <= 0) return 1;
  const behind = (playerProgress - rivalProgress) * lapLength;
  if (behind > 0) return 1 + Math.min(rb.capBehind, (behind / rb.span) * rb.gainBehind);
  return 1 - Math.min(rb.capAhead, (-behind / rb.span) * rb.gainAhead);
}

/**
 * The player's live position: 1 + the rivals ahead. A finished car is ahead of a running one;
 * finished cars rank by time; running cars by progress.
 */
export function streetPosition(sr: StreetRaceState, race: RaceState): number {
  let ahead = 0;
  const mineDone = race.phase === 'finished';
  for (let i = 0; i < sr.rivals.length; i++) {
    const r = sr.rivals[i].race;
    const done = r.phase === 'finished';
    if (done && mineDone) {
      if (r.finishTime < race.finishTime) ahead++;
    } else if (done !== mineDone) {
      if (done) ahead++;
    } else if (rankingProgress(r) > rankingProgress(race)) ahead++;
  }
  return ahead + 1;
}

/**
 * One tick of the field. Called after `stepGame`, with the tick's events — the `raceFinish`
 * this judges is already in there. Pays the reward straight into the economy, the way the
 * fares are paid: on the one event the rules raise exactly once per race.
 */
export function stepStreetRace(sr: StreetRaceState, layout: ArenaLayout, state: GameState, dt: number, events: GameEvent[]): void {
  const course = layout.race;
  const race = state.race;
  if (!course || !race) return;
  const player = state.vehicle;
  mirrorPlayer(sr, player);
  const L = course.path.length;

  for (let i = 0; i < sr.rivals.length; i++) {
    const r = sr.rivals[i];
    const v = r.v;
    // The countdown holds every car on the grid, the player's included (`src/sim/gameState.ts`).
    if (r.race.phase === 'countdown') {
      r.cmd.throttle = 0;
      r.cmd.brake = 0;
      r.cmd.steer = 0;
      r.cmd.handbrake = true;
    } else {
      const dx = player.x - v.x;
      const dz = player.z - v.z;
      const band = rubberBandScale(rankingProgress(r.race), rankingProgress(race), L);
      const teleported = stepRivalAi(r.ai, v, course, r.cmd, dt, band, Math.sqrt(dx * dx + dz * dz));
      if (teleported) {
        // The pose was written directly; `stepVehicle` below still runs so the car settles.
      }
    }
    stepVehicle(v, r.cmd, false, dt, false, false);
    settleVehicle(v, layout);
    SCRATCH.length = 0;
    resolveCollisions(v, layout, SCRATCH, dt);
    // The field this rival can hit: the player, and the other rivals, at their tick poses.
    OTHERS.length = 0;
    OTHERS.push(sr.playerCar);
    for (let j = 0; j < sr.rivals.length; j++) if (j !== i) OTHERS.push(sr.rivals[j].car);
    resolveRivalCollisions(v, OTHERS, SCRATCH);
    resolveTargetCollisions(v, state.targets, SCRATCH);
    stepRace(r.race, course, v, state.time, dt, SCRATCH);
    mirror(r);
  }

  /* ------------------------------------------------------------ the player's shortcut */
  if (race.shortcut !== sr.playerShortcut) {
    sr.playerShortcut = race.shortcut;
    events.push({ type: 'streetRaceShortcut', shortcut: race.shortcut });
  }

  /* ------------------------------------------------------------ the flag */
  const phase = race.phase;
  if (phase === 'countdown' && sr.phase !== 'countdown') sr.results = null;
  if (phase === 'finished' && sr.phase !== 'finished') endRace(sr, race, state, events);
  sr.phase = phase;
}

function endRace(sr: StreetRaceState, race: RaceState, state: GameState, events: GameEvent[]): void {
  const spec = streetEvent(sr.event);
  const placement = streetPosition(sr, race);
  const won = placement === 1;
  const advanced = won && sr.event === sr.cleared;
  let reward = 0;
  let unlockedName: string | null = null;
  if (advanced) {
    sr.cleared = sr.event + 1;
    reward = spec.reward;
    state.economy.money += reward;
    state.economy.lastReward = reward;
    if (sr.cleared < streetEventCount()) unlockedName = STREET_RACE.events[sr.cleared].name;
  }
  const results: StreetRaceResults = {
    event: sr.event,
    eventName: spec.name,
    placement,
    field: sr.rivals.length + 1,
    time: race.finishTime,
    won,
    advanced,
    reward,
    unlockedName,
    allClear: sr.cleared >= streetEventCount(),
  };
  sr.results = results;
  events.push({ type: 'streetRaceEnd', results });
}
