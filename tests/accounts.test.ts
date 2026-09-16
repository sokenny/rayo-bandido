import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Accounts, saved progress and the high-score boards, end to end: a real `node server/index.mjs`
 * on a real port, backed by a real Postgres (PGlite, in memory), spoken to over HTTP the way the
 * game speaks to it.
 *
 * Black box, for the same reason `tests/matchServer.test.ts` is: the server is plain JavaScript
 * outside the TypeScript project. Each `browser()` is its own cookie jar, so "two devices" is two
 * jars; `RB_AUTH_DEV=1` gives the server a pretend sign-in provider to link them with.
 */

const ENTRY = fileURLToPath(new URL('../server/index.mjs', import.meta.url));
const ROOT = fileURLToPath(new URL('..', import.meta.url));

let server: ChildProcessWithoutNullStreams;
let port = 0;

function startServer(): Promise<number> {
  return new Promise((resolve, reject) => {
    server = spawn(process.execPath, [ENTRY, '--port', '0'], {
      cwd: ROOT,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        RB_DATABASE_URL: 'memory://',
        RB_AUTH_DEV: '1',
        // Blank so a developer's local `.env` (real OAuth creds, for testing sign-in by hand)
        // can never leak into this suite: `loadEnvFile` never overrides a variable already set.
        RB_GOOGLE_CLIENT_ID: '',
        RB_GOOGLE_CLIENT_SECRET: '',
        RB_DISCORD_CLIENT_ID: '',
        RB_DISCORD_CLIENT_SECRET: '',
      },
    });
    const timer = setTimeout(() => reject(new Error('the server did not start in time')), 30_000);
    server.stdout.on('data', (chunk: Buffer) => {
      const match = /http:\/\/127\.0\.0\.1:(\d+)/.exec(chunk.toString());
      if (match) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    });
    server.on('error', reject);
  });
}

interface Browser {
  get<T>(path: string): Promise<{ status: number; body: T }>;
  post<T>(path: string, body: unknown): Promise<{ status: number; body: T }>;
  /** Follow a sign-in through the dev provider; resolves with where it lands. */
  signIn(sub: string, name: string, back?: string): Promise<string>;
}

function browser(): Browser {
  const jar = new Map<string, string>();
  const cookie = (): string => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const keep = (response: Response): void => {
    for (const line of response.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(';');
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (attrs.some((a) => /max-age=0\b/i.test(a.trim())) || value === '') jar.delete(name);
      else jar.set(name, value);
    }
  };
  const url = (path: string): string => (path.startsWith('http') ? path : `http://127.0.0.1:${port}${path}`);
  async function request<T>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T; response: Response }> {
    const response = await fetch(url(path), { ...init, redirect: 'manual', headers: { ...(init.headers || {}), cookie: cookie() } });
    keep(response);
    const text = await response.text();
    return { status: response.status, body: (text ? JSON.parse(text) : null) as T, response };
  }
  return {
    get: (path) => request(path),
    post: (path, body) => request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    async signIn(sub, name, back = '/?mode=city') {
      const start = await fetch(url(`/auth/dev/start?sub=${sub}&name=${encodeURIComponent(name)}&return=${encodeURIComponent(back)}`), {
        redirect: 'manual',
        headers: { cookie: cookie() },
      });
      keep(start);
      const callback = await fetch(url(start.headers.get('location')!), { redirect: 'manual', headers: { cookie: cookie() } });
      keep(callback);
      return callback.headers.get('location') || '';
    },
  };
}

interface Me {
  user: { id: string; name: string | null; guest: boolean; providers: string[] };
  progress: {
    wallet: number | null;
    intro: { status: string; version: number } | null;
    rides: { completed: number; bestTip: number } | null;
    rush: { cleared: number; best: number[] } | null;
    circuit: { cleared: number; best: number[] } | null;
    street: { cleared: number; best: number[] } | null;
  };
  providers: string[];
}

interface Submit {
  accepted: boolean;
  improved?: boolean;
  reason?: string;
  best?: number;
  rank?: number;
  previousBest?: number;
  entries?: Array<{ rank: number; name: string; value: number }>;
}

const rushRun = (score: number) => ({ score, disabled: Math.max(1, Math.round(score / 100)), bestChain: 3, styleBonus: 0 });

beforeAll(async () => {
  port = await startServer();
}, 40_000);

afterAll(() => {
  server?.kill();
});

