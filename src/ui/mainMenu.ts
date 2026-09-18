import { MAX_PLAYERS, MAX_WORLD_PLAYERS, worldListing } from '../net/protocol';
import { RUSH } from '../config/tuning';
import { fetchRooms } from '../net/connection';
import { CHANGELOG } from '../content/changelog';
import { createMenuScreen, type MenuScreen, type MenuScreenEntry } from './menuScreen';

/**
 * Main menu: pick a world. Two ways in — the city you drive for its own sake, and QUICK PLAY,
 * which is the city's three activities without the drive to their doors — and a third tab that
 * is not a world at all, the CHANGELOG. Built on
 * `menuScreen.ts`; this file is the copy, the live readout and the choice, nothing else.
 *
 * The changelog is a tab rather than a key or a corner link because it is the one place the
 * game says out loud that it is still being worked on, and that is worth as much floor space
 * as a mode. Its dossier rows come from the log itself (`src/content/changelog.ts`), so the
 * card advertises the real date of the last change rather than a number somebody has to
 * remember to bump.
 *
 * QUICK PLAY IS ONE TAB, THREE GAMES, TWO WAYS IN. It used to be RACE, one circuit alone or in a
 * room. Now it leads to `quickPlayMenu.ts`: RAYO RUSH, STREET RACE or TIME ATTACK — the same
 * games the open world offers at its markers — and then OFFLINE or ONLINE, a choice about
 * company rather than about the game. Online, any of the three can be a room you make.
 *
 * The original circuit is still here, unretired: the Bandido Loop out of `raceSpec.ts` is what
 * `?mode=race` builds, and it is what the perf gate measures.
 *
 * Both worlds on this screen are online, in two different senses: OPEN WORLD is one city
 * everybody shares and QUICK PLAY can be a room you make. So the screen polls `GET /rooms` while it
 * is up and shows how many cars are in the city — the answer to "is anyone playing?" belongs
 * here, before the choice, not after it.
 */
export interface MainMenu {
  dispose(): void;
}

/** What the main menu can hand back: a world to drive, a screen one step deeper, or the intro again. */
export type MenuChoice = 'city' | 'quick' | 'changelog' | 'lore' | 'intro';

/** How often the live city count is re-read while the menu is up. */
const POLL_MS = 5000;
/** The dossier row that carries it, so the poll can find it without re-rendering the rest. */
const ONLINE_LABEL = 'ONLINE';

const ENTRIES: Array<MenuScreenEntry<MenuChoice>> = [
  {
    // Bandido Metro (`src/world/openWorld.ts`): The Stack as downtown inside the Bay's streets,
    // the open world since 2026-09-13. The Bay and The Stack it was merged from are off the
    // menu, still loadable as `?mode=bay` and `?mode=stack`.
    id: 'city',
    kicker: 'FREE ROAM · ONLINE',
    name: 'OPEN WORLD',
    desc: 'Bandido Metro, y quien más ande dando vueltas. El Stack en el centro, el viaducto, los colectivos y el agua al fondo del mapa. Sin reloj, sin bandera.',
    spec: [
      ['ZONE', 'BANDIDO METRO'],
      ['SIZE', '1.4 x 2.0 KM'],
      ['ROADS', 'THE STACK · VIADUCT · ALLEYS'],
      [ONLINE_LABEL, 'CHECKING'],
    ],
  },
  {
    id: 'quick',
    kicker: 'SOLO OR ONLINE',
    name: 'QUICK PLAY',
    desc: `Los juegos del mundo abierto, directo desde el menú: un RAYO RUSH de ${RUSH.durationSeconds} segundos, una STREET RACE en La Curva o un TIME ATTACK en el Bandido Grid. Jugalos solo, o abrí una sala para hasta ${MAX_PLAYERS} y sumá a tus amigos.`,
    spec: [
      ['GAMES', 'RUSH · STREET · TIME ATTACK'],
      ['PROGRESS', 'SHARED WITH THE OPEN WORLD'],
      ['ENTRY', 'OFFLINE OR ONLINE ROOM'],
    ],
  },
  {
    id: 'changelog',
    kicker: 'BUILD LOG',
    name: 'CHANGELOG',
    desc: 'Qué cambió últimamente en la ciudad, por el día en que salió. Cada deploy escribe una línea acá.',
    spec: [
      ['LATEST', CHANGELOG[0] ? CHANGELOG[0].date : '--'],
      ['ENTRIES', String(CHANGELOG.length).padStart(2, '0')],
      ['NEW', CHANGELOG[0] ? `${String(CHANGELOG[0].items.length).padStart(2, '0')} CHANGES` : 'NONE'],
    ],
  },
  {
    id: 'lore',
    kicker: 'AÑO 2069',
    name: 'LORE',
    desc: 'Quién es Rayo Bandido',
    spec: [
      ['SETTING', 'AÑO 2069'],
      ['LEY', 'COMBUSTIÓN = DELITO'],
      ['SUJETO', 'RAYO BANDIDO'],
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
    footer: 'Creado en la mejor ciudad del mundo 🇦🇷',
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
