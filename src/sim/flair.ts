import type { DriftState, FlairMessageId, FlairState, FlairTier, GameEvent } from '../core/types';
import { FLAIR } from '../config/tuning';

/**
 * FLAIR: the game shouting at the player when the driving earns it.
 *
 * WHAT IT IS NOT. It is not a detector. It does not know what a near miss is, it does not know
 * what makes a slide a drift, and it does not know what makes contact a crash — `nearMiss.ts`,
 * `drift.ts` and `collision.ts` decided all three long before this module is called, and this
 * module only reads what they already said. Nothing here may be tuned to make a manoeuvre
 * count more easily; there is no second opinion about any of it. `FLAIR` is the only tuning
 * block it reads — `NEAR_MISS`, `DRIFT` and the collision numbers are not its business.
 *
 * WHAT IT IS. Three things, deliberately separate and in this order:
 *
 *   1. THE STREAK — the only state of its own it keeps. Near misses and held drift both feed
 *      one internal unit count, so that "a couple of shaves and a long slide" is a bigger deal
 *      than either alone. The units are private: they are not a score, not a multiplier, and
 *      nothing draws them. A crash cuts the streak; five quiet seconds end it.
 *   2. SELECTION — which phrases QUALIFY on this tick. Several can at once (a drift milestone
 *      and a combo landing together), so qualification is a bitmask, not a single answer.
 *   3. ARBITRATION — which one actually gets the screen. One phrase at a time, a gap between
 *      celebrations, no repeat of a phrase inside ten seconds, and at most ONE candidate held
 *      through the gap. Never a queue: a compliment that arrives four seconds late is about a
 *      corner the player has already forgotten.
 *
 * PRIORITY IS THE INDEX. `MESSAGES` runs from the smallest phrase to the biggest, so "which of
 * these wins" is `>`, and "consume the smaller ones that also qualified" is a bitmask OR. The
 * crash line sits at the top of that order, which is what makes it interrupt a celebration
 * without needing a rule of its own.
 *
 * THE AURA LINES ARE TALK. "AURA +1000" and "−1000 DE AURA" move no money, no points and no
 * progress; nothing in this file touches `src/sim/economy.ts` or the run's score.
 *
 * TIME. Simulation time throughout (`GameState.time`), so every timer here stops dead when the
 * game does — the loop simply stops stepping, and nothing has a clock of its own to run on.
 *
 * Pure data in, pure data out. No DOM, no audio, no Three.js, and nothing allocates per tick.
 */

/** A phrase: its id, the words, and how loudly it is drawn. */
export interface FlairMessage {
  id: FlairMessageId;
  text: string;
  tier: FlairTier;
}

/**
 * The eleven phrases, LOWEST PRIORITY FIRST. The order is the priority table from the brief,
 * read upside down, and the index is used directly as the priority — see the module note.
 * `finito` and `conPermiso` share a rung; only one of them is ever a candidate.
 */
export const MESSAGES: readonly FlairMessage[] = [
  { id: 'finito', text: 'FINITO', tier: 'common' },
  { id: 'conPermiso', text: 'CON PERMISO', tier: 'common' },
  { id: 'deCostado', text: 'DE COSTADO', tier: 'common' },
  { id: 'conEstilo', text: 'CON ESTILO', tier: 'common' },
  { id: 'puraSeda', text: 'PURA SEDA', tier: 'special' },
  { id: 'auraPlus', text: 'AURA +1000', tier: 'special' },
  { id: 'laCalleEsTuya', text: 'LA CALLE ES TUYA', tier: 'special' },
  { id: 'faltandoElRespeto', text: 'FALTANDO EL RESPETO', tier: 'special' },
  { id: 'aPuroBandidaje', text: 'A PURO BANDIDAJE', tier: 'special' },
  { id: 'auraInfinita', text: 'AURA INFINITA', tier: 'peak' },
  // The minus is U+2212, not a hyphen: it is a number being taken away, and it is set in the
  // display face beside "+1000".
  { id: 'auraMenos', text: '−1000 DE AURA', tier: 'crash' },
];

