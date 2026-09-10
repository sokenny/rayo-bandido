import type { CircuitGateHudSnapshot } from '../core/types';
import { missionLabel } from './rushOverlay';

/**
 * THE START LINE'S SIGN: the one piece of screen furniture the circuit missions have in the
 * open world.
 *
 * THE SAME SIGN RAYO RUSH USES. Every class here is the rush prompt's own
 * (`rushOverlay.ts`, the `.rb-rush__prompt*` rules in `styles.css`), reused as they are and in
 * the same hazard yellow — the way El Búho's overlay reuses a passenger's. That is not
 * laziness, it is the rule the skin is built on: yellow is the system talking to the player,
 * and there is only one system. What tells the two apart is what they SAY and where they stand
 * — a different word, a different mission line, and a ring painted two blocks away in a
 * different colour (`render/scene/env/activityMarker.ts`).
 *
 * WHAT IT DOES NOT HAVE, because the missions are not driven here: no clock, no score, no feed
 * and no results card. Those belong to the race on the other side of the door, and the race
 * already has them (`src/ui/hud.ts`). This is a sign on a road.
 *
 * Built once, `update` writes only what changed, nothing reads geometry back.
 */
export interface GateOverlayOptions {
  /**
   * Raise `PlayerCommand.activate` on the next tick — the same intent the key raises, so a tap
   * on a phone opens the door rather than firing the lightning.
   */
  onActivate(): void;
}

export interface GateOverlay {
  root: HTMLElement;
  update(gate: CircuitGateHudSnapshot): void;
  dispose(): void;
}

/** `160` -> `2:40`. A target time is set in whole seconds, so it is written like a pit board. */
export function formatTargetTime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

/**
 * The line that says what the mission wants: a time, and how much contact it will forgive.
 *
 * There is no fraction of zero, so the last mission does not say "0 CRASHES" — it says what it
 * actually means, which is that touching anything ends it.
 */
export function ruleLine(targetTime: number, crashLimit: number): string {
  const time = `FINISH INSIDE ${formatTargetTime(targetTime)}`;
  if (crashLimit <= 0) return `${time} · WITHOUT TOUCHING A THING`;
  return `${time} · ${crashLimit} CRASH${crashLimit === 1 ? '' : 'ES'} ALLOWED`;
}

function pick<T extends Element>(root: ParentNode, selector: string): T {
  const el = root.querySelector(selector);
  if (!el) throw new Error(`Rayo Bandido gate overlay: missing element "${selector}"`);
  return el as T;
}

export function createGateOverlay(options: GateOverlayOptions): GateOverlay {
  const root = document.createElement('div');
  // `rb-rush` is the layer (a full-screen pass-through); `rb-gate` is what this one is, for
  // anything that ever wants to tell them apart.
  root.className = 'rb-rush rb-gate';
  root.innerHTML =
    `<button type="button" class="rb-rush__prompt">` +
    `<span class="rb-rush__prompt-title">TIME ATTACK</span>` +
    `<span class="rb-rush__prompt-mission"></span>` +
    `<span class="rb-rush__prompt-lines">` +
    `<span>TWO LAPS OF THE BANDIDO GRID, ALONE, AGAINST THE CLOCK</span>` +
    `<span class="rb-rush__prompt-target"></span>` +
    `</span>` +
    `<span class="rb-rush__prompt-key"><span class="rb-key">F</span> ENTER</span>` +
    `</button>`;

  const promptEl = pick<HTMLButtonElement>(root, '.rb-rush__prompt');
  const missionEl = pick<HTMLElement>(root, '.rb-rush__prompt-mission');
  const targetEl = pick<HTMLElement>(root, '.rb-rush__prompt-target');

  const onClick = (e: Event): void => {
    e.preventDefault();
    options.onActivate();
  };
  promptEl.addEventListener('click', onClick);

  let shownOffering = false;
  let shownLevel = -1;
  let shownAllClear = false;

  return {
    root,

    update(gate) {
      if (gate.offering !== shownOffering) {
        shownOffering = gate.offering;
        promptEl.classList.toggle('is-on', gate.offering);
      }
      // The sign's text only ever changes when the chain does, which in this world it cannot:
      // the missions are cleared on the other side of the load. Guarded anyway, because the
      // cheapest write is the one that does not happen.
      if (gate.level !== shownLevel || gate.allClear !== shownAllClear) {
        shownLevel = gate.level;
        shownAllClear = gate.allClear;
        missionEl.textContent = missionLabel(gate.level, gate.levelCount, gate.levelName, gate.allClear);
        missionEl.classList.toggle('is-clear', gate.allClear);
        targetEl.textContent = gate.allClear
          ? 'EVERY MISSION CLEAR · DRIVE IT FOR THE TIME'
          : ruleLine(gate.targetTime, gate.crashLimit);
      }
    },

    dispose() {
      promptEl.removeEventListener('click', onClick);
      root.remove();
    },
  };
}
