import { describe, expect, it, vi } from 'vitest';
import type { EconomyState, GameEvent, PoliceState, RaceState, RushState, WorkshopState } from '../src/core/types';

/*
 * The catalogue has only stock parts until the Ola 1 agents land theirs, so the rules are tested
 * against a few parts of their own, added to the domain files here. Their ratings are chosen to
 * land on known points of the price curve.
 */
vi.mock('../src/content/parts/body', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/content/parts/body')>();
  return {
    BODY_PARTS: [
      ...mod.BODY_PARTS,
      { id: 'hood.test-vent', category: 'hood', name: 'Test vent', price: 1, rating: 5 },
      { id: 'spoiler.test-top', category: 'spoiler', name: 'Test top', price: 1, rating: 10 },
    ],
  };
});
vi.mock('../src/content/parts/paint', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/content/parts/paint')>();
  return {
    PAINT_PARTS: [
      ...mod.PAINT_PARTS,
      { id: 'vinyls.test-flames', category: 'vinyls', name: 'Test flames', price: 1, rating: 6, defaultColor: 'orange' },
      { id: 'decals.test-sticker', category: 'decals', name: 'Test sticker', price: 1, rating: 3 },
    ],
  };
});

const { LOCO_MUSTANG_SHOP, shopPrice, validateShop, shopCategoriesOf } = await import('../src/content/shops');
const { CATEGORIES, CATEGORY_TOP_PRICE, FINISH_PRICES, PARTS, PLATE_TEXT_PRICE, findPart, isStockPart, partPrice, validateCatalogue } = await import('../src/content/carParts');
const { STOCK_LOADOUT, getChoice, loadoutPartIds, stockLoadout, encodeLoadout } = await import('../src/core/loadout');
const W = await import('../src/sim/workshop');
const { createInitialGameState } = await import('../src/sim/gameState');

const shop = LOCO_MUSTANG_SHOP;
const wallet = (money: number): EconomyState => ({ money, destroyed: 0, lastReward: 0 });

/** A workshop already inside, past the entering fade. */
function inside(saved?: Parameters<typeof W.createWorkshopState>[0]): { ws: WorkshopState; events: GameEvent[] } {
  const ws = W.createWorkshopState(saved);
  const events: GameEvent[] = [];
  expect(W.openWorkshop(ws, shop, events)).toBe(true);
  W.stepWorkshop(ws, W.WORKSHOP_TIMING.enterSeconds, events);
  expect(ws.phase).toBe('browsing');
  events.length = 0;
  return { ws, events };
}

const run = (ws: WorkshopState, cmd: import('../src/sim/workshop').WorkshopCommand, money: EconomyState, events: GameEvent[]) =>
  W.applyWorkshopCommand(ws, cmd, shop, money, events);

describe('pricing (D4)', () => {
  it('keeps the catalogue and the shop valid', () => {
    expect(validateCatalogue()).toEqual([]);
    expect(validateShop(shop)).toEqual([]);
  });

  it('prices every part by its category and rating, and never charges for the stock car', () => {
    for (const p of PARTS) {
      if (isStockPart(p.id)) expect(p.price, p.id).toBe(0);
      else expect(p.price, p.id).toBe(partPrice(p.category, p.rating));
    }
    for (const id of loadoutPartIds(STOCK_LOADOUT)) {
      expect(isStockPart(id), id).toBe(true);
      expect(findPart(id)?.price, id).toBe(0);
    }
    // A domain file's provisional price never survives.
    expect(findPart('hood.test-vent')!.price).not.toBe(1);
  });

  it('puts a mid part at 10–15 minutes of play and a top one near an hour (≈ 200 ¥/min)', () => {
    const perMinute = 200;
    for (const c of ['frontBumper', 'hood', 'spoiler', 'rims'] as const) {
      const mid = partPrice(c, 5) / perMinute;
      expect(mid, c).toBeGreaterThanOrEqual(10);
      expect(mid, c).toBeLessThanOrEqual(15);
    }
    for (const c of ['spoiler', 'rims'] as const) {
      const top = partPrice(c, 10) / perMinute;
      expect(top, c).toBeGreaterThanOrEqual(50);
      expect(top, c).toBeLessThanOrEqual(70);
    }
    // Rising with rating, in every category that takes parts.
    for (const c of Object.keys(CATEGORY_TOP_PRICE) as Array<keyof typeof CATEGORY_TOP_PRICE>) {
      for (let r = 1; r <= 10; r++) expect(partPrice(c, r), `${c} ${r}`).toBeGreaterThan(partPrice(c, r - 1));
    }
    // A rating out of range is clamped, not a NaN.
    expect(partPrice('hood', 99)).toBe(partPrice('hood', 10));
    expect(partPrice('hood', Number.NaN)).toBe(partPrice('hood', 0));
  });

  it('keeps colours, stance and finishes cheap — chrome the one showpiece', () => {
    for (const c of CATEGORIES) {
      if (c.kind === 'color' || c.kind === 'step' || c.kind === 'finish') {
        expect(c.price, c.id).toBeGreaterThan(0);
        expect(c.price, c.id).toBeLessThanOrEqual(1000);
      }
    }
    expect(FINISH_PRICES.chrome).toBeGreaterThan(FINISH_PRICES.pearl);
    expect(FINISH_PRICES.gloss).toBeLessThan(FINISH_PRICES.metallic);
    expect(PLATE_TEXT_PRICE).toBeLessThanOrEqual(500);
  });

  it('applies the shop factor', () => {
    const pricey = { ...shop, id: 'pricey', priceFactor: 1.5 };
    const { ws } = inside();
    expect(W.optionPrice(ws, pricey, 'hood', 'hood.test-vent')).toBe(shopPrice(pricey, findPart('hood.test-vent')!.price));
  });
});

