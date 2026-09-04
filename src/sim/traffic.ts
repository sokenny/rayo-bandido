import type { TargetState } from '../core/types';
import { wrapAngle } from '../core/math';
import { TARGETS } from '../config/tuning';

/**
 * Numbers per electric car in a traffic report, in target-id order: x, z, heading, status
 * (0 active, 1 not), patrol waypoint index, knock velocity x, knock velocity z. Flat because
 * twelve cars ten times a second is the second-heaviest message on the wire and an array of
 * objects triples its size. `src/net/protocol.ts` re-exports this as part of the contract.
 */
export const TRAFFIC_STRIDE = 7;

/**
 * Keeping the electric cars the same on every screen.
 *
 * The traffic is deterministic — same spawns, same patrol loops, same fixed timestep — so
 * four clients that never touched it would draw it identically. What breaks that is play:
 * a car shoved aside by one player, or destroyed by one player's lightning, is only shoved
 * or destroyed on that player's machine. The field would then quietly stop agreeing about
 * where the obstacles are, which in a race is unfair rather than merely untidy.
 *
 * So one client — the host — is authoritative for the traffic and publishes it ten times a
 * second, and this module folds those reports into the local copy. Every client still runs
 * `stepTargets` normally: the cars keep moving smoothly at 60 Hz between reports, and what
 * arrives is treated as a CORRECTION to fold in over ~150 ms rather than a position to snap
 * to. A snap is kept in reserve for errors too large to hide (a destroyed car respawning, a
 * client that was in a background tab), where sliding would look worse than cutting.
 *
 * THE COMPARISON IS MADE IN THE PAST. A report describes the host's cars as they were when
 * it was sent, and it arrives some tens of milliseconds later. Comparing it with the local
 * copy NOW would find every car "behind" by however far it travels in that time, and drag
 * it back by that much ten times a second — a permanent sawtooth that grows with latency.
 * Instead the local copy is remembered for the last half second (`record`) and the report
 * is compared with the local copy AT THE TIME IT DESCRIBES. Two deterministic simulations
 * that agree then measure no error at all, whatever the latency.
 *
 * WHAT KEEPS THEM DETERMINISTIC. Position and heading are not enough: a copy dragged to the
 * host's position but still steering for its own stale waypoint would fight the corrections
 * for the car's heading, so the report also carries the patrol index and the knock velocity,
 * and destroyed cars come back only on the host's say-so (`respawnTraffic` in `stepGame`).
 *
 * WHAT THIS CLIENT DID ITSELF. A kill or a shove made here is real here at once — nobody
 * waits for the host to fire lightning — and reported to the host, who does the same thing a
 * round trip later. Until that shows up in a report, the report still says the car is fine,
 * and following it would undo the kill (a car that flickers back to life) or the shove (a
 * car that slides back onto your bonnet). So each is held for a while: reports for that car
 * are ignored until the host has had time to agree, or the hold runs out and the host wins.
 *
 * Statuses are not blended: a car is destroyed or it is not, and the host decides.
 *
 * Performance contract: the history and error arrays are allocated once, and nothing here
 * allocates per tick or per message.
 */

/** Position error above which the car is moved outright instead of eased across (m). */
const SNAP_DISTANCE = 8;
/** Heading error above which the car is turned outright (rad). About 60 degrees. */
const SNAP_ANGLE = 1;
/** How fast a correction is absorbed (1/s). ~0.15 s to take out most of an error. */
const CORRECTION_RATE = 14;
/** Ticks of local history kept for the comparison. Half a second at 60 Hz. */
const HISTORY = 32;
/** A report older than the history, or from the future, is compared with the present. */
const HISTORY_SLACK_MS = 40;

/** Kind of hold on a car, see `claimKill` / `claimBump`. */
const HOLD_NONE = 0;
const HOLD_KILL = 1;
const HOLD_BUMP = 2;

