import type { StreetGateHudSnapshot } from '../core/types';
import { STREET_RACE } from '../config/tuning';

/**
 * THE STREET RACE SIGN in the open world: one prompt, up while the car is on an open ring.
 *
 * The same classes the RAYO RUSH prompt and the TIME ATTACK sign use (`rushOverlay.ts`,
 * `gateOverlay.ts`), reused as they are — the sign is the same sign, only the words differ.
 * Built once; `update` writes only what changed.
 */
export interface StreetOverlayOptions {
  onActivate(): void;
}

export interface StreetOverlay {
  root: HTMLElement;
  update(gate: StreetGateHudSnapshot): void;
  dispose(): void;
}

function pick<T extends Element>(root: ParentNode, selector: string): T {
  const el = root.querySelector(selector);
  if (!el) throw new Error(`Rayo Bandido street overlay: missing element "${selector}"`);
  return el as T;
}

/** "STREET RACE II · MEDIUM · 2 RIVALS", with a note when it has already been won. */
export function streetMissionLabel(gate: StreetGateHudSnapshot): string {
  const rivals = `${gate.rivals} RIVAL${gate.rivals === 1 ? '' : 'S'}`;
  const done = gate.completed ? ' · WON' : '';
  return `${gate.eventName} · ${gate.difficulty} · ${rivals}${done}`;
}

export function createStreetOverlay(options: StreetOverlayOptions): StreetOverlay {
  const root = document.createElement('div');
  root.className = 'rb-rush rb-street';
  root.innerHTML =
    `<button type="button" class="rb-rush__prompt">` +
    `<span class="rb-rush__prompt-title">${STREET_RACE.label}</span>` +
    `<span class="rb-rush__prompt-mission"></span>` +
    `<span class="rb-rush__prompt-lines">` +
    `<span class="rb-rush__prompt-blurb"></span>` +
    `<span class="rb-rush__prompt-target">${STREET_RACE.laps} LAPS OF THE QUAY CIRCUIT · FIRST TO THE FLAG</span>` +
    `</span>` +
    `<span class="rb-rush__prompt-key"><span class="rb-key">F</span> RACE</span>` +
    `</button>`;

  const promptEl = pick<HTMLButtonElement>(root, '.rb-rush__prompt');
  const missionEl = pick<HTMLElement>(root, '.rb-rush__prompt-mission');
  const blurbEl = pick<HTMLElement>(root, '.rb-rush__prompt-blurb');

  const onClick = (e: Event): void => {
    e.preventDefault();
    options.onActivate();
  };
  promptEl.addEventListener('click', onClick);

  let shownOffering = false;
  let shownEvent = -1;
  let shownCompleted = false;

  return {
    root,
    update(gate) {
      if (gate.offering !== shownOffering) {
        shownOffering = gate.offering;
        promptEl.classList.toggle('is-on', gate.offering);
      }
      if (gate.event !== shownEvent || gate.completed !== shownCompleted) {
        shownEvent = gate.event;
        shownCompleted = gate.completed;
        missionEl.textContent = streetMissionLabel(gate);
        missionEl.classList.toggle('is-clear', gate.completed);
        blurbEl.textContent = gate.blurb;
      }
    },
    dispose() {
      promptEl.removeEventListener('click', onClick);
      root.remove();
    },
  };
}
