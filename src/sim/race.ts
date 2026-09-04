import type { GameEvent, RaceCourse, RaceState, VehicleState } from '../core/types';
import { RACE } from '../config/tuning';
import { createProjection, projectOntoPath } from '../world/track';

/**
 * Race rules. Pure data in, pure data out.
 *
 * A race is `laps` laps through every gate in order: gates[0] is the start/finish line, the
 * others are checkpoints, and the car has to cross them in lap order for the lap to count.
 * Checkpoints are what make the hidden shortcuts legal and everything else illegal: an alley
 * never skips a gate, but cutting across the infield does.
 *
 * Crossing is detected from the car's motion over the tick (previous pose -> current pose)
 * against the gate segment, with the direction taken from the gate's forward vector. A gate
 * crossed backwards has to be crossed forwards again; the line crossed backwards right after
 * completing a lap takes that lap back, so reversing over the line cannot mint laps.
 *
 * The countdown is part of the rules, not of the presentation: while `phase` is 'countdown'
 * the orchestrator holds the car on the brakes, so every client in a future multiplayer race
 * launches on the same tick.
 */

export function createRaceState(course: RaceCourse): RaceState {
  const lapTimes: number[] = [];
  for (let i = 0; i < course.laps; i++) lapTimes.push(-1);
  return {
    phase: 'countdown',
    countdown: RACE.countdownSeconds,
    lap: 1,
    laps: course.laps,
    nextGate: 1 % course.gates.length,
    goTime: -1,
    lapStart: 0,
    prevLapStart: 0,
    elapsed: 0,
    lapTimes,
    bestLap: -1,
    lastLap: -1,
    finishTime: -1,
    station: 0,
    progress: 0,
    wrongWay: false,
    wrongWayTime: 0,
    shortcut: -1,
  };
}

export function resetRaceState(race: RaceState, course: RaceCourse): void {
  race.phase = 'countdown';
  race.countdown = RACE.countdownSeconds;
  race.lap = 1;
  race.laps = course.laps;
  race.nextGate = 1 % course.gates.length;
  race.goTime = -1;
  race.lapStart = 0;
  race.prevLapStart = 0;
  race.elapsed = 0;
  for (let i = 0; i < race.lapTimes.length; i++) race.lapTimes[i] = -1;
  race.bestLap = -1;
  race.lastLap = -1;
  race.finishTime = -1;
  race.station = 0;
  race.progress = 0;
  race.wrongWay = false;
  race.wrongWayTime = 0;
  race.shortcut = -1;
}

/**
 * Signed crossing of the gate by the motion segment p0 -> p1: +1 forward, -1 backward, 0 none.
 * Standard segment intersection; the gate is treated as closed at both ends.
 */
export function gateCrossing(
  p0x: number,
  p0z: number,
  p1x: number,
  p1z: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  fx: number,
  fz: number,
): number {
  const dx = p1x - p0x;
  const dz = p1z - p0z;
  if (dx === 0 && dz === 0) return 0;
  const ex = bx - ax;
  const ez = bz - az;
  const denom = dx * ez - dz * ex;
  if (Math.abs(denom) < 1e-12) return 0;
  const wx = ax - p0x;
  const wz = az - p0z;
  const t = (wx * ez - wz * ex) / denom;
  const u = (wx * dz - wz * dx) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return 0;
  const dir = dx * fx + dz * fz;
  return dir > 0 ? 1 : dir < 0 ? -1 : 0;
}

const proj = createProjection();

function recomputeLapStats(race: RaceState): void {
  let best = -1;
  let last = -1;
  for (let i = 0; i < race.lapTimes.length; i++) {
    const t = race.lapTimes[i];
    if (t < 0) continue;
    last = t;
    if (best < 0 || t < best) best = t;
  }
  race.bestLap = best;
  race.lastLap = last;
}

