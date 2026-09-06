import './styles.css';
import type { GameMode } from './core/types';
import { createGame, type Game } from './game';
import { createLoadingScreen, type LoadingScreen } from './ui/loadingScreen';
import { showMainMenu, type MenuChoice } from './ui/mainMenu';
import { createLobby } from './ui/lobby';
import { createRoomBrowser } from './ui/rooms';
import { createSession, type NetSession } from './net/session';
import { sanitizeName, sanitizeRoomCode, sanitizeRoomLabel, type RoomEntry } from './net/protocol';
import { installMobileShell } from './ui/mobileShell';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
const hudRoot = document.getElementById('hud-root');
const debugRoot = document.getElementById('debug-root');
const menuRoot = document.getElementById('menu-root');
if (!canvas || !hudRoot || !debugRoot || !menuRoot) {
  throw new Error('Rayo Bandido: missing root elements in index.html');
}

/**
 * What to load comes from the URL: `?mode=test` (the free-roam city), `?mode=race` (the
 * circuit on your own), or `?mp=1` (multiplayer). Without any of them the main menu is shown
 * and the choice is written into the URL, so a world is always one reload away.
 *
 * MULTIPLAYER ADDRESSES. One server holds many rooms, so `?mp=1` alone means "show me the
 * rooms" and the room itself rides in the query string:
 *
 *   ?mp=1                    the room browser: create one, type a code, or join a public room
 *   ?mp=1&room=K7QP          straight into K7QP — this is the link a host hands out
 *   ?mp=1&create=1           open a fresh room and go straight to its lobby
 *   ?mp=1&room=K7QP&create=1 join K7QP, opening it under that code if it has expired: a link
 *                            that keeps working, which is what the QA harness uses
 *
 * A created room is public — it shows up in the browser screen's list — unless the address says
 * `&listed=0`, which is the URL form of unticking LIST IT PUBLICLY. The address is rewritten
 * with the real code once the server answers, so reloading or copying the bar lands in the same
 * room rather than back at the browser.
 */
function modeFromUrl(): GameMode | null {
  const mode = new URLSearchParams(location.search).get('mode');
  return mode === 'test' || mode === 'race' ? mode : null;
}

/** This page with `mode`, `mp` and the room parameters replaced by whatever is asked for. */
function urlWith(mode: GameMode | null, multiplayer = false, room = ''): string {
  const params = new URLSearchParams(location.search);
  if (mode) params.set('mode', mode);
  else params.delete('mode');
  if (multiplayer) params.set('mp', '1');
  else params.delete('mp');
  // `create` and `listed` describe one arrival and must not survive it: keeping them would
  // re-open a room on every reload.
  params.delete('create');
  params.delete('listed');
  params.delete('label');
  if (multiplayer && room) params.set('room', room);
  else params.delete('room');
  const query = params.toString();
  return `${location.pathname}${query ? `?${query}` : ''}`;
}

/** Which room `?mp=...` is asking for. See the block comment above for the four shapes. */
function roomEntryFromUrl(name: string): RoomEntry | null {
  const params = new URLSearchParams(location.search);
  const join = sanitizeRoomCode(params.get('room') ?? '');
  const create = params.has('create')
    ? {
        label: sanitizeRoomLabel(params.get('label') ?? `${name} ROOM`),
        // Public unless asked otherwise, which is the checkbox's default too.
        listed: params.get('listed') !== '0',
      }
    : undefined;
  if (!join && !create) return null;
  return { join: join || undefined, create };
}

/**
 * Build a world and pay every one-time GPU cost behind the loading screen, so the first frame
 * the player sees is already a smooth one. Shared by single player and by every multiplayer
 * race, which is why the loading screen is passed in rather than made here: a match reuses
 * one screen across its races.
 */
async function buildGame(mode: GameMode, loading: LoadingScreen, net: NetSession | null): Promise<Game> {
  loading.set(mode === 'race' ? 'BUILDING THE CIRCUIT' : 'BUILDING THE CITY', 0.12);
  // Let the caption paint before the synchronous scene build blocks the thread.
  await loading.paint();

  const game = createGame(canvas!, hudRoot!, debugRoot!, mode, { net });
  // `?nowarm=1` skips the warm-up to reproduce the first-use hitches on purpose (A/B, and the
  // negative test for the perf gate: `node scripts/perf-probe.mjs --check --url ...?nowarm=1`).
  if (new URLSearchParams(location.search).has('nowarm')) {
    loading.set('SKIPPING WARM-UP', 1);
  } else {
    try {
      await game.warmUp(loading);
    } catch (err) {
      // A failed warm-up only costs the first-use hitches it was meant to remove.
      console.warn('Rayo Bandido: warm-up failed, starting cold', err);
    }
  }
  return game;
}

/** Single player: build the world, start driving, ESC goes back to the menu. */
async function boot(mode: GameMode): Promise<void> {
  const loading = createLoadingScreen(document.getElementById('loading-root'));
  const game = await buildGame(mode, loading, null);
  game.start();
  canvas!.focus();
  void loading.hide();

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape') location.assign(urlWith(null));
  });
}

