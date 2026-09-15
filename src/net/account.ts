import {
  applyProgressSnapshot,
  clearSavedProgress,
  readProgressSnapshot,
  setProgressObserver,
  type ProgressSnapshot,
} from '../core/progress';
import { clearBoardMirror } from './leaderboard';
import { sanitizeName } from './protocol';

/**
 * THE PLAYER'S ACCOUNT, from the client's side (`server/api.mjs` is the other half).
 *
 * Every browser has one. The first `GET /api/me` makes a guest on the server and a session cookie
 * for it; signing in with Google or Discord attaches that login to the account, and on a second
 * device merges that device's guest into it. The game itself never sees any of this: it reads
 * and writes `src/core/progress.ts` exactly as before, and this module keeps that storage and the
 * server in step.
 *
 * THE SYNC, in two moves:
 *
 *   AT BOOT (`start`): ask the server what it has, send it anything this browser has that it does
 *   not, and write the result into storage — before a world is built, so the world is built from
 *   it. Mission chains, bests, the intro and the rides only ever move forward, so both sides can
 *   be folded together safely. MONEY cannot: it goes down when it is spent. So the browser's
 *   balance is only sent when it has changed since the server last took it (`PENDING_KEY`), or
 *   when the server has never had one — which is the one-time hand-over of a wallet that was
 *   earned before accounts existed.
 *
 *   AFTER EVERY WRITE: the record is sent a moment later (debounced), and on the way out of the
 *   page — every world change is a page load — anything still unsent goes with `keepalive`.
 *
 * THE GAME NEVER WAITS FOR MORE THAN A MOMENT. `ready(ms)` resolves when the boot sync is done or
 * when `ms` has passed, whichever is first; a server that is down means a session played from
 * storage, exactly as the game worked before accounts.
 */

export interface AccountUser {
  id: string;
  /** NULL on the server until a name is chosen or a provider supplies one. */
  name: string | null;
  avatar: string | null;
  guest: boolean;
  /** The logins attached to this account ('google', 'discord'). */
  providers: string[];
}

export interface AccountState {
  /** False until the server has answered; `user` is null while it is. */
  online: boolean;
  user: AccountUser | null;
  /** The sign-in providers this server offers. Empty when none are configured. */
  providers: string[];
  /** `?auth=` on arrival: how a sign-in round trip just ended, once. */
  authResult: 'ok' | 'failed' | null;
}

export interface Account {
  readonly state: AccountState;
  /** Resolves once the boot sync is done, or after `timeoutMs`, whichever comes first. */
  ready(timeoutMs?: number): Promise<AccountState>;
  /** Called whenever `state` changes. Returns an unsubscribe. */
  onChange(fn: (state: AccountState) => void): () => void;
  /** Send anything unsent now. Resolves when it has gone (or failed). */
  flush(): Promise<void>;
  /** Off to a provider; comes back to the page it left. */
  signIn(provider: string): Promise<void>;
  /** End the session and start this browser over as a new guest. Reloads the page. */
  signOut(): Promise<void>;
  /** The lobby's name, saved to the account. */
  setName(name: string): void;
}

const ME_PATH = '/api/me';
const PROGRESS_PATH = '/api/progress';
const PROFILE_PATH = '/api/profile';
/** Set while this browser holds a write the server has not acknowledged. */
const PENDING_KEY = 'rb.sync.pending';
const NAME_KEY = 'rb.name';
const TIMEOUT_MS = 5000;
/** How long after a write the record is sent, so a burst of writes is one request. */
const DEBOUNCE_MS = 1500;
/** The longest a world build waits for the boot sync by default. */
const READY_MS = 2500;

interface MeBody {
  user: AccountUser;
  progress: ProgressSnapshot;
  providers: string[];
}

