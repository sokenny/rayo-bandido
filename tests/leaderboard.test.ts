import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The outbox in `src/net/leaderboard.ts`: a run a saturated or unreachable server could not take
 * is kept and sent again, and one the server refused on its merits is not.
 */

const OUTBOX_KEY = 'rb.boards.outbox';

// The outbox's retry timer is module state, so every test gets a module of its own.
let board: typeof import('../src/net/leaderboard');
let store: Map<string, string>;
let status: number | 'offline';
let posts: string[];

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  board = await import('../src/net/leaderboard');
  store = new Map();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  };
  status = 200;
  posts = [];
  vi.stubGlobal('fetch', async (path: string) => {
    posts.push(path);
    if (status === 'offline') throw new TypeError('fetch failed');
    return new Response(JSON.stringify({ accepted: status === 200 }), { status });
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

const outbox = () => JSON.parse(store.get(OUTBOX_KEY) || '[]') as Array<{ url: string; body: { ms: number } }>;

describe('leaderboard outbox', () => {
  it('should keep a run the server was too busy to take and send it once it recovers', async () => {
    status = 503;
    expect(await board.submitRaceTime('circuit', 80)).toBe(false);
    expect(outbox()).toHaveLength(1);
    expect(outbox()[0]).toMatchObject({ url: '/api/boards/circuit/runs', body: { ms: 80_000 } });

    status = 200;
    await board.flushPendingRuns();
    expect(outbox()).toHaveLength(0);
    expect(posts).toEqual(['/api/boards/circuit/runs', '/api/boards/circuit/runs']);
  });

  it('should keep a run when the server cannot be reached at all', async () => {
    status = 'offline';
    await board.submitRaceTime('street', 95);
    expect(outbox()).toHaveLength(1);
  });

  it('should retry on its own after a while', async () => {
    status = 503;
    await board.submitRaceTime('circuit', 80);
    status = 200;
    await vi.advanceTimersByTimeAsync(31_000);
    expect(outbox()).toHaveLength(0);
  });

  it('should send waiting runs after the next run that gets through', async () => {
    status = 429;
    await board.submitRaceTime('circuit', 80);
    status = 200;
    expect(await board.submitRaceTime('street', 95)).toBe(true);
    await board.flushPendingRuns();
    expect(outbox()).toHaveLength(0);
    expect(posts.filter((p) => p === '/api/boards/circuit/runs')).toHaveLength(2);
  });

  it('should drop a run the server refused on its merits', async () => {
    status = 400;
    await board.submitRaceTime('circuit', 80);
    expect(store.has(OUTBOX_KEY)).toBe(false);
  });

  it('should leave the outbox alone while the server is still down', async () => {
    status = 503;
    await board.submitRaceTime('circuit', 80);
    await board.submitRaceTime('circuit', 81);
    await board.flushPendingRuns();
    expect(outbox()).toHaveLength(2);
  });

  it('should forget unsent runs when the player signs out', async () => {
    status = 503;
    await board.submitRaceTime('circuit', 80);
    board.clearBoardMirror();
    expect(store.has(OUTBOX_KEY)).toBe(false);
  });
});