/** Index of a phrase in `MESSAGES`, which is also its priority. -1 for an unknown id. */
export function flairIndex(id: FlairMessageId): number {
  for (let i = 0; i < MESSAGES.length; i++) if (MESSAGES[i].id === id) return i;
  return -1;
}

const FINITO = flairIndex('finito');
const CON_PERMISO = flairIndex('conPermiso');
const AURA_PLUS = flairIndex('auraPlus');
const FALTANDO = flairIndex('faltandoElRespeto');
const BANDIDAJE = flairIndex('aPuroBandidaje');
const INFINITA = flairIndex('auraInfinita');
const CRASH = flairIndex('auraMenos');

/**
 * The drift milestones as indices, resolved once at module load so the per-tick path never
 * looks a string up. Same order as `FLAIR.driftMilestones`, which is ascending by seconds.
 */
const MILESTONES: number[] = FLAIR.driftMilestones.map((m) => flairIndex(m.message as FlairMessageId));
/** Bitmask of the drift milestones, so arbitration can tell one from a streak line. */
const MILESTONE_MASK = MILESTONES.reduce((mask, index) => mask | (1 << index), 0);

/** Seconds a phrase of this tier stays on screen. */
export function flairSeconds(tier: FlairTier): number {
  if (tier === 'crash') return FLAIR.show.crashSeconds;
  return tier === 'common' ? FLAIR.show.commonSeconds : FLAIR.show.specialSeconds;
}

export function createFlairState(): FlairState {
  return {
    streak: false,
    units: 0,
    nearMisses: 0,
    driftSeconds: 0,
    idle: 0,
    said: 0,
    peaked: false,
    serial: 0,
    driftWasActive: false,
    driftMilestones: 0,
    shownAt: -Infinity,
    crashAt: -Infinity,
    lastSaid: new Float64Array(MESSAGES.length).fill(-Infinity),
    pending: -1,
    pendingAt: 0,
    pendingSerial: -1,
    pendingDrift: false,
    lastOpener: -1,
  };
}

/** Everything back to boot: a restart, or leaving the game. Keeps the one allocated array. */
export function resetFlairState(f: FlairState): void {
  endStreak(f);
  f.serial = 0;
  f.driftWasActive = false;
  f.driftMilestones = 0;
  f.shownAt = -Infinity;
  f.crashAt = -Infinity;
  f.lastSaid.fill(-Infinity);
  f.lastOpener = -1;
}

/**
 * The streak is over: its counters, its spent messages and any candidate it was holding go
 * with it. Bumping the serial is what tells a candidate raised by the old streak that it no
 * longer has anything to celebrate.
 */
function endStreak(f: FlairState): void {
  f.streak = false;
  f.units = 0;
  f.nearMisses = 0;
  f.driftSeconds = 0;
  f.idle = 0;
  f.said = 0;
  f.peaked = false;
  f.serial++;
  dropCandidate(f);
}

function dropCandidate(f: FlairState): void {
  f.pending = -1;
  f.pendingAt = 0;
  f.pendingSerial = -1;
  f.pendingDrift = false;
}

/** Start a streak if there is not one already. A manoeuvre is what opens one; nothing else. */
function openStreak(f: FlairState): void {
  if (f.streak) return;
  f.streak = true;
  f.units = 0;
  f.nearMisses = 0;
  f.driftSeconds = 0;
  f.idle = 0;
  f.said = 0;
  f.peaked = false;
  f.serial++;
}

/** Put a phrase on the glass now. The only place a `flair` event is raised. */
function say(f: FlairState, index: number, time: number, events: GameEvent[]): void {
  const m = MESSAGES[index];
  f.lastSaid[index] = time;
  f.shownAt = time;
  dropCandidate(f);
  if (FLAIR.debug) console.info(`[flair] ${m.text} @${time.toFixed(2)}`);
  events.push({ type: 'flair', id: m.id, text: m.text, tier: m.tier, seconds: flairSeconds(m.tier) });
}

