import { CHANGELOG, type ChangelogEntry } from '../content/changelog';
import { createGamepadMenuNav } from '../core/input/gamepadMenu';
import { frameDecor, menuHeader } from './chrome';

/**
 * The CHANGELOG tab: what shipped, by the day it shipped. Copy comes from
 * `src/content/changelog.ts`, which every deploy is made to update.
 *
 * A screen rather than a card on the main menu's dossier, because the dossier describes a
 * place you are about to drive into and this is a thing to read. Dressed as the rest of the
 * terminal all the same, and entered the same way every other screen is — by address
 * (`?log=1`) — so back and forward work on it like anything else.
 *
 * DOM only. It reads a constant and draws it; there is no state here to get wrong.
 */
export interface ChangelogScreen {
  dispose(): void;
}

/** How far ↑/↓ and the pad move the list, in pixels. About one entry. */
const SCROLL_STEP = 120;

/** `2026-09-11` -> `11 SEP 2026`. Parsed by hand: `new Date('...')` would drag a timezone in. */
function stamp(date: string): string {
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const [y, m, d] = date.split('-');
  const month = months[Number(m) - 1] ?? m;
  return `${d} ${month} ${y}`;
}

/**
 * The entries are written in a source file that a script edits on every deploy, so they are
 * escaped rather than trusted: an apostrophe or an ampersand in a line of copy must never be
 * able to become markup.
 */
function esc(text: string): string {
  return text.replace(/[&<>"]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;'));
}

function entryHtml(entry: ChangelogEntry, index: number): string {
  return (
    `<section class="rb-log__entry">` +
    `<div class="rb-log__when">` +
    `<span class="rb-log__date">${esc(stamp(entry.date))}</span>` +
    (index === 0 ? `<span class="rb-log__tag">LATEST</span>` : '') +
    `</div>` +
    `<ul class="rb-log__items">` +
    entry.items.map((item) => `<li>${esc(item)}</li>`).join('') +
    `</ul>` +
    `</section>`
  );
}

export function createChangelogScreen(root: HTMLElement, onBack: () => void): ChangelogScreen {
  const wrap = document.createElement('div');
  wrap.className = 'rb-menu rb-log';
  wrap.innerHTML =
    frameDecor('CHANGELOG') +
    menuHeader('WHAT CHANGED, AND WHEN') +
    `<div class="rb-panel rb-log__panel">` +
    `<div class="rb-panel__head"><span>BUILD_LOG</span>` +
    `<span class="rb-panel__id">${CHANGELOG.length} ENTRIES</span></div>` +
    `<div class="rb-log__scroll" data-role="scroll" tabindex="0">` +
    (CHANGELOG.length
      ? CHANGELOG.map(entryHtml).join('')
      : `<div class="rb-log__empty">NOTHING LOGGED YET</div>`) +
    `</div>` +
    `</div>` +
    `<button class="rb-btn rb-log__back" type="button" data-role="back">BACK</button>` +
    `<div class="rb-menu__hint"><b>ESC</b> back to the menu · <b>↑</b> <b>↓</b> scroll</div>`;
  root.appendChild(wrap);

  const scroll = wrap.querySelector<HTMLElement>('[data-role="scroll"]')!;
  let done = false;

  function back(): void {
    if (done) return;
    done = true;
    wrap.classList.add('is-leaving');
    onBack();
  }

  const onKey = (e: KeyboardEvent): void => {
    switch (e.code) {
      case 'Escape':
      case 'Backspace':
        back();
        e.preventDefault();
        break;
      case 'ArrowUp':
      case 'KeyW':
        scroll.scrollBy({ top: -SCROLL_STEP, behavior: 'smooth' });
        e.preventDefault();
        break;
      case 'ArrowDown':
      case 'KeyS':
        scroll.scrollBy({ top: SCROLL_STEP, behavior: 'smooth' });
        e.preventDefault();
        break;
      default:
        break;
    }
  };
  window.addEventListener('keydown', onKey);
  const pad = createGamepadMenuNav({
    onMove: (delta) => scroll.scrollBy({ top: delta * SCROLL_STEP, behavior: 'smooth' }),
    onConfirm: back,
    onBack: back,
  });
  wrap.querySelector<HTMLButtonElement>('[data-role="back"]')!.addEventListener('click', back);

  return {
    dispose() {
      done = true;
      window.removeEventListener('keydown', onKey);
      pad.dispose();
      wrap.remove();
    },
  };
}
