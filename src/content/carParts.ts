import type { ColorId, PaintFinish, PartId } from '../core/loadout';
import { BODY_PARTS } from './parts/body';
import { WHEEL_PARTS } from './parts/wheels';
import { PAINT_PARTS } from './parts/paint';
import { LIGHT_PARTS } from './parts/lights';
import { EXHAUST_SOUND_PARTS } from './parts/exhaustSound';
import { PLATE_PARTS } from './parts/plate';
import { CAMERA_SHOTS, type CameraShotKey } from './workshopShots';

export { CAMERA_SHOTS, type CameraShot, type CameraShotKey } from './workshopShots';

/**
 * THE WORKSHOP CATALOGUE: every category Loco Mustang's workshop can sell, how the menu groups
 * them, what each costs, and the colours the paint and light categories pick from.
 *
 * DATA, NOT LOGIC, like the rest of `src/content/`. What a part LOOKS like is the renderer's
 * business (`src/render/scene/vehicles/parts/`, `wheelRig.ts`, `lights.ts`, `paintShop.ts`),
 * what it COSTS and whether the player owns it is the rules' (`src/sim/workshop.ts`), and which
 * workshop sells it is the shop's (`src/content/shops.ts`). This file is only the list, and it
 * never knows about a shop: a second workshop filters categories, it does not get its own parts.
 *
 * HOW THE CATALOGUE IS ASSEMBLED. The parts themselves live in one file per domain under
 * `src/content/parts/`, so that the agents who build a domain's geometry can add its entries
 * without all of them editing this one file at once (`docs/GARAGE_PLAN.md`, "Contratos de la
 * Ola 0"). This file concatenates them into `PARTS` and then lays `PRICING` over the top: the
 * domain files carry a provisional price and rating, the economy's calibration lives here.
 *
 * IDS. A part id is `<category>.<name>`, `name` in `[a-z0-9-]` — `frontBumper.stock`,
 * `rims.mesh-8`. Globally unique, so `owned: PartId[]` never collides across categories, and
 * the compact loadout code (`encodeLoadout`) can drop the category prefix it already knows.
 * Every single-choice category has exactly one `<category>.stock`, which IS today's car.
 *
 * NOTHING HERE TOUCHES PHYSICS. A cosmetic never changes `VEHICLE` (`AGENTS.md`): the wheel's
 * outer radius is fixed, "wheel size" trades rim for tyre sidewall and nothing else.
 */

/* ------------------------------------------------------------------ categories */

/**
 * Every category the workshop knows, in no particular order (the menu's order is
 * `CATEGORIES`). Each maps to exactly one field of `CarLoadout` — see `CategoryDef.kind` and
 * `getChoice`/`setChoice` in `src/core/loadout.ts`.
 */
export type CategoryId =
  // Carrocería
  | 'frontBumper'
  | 'rearBumper'
  | 'skirts'
  | 'hood'
  | 'trunk'
  | 'spoiler'
  // Llantas y stance
  | 'rims'
  | 'rimColor'
  | 'wheelSize'
  | 'wheelWidth'
  | 'rideHeight'
  | 'camberFront'
  | 'camberRear'
  | 'trackFront'
  | 'trackRear'
  // Pintura
  | 'paint'
  | 'roofColor'
  | 'finish'
  | 'vinyls'
  | 'decals'
  // Luces
  | 'headlights'
  | 'headlightColor'
  | 'taillights'
  | 'neon'
  | 'interiorLight'
  // Escape
  | 'exhaustTips'
  | 'exhaustSound'
  // Patente
  | 'plate';

/** The top level of the two-level NFSU2 menu. */
export type WorkshopGroupId = 'body' | 'wheels' | 'paint' | 'lights' | 'exhaust' | 'plate';

/**
 * What a category's options are, which decides both how the UI lists them and which
 * `CarLoadout` field a choice writes:
 *
 * - `part`   — pick one `PartDef` of this category (`PARTS`). One of them is `<category>.stock`.
 * - `color`  — pick one `PALETTE` entry. `neon` also takes `'off'`; `roofColor` takes `'none'`
 *              (the roof wears the body colour).
 * - `step`   — a bounded integer (`STEP_RANGES` in `src/core/loadout.ts`), 0 being today's car.
 * - `finish` — one of `PAINT_FINISHES`.
 * - `layers` — an ordered list of `PartDef`s of this category (vinyls: up to 4 with a colour
 *              each; decals: one per `DecalZone`). The UI edits the list; see `setVinyls` /
 *              `setDecals`.
 */