describe('the workshop visit', () => {
  it('goes closed → entering → browsing → previewing → leaving → closed, with its events', () => {
    const ws = W.createWorkshopState();
    const events: GameEvent[] = [];
    expect(ws.phase).toBe('closed');
    expect(W.openWorkshop(ws, shop, events)).toBe(true);
    expect(ws.phase).toBe('entering');
    expect(events).toEqual([{ type: 'workshopEnter', shopId: shop.id }]);
    // Commands wait for the fade.
    expect(run(ws, { type: 'select' }, wallet(0), events)).toBe(false);
    expect(W.workshopShowroomVisible(ws)).toBe(false);
    W.stepWorkshop(ws, W.WORKSHOP_TIMING.enterSeconds / 2, events);
    expect(W.workshopFade(ws)).toBeCloseTo(1);
    expect(W.workshopShowroomVisible(ws)).toBe(true);
    W.stepWorkshop(ws, W.WORKSHOP_TIMING.enterSeconds / 2, events);
    expect(ws.phase).toBe('browsing');
    expect(W.workshopFade(ws)).toBe(0);

    expect(run(ws, { type: 'select' }, wallet(0), events)).toBe(true);
    expect(ws.phase).toBe('previewing');
    expect(run(ws, { type: 'back' }, wallet(0), events)).toBe(true);
    expect(ws.phase).toBe('browsing');
    events.length = 0;
    expect(run(ws, { type: 'back' }, wallet(0), events)).toBe(true);
    expect(ws.phase).toBe('leaving');
    expect(events).toEqual([]);
    W.stepWorkshop(ws, W.WORKSHOP_TIMING.leaveSeconds, events);
    expect(ws.phase).toBe('closed');
    expect(events).toEqual([{ type: 'workshopExit', shopId: shop.id, purchases: 0 }]);
    expect(ws.shopId).toBe('');
  });

  it('tries things on for free, and leaving throws the try-on away', () => {
    const { ws, events } = inside();
    const money = wallet(100);
    expect(run(ws, { type: 'color', category: 'paint', value: 'red' }, money, events)).toBe(true);
    expect(ws.phase).toBe('previewing');
    expect(ws.preview.paint.base).toBe('red');
    expect(ws.installed.paint.base).toBe('midnight');
    expect(events).toEqual([{ type: 'workshopPreview', category: 'paint', value: 'red' }]);
    expect(money.money).toBe(100);
    events.length = 0;
    run(ws, { type: 'exit' }, money, events);
    expect(ws.phase).toBe('leaving');
    expect(ws.preview.paint.base).toBe('midnight');
    // The renderer is told the car on the platform changed back.
    expect(events).toEqual([{ type: 'workshopPreview', category: 'paint', value: 'midnight' }]);
    expect(money.money).toBe(100);
  });

  it('charges INSTALL through the wallet, once per part, and reinstalls owned parts for free', () => {
    const { ws, events } = inside();
    const price = findPart('hood.test-vent')!.price;
    const money = wallet(price + 50);
    run(ws, { type: 'category', category: 'hood', open: true }, money, events);
    const idx = W.workshopOptions('hood').indexOf('hood.test-vent');
    run(ws, { type: 'option', index: idx }, money, events);
    expect(ws.preview.body.hood).toBe('hood.test-vent');
    expect(W.installQuote(ws, shop)).toBe(price);
    events.length = 0;
    expect(run(ws, { type: 'install' }, money, events)).toBe(true);
    expect(money.money).toBe(50);
    expect(ws.installed.body.hood).toBe('hood.test-vent');
    expect(ws.owned).toContain('hood.test-vent');
    expect(events).toEqual([{ type: 'workshopPurchase', shopId: shop.id, category: 'hood', value: 'hood.test-vent', price, balance: 50 }]);
    expect(ws.purchases).toBe(1);
    expect(ws.purchaseId).toBe(1);

    // Back to stock: free. And the owned part again: free.
    run(ws, { type: 'option', index: 0 }, money, events);
    expect(W.installQuote(ws, shop)).toBe(0);
    run(ws, { type: 'install' }, money, events);
    run(ws, { type: 'option', index: idx }, money, events);
    expect(W.installQuote(ws, shop)).toBe(0);
    events.length = 0;
    run(ws, { type: 'install' }, money, events);
    expect(money.money).toBe(50);
    expect(events[0]).toMatchObject({ type: 'workshopPurchase', price: 0 });
    expect(ws.purchases).toBe(1);
    expect(ws.purchaseId).toBe(3);
  });

  it('refuses INSTALL it cannot be paid for, and takes nothing', () => {
    const { ws, events } = inside();
    const money = wallet(10);
    run(ws, { type: 'category', category: 'spoiler', open: true }, money, events);
    run(ws, { type: 'option', index: W.workshopOptions('spoiler').indexOf('spoiler.test-top') }, money, events);
    events.length = 0;
    expect(run(ws, { type: 'install' }, money, events)).toBe(false);
    expect(events).toEqual([{ type: 'workshopDenied', reason: 'funds', category: 'spoiler' }]);
    expect(ws.lastDenied).toBe('funds');
    expect(ws.deniedId).toBe(1);
    expect(money.money).toBe(10);
    expect(ws.installed.body.spoiler).toBe('spoiler.stock');
    expect(ws.owned).not.toContain('spoiler.test-top');
    // The try-on is still on: the player can look at what they cannot afford.
    expect(ws.preview.body.spoiler).toBe('spoiler.test-top');
  });

  it('charges a colour, a step and a finish every time, but never a return to stock', () => {
    const { ws, events } = inside();
    const money = wallet(10_000);
    run(ws, { type: 'color', category: 'paint', value: 'red' }, money, events);
    run(ws, { type: 'install' }, money, events);
    expect(money.money).toBe(10_000 - shopPrice(shop, CATEGORIES.find((c) => c.id === 'paint')!.price));
    const afterPaint = money.money;
    run(ws, { type: 'finish', value: 'chrome' }, money, events);
    expect(W.installQuote(ws, shop)).toBe(FINISH_PRICES.chrome);
    run(ws, { type: 'install' }, money, events);
    expect(money.money).toBe(afterPaint - FINISH_PRICES.chrome);
    run(ws, { type: 'step', category: 'rideHeight', delta: -3 }, money, events);
    expect(ws.preview.stance.rideHeight).toBe(-3);
    run(ws, { type: 'step', delta: -9 }, money, events);
    expect(ws.preview.stance.rideHeight).toBe(-4);
    // Back to the factory colour: free.
    run(ws, { type: 'color', category: 'paint', value: 'midnight' }, money, events);
    expect(W.installQuote(ws, shop)).toBe(0);
  });

  it('opens a category from the carousel on an option, wraps the rail, and denies stale input', () => {
    const { ws, events } = inside();
    const money = wallet(0);
    const n = W.workshopOptions(ws.category).length;
    run(ws, { type: 'option', delta: -1 }, money, events);
    expect(ws.phase).toBe('previewing');
    expect(ws.optionIndex).toBe(n - 1);
    events.length = 0;
    expect(run(ws, { type: 'option', index: 999 }, money, events)).toBe(false);
    expect(events).toEqual([{ type: 'workshopDenied', reason: 'invalid', category: ws.category }]);
    expect(run(ws, { type: 'color', category: 'hood', value: 'red' }, money, events)).toBe(false);
    expect(run(ws, { type: 'color', category: 'nope' as never, value: 'red' }, money, events)).toBe(false);
    expect(run(ws, { type: 'color', category: 'paint', value: '#ff0000' }, money, events)).toBe(false);
    expect(run(ws, { type: 'finish', value: 'velvet' as never }, money, events)).toBe(false);
  });

  it('moves through groups and categories, discarding what was not installed', () => {
    const { ws, events } = inside();
    const money = wallet(0);
    run(ws, { type: 'color', category: 'neon', value: 'off' }, money, events);
    expect(ws.group).toBe('lights');
    expect(ws.preview.lights.neon).toBe('off');
    run(ws, { type: 'group', delta: 1 }, money, events);
    expect(ws.group).toBe('exhaust');
    expect(ws.phase).toBe('browsing');
    expect(ws.preview.lights.neon).toBe('rayo');
    run(ws, { type: 'group', delta: 1 }, money, events);
    run(ws, { type: 'group', delta: 1 }, money, events);
    expect(ws.group).toBe('body');
    run(ws, { type: 'category', delta: -1 }, money, events);
    expect(ws.category).toBe(shopCategoriesOf(shop, 'body').at(-1));
    expect(ws.phase).toBe('browsing');
  });

  it('adds vinyls and decals as layers, charges only unowned parts, and recolours owned ones for free', () => {
    const { ws, events } = inside();
    const flames = findPart('vinyls.test-flames')!.price;
    const sticker = findPart('decals.test-sticker')!.price;
    const money = wallet(flames + sticker);
    run(ws, { type: 'category', category: 'vinyls', open: true }, money, events);
    run(ws, { type: 'option', index: W.workshopOptions('vinyls').indexOf('vinyls.test-flames') }, money, events);
    expect(ws.preview.vinyls).toEqual([{ id: 'vinyls.rayo', color: 'magenta' }, { id: 'vinyls.test-flames', color: 'orange' }]);
    expect(W.installQuote(ws, shop)).toBe(flames);
    run(ws, { type: 'install' }, money, events);
    run(ws, { type: 'layer', category: 'vinyls', layers: [{ id: 'vinyls.test-flames', color: 'cyan' }] }, money, events);
    expect(W.installQuote(ws, shop)).toBe(0);
    run(ws, { type: 'install' }, money, events);
    expect(ws.installed.vinyls).toEqual([{ id: 'vinyls.test-flames', color: 'cyan' }]);
    run(ws, { type: 'layer', category: 'decals', layers: [{ id: 'decals.test-sticker', zone: 'hood' }, { id: 'decals.test-sticker', zone: 'roof' }] }, money, events);
    expect(ws.category).toBe('decals');
    // The same decal twice is still one part to buy.
    expect(W.installQuote(ws, shop)).toBe(sticker);
    run(ws, { type: 'install' }, money, events);
    expect(money.money).toBe(0);
  });

  it('stamps plate text, sanitized, for a small fee', () => {
    const { ws, events } = inside();
    const money = wallet(1000);
    run(ws, { type: 'plateText', text: 'ñandú 99!' }, money, events);
    expect(ws.category).toBe('plate');
    expect(ws.preview.plate.text).toBe('NANDU 9');
    expect(events.at(-1)).toEqual({ type: 'workshopPreview', category: 'plate', value: 'NANDU 9' });
    expect(W.installQuote(ws, shop)).toBe(PLATE_TEXT_PRICE);
    events.length = 0;
    run(ws, { type: 'install' }, money, events);
    expect(events).toEqual([{ type: 'workshopPurchase', shopId: shop.id, category: 'plate', value: 'NANDU 9', price: PLATE_TEXT_PRICE, balance: 1000 - PLATE_TEXT_PRICE }]);
  });

  it('starts from a save, sanitized, owning what the saved car wears', () => {
    const loadout = { ...stockLoadout(), body: { ...stockLoadout().body, hood: 'hood.test-vent', spoiler: 'spoiler.nope' } };
    const ws = W.createWorkshopState({ loadout, owned: ['decals.test-sticker', 'hood.stock', 'bad id', 7 as never] });
    expect(ws.installed.body.hood).toBe('hood.test-vent');
    expect(ws.installed.body.spoiler).toBe('spoiler.stock');
    expect(ws.owned.sort()).toEqual(['decals.test-sticker', 'hood.test-vent']);
    expect(encodeLoadout(ws.preview)).toBe(encodeLoadout(ws.installed));
    expect(W.workshopSave(ws).owned).toEqual(ws.owned);
  });
});

