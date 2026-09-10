import './styles.css';
import type { GameMode } from './core/types';
import { createGame, type Game } from './game';
import { createLoadingScreen, type LoadingScreen } from './ui/loadingScreen';
import { showMainMenu, type MenuChoice } from './ui/mainMenu';
import { showRaceMenu, type RaceChoice } from './ui/raceMenu';
import { createLobby } from './ui/lobby';
import { createRoomBrowser } from './ui/rooms';
import { createSession, type NetSession } from './net/session';
import { WORLD_ROOM_CODE, sanitizeName, sanitizeRoomCode, sanitizeRoomLabel, type RoomEntry } from './net/protocol';
import { installMobileShell } from './ui/mobileShell';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
const hudRoot = document.getElementById('hud-root');
const debugRoot = document.getElementById('debug-root');
const menuRoot = document.getElementById('menu-root');
if (!canvas || !hudRoot || !debugRoot || !menuRoot) {
  throw new Error('Rayo Bandido: missing root elements in index.html');
}

/**
 * What to load comes from the URL: `?mode=city` (the open world), `?mode=circuit` (the city
 * circuit on your own), `?mp=1` (the same circuit in a room), `?race=1` (the screen that
 * chooses between those two), `?mode=race` (the Bandido Loop, the original circuit — still
 * built and still what the perf gate measures, just no longer on a menu) or `?mode=test` (the
 * original test block). Without any of them the main menu is shown and the choice is written
 * into the URL, so a world is always one reload away.
 *
 * RACE IS ONE TAB. The menu used to offer RACE and VERSUS as two cards on two different
 * circuits; now RACE opens `?race=1`, where OFFLINE and VERSUS both lead to the Bandido Grid
 * and the only difference is whether anybody else is on it.
 *
 * THE OPEN WORLD IS A SERVER. `?mode=city` does not build a private city any more: it joins the
 * one permanent room every server holds (`WORLD_ROOM_CODE`), so whoever else picked OPEN WORLD
 * is already driving around in it. There is no lobby and no code to hand out — the plain URL is
 * the invitation. `?mode=city&solo=1` is the way back to a city with nobody in it, which is what
 * the capture and QA scripts want.
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
  return mode === 'test' || mode === 'race' || mode === 'circuit' || mode === 'city' || mode === 'street' ? mode : null;
}

/**
 * The world a versus race is run on. One place, because the lobby, the loading caption and the
 * race all have to agree, and because moving the field from one circuit to another is exactly
 * this constant changing.
 */
const VERSUS_MODE: GameMode = 'circuit';

/** Which screen an address asks for, for `urlWith`. Anything left out of it is cleared. */
interface Destination {
  mode?: GameMode;
  /** The race menu: OFFLINE or VERSUS. */
  race?: boolean;
  /** Multiplayer — the room browser, or `room` when one is named. */
  mp?: boolean;
  room?: string;
  /**
   * Where this arrival came FROM, when it was not a menu: today only `city`, written by the
   * start line in the open world (`src/sim/circuitGate.ts`). All it decides is where ESC goes
   * — back out to the street the player drove in from, rather than to a menu they never opened
   * — and like every other parameter here it is cleared unless the destination asks for it, so
   * it cannot survive a trip through the menus and send a later ESC somewhere surprising.
   */
  from?: GameMode;
  /** Which STREET RACE event `mode=street` is asked for, 0-based. Cleared unless asked for. */
  event?: number;
}

/**
 * This page with `mode`, `race`, `mp` and the room parameters replaced by whatever is asked
 * for. Everything else in the query string survives, `?server=` and `?debug=1` included.
 */
