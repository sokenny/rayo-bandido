import { afterEach, describe, expect, it } from 'vitest';
import { emptyRushProgress, readRushProgress, recordRushRun, writeRushProgress } from '../src/core/progress';
import { RUSH } from '../src/config/tuning';

/**
 * What the browser remembers about the RAYO RUSH mission chain (`src/core/progress.ts`).
 *
 * The interesting half of this module is not the happy path — it is everything that arrives
 * from storage, because all of it is a string a user can edit in a build that may be older than
 * this one. So most of what is below is garbage in, sane record out.
 *
 * `localStorage` does not exist in the node test environment, which is itself worth pinning:
 * the module has to work in a browser that refuses storage outright, and the tests run in one.
 * A minimal stub is installed for the tests that need a round trip and removed afterwards, so
 * the no-storage case is the one the module is exercised under by default.
 */

const KEY = 'rb.rush.missions';

function installStorage(seed: Record<string, string> = {}): Map<string, string> {
  const store = new Map<string, string>(Object.entries(seed));
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  };
  return store;
}

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe('rush progress: a record that is always whole', () => {
  it('reads as a fresh player when there is no storage at all', () => {
    // No stub installed: this is a browser that will not have it, and the game still plays.
    const progress = readRushProgress();
    expect(progress).toEqual(emptyRushProgress());
    expect(progress.cleared).toBe(0);
    expect(progress.best).toHaveLength(RUSH.levels.length);
    // And writing is a no-op rather than a throw.
    expect(() => writeRushProgress({ cleared: 2, best: [] })).not.toThrow();
  });

  it('survives a round trip', () => {
    installStorage();
    const best = RUSH.levels.map((_, i) => 100 * (i + 1));
    writeRushProgress({ cleared: 2, best });
    expect(readRushProgress()).toEqual({ cleared: 2, best });
  });

  it('never returns a record the caller has to check', () => {
    for (const raw of ['', 'not json', '[]', 'null', '{"cleared":"lots"}', '{"best":"nope"}', '7']) {
      installStorage({ [KEY]: raw });
      const progress = readRushProgress();
      // Whatever went in, what comes out is indexable by level and countable.
      expect(progress.best).toHaveLength(RUSH.levels.length);
      expect(Number.isInteger(progress.cleared)).toBe(true);
      expect(progress.cleared).toBeGreaterThanOrEqual(0);
      expect(progress.cleared).toBeLessThanOrEqual(RUSH.levels.length);
    }
  });

  it('clamps a stored count to the chain that exists now, not the one that wrote it', () => {
    // A record from a build with more missions in it, or one somebody typed by hand.
    installStorage({ [KEY]: JSON.stringify({ cleared: 99, best: [] }) });
    expect(readRushProgress().cleared).toBe(RUSH.levels.length);

    installStorage({ [KEY]: JSON.stringify({ cleared: -3, best: [] }) });
    expect(readRushProgress().cleared).toBe(0);

    installStorage({ [KEY]: JSON.stringify({ cleared: 1.7, best: [] }) });
    expect(readRushProgress().cleared).toBe(1);
  });

  it('grows `best` to the length of the chain, whatever length it was written at', () => {
    // A record from a build with fewer missions: the missing ones read as never run rather
    // than as undefined, so a caller may index it by level without checking.
    installStorage({ [KEY]: JSON.stringify({ cleared: 1, best: [4200] }) });
    const progress = readRushProgress();
    expect(progress.best).toHaveLength(RUSH.levels.length);
    expect(progress.best[0]).toBe(4200);
    for (let i = 1; i < progress.best.length; i++) expect(progress.best[i]).toBe(-1);

    // And junk inside it is a score that was never posted, not a NaN passed on.
    installStorage({ [KEY]: JSON.stringify({ cleared: 0, best: ['x', null, {}] }) });
    expect(readRushProgress().best.every((v) => v === -1)).toBe(true);
  });
});

describe('rush progress: folding a finished run in', () => {
  it('keeps the best score per mission and advances only when told to', () => {
    let progress = emptyRushProgress();

    progress = recordRushRun(progress, 0, 1500, true);
    expect(progress.cleared).toBe(1);
    expect(progress.best[0]).toBe(1500);

    // A worse run at the same mission is still a run: it is recorded, it just is not the best.
    progress = recordRushRun(progress, 0, 900, false);
    expect(progress.best[0]).toBe(1500);
    expect(progress.cleared).toBe(1);

    // A better one replaces it, and replaying a cleared mission never moves the chain.
    progress = recordRushRun(progress, 0, 2400, false);
    expect(progress.best[0]).toBe(2400);
    expect(progress.cleared).toBe(1);
  });

  it('never lets the chain go backwards', () => {
    // Two missions in, a strong run at the first one. It must not demote the player to
    // mission 2 — `cleared` is both "how many are done" and "which is on offer".
    let progress = { cleared: 2, best: RUSH.levels.map(() => -1) };
    progress = recordRushRun(progress, 0, 99_999, true);
    expect(progress.cleared).toBe(2);
  });

  it('ignores a level that is not in the chain rather than growing the record', () => {
    const before = emptyRushProgress();
    const after = recordRushRun(before, RUSH.levels.length + 5, 5000, false);
    expect(after.best).toHaveLength(RUSH.levels.length);
    expect(after.best).toEqual(before.best);
  });

  it('does not touch the record it was given', () => {
    // Pure, so the caller decides whether the run is worth writing down.
    const before = emptyRushProgress();
    recordRushRun(before, 0, 5000, true);
    expect(before).toEqual(emptyRushProgress());
  });
});