export type CategoryKind = 'part' | 'color' | 'step' | 'finish' | 'layers';

export interface CategoryDef {
  id: CategoryId;
  group: WorkshopGroupId;
  kind: CategoryKind;
  /** Shown in the UI, in Spanish, as the player reads it: "Paragolpes delantero". */
  label: string;
  /** Key of the SVG the carousel draws (`src/ui/workshop/`). By convention the category id. */
  icon: string;
  /** Where the showroom camera goes while this category is open (`CAMERA_SHOTS`). */
  cameraShot: CameraShotKey;
  /**
   * What one change costs in a category whose options are not parts (`color`, `step`,
   * `finish`): a respray, a set of coilovers. 0 for `part` and `layers` categories, whose
   * options carry their own price. Calibrated by the economy (agent F), like `PRICING`.
   */
  price: number;
  /** The showroom dims its own lights while this category is open, so the neon reads. */
  dimShowroom?: boolean;
}

export interface WorkshopGroupDef {
  id: WorkshopGroupId;
  /** Shown in the UI, in Spanish. */
  label: string;
  icon: string;
}

export const GROUPS: readonly WorkshopGroupDef[] = [
  { id: 'body', label: 'Carrocería', icon: 'body' },
  { id: 'wheels', label: 'Llantas y stance', icon: 'wheels' },
  { id: 'paint', label: 'Pintura', icon: 'paint' },
  { id: 'lights', label: 'Luces', icon: 'lights' },
  { id: 'exhaust', label: 'Escape', icon: 'exhaust' },
  { id: 'plate', label: 'Patente', icon: 'plate' },
];

/** Every category, in the order the carousel shows them inside their group. */
export const CATEGORIES: readonly CategoryDef[] = [
  { id: 'frontBumper', group: 'body', kind: 'part', label: 'Paragolpes delantero', icon: 'frontBumper', cameraShot: 'front34Low', price: 0 },
  { id: 'rearBumper', group: 'body', kind: 'part', label: 'Paragolpes trasero', icon: 'rearBumper', cameraShot: 'rear34Low', price: 0 },
  { id: 'skirts', group: 'body', kind: 'part', label: 'Polleras', icon: 'skirts', cameraShot: 'sideLow', price: 0 },
  { id: 'hood', group: 'body', kind: 'part', label: 'Capot', icon: 'hood', cameraShot: 'hoodHigh', price: 0 },
  { id: 'trunk', group: 'body', kind: 'part', label: 'Baúl', icon: 'trunk', cameraShot: 'rear34High', price: 0 },
  { id: 'spoiler', group: 'body', kind: 'part', label: 'Alerón', icon: 'spoiler', cameraShot: 'rear34High', price: 0 },

  { id: 'rims', group: 'wheels', kind: 'part', label: 'Llantas', icon: 'rims', cameraShot: 'wheelFront', price: 0 },
  { id: 'rimColor', group: 'wheels', kind: 'color', label: 'Color de llanta', icon: 'rimColor', cameraShot: 'wheelFront', price: 300 },
  { id: 'wheelSize', group: 'wheels', kind: 'step', label: 'Rodado', icon: 'wheelSize', cameraShot: 'wheelFront', price: 700 },
  { id: 'wheelWidth', group: 'wheels', kind: 'step', label: 'Ancho de llanta', icon: 'wheelWidth', cameraShot: 'wheelFront', price: 700 },
  { id: 'rideHeight', group: 'wheels', kind: 'step', label: 'Altura', icon: 'rideHeight', cameraShot: 'sideLow', price: 600 },
  { id: 'camberFront', group: 'wheels', kind: 'step', label: 'Camber delantero', icon: 'camberFront', cameraShot: 'wheelFrontHead', price: 300 },
  { id: 'camberRear', group: 'wheels', kind: 'step', label: 'Camber trasero', icon: 'camberRear', cameraShot: 'wheelRearTail', price: 300 },
  { id: 'trackFront', group: 'wheels', kind: 'step', label: 'Trocha delantera', icon: 'trackFront', cameraShot: 'wheelFrontHead', price: 350 },
  { id: 'trackRear', group: 'wheels', kind: 'step', label: 'Trocha trasera', icon: 'trackRear', cameraShot: 'wheelRearTail', price: 350 },

  { id: 'paint', group: 'paint', kind: 'color', label: 'Color', icon: 'paint', cameraShot: 'overview', price: 800 },
  { id: 'roofColor', group: 'paint', kind: 'color', label: 'Color de techo', icon: 'roofColor', cameraShot: 'roofHigh', price: 500 },
  // One change's price depends on the finish chosen: `FINISH_PRICES`. This is the metallic's.
  { id: 'finish', group: 'paint', kind: 'finish', label: 'Acabado', icon: 'finish', cameraShot: 'overview', price: 600 },
  { id: 'vinyls', group: 'paint', kind: 'layers', label: 'Vinilos', icon: 'vinyls', cameraShot: 'overview', price: 0 },
  { id: 'decals', group: 'paint', kind: 'layers', label: 'Calcos', icon: 'decals', cameraShot: 'overview', price: 0 },

  { id: 'headlights', group: 'lights', kind: 'part', label: 'Faros', icon: 'headlights', cameraShot: 'front34Low', price: 0 },
  { id: 'headlightColor', group: 'lights', kind: 'color', label: 'Color de faros', icon: 'headlightColor', cameraShot: 'front34Low', price: 250 },
  { id: 'taillights', group: 'lights', kind: 'part', label: 'Luces traseras', icon: 'taillights', cameraShot: 'rear34Low', price: 0 },
  { id: 'neon', group: 'lights', kind: 'color', label: 'Neón', icon: 'neon', cameraShot: 'sideLow', price: 500, dimShowroom: true },
  { id: 'interiorLight', group: 'lights', kind: 'color', label: 'Luz interior', icon: 'interiorLight', cameraShot: 'interior', price: 250 },

  { id: 'exhaustTips', group: 'exhaust', kind: 'part', label: 'Puntas de escape', icon: 'exhaustTips', cameraShot: 'rear34Low', price: 0 },
  { id: 'exhaustSound', group: 'exhaust', kind: 'part', label: 'Sonido de escape', icon: 'exhaustSound', cameraShot: 'rear34Low', price: 0 },

  { id: 'plate', group: 'plate', kind: 'part', label: 'Patente', icon: 'plate', cameraShot: 'plateRear', price: 0 },
];

