import { describe, expect, it } from 'vitest';
import { CHANGELOG } from '../src/content/changelog';

/**
 * The changelog is the one file in the project that a deploy is required to edit, which means
 * it is edited in a hurry, at the end of a long session, by whoever is shipping. These are the
 * mistakes that costs: a date typed in the wrong format so the tab sorts it into the middle of
 * last week, a second block for a day that already has one, an empty entry left behind after
 * the lines were moved, or a paragraph pasted in where a line belongs.
 *
 * None of it can break the game — the tab would simply read badly, which is exactly the sort of
 * thing nobody notices until a player does.
 */

const ISO = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
/** Long enough for a real sentence, short enough that it cannot become release notes. */
const MAX_ITEM = 120;

describe('the changelog', () => {
  it('has at least one entry, and every entry has something in it', () => {
    expect(CHANGELOG.length).toBeGreaterThan(0);
    for (const entry of CHANGELOG) {
      expect(entry.items.length, `${entry.date} has no items`).toBeGreaterThan(0);
      for (const item of entry.items) expect(item.trim(), `${entry.date} has a blank line`).not.toBe('');
    }
  });

  it('dates every entry as a real day, in ISO, and never twice', () => {
    const seen = new Set<string>();
    for (const entry of CHANGELOG) {
      expect(entry.date, `"${entry.date}" is not YYYY-MM-DD`).toMatch(ISO);
      expect(seen.has(entry.date), `${entry.date} appears twice — add to the entry, do not open a second one`).toBe(false);
      seen.add(entry.date);
    }
  });

  it('runs newest first, which is the order the tab draws', () => {
    const dates = CHANGELOG.map((e) => e.date);
    const sorted = [...dates].sort().reverse();
    expect(dates).toEqual(sorted);
  });

  it('keeps every line to one terse, player-facing sentence', () => {
    for (const entry of CHANGELOG) {
      for (const item of entry.items) {
        expect(item.length, `${entry.date}: "${item}" is too long for the tab`).toBeLessThanOrEqual(MAX_ITEM);
        expect(item.includes('\n'), `${entry.date}: "${item}" spans lines`).toBe(false);
      }
    }
  });
});
