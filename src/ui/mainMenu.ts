import { MAX_PLAYERS, MAX_WORLD_PLAYERS, worldListing } from '../net/protocol';
import { fetchRooms } from '../net/connection';
import { createMenuScreen, type MenuScreen, type MenuScreenEntry } from './menuScreen';

/**
 * Main menu: pick a world. Two of them — the city you drive for its own sake, and the circuit
 * you race on. Built on `menuScreen.ts`; this file is the copy, the live readout and the
 * choice, nothing else.
 *
 * RACE IS ONE TAB, TWO WAYS IN. It used to be two — RACE for a solo circuit and VERSUS for a
 * room — which asked the player to decide how they wanted to play before they had decided what
 * they wanted to play. Now RACE leads to `raceMenu.ts`, where OFFLINE and VERSUS are a choice
 * about company rather than about the track: both run the Bandido Grid, the street circuit cut
 * through the open-world city (`circuitSpec.ts`).
 *
 * The original circuit is still here, unretired: the Bandido Loop out of `raceSpec.ts` is what
 * `?mode=race` builds, and it is what the perf gate measures.
 *
 * Both worlds on this screen are online, in two different senses: OPEN WORLD is one city
 * everybody shares and RACE can be a room you make. So the screen polls `GET /rooms` while it
 * is up and shows how many cars are in the city — the answer to "is anyone playing?" belongs
 * here, before the choice, not after it.
 */
export interface MainMenu {
  dispose(): void;
}

/** What the main menu can hand back: a world to drive, the race screen one step deeper, or the intro again. */
export type MenuChoice = 'city' | 'race' | 'intro';

/** How often the live city count is re-read while the menu is up. */
const POLL_MS = 5000;
/** The dossier row that carries it, so the poll can find it without re-rendering the rest. */
const ONLINE_LABEL = 'ONLINE';

const ENTRIES: Array<MenuScreenEntry<MenuChoice>> = [
  {
    id: 'city',
    kicker: 'FREE ROAM · ONLINE',
    name: 'OPEN WORLD',
    desc: 'Bandido Bay, and whoever else is out driving it. Viaducts, ramps, the skyway, the square, the water. No clock, no flag.',
    spec: [
      ['ZONE', 'BANDIDO BAY'],
      ['SIZE', '540 x 550 M'],
      ['ROADS', 'VIADUCT · SKYWAY · ALLEYS'],
      [ONLINE_LABEL, 'CHECKING'],
    ],
  },
  {
    id: 'race',
    kicker: 'CIRCUIT · SOLO OR ONLINE',
    name: 'RACE',
    desc: `Bandido Grid: a street circuit cut through the city itself. Downtown, the waterfront, and the viaduct out over the bay. Run it alone against the clock, or fill the grid with up to ${MAX_PLAYERS} cars.`,
    spec: [
      ['CIRCUIT', 'BANDIDO GRID'],
      ['LENGTH', '1.5 KM'],
      ['LAPS', '02'],
      ['ENTRY', 'OFFLINE OR VERSUS'],
    ],
  },
];

export function showMainMenu(root: HTMLElement, onSelect: (choice: MenuChoice) => void): MainMenu {
  // Fresh copies of the spec rows: the screen writes the live city count into them, and a
  // second visit must not start from the last visit's answer.
  const entries = ENTRIES.map((e) => ({ ...e, spec: e.spec.map(([k, v]) => [k, v] as [string, string]) }));
  let screen: MenuScreen<MenuChoice> | null = null;
  let done = false;

  /**
   * How busy the city is, asked over plain HTTP because there is no socket on this screen. A
   * server that cannot be reached says so rather than pretending the city is empty: the two
   * are different answers and only one of them is worth driving into.
   */
  async function pollWorld(): Promise<void> {
    let next: string;
    try {
      const listing = worldListing(await fetchRooms());
      next = listing
        ? `${listing.players} / ${listing.max} DRIVING`
        : `0 / ${MAX_WORLD_PLAYERS} DRIVING`;
    } catch {
      next = 'NO SERVER · SOLO';
    }
    if (done) return;
    screen?.setSpec('city', ONLINE_LABEL, next);
  }

  screen = createMenuScreen<MenuChoice>(root, {
    screen: 'MAIN',
    sub: 'DRIFT AND ROAM THE CYBERPUNK UNDERGROUND',
    hint: '<b>←</b> <b>→</b> select · <b>ENTER</b> execute · <b>I</b> replay the intro · in game <b>ESC</b> returns here',
    entries,
    onSelect(choice) {
      done = true;
      onSelect(choice);
    },
  });

  void pollWorld();
  const poll = window.setInterval(() => void pollWorld(), POLL_MS);

  // The introduction again (`src/sim/intro.ts`): one key rather than a third card, because it
  // is a thing to revisit, not a place to go.
  const onKey = (e: KeyboardEvent): void => {
    if (done || e.code !== 'KeyI' || e.repeat) return;
    done = true;
    onSelect('intro');
  };
  window.addEventListener('keydown', onKey);

  return {
    dispose() {
      done = true;
      window.clearInterval(poll);
      window.removeEventListener('keydown', onKey);
      screen?.dispose();
    },
  };
}
