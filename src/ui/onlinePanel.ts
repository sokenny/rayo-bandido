import { slotCss } from '../core/playerColors';

/**
 * Who else is in the city: a small roster under the minimap, one row per car, each in that
 * player's slot colour.
 *
 * It is the open world's whole multiplayer UI. There is no lobby to sit in and no results
 * screen to come back to, so this is the only place the game says how many people are online,
 * what they are called and — when the socket is not up — that you are driving alone. It sits
 * directly under the minimap because the two answer the same question a second apart: the map
 * says WHERE the coloured dots are, the roster says WHO they are.
 *
 * DOM only, like everything in `src/ui`. Performance contract: rows are rebuilt only when the
 * roster actually changes (the game calls `update` on a roster event, not per frame), and the
 * header text is diffed before it is written.
 */
export interface OnlinePanel {
  /** Redraw the roster. `self` is the local player's id, so their own row can be marked. */
  update(players: readonly RosterEntry[], selfId: string, max: number): void;
  /**
   * The line under the count: '' while everything is normal, otherwise why there is nobody
   * else here (connecting, no server, refused).
   */
  setNote(note: string): void;
  dispose(): void;
}

/** One row. A subset of `NetPlayer`, so the panel never imports the network layer. */
export interface RosterEntry {
  id: string;
  name: string;
  slot: number;
  host: boolean;
}

export function createOnlinePanel(root: HTMLElement): OnlinePanel {
  const wrap = document.createElement('div');
  // Placed under the minimap by `--rb-minimap-top` / `--rb-minimap-drop` in `src/styles.css`,
  // which is also where the map's own corner is decided — one place to move both.
  wrap.className = 'rb-online';
  wrap.innerHTML =
    `<div class="rb-online__head"><span class="rb-online__label">ONLINE</span>` +
    `<span class="rb-online__count" data-role="count">1</span></div>` +
    `<div class="rb-online__note" data-role="note"></div>` +
    `<div class="rb-online__list" data-role="list"></div>`;
  root.appendChild(wrap);

  const countEl = wrap.querySelector<HTMLElement>('[data-role="count"]')!;
  const noteEl = wrap.querySelector<HTMLElement>('[data-role="note"]')!;
  const listEl = wrap.querySelector<HTMLElement>('[data-role="list"]')!;

  let shownCount = '';
  let shownNote = '';
  /** What the list was last built from, so an unchanged roster is not rebuilt. */
  let shownKey = '';

  return {
    update(players, selfId, max) {
      const count = `${players.length}/${max}`;
      if (count !== shownCount) {
        countEl.textContent = count;
        shownCount = count;
      }
      // Alone in the city is worth saying out loud rather than showing as an empty box.
      wrap.classList.toggle('is-alone', players.length <= 1);

      const key = players.map((p) => `${p.id}:${p.slot}:${p.host ? 1 : 0}:${p.name}`).join('|');
      if (key === shownKey) return;
      shownKey = key;

      listEl.replaceChildren();
      for (const player of players) {
        const row = document.createElement('div');
        row.className = `rb-online__row${player.id === selfId ? ' is-self' : ''}`;
        row.style.setProperty('--rb-online-colour', slotCss(player.slot));
        const dot = document.createElement('span');
        dot.className = 'rb-online__dot';
        const name = document.createElement('span');
        name.className = 'rb-online__name';
        name.textContent = player.name;
        row.append(dot, name);
        if (player.id === selfId) {
          const you = document.createElement('span');
          you.className = 'rb-online__you';
          you.textContent = 'YOU';
          row.appendChild(you);
        }
        listEl.appendChild(row);
      }
    },

    setNote(note) {
      if (note === shownNote) return;
      shownNote = note;
      noteEl.textContent = note;
      noteEl.hidden = note === '';
    },

    dispose() {
      wrap.remove();
    },
  };
}
