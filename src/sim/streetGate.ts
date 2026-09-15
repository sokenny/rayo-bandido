import type { ActivitySite, GameEvent, PlayerCommand, StreetGateState, VehicleState } from '../core/types';
import { STREET_RACE } from '../config/tuning';

/**
 * THE STREET RACE RING, as a place in the city: how the series is found.
 *
 * The same door `src/sim/circuitGate.ts` is: ONE ring, and it does not move. It always offers
 * the newest event this player has reached — so a win does not send them across the map, it
 * puts a harder field on the same lot. `atSite` is the EVENT the ring is offering while the car
 * is on it (-1 off it); the key takes the player to that event, on the other side of a page load.
 *
 * Nothing here knows what a race is. It is a door, and a door's only job is to be somewhere
 * and to open. Pure data in, pure data out; no allocation per tick.
 */

/**
 * How many events make up THE SERIES: the ones `cleared` counts. They come first in
 * `STREET_RACE.events`; a `standalone` event after them (La Curva) is always open, never counted.
 */
export function streetEventCount(): number {
  let n = 0;
  while (n < STREET_RACE.events.length && !STREET_RACE.events[n].standalone) n++;
  return n;
}

/** Whether `event` is a standalone race rather than a step of the series. */
export function streetEventStandalone(event: number): boolean {
  return event >= 0 && event < STREET_RACE.events.length && STREET_RACE.events[event].standalone;
}

/** A stored count made safe: a whole number between 0 and the length of the series. */
export function clampStreetCleared(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(streetEventCount(), Math.floor(value));
}

/** Index of the newest open event OF THE SERIES: the one on offer to a player with `cleared` wins. */
export function streetNewestEvent(cleared: number): number {
  return Math.min(streetEventCount() - 1, clampStreetCleared(cleared));
}

/** Whether event `event` may be driven by a player with `cleared` wins. A standalone event always may. */
export function streetEventOpen(cleared: number, event: number): boolean {
  if (streetEventStandalone(event)) return true;
  return event >= 0 && event < streetEventCount() && event <= clampStreetCleared(cleared);
}

export function createStreetGateState(cleared = 0): StreetGateState {
  return { atSite: -1, locked: false, rearmed: true, entering: false, cleared: clampStreetCleared(cleared) };
}

/** Back to a door nobody has been through. A restart: the car is at the spawn, off every ring. */
export function resetStreetGateState(s: StreetGateState): void {
  s.atSite = -1;
  s.rearmed = true;
  s.entering = false;
}

/** Whether a sign is up: the car is on an open ring and nothing else has it. */
export function canEnterStreetRace(s: StreetGateState): boolean {
  return s.atSite >= 0 && s.rearmed && !s.locked && !s.entering;
}

/**
 * One tick of the door. `sites[0]` is the ring; a world that ships more only ever uses the
 * first. `cmd.activate` is the same per-tick latch every activity is taken up with.
 */
export function stepStreetGate(
  s: StreetGateState,
  sites: readonly ActivitySite[],
  v: VehicleState,
  cmd: PlayerCommand,
  events: GameEvent[],
): void {
  const wasOffering = canEnterStreetRace(s);
  const wasAt = s.atSite;
  const m = STREET_RACE.marker;
  const site = sites[0];
  if (!site) return;

  // Wider to leave than to enter, so a car parked exactly on the ring cannot flicker the sign.
  const dx = v.x - site.x;
  const dz = v.z - site.z;
  const d2 = dx * dx + dz * dz;
  const limit = s.atSite >= 0 ? m.exitRadius : m.promptRadius;
  s.atSite = d2 <= limit * limit ? streetNewestEvent(s.cleared) : -1;
  if (!s.rearmed && d2 > m.rearmRadius * m.rearmRadius) s.rearmed = true;

  if (cmd.activate && canEnterStreetRace(s)) {
    s.entering = true;
    s.rearmed = false;
    events.push({ type: 'streetRaceEnter', event: s.atSite });
  }

  const nowOffering = canEnterStreetRace(s);
  if (nowOffering !== wasOffering || (nowOffering && s.atSite !== wasAt)) {
    events.push({ type: 'streetRacePrompt', on: nowOffering, event: s.atSite });
  }
}
