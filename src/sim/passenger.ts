import type {
  DriftState,
  GameEvent,
  PassengerLineKind,
  PassengerPreferenceStatus,
  PassengerReaction,
  PassengerResults,
  PassengerState,
  PassengerStop,
  PassengerTrip,
  PlayerCommand,
  TargetState,
  VehicleState,
} from '../core/types';
import { PASSENGER } from '../config/tuning';
import { msToKmh } from '../core/math';
import { resolveLine, type PassengerDef } from '../content/passengers';

/**
 * PASSENGERS: the free-world side rides.
 *
 * WHAT IT IS. Somebody stands at a stop with a pin over them. Stop on the pin, press the key,
 * and they get in: a portrait, a name, a line about where they are going and how they like to
 * be driven. Drive them there, stop in the zone, press the key, and they pay a fare fixed at
 * the offer plus a tip the ride earned. That is all — no failure state, no chase, no second
 * simulation. Like RAYO RUSH this module only WATCHES the city: it reads the car's speed, the
 * drift detector, this tick's events, and it never moves a car, never touches the weapon and
 * never changes what the player may do.
 *
 * WHERE IT SITS IN A TICK. After `stepRush`, so the two activities decide who has the key in
 * one place (`src/sim/gameState.ts` writes `locked` on both before either runs), and it reads
 * the `targetDestroyed`, `collision` and `driftEnd` events the rest of the tick already raised.
 * `applyPassengerFare` in `src/sim/economy.ts` runs after it and pays what it raised.
 *
 * EVERYTHING IS CHOSEN BEFORE THE RIDE. `planTrip` picks the character, both stops, the fare
 * and which opening plays, at the moment the pin goes up. From then on the only decisions are
 * "did this thing just happen" and "which of the lines written for it has not just been said".
 * There is no content generation at runtime and nothing here waits on anything.
 *
 * THE MOOD, 0..100. Continuous rules (a speed to stay under, a speed to stay over) move it per
 * second, scaled by `dt`, so the score is the same at 30 and 144 fps; each has a grace so a
 * spike over a crest or a slow corner costs nothing. Discrete rules (a drift, a Rayo hit, a
 * crash) move it in steps, rate-limited by a cooldown and — for the gains — capped over the
 * whole ride, so nothing farms. A car that is not moving earns nothing and loses nothing: the
 * pickup, the drop-off and a red light are free for everybody, including the one who asked to
 * go fast. Every number is in `PASSENGER` (`src/config/tuning.ts`).
 *
 * THE DIALOGUE QUEUE. Lines carry a priority and, for reactions, an expiry: an opening or a
 * brief always plays, a reaction that has waited past `reactionStale` is dropped rather than
 * read out about something the player has forgotten. One line at a time, a gap between them,
 * never the same text twice running, and arrival and farewell clear whatever incidental
 * remarks were still waiting.
 *
 * Pure data in, pure data out. No Three.js, no DOM, no clock of its own. The only allocation
 * per ride is the handful of queued-line objects, never per tick.
 */

const PRIORITY: Record<PassengerLineKind, number> = { farewell: 5, opening: 4, brief: 3, arrival: 2, reaction: 1 };
/** Most lines waiting at once. Openings fill two of these; the rest is reactions. */
const QUEUE_CAP = 6;
/** Sim time far enough ahead to mean "never expires". */
const NEVER = Number.POSITIVE_INFINITY;

export function createPassengerState(targetCount: number): PassengerState {
  return {
    phase: 'idle',
    locked: false,
    offerIn: PASSENGER.offer.firstDelay,
    offers: 0,
    trip: null,
    atPickup: false,
    atDestination: false,
    cancelArm: 0,
    resultsHold: 0,
    mood: PASSENGER.mood.start,
    prefStatus: ['neutral', 'neutral'],
    overTime: 0,
    slowTime: 0,
    goodStreak: 0,
    arrivalSaid: false,
    flowGain: 0,
    eventGain: 0,
    driftCooldown: 0,
    rayoCooldown: 0,
    collisionCooldown: 0,
    reactionCooldown: 0,
    speedLineCooldown: 0,
    counted: new Uint8Array(targetCount),
    bonuses: 0,
    penalties: 0,
    line: '',
    lineKind: 'reaction',
    lineId: 0,
    lineTimeLeft: 0,
    lastText: '',
    queue: [],
    seed: 0x9e3779b9,
    results: null,
  };
}

