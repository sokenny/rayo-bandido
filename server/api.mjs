import { addCookie, cookieHeader, createAccounts, isHttps, parseCookies } from './accounts.mjs';
import { createProviders, newFlow } from './oauth.mjs';
import { BOARDS, createScores } from './scores.mjs';

/**
 * The HTTP routes for accounts, saved progress and the boards. `handle` answers anything under
 * `/api/` or `/auth/` and returns false for everything else, which `server/index.mjs` goes on to
 * serve as the game.
 *
 *   GET  /api/me                       who this browser is (a guest is made on first call), what
 *                                      it has saved, and which sign-in providers exist
 *   POST /api/progress                 save progress; answers with the record as it now stands
 *   POST /api/profile     {name}       set the display name
 *   GET  /api/boards/:board?limit=10   the top of a board
 *   GET  /api/boards/:board/standing   this player's best and rank
 *   POST /api/boards/:board/runs       file a finished run
 *   GET  /auth/:provider/start?return= off to Google / Discord
 *   GET  /auth/:provider/callback      back from them, signed in
 *   POST /auth/logout                  end this browser's session
 *
 * SAME ORIGIN ONLY. Sessions are a cookie, so nothing here sends CORS headers; in development the
 * game reaches these through Vite's proxy (`vite.config.ts`). Every POST must say it is JSON,
 * which a cross-site form cannot, so a page elsewhere cannot spend a player's session.
 *
 * WITHOUT A DATABASE (`db` null) every route answers 503 and the client carries on with what the
 * browser remembers — the game never waits on any of this.
 */

const MAX_BODY_BYTES = 16 * 1024;
const OAUTH_COOKIE = 'rb_oauth';

export function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

function redirect(res, location) {
  res.writeHead(302, { location, 'cache-control': 'no-store' });
  res.end();
}

export function readJson(req) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.destroy();
        resolve({ error: 'body too large' });
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve({ body: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') });
      } catch {
        resolve({ error: 'malformed JSON' });
      }
    });
    req.on('error', () => resolve({ error: 'read failed' }));
  });
}

/** A same-site path to come back to after signing in, or `/`. Never another origin. */
export function safeReturn(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/';
  return value.slice(0, 512);
}

function withParam(path, key, value) {
  const url = new URL(path, 'http://x');
  url.searchParams.set(key, value);
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * @param {{ db: import('./db/index.mjs').Database | null, log?: (msg: string) => void, env?: NodeJS.ProcessEnv }} options
 */
export function createApi({ db, log = () => {}, env = process.env }) {
  const accounts = db ? createAccounts(db, { log }) : null;
  const scores = db ? createScores(db) : null;
  const providers = createProviders(env);
  const providerIds = Object.keys(providers).filter((id) => id !== 'dev');

  const origin = (req) => env.RB_PUBLIC_URL?.replace(/\/$/, '') || `${isHttps(req) ? 'https' : 'http'}://${req.headers.host}`;

  async function me(req, res) {
    const session = await accounts.ensure(req, res);
    send(res, 200, {
      user: await accounts.profile(session.userId),
      progress: await accounts.progress(session.userId),
      providers: providerIds,
    });
  }

  async function route(req, res, url) {
    const path = url.pathname;
    const post = req.method === 'POST';
    if (post && !/^application\/json\b/.test(req.headers['content-type'] || '')) return send(res, 415, { error: 'JSON only' });

    if (path === '/api/me' && req.method === 'GET') return me(req, res);

    if (path === '/api/progress' && post) {
      const { body, error } = await readJson(req);
      if (error) return send(res, 400, { error });
      const session = await accounts.ensure(req, res);
      return send(res, 200, { progress: await accounts.saveProgress(session.userId, body) });
    }

    if (path === '/api/profile' && post) {
      const { body, error } = await readJson(req);
      if (error) return send(res, 400, { error });
      const session = await accounts.ensure(req, res);
      const name = await accounts.setName(session.userId, body?.name);
      if (!name) return send(res, 400, { error: 'bad name' });
      return send(res, 200, { user: await accounts.profile(session.userId) });
    }

    const board = /^\/api\/boards\/([a-z]+)(\/standing|\/runs)?$/.exec(path);
    if (board) {
      const [, id, sub] = board;
      if (!BOARDS[id]) return send(res, 404, { error: 'unknown board' });
      if (!sub && req.method === 'GET') return send(res, 200, { board: id, entries: await scores.top(id, url.searchParams.get('limit')) });
      if (sub === '/standing' && req.method === 'GET') {
        const session = await accounts.ensure(req, res);
        return send(res, 200, await scores.standing(id, session.userId));
      }
      if (sub === '/runs' && post) {
        const { body, error } = await readJson(req);
        if (error) return send(res, 400, { error });
        const session = await accounts.ensure(req, res);
        return send(res, 200, await scores.submit(id, session.userId, body));
      }
      return send(res, 405, { error: 'method not allowed' });
    }

    if (path === '/auth/logout' && post) {
      await accounts.signOut(req, res);
      return send(res, 200, { ok: true });
    }

    const auth = /^\/auth\/([a-z]+)\/(start|callback)$/.exec(path);
    if (auth && req.method === 'GET') {
      const [, id, step] = auth;
      const provider = providers[id];
      if (!provider) return send(res, 404, { error: 'unknown provider' });
      const redirectUri = `${origin(req)}/auth/${id}/callback`;
      const secure = isHttps(req);

      if (step === 'start') {
        const flow = newFlow();
        const back = safeReturn(url.searchParams.get('return'));
        const value = [id, flow.state, flow.verifier, Buffer.from(back).toString('base64url')].join('.');
        addCookie(res, cookieHeader(OAUTH_COOKIE, value, { maxAge: 600, path: '/auth', secure }));
        return redirect(res, provider.authorizeUrl({ redirectUri, state: flow.state, challenge: flow.challenge, hint: url.searchParams }));
      }

      // The callback: the state has to match the one this browser was sent off with.
      const [cid, state, verifier, back64] = (parseCookies(req.headers.cookie)[OAUTH_COOKIE] || '').split('.');
      addCookie(res, cookieHeader(OAUTH_COOKIE, '', { maxAge: 0, path: '/auth', secure }));
      const back = safeReturn(back64 ? Buffer.from(back64, 'base64url').toString('utf8') : '/');
      const code = url.searchParams.get('code');
      if (!code || cid !== id || !state || state !== url.searchParams.get('state')) {
        log(`auth: ${id} callback refused (${url.searchParams.get('error') || 'state mismatch'})`);
        return redirect(res, withParam(back, 'auth', 'failed'));
      }
      try {
        const identity = await provider.exchange({ code, redirectUri, verifier });
        await accounts.signIn(req, res, identity);
        return redirect(res, withParam(back, 'auth', 'ok'));
      } catch (err) {
        log(`auth: ${id} sign-in failed (${err.message})`);
        return redirect(res, withParam(back, 'auth', 'failed'));
      }
    }

    return send(res, 404, { error: 'not found' });
  }

  return {
    /** Serve the request if it is one of ours. Returns false when it is not. */
    handle(req, res, url) {
      if (!url.pathname.startsWith('/api/') && !url.pathname.startsWith('/auth/')) return false;
      if (!db) {
        send(res, 503, { error: 'accounts offline' });
        return true;
      }
      route(req, res, url).catch((err) => {
        log(`api: ${req.method} ${url.pathname} failed (${err.message})`);
        if (!res.headersSent) send(res, 500, { error: 'server error' });
        else res.end();
      });
      return true;
    },
  };
}
