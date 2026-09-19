import { CATEGORY_IDS, isCategoryId, type CategoryId } from './carParts';

/**
 * THE WORKSHOPS: who runs each one, which catalogue categories it sells, and at what markup
 * (`docs/GARAGE_PLAN.md` §2.2).
 *
 * The catalogue (`carParts.ts`) never knows about a shop; a shop only FILTERS it. Today there
 * is one — Loco Mustang's, which sells everything — but the rules (`src/sim/workshop.ts`), the
 * UI and the showroom all take a `ShopDef` rather than assume his, so a second workshop (a
 * mechanic, a paint booth) is a new entry here and a new site in the world, and nothing else.
 */
export interface ShopDef {
  /** Stable id, stored nowhere yet but reported in events (`workshopEnter`). `[a-z0-9-]`. */
  id: string;
  /** Who runs it: a `GarageDef.id` from `src/content/garage.ts` (lines, portrait). */
  npc: string;
  /** Shown in the UI's title bar, in Spanish. */
  name: string;
  /** What it sells, in the order its carousel shows them. A subset of `CATEGORY_IDS`. */
  categories: readonly CategoryId[];
  /** Multiplies every base price in this shop. 1 = catalogue price. */
  priceFactor: number;
}

export const LOCO_MUSTANG_SHOP: ShopDef = {
  id: 'loco-mustang',
  npc: 'loco-mustang',
  name: 'Taller del Loco Mustang',
  categories: CATEGORY_IDS,
  priceFactor: 1,
};

export const SHOPS: readonly ShopDef[] = [LOCO_MUSTANG_SHOP];

export function findShop(id: unknown): ShopDef | undefined {
  return SHOPS.find((s) => s.id === id);
}

/** What `basePrice` costs in `shop`: the factor applied, rounded to a whole number, never negative. */
export function shopPrice(shop: ShopDef, basePrice: number): number {
  return Math.max(0, Math.round(basePrice * shop.priceFactor));
}

/** Whether `shop` sells anything in `category`. */
export function shopSells(shop: ShopDef, category: CategoryId): boolean {
  return shop.categories.includes(category);
}

/** Everything that must hold for a shop to be usable, as a list of complaints. Empty means fine. */
export function validateShop(shop: ShopDef): string[] {
  const problems: string[] = [];
  const check = (ok: boolean, message: string): void => {
    if (!ok) problems.push(message);
  };
  check(/^[a-z0-9-]+$/.test(shop.id), `shop ${shop.id}: id must be [a-z0-9-]`);
  check(shop.npc.trim().length > 0 && shop.name.trim().length > 0, `shop ${shop.id}: missing npc or name`);
  check(shop.categories.length > 0, `shop ${shop.id}: sells nothing`);
  check(new Set(shop.categories).size === shop.categories.length, `shop ${shop.id}: a category is listed twice`);
  for (const c of shop.categories) check(isCategoryId(c), `shop ${shop.id}: unknown category ${c}`);
  check(Number.isFinite(shop.priceFactor) && shop.priceFactor > 0 && shop.priceFactor <= 5, `shop ${shop.id}: priceFactor out of (0, 5]`);
  return problems;
}
