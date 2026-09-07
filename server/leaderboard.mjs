import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * The RAYO RUSH global leaderboard, and the daily ranked-attempt allowance that feeds it.
 *
 * WHY IT IS A FILE. There is no database in this project and adding one to hold a hundred
 * numbers would be the wrong trade. The whole board is a small JSON document held in memory
 * and flushed to disk, debounced, whenever it changes: one server process owns it, so there
 * is no coordination to get wrong, and a restart comes back with the board intact.
 *
 * WHERE THAT FILE LIVES. `RB_DATA_DIR` if it is set, otherwise `.data/` beside the repo. On a
 * host that replaces the application directory on every deploy — Elastic Beanstalk does —
 * point `RB_DATA_DIR` at something that survives one, or the board resets with each release.
 * That is a deployment decision, not a code one, so it is a variable rather than a guess.
 *
 * TRUST MODEL, SAME AS `src/net/protocol.ts`. Scores are reported by the client and cannot be
 * checked against a simulation the server does not run. What IS enforced here is the shape and
 * the ceiling — a score has to be a number inside what the scoring rules could actually pay
 * over two minutes — and the daily allowance, which is what stops a board being flooded from
 * one browser. Nothing valuable should ever sit behind these numbers.
 *
 * IDENTITY. There are no accounts, so a player is a random id their browser generated and
 * keeps (`rb.cid`). Clearing site data earns a fresh allowance. That is a known and accepted
 * hole: this is a leaderboard between friends, not a ranked ladder.
 */

/** Boards this server will accept. One for now; the shape is the same for any other. */
const BOARDS = new Set(['rush']);

/** Entries kept per board. Anything past this is dropped on write. */
const MAX_ENTRIES = 200;
/** Rows `GET /leaderboard` will return at most. */
const MAX_PAGE = 50;

/** Longest client id accepted, and the alphabet it has to be drawn from. */
const CID_MAX = 64;
const CID_RE = /^[A-Za-z0-9_-]{8,64}$/;
/** Longest name stored. Matches `NAME_MAX` in `src/net/protocol.ts`. */
const NAME_MAX = 14;

/**
 * The most a run could conceivably be worth, used only to reject nonsense. Sized generously
 * from `RUSH` in `src/config/tuning.ts`: about one kill a second for the length of a run, every
 * one of them at the x5 cap with a clean four-second drift bonus. Deliberately not recalculated
 * when the run length is retuned — it is a sanity bound, not a score, and it only has to be
 * comfortably above anything a human could actually post. A real run lands an order below it.
 */
const SCORE_CEILING = 250_000;

/** Days of attempt records kept. Older days are dropped on write; nothing reads them. */
const ATTEMPT_DAYS = 7;

/** How long a change waits before it is written, so a burst of finishes is one write. */
const FLUSH_MS = 1500;

/** The calendar day an attempt belongs to, in UTC so every player's allowance turns over together. */
export function dayKey(at = Date.now()) {
  return new Date(at).toISOString().slice(0, 10);
}

function sanitizeName(value) {
  if (typeof value !== 'string') return 'BANDIDO';
  const trimmed = value.trim().slice(0, NAME_MAX).toUpperCase();
  // Same character class the lobby allows, so a name looks the same on the board as in the city.
  const cleaned = trimmed.replace(/[^A-Z0-9 _.-]/g, '');
  return cleaned.length > 0 ? cleaned : 'BANDIDO';
}

function sanitizeCid(value) {
  if (typeof value !== 'string' || value.length > CID_MAX) return null;
  return CID_RE.test(value) ? value : null;
}

/** A finite, non-negative integer inside `max`, or null. */
function sanitizeCount(value, max) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const n = Math.floor(value);
  if (n < 0 || n > max) return null;
  return n;
}

function emptyStore() {
  return { version: 1, boards: {}, attempts: {} };
}

/**
 * @param {{ dir?: string, dailyAttempts?: number, log?: (msg: string) => void }} options
 *   `dailyAttempts` is the client's own `RUSH.dailyRankedAttempts`, passed in by
 *   `server/index.mjs` so the number lives in one place on this side too.
 */
