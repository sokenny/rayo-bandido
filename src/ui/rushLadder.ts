import type { RushRival } from '../core/types';
import type { LeaderboardRow, RushStanding } from '../net/leaderboard';

/**
 * RAYO RUSH's LIVE LADDER: the run's score held up against the other players' bests while it is
 * still being driven, so the board is something you climb during the run and not only a number
 * you read after it.
 *
 * The board is fetched once (a page of `LADDER_PAGE` rows) and never during a frame; each frame
 * only walks that sorted page to find the rows either side of the live score. Fifty rows is a
 * few comparisons, and the result is two references into the page, not new objects.
 */

/** Rows asked for: the server's page limit (`MAX_PAGE` in `server/scores.mjs`). */
export const LADDER_PAGE = 50;

/**
 * The board as rivals: highest first, the local player's own row taken out, ranks renumbered so
 * they say where a live score would actually land. The own row is found by its rank on the board
 * when the standing knows it, else by name AND best together — a name alone is not an identity
 * (every unnamed player is `BANDIDO`).
 */
export function boardToRivals(rows: readonly LeaderboardRow[], standing: RushStanding | null, myName: string | null): RushRival[] {
  let own = -1;
  if (standing && standing.rank > 0) own = rows.findIndex((r) => r.rank === standing.rank);
  if (own < 0 && standing && standing.best > 0 && myName) {
    own = rows.findIndex((r) => r.name === myName && r.score === standing.best);
  }
  const rivals: RushRival[] = [];
  for (let i = 0; i < rows.length; i++) {
    if (i === own) continue;
    rivals.push({ name: rows[i].name, score: rows[i].score, rank: rivals.length + 1 });
  }
  return rivals;
}

export interface LadderPlace {
  above: RushRival | null;
  below: RushRival | null;
  rank: number;
}

/**
 * Where `score` sits among `rivals` (sorted highest first). A tie keeps the rival ahead — whoever
 * posted the number first holds the row, the same rule the server orders by — so passing someone
 * means beating their best, not matching it.
 */
export function placeOnLadder(rivals: readonly RushRival[], score: number, out: LadderPlace): LadderPlace {
  let i = 0;
  while (i < rivals.length && rivals[i].score >= score) i++;
  out.above = i > 0 ? rivals[i - 1] : null;
  out.below = i < rivals.length ? rivals[i] : null;
  out.rank = i + 1;
  return out;
}