/** Back to nobody waiting. A restart; the pin goes up again after the usual wait. */
export function resetPassengerState(s: PassengerState): void {
  s.phase = 'idle';
  s.offerIn = PASSENGER.offer.firstDelay;
  s.trip = null;
  s.atPickup = false;
  s.atDestination = false;
  s.cancelArm = 0;
  s.resultsHold = 0;
  clearRide(s);
  s.results = null;
}

/** Everything that belongs to one ride, back to zero. The trip and the phase are the caller's. */
function clearRide(s: PassengerState): void {
  s.mood = PASSENGER.mood.start;
  s.prefStatus[0] = 'neutral';
  s.prefStatus[1] = 'neutral';
  s.overTime = 0;
  s.slowTime = 0;
  s.goodStreak = 0;
  s.arrivalSaid = false;
  s.flowGain = 0;
  s.eventGain = 0;
  s.driftCooldown = 0;
  s.rayoCooldown = 0;
  s.collisionCooldown = 0;
  s.reactionCooldown = 0;
  s.speedLineCooldown = 0;
  s.counted.fill(0);
  s.bonuses = 0;
  s.penalties = 0;
  s.line = '';
  s.lineTimeLeft = 0;
  s.lastText = '';
  s.queue.length = 0;
}

/* ================================================================== planning */

/** Straight-line distance between two stops (m). */
function stopDistance(a: PassengerStop, b: PassengerStop): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

/** Whether a stop carries any of the tags. */
function tagged(stop: PassengerStop, tags: readonly string[]): boolean {
  for (let i = 0; i < tags.length; i++) if (stop.tags.includes(tags[i])) return true;
  return false;
}

/** The fare a trip of this length is worth. Fixed at the offer; the mood never touches it. */
export function fareFor(distance: number): number {
  const r = PASSENGER.reward;
  return Math.round((r.baseFare + distance * r.farePerMetre) / 10) * 10;
}

/**
 * Choose the next ride: who, from where, to where, for how much, and which opening plays.
 * Deterministic in `offers` — the catalogue and the stops are rotated by it — so a test can
 * say exactly which ride the third pin is, and two players with the same history see the same
 * offers.
 *
 * The pickup is chosen from the character's eligible stops at least `minDistanceFromPlayer`
 * from the car (falling back to any eligible stop when none is that far, so a tiny world still
 * offers). The destination is the eligible stop whose distance from the pickup best fits the
 * trip range: inside it if any is, else the nearest to it. Null when the world has no stops or
 * the character no possible trip, in which case there is no offer this time round.
 */
