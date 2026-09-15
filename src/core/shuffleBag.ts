/**
 * A shuffle bag: every item once, in a random order, before any item comes round again — and the
 * first draw of a refilled bag is never the item the previous bag ended on, so the same item is
 * never drawn twice in a row (given more than one).
 */
export interface ShuffleBag<T> {
  next(): T;
  /** Empty the bag and forget the last draw. */
  reset(): void;
}

export function createShuffleBag<T>(items: readonly T[], random: () => number = Math.random): ShuffleBag<T> {
  if (items.length === 0) throw new Error('createShuffleBag: no items');
  /** Indices still to draw; drawn from the end. */
  let bag: number[] = [];
  let last = -1;

  function refill(): void {
    bag = items.map((_, i) => i);
    // Fisher–Yates.
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.min(i, Math.floor(random() * (i + 1)));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    // The next draw is `bag[bag.length - 1]`: swap it away from the last one played.
    const top = bag.length - 1;
    if (top > 0 && bag[top] === last) [bag[top], bag[0]] = [bag[0], bag[top]];
  }

  return {
    next() {
      if (bag.length === 0) refill();
      last = bag.pop()!;
      return items[last];
    },
    reset() {
      bag = [];
      last = -1;
    },
  };
}
