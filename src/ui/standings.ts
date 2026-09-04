import { slotCss } from '../core/playerColors';

/**
 * Live classification during a multiplayer race: who is winning, and by how much.
 *
 * Sits under the minimap in the top-right corner. Like the rest of the HUD it is DOM only,
 * built once, and diffed on every write — `src/game.ts` hands it a snapshot every frame and
 * almost every frame changes nothing but a gap.
 *
 * The gap is shown in METRES along the lap rather than in seconds. Seconds would need a
 * prediction of how fast the car ahead is going, which is exactly the number the network is
 * least sure about; distance along the centreline is something both clients already agree on,
 * and in a race this short "18 m" is the more useful thing to know anyway.
 */
export interface StandingsRow {
  name: string;
  /** Grid slot, which fixes the colour. */
  slot: number;
  /** Completed laps plus the fraction of the current one. */
  progress: number;
  /** Metres behind the leader. 0 for the leader itself. */
  gap: number;
  /** True for the local player's row. */
  self: boolean;
  /** True once this car has taken the flag. */
  finished: boolean;
  /** Total race time (s) once finished, else -1. */
  finishTime: number;
}

export interface Standings {
  /** `rows` must already be sorted, leader first — see `rankStandings`. */
  update(rows: readonly StandingsRow[]): void;
  dispose(): void;
}

/**
 * Rank the field in place and work out each car's gap to the leader.
 *
 * `order` is sorted, so it must NOT be the array whose index says which row belongs to which
 * player — the caller keeps that one in its build order and passes a second array holding the
 * same row objects. (Sorting the one array was a real bug: after the first frame, "row 0 is
 * me" was no longer true, and everyone's progress was written onto somebody else's row.)
 */
export function rankStandings(order: StandingsRow[], lapLength: number): void {
  if (order.length === 0) return;
  // A car that has taken the flag is ahead of one still running, whatever the progress says;
  // then finishers by time, and everyone else by how far round they are.
  order.sort((a, b) => {
    if (a.finished !== b.finished) return a.finished ? -1 : 1;
    if (a.finished && b.finished) return a.finishTime - b.finishTime;
    return b.progress - a.progress;
  });
  const leader = order[0].progress;
  for (let i = 0; i < order.length; i++) {
    order[i].gap = Math.max(0, (leader - order[i].progress) * lapLength);
  }
}

/** Below this the two cars are effectively together and a number would just flicker. */
const SAME_PLACE_M = 1;

function formatGap(row: StandingsRow, index: number, lapLength: number): string {
  if (index === 0) return row.finished ? 'FINISHED' : 'LEADER';
  if (row.finished) return 'FINISHED';
  if (lapLength > 0 && row.gap >= lapLength) {
    const laps = Math.floor(row.gap / lapLength);
    return `+${laps} LAP${laps > 1 ? 'S' : ''}`;
  }
  if (row.gap < SAME_PLACE_M) return 'ALONGSIDE';
  return `+${Math.round(row.gap)} m`;
}

export function createStandings(root: HTMLElement, lapLength: number, maxRows: number): Standings {
  const wrap = document.createElement('div');
  wrap.className = 'rb-standings';
  root.appendChild(wrap);

  /** One built row, plus what it currently displays, so a write only happens on a change. */
  interface RowElements {
    el: HTMLDivElement;
    pos: HTMLSpanElement;
    name: HTMLSpanElement;
    gap: HTMLSpanElement;
    shownPos: string;
    shownName: string;
    shownGap: string;
    shownSelf: boolean;
    shownColour: string;
  }

  // Every row that could ever be needed, built once and shown or hidden as the field changes.
  const rows: RowElements[] = [];
  for (let i = 0; i < maxRows; i++) {
    const el = document.createElement('div');
    el.className = 'rb-standings__row';
    el.hidden = true;
    const pos = document.createElement('span');
    pos.className = 'rb-standings__pos';
    const name = document.createElement('span');
    name.className = 'rb-standings__name';
    const gap = document.createElement('span');
    gap.className = 'rb-standings__gap';
    el.append(pos, name, gap);
    wrap.appendChild(el);
    rows.push({ el, pos, name, gap, shownPos: '', shownName: '', shownGap: '', shownSelf: false, shownColour: '' });
  }

  return {
    update(next) {
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const data = i < next.length ? next[i] : null;
        if (!data) {
          if (!row.el.hidden) row.el.hidden = true;
          continue;
        }
        if (row.el.hidden) row.el.hidden = false;

        const position = `P${i + 1}`;
        if (position !== row.shownPos) {
          row.pos.textContent = position;
          row.shownPos = position;
        }
        if (data.name !== row.shownName) {
          row.name.textContent = data.name;
          row.shownName = data.name;
        }
        const colour = slotCss(data.slot);
        if (colour !== row.shownColour) {
          row.el.style.setProperty('--rb-standings-colour', colour);
          row.shownColour = colour;
        }
        if (data.self !== row.shownSelf) {
          row.el.classList.toggle('is-self', data.self);
          row.shownSelf = data.self;
        }
        const gap = formatGap(data, i, lapLength);
        if (gap !== row.shownGap) {
          row.gap.textContent = gap;
          row.shownGap = gap;
        }
      }
    },

    dispose() {
      wrap.remove();
    },
  };
}