export interface TrafficSync {
  /**
   * Remember the local copy as it stands at `serverNow` (server-clock ms), so a later report
   * can be compared with it. Call once per tick, after `stepTargets` and `correct`.
   */
  record(targets: readonly TargetState[], serverNow: number): void;
  /**
   * Fold in one authoritative report: flat, `TRAFFIC_STRIDE` numbers per car, describing the
   * host's cars at server time `at`. Ids of cars this report killed are pushed into
   * `destroyed`, so the caller can play the explosion — a car another player shot must not
   * simply go dark.
   */
  apply(targets: TargetState[], data: readonly number[], at: number, time: number, destroyed: number[]): void;
  /** Bleed the outstanding corrections into the cars. Call once per tick after `stepTargets`. */
  correct(targets: TargetState[], dt: number): void;
  /**
   * Mark one car destroyed, as the host does when another player claims a kill. Returns
   * false when the claim changed nothing (already dead, or no such car).
   */
  destroy(targets: TargetState[], id: number, time: number): boolean;
  /**
   * Shove one car, as the host does when another player reports a bump. `lagSeconds` is how
   * long ago it happened; the car is moved on by that much so the two copies land together.
   * Returns false when there was nothing to shove.
   */
  bump(targets: TargetState[], id: number, kx: number, kz: number, lagSeconds: number): boolean;
  /**
   * This client destroyed a car itself. Reports saying it is alive are ignored for
   * `holdSeconds` (of sim time), long enough for the host to have agreed.
   */
  claimKill(id: number, time: number, holdSeconds: number): void;
  /**
   * This client shoved a car itself. Corrections to that car are ignored for `holdSeconds`,
   * long enough for the host's copy of the shove to show up in its reports.
   */
  claimBump(id: number, time: number, holdSeconds: number): void;
}