describe('the door', () => {
  const police = (phase: PoliceState['phase']): PoliceState => ({ phase }) as PoliceState;
  it('opens in Free Roam with nothing on the car, and not otherwise', () => {
    expect(W.canEnterWorkshop({})).toBeNull();
    expect(W.canEnterWorkshop({ police: police('calm') })).toBeNull();
    expect(W.canEnterWorkshop({ police: police('cooldown') })).toBeNull();
    for (const phase of ['alert', 'pursuit', 'escaping', 'busted'] as const) expect(W.canEnterWorkshop({ police: police(phase) }), phase).toBe('police');
    expect(W.canEnterWorkshop({ race: {} as RaceState })).toBe('race');
    expect(W.canEnterWorkshop({ rush: { phase: 'running' } as unknown as RushState })).toBe('locked');
    const open = W.createWorkshopState();
    open.phase = 'browsing';
    expect(W.canEnterWorkshop({ workshop: open })).toBe('locked');
  });

  it('takes a real open-world GameState as it is', async () => {
    const { createOpenWorld } = await import('../src/world/openWorld');
    const { layout } = createOpenWorld();
    const state = createInitialGameState(layout, 'auto', { police: true });
    expect(W.canEnterWorkshop(state)).toBeNull();
  });

  it('stays shut with a reason, and changes nothing', () => {
    const ws = W.createWorkshopState();
    const events: GameEvent[] = [];
    expect(W.openWorkshop(ws, shop, events, 'police')).toBe(false);
    expect(ws.phase).toBe('closed');
    expect(events).toEqual([{ type: 'workshopDenied', reason: 'police', category: null }]);
  });
});

