import type { DriftState, GameEvent, VehicleState } from '../core/types';
import { DRIFT } from '../config/tuning';

/**
 * Drift detection state machine.
 *
 * A drift becomes valid after slip conditions (speed above `minSpeed`, |slip| above
 * `slipEnter`) hold for `activationTime`. It survives short lapses up to `cancelGrace`,
 * and cancels immediately on collision or reversal. Drifts within `chainWindow` of each
 * other extend the chain. `chargeRate` reports how much lightning charge per second the
 * current drift generates; `src/sim/lightning.ts` integrates it.
 *
 * Thresholds are tuned against the controller in `src/sim/vehicle.ts`: straight-line and
 * gentle cornering settle around 4-7 degrees of slip (below `slipEnter`), a handbrake or
 * power-oversteer slide settles around 20-40 degrees, and `chargePerSecond` is sized so a
 * clean drift reaches the 50-unit lightning cost in roughly 3-4 seconds.
 */
export function stepDrift(d: DriftState, v: VehicleState, dt: number, events: GameEvent[]): void {
  const slip = Math.abs(v.slipAngle);
  const fast = v.speed > DRIFT.minSpeed;
  const threshold = d.active ? DRIFT.slipExit : DRIFT.slipEnter;
  const sliding = fast && slip > threshold;
  const forcedCancel = v.collided || v.speed < 0;

  if (d.chainWindow > 0) d.chainWindow = Math.max(0, d.chainWindow - dt);
  else if (!d.active) d.chain = 0;

  if (!d.active) {
    d.chargeRate = 0;
    if (sliding && !forcedCancel) {
      d.candidateTime += dt;
      if (d.candidateTime >= DRIFT.activationTime) {
        d.active = true;
        d.duration = d.candidateTime;
        d.lapseTime = 0;
        d.chain = d.chainWindow > 0 ? d.chain + 1 : 1;
        d.chainWindow = 0;
        events.push({ type: 'driftStart' });
      }
    } else {
      d.candidateTime = 0;
    }
    return;
  }

  // Active drift.
  d.duration += dt;
  if (forcedCancel) {
    endDrift(d, events);
    return;
  }
  if (sliding) {
    d.lapseTime = 0;
    const chainBonus = Math.min(d.chain - 1, DRIFT.maxChainBonus) * DRIFT.chargeChainBonus;
    const angle = slip < DRIFT.chargeAngleCap ? slip : DRIFT.chargeAngleCap;
    d.chargeRate = (DRIFT.chargePerSecond + chainBonus) * (1 + angle * DRIFT.chargeAngleGain);
  } else {
    d.lapseTime += dt;
    d.chargeRate = 0;
    if (d.lapseTime >= DRIFT.cancelGrace) endDrift(d, events);
  }
}

function endDrift(d: DriftState, events: GameEvent[]): void {
  events.push({ type: 'driftEnd', duration: d.duration, chain: d.chain });
  d.active = false;
  d.duration = 0;
  d.candidateTime = 0;
  d.lapseTime = 0;
  d.chargeRate = 0;
  d.chainWindow = DRIFT.chainWindow;
}
