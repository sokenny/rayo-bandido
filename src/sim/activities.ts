import type { BuhoState, CircuitGateState, GameState, IntroState, PassengerState, RushState, StreetGateState } from '../core/types';

/**
 * ONE ACTIVITY AT A TIME: the one place that decides which of them has the car.
 *
 * WHY IT EXISTS. The city runs four things a player can be doing — a RAYO RUSH run, a passenger
 * ride, the Moogul, and the door to the circuit missions — and each of them used to be told
 * about the others by an expression written out where it was needed. Four activities means
 * twelve of those, they were not the same shape as each other, and the rules and the picture
 * were free to disagree about whether a ride was under way. So it is one question asked in one
 * place, and everything else — the locks in `src/sim/gameState.ts`, the markers, the map, the
 * signs — is derived from the answer.
 *
 * WHAT "ENGAGED" MEANS, and it is deliberately not "available": an activity is engaged when it
 * HAS the car. A passenger standing at a kerb waiting to be picked up is an offer, not a ride;
 * a marker painted on the road is an invitation, not a run. Offers do not lock anything out,
 * because a city where the first thing you drove past silenced everything else would be a city
 * with one activity in it.
 *
 * THE MOOGUL IS THE EXCEPTION THAT SHOWS WHAT THE RULE IS. It is a thing the player BOUGHT, not
 * a thing they are doing: it changes what the city looks like and nothing else, so it never
 * holds the car and never locks anything out. Take up a run or pick a fare up while it is in you
 * and the trip ends on that very tick (`src/sim/gameState.ts`) rather than the run being
 * refused. So it is only ever on the receiving end of this rule — El Búho stops selling while
 * somebody else has the car, and his ring stops answering — and never on the giving end, which
 * is why `engagedActivity` cannot return it.
 *
 * WHAT FOLLOWS FROM IT. Two things, and they are the same rule seen from either side:
 *
 *   THE RULES  — everything that is not the engaged activity is `locked`, which each module
 *                already understands as "do not offer, do not start, do not take the key".
 *   THE PICTURE — everything that is not the engaged activity takes its marker off the street
 *                and its mark off the map (`src/game.ts`), so a run is driven in a city with
 *                nothing in it but the run.
 *
 * Pure predicates over state. Nothing here allocates, nothing mutates, and it is safe to call
 * per frame as well as per tick.
 */

/**
 * The four activities, named. Three of them can hold the car; `'moogul'` is here because it can
 * be suppressed, not because it can ever be the one doing the suppressing.
 */
export type ActivityKind = 'rush' | 'passenger' | 'moogul' | 'circuit' | 'street' | 'intro';

/** A RAYO RUSH run, from the count-in to the results card being put away. */
export function rushEngaged(rush: RushState | null | undefined): boolean {
  return !!rush && rush.phase !== 'idle';
}

/**
 * A fare in the car — or just out of it, with the card still up. An `offered` ride is not
 * engaged: nobody has got in yet, and the player is free to drive past.
 */
export function passengerEngaged(passenger: PassengerState | null | undefined): boolean {
  return !!passenger && (passenger.phase === 'riding' || passenger.phase === 'results');
}

/**
 * The Moogul, in the player. Not an engagement — see the header — but the picture still has to
 * know: it is what the trip's own visuals are driven from, and it is what says El Búho has
 * nothing left to sell this player right now.
 */
export function moogulActive(buho: BuhoState | null | undefined): boolean {
  return !!buho && buho.moogulActive;
}

/**
 * The circuit's door, taken. It lasts the handful of frames between the key and the new world
 * loading, and it is here for exactly that stretch: nothing else should light up on the way out.
 */
export function circuitEngaged(gate: CircuitGateState | null | undefined): boolean {
  return !!gate && gate.entering;
}

/** A STREET RACE ring's key taken: the same handful of frames on the way out, for the same reason. */
export function streetEngaged(gate: StreetGateState | null | undefined): boolean {
  return !!gate && gate.entering;
}

/**
 * The first-time introduction (`src/sim/intro.ts`), from its first tick until it completes or
 * is skipped. It has the car for its whole length: nothing else may start, offer, or send the
 * police, and its own furniture is the only furniture on the street.
 */
export function introEngaged(intro: IntroState | null | undefined): boolean {
  return !!intro && intro.active;
}

/**
 * Which activity has the car, or null when the player is simply driving. Never `'moogul'`: a
 * trip is not something that has the car.
 *
 * The order is a tie-break that should never be needed — each activity refuses to start while
 * another is engaged, so two can only overlap on the single tick one of them ends — and it is
 * fixed rather than incidental so that the frame in between cannot flicker between two answers.
 */
export function engagedActivity(state: {
  rush?: RushState | null;
  passenger?: PassengerState | null;
  circuitGate?: CircuitGateState | null;
  streetGate?: StreetGateState | null;
  intro?: IntroState | null;
}): ActivityKind | null {
  // The introduction first: it starts before anything else can, and holds the car until it ends.
  if (introEngaged(state.intro)) return 'intro';
  if (rushEngaged(state.rush)) return 'rush';
  if (passengerEngaged(state.passenger)) return 'passenger';
  if (circuitEngaged(state.circuitGate)) return 'circuit';
  if (streetEngaged(state.streetGate)) return 'street';
  return null;
}

/**
 * Whether `kind` should be out of the way right now: something else has the car.
 *
 * The engaged activity is never suppressed by itself, which is what makes this safe to ask
 * about all four every frame — including the one that is running.
 */
export function activitySuppressed(engaged: ActivityKind | null, kind: ActivityKind): boolean {
  return engaged !== null && engaged !== kind;
}

/**
 * Write `locked` onto every activity this state carries, from the single answer above. Called
 * by `stepGame` before any of them runs, so all four see the same picture of the tick.
 */
export function lockOtherActivities(state: GameState): ActivityKind | null {
  const engaged = engagedActivity(state);
  if (state.rush) state.rush.locked = activitySuppressed(engaged, 'rush');
  if (state.passenger) state.passenger.locked = activitySuppressed(engaged, 'passenger');
  if (state.circuitGate) state.circuitGate.locked = activitySuppressed(engaged, 'circuit');
  if (state.streetGate) state.streetGate.locked = activitySuppressed(engaged, 'street');
  // El Búho, who is never the one holding it: he sells while nobody at all has the car, which
  // is the same sentence as `activitySuppressed(engaged, 'moogul')` and is written out here
  // because "he is never engaged" is the fact worth reading at the point it is relied on.
  if (state.buho) state.buho.locked = engaged !== null;
  return engaged;
}