/** Every category id, in menu order. What a shop that sells everything lists. */
export const CATEGORY_IDS: readonly CategoryId[] = CATEGORIES.map((c) => c.id);

const categoryIndex = new Map<string, CategoryDef>(CATEGORIES.map((c) => [c.id, c]));

export function categoryDef(id: CategoryId): CategoryDef {
  const def = categoryIndex.get(id);
  if (!def) throw new Error(`unknown workshop category ${id}`);
  return def;
}

export function isCategoryId(value: unknown): value is CategoryId {
  return typeof value === 'string' && categoryIndex.has(value);
}

/** The categories of one group, in menu order. */
export function categoriesOf(group: WorkshopGroupId): CategoryDef[] {
  return CATEGORIES.filter((c) => c.group === group);
}

/* ----------------------------------------------------------------------- parts */

export interface PartDef {
  /** `<category>.<name>`, name in `[a-z0-9-]`. See the header. */
  id: PartId;
  category: CategoryId;
  /** Shown in the UI, in Spanish or as the brand-ish name the part goes by ("GT doble plano"). */
  name: string;
  /**
   * Base price in the game's money (¥), before a shop's `priceFactor`. 0 for stock. Whole
   * number. What a domain file writes here is PROVISIONAL: `PARTS` replaces it with
   * `partPrice(category, rating)` (see "Pricing" below) unless `PRICING` names the id.
   */
  price: number;
  /**
   * Visual rating, a whole number 0..10, NFSU2's stars for one part. It is also the part's
   * TIER, and the price follows from it, so rate honestly:
   *
   *   0      nothing to look at (a plain plate, the empty trunk lid)
   *   1–2    today's car / a sober factory-ish piece — every `.stock` sits here
   *   3–4    a tasteful street part
   *   5–6    a proper aftermarket part, the middle of the range
   *   7–8    aggressive, a show car's
   *   9–10   the top of the catalogue: one or two per category at most
   *
   * The car's own stars (`carStars` in `src/sim/workshop.ts`) average these over what it wears,
   * so a stock car reads ≈ 1.3 and a fully built one 8–10. Shown only, for now (D5).
   */
  rating: number;
  /** One short line under the name, if the part needs one. Spanish. */
  blurb?: string;
  /**
   * `layers` categories only: the colour a new layer of this part starts in (vinyls). Falls
   * back to the stock vinyl's colour.
   */
  defaultColor?: ColorId;
}

