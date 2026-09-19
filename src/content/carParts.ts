import type { ColorId, PartId } from '../core/loadout';
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
  { id: 'rimColor', group: 'wheels', kind: 'color', label: 'Color de llanta', icon: 'rimColor', cameraShot: 'wheelFront', price: 400 },
  { id: 'wheelSize', group: 'wheels', kind: 'step', label: 'Rodado', icon: 'wheelSize', cameraShot: 'wheelFront', price: 600 },
  { id: 'wheelWidth', group: 'wheels', kind: 'step', label: 'Ancho de llanta', icon: 'wheelWidth', cameraShot: 'wheelFront', price: 600 },
  { id: 'rideHeight', group: 'wheels', kind: 'step', label: 'Altura', icon: 'rideHeight', cameraShot: 'sideLow', price: 500 },
  { id: 'camberFront', group: 'wheels', kind: 'step', label: 'Camber delantero', icon: 'camberFront', cameraShot: 'wheelFrontHead', price: 300 },
  { id: 'camberRear', group: 'wheels', kind: 'step', label: 'Camber trasero', icon: 'camberRear', cameraShot: 'wheelRearTail', price: 300 },
  { id: 'trackFront', group: 'wheels', kind: 'step', label: 'Trocha delantera', icon: 'trackFront', cameraShot: 'wheelFrontHead', price: 300 },
  { id: 'trackRear', group: 'wheels', kind: 'step', label: 'Trocha trasera', icon: 'trackRear', cameraShot: 'wheelRearTail', price: 300 },

  { id: 'paint', group: 'paint', kind: 'color', label: 'Color', icon: 'paint', cameraShot: 'overview', price: 1500 },
  { id: 'roofColor', group: 'paint', kind: 'color', label: 'Color de techo', icon: 'roofColor', cameraShot: 'roofHigh', price: 700 },
  { id: 'finish', group: 'paint', kind: 'finish', label: 'Acabado', icon: 'finish', cameraShot: 'overview', price: 900 },
  { id: 'vinyls', group: 'paint', kind: 'layers', label: 'Vinilos', icon: 'vinyls', cameraShot: 'overview', price: 0 },
  { id: 'decals', group: 'paint', kind: 'layers', label: 'Calcos', icon: 'decals', cameraShot: 'overview', price: 0 },

  { id: 'headlights', group: 'lights', kind: 'part', label: 'Faros', icon: 'headlights', cameraShot: 'front34Low', price: 0 },
  { id: 'headlightColor', group: 'lights', kind: 'color', label: 'Color de faros', icon: 'headlightColor', cameraShot: 'front34Low', price: 350 },
  { id: 'taillights', group: 'lights', kind: 'part', label: 'Luces traseras', icon: 'taillights', cameraShot: 'rear34Low', price: 0 },
  { id: 'neon', group: 'lights', kind: 'color', label: 'Neón', icon: 'neon', cameraShot: 'sideLow', price: 800, dimShowroom: true },
  { id: 'interiorLight', group: 'lights', kind: 'color', label: 'Luz interior', icon: 'interiorLight', cameraShot: 'interior', price: 300 },

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
  /** Base price in the game's money, before a shop's `priceFactor`. 0 for stock. Whole number. */
  price: number;
  /**
   * Visual rating, a whole number 0..10. The car's rating is the sum over what it wears
   * (`loadoutRating`); for now it is only shown, later it may feed reputation (D5).
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

/**
 * The economy's word over the domain files' provisional numbers, keyed by part id. Agent F
 * calibrates here (D4: a mid part ≈ 10–15 minutes of play, a top part ≈ an hour) instead of
 * editing six files the other agents are also writing in.
 */
const PRICING: Readonly<Record<PartId, { price?: number; rating?: number }>> = {};

function priced(def: PartDef): PartDef {
  const over = PRICING[def.id];
  return over ? { ...def, ...over } : def;
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
