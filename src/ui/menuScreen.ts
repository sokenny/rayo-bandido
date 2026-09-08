import { createGamepadMenuNav } from '../core/input/gamepadMenu';
import { frameDecor, menuHeader } from './chrome';

/**
 * The shell every "pick one of these" screen is built from: a numbered list on the left, a
 * dossier on the right that describes whatever the cursor is on. Keyboard, pad or mouse.
 *
 * Two screens use it — the main menu (OPEN WORLD or RACE) and the race menu (OFFLINE or
 * VERSUS) — and they have to feel like one terminal going a step deeper rather than two
 * screens that happen to look alike, so the markup lives here rather than in either of them.
 * DOM only: the choice is handed back and the caller decides what to load.
 */
export interface MenuScreen<T extends string> {
  /**
   * Rewrite one row of one entry's dossier in place. Used for the readouts that are polled
   * while the screen is up (how busy the city is, how many rooms are open): the value arrives
   * after the screen is drawn, and only the row that carries it should change.
   */
  setSpec(id: T, key: string, value: string): void;
  dispose(): void;
}

export interface MenuScreenEntry<T extends string> {
  /** Handed back to `onSelect`, and the CSS hook (`data-mode`) for the row's signature colour. */
  id: T;
  kicker: string;
  name: string;
  desc: string;
  /** Key/value rows for the dossier. */
  spec: Array<[string, string]>;
}

export interface MenuScreenOptions<T extends string> {
  /** The screen's name, in the frame's corner readout. */
  screen: string;
  /** The stamp line under the wordmark. */
  sub: string;
  /** The line along the bottom. Markup: `<b>` sets a key cap. */
  hint: string;
  entries: Array<MenuScreenEntry<T>>;
  onSelect(id: T): void;
  /** ESC. Omitted on the first screen, where there is nothing to go back to. */
  onBack?(): void;
}

export function createMenuScreen<T extends string>(
  root: HTMLElement,
  options: MenuScreenOptions<T>,
): MenuScreen<T> {
  const { entries } = options;
  const menu = document.createElement('div');
  menu.className = 'rb-menu rb-main';
  menu.innerHTML =
    frameDecor(options.screen) +
    menuHeader(options.sub) +
    `<div class="rb-console">` +
    `<div class="rb-list" role="listbox" aria-label="Game mode">` +
    entries
      .map(
        (e, i) =>
          `<button class="rb-item rb-menu__card${i === 0 ? ' is-selected' : ''}" data-mode="${e.id}" type="button" role="option">` +
          `<span class="rb-item__index">${String(i + 1).padStart(2, '0')}</span>` +
          `<span class="rb-item__name">${e.name}</span>` +
          `<span class="rb-item__kicker">${e.kicker}</span>` +
          `</button>`,
      )
      .join('') +
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
    `<div class="rb-menu__hint">${options.hint}</div>`;
  root.appendChild(menu);

  const cards = Array.from(menu.querySelectorAll<HTMLButtonElement>('.rb-item'));
  const pick = <E extends HTMLElement>(role: string): E => menu.querySelector<E>(`[data-role="${role}"]`)!;
  const dossierEl = pick('dossier');
  const dossierIdEl = pick('dossierId');
  const kickerEl = pick('kicker');
  const nameEl = pick('name');
  const descEl = pick('desc');
  const specEl = pick('spec');

  let selected = -1;
  let done = false;

  function renderDossier(entry: MenuScreenEntry<T>, index: number): void {
    dossierEl.dataset.mode = entry.id;
    dossierIdEl.textContent = `REC ${String(index + 1).padStart(2, '0')}/${String(entries.length).padStart(2, '0')}`;
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
    renderDossier(entries[selected], selected);
  }

  function choose(index: number): void {
    if (done) return;
    done = true;
    select(index);
    menu.classList.add('is-leaving');
    options.onSelect(entries[index].id);
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
      case 'Escape':
        if (!options.onBack || done) break;
        options.onBack();
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

  return {
    setSpec(id, key, value) {
      const index = entries.findIndex((e) => e.id === id);
      if (index < 0) return;
      const row = entries[index].spec.find(([k]) => k === key);
      if (!row || row[1] === value) return;
      row[1] = value;
      if (index === selected && !done) renderDossier(entries[index], index);
    },
    dispose() {
      done = true;
      window.removeEventListener('keydown', onKey);
      pad.dispose();
      menu.remove();
    },
  };
}