/* --------------------------------------------------------------------- pricing */

/*
 * PRICING (D4, calibrated 2026-09-19 against what the city pays today).
 *
 * WHAT AN HOUR OF PLAY EARNS. A passenger ride pays `baseFare` 120 + 0.6 ¥/m of a 600–1700 m
 * straight-line trip (≈ 1100 m typical → 780) + a tip of up to 100 (≈ 60 on a decent ride):
 * ≈ 840 a ride. Finding the pin (≥ 70 m away), the ~1.5 km of road and the 10 s before the
 * next offer make a ride ≈ 2.5–3 min, so rides alone are ≈ 280–330 ¥/min. A free-roam kill pays
 * 100 but brings the police (fines 200–1000), near misses pay 10–50, crashes cost 50–300; the
 * street races pay 300 + 700 + 1500 once. A player mixing all of it honestly nets ≈ 200 ¥/min:
 *
 *     ≈ 12,000 ¥ per hour of play         (≈ 200 ¥ per minute)
 *
 * So, per D4: a mid part (≈ 10–15 min) costs 2,000–3,000, a top part (≈ 1 h) ≈ 12,000, and a
 * colour / finish / stance change costs a few minutes (250–900; chrome, the showpiece, 3,000).
 * The windshield washer's 2,000 clean (≈ 10 min) is the same order as a mid part, on purpose.
 *
 * HOW A PART IS PRICED. Agents A, B, C and G add parts in their own files in parallel, so the
 * price cannot be a table of ids somebody has to keep up: it is the category's `top` price (what
 * a rating-10 part of it costs) times `RATING_PRICE_CURVE[rating]`, rounded to a friendly
 * number. A part nobody here has ever seen gets a sensible price from its category and rating.
 * `PRICING` overrides a single id when the formula gets one wrong. Anything the stock car wears
 * is free, always.
 */

/** Fraction of its category's top price a part of each rating costs. Index = rating 0..10. */
export const RATING_PRICE_CURVE: readonly number[] = [0.04, 0.06, 0.09, 0.13, 0.17, 0.22, 0.3, 0.4, 0.55, 0.75, 1];

/**
 * What a rating-10 part costs in each `part`/`layers` category (¥, before `priceFactor`). A
 * mid part (rating 5) is 22% of it: ≈ 2,000–2,650 for bodywork and rims, 10–13 minutes of play.
 */
export const CATEGORY_TOP_PRICE: Readonly<Partial<Record<CategoryId, number>>> = {
  frontBumper: 10_000,
  rearBumper: 9_000,
  skirts: 8_000,
  hood: 9_000,
  trunk: 6_000,
  spoiler: 12_000,
  exhaustTips: 6_000,
  rims: 12_000,
  headlights: 7_000,
  taillights: 6_000,
  exhaustSound: 11_000,
  plate: 3_000,
  // A vinyl or decal is bought once and then worn in any colour, in any layer, any number of times.
  vinyls: 9_000,
  decals: 4_000,
};

/** Top price of a category nobody put in `CATEGORY_TOP_PRICE` (a new one): a mid bodywork part's. */
const DEFAULT_TOP_PRICE = 8_000;

/**
 * Parts that are not `.stock` but that the stock car wears (`STOCK_LOADOUT` in
 * `src/core/loadout.ts`, which imports this module and so cannot be imported back): free, like
 * every stock part. `tests/workshop.test.ts` checks this against `loadoutPartIds(STOCK_LOADOUT)`.
 */
const STOCK_WORN: ReadonlySet<PartId> = new Set(['vinyls.rayo']);

/** Whether `id` is part of today's car, and so free and always owned. */
export function isStockPart(id: PartId): boolean {
  return id.endsWith('.stock') || STOCK_WORN.has(id);
}

/** Round a price to what a sign would say: 50s under 1,000, 100s under 10,000, 500s above. */
function friendly(n: number): number {
  const step = n < 1000 ? 50 : n < 10_000 ? 100 : 500;
  return Math.max(step, Math.round(n / step) * step);
}

