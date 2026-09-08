import { RUSH } from '../config/tuning';

/**
 * What this browser remembers about a player between sessions — today, only how far they have
 * got through the RAYO RUSH mission chain and what they scored on each one.
 *
 * WHY IT IS ITS OWN MODULE. `src/net/leaderboard.ts` already keeps a personal best in
 * localStorage, but it keeps it as a MIRROR of something the server owns: the board is the
 * truth and the local copy exists so the prompt has a number before the network answers. This
 * is the opposite. Mission progress has no server behind it and is not going to have one soon;
 * the browser IS the record. Mixing the two would mean a module whose values sometimes have an
 * authority and sometimes do not, and the first thing to go wrong would be a mission un-clearing
 * itself because a fetch failed.
 *
 * So: no network, no fetch, no promises, nothing to wait for. `read` answers from storage or
 * from nothing, `write` tries and shrugs. That is also what makes this the seam to cut when
 * there IS a database — every reader below goes through these two functions, and a player's
 * progress never travels any other way.
 *
 * EVERYTHING READ BACK IS UNTRUSTED. It is a string a user can edit, in a browser that may have
 * been running a different build of this game last week. `read` therefore never returns anything
 * the rest of the code has to check: the shape is rebuilt field by field, counts are clamped to
 * the chain that exists NOW (shortening `RUSH.levels` cannot leave a player past the end of it),
 * and anything unparseable is simply a player who has not started.
 */

const PROGRESS_KEY = 'rb.rush.missions';

export interface RushProgress {
  /** Missions finished, 0..`RUSH.levels.length`. */
  cleared: number;
  /**
   * Best score on each mission, `-1` where it has never been run. Always exactly as long as
   * `RUSH.levels`, so a caller may index it by level without checking.
   */
  best: number[];
}

/** A player who has just arrived. Also what a corrupt or absent record reads as. */
export function emptyRushProgress(): RushProgress {
  return { cleared: 0, best: RUSH.levels.map(() => -1) };
}

function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    // Private browsing, a sandboxed frame, or storage disabled outright.
    return null;
  }
}

function writeRaw(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage full or unavailable: the session still plays, it just forgets */
  }
}

/** A stored count made safe: a whole number no bigger than the chain that exists now. */
function clampCleared(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(RUSH.levels.length, Math.floor(n));
}

/** A stored score made safe: a whole number, or -1 for "never run". */
function clampScore(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return -1;
  return Math.floor(n);
}

/**
 * What this browser knows. Never throws and never returns a partial record: the result is
 * always a whole `RushProgress` with `best` the length of the mission chain.
 */
export function readRushProgress(): RushProgress {
  const raw = readRaw(PROGRESS_KEY);
  if (!raw) return emptyRushProgress();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyRushProgress();
  }
  if (!parsed || typeof parsed !== 'object') return emptyRushProgress();
  const record = parsed as { cleared?: unknown; best?: unknown };
  const storedBest = Array.isArray(record.best) ? record.best : [];
  // Rebuilt against the CURRENT chain rather than trusted at whatever length it was written:
  // adding a fourth mission must not leave `best` one short of what callers index into it by.
  const best = RUSH.levels.map((_, i) => clampScore(storedBest[i]));
  return { cleared: clampCleared(record.cleared), best };
}

/** Write it down. Silent when the browser will not have it — the run still happened. */
export function writeRushProgress(progress: RushProgress): void {
  writeRaw(PROGRESS_KEY, JSON.stringify({ cleared: clampCleared(progress.cleared), best: progress.best }));
}

/**
 * Fold one finished run into a progress record and return the result. Pure: the caller decides
 * whether to write it, which is what makes this the one piece of the feature a test can drive
 * without a browser.
 *
 * `cleared` only ever moves FORWARD, and only to `level + 1`. The simulation has already made
 * that decision (`src/sim/rush.ts` raises `rushLevelUp`) — repeating the arithmetic here would
 * be a second opinion about the same fact, so this takes the caller's word for it via
 * `advanced` and merely refuses to let it move backwards.
 */
export function recordRushRun(progress: RushProgress, level: number, score: number, advanced: boolean): RushProgress {
  const best = progress.best.slice();
  if (level >= 0 && level < best.length && score > best[level]) best[level] = Math.floor(score);
  const cleared = advanced ? Math.max(progress.cleared, clampCleared(level + 1)) : progress.cleared;
  return { cleared, best };
}

/* ================================================================== passengers */

const RIDES_KEY = 'rb.passenger.rides';

/**
 * What the browser remembers about the passenger rides: how many were completed and the best
 * tip. Same contract as the mission chain — no server, never throws, garbage reads as nothing.
 * The money itself is not here: it is the session's counter, as it always was.
 */
export interface RideProgress {
  completed: number;
  bestTip: number;
}

export function emptyRideProgress(): RideProgress {
  return { completed: 0, bestTip: 0 };
}

function clampCount(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

export function readRideProgress(): RideProgress {
  const raw = readRaw(RIDES_KEY);
  if (!raw) return emptyRideProgress();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyRideProgress();
  }
  if (!parsed || typeof parsed !== 'object') return emptyRideProgress();
  const record = parsed as { completed?: unknown; bestTip?: unknown };
  return { completed: clampCount(record.completed), bestTip: clampCount(record.bestTip) };
}

export function writeRideProgress(progress: RideProgress): void {
  writeRaw(RIDES_KEY, JSON.stringify({ completed: clampCount(progress.completed), bestTip: clampCount(progress.bestTip) }));
}

/** Fold one completed ride in. Pure; the caller writes. */
export function recordRide(progress: RideProgress, tip: number): RideProgress {
  return { completed: progress.completed + 1, bestTip: Math.max(progress.bestTip, clampCount(tip)) };
}
