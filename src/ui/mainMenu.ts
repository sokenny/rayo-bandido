import type { GameMode } from '../core/types';

/**
 * Main menu: pick a world. Two cards, keyboard or mouse. DOM only; the choice is handed
 * back to `src/main.ts`, which loads the game for that world.
 */
export interface MainMenu {
  dispose(): void;
}

interface MenuEntry {
  mode: GameMode;
  kicker: string;
  name: string;
  desc: string;
}

const ENTRIES: MenuEntry[] = [
  { mode: 'test', kicker: 'FREE ROAM', name: 'TEST', desc: 'The city block. Drift, charge, hunt electric cars.' },
  { mode: 'race', kicker: 'CIRCUIT', name: 'RACE', desc: 'Bandido Loop · 2 laps · 1.4 km. Beat the clock. Find the alleys.' },
];

export function showMainMenu(root: HTMLElement, onSelect: (mode: GameMode) => void): MainMenu {
  const menu = document.createElement('div');
  menu.className = 'rb-menu';
  menu.innerHTML =
    `<div class="rb-menu__title">RAYO BANDIDO</div>` +
    `<div class="rb-menu__sub">JDM × CYBERPUNK</div>` +
    `<div class="rb-menu__cards">` +
    ENTRIES.map(
      (e, i) =>
        `<button class="rb-menu__card${i === 0 ? ' is-selected' : ''}" data-mode="${e.mode}" type="button">` +
        `<span class="rb-menu__kicker">${e.kicker}</span>` +
        `<span class="rb-menu__name">${e.name}</span>` +
        `<span class="rb-menu__desc">${e.desc}</span>` +
        `</button>`,
    ).join('') +
    `</div>` +
    `<div class="rb-menu__hint"><b>←</b> <b>→</b> choose · <b>ENTER</b> drive · in game <b>ESC</b> returns here</div>`;
  root.appendChild(menu);

  const cards = Array.from(menu.querySelectorAll<HTMLButtonElement>('.rb-menu__card'));
  let selected = 0;
  let done = false;

  function select(index: number): void {
    selected = (index + cards.length) % cards.length;
    cards.forEach((c, i) => c.classList.toggle('is-selected', i === selected));
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
  cards[0]?.focus({ preventScroll: true });

  return {
    dispose() {
      window.removeEventListener('keydown', onKey);
      menu.remove();
    },
  };
}
