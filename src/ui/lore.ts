import { createGamepadMenuNav } from '../core/input/gamepadMenu';
import { frameDecor, menuHeader } from './chrome';

/**
 * The LORE tab: who Rayo Bandido is and why the city hates the sound of him. Built like the
 * CHANGELOG — a screen to read, entered by address (`?lore=1`), ESC back to the menu.
 *
 * The copy is written in Rioplatense Spanish on purpose ("guita", "derrapá", "bandidaje"):
 * it is the voice of the game, not a translation waiting to happen.
 */
export interface LoreScreen {
  dispose(): void;
}

/** How far ↑/↓ and the pad move the text, in pixels. About one paragraph. */
const SCROLL_STEP = 120;

export function createLoreScreen(root: HTMLElement, onBack: () => void): LoreScreen {
  const wrap = document.createElement('div');
  wrap.className = 'rb-menu rb-log rb-lore';
  wrap.innerHTML =
    frameDecor('LORE') +
    menuHeader('AÑO 2069 · LA COMBUSTIÓN ES DELITO') +
    `<div class="rb-panel rb-log__panel">` +
    `<div class="rb-panel__head"><span>LORE</span><span class="rb-panel__id">AÑO 2069</span></div>` +
    `<div class="rb-log__scroll rb-lore__body" data-role="scroll" tabindex="0">` +
    `<p>Año 2069</p>` +
    `<p>Los autos eléctricos gobiernan las calles.</p>` +
    `<p>Son silenciosos, obedientes y están conectados a una red que registra cada movimiento. ` +
    `Los motores a combustión fueron declarados ilegales hace años. Tener uno es delito. ` +
    `Encenderlo es una provocación.</p>` +
    `<p>Pero todavía queda alguien haciendo ruido.</p>` +
    `<p>Rayo Bandido</p>` +
    `<p>Al volante de una máquina prohibida, Rayo Bandido recorre la ciudad derrapando entre ` +
    `patrullas y deshabilitando vehículos eléctricos con una modificación clandestina: el Rayo.</p>` +
    `<p>Cada EV destruido le da guita.</p>` +
    `<p>Cada derrape carga el Rayo.</p>` +
    `<p>Cada maniobra imposible farmea Aura.</p>` +
    `<p>No está tratando de salvar la ciudad. Tampoco de liberar a nadie.</p>` +
    `<p>Anda de bandidaje porque puede.</p>` +
    `<p>La calle es tuya</p>` +
    `<p>Derrapá. Esquivá el tráfico. Bajá eléctricos. Escapá de la policía.</p>` +
    `<p>Hacé suficiente ruido como para que la ciudad recuerde cómo sonaba un motor.</p>` +
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