function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T | null> {
  if (typeof fetch !== 'function') return null;
  try {
    const response = await fetch(path, {
      cache: 'no-store',
      credentials: 'same-origin',
      signal: init.keepalive ? undefined : AbortSignal.timeout(TIMEOUT_MS),
      ...init,
      headers: init.body ? { 'content-type': 'application/json', ...(init.headers || {}) } : init.headers,
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

/** The `?auth=` a sign-in came back with, removed from the address so a reload does not repeat it. */
function takeAuthResult(): AccountState['authResult'] {
  if (typeof location === 'undefined') return null;
  const params = new URLSearchParams(location.search);
  const value = params.get('auth');
  if (value === null) return null;
  params.delete('auth');
  const query = params.toString();
  history.replaceState(history.state, '', `${location.pathname}${query ? `?${query}` : ''}${location.hash}`);
  return value === 'ok' ? 'ok' : 'failed';
}

/**
 * What this browser should send: its whole record, less the money unless the money is the
 * browser's to report (see the block comment).
 */
function outgoing(serverHasWallet: boolean): Partial<ProgressSnapshot> {
  const local = readProgressSnapshot();
  const body: Partial<ProgressSnapshot> = { ...local };
  const walletIsOurs = storageGet(PENDING_KEY) !== null || !serverHasWallet;
  if (!walletIsOurs || local.wallet === null) delete body.wallet;
  for (const key of Object.keys(body) as Array<keyof ProgressSnapshot>) if (body[key] === null) delete body[key];
  return body;
}

export function createAccount(): Account {
  const state: AccountState = { online: false, user: null, providers: [], authResult: takeAuthResult() };
  const listeners = new Set<(s: AccountState) => void>();
  const emit = (): void => {
    for (const fn of listeners) fn(state);
  };

  /** Bumped by every local write, so a response can tell whether the browser moved on meanwhile. */
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let sending: Promise<void> | null = null;
  /** Whether the boot sync has put the server's record in storage yet. Writes before it wait. */
  let booted = false;

  async function send(): Promise<void> {
    const sentAt = generation;
    const body = outgoing(true);
    const response = await request<{ progress: ProgressSnapshot }>(PROGRESS_PATH, { method: 'POST', body: JSON.stringify(body) });
    if (!response) return;
    // The merged record comes back. Money is written only if nothing was spent or earned while
    // the request was out; otherwise the browser's newer balance stands and goes next time.
    const unchanged = generation === sentAt;
    applyProgressSnapshot(response.progress, { wallet: unchanged });
    if (unchanged) storageSet(PENDING_KEY, null);
  }

  function flush(): Promise<void> {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (!booted || storageGet(PENDING_KEY) === null) return sending ?? Promise.resolve();
    if (!sending) {
      sending = send().finally(() => {
        sending = null;
        // Something was written while that was out: it goes too.
        if (storageGet(PENDING_KEY) !== null && timer === null) schedule();
      });
    }
    return sending;
  }

  function schedule(): void {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, DEBOUNCE_MS);
  }

  setProgressObserver(() => {
    generation++;
    storageSet(PENDING_KEY, String(Date.now()));
    schedule();
  });

  const boot = (async () => {
    const me = await request<MeBody>(ME_PATH);
    if (!me) return;
    state.online = true;
    state.user = me.user;
    state.providers = me.providers ?? [];

    // Anything this browser has that the server lacks goes up, and the merged record comes back.
    const serverHasWallet = me.progress.wallet !== null;
    const sentAt = generation;
    const body = outgoing(serverHasWallet);
    let record = me.progress;
    if (Object.keys(body).length > 0) {
      const saved = await request<{ progress: ProgressSnapshot }>(PROGRESS_PATH, { method: 'POST', body: JSON.stringify(body) });
      if (saved) {
        record = saved.progress;
        if (generation === sentAt) storageSet(PENDING_KEY, null);
      }
    }
    // Nothing is normally written during the boot sync (no world exists yet); if something was,
    // this browser's balance is the newer one and it stays.
    applyProgressSnapshot(record, { wallet: generation === sentAt });

    // The name: the account's, if it has one; otherwise this browser's goes up.
    const localName = storageGet(NAME_KEY);
    if (me.user.name) storageSet(NAME_KEY, me.user.name);
    else if (localName) void setNameNow(localName);
  })()
    .catch(() => {})
    .finally(() => {
      booted = true;
      if (storageGet(PENDING_KEY) !== null) schedule();
      emit();
    });

  async function setNameNow(name: string): Promise<void> {
    const response = await request<{ user: AccountUser }>(PROFILE_PATH, { method: 'POST', body: JSON.stringify({ name: sanitizeName(name) }) });
    if (response?.user) {
      state.user = response.user;
      if (response.user.name) storageSet(NAME_KEY, response.user.name);
      emit();
    }
  }

  // Every world change is a page load: whatever has not gone yet goes on the way out.
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => {
      if (!booted || storageGet(PENDING_KEY) === null) return;
      void request(PROGRESS_PATH, { method: 'POST', body: JSON.stringify(outgoing(true)), keepalive: true });
    });
  }

  return {
    state,
    ready(timeoutMs = READY_MS) {
      return Promise.race([boot.then(() => state), new Promise<AccountState>((resolve) => setTimeout(() => resolve(state), timeoutMs))]);
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    flush,
    async signIn(provider) {
      // The guest's latest record has to be on the server before it can be merged anywhere.
      await Promise.race([boot, new Promise((r) => setTimeout(r, READY_MS))]);
      await Promise.race([flush(), new Promise((r) => setTimeout(r, READY_MS))]);
      const back = `${location.pathname}${location.search}`;
      location.assign(`/auth/${encodeURIComponent(provider)}/start?return=${encodeURIComponent(back)}`);
    },
    async signOut() {
      await Promise.race([flush(), new Promise((r) => setTimeout(r, READY_MS))]);
      await request('/auth/logout', { method: 'POST', body: '{}' });
      // This browser is somebody new now: nothing of the account stays behind in it.
      setProgressObserver(null);
      clearSavedProgress();
      clearBoardMirror();
      storageSet(PENDING_KEY, null);
      storageSet(NAME_KEY, null);
      location.reload();
    },
    setName(name) {
      storageSet(NAME_KEY, sanitizeName(name));
      void setNameNow(name);
    },
  };
}

/** The one account for this page. Made on first use, so a page that never asks never fetches. */
let shared: Account | null = null;
export function account(): Account {
  if (!shared) shared = createAccount();
  return shared;
}