/**
 * Multiplayer: lobby, race, results, lobby again — all without a page load, because the
 * WebSocket has to survive the whole thing. This is the one place in the game where a world
 * is built and torn down while the tab stays put, so the sequence is worth reading in full:
 *
 *   connect -> lobby -> the host starts -> `match` names our grid slot -> build the circuit
 *   -> tell the server we are `loaded` -> `go` says when the countdown ends -> race
 *   -> take the flag -> `results` -> dispose the world, back to the lobby.
 *
 * The server waits for every client's `loaded` before choosing the moment of GO, so a slow
 * machine delays the grid instead of starting behind it.
 */
async function multiplayer(entry: RoomEntry): Promise<void> {
  const loading = createLoadingScreen(document.getElementById('loading-root'));
  void loading.hide();

  const session = createSession(storedName(), entry);
  let game: Game | null = null;
  /**
   * Put the room we actually landed in into the address bar, once. A created room's code is
   * only known now, and a reload has to come back here rather than to the browser screen.
   */
  let addressed = false;
  /** Set when GO lands, so a race can start whichever of the two arrives second. */
  let goPending = false;
  let building = false;

  const lobby = createLobby(menuRoot!, session, {
    onLeave() {
      // Leaving a room goes back to the rooms, not out of multiplayer: the usual next thing
      // is to join a different one.
      teardownRace();
      session.dispose();
      location.assign(urlWith(null, true));
    },
  });

  function teardownRace(): void {
    if (!game) return;
    game.stop();
    game.dispose();
    game = null;
  }

  /** The circuit is built for each match: the grid slot and the field are only known now. */
  async function enterRace(): Promise<void> {
    if (building) return;
    building = true;
    goPending = false;
    teardownRace();
    lobby.hide();
    loading.show('BUILDING THE CIRCUIT');
    try {
      game = await buildGame('race', loading, session);
      session.notifyLoaded();
      loading.set('WAITING FOR THE GRID', 1);
      canvas!.focus();
      // GO may already have been called while we were still building (a slow machine, or the
      // server's load timeout); if so, start immediately.
      if (goPending) startRace();
    } catch (err) {
      console.error('Rayo Bandido: could not build the race', err);
      lobby.show();
      void loading.hide();
    } finally {
      building = false;
    }
  }

  function startRace(): void {
    goPending = false;
    if (!game) return;
    // `start` reads the remaining countdown off the session, so however long this client
    // took to get here, the lights go out at the instant the server chose.
    game.start();
    canvas!.focus();
    void loading.hide();
  }

  session.onMatch(() => void enterRace());

  session.onGo(() => {
    goPending = true;
    if (game && !building) startRace();
  });

  session.onResults(() => {
    teardownRace();
    void loading.hide();
    lobby.show();
  });

  session.onLobby(() => {
    lobby.refresh();
    if (!addressed && session.room) {
      addressed = true;
      history.replaceState(null, '', urlWith(null, true, session.room.code));
    }
    // A connection that drops mid-race leaves a world running that nobody can score.
    if ((session.phase === 'refused' || session.phase === 'closed') && game) {
      teardownRace();
      void loading.hide();
      lobby.show();
    }
  });

  window.addEventListener('keydown', (e) => {
    // ESC during a race leaves the match. The lobby handles its own ESC.
    if (e.code === 'Escape' && game) {
      teardownRace();
      session.dispose();
      location.assign(urlWith(null));
    }
  });
}

/** The name last used in a lobby, so a returning player does not retype it. */
function storedName(): string {
  try {
    return sanitizeName(localStorage.getItem('rb.name') ?? '');
  } catch {
    return sanitizeName('');
  }
}

/** The room browser: pick or open a room, then reload into it. */
function rooms(): void {
  const loading = createLoadingScreen(document.getElementById('loading-root'));
  void loading.hide();
  createRoomBrowser(menuRoot!, storedName(), {
    onEnter(entry) {
      // A reload rather than an in-place hand-off, so the address bar and the game agree from
      // the first frame — and so a failed connection can simply be reloaded. Everything else
      // in the query string survives, `?server=` and `?debug=1` included.
      const params = new URLSearchParams(location.search);
      params.delete('mode');
      params.set('mp', '1');
      if (entry.join) params.set('room', entry.join);
      else params.delete('room');
      if (entry.create) {
        params.set('create', '1');
        params.set('label', entry.create.label);
        // Written either way rather than by omission: the tick is the player's answer, and a
        // dropped parameter would silently become the default.
        params.set('listed', entry.create.listed ? '1' : '0');
      } else {
        params.delete('create');
        params.delete('label');
        params.delete('listed');
      }
      setTimeout(() => location.assign(`${location.pathname}?${params.toString()}`), 120);
    },
    onBack() {
      location.assign(urlWith(null));
    },
  });
}

function menu(): void {
  const loading = createLoadingScreen(document.getElementById('loading-root'));
  void loading.hide();
  showMainMenu(menuRoot!, (choice: MenuChoice) => {
    const url = choice === 'multiplayer' ? urlWith(null, true) : urlWith(choice);
    // A short beat for the card to light up, then reload into the chosen world.
    setTimeout(() => location.assign(url), 180);
  });
}

// Before anything is shown: a phone has to stop treating the game as a document — no zoom on a
// fast double tap, no pinch, no pull-to-refresh, no callout on a held button. Installed once
// for the life of the page, whichever screen the address bar asks for.
installMobileShell();

const mode = modeFromUrl();
if (new URLSearchParams(location.search).has('mp')) {
  const entry = roomEntryFromUrl(storedName());
  if (entry) void multiplayer(entry);
  else rooms();
} else if (mode) void boot(mode);
else menu();
