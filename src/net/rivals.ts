import type { RivalCar } from '../core/types';
import { lerp, lerpAngle, wrapAngle } from '../core/math';
import { VEHICLE } from '../config/tuning';
import {
  CAR_FLAG,
  EXTRAPOLATE_MS,
  INTERP_DELAY_MS,
  RIVAL_TIMEOUT_MS,
  type WireCar,
  type WireRace,
} from './protocol';

/**
 * Rival cars, reconstructed from the match server's snapshots.
 *
 * Snapshots arrive `SNAPSHOT_HZ` times a second, out of order and late. Drawing the newest
 * one as it lands would make rivals jitter and teleport, so each car is instead drawn
 * `INTERP_DELAY_MS` in the PAST, between the two samples that bracket that moment. There are
 * then almost always two real samples to blend, and the cost is a fixed, small amount of
 * apparent lag rather than an unpredictable amount of jitter.
 *
 * When the buffer runs dry — a dropped packet, a stalled sender — the car is extrapolated
 * along its last known velocity for up to `EXTRAPOLATE_MS` and then left where it is, rather
 * than freezing mid-corner or sliding off forever. After `RIVAL_TIMEOUT_MS` of silence it
 * stops being `present` at all, which takes it out of the scene, the minimap and collision.
 *
 * Performance contract: the `RivalCar` objects are allocated once per player and mutated in
 * place, and the sample ring is fixed-size, so nothing here allocates per frame.
 */

/** Samples kept per rival. At 20 Hz this is a second of history — far more than needed. */
const BUFFER = 20;

interface Sample {
  /** Server-clock ms this sample describes. */
  t: number;
  car: WireCar;
}

interface Track {
  rival: RivalCar;
  samples: Sample[];
  /** Ring write cursor. */
  head: number;
  count: number;
  /** Server time of the newest sample, for the timeout. */
  newest: number;
}

export interface RivalSet {
  /** Live rivals, one per remote player in the match, in grid-slot order. */
  readonly all: RivalCar[];
  /** Take one player's snapshot row. A sample stamped no newer than the last one is dropped. */
  apply(id: string, serverTime: number, car: WireCar, race: WireRace | null): void;
  /**
   * Place every rival where it was at `serverNow - INTERP_DELAY_MS`. Cheap enough to call
   * both per simulation tick (so collision sees the current instant) and per rendered frame
   * (so a rival moves every frame on a display faster than the simulation, instead of
   * stepping four times a second less often than everything around it).
   */
  interpolate(serverNow: number): void;
  /** Integrate wheel spin by `dt`. Once per rendered frame. */
  spin(dt: number): void;
  /** `interpolate` then `spin`, for callers with one clock. */
  update(serverNow: number, dt: number): void;
  /** Look one up by player id. */
  get(id: string): RivalCar | undefined;
}