/** A part's base price from its category and rating (0 for stock is `priced`'s job, not this). */
export function partPrice(category: CategoryId, rating: number): number {
  const r = Math.max(0, Math.min(10, Math.round(Number.isFinite(rating) ? rating : 0)));
  return friendly((CATEGORY_TOP_PRICE[category] ?? DEFAULT_TOP_PRICE) * RATING_PRICE_CURVE[r]);
}

/**
 * The economy's word on single ids, over the formula: a price, a rating, or both. Empty on
 * purpose — the formula is the rule, and this is for the exception somebody notices in play.
 */
const PRICING: Readonly<Record<PartId, { price?: number; rating?: number }>> = {};

function priced(def: PartDef): PartDef {
  const over = PRICING[def.id];
  const rating = over?.rating ?? def.rating;
  const price = isStockPart(def.id) ? 0 : over?.price ?? partPrice(def.category, rating);
  return { ...def, price, rating };
}

/**
 * What one change costs in each `finish`: the paint booth's labour plus the paint. Gloss is the
 * cheap one; chrome is the showpiece (≈ 15 minutes). `CategoryDef.price` of `finish` is the
 * metallic's, for anything that reads the category alone.
 */
export const FINISH_PRICES: Readonly<Record<PaintFinish, number>> = {
  gloss: 400,
  metallic: 600,
  matte: 900,
  pearl: 1500,
  chrome: 3000,
};

/** What the plate shop charges to stamp new text on the plate (`CarLoadout.plate.text`). */
export const PLATE_TEXT_PRICE = 300;

/**
 * The base price (before `priceFactor`) of putting `value` in a non-part category — a `color`,
 * `step` or `finish` — whatever the car wears now. The caller decides whether it is charged at
 * all (it is not when `value` is what is installed, or what the stock car wears).
 */
export function changePrice(category: CategoryId, value: string | number): number {
  const def = categoryDef(category);
  if (def.kind === 'finish' && typeof value === 'string' && value in FINISH_PRICES) return FINISH_PRICES[value as PaintFinish];
  return def.price;
}

/** The whole catalogue, every domain file concatenated and priced. */
export const PARTS: readonly PartDef[] = [
  ...BODY_PARTS,
  ...WHEEL_PARTS,
  ...PAINT_PARTS,
  ...LIGHT_PARTS,
  ...EXHAUST_SOUND_PARTS,
  ...PLATE_PARTS,
].map(priced);

const partIndex = new Map<string, PartDef>(PARTS.map((p) => [p.id, p]));

/** A part by id, or undefined. What `sanitizeLoadout` asks before it trusts an id. */
export function findPart(id: unknown): PartDef | undefined {
  return typeof id === 'string' ? partIndex.get(id) : undefined;
}

/** Whether `id` names a part of `category`. */
export function isPartOf(category: CategoryId, id: unknown): id is PartId {
  const p = findPart(id);
  return !!p && p.category === category;
}

/** Every part of one category, in catalogue order (stock first, by convention). */
export function partsOf(category: CategoryId): PartDef[] {
  return PARTS.filter((p) => p.category === category);
}

/** The id every single-choice category falls back to: today's car. */
export function stockPartId(category: CategoryId): PartId {
  return `${category}.stock`;
}

/* --------------------------------------------------------------------- palette */

export interface PaletteColor {
  /** `[a-z0-9-]`. What a loadout stores. */
  id: ColorId;
  /** Shown in the UI, in Spanish. */
  name: string;
  /** `#rrggbb`. */
  hex: string;
  /**
   * A second colour for the things that are drawn in two: the stock neon is cyan down the
   * sides and magenta across the tail, the cabin cyan on the left and magenta on the right.
   * A single-colour use ignores it.
   */
  accent?: string;
}

/**
 * The colours every `color` category picks from: body paint, roof, rims, head lights, neon,
 * cabin light. Fixed ids, never free RGB — a loadout stores the id, the save validates it,
 * and a colour can be re-tuned here without touching anybody's save.
 *
 * The first entries are the ones today's car already wears (`STOCK_LOADOUT`).
 */