/**
 * A phrase has qualified and won its tick. Show it if the screen is free, hold it if the gap
 * has not run out, and drop it entirely if it would repeat itself inside `repeatSeconds`.
 *
 * Holding keeps exactly one candidate — the better of the two — because a queue would turn a
 * good thirty seconds into a monologue delivered over the following minute.
 */
function offer(f: FlairState, index: number, time: number, events: GameEvent[]): void {
  if (time - f.lastSaid[index] < FLAIR.show.repeatSeconds) return;
  if (time - f.shownAt >= FLAIR.show.gapSeconds) {
    say(f, index, time, events);
    return;
  }
  if (f.pending >= index) return;
  f.pending = index;
  f.pendingAt = time;
  f.pendingSerial = f.serial;
  f.pendingDrift = (MILESTONE_MASK & (1 << index)) !== 0;
}

/**
 * One tick of the flair.
 *
 * `active` is the caller's answer to "should the game be shouting right now" — a RAYO RUSH run
 * actually being driven, and the local car. It is asked every tick rather than captured,
 * because a run ending has to take the streak and any held candidate with it.
 *
 * `eventCount` is the length of `events` BEFORE this call, so the near misses and collisions
 * this tick raised are read and the flair raised here is never read back.
 */
export function stepFlair(
  f: FlairState,
  drift: DriftState,
  active: boolean,
  time: number,
  dt: number,
  events: GameEvent[],
  eventCount: number,
): void {
  if (!active) {
    // Nothing said, nothing held, nothing counting. The anti-repeat memory survives: it is
    // about the player's ears, not about the run.
    if (f.streak || f.pending >= 0) endStreak(f);
    f.driftWasActive = false;
    f.driftMilestones = 0;
    return;
  }

  /* ------------------------------------------------------- what the tick already decided */

  let crashed = false;
  let nearMisses = 0;
  for (let i = 0; i < eventCount; i++) {
    const ev = events[i];
    // The severity the collision pass already measured: speed into the contact normal. A soft
    // lateral scrape reports a fraction of a metre per second and is not a crash; driving into
    // a barrier reports the speed it was done at.
    if (ev.type === 'collision') {
      if (ev.impact >= FLAIR.crash.impactSpeed) crashed = true;
    } else if (ev.type === 'nearMiss') {
      nearMisses++;
    }
  }

  /* ------------------------------------------------------------------------- the crash */

  if (crashed) {
    // Highest priority there is, so it takes the screen off whatever was on it and throws
    // away whatever was waiting for it. Only worth saying about a streak that was worth
    // losing — an isolated thump into a bollard is not a joke, it is just a thump.
    const worthIt = f.streak && f.units >= FLAIR.crash.minUnits;
    endStreak(f);
    if (worthIt && time - f.crashAt >= FLAIR.crash.cooldownSeconds) {
      f.crashAt = time;
      say(f, CRASH, time, events);
    }
  }

  /* ------------------------------------------------------------------------- the drift */

  // Start and end are the existing drift's, never this module's: `active` is the flag
  // `src/sim/drift.ts` maintains, and `duration` is the clock it keeps.
  const drifting = drift.active;
  if (drifting && !f.driftWasActive) f.driftMilestones = 0;
  f.driftWasActive = drifting;

  if (drifting) {
    openStreak(f);
    f.units += FLAIR.streak.driftUnitsPerSecond * dt;
    f.driftSeconds += dt;
    // A held drift IS the manoeuvre: the streak cannot time out underneath one.
    f.idle = 0;
  }

  /* --------------------------------------------------------------------- the near miss */

  // A near miss taken while the slide is already `disrespectDriftSeconds` old, read off the
  // drift's own duration on the tick the pass was paid.
  const insideDrift = drifting && drift.duration >= FLAIR.combo.disrespectDriftSeconds;
  let opened = false;
  if (nearMisses > 0) {
    opened = !f.streak || f.nearMisses === 0;
    openStreak(f);
    f.nearMisses += nearMisses;
    f.units += nearMisses * FLAIR.streak.nearMissUnits;
    f.idle = 0;
  }

  /* ------------------------------------------------------------ the streak running out */

  if (f.streak && !drifting && nearMisses === 0) {
    f.idle += dt;
    if (f.idle >= FLAIR.streak.idleSeconds) endStreak(f);
  }

  /* ---------------------------------------------------------------------- what qualifies */

  // Asked every tick rather than only on the tick a unit threshold is crossed, so the mixed
  // conditions are re-checked whenever any of their components moved — which is the only way
  // A PURO BANDIDAJE can land on the drift second that completes it rather than waiting for
  // the next near miss to come along and notice.
  let qualified = 0;
  if (f.streak && !f.peaked) {
    if (drifting) {
      for (let i = 0; i < MILESTONES.length; i++) {
        const bit = 1 << i;
        if (f.driftMilestones & bit) continue;
        // Ascending by seconds, so the first one that is not due yet ends the search.
        if (drift.duration < FLAIR.driftMilestones[i].seconds) break;
        // Spent for THIS drift, whether or not it ends up being the line that is said: a
        // milestone the player earned while a bigger phrase was on screen has still happened.
        f.driftMilestones |= bit;
        qualified |= 1 << MILESTONES[i];
      }
    }
    if (opened) {
      // The two openers alternate, so a run of short streaks does not say one word all night.
      const opener = f.lastOpener === FINITO ? CON_PERMISO : FINITO;
      f.lastOpener = opener;
      qualified |= 1 << opener;
    }
    if (nearMisses > 0 && insideDrift && !(f.said & (1 << FALTANDO))) qualified |= 1 << FALTANDO;
    if (f.nearMisses >= FLAIR.combo.auraNearMisses && !(f.said & (1 << AURA_PLUS))) qualified |= 1 << AURA_PLUS;
    const b = FLAIR.combo.bandidaje;
    if (
      f.units >= b.units &&
      f.nearMisses >= b.nearMisses &&
      f.driftSeconds >= b.driftSeconds &&
      !(f.said & (1 << BANDIDAJE))
    ) {
      qualified |= 1 << BANDIDAJE;
    }
    if (f.units >= FLAIR.combo.infinite.units && !(f.said & (1 << INFINITA))) qualified |= 1 << INFINITA;
  }

  if (qualified !== 0) {
    // Everything that qualified is spent here, not only the winner. That is the whole of "do
    // not let DE COSTADO turn up four seconds after A PURO BANDIDAJE already said it better".
    f.said |= qualified;
    let best = -1;
    for (let i = MESSAGES.length - 1; i >= 0; i--) {
      if (qualified & (1 << i)) {
        best = i;
        break;
      }
    }
    if (best === INFINITA) {
      // The ceiling. Nothing smaller is said again until this streak is over, and anything
      // already waiting to be said is smaller by definition.
      f.peaked = true;
      dropCandidate(f);
    }
    if (best >= 0) offer(f, best, time, events);
  }

  /* --------------------------------------------------------- the one candidate, if any */

  if (f.pending >= 0) {
    const stale = time - f.pendingAt > FLAIR.show.candidateSeconds;
    const orphaned = !f.streak || f.pendingSerial !== f.serial;
    // A drift milestone off the drift it belongs to no longer means anything.
    const pointless = f.pendingDrift && !drifting;
    if (stale || orphaned || pointless) dropCandidate(f);
    else if (time - f.shownAt >= FLAIR.show.gapSeconds) say(f, f.pending, time, events);
  }
}