export function planTrip(
  catalog: readonly PassengerDef[],
  stops: readonly PassengerStop[],
  offers: number,
  playerX: number,
  playerZ: number,
): PassengerTrip | null {
  if (catalog.length === 0 || stops.length < 2) return null;
  const def = catalog[offers % catalog.length];
  const round = Math.floor(offers / catalog.length);
  const o = PASSENGER.offer;

  // Pickups: the character's kind of place, and not right next to the car.
  let pickups: PassengerStop[] = [];
  let anyPickups: PassengerStop[] = [];
  for (const stop of stops) {
    if (!tagged(stop, def.pickupTags)) continue;
    anyPickups.push(stop);
    if (Math.hypot(stop.x - playerX, stop.z - playerZ) >= o.minDistanceFromPlayer) pickups.push(stop);
  }
  if (pickups.length === 0) pickups = anyPickups;
  if (pickups.length === 0) return null;
  const pickup = pickups[round % pickups.length];

  // Destinations: the character's kind of place, not the pickup, best fit to the trip range.
  let best: PassengerStop | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  let inRange = 0;
  for (const stop of stops) {
    if (stop === pickup || stop.id === pickup.id || !tagged(stop, def.destinationTags)) continue;
    const d = stopDistance(pickup, stop);
    const fits = d >= o.minTrip && d <= o.maxTrip;
    if (fits) inRange++;
    // Inside the range every candidate scores 0; the rotation below picks between them.
    // Outside it, how far outside.
    const score = fits ? 0 : d < o.minTrip ? o.minTrip - d : d - o.maxTrip;
    if (score < bestScore) {
      bestScore = score;
      best = stop;
    }
  }
  if (!best) return null;
  if (inRange > 1) {
    // Rotate among the in-range destinations so the same pickup does not always go one way.
    let want = (offers + round) % inRange;
    for (const stop of stops) {
      if (stop === pickup || stop.id === pickup.id || !tagged(stop, def.destinationTags)) continue;
      const d = stopDistance(pickup, stop);
      if (d < o.minTrip || d > o.maxTrip) continue;
      if (want === 0) {
        best = stop;
        break;
      }
      want--;
    }
  }
  const distance = stopDistance(pickup, best);
  return {
    passengerId: def.id,
    pickupId: pickup.id,
    destinationId: best.id,
    fare: fareFor(distance),
    distance,
    opening: def.openings.length > 0 ? offers % def.openings.length : 0,
  };
}

/** A stop by id, or null. Linear: there are a handful. */
export function stopById(stops: readonly PassengerStop[] | null | undefined, id: string): PassengerStop | null {
  if (!stops) return null;
  for (let i = 0; i < stops.length; i++) if (stops[i].id === id) return stops[i];
  return null;
}

/* ================================================================== the tip */

/** What a final mood tips: nothing at or under the floor, `maxTip` at 100, straight between. */
export function tipFor(mood: number): number {
  const r = PASSENGER.reward;
  const t = (mood - r.tipFloor) / (100 - r.tipFloor);
  if (t <= 0) return 0;
  return Math.round((Math.min(1, t) * r.maxTip) / 10) * 10;
}

export function farewellTier(mood: number): 'high' | 'medium' | 'low' {
  if (mood >= PASSENGER.mood.highTier) return 'high';
  if (mood >= PASSENGER.mood.mediumTier) return 'medium';
  return 'low';
}

/* ================================================================== dialogue */

/** A small deterministic generator, so which variant plays is repeatable in a test. */
function nextRandom(s: PassengerState): number {
  // xorshift32
  let x = s.seed | 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  s.seed = x | 0;
  return ((x >>> 0) % 10_000) / 10_000;
}

/** One of `lines`, never the one just said when there is a choice. '' for no lines. */
export function pickLine(s: PassengerState, lines: readonly string[] | undefined): string {
  if (!lines || lines.length === 0) return '';
  if (lines.length === 1) return lines[0];
  let i = Math.floor(nextRandom(s) * lines.length) % lines.length;
  if (lines[i] === s.lastText) i = (i + 1) % lines.length;
  return lines[i];
}

/** How long a line stays up: a floor, a little per character, a ceiling. */
export function lineSeconds(text: string): number {
  const d = PASSENGER.dialogue;
  return Math.min(d.maxSeconds, d.minSeconds + text.length * d.secondsPerChar);
}

function enqueue(s: PassengerState, text: string, kind: PassengerLineKind, time: number): void {
  if (!text) return;
  const expires = kind === 'reaction' ? time + PASSENGER.dialogue.reactionStale : NEVER;
  const priority = PRIORITY[kind];
  if (s.queue.length >= QUEUE_CAP) {
    // Full: drop the lowest-priority, oldest waiter — unless the newcomer is lower still.
    let drop = 0;
    for (let i = 1; i < s.queue.length; i++) if (s.queue[i].priority < s.queue[drop].priority) drop = i;
    if (s.queue[drop].priority > priority) return;
    s.queue.splice(drop, 1);
  }
  s.queue.push({ text, kind, priority, expires });
}

