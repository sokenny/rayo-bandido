/**
 * The high-score boards: RAYO RUSH, TIME ATTACK on the Bandido Grid, and STREET RACE at La Curva.
 *
 * A board is a key in `BOARDS` and nothing else — no table of boards, no migration to add one.
 * Every run filed is a `runs` row; a player's best on each board is a `personal_bests` row, and
 * the board you see is those rows sorted the board's way.
 *
 * TRUST MODEL, SAME AS EVER (`src/net/protocol.ts`). A run is the client's report of a simulation
 * the server does not run. What is enforced here is the shape, a plausible range, a little
 * internal consistency, and RAYO RUSH's daily ranked allowance — which is what stops one browser
 * flooding the board. Nothing valuable should sit behind these numbers.
 */

/**
 * `better`: which way a value wins. `min`/`max` bound a value (points, or milliseconds) and are
 * sanity limits, not scores: comfortably outside anything a human could post either way.
 *
 * RUSH's ceiling is sized from `RUSH` in `src/config/tuning.ts` — about one kill a second for the
 * length of a run, every one at the x5 cap with a clean drift bonus — and deliberately not
 * recalculated when the run is retuned. The two races are 2 laps; nobody laps either in 10 s.
 */
export const BOARDS = {
  rush: { better: 'higher', min: 0, max: 250_000, ranked: true },
  circuit: { better: 'lower', min: 20_000, max: 3_600_000, ranked: false },
  street: { better: 'lower', min: 20_000, max: 3_600_000, ranked: false },
};

/** Boards where a larger value wins, for SQL that has to know. */
export const higherIsBetter = () => Object.keys(BOARDS).filter((b) => BOARDS[b].better === 'higher');

const MAX_PAGE = 50;

function count(value, max) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const n = Math.floor(value);
  return n < 0 || n > max ? null : n;
}

/**
 * A submission reduced to `{ value, stats }`, or a reason it was refused. Rush sends its score and
 * the three numbers the results card shows; a race sends its finish time in milliseconds.
 */
export function readRun(board, body) {
  const spec = BOARDS[board];
  if (!spec || !body || typeof body !== 'object') return { error: 'badScore' };
  if (board === 'rush') {
    const score = count(body.score, spec.max);
    const disabled = count(body.disabled, 1000);
    const bestChain = count(body.bestChain, 1000);
    const styleBonus = count(body.styleBonus, spec.max);
    if (score === null || disabled === null || bestChain === null || styleBonus === null) return { error: 'badScore' };
    // Crashes take points off the score after the style bonus was paid into it (absent = 0).
    const crashPenalty = body.crashPenalty === undefined ? 0 : count(body.crashPenalty, spec.max);
    if (crashPenalty === null) return { error: 'badScore' };
    // Near misses pay without a kill (absent = 0).
    const nearMissPoints = body.nearMissPoints === undefined ? 0 : count(body.nearMissPoints, spec.max);
    if (nearMissPoints === null) return { error: 'badScore' };
    // Points cannot appear without kills beyond what near misses paid, and the style bonus is part of the score.
    if (disabled === 0 && score > nearMissPoints) return { error: 'badScore' };
    if (styleBonus > score + crashPenalty) return { error: 'badScore' };
    return { value: score, stats: { disabled, bestChain, styleBonus } };
  }
  const ms = count(body.ms, spec.max);
  if (ms === null || ms < spec.min) return { error: 'badScore' };
  const stats = {};
  for (const key of ['crashes', 'level', 'event', 'placement', 'field']) {
    const n = count(body[key], 1000);
    if (n !== null) stats[key] = n;
  }
  return { value: ms, stats };
}

/**
 * @param {import('./db/index.mjs').Database} db
 * @param {{ dailyAttempts: number }} options
 */