function urlWith(to: Destination = {}): string {
  const { mode = null, race = false, mp: multiplayer = false, room = '', from = null, event } = to;
  const params = new URLSearchParams(location.search);
  if (mode) params.set('mode', mode);
  else params.delete('mode');
  if (event !== undefined) params.set('event', String(event));
  else params.delete('event');
  if (from) params.set('from', from);
  else params.delete('from');
  if (race) params.set('race', '1');
  else params.delete('race');
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
async function buildGame(
  mode: GameMode,
  loading: LoadingScreen,
  net: NetSession | null,
  options: { onEnterCircuit?: () => void; onEnterStreetRace?: (event: number) => void } = {},
): Promise<Game> {
  loading.set(mode === 'race' || mode === 'circuit' || mode === 'street' ? 'BUILDING THE CIRCUIT' : 'BUILDING THE CITY', 0.12);
  // Let the caption paint before the synchronous scene build blocks the thread.
  await loading.paint();

  const game = createGame(canvas!, hudRoot!, debugRoot!, mode, {
    net,
    onEnterCircuit: options.onEnterCircuit,
    onEnterStreetRace: options.onEnterStreetRace,
  });
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

/** How long the city waits for the server before deciding to be a single-player city. */
const WORLD_CONNECT_MS = 4000;

/**
 * Wait until the server has said which room we are in, or until it is clear that it will not.
 * Resolves true when there is a room to drive in.
 *
 * The city cannot be built before this: the slot decides the car's colour and where it appears,
 * and both are wrong if they are chosen and then corrected a second later.
 */
function waitForRoom(session: NetSession, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (session.room) {
      resolve(true);
      return;
    }
    let settled = false;
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      off();
      clearTimeout(timer);
      resolve(ok);
    };
    // `onLobby` also fires on a status change, so a refusal and a dropped socket land here too.
    const off = session.onLobby(() => {
      if (session.room) finish(true);
      else if (session.phase === 'refused' || session.phase === 'closed') finish(false);
    });
    const timer = setTimeout(() => finish(false), timeoutMs);
  });
}

/**
 * The open world: join the city everyone shares, then drive. Unlike a versus race there is no
 * lobby, no countdown and nothing to wait for — the session is opened, the world is built
 * around the slot it comes back with, and the car is on the road.
 *
 * A server that cannot be reached is not an error here: the city is still a city, so the game
 * falls back to driving it alone rather than refusing to start. That is also what `&solo=1`
 * asks for outright.
 */
async function openWorld(): Promise<void> {
  const loading = createLoadingScreen(document.getElementById('loading-root'));
  const solo = new URLSearchParams(location.search).has('solo');
  let session: NetSession | null = null;

  if (!solo) {
    loading.set('CONNECTING TO BANDIDO BAY', 0.06);
    await loading.paint();
    session = createSession(storedName(), { join: WORLD_ROOM_CODE });
    const connected = await waitForRoom(session, WORLD_CONNECT_MS);
    if (!connected) {
      // Nobody to drive with, but the city is still there. A full city and an unreachable one
      // are different disappointments, so the caption says which it was.
      const refused = session.phase === 'refused' && session.problem;
      loading.set(refused ? refused.toUpperCase() : 'NO SERVER · DRIVING ALONE', 0.1);
      await loading.paint();
      session.dispose();
      session = null;
    }
  }

  /**
   * THE DOOR OUT OF THE CITY. The circuit missions are found on the Bandido Grid's start line
   * in the open world (`src/sim/circuitGate.ts`), and taking them means leaving this world for
   * the circuit — which here means an address, exactly as every other screen change does.
   *
   * The socket goes back first: the city is a server, and a player who drives off to the
   * circuit should give their colour up now rather than when the browser gets round to
   * dropping the connection. `latch` is because a load is not instant — the frame loop keeps
   * running until the new page takes over, and a key held down is a key pressed on every one
   * of those frames.
   */
  let leaving = false;
  const toCircuit = (): void => {
    if (leaving) return;
    leaving = true;
    session?.dispose();
    setTimeout(() => location.assign(urlWith({ mode: 'circuit', from: 'city' })), 120);
  };

  // THE DOOR TO A STREET RACE: the same shape, to a different world, carrying which event.
  const toStreetRace = (event: number): void => {
    if (leaving) return;
    leaving = true;
    session?.dispose();
    setTimeout(() => location.assign(urlWith({ mode: 'street', from: 'city', event })), 120);
  };

  const game = await buildGame('city', loading, session, { onEnterCircuit: toCircuit, onEnterStreetRace: toStreetRace });
  game.start();
  canvas!.focus();
  void loading.hide();

  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Escape') return;
    session?.dispose();
    location.assign(urlWith());
  });

  // Reloading or closing the tab gives the slot back now rather than whenever the browser gets
  // round to dropping the socket. The city has eight colours in it; a player who reloads twice
  // should not be holding three of them.
  window.addEventListener('pagehide', (e) => {
    if (e.persisted) return;
    session?.dispose();
  });
}

