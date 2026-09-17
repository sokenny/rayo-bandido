import { createHash, randomBytes } from 'node:crypto';
import { higherIsBetter } from './scores.mjs';

/**
 * Players, their sessions, and what they have saved.
 *
 * EVERY VISITOR IS A USER. The first request that needs one (`ensure`) creates a `users` row and
 * a session cookie for it: a GUEST, which is simply a user with no row in `user_identities`.
 * Progress, money and scores are saved against that user from the first visit, so nothing waits
 * on a sign-in and nothing is lost before one.
 *
 * SIGNING IN attaches a Google or Discord identity to the user the browser already is. The one
 * interesting case is an identity that already belongs to somebody — the same player on a second
 * machine — and then the guest on this machine is MERGED into that account (`mergeInto`) and
 * deleted: its runs move over, the better personal best on each board survives, mission chains
 * keep the further of the two, and the wallet keeps the larger. A browser already signed in to a
 * different account just switches; two real accounts are never merged.
 *
 * TRUST MODEL, SAME AS THE BOARDS. Everything a client saves is its own report. The shape and the
 * bounds are enforced; the numbers cannot be.
 */

export const SESSION_COOKIE = 'rb_session';
/** Chrome caps a cookie's lifetime at 400 days. A session is refreshed when it is used. */
const SESSION_DAYS = 400;
/** A session's `last_seen_at` is rewritten at most this often (ms), not on every request. */
const TOUCH_MS = 6 * 60 * 60 * 1000;
/** Longest display name. Matches `NAME_MAX` in `src/net/protocol.ts`. */
export const NAME_MAX = 14;
/** Shortest name a player may pick. */
export const NAME_MIN = 3;
/** What the boards show for a player with no name: nobody may own it. */
const NAME_FALLBACK = 'BANDIDO';
const CHAINS = ['rush', 'circuit', 'street'];
/** Levels a chain record may carry. The game has three per chain; this is only a bound. */
const MAX_LEVELS = 32;
const MONEY_MAX = 1_000_000_000;

/* ------------------------------------------------------------------ cookies */

export function parseCookies(header) {
  const out = {};
  if (typeof header !== 'string') return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      /* a malformed cookie is no cookie */
    }
  }
  return out;
}

/** Whether the visitor reached us over HTTPS — directly, or through the load balancer. */
export function isHttps(req) {
  return req.headers['x-forwarded-proto'] === 'https' || !!req.socket?.encrypted;
}

export function cookieHeader(name, value, { maxAge, path = '/', secure = false } = {}) {
  let out = `${name}=${encodeURIComponent(value)}; Path=${path}; HttpOnly; SameSite=Lax`;
  if (maxAge !== undefined) out += `; Max-Age=${Math.floor(maxAge)}`;
  if (secure) out += '; Secure';
  return out;
}

/** Append a Set-Cookie without clobbering one already queued on the response. */
export function addCookie(res, cookie) {
  const prev = res.getHeader('set-cookie');
  res.setHeader('set-cookie', prev ? [].concat(prev, cookie) : [cookie]);
}

const hashToken = (token) => createHash('sha256').update(token).digest('hex');

/* ------------------------------------------------------------------ sanitizers */

