import type { DriftState, GameEvent, LightningState, PlayerCommand, TargetState, VehicleState } from '../core/types';
import { LIGHTNING } from '../config/tuning';
import { forwardX, forwardZ } from '../core/math';
import { rayTarget } from './targeting';

/**
 * Lightning resource, aiming and firing. Charge only ever increases through `drift.chargeRate`.
 *
 * The gun is held, not tapped: pressing fire starts loading, and releasing throws the bolt down
 * the car's heading with a reach proportional to how long it was held — `maxHold` seconds buys
 * the full `range`, half that buys half the range. Holding past `maxHold` simply sits at full
 * reach: the shot only ever leaves on the release, so the player picks the moment. Nothing
 * homes: the bolt flies straight and hits whatever is within `hitRadius` of that line, or
 * nothing at all, in which case `lightningFired` carries `targetId: -1`.
 *
 * THE LOAD IS PAID FOR AS IT IS LOADED. `minCost` is taken at the press — which is where a shot
 * that could never exist is refused — and the rest is drawn steadily across the hold, so a
 * full-reach bolt costs `cost` and a snap shot costs barely more than the down payment. The
 * meter therefore drains while the player is deciding how far to reach, rather than after,
 * which is the only way that trade can be made honestly. Two consequences fall out of it:
 * running the meter dry stops the hold growing (the shot survives, it just reaches as far as
 * was paid for), and a fumble hands every unit back, because nothing left the car.
 */
export function stepLightning(
  l: LightningState,
  v: VehicleState,
  targets: TargetState[],
  drift: DriftState,
  cmd: PlayerCommand,
  time: number,
  dt: number,
  events: GameEvent[],
): void {
  if (drift.active && drift.chargeRate > 0) {
    l.charge = Math.min(LIGHTNING.capacity, l.charge + drift.chargeRate * dt);
  }
  if (l.cooldown > 0) l.cooldown = Math.max(0, l.cooldown - dt);
  if (l.arcTimer > 0) l.arcTimer = Math.max(0, l.arcTimer - dt);

  if (cmd.fire) {
    if (!l.charging && l.armed) {
      // The press, not the release, is where a shot is refused: loading a bolt that could
      // never be paid for would be a lie the player only finds out about on release. What has
      // to be affordable here is the CHEAPEST shot — the down payment and the shortest hold
      // that is not a fumble — because how far this one reaches is a decision not made yet.
      l.armed = false;
      if (!canAffordShot(l.charge)) {
        events.push({ type: 'lightningDenied', reason: 'noCharge' });
      } else if (l.cooldown > 0) {
        events.push({ type: 'lightningDenied', reason: 'cooldown' });
      } else {
        l.charging = true;
        l.hold = 0;
        l.spent = LIGHTNING.minCost;
        l.charge = Math.max(0, l.charge - LIGHTNING.minCost);
      }
    }
    // Load up to the cap and wait there, drawing charge the whole way. Nothing fires while the
    // button is down, and an empty meter stops the reach growing rather than throwing the shot:
    // the player still chooses the moment, they just stop buying distance.
    if (l.charging) {
      const room = Math.max(0, Math.min(dt, LIGHTNING.maxHold - l.hold));
      const rate = holdCostRate();
      const affordable = rate > 0 ? l.charge / rate : room;
      const step = Math.min(room, affordable);
      if (step > 0) {
        const drawn = step * rate;
        l.hold += step;
        l.spent += drawn;
        l.charge = Math.max(0, l.charge - drawn);
      }
    }
  } else {
    if (l.charging) {
      const reach = l.hold / LIGHTNING.maxHold;
      const fumbled = l.hold < LIGHTNING.minHold;
      const spent = l.spent;
      l.charging = false;
      l.hold = 0;
      l.spent = 0;
      if (fumbled) {
        // Nothing left the car, so nothing was spent: hand the load back. Capped, because a
        // drift may have refilled the meter while the trigger was down.
        l.charge = Math.min(LIGHTNING.capacity, l.charge + spent);
        events.push({ type: 'lightningDenied', reason: 'short' });
      } else {
        fire(l, v, targets, reach, spent, time, events);
      }
    }
    l.armed = true;
  }

  // What the beam would hit if it left now: while charging that is the reach bought so far,
  // otherwise the full range, so the reticle shows the player they are lined up at all.
  const preview = l.charging ? LIGHTNING.range * (l.hold / LIGHTNING.maxHold) : LIGHTNING.range;
  l.acquiredTargetId = rayTarget(v.x, v.z, v.heading, targets, preview, LIGHTNING.hitRadius, v.y);
}

