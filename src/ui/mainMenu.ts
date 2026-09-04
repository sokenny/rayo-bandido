import type { GameMode } from '../core/types';
import { MAX_PLAYERS } from '../net/protocol';
import { frameDecor, menuHeader } from './chrome';

/**
 * Main menu: pick a world. A numbered list on the left, a dossier on the right that describes
 * whatever the cursor is on. Keyboard or mouse. DOM only; the choice is handed back to
 * `src/main.ts`, which loads the game for that world.
 */
export interface MainMenu {
  dispose(): void;
}

/** The two single-player worlds, plus the lobby. */
export type MenuChoice = GameMode | 'multiplayer';

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
    mode: 'test',
    kicker: 'FREE ROAM',
    name: 'TEST',
    desc: 'The city block. Drift, charge, hunt electric cars.',
    spec: [
      ['ZONE', 'CITY BLOCK'],
      ['OBJECTIVE', 'HUNT EV TARGETS'],
      ['WEAPON', 'DRIFT-CHARGED LIGHTNING'],
      ['CLOCK', 'NONE'],
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
    kicker: 'ONLINE',
    name: 'VERSUS',
    desc: `Same circuit, up to ${MAX_PLAYERS} cars. Share the link, race your friends.`,
    spec: [
      ['GRID', `UP TO ${String(MAX_PLAYERS).padStart(2, '0')} CARS`],
      ['CIRCUIT', 'BANDIDO LOOP'],
      ['ENTRY', 'ROOM CODE OR LINK'],
      ['RULES', 'HOST DROPS THE FLAG'],
    ],
  },
];

export function showMainMenu(root: HTMLElement, onSelect: (mode: MenuChoice) => void): MainMenu {
  const menu = document.createElement('div');
  menu.className = 'rb-menu rb-main';
  menu.innerHTML =
    frameDecor('MAIN') +
    menuHeader('JDM // CYBERPUNK') +
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

  function renderDossier(entry: MenuEntry, index: number): void {
    dossierEl.dataset.mode = entry.mode;
    dossierIdEl.textContent = `REC ${String(index + 1).padStart(2, '0')}/${String(ENTRIES.length).padStart(2, '0')}`;
    kickerEl.textContent = `// ${entry.kicker}`;
    nameEl.textContent = entry.name;
    descEl.textContent = entry.desc;
    specEl.innerHTML = entry.spec.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
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
  cards.forEach((c, i) => {
    c.addEventListener('mouseenter', () => select(i));
    c.addEventListener('click', () => choose(i));
  });
  select(0);
  cards[0]?.focus({ preventScroll: true });

  return {
    dispose() {
      window.removeEventListener('keydown', onKey);
      menu.remove();
    },
  };
}