/** A name as the boards show it: upper case, letters, digits and a little punctuation. */
export function sanitizeDisplayName(value) {
  if (typeof value !== 'string') return null;
  const cleaned = value
    .normalize('NFC')
    .toUpperCase()
    .replace(/[^\p{L}\p{N} _.-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX)
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * A name a player may own: sanitized, long enough, and not the boards' fallback. Names are
 * unique across players (`003_unique_display_name.sql`), so this is a handle, not a label.
 */
export function claimableName(value) {
  const name = sanitizeDisplayName(value);
  return name && name.length >= NAME_MIN && name !== NAME_FALLBACK ? name : null;
}

/** Postgres's unique_violation. */
const isUniqueViolation = (err) => err?.code === '23505';

function wholeNumber(value, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const n = Math.floor(value);
  return n < min || n > max ? null : n;
}

/** The part of a chain record that can be trusted: a bounded count and a bounded list of bests. */
function sanitizeChain(chain, value) {
  if (!value || typeof value !== 'object') return null;
  const cleared = wholeNumber(value.cleared, 0, MAX_LEVELS);
  if (cleared === null || !Array.isArray(value.best) || value.best.length > MAX_LEVELS) return null;
  const best = value.best.map((b) => {
    if (typeof b !== 'number' || !Number.isFinite(b) || b <= 0) return -1;
    // Circuit bests are seconds with a fraction; the other two are whole numbers.
    return chain === 'circuit' ? Math.round(b * 1000) / 1000 : Math.floor(b);
  });
  return { cleared, best };
}

/**
 * A progress body from a client, reduced to what may be stored. Keys that are absent or invalid
 * come back `undefined` and are left alone by the save; nothing here throws.
 */
export function sanitizeProgress(body) {
  const out = {};
  if (!body || typeof body !== 'object') return out;
  const money = wholeNumber(body.wallet, 0, MONEY_MAX);
  if (money !== null) out.wallet = money;
  if (body.intro && typeof body.intro === 'object') {
    const status = body.intro.status === 'completed' || body.intro.status === 'skipped' ? body.intro.status : null;
    const version = wholeNumber(body.intro.version, 0, 10_000);
    if (status && version !== null) out.intro = { status, version };
  }
  if (body.rides && typeof body.rides === 'object') {
    const completed = wholeNumber(body.rides.completed, 0, 1_000_000);
    const bestTip = wholeNumber(body.rides.bestTip, 0, MONEY_MAX);
    if (completed !== null && bestTip !== null) out.rides = { completed, bestTip };
  }
  for (const chain of CHAINS) {
    const clean = sanitizeChain(chain, body[chain]);
    if (clean) out[chain] = clean;
  }
  return out;
}

/* ------------------------------------------------------------------ merging */

const INTRO_RANK = { skipped: 1, completed: 2 };

/**
 * Which of two intro records stands. A newer intro version wins outright — that is how a
 * reworked intro is replayed for everyone — and within a version, completed beats skipped.
 */
function pickIntro(a, b) {
  if (!a) return b ?? null;
  if (!b) return a;
  if (a.version !== b.version) return a.version > b.version ? a : b;
  return INTRO_RANK[a.status] >= INTRO_RANK[b.status] ? a : b;
}

/** Whether best `a` beats best `b` on `chain`: rush scores go up, times and placements go down. */
function chainBetter(chain, a, b) {
  if (a < 0) return false;
  if (b < 0) return true;
  return chain === 'rush' ? a > b : a < b;
}

function mergeChain(chain, a, b) {
  if (!a) return b ?? null;
  if (!b) return a;
  const length = Math.max(a.best.length, b.best.length);
  const best = [];
  for (let i = 0; i < length; i++) {
    const x = a.best[i] ?? -1;
    const y = b.best[i] ?? -1;
    best.push(chainBetter(chain, y, x) ? y : x);
  }
  return { cleared: Math.max(a.cleared, b.cleared), best };
}

/**
 * Fold `incoming` into `stored`. `wallet` says what happens to money: `'replace'` for a save (the
 * client's balance is the latest one — it is the only thing that spends), `'max'` for a merge of
 * two players' records (neither is more recent than the other, and the larger is never a loss).
 */
export function mergeProgress(stored, incoming, { wallet = 'replace' } = {}) {
  const out = { ...stored };
  if (incoming.wallet !== undefined && incoming.wallet !== null) {
    out.wallet = wallet === 'max' && stored.wallet !== null && stored.wallet !== undefined ? Math.max(stored.wallet, incoming.wallet) : incoming.wallet;
  }
  if (incoming.intro) out.intro = pickIntro(stored.intro, incoming.intro);
  if (incoming.rides) {
    out.rides = stored.rides
      ? { completed: Math.max(stored.rides.completed, incoming.rides.completed), bestTip: Math.max(stored.rides.bestTip, incoming.rides.bestTip) }
      : incoming.rides;
  }
  for (const chain of CHAINS) if (incoming[chain]) out[chain] = mergeChain(chain, stored[chain], incoming[chain]);
  return out;
}

/* ------------------------------------------------------------------ module */

/**
 * @param {import('./db/index.mjs').Database} db
 * @param {{ log?: (msg: string) => void }} [options]
 */
export function createAccounts(db, { log = () => {} } = {}) {
  async function createSession(q, userId) {
    const token = randomBytes(32).toString('base64url');
    await q.query(`insert into sessions (id, user_id, expires_at) values ($1, $2, now() + make_interval(days => $3))`, [hashToken(token), userId, SESSION_DAYS]);
    return token;
  }

  function setSessionCookie(req, res, token) {
    addCookie(res, cookieHeader(SESSION_COOKIE, token, { maxAge: SESSION_DAYS * 86400, secure: isHttps(req) }));
  }

  /** The session this request carries, or null. Refreshes a session that is being used. */
  async function resolve(req) {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (!token || token.length > 128) return null;
    const id = hashToken(token);
    const rows = await db.query(
      `select s.id, s.user_id, (extract(epoch from s.last_seen_at) * 1000)::float8 as seen
         from sessions s where s.id = $1 and s.expires_at > now()`,
      [id],
    );
    const row = rows[0];
    if (!row) return null;
    if (Date.now() - row.seen > TOUCH_MS) {
      await db.query(`update sessions set last_seen_at = now(), expires_at = now() + make_interval(days => $2) where id = $1`, [id, SESSION_DAYS]);
      await db.query(`update users set last_seen_at = now() where id = $1`, [row.user_id]);
    }
    return { sessionId: id, userId: row.user_id, token };
  }

  /** The request's session, creating a guest and its cookie when there is none. */
  async function ensure(req, res) {
    const existing = await resolve(req);
    if (existing) return existing;
    const { userId, token } = await db.tx(async (q) => {
      const [user] = await q.query(`insert into users default values returning id`);
      return { userId: user.id, token: await createSession(q, user.id) };
    });
    setSessionCookie(req, res, token);
    return { sessionId: hashToken(token), userId, token };
  }

  async function profile(userId, q = db) {
    const [user] = await q.query(`select id, display_name, avatar_url from users where id = $1`, [userId]);
    if (!user) return null;
    const identities = await q.query(`select provider, email from user_identities where user_id = $1 order by created_at`, [userId]);
    return {
      id: user.id,
      name: user.display_name,
      // Only ever sent to the player themselves (`GET /api/me`, `POST /api/profile`).
      email: identities.find((r) => r.email)?.email ?? null,
      avatar: user.avatar_url,
      guest: identities.length === 0,
      providers: identities.map((r) => r.provider),
    };
  }

  /** Everything saved for a user, in the shape the client stores. Absent records are null. */
  async function progress(userId, q = db) {
    const [state] = await q.query(`select money, intro_status, intro_version, rides_completed, rides_best_tip from player_state where user_id = $1`, [userId]);
    const chains = await q.query(`select chain, cleared, best from mission_progress where user_id = $1`, [userId]);
    const out = {
      wallet: state ? state.money : null,
      intro: state && state.intro_status ? { status: state.intro_status, version: state.intro_version ?? 0 } : null,
      rides: state ? { completed: state.rides_completed, bestTip: state.rides_best_tip } : null,
      rush: null,
      circuit: null,
      street: null,
    };
    for (const row of chains) out[row.chain] = { cleared: row.cleared, best: Array.isArray(row.best) ? row.best : [] };
    return out;
  }

  async function writeProgress(q, userId, p) {
    if (p.wallet !== null || p.intro || p.rides) {
      await q.query(
        `insert into player_state (user_id, money, intro_status, intro_version, rides_completed, rides_best_tip, updated_at)
         values ($1, $2, $3, $4, $5, $6, now())
         on conflict (user_id) do update set money = excluded.money, intro_status = excluded.intro_status,
           intro_version = excluded.intro_version, rides_completed = excluded.rides_completed,
           rides_best_tip = excluded.rides_best_tip, updated_at = now()`,
        [userId, p.wallet ?? 0, p.intro?.status ?? null, p.intro?.version ?? null, p.rides?.completed ?? 0, p.rides?.bestTip ?? 0],
      );
    }
    for (const chain of CHAINS) {
      const c = p[chain];
      if (!c) continue;
      await q.query(
        `insert into mission_progress (user_id, chain, cleared, best, updated_at) values ($1, $2, $3, $4, now())
         on conflict (user_id, chain) do update set cleared = excluded.cleared, best = excluded.best, updated_at = now()`,
        [userId, chain, c.cleared, JSON.stringify(c.best)],
      );
    }
  }

  /** Save what a client reports and return the record as it now stands. */
  async function saveProgress(userId, body) {
    const incoming = sanitizeProgress(body);
    return db.tx(async (q) => {
      // Serialises two saves from one player (two tabs), so neither reads the other's half-write.
      await q.query(`select id from users where id = $1 for update`, [userId]);
      const merged = mergeProgress(await progress(userId, q), incoming);
      await writeProgress(q, userId, merged);
      return merged;
    });
  }

  /** Give a player a name. `{ name }`, or `{ error: 'invalid' | 'taken' }`. */
  async function setName(userId, raw) {
    const name = claimableName(raw);
    if (!name) return { error: 'invalid' };
    try {
      const [taken] = await db.query(`select 1 from users where upper(display_name) = upper($2) and id <> $1`, [userId, name]);
      if (taken) return { error: 'taken' };
      await db.query(`update users set display_name = $2 where id = $1`, [userId, name]);
    } catch (err) {
      // Two players asking for the same name at once: the index decides.
      if (isUniqueViolation(err)) return { error: 'taken' };
      throw err;
    }
    return { name };
  }

  /** Move everything guest `fromId` has onto `toId`, and delete the guest. Inside a transaction. */
  async function mergeInto(q, fromId, toId) {
    const higher = higherIsBetter();
    await q.query(`update runs set user_id = $2 where user_id = $1`, [fromId, toId]);
    await q.query(
      `insert into personal_bests (user_id, board, value, run_id, achieved_at)
         select $2, board, value, run_id, achieved_at from personal_bests where user_id = $1
       on conflict (user_id, board) do update
         set value = excluded.value, run_id = excluded.run_id, achieved_at = excluded.achieved_at
         where case when personal_bests.board = any($3::text[]) then excluded.value > personal_bests.value
                    else excluded.value < personal_bests.value end`,
      [fromId, toId, higher],
    );
    const merged = mergeProgress(await progress(toId, q), strip(await progress(fromId, q)), { wallet: 'max' });
    await writeProgress(q, toId, merged);
    // The guest's name goes with it — once the guest is gone, since a name has one owner.
    const [guest] = await q.query(`select display_name from users where id = $1`, [fromId]);
    await q.query(`delete from users where id = $1`, [fromId]);
    await q.query(`update users set display_name = coalesce(display_name, $2) where id = $1`, [toId, guest?.display_name ?? null]);
  }

  /**
   * A provider has vouched for `identity` ({ provider, subject, email, name, avatar }). Attach it,
   * or switch to (and merge into) the account that already holds it. Returns the user id the
   * browser is signed in as afterwards.
   */
  async function signIn(req, res, identity) {
    const current = await resolve(req);
    const result = await db.tx(async (q) => {
      const [owner] = await q.query(`select user_id from user_identities where provider = $1 and provider_user_id = $2`, [identity.provider, identity.subject]);
      if (owner) {
        const accountId = owner.user_id;
        if (!current) return { userId: accountId, token: await createSession(q, accountId) };
        if (current.userId === accountId) return { userId: accountId };
        const [{ n }] = await q.query(`select count(*)::int as n from user_identities where user_id = $1`, [current.userId]);
        if (n === 0) {
          await mergeInto(q, current.userId, accountId);
          log(`accounts: merged a guest into ${identity.provider} account ${accountId}`);
          // The guest's sessions went with it (cascade); this browser gets a fresh one.
          return { userId: accountId, token: await createSession(q, accountId) };
        }
        await q.query(`update sessions set user_id = $2 where id = $1`, [current.sessionId, accountId]);
        return { userId: accountId };
      }
      // A new identity: it becomes this browser's user's, guest or not.
      let userId = current?.userId;
      let token;
      if (!userId) {
        const [user] = await q.query(`insert into users default values returning id`);
        userId = user.id;
        token = await createSession(q, userId);
      }
      await q.query(`insert into user_identities (provider, provider_user_id, user_id, email) values ($1, $2, $3, $4)`, [
        identity.provider,
        identity.subject,
        userId,
        identity.email ?? null,
      ]);
      // The provider's name, as a first name, only if nobody has it: a taken one leaves the player
      // nameless until they pick one.
      await q.query(
        `update users set display_name = coalesce(display_name,
           (select $2::text where $2::text is not null and not exists (select 1 from users where upper(display_name) = upper($2::text)))),
           avatar_url = coalesce(avatar_url, $3) where id = $1`,
        [userId, claimableName(identity.name), identity.avatar ?? null],
      );
      return { userId, token };
    });
    if (result.token) setSessionCookie(req, res, result.token);
    return result.userId;
  }

  async function signOut(req, res) {
    const current = await resolve(req);
    if (current) await db.query(`delete from sessions where id = $1`, [current.sessionId]);
    addCookie(res, cookieHeader(SESSION_COOKIE, '', { maxAge: 0, secure: isHttps(req) }));
  }

  return { resolve, ensure, profile, progress, saveProgress, setName, signIn, signOut };
}

/** A progress record with its null entries removed, so a merge only sees what was really saved. */
function strip(p) {
  const out = {};
  for (const [k, v] of Object.entries(p)) if (v !== null) out[k] = v;
  return out;
}
