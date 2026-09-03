import type { GameEvent, NitroState, PlayerCommand, VehicleState } from '../core/types';
import { NITRO } from '../config/tuning';

/**
 * Nitro resource. Drains while held (and available), recharges gradually while the car
 * is moving and not boosting. Never recharges while stationary.
 */
export function stepNitro(n: NitroState, v: VehicleState, cmd: PlayerCommand, dt: number, events: GameEvent[]): void {
  const wasActive = n.active;
  const wants = cmd.nitro && v.speed > -0.1;
  let active = false;
  if (wants) {
    if (wasActive ? n.amount > 0 : n.amount >= NITRO.minToActivate) active = true;
  }
  if (active) {
    n.amount = Math.max(0, n.amount - NITRO.drainPerSecond * dt);
    n.rechargeDelay = NITRO.rechargeDelay;
    if (n.amount <= 0) active = false;
  } else {
    if (n.rechargeDelay > 0) n.rechargeDelay = Math.max(0, n.rechargeDelay - dt);
    else if (Math.abs(v.speed) > NITRO.rechargeMinSpeed) {
      n.amount = Math.min(NITRO.capacity, n.amount + NITRO.rechargePerSecond * dt);
    }
  }
  n.active = active;
  if (active && !wasActive) events.push({ type: 'nitroStart' });
  else if (!active && wasActive) events.push({ type: 'nitroEnd' });
}