/** Forget every incidental remark still waiting. The moment has passed. */
function dropReactions(s: PassengerState): void {
  for (let i = s.queue.length - 1; i >= 0; i--) if (s.queue[i].kind === 'reaction') s.queue.splice(i, 1);
}

/** Say something incidental, if the passenger is not already talking too much. */
function react(s: PassengerState, def: PassengerDef, reaction: PassengerReaction, time: number): void {
  if (s.reactionCooldown > 0) return;
  const text = pickLine(s, def.reactions[reaction]);
  if (!text) return;
  s.reactionCooldown = PASSENGER.dialogue.reactionCooldown;
  enqueue(s, text, 'reaction', time);
}

/** Advance the subtitle clock and start the next line when the screen is free. */
function stepDialogue(s: PassengerState, def: PassengerDef | null, dt: number, time: number, events: GameEvent[]): void {
  if (s.reactionCooldown > 0) s.reactionCooldown = Math.max(0, s.reactionCooldown - dt);
  if (s.speedLineCooldown > 0) s.speedLineCooldown = Math.max(0, s.speedLineCooldown - dt);
  if (s.lineTimeLeft > 0) {
    s.lineTimeLeft -= dt;
    if (s.lineTimeLeft <= 0) {
      // The gap: the line comes down now, the next one waits `gapSeconds`.
      s.line = '';
      s.lineTimeLeft = -PASSENGER.dialogue.gapSeconds;
    }
    return;
  }
  if (s.lineTimeLeft < 0) {
    s.lineTimeLeft = Math.min(0, s.lineTimeLeft + dt);
    if (s.lineTimeLeft < 0) return;
  }
  // Free. Drop anything stale, then take the highest priority (oldest first among equals).
  for (let i = s.queue.length - 1; i >= 0; i--) if (s.queue[i].expires <= time) s.queue.splice(i, 1);
  if (s.queue.length === 0 || !def) return;
  let at = 0;
  for (let i = 1; i < s.queue.length; i++) if (s.queue[i].priority > s.queue[at].priority) at = i;
  const next = s.queue[at];
  s.queue.splice(at, 1);
  s.line = next.text;
  s.lineKind = next.kind;
  s.lineId += 1;
  s.lineTimeLeft = lineSeconds(next.text);
  s.lastText = next.text;
  events.push({ type: 'passengerLine', passengerId: def.id, text: next.text, kind: next.kind });
}

/* ================================================================== the mood */

function clampMood(v: number): number {
  return v < 0 ? 0 : v > 100 ? 100 : v;
}

/** A discrete gain, against the ride's event ceiling. Returns what was actually added. */
function gainEvent(s: PassengerState, amount: number, reason: PassengerReaction, events: GameEvent[]): number {
  const room = PASSENGER.mood.maxEventGain - s.eventGain;
  const add = Math.max(0, Math.min(amount, room));
  if (add <= 0) return 0;
  s.eventGain += add;
  s.mood = clampMood(s.mood + add);
  s.bonuses += 1;
  events.push({ type: 'passengerMood', delta: add, reason });
  return add;
}

/** A discrete loss. Not capped; the mood floors at 0. */
function loseEvent(s: PassengerState, amount: number, reason: PassengerReaction, events: GameEvent[]): void {
  if (amount <= 0) return;
  s.mood = clampMood(s.mood - amount);
  s.penalties += 1;
  events.push({ type: 'passengerMood', delta: -amount, reason });
}

/** A continuous gain, against the ride's flow ceiling. */
function gainFlow(s: PassengerState, perSecond: number, dt: number): void {
  const room = PASSENGER.mood.maxFlowGain - s.flowGain;
  const add = Math.max(0, Math.min(perSecond * dt, room));
  if (add <= 0) return;
  s.flowGain += add;
  s.mood = clampMood(s.mood + add);
}

/**
 * The continuous rules, one tick's worth. Only while the car is actually moving: a stopped car
 * is a car at a light, a pickup or a drop-off, and none of those is anybody's fault.
 */
