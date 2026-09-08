import { MAX_PLAYERS } from '../net/protocol';
import { fetchRooms } from '../net/connection';
import { createMenuScreen, type MenuScreen, type MenuScreenEntry } from './menuScreen';

/**
 * The race menu: the screen between RACE and the track. Same circuit either way — the Bandido
 * Grid, the street course cut through the open-world city (`circuitSpec.ts`) — so the only
 * question this screen asks is who else is on the grid.
 *
 *   OFFLINE  `?mode=circuit`  the circuit on your own, against the clock
 *   VERSUS   `?mp=1`          the room browser, then a lobby, then a grid of up to four
 *
 * RACE and VERSUS used to be two cards on the main menu running two different circuits, which
 * made "solo or online" look like a choice of track. It is not, and this screen is where the
 * real choice was moved to.
 *
 * The room count is polled the way the main menu polls the city, and for the same reason: how
 * many rooms are open is worth knowing before picking VERSUS, not after.
 */
export interface RaceMenu {
  dispose(): void;
}

/** What the race menu can hand back: the circuit alone, or the road into a room. */
export type RaceChoice = 'circuit' | 'multiplayer';

/** How often the open-room count is re-read while the screen is up. */
const POLL_MS = 5000;
/** The dossier row that carries it, so the poll can find it without re-rendering the rest. */
const ROOMS_LABEL = 'ROOMS';

const ENTRIES: Array<MenuScreenEntry<RaceChoice>> = [
  {
    id: 'circuit',
    kicker: 'TIME ATTACK',
    name: 'OFFLINE',
    desc: 'The Bandido Grid on your own. Two laps of the city, no grid to hold you up and nobody to blame. Learn where the barriers bite before you race anyone on it.',
    spec: [
      ['CIRCUIT', 'BANDIDO GRID'],
      ['LENGTH', '1.5 KM'],
      ['LAPS', '02'],
      ['FIELD', 'YOU · CITY TRAFFIC'],
    ],
  },
  {
    id: 'multiplayer',
    kicker: 'ONLINE · RACE',
    name: 'VERSUS',
    desc: `The same two laps with ${MAX_PLAYERS} cars in them. Open a room and hand out the link, or join one that is already up. Nowhere to run.`,
    spec: [
      ['GRID', `UP TO ${String(MAX_PLAYERS).padStart(2, '0')} CARS`],
      ['CIRCUIT', 'BANDIDO GRID · 1.5 KM'],
      ['ENTRY', 'ROOM CODE OR LINK'],
      [ROOMS_LABEL, 'CHECKING'],
    ],
  },
];

export interface RaceMenuCallbacks {
  onSelect(choice: RaceChoice): void;
  /** ESC: back to the main menu. */
  onBack(): void;
}

export function showRaceMenu(root: HTMLElement, callbacks: RaceMenuCallbacks): RaceMenu {
  // Fresh copies of the spec rows: the poll writes into them, and a second visit must not
  // start from the last visit's answer.
  const entries = ENTRIES.map((e) => ({ ...e, spec: e.spec.map(([k, v]) => [k, v] as [string, string]) }));
  let screen: MenuScreen<RaceChoice> | null = null;
  let done = false;

  /**
   * How many rooms are up. The open world is filtered out: it is a room on the same server,
   * but it is a place rather than a match and it has its own card one screen back.
   */
  async function pollRooms(): Promise<void> {
    let next: string;
    try {
      const rooms = (await fetchRooms()).filter((room) => room.mode !== 'world');
      next = rooms.length === 0 ? 'NONE OPEN · HOST ONE' : `${String(rooms.length).padStart(2, '0')} OPEN`;
    } catch {
      next = 'NO SERVER';
    }
    if (done) return;
    screen?.setSpec('multiplayer', ROOMS_LABEL, next);
  }

  screen = createMenuScreen<RaceChoice>(root, {
    screen: 'RACE',
    sub: 'BANDIDO GRID · ALONE OR AGAINST THE CITY',
    hint: '<b>←</b> <b>→</b> select · <b>ENTER</b> execute · <b>ESC</b> back to the menu',
    entries,
    onSelect(choice) {
      done = true;
      callbacks.onSelect(choice);
    },
    onBack() {
      done = true;
      callbacks.onBack();
    },
  });

  void pollRooms();
  const poll = window.setInterval(() => void pollRooms(), POLL_MS);

  return {
    dispose() {
      done = true;
      window.clearInterval(poll);
      screen?.dispose();
    },
  };
}