describe('accounts', () => {
  it('makes a guest on the first visit and remembers it by cookie', async () => {
    const b = browser();
    const first = await b.get<Me>('/api/me');
    expect(first.status).toBe(200);
    expect(first.body.user.guest).toBe(true);
    expect(first.body.progress.wallet).toBeNull();
    const again = await b.get<Me>('/api/me');
    expect(again.body.user.id).toBe(first.body.user.id);
    // A different browser is a different guest.
    const other = await browser().get<Me>('/api/me');
    expect(other.body.user.id).not.toBe(first.body.user.id);
  });

  it('only lists providers that are configured, never the dev one', async () => {
    const { body } = await browser().get<Me>('/api/me');
    expect(body.providers).toEqual([]);
  });

  it('saves progress and merges it the way the game records it', async () => {
    const b = browser();
    await b.post('/api/progress', {
      wallet: 1200,
      intro: { status: 'skipped', version: 2 },
      rides: { completed: 3, bestTip: 40 },
      rush: { cleared: 2, best: [900, 2000, -1] },
      circuit: { cleared: 1, best: [150.25, -1, -1] },
    });
    // A second save from an older tab: money follows the latest report, nothing else goes backwards.
    const { body } = await b.post<{ progress: Me['progress'] }>('/api/progress', {
      wallet: 800,
      intro: { status: 'completed', version: 2 },
      rides: { completed: 1, bestTip: 90 },
      rush: { cleared: 1, best: [1500, 1000, -1] },
      circuit: { cleared: 0, best: [149.5, -1, -1] },
    });
    expect(body.progress.wallet).toBe(800);
    expect(body.progress.intro).toEqual({ status: 'completed', version: 2 });
    expect(body.progress.rides).toEqual({ completed: 3, bestTip: 90 });
    expect(body.progress.rush).toEqual({ cleared: 2, best: [1500, 2000, -1] });
    expect(body.progress.circuit).toEqual({ cleared: 1, best: [149.5, -1, -1] });
    const me = await b.get<Me>('/api/me');
    expect(me.body.progress).toEqual(body.progress);
  });

  it('ignores progress that is not progress', async () => {
    const b = browser();
    await b.post('/api/progress', { wallet: -5, intro: { status: 'hacked', version: 1 }, rush: { cleared: 'all', best: [] } });
    const me = await b.get<Me>('/api/me');
    expect(me.body.progress.wallet).toBeNull();
    expect(me.body.progress.intro).toBeNull();
    expect(me.body.progress.rush).toBeNull();
  });

  it('refuses a POST that does not say it is JSON', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api/progress`, { method: 'POST', body: '{"wallet":5}' });
    expect(response.status).toBe(415);
  });

  it('sets a display name the way the boards write names', async () => {
    const b = browser();
    const { body } = await b.post<{ user: Me['user'] }>('/api/profile', { name: '  kaito   the <b>great</b> ' });
    expect(body.user.name).toBe('KAITO THE BGRE');
    const bad = await b.post('/api/profile', { name: '<<<>>>' });
    expect(bad.status).toBe(400);
  });

  it('turns a guest into an account on first sign-in, keeping everything', async () => {
    const b = browser();
    const guest = await b.get<Me>('/api/me');
    await b.post('/api/progress', { wallet: 500 });
    const landed = await b.signIn('first-timer', 'Luz');
    expect(landed).toBe('/?mode=city&auth=ok');
    const me = await b.get<Me>('/api/me');
    expect(me.body.user.id).toBe(guest.body.user.id);
    expect(me.body.user.guest).toBe(false);
    expect(me.body.user.providers).toEqual(['dev']);
    expect(me.body.user.name).toBe('LUZ');
    expect(me.body.progress.wallet).toBe(500);
  });

  it('merges a second device’s guest into the account it signs in to', async () => {
    const laptop = browser();
    await laptop.get('/api/me');
    await laptop.signIn('two-devices', 'Rayo');
    await laptop.post('/api/progress', { wallet: 3000, rush: { cleared: 1, best: [800, -1, -1] }, intro: { status: 'completed', version: 2 } });
    await laptop.post('/api/boards/circuit/runs', { ms: 150_000 });
    const account = (await laptop.get<Me>('/api/me')).body.user.id;

    const phone = browser();
    await phone.get('/api/me');
    await phone.post('/api/progress', { wallet: 400, rush: { cleared: 2, best: [700, 1900, -1] } });
    await phone.post('/api/boards/circuit/runs', { ms: 140_000 });
    await phone.post('/api/boards/street/runs', { ms: 99_000 });
    await phone.signIn('two-devices', 'Rayo');

    const me = await phone.get<Me>('/api/me');
    expect(me.body.user.id).toBe(account);
    expect(me.body.progress.wallet).toBe(3000);
    expect(me.body.progress.rush).toEqual({ cleared: 2, best: [800, 1900, -1] });
    expect(me.body.progress.intro).toEqual({ status: 'completed', version: 2 });
    const circuit = await phone.get<{ best: number }>('/api/boards/circuit/standing');
    expect(circuit.body.best).toBe(140_000);
    const street = await phone.get<{ best: number }>('/api/boards/street/standing');
    expect(street.body.best).toBe(99_000);
    // Both devices are the same player now.
    expect((await laptop.get<Me>('/api/me')).body.user.id).toBe(account);
  });

  it('signs out, and the browser is a fresh guest afterwards', async () => {
    const b = browser();
    await b.signIn('leaver', 'Bye');
    const before = await b.get<Me>('/api/me');
    await b.post('/auth/logout', {});
    const after = await b.get<Me>('/api/me');
    expect(after.body.user.guest).toBe(true);
    expect(after.body.user.id).not.toBe(before.body.user.id);
  });

  it('refuses a callback whose state does not match', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/auth/dev/callback?code=x&state=y`, { redirect: 'manual' });
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/?auth=failed');
  });

  it('never redirects off-site after signing in', async () => {
    const landed = await browser().signIn('open-redirect', 'X', '//evil.example/');
    expect(landed).toBe('/?auth=ok');
  });
});

