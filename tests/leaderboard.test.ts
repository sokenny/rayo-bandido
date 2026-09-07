import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RUSH_DAILY_ATTEMPTS } from '../src/net/protocol';
import { RUSH } from '../src/config/tuning';

/**
 * The RAYO RUSH board, end to end: a real `node server/index.mjs` on a real port, spoken to
 * over the same three HTTP routes the game uses.
 *
 * Black box, for the same reason `tests/matchServer.test.ts` is: the server is plain
 * JavaScript outside the TypeScript project, so it is started the way a player starts it and
 * only ever addressed over the wire. It is given a throwaway `RB_DATA_DIR`, so a test run
 * never touches a real board and never leaves one behind.
 */

const ENTRY = fileURLToPath(new URL('../server/index.mjs', import.meta.url));
const ROOT = fileURLToPath(new URL('..', import.meta.url));

let server: ChildProcessWithoutNullStreams;
let port = 0;
let dataDir = '';

function startServer(): Promise<number> {
  return new Promise((resolve, reject) => {
    server = spawn(process.execPath, [ENTRY, '--port', '0'], {
      cwd: ROOT,
      env: { ...process.env, RB_DATA_DIR: dataDir },
    });
    const timer = setTimeout(() => reject(new Error('the match server did not start in time')), 10_000);
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

const url = (path: string): string => `http://127.0.0.1:${port}${path}`;

async function get<T>(path: string): Promise<T> {
  const response = await fetch(url(path));
  return (await response.json()) as T;
}

async function post<T>(path: string, body: unknown): Promise<{ status: number; body: T }> {
  const response = await fetch(url(path), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as T };
}

/** A distinct client id per test, so one test's spent allowance is not another's. */
let seq = 0;
const freshCid = (): string => `test-client-${(seq++).toString().padStart(4, '0')}-aaaa`;

const run = (score: number) => ({ score, disabled: Math.max(1, Math.round(score / 100)), bestChain: 3, styleBonus: 0 });

interface SubmitBody {
  accepted?: boolean;
  improved?: boolean;
  rank?: number;
  best?: number;
  attemptsLeft?: number;
  reason?: string;
  entries?: Array<{ rank: number; name: string; score: number }>;
}

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'rb-board-'));
  port = await startServer();
}, 20_000);