/**
 * Single player: build the world, start driving, ESC goes back to the menu — the race menu for
 * a circuit, because that is the screen it was chosen on, and the main menu for anything else.
 */
async function boot(mode: GameMode): Promise<void> {
  const loading = createLoadingScreen(document.getElementById('loading-root'));
  const game = await buildGame(mode, loading, null);
  game.start();
  canvas!.focus();
  void loading.hide();

  // ESC goes back the way the player came in: the street, when they drove onto the start line
  // to get here, and otherwise the screen they chose the world on.
  const cameFromCity = new URLSearchParams(location.search).get('from') === 'city';
  const back = cameFromCity
    ? urlWith({ mode: 'city' })
    : mode === 'circuit' || mode === 'race'
      ? urlWith({ race: true })
      : urlWith();
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape') location.assign(back);
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
      location.assign(urlWith({ mp: true }));
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
      game = await buildGame(VERSUS_MODE, loading, session);
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
      history.replaceState(null, '', urlWith({ mp: true, room: session.room.code }));
    }
    // A connection that drops mid-race leaves a world running that nobody can score.
    if ((session.phase === 'refused' || session.phase === 'closed') && game) {
      teardownRace();
      void loading.hide();
      lobby.show();
    }
  });

  window.addEventListener('keydown', (e) => {
    // ESC during a race leaves the match, back to the screen it was chosen on. The lobby
    // handles its own ESC.
    if (e.code === 'Escape' && game) {
      teardownRace();
      session.dispose();
      location.assign(urlWith({ race: true }));
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
      params.delete('race');
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
      location.assign(urlWith({ race: true }));
    },
  });
}

function menu(): void {
  const loading = createLoadingScreen(document.getElementById('loading-root'));
  void loading.hide();
  showMainMenu(menuRoot!, (choice: MenuChoice) => {
    const url = choice === 'race' ? urlWith({ race: true }) : urlWith({ mode: choice });
    // A short beat for the card to light up, then reload into the chosen world.
    setTimeout(() => location.assign(url), 180);
  });
}

/**
 * The race menu: the second step of the RACE tab. Both cards lead to the same circuit, so the
 * only thing chosen here is whether anybody else is on it.
 */
function raceMenu(): void {
  const loading = createLoadingScreen(document.getElementById('loading-root'));
  void loading.hide();
  showRaceMenu(menuRoot!, {
    onSelect(choice: RaceChoice) {
      const url = choice === 'multiplayer' ? urlWith({ mp: true }) : urlWith({ mode: 'circuit' });
      setTimeout(() => location.assign(url), 180);
    },
    onBack() {
      location.assign(urlWith());
    },
  });
}

// Before anything is shown: a phone has to stop treating the game as a document — no zoom on a
// fast double tap, no pinch, no pull-to-refresh, no callout on a held button. Installed once
// for the life of the page, whichever screen the address bar asks for.
installMobileShell();

/**
 * BACK AND FORWARD REBUILD THE SCREEN. Every route here is an address, and each one is entered
 * by loading it — so the browser's back button is a first-class way to move between them, and
 * it has to arrive at a live screen rather than at the frozen one that was left behind.
 *
 * The back/forward cache would otherwise hand the last screen back exactly as it was at the
 * moment it navigated away: a menu mid-exit, still wearing `is-leaving` (`opacity: 0`) and
 * still holding the `done` flag that stops it answering a second choice — a blank page that
 * does not respond to a click. A world is worse: a paused frame loop, a socket the server has
 * long since given up on, a countdown that ended while the tab was in a drawer.
 *
 * So a restored page is reloaded. It costs the build again, which is what would have happened
 * anyway had the browser not cached the page, and it makes every arrival identical: the
 * address decides what is on screen, always.
 */
window.addEventListener('pageshow', (e) => {
  if (e.persisted) location.reload();
});

const mode = modeFromUrl();
if (new URLSearchParams(location.search).has('mp')) {
  const entry = roomEntryFromUrl(storedName());
  if (entry) void multiplayer(entry);
  else rooms();
} else if (mode === 'city') void openWorld();
else if (mode) void boot(mode);
else if (new URLSearchParams(location.search).has('race')) raceMenu();
else menu();