describe('boards', () => {
  it('starts a new player with no best and no place on a board', async () => {
    const { body } = await browser().get<{ best: number; rank: number; attemptsLeft?: number }>('/api/boards/rush/standing');
    expect(body.best).toBe(-1);
    expect(body.rank).toBe(-1);
    expect(body.attemptsLeft).toBeUndefined();
  });

  it('files a rush run and ranks it', async () => {
    const b = browser();
    await b.post('/api/profile', { name: 'juan' });
    const { body } = await b.post<Submit>('/api/boards/rush/runs', rushRun(4200));
    expect(body.accepted).toBe(true);
    expect(body.best).toBe(4200);
    expect(body.rank).toBeGreaterThan(0);
    expect(body.entries?.some((e) => e.name === 'JUAN' && e.value === 4200)).toBe(true);
  });

  it('keeps one row per player — their best — and records a worse run without moving it', async () => {
    const b = browser();
    await b.post('/api/profile', { name: 'ONE ROW' });
    await b.post<Submit>('/api/boards/rush/runs', rushRun(9000));
    const { body } = await b.post<Submit>('/api/boards/rush/runs', rushRun(1000));
    expect(body.accepted).toBe(true);
    expect(body.improved).toBe(false);
    expect(body.previousBest).toBe(9000);
    expect(body.best).toBe(9000);
    const board = await b.get<{ entries: Array<{ name: string }> }>('/api/boards/rush?limit=50');
    expect(board.body.entries.filter((e) => e.name === 'ONE ROW')).toHaveLength(1);
  });

  it('counts every rush run: there is no daily limit', async () => {
    const b = browser();
    for (let i = 0; i < 6; i++) expect((await b.post<Submit>('/api/boards/rush/runs', rushRun(100 + i * 100))).body.accepted).toBe(true);
    const { body } = await b.post<Submit>('/api/boards/rush/runs', rushRun(9900));
    expect(body.accepted).toBe(true);
    expect(body.best).toBe(9900);
  });

  it('refuses runs that are not plausible', async () => {
    const b = browser();
    for (const run of [
      { score: -5, disabled: 1, bestChain: 1, styleBonus: 0 },
      { score: 1e12, disabled: 1, bestChain: 1, styleBonus: 0 },
      { score: 500, disabled: 0, bestChain: 1, styleBonus: 0 },
      { score: 500, disabled: 1, bestChain: 1, styleBonus: 900 },
      { score: 500, disabled: 1, bestChain: 1, styleBonus: 900, crashPenalty: 300 },
      { score: 500, disabled: 0, bestChain: 1, styleBonus: 0, nearMissPoints: 200 },
      { score: 'lots', disabled: 1, bestChain: 1, styleBonus: 0 },
    ]) {
      expect((await b.post<Submit>('/api/boards/rush/runs', run)).body.accepted).toBe(false);
    }
    expect((await b.post<Submit>('/api/boards/circuit/runs', { ms: 500 })).body.accepted).toBe(false);
    expect((await b.post<Submit>('/api/boards/street/runs', { ms: 'fast' })).body.accepted).toBe(false);
    const standing = await b.get<{ best: number }>('/api/boards/rush/standing');
    expect(standing.body.best).toBe(-1);
  });

  it('ranks the timed boards fastest first, and never limits their runs', async () => {
    for (const ms of [131_000, 125_500, 140_250]) {
      const b = browser();
      for (let i = 0; i < 5; i++) expect((await b.post<Submit>('/api/boards/street/runs', { ms: ms + i * 10 })).body.accepted).toBe(true);
    }
    const board = await browser().get<{ entries: Array<{ rank: number; value: number }> }>('/api/boards/street?limit=50');
    const values = board.body.entries.map((e) => e.value);
    expect(values).toEqual([...values].sort((a, b) => a - b));
    expect(board.body.entries.map((e) => e.rank)).toEqual(values.map((_, i) => i + 1));
  });

  it('ranks rush highest first', async () => {
    for (const score of [12_000, 6000, 300]) await browser().post('/api/boards/rush/runs', rushRun(score));
    const board = await browser().get<{ entries: Array<{ value: number }> }>('/api/boards/rush?limit=50');
    const values = board.body.entries.map((e) => e.value);
    expect(values).toEqual([...values].sort((a, b) => b - a));
  });

  it('answers an unknown board with a 404', async () => {
    expect((await browser().get('/api/boards/nope')).status).toBe(404);
  });

  it('does not swallow the routes the rest of the server owns', async () => {
    const b = browser();
    expect(Array.isArray((await b.get<{ rooms: unknown[] }>('/rooms')).body.rooms)).toBe(true);
    expect((await b.get<{ ok: boolean }>('/health')).body.ok).toBe(true);
  });
});