function stepPreferences(s: PassengerState, def: PassengerDef, v: VehicleState, drift: DriftState, dt: number, time: number): void {
  const sp = PASSENGER.speed;
  const kmh = Math.abs(msToKmh(v.speed));
  const moving = Math.abs(v.speed) > sp.movingSpeed;
  let satisfiedSpeed = false;
  let hasSpeedRule = false;

  for (let i = 0; i < 2; i++) {
    const pref = def.preferences[i];
    let status: PassengerPreferenceStatus = 'neutral';
    if (pref) {
      switch (pref.kind) {
        case 'slow': {
          hasSpeedRule = true;
          const limit = pref.kmh ?? 0;
          if (moving && kmh > limit) {
            const wasOver = s.overTime > sp.limitGraceSeconds;
            s.overTime += dt;
            if (s.overTime > sp.limitGraceSeconds) {
              status = 'bad';
              s.mood = clampMood(s.mood - sp.overDrainPerSecond * pref.weight * dt);
              // The nag, once, when the grace is crossed — not every tick over the limit.
              if (!wasOver && s.speedLineCooldown <= 0) {
                s.speedLineCooldown = PASSENGER.dialogue.speedLineCooldown;
                react(s, def, 'tooFast', time);
              }
            }
          } else {
            s.overTime = 0;
            if (moving) {
              status = 'good';
              satisfiedSpeed = true;
              gainFlow(s, sp.calmGainPerSecond * pref.weight, dt);
            }
          }
          break;
        }
        case 'fast': {
          hasSpeedRule = true;
          const threshold = pref.kmh ?? sp.fastKmh;
          if (kmh >= threshold) {
            s.slowTime = 0;
            status = 'good';
            satisfiedSpeed = true;
            gainFlow(s, sp.fastGainPerSecond * pref.weight, dt);
          } else if (moving && kmh < threshold * sp.dawdleShare) {
            const wasSlow = s.slowTime > sp.slowGraceSeconds;
            s.slowTime += dt;
            if (s.slowTime > sp.slowGraceSeconds) {
              status = 'bad';
              s.mood = clampMood(s.mood - sp.slowDrainPerSecond * pref.weight * dt);
              if (!wasSlow && s.speedLineCooldown <= 0) {
                s.speedLineCooldown = PASSENGER.dialogue.speedLineCooldown;
                react(s, def, 'tooSlow', time);
              }
            }
          }
          // Between the two (a fast corner, a quick stop) and standing still: nothing, and the
          // dawdle clock holds rather than resets, so it cannot be dodged by tapping the brake.
          break;
        }
        case 'noDrift':
          if (drift.active && drift.duration >= PASSENGER.drift.minSeconds) status = 'bad';
          break;
        case 'drift':
          if (drift.active && drift.duration >= PASSENGER.drift.minSeconds) status = 'good';
          break;
        case 'rayo':
        case 'noRayo':
          // Discrete only: the status flashes with the event, below.
          break;
        default:
          break;
      }
    }
    s.prefStatus[i] = status;
  }

  // "This is nice": after a stretch of the speed they asked for, once in a while.
  if (hasSpeedRule) {
    if (satisfiedSpeed) {
      s.goodStreak += dt;
      if (s.goodStreak >= sp.goodStreakSeconds) {
        s.goodStreak = 0;
        if (s.speedLineCooldown <= 0) {
          s.speedLineCooldown = PASSENGER.dialogue.speedLineCooldown;
          react(s, def, 'goodSpeed', time);
        }
      }
    } else if (!moving) {
      // Holding at a stop does not break the streak; driving badly does.
    } else {
      s.goodStreak = 0;
    }
  }
}

/** Which preference slot, if any, is of this kind. -1 when the character does not have it. */
function prefIndex(def: PassengerDef, kind: PassengerDef['preferences'][number]['kind']): number {
  for (let i = 0; i < def.preferences.length; i++) if (def.preferences[i].kind === kind) return i;
  return -1;
}

