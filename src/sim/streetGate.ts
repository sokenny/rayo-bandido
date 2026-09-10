import type { ActivitySite, GameEvent, PlayerCommand, StreetGateState, VehicleState } from '../core/types';
import { STREET_RACE } from '../config/tuning';

/**
 * THE STREET RACE RINGS, as places in the city: how the three events are found.
 *
 * The same door `src/sim/circuitGate.ts` is, with one difference: there are up to three of
 * them open at once. Event N's ring is open once N events have been won — so a fresh player
 * sees one ring, and every event already won stays open to be driven again. Which ring the car
 * is on is `atSite`; the key takes the player to THAT event, on the other side of a page load.
 *
 * Nothing here knows what a race is. It is a door, and a door's only job is to be somewhere
 * and to open. Pure data in, pure data out; no allocation per tick.
 */

/** How many events there are. */
export function streetEventCount(): number {
  return STREET_RACE.events.length;
}

/** A stored count made safe: a whole number between 0 and the length of the series. */
export function clampStreetCleared(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(STREET_RACE.events.length, Math.floor(value));
}

/** Index of the newest open event: the one on offer to a player with `cleared` wins. */
export function streetNewestEvent(cleared: number): number {
  return Math.min(STREET_RACE.events.length - 1, clampStreetCleared(cleared));
}

/** Whether event `event` may be driven by a player with `cleared` wins. */
export function streetEventOpen(cleared: number, event: number): boolean {
  return event >= 0 && event < STREET_RACE.events.length && event <= clampStreetCleared(cleared);
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
 * One tick of the doors. `sites` is one per event, in event order; only the open ones answer.
 * `cmd.activate` is the same per-tick latch every activity is taken up with.
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
  const open = Math.min(sites.length - 1, streetNewestEvent(s.cleared));

  // Wider to leave than to enter, so a car parked exactly on a ring cannot flicker the sign.
  let at = -1;
  let nearest2 = Infinity;
  for (let i = 0; i <= open; i++) {
    const site = sites[i];
    const dx = v.x - site.x;
    const dz = v.z - site.z;
    const d2 = dx * dx + dz * dz;
    const limit = s.atSite === i ? m.exitRadius : m.promptRadius;
    if (d2 <= limit * limit && d2 < nearest2) {
      nearest2 = d2;
      at = i;
    }
  }
  s.atSite = at;
  if (!s.rearmed) {
    // Rearm once the car is clear of EVERY ring, not only the one it left through.
    let clear = true;
    for (let i = 0; i <= open; i++) {
      const dx = v.x - sites[i].x;
      const dz = v.z - sites[i].z;
      if (dx * dx + dz * dz <= m.rearmRadius * m.rearmRadius) clear = false;
    }
    if (clear) s.rearmed = true;
  }

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
