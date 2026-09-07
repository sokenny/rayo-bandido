import type { GameMode } from '../core/types';
import { MAX_PLAYERS, MAX_WORLD_PLAYERS, worldListing } from '../net/protocol';
import { fetchRooms } from '../net/connection';
import { createGamepadMenuNav } from '../core/input/gamepadMenu';
import { frameDecor, menuHeader } from './chrome';

/**
 * Main menu: pick a world. A numbered list on the left, a dossier on the right that describes
 * whatever the cursor is on. Keyboard or mouse. DOM only; the choice is handed back to
 * `src/main.ts`, which loads the game for that world.
 *
 * Both worlds on this screen are online now, in two different senses: OPEN WORLD is one city
 * everybody shares and VERSUS is a race room you make. So the screen polls `GET /rooms` while it
 * is up and shows how many cars are in the city — the answer to "is anyone playing?" belongs
 * here, before the choice, not after it.
 *
 * RACE and VERSUS are two different circuits: RACE is the Bandido Loop out of `raceSpec.ts`,
 * VERSUS is the Bandido Grid, a lap of the open-world city closed off with neon barriers
 * (`circuitSpec.ts`). `?mode=circuit` drives that one alone, which is how you practise it.
 */
export interface MainMenu {
  dispose(): void;
}

/** The worlds, plus the versus lobby. */
export type MenuChoice = GameMode | 'multiplayer';

/** How often the live city count is re-read while the menu is up. */
const POLL_MS = 5000;
/** The dossier row that carries it, so the poll can find it without re-rendering the rest. */
const ONLINE_LABEL = 'ONLINE';

interface MenuEntry {
  mode: MenuChoice;
  kicker: string;
  name: string;
  desc: string;
  /** Key/value rows for the dossier. */
  spec: Array<[string, string]>;
}

const ENTRIES: MenuEntry[] = [
  {
    mode: 'city',
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
    mode: 'race',
    kicker: 'CIRCUIT',
    name: 'RACE',
    desc: 'Bandido Loop · 2 laps · 1.4 km. Beat the clock. Find the alleys.',
    spec: [
      ['CIRCUIT', 'BANDIDO LOOP'],
      ['LENGTH', '1.4 KM'],
      ['LAPS', '02'],
      ['INTEL', 'HIDDEN SHORTCUTS'],
    ],
  },
  {
    mode: 'multiplayer',
    kicker: 'ONLINE · RACE',
    name: 'VERSUS',
    desc: `Bandido Grid: a street circuit cut through the city itself. Downtown, the waterfront, and the viaduct out over the bay. ${MAX_PLAYERS} cars, two laps, nowhere to run.`,
    spec: [
      ['GRID', `UP TO ${String(MAX_PLAYERS).padStart(2, '0')} CARS`],
      ['CIRCUIT', 'BANDIDO GRID · 1.5 KM'],
      ['LAPS', '02'],
      ['ENTRY', 'ROOM CODE OR LINK'],
    ],
  },
];