/**
 * Throws the bolt `reach` (0..1) of the full range down the car's heading. `spent` is what the
 * load already drew from the meter while the trigger was down — the charge is NOT taken again
 * here, it was taken as it was loaded.
 */
function fire(
  l: LightningState,
  v: VehicleState,
  targets: TargetState[],
  reach: number,
  spent: number,
  time: number,
  events: GameEvent[],
): void {
  l.charging = false;
  l.hold = 0;
  l.spent = 0;
  l.armed = false;
  const range = LIGHTNING.range * reach;
  const hitId = rayTarget(v.x, v.z, v.heading, targets, range, LIGHTNING.hitRadius, v.y);
  const target = hitId >= 0 ? findTarget(targets, hitId) : undefined;
  l.cooldown = LIGHTNING.cooldown;
  l.arcTimer = LIGHTNING.arcDuration;
  l.lastTargetId = target ? target.id : -1;
  // A miss still draws an arc, out to where the bolt ran out of reach.
  const toX = target ? target.x : v.x + forwardX(v.heading) * range;
  const toZ = target ? target.z : v.z + forwardZ(v.heading) * range;
  const toY = target ? target.y : v.y;
  if (target) {
    target.status = 'destroyed';
    target.hitTime = time;
  }
  // How far the bolt actually went, which for a hit is where the car was and NOT the reach the
  // hold bought. Scoring pays for the distance crossed, so a full hold into a car six metres
  // away has to read as the close shot it is.
  const dx = toX - v.x;
  const dz = toZ - v.z;
  const distance = Math.sqrt(dx * dx + dz * dz);
  events.push({
    type: 'lightningFired',
    targetId: target ? target.id : -1,
    fromX: v.x,
    fromY: v.y,
    fromZ: v.z,
    toX,
    toY,
    toZ,
    distance,
    spent,
  });
  if (target) {
    events.push({
      type: 'targetDestroyed',
      targetId: target.id,
      x: target.x,
      y: target.y,
      z: target.z,
      reward: 0,
      distance,
    });
  }
}

/**
 * Charge drawn per second of hold, once the down payment is made: the rest of `cost`, spread
 * evenly across `maxHold`.
 */
function holdCostRate(): number {
  if (!(LIGHTNING.maxHold > 0)) return 0;
  return Math.max(0, LIGHTNING.cost - LIGHTNING.minCost) / LIGHTNING.maxHold;
}

/** What a shot held for `hold` seconds costs, down payment included. */
export function lightningCost(hold: number): number {
  const held = Math.min(LIGHTNING.maxHold, Math.max(0, hold));
  return LIGHTNING.minCost + held * holdCostRate();
}

/**
 * The longest hold `charge` can pay for (s), which is the reach the meter can still buy. What
 * the loading loop enforces a tick at a time, and what presentation asks to draw a ceiling.
 */
export function maxAffordableHold(charge: number): number {
  if (charge < LIGHTNING.minCost) return 0;
  const rate = holdCostRate();
  if (rate <= 0) return LIGHTNING.maxHold;
  return Math.min(LIGHTNING.maxHold, (charge - LIGHTNING.minCost) / rate);
}

/**
 * Whether `charge` can pay for any shot at all: the gate at the press, and what the HUD's READY
 * light means. The cheapest shot is the shortest hold that is not a fumble, not the bare down
 * payment — a press that could only ever end in a fumble is not a shot.
 */
export function canAffordShot(charge: number): boolean {
  return charge >= lightningCost(LIGHTNING.minHold);
}

export function findTarget(targets: TargetState[], id: number): TargetState | undefined {
  for (let i = 0; i < targets.length; i++) if (targets[i].id === id) return targets[i];
  return undefined;
}
