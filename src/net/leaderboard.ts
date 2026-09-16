import { BOARDS_PATH, type BoardId } from './protocol';
import { RUSH } from '../config/tuning';

/**
 * The high-score boards, from the client's side: RAYO RUSH's global board with its daily ranked
 * attempts, and the two timed boards (TIME ATTACK on the Bandido Grid, STREET RACE at La Curva).
 *
 * THE RULE THIS MODULE EXISTS TO KEEP: the activity must never wait on the network. A player
 * driving the city with the server down, or on a build served from a file, still gets the
 * marker, the countdown, the run, the score and a personal best — the only thing they lose is
 * the global board. So every value here has a local answer first and a server answer second:
 * `standing()` returns what localStorage knows immediately and refreshes from the server in the
 * background, and `submit()` records the personal best locally before the request is even sent.
 *
 * IDENTITY is the account (`src/net/account.ts`): a session cookie the server hands every browser
 * on its first request, guest or signed in. Nothing here names the player — the server knows who
 * is asking, and the name on the board is the account's.
 *
 * THE DAILY ALLOWANCE is the server's to enforce and the client's to display. The local mirror
 * exists so the prompt can say a number before the network answers, and so an offline session
 * cannot silently bank unlimited ranked runs to file later — it cannot file them at all.
 */

const BEST_KEY = 'rb.rush.best';
const ATTEMPTS_KEY = 'rb.rush.attempts';

/** How long a cached standing is trusted before another fetch is worth making (ms). */
const REFRESH_MS = 60_000;
/** A board request that has not answered in this long is treated as offline (ms). */
const TIMEOUT_MS = 4000;

/** A row of any board. `value` is points on rush and milliseconds on the timed boards. */
export interface BoardRow {
  rank: number;
  name: string;
  value: number;
  at: number;
}

export interface LeaderboardRow {
  rank: number;
  name: string;
  score: number;
  disabled: number;
  bestChain: number;
  at: number;
}

/** What the marker's prompt and the results card need to know. */
export interface RushStanding {
  /** Ranked attempts left today. `RUSH.dailyRankedAttempts` when nothing is known yet. */
  attemptsLeft: number;
  dailyAttempts: number;
  /** Best score this player has ever posted, or -1. */
  best: number;
  /** Position on the global board, or -1 when unplaced or unknown. */
  rank: number;
  /** False while the board has not been reached: everything above is the local mirror. */
  online: boolean;
}

export interface RushSubmission {
  score: number;
  disabled: number;
  bestChain: number;
  styleBonus: number;
  /** Points crashes took off `score`, so the board can tell style bonus from the score it survived. */
  crashPenalty: number;
  /** Points near misses paid into `score`: a run can score without a single kill. */
  nearMissPoints: number;
}

/** What came back from filing a run. */
export interface RushSubmitResult {
  /** True when the run went onto the global board. */
  accepted: boolean;
  /** True when it beat this player's previous best — locally true even when offline. */
  newBest: boolean;
  /** The best that stood BEFORE this run, or -1. This is what the results card compares against. */
  previousBest: number;
  rank: number;
  attemptsLeft: number;
  online: boolean;
}

export interface Leaderboard {
  /**
   * What is known right now, without waiting. Reads the local mirror and, when it is stale,
   * kicks off a refresh whose result the next call will see.
   */
  standing(): RushStanding;
  /** Force a refresh from the server. Resolves with whatever is known afterwards. */
  refresh(): Promise<RushStanding>;
  /** Whether starting a run now would be a ranked attempt. */
  canRank(): boolean;
  /** File a finished run. Never rejects: an unreachable board is a result, not an error. */
  submit(run: RushSubmission): Promise<RushSubmitResult>;
  /** The top of the board, or an empty list when it cannot be reached. */
  top(limit?: number): Promise<LeaderboardRow[]>;
}

/* --------------------------------------------------------------------- storage */

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private browsing, or storage full: the session still plays, it just forgets */
  }
}

/** Forget the local mirror of the rush board: a signed-out browser is a different player. */
export function clearBoardMirror(): void {
  for (const key of [BEST_KEY, ATTEMPTS_KEY]) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* nothing to forget */
    }
  }
}

/** Today, in the same UTC day the server counts attempts by. */
export function localDayKey(at = Date.now()): string {
  return new Date(at).toISOString().slice(0, 10);
}

/* --------------------------------------------------------------------- http */