export const PALETTE: readonly PaletteColor[] = [
  // What the stock car wears.
  { id: 'midnight', name: 'Medianoche', hex: '#070915' },
  { id: 'graphite', name: 'Grafito', hex: '#8b93a4' },
  { id: 'xenon', name: 'Xenón', hex: '#dff2ff' },
  { id: 'rayo', name: 'Rayo', hex: '#22e6ff', accent: '#ff2fd0' },
  // Neutrals.
  { id: 'black', name: 'Negro', hex: '#0b0c10' },
  { id: 'white', name: 'Blanco', hex: '#e9ecf2' },
  { id: 'silver', name: 'Plata', hex: '#aab2c0' },
  { id: 'gunmetal', name: 'Gris plomo', hex: '#3a3f4b' },
  { id: 'sand', name: 'Arena', hex: '#cdb892' },
  // Warm.
  { id: 'red', name: 'Rojo', hex: '#d11a2a' },
  { id: 'crimson', name: 'Carmesí', hex: '#8e0f22' },
  { id: 'orange', name: 'Naranja', hex: '#ff6a13' },
  { id: 'amber', name: 'Ámbar', hex: '#ffb347' },
  { id: 'yellow', name: 'Amarillo', hex: '#ffd400' },
  { id: 'gold', name: 'Dorado', hex: '#c9a13b' },
  { id: 'bronze', name: 'Bronce', hex: '#8c5a2b' },
  { id: 'copper', name: 'Cobre', hex: '#b8643c' },
  // Green.
  { id: 'lime', name: 'Lima', hex: '#a6ff00' },
  { id: 'green', name: 'Verde', hex: '#1fbf5b' },
  { id: 'olive', name: 'Oliva', hex: '#5a6b2e' },
  { id: 'teal', name: 'Verde agua', hex: '#16a3a0' },
  // Cold.
  { id: 'cyan', name: 'Cian', hex: '#22e6ff' },
  { id: 'ice', name: 'Hielo', hex: '#9fe8ff' },
  { id: 'sky', name: 'Celeste', hex: '#5ab8ff' },
  { id: 'blue', name: 'Azul', hex: '#1f4fff' },
  { id: 'navy', name: 'Azul marino', hex: '#14204f' },
  // Violet to pink.
  { id: 'violet', name: 'Violeta', hex: '#7c2ff0' },
  { id: 'purple', name: 'Púrpura', hex: '#5b21b6' },
  { id: 'magenta', name: 'Magenta', hex: '#ff2fd0' },
  { id: 'fuchsia', name: 'Fucsia', hex: '#ff2fa8' },
  { id: 'pink', name: 'Rosa', hex: '#ff5bd0' },
  // Lamp tones.
  { id: 'halogen', name: 'Halógeno', hex: '#ffe2a8' },
];

const paletteIndex = new Map<string, PaletteColor>(PALETTE.map((c) => [c.id, c]));

export function findColor(id: unknown): PaletteColor | undefined {
  return typeof id === 'string' ? paletteIndex.get(id) : undefined;
}

export function isColorId(id: unknown): id is ColorId {
  return typeof id === 'string' && paletteIndex.has(id);
}

/* ------------------------------------------------------------------ validation */

const NAME_RE = /^[a-z0-9-]+$/;
const HEX_RE = /^#[0-9a-f]{6}$/;
const MAX_NAME_CHARS = 28;

/**
 * Everything that must hold for the catalogue to be playable, as a list of complaints. Empty
 * means fine. `tests/loadout.test.ts` asserts it is empty, so a part added in any domain file
 * with a bad id, a missing category or a negative price fails the build.
 *
 * It checks the catalogue against itself and the stock car against the catalogue. Whether
 * every part has GEOMETRY is the renderer's test (`tests/carParts.test.ts` style, per agent),
 * because this module may not import Three.js.
 */
