import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAccount } from '../src/net/account';
import { readProgressSnapshot, readWallet, setProgressObserver, writeWallet, type ProgressSnapshot } from '../src/core/progress';

/**
 * The account's sync (`src/net/account.ts`), against a pretend server.
 *
 * What is worth pinning here is the one rule that is not "both sides only move forward": MONEY.
 * A balance goes down when it is spent, so which side's number stands has to be decided, and the
 * wrong decision either wipes a wallet or resurrects money that was already spent. The server's
 * own merge (`server/accounts.mjs`) is covered end to end by `tests/accounts.test.ts`; the
 * pretend server here only records what it was sent and answers like the real one would.
 */

const EMPTY: ProgressSnapshot = { wallet: null, intro: null, rides: null, rush: null, circuit: null, street: null };

interface FakeServer {
  progress: ProgressSnapshot;
  name: string | null;
  posts: Array<Partial<ProgressSnapshot>>;
  profiles: string[];
  offline: boolean;
}

let store: Map<string, string>;
let server: FakeServer;

function installStorage(seed: Record<string, string> = {}): void {
  store = new Map(Object.entries(seed));
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  };
}

function reply(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

function installServer(initial: Partial<FakeServer> = {}): void {
  server = { progress: { ...EMPTY }, name: null, posts: [], profiles: [], offline: false, ...initial };
  vi.stubGlobal('fetch', async (path: string, init: RequestInit = {}) => {
    if (server.offline) throw new TypeError('fetch failed');
    const body = init.body ? JSON.parse(String(init.body)) : null;
    if (path === '/api/me') {
      return reply({ user: { id: 'u1', name: server.name, avatar: null, guest: true, providers: [] }, progress: server.progress, providers: [] });
    }
    if (path === '/api/progress') {
      server.posts.push(body);
      // The real server folds these; for what is tested here, "take what was sent" is enough.
      server.progress = { ...server.progress, ...body };
      return reply({ progress: server.progress });
    }
    if (path === '/api/profile') {
      server.profiles.push(body.name);
      server.name = String(body.name).toUpperCase();
      return reply({ user: { id: 'u1', name: server.name, avatar: null, guest: true, providers: [] } });
    }
    return new Response('{}', { status: 404 });
  });
}

beforeEach(() => {
  installStorage();
});

afterEach(() => {
  setProgressObserver(null);
  vi.unstubAllGlobals();
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe('the account sync', () => {
  it('hands over a wallet earned before accounts existed, once', async () => {
    installStorage({ 'rb.wallet': '750' });
    installServer();
    await createAccount().ready(1000);
    expect(server.posts[0].wallet).toBe(750);
    expect(readWallet()).toBe(750);
  });

  it('takes the server’s balance when this browser has nothing unsent', async () => {
    installStorage({ 'rb.wallet': '750' });
    installServer({ progress: { ...EMPTY, wallet: 3000 } });
    await createAccount().ready(1000);
    // Money this browser merely remembers is not a report: it is not sent, and it is replaced.
    expect(server.posts.every((p) => !('wallet' in p))).toBe(true);
    expect(readWallet()).toBe(3000);
  });

  it('sends this browser’s balance when it changed and never reached the server', async () => {
    installStorage({ 'rb.wallet': '120', 'rb.sync.pending': '1' });
    installServer({ progress: { ...EMPTY, wallet: 3000 } });
    await createAccount().ready(1000);
    expect(server.posts[0].wallet).toBe(120);
    expect(readWallet()).toBe(120);
    expect(store.has('rb.sync.pending')).toBe(false);
  });

  it('writes the server’s record into storage before a world is built from it', async () => {
    installServer({
      progress: {
        ...EMPTY,
        wallet: 55,
        rush: { cleared: 2, best: [900, 1900, -1] },
        intro: { status: 'completed', version: 2 },
      },
    });
    await createAccount().ready(1000);
    const local = readProgressSnapshot();
    expect(local.wallet).toBe(55);
    expect(local.rush).toEqual({ cleared: 2, best: [900, 1900, -1] });
    expect(local.intro).toEqual({ status: 'completed', version: 2 });
    // And writing the server's own record down did not queue it to be sent back.
    expect(store.has('rb.sync.pending')).toBe(false);
  });

  it('sends a write made during play, and clears the mark once it is taken', async () => {
    installServer({ progress: { ...EMPTY, wallet: 100 } });
    const acct = createAccount();
    await acct.ready(1000);
    writeWallet(400);
    expect(store.has('rb.sync.pending')).toBe(true);
    await acct.flush();
    expect(server.posts.at(-1)?.wallet).toBe(400);
    expect(store.has('rb.sync.pending')).toBe(false);
  });

  it('keeps playing from storage when the server cannot be reached', async () => {
    installStorage({ 'rb.wallet': '640' });
    installServer({ offline: true });
    const state = await createAccount().ready(1000);
    expect(state.online).toBe(false);
    expect(readWallet()).toBe(640);
    // A write while offline is kept for later rather than lost.
    writeWallet(700);
    expect(store.get('rb.sync.pending')).toBeTruthy();
  });

  it('gives the account a name from the lobby when it has none, and takes the account’s when it has one', async () => {
    installStorage({ 'rb.name': 'kaito' });
    installServer();
    await createAccount().ready(1000);
    await vi.waitFor(() => expect(server.profiles).toEqual(['kaito']));

    installStorage({ 'rb.name': 'old name' });
    installServer({ name: 'LA VIUDA' });
    await createAccount().ready(1000);
    expect(store.get('rb.name')).toBe('LA VIUDA');
  });
});