/**
 * The discrete rules: this tick's events, read up to the length they had when the tick got
 * here, so nothing this function pushes is ever read back by it.
 */
function stepEvents(s: PassengerState, def: PassengerDef, targets: readonly TargetState[], time: number, events: GameEvent[]): void {
  const incoming = events.length;
  const d = PASSENGER.drift;
  const wantsDrift = prefIndex(def, 'drift');
  const hatesDrift = prefIndex(def, 'noDrift');
  const wantsRayo = prefIndex(def, 'rayo');
  const hatesRayo = prefIndex(def, 'noRayo');

  for (let i = 0; i < incoming; i++) {
    const ev = events[i];
    switch (ev.type) {
      case 'driftEnd': {
        if (ev.duration < d.minSeconds) break;
        if (wantsDrift >= 0 && s.driftCooldown <= 0) {
          s.driftCooldown = d.cooldown;
          const w = def.preferences[wantsDrift].weight;
          const amount = Math.min(d.bonusMax, d.bonus + d.bonusPerSecond * ev.duration) * w;
          if (gainEvent(s, amount, 'driftGood', events) > 0) react(s, def, 'driftGood', time);
        }
        if (hatesDrift >= 0 && s.driftCooldown <= 0) {
          s.driftCooldown = d.penaltyCooldown;
          loseEvent(s, d.penalty * def.preferences[hatesDrift].weight, 'driftBad', events);
          react(s, def, 'driftBad', time);
        }
        break;
      }
      case 'targetDestroyed': {
        // Only the lightning raises this here, and only the player's own (a rival's kill in the
        // open world never becomes an event on this client — see `src/sim/traffic.ts`). Once
        // per car per ride, whatever it respawns into.
        const id = ev.targetId;
        if (id < 0 || id >= s.counted.length || s.counted[id] === 1) break;
        const target = targets[id];
        if (target && target.id !== id) break;
        s.counted[id] = 1;
        if (wantsRayo >= 0) {
          if (s.rayoCooldown <= 0) {
            s.rayoCooldown = PASSENGER.rayo.cooldown;
            if (gainEvent(s, PASSENGER.rayo.bonus * def.preferences[wantsRayo].weight, 'rayoGood', events) > 0) {
              react(s, def, 'rayoGood', time);
            }
          }
          s.prefStatus[wantsRayo] = 'good';
        }
        if (hatesRayo >= 0) {
          loseEvent(s, PASSENGER.rayo.penalty * def.preferences[hatesRayo].weight, 'rayoBad', events);
          react(s, def, 'rayoBad', time);
          s.prefStatus[hatesRayo] = 'bad';
        }
        break;
      }
      case 'collision': {
        const c = PASSENGER.collision;
        if (ev.impact < c.minImpact || s.collisionCooldown > 0) break;
        s.collisionCooldown = c.cooldown;
        loseEvent(s, c.penalty, 'collision', events);
        react(s, def, 'collision', time);
        break;
      }
      default:
        break;
    }
  }
}

/* ================================================================== the ride */

/** Whether pressing the key here would board. Presentation asks this too. */
export function canBoard(s: PassengerState): boolean {
  return s.phase === 'offered' && s.atPickup && !s.locked;
}

/** Whether pressing the key here would end the ride with a fare. */
export function canDropOff(s: PassengerState): boolean {
  return s.phase === 'riding' && s.atDestination;
}

/** The pin goes up. Returns false when there is nothing to offer in this world. */
export function offerRide(
  s: PassengerState,
  catalog: readonly PassengerDef[],
  stops: readonly PassengerStop[],
  v: VehicleState,
  events: GameEvent[],
): boolean {
  const trip = planTrip(catalog, stops, s.offers, v.x, v.z);
  if (!trip) {
    s.offerIn = PASSENGER.offer.reofferSeconds;
    return false;
  }
  s.offers += 1;
  s.trip = trip;
  s.phase = 'offered';
  s.atPickup = false;
  s.atDestination = false;
  events.push({ type: 'passengerOffer', passengerId: trip.passengerId, stopId: trip.pickupId });
  return true;
}