describe('stars and the HUD', () => {
  it('reads the stock car at 1–2 stars and a built one far higher, 0..10', () => {
    const stock = W.carStars(STOCK_LOADOUT);
    expect(stock).toBeGreaterThanOrEqual(1);
    expect(stock).toBeLessThanOrEqual(2);
    const built = { ...stockLoadout(), body: { ...stockLoadout().body, hood: 'hood.test-vent', spoiler: 'spoiler.test-top' } };
    built.paint = { base: 'red', finish: 'chrome' };
    expect(W.carStars(built)).toBeGreaterThan(stock);
    expect(W.carStars(built)).toBeLessThanOrEqual(10);
  });

  it('fills the snapshot from the state without rebuilding it', () => {
    const { ws, events } = inside();
    const money = wallet(5000);
    const snap = W.createWorkshopHudSnapshot();
    run(ws, { type: 'category', category: 'paint', open: true }, money, events);
    W.workshopHudSnapshot(ws, money, shop, snap);
    expect(snap.open).toBe(true);
    expect(snap.inCategory).toBe(true);
    expect(snap.shopName).toBe(shop.name);
    expect(snap.categories).toEqual(shopCategoriesOf(shop, 'paint'));
    expect(snap.options).toHaveLength(W.workshopOptions('paint').length);
    const installedRow = snap.options.find((o) => o.installed)!;
    expect(installedRow.value).toBe('midnight');
    expect(installedRow.price).toBe(0);
    expect(installedRow.swatch).toMatch(/^#[0-9a-f]{6}$/);
    expect(snap.canInstall).toBe(false);
    const rows = snap.options;
    const firstRow = rows[0];

    run(ws, { type: 'color', value: 'red' }, money, events);
    W.workshopHudSnapshot(ws, money, shop, snap);
    expect(snap.options).toBe(rows);
    expect(snap.options[0]).toBe(firstRow);
    expect(snap.installPrice).toBe(shopPrice(shop, 800));
    expect(snap.canInstall).toBe(true);
    expect(snap.options.find((o) => o.value === 'red')!.label).toBe('Rojo');

    W.workshopHudSnapshot(ws, wallet(10), shop, snap);
    expect(snap.canInstall).toBe(false);

    run(ws, { type: 'category', category: 'rideHeight' }, money, events);
    W.workshopHudSnapshot(ws, money, shop, snap);
    expect(snap.options.map((o) => o.label)).toContain('0 · de fábrica');
    expect(snap.options).toHaveLength(7);
    expect(getChoice(ws.preview, 'paint')).toBe('midnight');
  });
});