export function createLeaderboard({ dir, dailyAttempts = 3, log = () => {} } = {}) {
  const root = dir || process.env.RB_DATA_DIR || join(process.cwd(), '.data');
  const file = join(root, 'leaderboard.json');

  /** @type {{ version: number, boards: Record<string, Array<object>>, attempts: Record<string, Record<string, number>> }} */
  let store = emptyStore();
  let flushTimer = null;
  /** Whether anything has changed since the last write. A clean shutdown of a server nobody
   *  scored on must not create a data directory just to put an empty board in it. */
  let dirty = false;
  /** Set once when the disk turns out to be unusable, so it is complained about only once. */
  let readOnly = false;

  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    if (raw && typeof raw === 'object') {
      store = { version: 1, boards: raw.boards ?? {}, attempts: raw.attempts ?? {} };
      const rows = Object.values(store.boards).reduce((n, list) => n + (Array.isArray(list) ? list.length : 0), 0);
      log(`leaderboard: ${rows} score${rows === 1 ? '' : 's'} from ${file}`);
    }
  } catch (err) {
    // A missing file is the normal first run; anything else is worth saying out loud once.
    if (err && err.code !== 'ENOENT') log(`leaderboard: could not read ${file} (${err.message}); starting empty`);
  }

  function writeNow() {
    flushTimer = null;
    if (readOnly || !dirty) return;
    dirty = false;
    try {
      mkdirSync(dirname(file), { recursive: true });
      // Write beside it and rename, so a process killed mid-write cannot leave half a board.
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, JSON.stringify(store), 'utf8');
      renameSync(tmp, file);
    } catch (err) {
      readOnly = true;
      log(`leaderboard: cannot write ${file} (${err.message}); the board is memory-only from here`);
    }
  }

  function flushSoon() {
    dirty = true;
    if (flushTimer) return;
    flushTimer = setTimeout(writeNow, FLUSH_MS);
    flushTimer.unref?.();
  }

  /** Drop everything but the newest `ATTEMPT_DAYS` days of allowances. */
  function pruneAttempts() {
    const days = Object.keys(store.attempts).sort();
    while (days.length > ATTEMPT_DAYS) {
      delete store.attempts[days.shift()];
    }
  }

  function attemptsUsed(cid, day = dayKey()) {
    return store.attempts[day]?.[cid] ?? 0;
  }

  function board(name) {
    if (!store.boards[name]) store.boards[name] = [];
    return store.boards[name];
  }

  /** The board as rows a client can render: rank, name, score, when. */
  function page(name, limit) {
    const rows = board(name);
    const n = Math.max(1, Math.min(MAX_PAGE, limit || 20));
    return rows.slice(0, n).map((row, i) => ({
      rank: i + 1,
      name: row.name,
      score: row.score,
      disabled: row.disabled,
      bestChain: row.bestChain,
      at: row.at,
    }));
  }

  return {
    /** Boards this server knows about, for a caller that wants to check a name. */
    has: (name) => BOARDS.has(name),

    /** `GET /leaderboard`. */
    top(name, limit) {
      if (!BOARDS.has(name)) return null;
      return { board: name, entries: page(name, limit), dailyAttempts };
    },

    /**
     * `GET /rush/attempts`. What this client has left today, and what its best ever was, so
     * the marker's prompt can say both before a run is started.
     */
    standing(name, rawCid) {
      if (!BOARDS.has(name)) return null;
      const cid = sanitizeCid(rawCid);
      if (!cid) return { board: name, attemptsLeft: dailyAttempts, dailyAttempts, best: -1, rank: -1 };
      const rows = board(name);
      let best = -1;
      let rank = -1;
      for (let i = 0; i < rows.length; i++) {
        if (rows[i].cid !== cid) continue;
        best = rows[i].score;
        rank = i + 1;
        break; // rows are sorted, so the first one this player owns is their best
      }
      return {
        board: name,
        attemptsLeft: Math.max(0, dailyAttempts - attemptsUsed(cid)),
        dailyAttempts,
        best,
        rank,
      };
    },

    /**
     * `POST /rush/score`. Spends one of the day's attempts and files the score.
     *
     * Returns `{ accepted }` false when the run cannot be ranked — the allowance is spent, or
     * the body is not a plausible run. The run still happened either way: the client has
     * already shown the player their score, and a refusal here only means it is not on the
     * board.
     *
     * A player holds ONE row: their best. A worse run still spends an attempt (otherwise the
     * allowance would only bind on improvements) but does not replace the row.
     */
    submit(name, body) {
      if (!BOARDS.has(name)) return null;
      const cid = sanitizeCid(body?.cid);
      if (!cid) return { accepted: false, reason: 'badClient' };

      const score = sanitizeCount(body?.score, SCORE_CEILING);
      const disabled = sanitizeCount(body?.disabled, 1000);
      const bestChain = sanitizeCount(body?.bestChain, 1000);
      const styleBonus = sanitizeCount(body?.styleBonus, SCORE_CEILING);
      if (score === null || disabled === null || bestChain === null || styleBonus === null) {
        return { accepted: false, reason: 'badScore' };
      }
      // Cheap internal consistency: points cannot appear without kills, and the style bonus is
      // part of the score rather than something on top of it.
      if (disabled === 0 && score > 0) return { accepted: false, reason: 'badScore' };
      if (styleBonus > score) return { accepted: false, reason: 'badScore' };

      const day = dayKey();
      const used = attemptsUsed(cid, day);
      if (used >= dailyAttempts) {
        return { accepted: false, reason: 'noAttempts', attemptsLeft: 0, dailyAttempts };
      }
      if (!store.attempts[day]) store.attempts[day] = {};
      store.attempts[day][cid] = used + 1;
      pruneAttempts();

      const rows = board(name);
      const playerName = sanitizeName(body?.name);
      const mine = rows.findIndex((row) => row.cid === cid);
      let improved = true;
      if (mine >= 0) {
        if (rows[mine].score >= score) {
          improved = false;
          // The name still follows the player, so a rename shows up on the board they are on.
          rows[mine].name = playerName;
        } else {
          rows.splice(mine, 1);
        }
      }
      if (improved) {
        rows.push({ cid, name: playerName, score, disabled, bestChain, styleBonus, at: Date.now() });
        // Highest first, oldest first on a tie: getting there first is worth the higher row.
        rows.sort((a, b) => b.score - a.score || a.at - b.at);
        if (rows.length > MAX_ENTRIES) rows.length = MAX_ENTRIES;
      }
      flushSoon();

      const rank = rows.findIndex((row) => row.cid === cid);
      return {
        accepted: true,
        improved,
        rank: rank >= 0 ? rank + 1 : -1,
        best: rank >= 0 ? rows[rank].score : score,
        attemptsLeft: Math.max(0, dailyAttempts - (used + 1)),
        dailyAttempts,
        entries: page(name, 20),
      };
    },

    /** Flush anything outstanding. Called on shutdown so a clean stop never loses a score. */
    close() {
      if (flushTimer) clearTimeout(flushTimer);
      writeNow();
    },
  };
}
