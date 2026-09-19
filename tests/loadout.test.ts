import { describe, expect, it } from 'vitest';
import {
  DECAL_ZONES,
  MAX_VINYLS,
  STEP_RANGES,
  STOCK_LOADOUT,
  cloneLoadout,
  decodeLoadout,
  encodeLoadout,
  getChoice,
  isValidChoice,
  loadoutPartIds,
  loadoutRating,
  loadoutsEqual,
  sanitizeLoadout,
  sanitizePlateText,
  setChoice,
  setPlateText,
  setVinyls,
  stockLoadout,
  stockPartsMissing,
  type CarLoadout,
  type ScalarCategoryId,
} from '../src/core/loadout';
import { CATEGORIES, CATEGORY_IDS, GROUPS, PALETTE, PARTS, categoryDef, findPart, validateCatalogue } from '../src/content/carParts';
import { LOCO_MUSTANG_SHOP, SHOPS, shopPrice, validateShop } from '../src/content/shops';

/**
 * The workshop's contracts (`docs/GARAGE_PLAN.md` §2.1, "Contratos de la Ola 0"): the loadout
 * every other module trusts, the catalogue it is checked against, and the shop that filters it.
 */

describe('the catalogue', () => {
  it('is valid', () => {
    expect(validateCatalogue()).toEqual([]);
  });

  it('covers every category of the plan, in six groups', () => {
    expect(GROUPS.map((g) => g.id)).toEqual(['body', 'wheels', 'paint', 'lights', 'exhaust', 'plate']);
    for (const id of [
      'frontBumper', 'rearBumper', 'skirts', 'hood', 'trunk', 'spoiler', 'exhaustTips', 'rims', 'rimColor', 'wheelSize',
      'wheelWidth', 'rideHeight', 'camberFront', 'camberRear', 'trackFront', 'trackRear', 'paint', 'roofColor', 'finish',
      'vinyls', 'decals', 'headlights', 'headlightColor', 'taillights', 'neon', 'interiorLight', 'exhaustSound', 'plate',
    ]) {
      expect(CATEGORY_IDS).toContain(id);
    }
    expect(PALETTE.length).toBeGreaterThanOrEqual(30);
  });

  it('carries every part the stock car wears, all free', () => {
    expect(stockPartsMissing()).toEqual([]);
    for (const id of loadoutPartIds(STOCK_LOADOUT)) expect(findPart(id)?.price, id).toBe(0);
    expect(loadoutRating(STOCK_LOADOUT)).toBeGreaterThan(0);
  });

  it('has a step range, containing 0, for every step category', () => {
    for (const c of CATEGORIES.filter((c) => c.kind === 'step')) {
      const range = STEP_RANGES[c.id as keyof typeof STEP_RANGES];
      expect(range, c.id).toBeTruthy();
      expect(range.min).toBeLessThanOrEqual(0);
      expect(range.max).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('the shop', () => {
  it("Loco Mustang's sells everything at catalogue price", () => {
    expect(SHOPS).toContain(LOCO_MUSTANG_SHOP);
    expect(validateShop(LOCO_MUSTANG_SHOP)).toEqual([]);
    expect([...LOCO_MUSTANG_SHOP.categories].sort()).toEqual([...CATEGORY_IDS].sort());
    expect(shopPrice(LOCO_MUSTANG_SHOP, 1234)).toBe(1234);
  });

  it('refuses a malformed shop', () => {
    const bad = { ...LOCO_MUSTANG_SHOP, id: 'Bad Id', categories: ['hood', 'hood', 'nope'] as never[], priceFactor: 0 };
    expect(validateShop(bad).length).toBeGreaterThanOrEqual(4);
  });
});

describe('sanitizeLoadout', () => {
  it('is the identity on the stock car, and never shares objects with it', () => {
    const s = sanitizeLoadout(STOCK_LOADOUT);
    expect(s).toEqual(STOCK_LOADOUT);
    expect(s).not.toBe(STOCK_LOADOUT);
    expect(s.body).not.toBe(STOCK_LOADOUT.body);
    expect(s.vinyls).not.toBe(STOCK_LOADOUT.vinyls);
    expect(s.vinyls[0]).not.toBe(STOCK_LOADOUT.vinyls[0]);
  });

  it('turns any garbage into the stock car and never throws', () => {
    for (const junk of [undefined, null, 0, 42, 'x', [], [1, 2], true, () => 1, { v: 7 }, { body: 'no', wheels: [] }, Symbol('s')]) {
      expect(sanitizeLoadout(junk)).toEqual(STOCK_LOADOUT);
    }
  });

  it('sends an unknown or wrong-category part back to stock, field by field', () => {
    const l = sanitizeLoadout({
      ...STOCK_LOADOUT,
      body: { ...STOCK_LOADOUT.body, hood: 'hood.does-not-exist', spoiler: 'hood.stock', trunk: 42 },
      wheels: { ...STOCK_LOADOUT.wheels, rim: 'spoiler.stock' },
      exhaustSound: '__proto__',
      plate: { text: 'AB123CD', style: 'rims.stock' },
    });
    expect(l.body.hood).toBe('hood.stock');
    expect(l.body.spoiler).toBe('spoiler.stock');
    expect(l.body.trunk).toBe('trunk.stock');
    expect(l.wheels.rim).toBe('rims.stock');
    expect(l.exhaustSound).toBe('exhaustSound.stock');
    expect(l.plate).toEqual({ text: 'AB123CD', style: 'plate.stock' });
  });

  it('clamps and rounds every step, and zeroes anything that is not a number', () => {
    const l = sanitizeLoadout({
      ...STOCK_LOADOUT,
      wheels: { ...STOCK_LOADOUT.wheels, size: 99, width: -5 },
      stance: { rideHeight: -1e9, camberFront: 2.6, camberRear: NaN, trackFront: '3', trackRear: Infinity },
    });
    expect(l.wheels.size).toBe(STEP_RANGES.wheelSize.max);
    expect(l.wheels.width).toBe(STEP_RANGES.wheelWidth.min);
    expect(l.stance.rideHeight).toBe(STEP_RANGES.rideHeight.min);
    expect(l.stance.camberFront).toBe(3);
    expect(l.stance.camberRear).toBe(0);
    expect(l.stance.trackFront).toBe(3);
    expect(l.stance.trackRear).toBe(0);
  });

  it('keeps colours from the palette only, with neon off and an optional roof', () => {
    const l = sanitizeLoadout({
      ...STOCK_LOADOUT,
      paint: { base: '#ff0000', finish: 'glitter', roof: 'red' },
      lights: { ...STOCK_LOADOUT.lights, headColor: 'amber', neon: 'off', interior: 'rgb(1,2,3)' },
    });
    expect(l.paint).toEqual({ base: STOCK_LOADOUT.paint.base, finish: STOCK_LOADOUT.paint.finish, roof: 'red' });
    expect(l.lights.headColor).toBe('amber');
    expect(l.lights.neon).toBe('off');
    expect(l.lights.interior).toBe(STOCK_LOADOUT.lights.interior);
    expect('roof' in sanitizeLoadout({ ...STOCK_LOADOUT, paint: { base: 'red', finish: 'matte', roof: 'nope' } }).paint).toBe(false);
  });

  it('drops unknown vinyls, caps them at four, and colours a bad one with its default', () => {
    const layers = Array.from({ length: 9 }, (_, i) => ({ id: i === 1 ? 'vinyls.gone' : 'vinyls.rayo', color: i === 2 ? 'no-colour' : 'cyan' }));
    const l = sanitizeLoadout({ ...STOCK_LOADOUT, vinyls: layers });
    expect(l.vinyls).toHaveLength(MAX_VINYLS);
    expect(l.vinyls.every((v) => v.id === 'vinyls.rayo')).toBe(true);
    expect(l.vinyls[1].color).toBe(findPart('vinyls.rayo')!.defaultColor);
    // An empty list is a car with no vinyl at all, which is a choice, not garbage.
    expect(sanitizeLoadout({ ...STOCK_LOADOUT, vinyls: [] }).vinyls).toEqual([]);
  });

  it('drops decals the catalogue does not have, or that name no zone', () => {
    const l = sanitizeLoadout({ ...STOCK_LOADOUT, decals: [{ id: 'decals.none', zone: 'hood' }, { id: 'vinyls.rayo', zone: 'roof' }, 'x'] });
    expect(l.decals).toEqual([]);
    expect(DECAL_ZONES.length).toBeGreaterThan(4);
  });

  it('cleans plate text to seven characters of [A-Z0-9 ]', () => {
    expect(sanitizePlateText('ab 123 cd')).toBe('AB 123 ');
    expect(sanitizePlateText('ñandú-77!')).toBe('NANDU77');
    expect(sanitizePlateText('ABCDEFGHIJ')).toBe('ABCDEFG');
    expect(sanitizePlateText('   ')).toBe(STOCK_LOADOUT.plate.text);
    expect(sanitizePlateText(7)).toBe(STOCK_LOADOUT.plate.text);
    expect(STOCK_LOADOUT.plate.text).toMatch(/^[A-Z0-9 ]{1,7}$/);
  });

  it('keeps the shared stock car frozen', () => {
    expect(Object.isFrozen(STOCK_LOADOUT)).toBe(true);
    expect(Object.isFrozen(STOCK_LOADOUT.body)).toBe(true);
    expect(Object.isFrozen(STOCK_LOADOUT.vinyls[0])).toBe(true);
    const copy = stockLoadout();
    copy.body.hood = 'hood.anything';
    expect(STOCK_LOADOUT.body.hood).toBe('hood.stock');
  });
});

describe('one category at a time', () => {
  const scalars = CATEGORY_IDS.filter((c) => c !== 'vinyls' && c !== 'decals') as ScalarCategoryId[];

  it('reads back, for every category, a value that is valid for it', () => {
    for (const c of scalars) expect(isValidChoice(c, getChoice(STOCK_LOADOUT, c)), c).toBe(true);
  });

  it('writes a valid choice into the right field, and ignores an invalid one', () => {
    let l: CarLoadout = stockLoadout();
    l = setChoice(l, 'rideHeight', -2);
    l = setChoice(l, 'paint', 'red');
    l = setChoice(l, 'roofColor', 'black');
    l = setChoice(l, 'neon', 'off');
    l = setChoice(l, 'finish', 'pearl');
    expect(l.stance.rideHeight).toBe(-2);
    expect(l.paint).toEqual({ base: 'red', finish: 'pearl', roof: 'black' });
    expect(l.lights.neon).toBe('off');
    expect(getChoice(setChoice(l, 'roofColor', 'none'), 'roofColor')).toBe('none');

    const same = setChoice(l, 'rideHeight', 99);
    expect(same).toEqual(l);
    expect(setChoice(l, 'hood', 'spoiler.stock')).toEqual(l);
    expect(setChoice(l, 'paint', 'off')).toEqual(l);
    // Never edits its input.
    expect(STOCK_LOADOUT.stance.rideHeight).toBe(0);
  });

  it('knows each category kind', () => {
    expect(categoryDef('neon').kind).toBe('color');
    expect(categoryDef('camberFront').kind).toBe('step');
    expect(categoryDef('vinyls').kind).toBe('layers');
    expect(categoryDef('spoiler').kind).toBe('part');
  });

  it('edits vinyls and plate text through their own setters, sanitized', () => {
    const l = setVinyls(STOCK_LOADOUT, [{ id: 'vinyls.rayo', color: 'lime' }, { id: 'vinyls.fake', color: 'red' }]);
    expect(l.vinyls).toEqual([{ id: 'vinyls.rayo', color: 'lime' }]);
    expect(setPlateText(STOCK_LOADOUT, 'rb-2026').plate.text).toBe('RB2026');
  });
});

describe('the compact code', () => {
  it('round-trips the stock car', () => {
    const code = encodeLoadout(STOCK_LOADOUT);
    expect(code.startsWith('L1|')).toBe(true);
    expect(decodeLoadout(code)).toEqual(STOCK_LOADOUT);
    expect(code.length).toBeLessThan(200);
  });

  it('round-trips a car with everything moved off stock', () => {
    const l = cloneLoadout(STOCK_LOADOUT);
    l.wheels = { rim: 'rims.stock', rimColor: 'gold', size: 2, width: 1 };
    l.stance = { rideHeight: -4, camberFront: 3, camberRear: 8, trackFront: -2, trackRear: 4 };
    l.paint = { base: 'white', finish: 'chrome', roof: 'black' };
    l.vinyls = [
      { id: 'vinyls.rayo', color: 'cyan' },
      { id: 'vinyls.rayo', color: 'yellow' },
    ];
    l.lights = { head: 'headlights.stock', headColor: 'halogen', tail: 'taillights.stock', neon: 'off', interior: 'red' };
    l.plate = { text: 'AB 12 C', style: 'plate.stock' };
    const back = decodeLoadout(encodeLoadout(l));
    expect(back).toEqual(sanitizeLoadout(l));
    expect(loadoutsEqual(back, l)).toBe(true);
    expect(loadoutsEqual(back, STOCK_LOADOUT)).toBe(false);
  });

  it('decodes garbage, truncated codes and foreign versions to a valid car without throwing', () => {
    const code = encodeLoadout(STOCK_LOADOUT);
    for (const junk of [undefined, null, 5, '', 'L2|x', code.slice(0, 20), `${code}|extra`, 'L1'.padEnd(5000, '|'), '||||']) {
      expect(decodeLoadout(junk)).toEqual(STOCK_LOADOUT);
    }
    // Well-formed but full of unknowns: every field falls back on its own.
    const odd = code.replace('|stock|', '|ghost|').replace('|midnight|', '|plaid|');
    expect(decodeLoadout(odd)).toEqual(STOCK_LOADOUT);
  });

  it('only ever writes ids that cannot collide with its separators', () => {
    for (const p of PARTS) expect(p.id).toMatch(/^[a-zA-Z]+\.[a-z0-9-]+$/);
    for (const c of PALETTE) expect(c.id).toMatch(/^[a-z0-9-]+$/);
  });
});