export function createTrafficSync(count: number): TrafficSync {
  const errorX = new Float64Array(count);
  const errorZ = new Float64Array(count);
  const errorHeading = new Float64Array(count);

  const holdKind = new Uint8Array(count);
  const holdUntil = new Float64Array(count);

  // Ring of the local copy's recent past, one stamp per tick shared by every car.
  const histT = new Float64Array(HISTORY).fill(-1);
  const histX = new Float64Array(HISTORY * count);
  const histZ = new Float64Array(HISTORY * count);
  const histH = new Float64Array(HISTORY * count);
  let histHead = 0;
  let histCount = 0;

  /** Index into the ring of the tick nearest `at`, or -1 when the ring does not cover it. */
  function nearestTick(at: number): number {
    let best = -1;
    let bestGap = Infinity;
    for (let i = 0; i < histCount; i++) {
      const gap = Math.abs(histT[i] - at);
      if (gap < bestGap) {
        bestGap = gap;
        best = i;
      }
    }
    return bestGap <= HISTORY_SLACK_MS ? best : -1;
  }

  function releaseHold(i: number): void {
    holdKind[i] = HOLD_NONE;
    holdUntil[i] = 0;
  }

  function clearError(i: number): void {
    errorX[i] = 0;
    errorZ[i] = 0;
    errorHeading[i] = 0;
  }

  function place(t: TargetState, x: number, z: number, heading: number): void {
    t.x = t.prevX = x;
    t.z = t.prevZ = z;
    t.heading = t.prevHeading = heading;
  }

  return {
    record(targets, serverNow) {
      histT[histHead] = serverNow;
      const base = histHead * count;
      const n = Math.min(targets.length, count);
      for (let i = 0; i < n; i++) {
        const t = targets[i];
        histX[base + i] = t.x;
        histZ[base + i] = t.z;
        histH[base + i] = t.heading;
      }
      histHead = (histHead + 1) % HISTORY;
      if (histCount < HISTORY) histCount++;
    },

    apply(targets, data, at, time, destroyed) {
      const n = Math.min(targets.length, count, Math.floor(data.length / TRAFFIC_STRIDE));
      const tick = nearestTick(at);
      const base = tick >= 0 ? tick * count : -1;

      for (let i = 0; i < n; i++) {
        const t = targets[i];
        const o = i * TRAFFIC_STRIDE;
        const x = data[o];
        const z = data[o + 1];
        const heading = data[o + 2];
        const isDestroyed = data[o + 3] === 1;
        const patrolIndex = data[o + 4];
        const vx = data[o + 5];
        const vz = data[o + 6];

        // A hold that has run its course: the host wins from here.
        if (holdKind[i] !== HOLD_NONE && time >= holdUntil[i]) releaseHold(i);

        // Status is the host's to decide, and it moves the car with it: a respawn is a
        // teleport, and a kill has to land now or the explosion plays over an empty road.
        if (isDestroyed) {
          // The host agrees with a kill made here; nothing more to wait for.
          if (holdKind[i] === HOLD_KILL) releaseHold(i);
          if (t.status === 'active') {
            t.status = 'destroyed';
            t.hitTime = time;
            // Someone else's kill: the caller owes it an explosion.
            t.rewarded = true;
            destroyed.push(i);
          }
          clearError(i);
          continue;
        }
        if (t.status !== 'active') {
          // Killed here, and the host has not caught up yet: keep it dead a little longer.
          if (holdKind[i] === HOLD_KILL) continue;
          t.status = 'active';
          t.hitTime = -1;
          t.rewarded = false;
          t.vx = vx;
          t.vz = vz;
          t.patrolIndex = patrolIndex;
          place(t, x, z, heading);
          clearError(i);
          continue;
        }

        // Shoved here, and the host has not caught up yet: the local shove plays out first.
        if (holdKind[i] === HOLD_BUMP) continue;

        // The patrol has to be the same one, or the two copies steer for different corners.
        // The local copy may legitimately be ONE waypoint ahead of a report from the past.
        if (t.patrolIndex !== patrolIndex && t.patrolIndex !== patrolIndex + 1) t.patrolIndex = patrolIndex;
        t.vx = vx;
        t.vz = vz;

        // Measure the error against where THIS copy was when the report was taken.
        let lx = t.x;
        let lz = t.z;
        let lh = t.heading;
        if (base >= 0) {
          lx = histX[base + i];
          lz = histZ[base + i];
          lh = histH[base + i];
        }
        const dx = x - lx;
        const dz = z - lz;
        const dh = wrapAngle(heading - lh);
        if (dx * dx + dz * dz > SNAP_DISTANCE * SNAP_DISTANCE || Math.abs(dh) > SNAP_ANGLE) {
          // Too far gone to slide: put it where the host has it, moved on by the same
          // amount this copy has moved since the report was taken.
          place(t, x + (t.x - lx), z + (t.z - lz), wrapAngle(heading + wrapAngle(t.heading - lh)));
          clearError(i);
          continue;
        }
        errorX[i] = dx;
        errorZ[i] = dz;
        errorHeading[i] = dh;
      }
    },

    correct(targets, dt) {
      // Exponential: take the same fraction of whatever is left every tick, so a correction
      // arrives fast and then tapers instead of ending with a visible stop.
      const take = 1 - Math.exp(-CORRECTION_RATE * dt);
      const n = Math.min(targets.length, count);
      for (let i = 0; i < n; i++) {
        const ex = errorX[i];
        const ez = errorZ[i];
        const eh = errorHeading[i];
        if (ex === 0 && ez === 0 && eh === 0) continue;
        const dx = ex * take;
        const dz = ez * take;
        const dh = eh * take;
        const t = targets[i];
        t.x += dx;
        t.z += dz;
        t.heading = wrapAngle(t.heading + dh);
        errorX[i] = ex - dx;
        errorZ[i] = ez - dz;
        errorHeading[i] = eh - dh;
        // Below a millimetre and a thousandth of a degree it is finished; stop the arithmetic.
        if (Math.abs(errorX[i]) < 1e-3) errorX[i] = 0;
        if (Math.abs(errorZ[i]) < 1e-3) errorZ[i] = 0;
        if (Math.abs(errorHeading[i]) < 1e-4) errorHeading[i] = 0;
      }
    },

    destroy(targets, id, time) {
      const t = targets[id];
      if (!t || t.status !== 'active') return false;
      t.status = 'destroyed';
      t.hitTime = time;
      // The reward belongs to whoever fired, and they have already paid themselves.
      t.rewarded = true;
      return true;
    },

    bump(targets, id, kx, kz, lagSeconds) {
      const t = targets[id];
      if (!t || t.status !== 'active') return false;
      const lag = Math.max(0, Math.min(0.5, lagSeconds));
      // The shove has already been acting for `lag` on the other screen: catch up. The knock
      // decays the way `stepTargets` decays it, so the two copies meet rather than cross.
      const decay = Math.max(0, 1 - TARGETS.knock.damping * lag);
      t.x += kx * lag;
      t.z += kz * lag;
      t.vx += kx * decay;
      t.vz += kz * decay;
      return true;
    },

    claimKill(id, time, holdSeconds) {
      if (id < 0 || id >= count) return;
      holdKind[id] = HOLD_KILL;
      holdUntil[id] = time + holdSeconds;
      clearError(id);
    },

    claimBump(id, time, holdSeconds) {
      if (id < 0 || id >= count) return;
      // A kill outranks a shove: the car is gone whatever else happened to it.
      if (holdKind[id] === HOLD_KILL) return;
      holdKind[id] = HOLD_BUMP;
      holdUntil[id] = time + holdSeconds;
      clearError(id);
    },
  };
}
