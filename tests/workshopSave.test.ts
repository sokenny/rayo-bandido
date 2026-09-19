import { afterEach, describe, expect, it } from 'vitest';
import {
  MAX_OWNED_PARTS,
  applyProgressSnapshot,
  clearSavedProgress,
  emptyGarageSave,
  readGarage,
  readProgressSnapshot,
  sanitizeOwnedParts,
  writeGarage,
} from '../src/core/progress';
import { STOCK_LOADOUT, encodeLoadout, setChoice, setPlateText, stockLoadout } from '../src/core/loadout';

/**
 * The workshop's save (`rb.garage` in `src/core/progress.ts`): the car as worn and what was bought.
 * Same contract as every other record: garbage in, today's car and nothing bought out.
 */

const KEY = 'rb.garage';

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

const painted = () => setPlateText(setChoice(setChoice(stockLoadout(), 'paint', 'red'), 'rideHeight', -3), 'RAYO 1');

describe('the garage save', () => {
  it('reads as today’s car with no storage at all, and writing is not a throw', () => {
    expect(readGarage()).toEqual(emptyGarageSave());
    expect(() => writeGarage({ loadout: painted(), owned: ['hood.vent'] })).not.toThrow();
    expect(readProgressSnapshot().garage).toBeNull();
  });

  it('survives a round trip, stored as the compact code', () => {
    const store = installStorage();
    writeGarage({ loadout: painted(), owned: ['hood.vent', 'rims.mesh-8'] });
    const raw = JSON.parse(store.get(KEY)!);
    expect(raw).toEqual({ v: 1, loadout: encodeLoadout(painted()), owned: ['hood.vent', 'rims.mesh-8'] });
    const back = readGarage();
    expect(encodeLoadout(back.loadout)).toBe(encodeLoadout(painted()));
    expect(back.owned).toEqual(['hood.vent', 'rims.mesh-8']);
  });

  it('never returns a record the caller has to check', () => {
    for (const raw of ['', 'not json', '[]', 'null', '7', '{"loadout":42,"owned":"all"}', '{"loadout":"L1|nope","owned":[null,{}]}']) {
      installStorage({ [KEY]: raw });
      const save = readGarage();
      expect(encodeLoadout(save.loadout)).toBe(encodeLoadout(STOCK_LOADOUT));
      expect(save.owned).toEqual([]);
    }
  });

  it('sanitizes a hand-edited loadout object and the owned list', () => {
    installStorage({
      [KEY]: JSON.stringify({ loadout: { paint: { base: 'red', finish: 'velvet' }, plate: { text: 'ñandú!!!' } }, owned: ['hood.vent', 'hood.vent', 'hood.stock', 'vinyls.rayo', 'BAD', 'x.Y', 'a'.repeat(70) + '.b'] }),
    });
    const save = readGarage();
    expect(save.loadout.paint).toEqual({ base: 'red', finish: STOCK_LOADOUT.paint.finish });
    expect(save.loadout.plate.text).toBe('NANDU');
    expect(save.owned).toEqual(['hood.vent']);
    const many = Array.from({ length: MAX_OWNED_PARTS + 50 }, (_, i) => `hood.p${i}`);
    expect(sanitizeOwnedParts(many)).toHaveLength(MAX_OWNED_PARTS);
  });

  it('rides in the account snapshot, is applied through the same sanitizing, and is forgotten on sign-out', () => {
    const store = installStorage();
    writeGarage({ loadout: painted(), owned: ['hood.vent'] });
    expect(readProgressSnapshot().garage).toEqual({ loadout: encodeLoadout(painted()), owned: ['hood.vent'] });

    applyProgressSnapshot({ garage: { loadout: encodeLoadout(stockLoadout()), owned: ['rims.mesh-8', 'nope nope'] } });
    expect(readGarage().owned).toEqual(['rims.mesh-8']);
    expect(encodeLoadout(readGarage().loadout)).toBe(encodeLoadout(STOCK_LOADOUT));

    // A browser that has written since it sent keeps its own car.
    writeGarage({ loadout: painted(), owned: ['hood.vent'] });
    applyProgressSnapshot({ garage: { loadout: encodeLoadout(stockLoadout()), owned: [] } }, { wallet: false });
    expect(encodeLoadout(readGarage().loadout)).toBe(encodeLoadout(painted()));

    clearSavedProgress();
    expect(store.has(KEY)).toBe(false);
  });
});
