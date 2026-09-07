import type { DriftState, GameEvent, LightningState, PlayerCommand, TargetState, VehicleState } from '../core/types';
import { LIGHTNING } from '../config/tuning';
import { forwardX, forwardZ } from '../core/math';
import { rayTarget } from './targeting';

/**
 * Lightning resource, aiming and firing. Charge only ever increases through `drift.chargeRate`.
 *
 * The gun is held, not tapped: pressing fire starts charging (which costs `cost` there and
 * then, so a shot can be refused before it exists), and releasing throws the bolt down the
 * car's heading with a reach proportional to how long it was held — `maxHold` seconds buys the
 * full `range`, half that buys half the range. Holding past `maxHold` simply sits at full
 * reach: the shot only ever leaves on the release, so the player picks the moment. Nothing
 * homes: the bolt flies straight and hits whatever is within `hitRadius` of that line, or
 * nothing at all, in which case `lightningFired` carries `targetId: -1`.
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
      // The press, not the release, is where a shot is refused: charging a bolt that could
      // never be paid for would be a lie the player only finds out about on release.
      l.armed = false;
      if (l.charge < LIGHTNING.cost) {
        events.push({ type: 'lightningDenied', reason: 'noCharge' });
      } else if (l.cooldown > 0) {
        events.push({ type: 'lightningDenied', reason: 'cooldown' });
      } else {
        l.charging = true;
        l.hold = 0;
      }
    }
    // Charge up to the cap and wait there. Nothing fires while the button is down.
    if (l.charging) l.hold = Math.min(LIGHTNING.maxHold, l.hold + dt);
  } else {
    if (l.charging) {
      const reach = l.hold / LIGHTNING.maxHold;
      const fumbled = l.hold < LIGHTNING.minHold;
      l.charging = false;
      l.hold = 0;
      if (fumbled) events.push({ type: 'lightningDenied', reason: 'short' });
      else fire(l, v, targets, reach, time, events);
    }
    l.armed = true;
  }

  // What the beam would hit if it left now: while charging that is the reach bought so far,
  // otherwise the full range, so the reticle shows the player they are lined up at all.
  const preview = l.charging ? LIGHTNING.range * (l.hold / LIGHTNING.maxHold) : LIGHTNING.range;
  l.acquiredTargetId = rayTarget(v.x, v.z, v.heading, targets, preview, LIGHTNING.hitRadius, v.y);
}

/** Throws the bolt `reach` (0..1) of the full range down the car's heading. */
function fire(
  l: LightningState,
  v: VehicleState,
  targets: TargetState[],
  reach: number,
  time: number,
  events: GameEvent[],
): void {
  l.charging = false;
  l.hold = 0;
  l.armed = false;
  const range = LIGHTNING.range * reach;
  const hitId = rayTarget(v.x, v.z, v.heading, targets, range, LIGHTNING.hitRadius, v.y);
  const target = hitId >= 0 ? findTarget(targets, hitId) : undefined;
  l.charge -= LIGHTNING.cost;
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
  events.push({
    type: 'lightningFired',
    targetId: target ? target.id : -1,
    fromX: v.x,
    fromY: v.y,
    fromZ: v.z,
    toX,
    toY,
    toZ,
  });
  if (target) {
    events.push({ type: 'targetDestroyed', targetId: target.id, x: target.x, y: target.y, z: target.z, reward: 0 });
  }
}

export function findTarget(targets: TargetState[], id: number): TargetState | undefined {
  for (let i = 0; i < targets.length; i++) if (targets[i].id === id) return targets[i];
  return undefined;
}