async function getJson<T>(url: string): Promise<T | null> {
  if (typeof fetch !== 'function') return null;
  try {
    const response = await fetch(url, { cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    // Offline, blocked, timed out, or served from a file. All the same answer to the caller.
    return null;
  }
}

async function postJson<T>(url: string, body: unknown): Promise<T | null> {
  if (typeof fetch !== 'function') return null;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

/** The top of any board, or an empty list when it cannot be reached. */
export async function fetchBoard(board: BoardId, limit = 10): Promise<BoardRow[]> {
  const body = await getJson<{ entries?: BoardRow[] }>(`${BOARDS_PATH}/${board}?limit=${limit}`);
  return body && Array.isArray(body.entries) ? body.entries : [];
}

/**
 * File a finished race on a timed board. Fire and forget: resolves with whether the server took
 * it, and false for an unreachable one. The race's own card never waits on this.
 */
export async function submitRaceTime(board: Exclude<BoardId, 'rush'>, seconds: number, stats: Record<string, number> = {}): Promise<boolean> {
  if (!(seconds > 0)) return false;
  const body = await postJson<{ accepted?: boolean }>(`${BOARDS_PATH}/${board}/runs`, { ms: Math.round(seconds * 1000), ...stats });
  return !!body?.accepted;
}

/* --------------------------------------------------------------------- the rush board */

interface StoredAttempts {
  day: string;
  used: number;
}

function readAttempts(): StoredAttempts {
  const raw = read(ATTEMPTS_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as StoredAttempts;
      // A record from another day is not this day's allowance; it is simply spent.
      if (parsed && parsed.day === localDayKey() && Number.isFinite(parsed.used)) {
        return { day: parsed.day, used: Math.max(0, Math.floor(parsed.used)) };
      }
    } catch {
      /* corrupt record: start the day over */
    }
  }
  return { day: localDayKey(), used: 0 };
}

function readBest(): number {
  const raw = Number(read(BEST_KEY));
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : -1;
}

export function createLeaderboard(): Leaderboard {
  let best = readBest();
  let attempts = readAttempts();
  let rank = -1;
  let online = false;
  /** When the server last answered, so a stale standing is refreshed and a fresh one is not. */
  let checkedAt = -Infinity;
  let inFlight: Promise<RushStanding> | null = null;

  function current(): RushStanding {
    // Rolled over at midnight UTC while the tab stayed open.
    if (attempts.day !== localDayKey()) attempts = { day: localDayKey(), used: 0 };
    return {
      attemptsLeft: Math.max(0, RUSH.dailyRankedAttempts - attempts.used),
      dailyAttempts: RUSH.dailyRankedAttempts,
      best,
      rank,
      online,
    };
  }

  function saveAttempts(): void {
    write(ATTEMPTS_KEY, JSON.stringify(attempts));
  }

  /** Fold a server answer into the mirror. The server's count wins; the higher best wins. */
  function absorb(body: { attemptsLeft?: number; best?: number; rank?: number }): void {
    online = true;
    checkedAt = Date.now();
    if (Number.isFinite(body.attemptsLeft)) {
      attempts = { day: localDayKey(), used: Math.max(0, RUSH.dailyRankedAttempts - (body.attemptsLeft as number)) };
      saveAttempts();
    }
    // Whichever best is higher, so a run posted from another device is not lost and neither is
    // one made offline since.
    if (Number.isFinite(body.best) && (body.best as number) > best) {
      best = body.best as number;
      write(BEST_KEY, String(best));
    }
    if (Number.isFinite(body.rank)) rank = body.rank as number;
  }

  async function fetchStanding(): Promise<RushStanding> {
    const body = await getJson<{ attemptsLeft?: number; best?: number; rank?: number }>(`${BOARDS_PATH}/rush/standing`);
    checkedAt = Date.now();
    if (!body) {
      online = false;
      return current();
    }
    absorb(body);
    return current();
  }

  function refresh(): Promise<RushStanding> {
    if (!inFlight) {
      inFlight = fetchStanding().finally(() => {
        inFlight = null;
      });
    }
    return inFlight;
  }

  return {
    standing() {
      // The answer is always immediate; a stale one quietly asks for a fresher one.
      if (Date.now() - checkedAt > REFRESH_MS) void refresh();
      return current();
    },

    refresh,

    canRank() {
      return current().attemptsLeft > 0;
    },

    async submit(run) {
      const previousBest = best;
      const localNewBest = run.score > previousBest;
      // Local first, and unconditionally: the personal best on the results card is the
      // player's own record of their own run and must not depend on a server answering.
      if (localNewBest) {
        best = run.score;
        write(BEST_KEY, String(best));
      }
      // The attempt is spent locally the moment it is filed, so the prompt's count goes down
      // even when the response is lost. A server answer below corrects it either way.
      if (attempts.day !== localDayKey()) attempts = { day: localDayKey(), used: 0 };
      const wasRankable = attempts.used < RUSH.dailyRankedAttempts;
      if (wasRankable) {
        attempts.used += 1;
        saveAttempts();
      }
      if (!wasRankable) {
        return { accepted: false, newBest: localNewBest, previousBest, rank, attemptsLeft: 0, online };
      }

      const body = await postJson<{ accepted?: boolean; rank?: number; best?: number; attemptsLeft?: number }>(`${BOARDS_PATH}/rush/runs`, run);
      if (!body) {
        online = false;
        return { accepted: false, newBest: localNewBest, previousBest, rank, attemptsLeft: current().attemptsLeft, online };
      }
      absorb(body);
      return {
        accepted: !!body.accepted,
        newBest: localNewBest,
        previousBest,
        rank,
        attemptsLeft: current().attemptsLeft,
        online,
      };
    },

    async top(limit = 10) {
      const body = await getJson<{ entries?: Array<BoardRow & { disabled?: number; bestChain?: number }> }>(`${BOARDS_PATH}/rush?limit=${limit}`);
      online = !!body;
      if (!body || !Array.isArray(body.entries)) return [];
      return body.entries.map((e) => ({ rank: e.rank, name: e.name, score: e.value, disabled: e.disabled ?? 0, bestChain: e.bestChain ?? 0, at: e.at }));
    },
  };
}
