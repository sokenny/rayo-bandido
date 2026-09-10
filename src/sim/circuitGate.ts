import type { ActivitySite, CircuitGateState, GameEvent, PlayerCommand, VehicleState } from '../core/types';
import { TIME_ATTACK } from '../config/tuning';

/**
 * THE START LINE, as a place in the city: how the circuit missions are found.
 *
 * WHAT IT IS. A ring of paint across the Bandido Grid's own start/finish line, standing in the
 * open world at the point of av-main the race is cut through. Roll onto it and the sign is up;
 * press the key and the player is taken to the circuit with the mission chain
 * (`src/sim/timeAttack.ts`) waiting for them. That is the whole module.
 *
 * WHAT IT IS NOT. It is not the mission, and it does not know what one is. Nothing here reads
 * a target time, counts a crash or moves the chain on — those happen on the other side of the
 * load, judged by the race that is about to be driven. This is a door, and a door's only job is
 * to be somewhere and to open.
 *
 * WHY A DOOR AND NOT A RUN. The other three activities are watched in place: the city keeps
 * running and the rules only score what was going to happen anyway, which is what lets RAYO
 * RUSH start without a load. A lap of the circuit cannot work that way — the course has
 * barriers down both sides of it, a grid, gates and a field of traffic thinned to run one way
 * round — so the circuit really is another world, and the honest thing is a door to it rather
 * than a pretence that the street IS the track.
 *
 * WHERE IT SITS IN A TICK. With the other activities, after the ones that can be started by
 * mistake and under the same `locked` rule they all share (`src/sim/activities.ts`): a run, a
 * ride or a Moogul in progress means no sign here, so the key cannot take a player out of a
 * mission they are halfway through.
 *
 * ONE PRESS, ONCE. `entering` latches on the press. The caller is loading another world by
 * then, but it takes as many frames as it takes, and every one of them is a tick in which the
 * car is still standing on the paint with the key possibly still down.
 *
 * Pure data in, pure data out. No Three.js, no DOM, no clock of its own, no allocation.
 */

export function createCircuitGateState(): CircuitGateState {
  return { atSite: false, locked: false, rearmed: true, entering: false };
}

/**
 * Back to a door nobody has been through. A restart.
 *
 * `rearmed` goes back to true because a restart puts the car at the city's spawn, which is not
 * on the ring — there is nothing left for the guard to guard against.
 */
export function resetCircuitGateState(s: CircuitGateState): void {
  s.atSite = false;
  s.rearmed = true;
  s.entering = false;
}

/**
 * Whether the sign is up. The prompt asks this rather than merely "is the car on the paint", so
 * what is on screen and what the key will actually do can never disagree.
 */
export function canEnterCircuit(s: CircuitGateState): boolean {
  return s.atSite && s.rearmed && !s.locked && !s.entering;
}

/**
 * One tick of the door: where the car is, and whether the key was pressed while the sign was up.
 *
 * `cmd.activate` is the same per-tick latch every other activity is taken up with, so a held key
 * is one press — and since the sign is only up when nothing else has the car, that one press
 * cannot be the same press that started a run or picked a fare up.
 */
export function stepCircuitGate(
  s: CircuitGateState,
  site: ActivitySite,
  v: VehicleState,
  cmd: PlayerCommand,
  events: GameEvent[],
): void {
  // What the sign was saying as the tick opened. Compared with the same question at the end,
  // this is what turns a boolean into the edge the chime and the overlay need.
  const wasOffering = canEnterCircuit(s);

  const dx = v.x - site.x;
  const dz = v.z - site.z;
  const dist2 = dx * dx + dz * dz;
  const m = TIME_ATTACK.marker;
  // Wider to leave than to enter, so a car parked exactly on the line cannot flicker the sign.
  const limit = s.atSite ? m.exitRadius : m.promptRadius;
  s.atSite = dist2 <= limit * limit;
  if (!s.rearmed && dist2 > m.rearmRadius * m.rearmRadius) s.rearmed = true;

  if (cmd.activate && canEnterCircuit(s)) {
    s.entering = true;
    s.rearmed = false;
    events.push({ type: 'circuitEnter' });
  }

  const nowOffering = canEnterCircuit(s);
  if (nowOffering !== wasOffering) events.push({ type: 'circuitPrompt', on: nowOffering });
}