/** They get in. The opening and the brief go on the queue; the destination is now the thing. */
export function boardPassenger(s: PassengerState, def: PassengerDef, destination: PassengerStop, time: number, events: GameEvent[]): boolean {
  if (!canBoard(s) || !s.trip) return false;
  clearRide(s);
  s.phase = 'riding';
  s.cancelArm = 0;
  s.atDestination = false;
  enqueue(s, def.openings[s.trip.opening] ?? def.openings[0] ?? '', 'opening', time);
  enqueue(s, resolveLine(def.brief, destination.label), 'brief', time);
  events.push({ type: 'passengerBoard', passengerId: def.id, destinationId: destination.id });
  return true;
}

/** The drop-off. Freezes the ride into results and raises the one event the fare is paid on. */
export function completeRide(s: PassengerState, def: PassengerDef, destination: PassengerStop, time: number, events: GameEvent[]): boolean {
  if (!canDropOff(s) || !s.trip) return false;
  const mood = Math.round(s.mood);
  const tier = farewellTier(mood);
  const results: PassengerResults = {
    passengerId: def.id,
    passengerName: def.name,
    destinationLabel: destination.label,
    mood,
    tier,
    fare: s.trip.fare,
    tip: tipFor(mood),
    bonuses: s.bonuses,
    penalties: s.penalties,
  };
  s.phase = 'results';
  s.results = results;
  s.resultsHold = PASSENGER.resultsHoldSeconds;
  s.cancelArm = 0;
  // Whatever they were about to say about the driving no longer matters; the farewell does.
  dropReactions(s);
  s.line = '';
  s.lineTimeLeft = 0;
  enqueue(s, pickLine(s, def.farewell[tier]), 'farewell', time);
  events.push({ type: 'passengerComplete', results });
  return true;
}

/** The ride ends without a drop-off. Nothing is paid; the next pin waits the usual time. */
export function cancelRide(s: PassengerState, reason: 'player' | 'restart' | 'respawn', events: GameEvent[]): boolean {
  if (s.phase !== 'riding' || !s.trip) return false;
  const id = s.trip.passengerId;
  s.phase = 'idle';
  s.trip = null;
  s.offerIn = PASSENGER.offer.reofferSeconds;
  s.cancelArm = 0;
  s.atDestination = false;
  clearRide(s);
  events.push({ type: 'passengerCancel', passengerId: id, reason });
  return true;
}

/** The fare card is put away. */
export function dismissPassenger(s: PassengerState, events: GameEvent[]): boolean {
  if (s.phase !== 'results') return false;
  s.phase = 'idle';
  s.trip = null;
  s.results = null;
  s.resultsHold = 0;
  s.offerIn = PASSENGER.offer.reofferSeconds;
  clearRide(s);
  events.push({ type: 'passengerDismissed' });
  return true;
}

/**
 * Whether the car is inside a zone: within the radius, with hysteresis on the way out.
 *
 * THE PAINT IS THE TRIGGER, exactly as it is for RAYO RUSH (`src/sim/rush.ts`) — rolling onto
 * the ring raises the prompt on that tick and rolling off it drops it, with nothing else in
 * between. It used to also ask the car to be stopped, which read as the prompt lagging: the
 * player was standing on the paint with nothing on screen until the speed bled off.
 */
function inZone(v: VehicleState, stop: PassengerStop, was: boolean): boolean {
  const m = PASSENGER.marker;
  const dx = v.x - stop.x;
  const dz = v.z - stop.z;
  const limit = was ? m.exitRadius : m.promptRadius;
  return dx * dx + dz * dz <= limit * limit;
}

/** Whether the car is within the radius at all, moving or not. For the arrival line. */
function nearStop(v: VehicleState, stop: PassengerStop): boolean {
  const r = PASSENGER.marker.exitRadius * 2;
  const dx = v.x - stop.x;
  const dz = v.z - stop.z;
  return dx * dx + dz * dz <= r * r;
}

