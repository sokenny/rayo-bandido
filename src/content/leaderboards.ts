/**
 * THE HOLOGRAM LEADERBOARDS' CONTENT: one board per activity, standing beside its ring in the
 * open world (`src/render/scene/env/leaderboardHologram.ts`).
 *
 * THE ROWS COME FROM THE SERVER (`server/scores.mjs`): the game fetches each board's top ten
 * when the open world starts, and again every minute and after every run it files, and hands them
 * to the board's `setRows` (`src/game.ts`). What is here is the look, the placement and the
 * format; a board starts empty and stays empty when the server cannot be reached, because a
 * RANKING GLOBAL with invented names on it would be a lie once there is a real one.
 */

export type LeaderboardKind = 'rush' | 'circuit' | 'street';

export interface LeaderboardRow {
  name: string;
  /** Points for RAYO RUSH; seconds for the timed boards. */
  value: number;
}

export interface LeaderboardBoardSpec {
  /** The big word at the top. */
  title: string;
  /** The line under it: what is being ranked. */
  subtitle: string;
  /** The value column's heading. */
  column: string;
  /** How a value is written. */
  format: 'points' | 'time';
  /**
   * Where the board stands, from its ring: which side of the ring's own axis (+1 / -1) and how
   * far out (m). Picked by eye against the street each ring is on.
   */
  side: 1 | -1;
  lateral: number;
  rows: LeaderboardRow[];
}

export const LEADERBOARDS: Record<LeaderboardKind, LeaderboardBoardSpec> = {
  rush: {
    title: 'RAYO RUSH',
    subtitle: 'TOP 10 · PUNTAJE',
    column: 'PUNTOS',
    format: 'points',
    side: 1,
    lateral: 13,
    rows: [],
  },
  circuit: {
    title: 'TIME ATTACK',
    subtitle: 'TOP 10 · BANDIDO GRID',
    column: 'TIEMPO',
    format: 'time',
    side: 1,
    lateral: 13,
    rows: [],
  },
  street: {
    title: 'STREET RACE',
    subtitle: 'TOP 10 · CIRCUITO LA CURVA',
    column: 'TIEMPO',
    format: 'time',
    side: 1,
    lateral: 13,
    rows: [],
  },
};

/** `48320` -> `48,320`; `98.412` -> `1:38.412`. */
export function formatLeaderboardValue(value: number, format: LeaderboardBoardSpec['format']): string {
  if (format === 'points') return Math.round(value).toLocaleString('en-US');
  const ms = Math.round(value * 1000);
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const frac = ms % 1000;
  return `${m}:${String(s).padStart(2, '0')}.${String(frac).padStart(3, '0')}`;
}