function emptyRival(id: string, name: string, slot: number): RivalCar {
  return {
    id,
    name,
    slot,
    present: false,
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

/** Copy the flags and the standing, which are taken from a sample rather than blended. */
function applyDiscrete(rival: RivalCar, car: WireCar): void {
  rival.steerAngle = car.sa;
  rival.latAccel = car.la;
  rival.longAccel = car.ga;
  rival.drifting = (car.f & CAR_FLAG.drifting) !== 0;
  rival.nitro = (car.f & CAR_FLAG.nitro) !== 0;
  rival.braking = (car.f & CAR_FLAG.braking) !== 0;
  rival.reversing = (car.f & CAR_FLAG.reversing) !== 0;
  rival.charge = car.ch;
}

export function createRivalSet(players: Array<{ id: string; name: string; slot: number }>): RivalSet {
  const tracks = new Map<string, Track>();
  const all: RivalCar[] = [];

  for (const p of [...players].sort((a, b) => a.slot - b.slot)) {
    const samples: Sample[] = [];
    for (let i = 0; i < BUFFER; i++) samples.push({ t: -1, car: { x: 0, z: 0, h: 0, vx: 0, vz: 0, sp: 0, sa: 0, la: 0, ga: 0, f: 0, ch: 0 } });
    const track: Track = { rival: emptyRival(p.id, p.name, p.slot), samples, head: 0, count: 0, newest: -1 };
    tracks.set(p.id, track);
    all.push(track.rival);
  }

  /** Newest sample at or before `t`, and the oldest one after it. */
  function bracket(track: Track, t: number): { before: Sample | null; after: Sample | null } {
    let before: Sample | null = null;
    let after: Sample | null = null;
    for (let i = 0; i < track.samples.length; i++) {
      const s = track.samples[i];
      if (s.t < 0) continue;
      if (s.t <= t) {
        if (!before || s.t > before.t) before = s;
      } else if (!after || s.t < after.t) after = s;
    }
    return { before, after };
  }

  return {
    all,

    apply(id, serverTime, car, race) {
      const track = tracks.get(id);
      if (!track) return;
      // The server fans out on its own timer, so one client sample can appear in two
      // snapshots. Its arrival stamp is the same both times; the second copy adds nothing.
      if (serverTime <= track.newest) return;
      const slot = track.samples[track.head];
      slot.t = serverTime;
      const c = slot.car;
      c.x = car.x;
      c.z = car.z;
      c.h = car.h;
      c.vx = car.vx;
      c.vz = car.vz;
      c.sp = car.sp;
      c.sa = car.sa;
      c.la = car.la;
      c.ga = car.ga;
      c.f = car.f;
      c.ch = car.ch;
      track.head = (track.head + 1) % track.samples.length;
      if (track.count < track.samples.length) track.count++;
      if (serverTime > track.newest) track.newest = serverTime;

      if (race) {
        const r = track.rival;
        r.lap = race.lap;
        r.progress = race.prog;
        r.lapTime = race.lapT;
        r.bestLap = race.best;
        r.finishTime = race.fin;
        r.money = race.money;
      }
    },

    interpolate(serverNow) {
      const renderTime = serverNow - INTERP_DELAY_MS;
      for (const track of tracks.values()) {
        const rival = track.rival;
        if (track.count === 0 || serverNow - track.newest > RIVAL_TIMEOUT_MS) {
          rival.present = false;
          continue;
        }
        rival.present = true;

        const { before, after } = bracket(track, renderTime);
        if (before && after && after.t > before.t) {
          // The normal case: blend the two samples that straddle the render time.
          const alpha = (renderTime - before.t) / (after.t - before.t);
          rival.x = lerp(before.car.x, after.car.x, alpha);
          rival.z = lerp(before.car.z, after.car.z, alpha);
          rival.heading = lerpAngle(before.car.h, after.car.h, alpha);
          rival.vx = lerp(before.car.vx, after.car.vx, alpha);
          rival.vz = lerp(before.car.vz, after.car.vz, alpha);
          rival.speed = lerp(before.car.sp, after.car.sp, alpha);
          applyDiscrete(rival, alpha < 0.5 ? before.car : after.car);
        } else if (before) {
          // Nothing newer has arrived: carry on along the last velocity, briefly.
          const ahead = Math.min(renderTime - before.t, EXTRAPOLATE_MS) / 1000;
          rival.x = before.car.x + before.car.vx * ahead;
          rival.z = before.car.z + before.car.vz * ahead;
          rival.heading = before.car.h;
          rival.vx = before.car.vx;
          rival.vz = before.car.vz;
          rival.speed = before.car.sp;
          applyDiscrete(rival, before.car);
        } else if (after) {
          // Only future samples: this car has just appeared. Show it where it is.
          rival.x = after.car.x;
          rival.z = after.car.z;
          rival.heading = after.car.h;
          rival.vx = after.car.vx;
          rival.vz = after.car.vz;
          rival.speed = after.car.sp;
          applyDiscrete(rival, after.car);
        }
      }
    },

    spin(dt) {
      // Wheel spin is never sent: rolling it from the speed we already have looks the same.
      for (const track of tracks.values()) {
        const rival = track.rival;
        if (!rival.present) continue;
        rival.wheelSpin = wrapAngle(rival.wheelSpin + (rival.speed / VEHICLE.wheelRadius) * dt);
      }
    },

    update(serverNow, dt) {
      this.interpolate(serverNow);
      this.spin(dt);
    },

    get(id) {
      return tracks.get(id)?.rival;
    },
  };
}