export function createScores(db, { dailyAttempts }) {
  const order = (board) => (BOARDS[board].better === 'higher' ? 'desc' : 'asc');

  async function top(board, limit = 10, q = db) {
    if (!BOARDS[board]) return null;
    const n = Math.max(1, Math.min(MAX_PAGE, Number(limit) || 10));
    // Highest (or fastest) first; on a tie, whoever got there first holds the higher row.
    const rows = await q.query(
      `select coalesce(u.display_name, 'BANDIDO') as name, pb.value, r.stats,
              (extract(epoch from pb.achieved_at) * 1000)::float8 as at
         from personal_bests pb
         join users u on u.id = pb.user_id
         join runs r on r.id = pb.run_id
        where pb.board = $1
        order by pb.value ${order(board)}, pb.achieved_at asc
        limit $2`,
      [board, n],
    );
    return rows.map((row, i) => ({ rank: i + 1, name: row.name, value: row.value, at: row.at, ...(row.stats || {}) }));
  }

  /** Ranked attempts spent today (UTC), the day every player's allowance turns over together. */
  async function attemptsUsed(userId, q = db) {
    const [row] = await q.query(
      `select count(*)::int as n from runs
        where user_id = $1 and board = 'rush' and ranked
          and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'`,
      [userId],
    );
    return row.n;
  }

  /** A player's best and position on a board, and (for rush) what is left of today's allowance. */
  async function standing(board, userId, q = db) {
    if (!BOARDS[board]) return null;
    const [mine] = await q.query(`select value, achieved_at from personal_bests where user_id = $1 and board = $2`, [userId, board]);
    let rank = -1;
    if (mine) {
      const cmp = BOARDS[board].better === 'higher' ? '>' : '<';
      const [row] = await q.query(
        `select count(*)::int as n from personal_bests
          where board = $1 and (value ${cmp} $2 or (value = $2 and achieved_at < $3))`,
        [board, mine.value, mine.achieved_at],
      );
      rank = row.n + 1;
    }
    const out = { board, best: mine ? mine.value : -1, rank };
    if (BOARDS[board].ranked) {
      out.dailyAttempts = dailyAttempts;
      out.attemptsLeft = Math.max(0, dailyAttempts - (await attemptsUsed(userId, q)));
    }
    return out;
  }

  /**
   * File a run. Rush spends one of the day's attempts and is refused once they are gone; a race
   * is always filed. A worse run is still recorded, and still spends the attempt, but leaves the
   * personal best where it was.
   */
  async function submit(board, userId, body) {
    const spec = BOARDS[board];
    if (!spec) return null;
    const run = readRun(board, body);
    if (run.error) return { accepted: false, reason: run.error };
    return db.tx(async (q) => {
      // One player's submissions are taken one at a time, so two tabs cannot both spend the last attempt.
      await q.query(`select id from users where id = $1 for update`, [userId]);
      if (spec.ranked && (await attemptsUsed(userId, q)) >= dailyAttempts) {
        return { accepted: false, reason: 'noAttempts', attemptsLeft: 0, dailyAttempts };
      }
      const [inserted] = await q.query(
        `insert into runs (user_id, board, value, stats, ranked) values ($1, $2, $3, $4, $5) returning id, created_at`,
        [userId, board, run.value, JSON.stringify(run.stats), spec.ranked],
      );
      const [previous] = await q.query(`select value from personal_bests where user_id = $1 and board = $2`, [userId, board]);
      const improved = !previous || (spec.better === 'higher' ? run.value > previous.value : run.value < previous.value);
      if (improved) {
        await q.query(
          `insert into personal_bests (user_id, board, value, run_id, achieved_at) values ($1, $2, $3, $4, $5)
           on conflict (user_id, board) do update set value = excluded.value, run_id = excluded.run_id, achieved_at = excluded.achieved_at`,
          [userId, board, run.value, inserted.id, inserted.created_at],
        );
      }
      const now = await standing(board, userId, q);
      return {
        accepted: true,
        improved,
        previousBest: previous ? previous.value : -1,
        ...now,
        entries: await top(board, 10, q),
      };
    });
  }

  return { top, standing, submit };
}