export function stepRace(race: RaceState, course: RaceCourse, v: VehicleState, time: number, dt: number, events: GameEvent[]): void {
  /* ------------------------------------------------------------ countdown */
  if (race.phase === 'countdown') {
    const before = Math.ceil(race.countdown);
    race.countdown -= dt;
    const after = Math.ceil(race.countdown);
    if (race.countdown <= 0) {
      race.phase = 'racing';
      race.countdown = 0;
      race.goTime = time;
      race.lapStart = time;
      race.prevLapStart = time;
      events.push({ type: 'raceStart' });
    } else if (after !== before && after > 0) {
      events.push({ type: 'raceCountdown', seconds: after });
    } else if (before === Math.ceil(RACE.countdownSeconds) && race.countdown < RACE.countdownSeconds && race.countdown > RACE.countdownSeconds - dt * 1.5) {
      // The first number shows on the first tick of the countdown.
      events.push({ type: 'raceCountdown', seconds: before });
    }
  }

  if (race.phase === 'racing') race.elapsed = time - race.goTime;

  /* ------------------------------------------------------------ position on the lap */
  const path = course.path;
  const L = path.length;
  // Shortcuts first: inside one, progress is interpolated between its two main-lap stations.
  let onShortcut = -1;
  let tx = 0;
  let tz = 0;
  for (let i = 0; i < course.shortcuts.length; i++) {
    const sc = course.shortcuts[i];
    projectOntoPath(sc.path, v.x, v.z, proj);
    if (proj.dist <= proj.halfWidth + RACE.shortcutPad) {
      onShortcut = i;
      const f = sc.path.length > 0 ? proj.s / sc.path.length : 0;
      let span = sc.sOut - sc.sIn;
      if (span < 0) span += L;
      race.station = (sc.sIn + span * f) % L;
      tx = proj.tx;
      tz = proj.tz;
      break;
    }
  }
  if (onShortcut < 0) {
    projectOntoPath(path, v.x, v.z, proj);
    race.station = proj.s;
    tx = proj.tx;
    tz = proj.tz;
  }
  race.shortcut = onShortcut;
  const line = course.gates[0].s;
  let frac = (race.station - line) / L;
  frac -= Math.floor(frac);
  // Just before the line the fraction reads ~1 while the lap has not ticked over yet, and the
  // moment after it reads ~0 with the lap incremented; both map to the same progress.
  race.progress = race.phase === 'finished' ? race.laps : race.lap - 1 + frac;

  /* ------------------------------------------------------------ wrong way */
  if (race.phase === 'racing') {
    const speed = Math.sqrt(v.vx * v.vx + v.vz * v.vz);
    const along = speed > 1e-6 ? (v.vx * tx + v.vz * tz) / speed : 1;
    if (speed > RACE.wrongWayMinSpeed && along < -0.3) {
      race.wrongWayTime += dt;
      if (!race.wrongWay && race.wrongWayTime >= RACE.wrongWayDelay) {
        race.wrongWay = true;
        events.push({ type: 'wrongWay', on: true });
      }
    } else if (along > 0.3 || speed <= RACE.wrongWayMinSpeed) {
      race.wrongWayTime = 0;
      if (race.wrongWay) {
        race.wrongWay = false;
        events.push({ type: 'wrongWay', on: false });
      }
    }
  } else if (race.wrongWay) {
    race.wrongWay = false;
    race.wrongWayTime = 0;
    events.push({ type: 'wrongWay', on: false });
  }

  /* ------------------------------------------------------------ gates */
  if (race.phase !== 'racing') return;
  const gates = course.gates;
  const N = gates.length;
  for (let k = 0; k < N; k++) {
    const g = gates[k];
    const cross = gateCrossing(v.prevX, v.prevZ, v.x, v.z, g.ax, g.az, g.bx, g.bz, g.fx, g.fz);
    if (cross === 0) continue;
    if (cross > 0) {
      if (k !== race.nextGate) continue;
      if (k === 0) {
        // Lap complete.
        const lapTime = time - race.lapStart;
        race.lapTimes[race.lap - 1] = lapTime;
        const best = race.bestLap < 0 || lapTime < race.bestLap;
        recomputeLapStats(race);
        race.prevLapStart = race.lapStart;
        race.lapStart = time;
        if (race.lap >= race.laps) {
          race.phase = 'finished';
          race.finishTime = time - race.goTime;
          race.elapsed = race.finishTime;
          race.progress = race.laps;
          events.push({ type: 'lapComplete', lap: race.lap, time: lapTime, best });
          events.push({ type: 'raceFinish', total: race.finishTime, bestLap: race.bestLap });
          return;
        }
        events.push({ type: 'lapComplete', lap: race.lap, time: lapTime, best });
        race.lap++;
      } else {
        events.push({ type: 'checkpoint', index: k, split: time - race.lapStart });
      }
      race.nextGate = (k + 1) % N;
    } else {
      // Backwards over the gate just passed: it has to be passed again.
      const justPassed = (race.nextGate - 1 + N) % N;
      if (k !== justPassed) continue;
      if (k === 0) {
        if (race.lap <= 1) continue; // nothing to take back at the start of the race
        race.lap--;
        race.lapTimes[race.lap - 1] = -1;
        recomputeLapStats(race);
        race.lapStart = race.prevLapStart;
      }
      race.nextGate = k;
    }
  }
}