/**
 * One tick of the activity. `events` already carries what the rest of the tick raised
 * (`driftEnd`, `collision`, `targetDestroyed`); it is read up to its length on entry and
 * appended to. `time` is sim time, the only clock the dialogue queue has.
 */
export function stepPassenger(
  s: PassengerState,
  catalog: readonly PassengerDef[],
  stops: readonly PassengerStop[],
  v: VehicleState,
  drift: DriftState,
  cmd: PlayerCommand,
  targets: readonly TargetState[],
  dt: number,
  time: number,
  events: GameEvent[],
): void {
  const wasBoardable = canBoard(s);
  const wasDroppable = canDropOff(s);
  const trip = s.trip;
  const def = trip ? catalogEntry(catalog, trip.passengerId) : null;
  const pickup = trip ? stopById(stops, trip.pickupId) : null;
  const destination = trip ? stopById(stops, trip.destinationId) : null;

  if (s.driftCooldown > 0) s.driftCooldown = Math.max(0, s.driftCooldown - dt);
  if (s.rayoCooldown > 0) s.rayoCooldown = Math.max(0, s.rayoCooldown - dt);
  if (s.collisionCooldown > 0) s.collisionCooldown = Math.max(0, s.collisionCooldown - dt);
  if (s.cancelArm > 0) s.cancelArm = Math.max(0, s.cancelArm - dt);
  // The fare card puts itself away, same as the rush results do: the farewell has been read
  // long before this runs out, and a card left up is a world the player cannot drive.
  if (s.phase === 'results' && s.resultsHold > 0) {
    s.resultsHold = Math.max(0, s.resultsHold - dt);
    if (s.resultsHold === 0) dismissPassenger(s, events);
  }

  /* ------------------------------------------------------------ where the car is */

  if (s.phase === 'offered' && pickup) s.atPickup = inZone(v, pickup, s.atPickup);
  else s.atPickup = false;
  if (s.phase === 'riding' && destination) {
    s.atDestination = inZone(v, destination, s.atDestination);
    if (!s.arrivalSaid && def && nearStop(v, destination)) {
      s.arrivalSaid = true;
      dropReactions(s);
      enqueue(s, def.arrival, 'arrival', time);
    }
  } else {
    s.atDestination = false;
  }

  /* ------------------------------------------------------------ one button */

  if (cmd.activate) {
    if (s.phase === 'results') dismissPassenger(s, events);
    else if (s.phase === 'offered' && def && destination) boardPassenger(s, def, destination, time, events);
    else if (s.phase === 'riding' && def && destination) {
      if (canDropOff(s)) completeRide(s, def, destination, time, events);
      else if (s.cancelArm > 0) cancelRide(s, 'player', events);
      else s.cancelArm = PASSENGER.cancelArmSeconds;
    }
  }

  /* ------------------------------------------------------------ the offer */

  if (s.phase === 'idle') {
    s.offerIn -= dt;
    if (s.offerIn <= 0 && !s.locked) offerRide(s, catalog, stops, v, events);
  }

  /* ------------------------------------------------------------ the ride */

  if (s.phase === 'riding' && def) {
    // A drop-off zone is a stop; the rules above are for the road between.
    if (!s.atDestination) stepPreferences(s, def, v, drift, dt, time);
    else {
      s.prefStatus[0] = 'neutral';
      s.prefStatus[1] = 'neutral';
    }
    stepEvents(s, def, targets, time, events);
  }

  stepDialogue(s, def, dt, time, events);

  /* ------------------------------------------------------------ the prompts */

  const boardable = canBoard(s);
  if (boardable !== wasBoardable) events.push({ type: 'passengerPrompt', on: boardable });
  const droppable = canDropOff(s);
  if (droppable !== wasDroppable) events.push({ type: 'passengerDropPrompt', on: droppable });
}

function catalogEntry(catalog: readonly PassengerDef[], id: string): PassengerDef | null {
  for (let i = 0; i < catalog.length; i++) if (catalog[i].id === id) return catalog[i];
  return null;
}
