import { describe, expect, it } from 'vitest';
import { boardToRivals, placeOnLadder, type LadderPlace } from '../src/ui/rushLadder';
import type { LeaderboardRow, RushStanding } from '../src/net/leaderboard';

const row = (rank: number, name: string, score: number): LeaderboardRow => ({ rank, name, score, disabled: 0, bestChain: 0, at: 0 });
const standing = (rank: number, best: number): RushStanding => ({ attemptsLeft: 3, dailyAttempts: 3, best, rank, online: true });
const place = (): LadderPlace => ({ above: null, below: null, rank: -1 });

describe('rush live ladder', () => {
  const board = [row(1, 'ANA', 9000), row(2, 'JUAN', 5000), row(3, 'BANDIDO', 3000), row(4, 'BANDIDO', 1000)];

  it('drops the own row by rank and renumbers the rest', () => {
    const rivals = boardToRivals(board, standing(2, 5000), 'JUAN');
    expect(rivals.map((r) => `${r.rank}${r.name}`)).toEqual(['1ANA', '2BANDIDO', '3BANDIDO']);
  });

  it('falls back to name AND best, never a bare name', () => {
    expect(boardToRivals(board, standing(-1, 1000), 'BANDIDO')).toHaveLength(3);
    expect(boardToRivals(board, standing(-1, -1), 'BANDIDO')).toHaveLength(4);
  });

  it('places a live score between rivals, a tie staying behind', () => {
    const rivals = boardToRivals(board, standing(2, 5000), 'JUAN');
    const at = placeOnLadder(rivals, 3000, place());
    expect([at.above?.name, at.below?.score, at.rank]).toEqual(['BANDIDO', 1000, 3]);
    const past = placeOnLadder(rivals, 3001, place());
    expect([past.above?.name, past.below?.score, past.rank]).toEqual(['ANA', 3000, 2]);
    expect(past.below).toBe(at.above);
    const top = placeOnLadder(rivals, 12000, place());
    expect([top.above, top.below?.name, top.rank]).toEqual([null, 'ANA', 1]);
  });
});