export function validateCatalogue(): string[] {
  const problems: string[] = [];
  const check = (ok: boolean, message: string): void => {
    if (!ok) problems.push(message);
  };

  // Groups and categories.
  const groupIds = new Set(GROUPS.map((g) => g.id));
  check(groupIds.size === GROUPS.length, 'catalogue: duplicate group id');
  for (const g of GROUPS) {
    check(g.label.trim().length > 0, `group ${g.id}: empty label`);
    check(CATEGORIES.some((c) => c.group === g.id), `group ${g.id}: has no categories`);
  }
  check(categoryIndex.size === CATEGORIES.length, 'catalogue: duplicate category id');
  for (const c of CATEGORIES) {
    check(groupIds.has(c.group), `category ${c.id}: unknown group ${c.group}`);
    check(c.label.trim().length > 0 && c.label.length <= MAX_NAME_CHARS, `category ${c.id}: label empty or over ${MAX_NAME_CHARS} chars`);
    check(c.icon.trim().length > 0, `category ${c.id}: no icon`);
    check(c.cameraShot in CAMERA_SHOTS, `category ${c.id}: unknown camera shot ${c.cameraShot}`);
    check(Number.isInteger(c.price) && c.price >= 0, `category ${c.id}: price must be a whole number >= 0`);
    if (c.kind === 'part' || c.kind === 'layers') check(c.price === 0, `category ${c.id}: ${c.kind} options carry their own price`);
    if (c.kind === 'part') {
      const stock = partIndex.get(stockPartId(c.id));
      check(!!stock && stock.category === c.id, `category ${c.id}: no ${stockPartId(c.id)}`);
    }
  }

  // Parts.
  check(partIndex.size === PARTS.length, 'catalogue: duplicate part id');
  for (const p of PARTS) {
    const cat = categoryIndex.get(p.category);
    check(!!cat, `part ${p.id}: unknown category ${p.category}`);
    if (cat) check(cat.kind === 'part' || cat.kind === 'layers', `part ${p.id}: category ${p.category} does not take parts`);
    const [prefix, name, extra] = p.id.split('.');
    check(prefix === p.category && !!name && NAME_RE.test(name) && extra === undefined, `part ${p.id}: id must be ${p.category}.<[a-z0-9-]+>`);
    check(p.name.trim().length > 0 && p.name.length <= MAX_NAME_CHARS, `part ${p.id}: name empty or over ${MAX_NAME_CHARS} chars`);
    check(Number.isInteger(p.price) && p.price >= 0, `part ${p.id}: price must be a whole number >= 0`);
    check(Number.isInteger(p.rating) && p.rating >= 0 && p.rating <= 10, `part ${p.id}: rating must be a whole number 0..10`);
    if (p.id.endsWith('.stock')) check(p.price === 0, `part ${p.id}: stock is free`);
    if (p.defaultColor !== undefined) check(paletteIndex.has(p.defaultColor), `part ${p.id}: unknown default colour ${p.defaultColor}`);
  }
  for (const id of Object.keys(PRICING)) check(partIndex.has(id), `pricing: ${id} is not a part`);
  for (const c of CATEGORIES) {
    const top = CATEGORY_TOP_PRICE[c.id];
    if (c.kind === 'part' || c.kind === 'layers') check(top !== undefined, `pricing: category ${c.id} has no top price`);
    else check(top === undefined, `pricing: category ${c.id} takes no parts, so no top price`);
  }
  check(RATING_PRICE_CURVE.length === 11 && RATING_PRICE_CURVE.every((f, i) => f > 0 && (i === 0 || f > RATING_PRICE_CURVE[i - 1])), 'pricing: the rating curve must be 11 rising fractions');

  // Palette.
  check(paletteIndex.size === PALETTE.length, 'palette: duplicate colour id');
  check(PALETTE.length >= 24, 'palette: fewer than 24 colours');
  for (const c of PALETTE) {
    check(NAME_RE.test(c.id), `colour ${c.id}: id must be [a-z0-9-]`);
    check(c.name.trim().length > 0, `colour ${c.id}: empty name`);
    check(HEX_RE.test(c.hex), `colour ${c.id}: hex must be #rrggbb lowercase`);
    if (c.accent !== undefined) check(HEX_RE.test(c.accent), `colour ${c.id}: accent must be #rrggbb lowercase`);
    check(c.id !== 'off' && c.id !== 'none', `colour ${c.id}: 'off' and 'none' are reserved`);
  }

  // Camera shots.
  for (const [key, s] of Object.entries(CAMERA_SHOTS)) {
    const finite = [s.yaw, s.pitch, s.distance, s.targetY, s.targetZ, s.fov].every(Number.isFinite);
    check(finite, `shot ${key}: non-finite value`);
    check(s.distance >= 1 && s.distance <= 14, `shot ${key}: distance out of 1..14 m`);
    check(s.pitch > -0.3 && s.pitch < 1.45, `shot ${key}: pitch out of range`);
    check(s.fov >= 20 && s.fov <= 80, `shot ${key}: fov out of 20..80`);
    if (s.orbitSpeed !== undefined) check(Number.isFinite(s.orbitSpeed) && Math.abs(s.orbitSpeed) <= 1, `shot ${key}: orbit too fast`);
  }
  return problems;
}
