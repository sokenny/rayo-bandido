import { LEADERBOARD_PATH, RUSH_ATTEMPTS_PATH, RUSH_SCORE_PATH } from './protocol';
import { matchServerUrl } from './connection';
import { RUSH } from '../config/tuning';

/**
 * The RAYO RUSH global board, from the client's side.
 *
 * THE RULE THIS MODULE EXISTS TO KEEP: the activity must never wait on the network. A player
 * driving the city with the server down, or on a build served from a file, still gets the
 * marker, the countdown, the two minutes, the score and a personal best — the only thing they
 * lose is the global board. So every value here has a local answer first and a server answer
 * second: `standing()` returns what localStorage knows immediately and refreshes from the
 * server in the background, and `submit()` records the personal best locally before the
 * request is even sent.
 *
 * IDENTITY. There are no accounts in this game and there is not going to be one for a
 * leaderboard. A player is a random id their browser mints once and keeps (`rb.cid`), and
 * their name is the same one the lobby uses (`rb.name`). Clearing site data means a new
 * identity and a fresh daily allowance; see the trust model in `server/leaderboard.mjs`.
 *
 * THE DAILY ALLOWANCE is the server's to enforce and the client's to display. The local mirror
 * exists so the prompt can say a number before the network answers, and so an offline session
 * cannot silently bank unlimited ranked runs to file later — it cannot file them at all.
 */

/** The player's stable, anonymous id, and the mirror of what the board knows about them. */
const CID_KEY = 'rb.cid';
const BEST_KEY = 'rb.rush.best';
const ATTEMPTS_KEY = 'rb.rush.attempts';

/** How long a cached standing is trusted before another fetch is worth making (ms). */
const REFRESH_MS = 60_000;
/** A board request that has not answered in this long is treated as offline (ms). */
const TIMEOUT_MS = 4000;

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
  submit(run: RushSubmission, name: string): Promise<RushSubmitResult>;
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

/** A random, URL-safe id in the shape `server/leaderboard.mjs` accepts. */
function mintCid(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

/** This browser's id, minted on first use and kept from then on. */
export function clientId(): string {
  const stored = read(CID_KEY);
  if (stored && /^[A-Za-z0-9_-]{8,64}$/.test(stored)) return stored;
  const fresh = mintCid();
  write(CID_KEY, fresh);
  return fresh;
}

/** Today, in the same UTC day the server counts attempts by. */
export function localDayKey(at = Date.now()): string {
  return new Date(at).toISOString().slice(0, 10);
}

/* --------------------------------------------------------------------- http */

/**
 * The board's origin: the same host the socket would open on, over http(s) rather than ws.
 * Derived rather than configured for the reason the socket URL is — one deployment serves the
 * game, the rooms and the board from one place, so there is nothing to point at.
 */
export function boardUrl(path: string, ws: string = matchServerUrl()): string {
  const http = ws.replace(/^ws/, 'http');
  return `${http.replace(/\/ws$/, '')}${path}`;
}

async function getJson<T>(url: string): Promise<T | null> {
  if (typeof fetch !== 'function') return null;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), TIMEOUT_MS) : null;
  try {
    const response = await fetch(url, { cache: 'no-store', signal: controller?.signal });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    // Offline, blocked, timed out, or served from a file. All the same answer to the caller.
    return null;
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

async function postJson<T>(url: string, body: unknown): Promise<T | null> {
  if (typeof fetch !== 'function') return null;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), TIMEOUT_MS) : null;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller?.signal,
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

/* --------------------------------------------------------------------- module */

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
  const cid = clientId();
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

  async function fetchStanding(): Promise<RushStanding> {
    const body = await getJson<{ attemptsLeft?: number; dailyAttempts?: number; best?: number; rank?: number }>(
      `${boardUrl(RUSH_ATTEMPTS_PATH)}?cid=${encodeURIComponent(cid)}`,
    );
    checkedAt = Date.now();
    if (!body) {
      online = false;
      return current();
    }
    online = true;
    const allowance = Number.isFinite(body.dailyAttempts) ? (body.dailyAttempts as number) : RUSH.dailyRankedAttempts;
    if (Number.isFinite(body.attemptsLeft)) {
      // The server's count wins outright: it is the one that will refuse a submission.
      attempts = { day: localDayKey(), used: Math.max(0, allowance - (body.attemptsLeft as number)) };
      saveAttempts();
    }
    // Whichever best is higher, so a run posted before the browser was cleared is not lost and
    // neither is one made offline since.
    if (Number.isFinite(body.best) && (body.best as number) > best) {
      best = body.best as number;
      write(BEST_KEY, String(best));
    }
    rank = Number.isFinite(body.rank) ? (body.rank as number) : -1;
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

    async submit(run, name) {
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

      const body = await postJson<{
        accepted?: boolean;
        rank?: number;
        best?: number;
        attemptsLeft?: number;
      }>(boardUrl(RUSH_SCORE_PATH), { cid, name, ...run });

      if (!body) {
        online = false;
        return { accepted: false, newBest: localNewBest, previousBest, rank, attemptsLeft: current().attemptsLeft, online };
      }
      online = true;
      checkedAt = Date.now();
      if (Number.isFinite(body.attemptsLeft)) {
        attempts = { day: localDayKey(), used: Math.max(0, RUSH.dailyRankedAttempts - (body.attemptsLeft as number)) };
        saveAttempts();
      }
      if (Number.isFinite(body.best) && (body.best as number) > best) {
        best = body.best as number;
        write(BEST_KEY, String(best));
      }
      if (Number.isFinite(body.rank)) rank = body.rank as number;
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
      const body = await getJson<{ entries?: LeaderboardRow[] }>(`${boardUrl(LEADERBOARD_PATH)}?board=rush&limit=${limit}`);
      online = !!body;
      return body && Array.isArray(body.entries) ? body.entries : [];
    },
  };
}