afterAll(() => {
  server?.kill();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

describe('rayo rush board', () => {
  it('agrees with the game about the daily allowance', async () => {
    const body = await get<{ dailyAttempts: number }>('/leaderboard?board=rush');
    expect(body.dailyAttempts).toBe(RUSH_DAILY_ATTEMPTS);
    // And the number the rules play by is the number the server enforces.
    expect(RUSH.dailyRankedAttempts).toBe(RUSH_DAILY_ATTEMPTS);
  });

  it('starts a new player on a full allowance and no best', async () => {
    const cid = freshCid();
    const body = await get<{ attemptsLeft: number; best: number; rank: number }>(`/rush/attempts?cid=${cid}`);
    expect(body.attemptsLeft).toBe(RUSH_DAILY_ATTEMPTS);
    expect(body.best).toBe(-1);
    expect(body.rank).toBe(-1);
  });

  it('files a run, ranks it, and spends one of the day’s attempts', async () => {
    const cid = freshCid();
    const { body } = await post<SubmitBody>('/rush/score', { cid, name: 'JUAN', ...run(4200) });
    expect(body.accepted).toBe(true);
    expect(body.best).toBe(4200);
    expect(body.rank).toBeGreaterThan(0);
    expect(body.attemptsLeft).toBe(RUSH_DAILY_ATTEMPTS - 1);

    const standing = await get<{ attemptsLeft: number; best: number }>(`/rush/attempts?cid=${cid}`);
    expect(standing.attemptsLeft).toBe(RUSH_DAILY_ATTEMPTS - 1);
    expect(standing.best).toBe(4200);
  });

  it('keeps one row per player: their best, with a worse run still spending an attempt', async () => {
    const cid = freshCid();
    await post<SubmitBody>('/rush/score', { cid, name: 'ONE ROW', ...run(9000) });
    const { body } = await post<SubmitBody>('/rush/score', { cid, name: 'ONE ROW', ...run(1000) });
    expect(body.accepted).toBe(true);
    expect(body.improved).toBe(false);
    expect(body.best).toBe(9000);
    expect(body.attemptsLeft).toBe(RUSH_DAILY_ATTEMPTS - 2);

    const board = await get<{ entries: Array<{ name: string; score: number }> }>('/leaderboard?board=rush&limit=50');
    expect(board.entries.filter((e) => e.name === 'ONE ROW')).toHaveLength(1);
  });

  it('refuses a run once the day’s attempts are spent', async () => {
    const cid = freshCid();
    for (let i = 0; i < RUSH_DAILY_ATTEMPTS; i++) {
      const { body } = await post<SubmitBody>('/rush/score', { cid, name: 'SPENT', ...run(100 + i) });
      expect(body.accepted).toBe(true);
    }
    const { body } = await post<SubmitBody>('/rush/score', { cid, name: 'SPENT', ...run(999_9) });
    expect(body.accepted).toBe(false);
    expect(body.reason).toBe('noAttempts');
    expect(body.attemptsLeft).toBe(0);
  });

  it('refuses a score that is not a plausible run, without spending an attempt', async () => {
    const cid = freshCid();
    const nonsense = [
      { cid, name: 'X', score: -5, disabled: 1, bestChain: 1, styleBonus: 0 },
      { cid, name: 'X', score: 1e12, disabled: 1, bestChain: 1, styleBonus: 0 },
      { cid, name: 'X', score: 500, disabled: 0, bestChain: 1, styleBonus: 0 },
      { cid, name: 'X', score: 500, disabled: 1, bestChain: 1, styleBonus: 900 },
      { cid, name: 'X', score: 'lots', disabled: 1, bestChain: 1, styleBonus: 0 },
    ];
    for (const body of nonsense) {
      const result = await post<SubmitBody>('/rush/score', body);
      expect(result.body.accepted).toBe(false);
    }
    const standing = await get<{ attemptsLeft: number }>(`/rush/attempts?cid=${cid}`);
    expect(standing.attemptsLeft).toBe(RUSH_DAILY_ATTEMPTS);
  });

  it('refuses a client id that is not one', async () => {
    const { body } = await post<SubmitBody>('/rush/score', { cid: 'no spaces allowed', name: 'X', ...run(100) });
    expect(body.accepted).toBe(false);
    expect(body.reason).toBe('badClient');
  });

  it('ranks the board highest first', async () => {
    const scores = [12_000, 6000, 300];
    for (const score of scores) {
      await post<SubmitBody>('/rush/score', { cid: freshCid(), name: `S${score}`, ...run(score) });
    }
    const board = await get<{ entries: Array<{ rank: number; score: number }> }>('/leaderboard?board=rush&limit=50');
    for (let i = 1; i < board.entries.length; i++) {
      expect(board.entries[i - 1].score).toBeGreaterThanOrEqual(board.entries[i].score);
      expect(board.entries[i].rank).toBe(i + 1);
    }
    expect(board.entries[0].score).toBeGreaterThanOrEqual(12_000);
  });

  it('answers an unknown board with a 400 rather than an empty one', async () => {
    const response = await fetch(url('/leaderboard?board=nope'));
    expect(response.status).toBe(400);
  });

  it('does not swallow the routes the rest of the server owns', async () => {
    const rooms = await get<{ rooms: unknown[] }>('/rooms');
    expect(Array.isArray(rooms.rooms)).toBe(true);
    const health = await get<{ ok: boolean }>('/health');
    expect(health.ok).toBe(true);
  });
});