export function showMainMenu(root: HTMLElement, onSelect: (mode: MenuChoice) => void): MainMenu {
  const menu = document.createElement('div');
  menu.className = 'rb-menu rb-main';
  menu.innerHTML =
    frameDecor('MAIN') +
    menuHeader('DRIFT AND ROAM THE CYBERPUNK UNDERGROUND') +
    `<div class="rb-console">` +
    `<div class="rb-list" role="listbox" aria-label="Game mode">` +
    ENTRIES.map(
      (e, i) =>
        `<button class="rb-item rb-menu__card${i === 0 ? ' is-selected' : ''}" data-mode="${e.mode}" type="button" role="option">` +
        `<span class="rb-item__index">${String(i + 1).padStart(2, '0')}</span>` +
        `<span class="rb-item__name">${e.name}</span>` +
        `<span class="rb-item__kicker">${e.kicker}</span>` +
        `</button>`,
    ).join('') +
    `</div>` +
    `<div class="rb-panel rb-dossier" data-role="dossier">` +
    `<div class="rb-panel__head"><span>MODE_DOSSIER</span><span class="rb-panel__id" data-role="dossierId"></span></div>` +
    `<div class="rb-dossier__body">` +
    `<div class="rb-dossier__id">` +
    `<div class="rb-dossier__frame">` +
    `<img class="rb-dossier__portrait" src="/rayo-wanted.webp" alt="" draggable="false" onerror="this.hidden=true" />` +
    `</div>` +
    `<span class="rb-dossier__stamp">WANTED</span>` +
    `<span class="rb-dossier__caption">SUBJECT · RAYO BANDIDO</span>` +
    `</div>` +
    `<div class="rb-dossier__text">` +
    `<div class="rb-dossier__kicker" data-role="kicker"></div>` +
    `<div class="rb-dossier__name" data-role="name"></div>` +
    `<div class="rb-dossier__desc" data-role="desc"></div>` +
    `<dl class="rb-spec" data-role="spec"></dl>` +
    `</div>` +
    `</div>` +
    `</div>` +
    `</div>` +
    `<div class="rb-menu__hint"><b>←</b> <b>→</b> select · <b>ENTER</b> execute · in game <b>ESC</b> returns here</div>`;
  root.appendChild(menu);

  const cards = Array.from(menu.querySelectorAll<HTMLButtonElement>('.rb-item'));
  const pick = <T extends HTMLElement>(role: string): T => menu.querySelector<T>(`[data-role="${role}"]`)!;
  const dossierEl = pick('dossier');
  const dossierIdEl = pick('dossierId');
  const kickerEl = pick('kicker');
  const nameEl = pick('name');
  const descEl = pick('desc');
  const specEl = pick('spec');

  let selected = -1;
  let done = false;
  /** What the city's ONLINE row currently says. Re-read on a timer while the menu is up. */
  let onlineText = 'CHECKING';

  function renderDossier(entry: MenuEntry, index: number): void {
    dossierEl.dataset.mode = entry.mode;
    dossierIdEl.textContent = `REC ${String(index + 1).padStart(2, '0')}/${String(ENTRIES.length).padStart(2, '0')}`;
    kickerEl.textContent = `// ${entry.kicker}`;
    nameEl.textContent = entry.name;
    descEl.textContent = entry.desc;
    specEl.innerHTML = entry.spec
      .map(([k, v]) => `<dt>${k}</dt><dd>${k === ONLINE_LABEL ? onlineText : v}</dd>`)
      .join('');
  }

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
    if (next === onlineText || done) return;
    onlineText = next;
    if (selected >= 0 && ENTRIES[selected].mode === 'city') renderDossier(ENTRIES[selected], selected);
  }

  function select(index: number): void {
    const next = (index + cards.length) % cards.length;
    if (next === selected) return;
    selected = next;
    cards.forEach((c, i) => {
      c.classList.toggle('is-selected', i === selected);
      c.setAttribute('aria-selected', i === selected ? 'true' : 'false');
    });
    renderDossier(ENTRIES[selected], selected);
  }

  function choose(index: number): void {
    if (done) return;
    done = true;
    select(index);
    menu.classList.add('is-leaving');
    onSelect(ENTRIES[index].mode);
  }

  const onKey = (e: KeyboardEvent): void => {
    switch (e.code) {
      case 'ArrowLeft':
      case 'ArrowUp':
      case 'KeyA':
      case 'KeyW':
        select(selected - 1);
        e.preventDefault();
        break;
      case 'ArrowRight':
      case 'ArrowDown':
      case 'KeyD':
      case 'KeyS':
        select(selected + 1);
        e.preventDefault();
        break;
      case 'Enter':
      case 'Space':
      case 'NumpadEnter':
        choose(selected);
        e.preventDefault();
        break;
      default:
        break;
    }
  };
  window.addEventListener('keydown', onKey);
  const pad = createGamepadMenuNav({
    onMove: (delta) => select(selected + delta),
    onConfirm: () => choose(selected),
  });
  cards.forEach((c, i) => {
    c.addEventListener('mouseenter', () => select(i));
    c.addEventListener('click', () => choose(i));
  });
  select(0);
  cards[0]?.focus({ preventScroll: true });
  void pollWorld();
  const poll = window.setInterval(() => void pollWorld(), POLL_MS);

  return {
    dispose() {
      window.removeEventListener('keydown', onKey);
      window.clearInterval(poll);
      pad.dispose();
      menu.remove();
    },
  };
}
