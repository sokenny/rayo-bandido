import type { DriftState, GameEvent, LightningState, PlayerCommand, TargetState, VehicleState } from '../core/types';
import { LIGHTNING } from '../config/tuning';
import { selectTarget } from './targeting';

/**
 * Lightning resource and firing. Charge only ever increases through `drift.chargeRate`.
 * Firing requires `cost` charge, an acquired target and no cooldown. A hit marks the
 * target destroyed exactly once and emits `lightningFired` + `targetDestroyed`.
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

  l.acquiredTargetId = selectTarget(v.x, v.z, v.heading, targets);

  if (!cmd.fire) return;
  if (l.charge < LIGHTNING.cost) {
    events.push({ type: 'lightningDenied', reason: 'noCharge' });
    return;
  }
  if (l.cooldown > 0) {
    events.push({ type: 'lightningDenied', reason: 'cooldown' });
    return;
  }
  if (l.acquiredTargetId < 0) {
    events.push({ type: 'lightningDenied', reason: 'noTarget' });
    return;
  }
  const target = findTarget(targets, l.acquiredTargetId);
  if (!target || target.status !== 'active') {
    events.push({ type: 'lightningDenied', reason: 'noTarget' });
    return;
  }
  l.charge -= LIGHTNING.cost;
  l.cooldown = LIGHTNING.cooldown;
  l.arcTimer = LIGHTNING.arcDuration;
  l.lastTargetId = target.id;
  target.status = 'destroyed';
  target.hitTime = time;
  events.push({ type: 'lightningFired', targetId: target.id, fromX: v.x, fromZ: v.z, toX: target.x, toZ: target.z });
  events.push({ type: 'targetDestroyed', targetId: target.id, x: target.x, z: target.z, reward: 0 });
  l.acquiredTargetId = selectTarget(v.x, v.z, v.heading, targets);
}

export function findTarget(targets: TargetState[], id: number): TargetState | undefined {
  for (let i = 0; i < targets.length; i++) if (targets[i].id === id) return targets[i];
  return undefined;
}
