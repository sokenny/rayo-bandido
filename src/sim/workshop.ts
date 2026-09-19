import type {
  CircuitGateState,
  EconomyState,
  GameEvent,
  IntroState,
  PassengerState,
  PoliceState,
  RaceState,
  RushState,
  StreetGateState,
  WorkshopDenyReason,
  WorkshopHudSnapshot,
  WorkshopOptionView,
  WorkshopState,
} from '../core/types';
import {
  MAX_VINYLS,
  PAINT_FINISHES,
  STEP_RANGES,
  STOCK_LOADOUT,
  DECAL_ZONES,
  cloneLoadout,
  getChoice,
  isValidChoice,
  sanitizeLoadout,
  setChoice,
  setDecals,
  setPlateText,
  setVinyls,
  type CarLoadout,
  type ColorId,
  type DecalLayer,
  type PaintFinish,
  type PartId,
  type ScalarCategoryId,
  type StepCategoryId,
  type VinylLayer,
} from '../core/loadout';
import {
  CATEGORY_IDS,
  PALETTE,
  PLATE_TEXT_PRICE,
  categoryDef,
  changePrice,
  findColor,
  findPart,
  isCategoryId,
  isStockPart,
  partsOf,
  type CategoryId,
  type WorkshopGroupId,
} from '../content/carParts';
import { shopCategoriesOf, shopGroups, shopPrice, shopSells, type ShopDef } from '../content/shops';
import { sanitizeOwnedParts, type GarageSave } from '../core/progress';
import { engagedActivity } from './activities';
import { spendMoney } from './economy';

/**
 * LOCO MUSTANG'S WORKSHOP: the rules of one visit (`docs/GARAGE_PLAN.md` §2.3).
 *
 *   closed → entering → browsing ⇄ previewing → leaving → closed
 *
 * WHAT IT HOLDS. `installed` is what the car wears on the street and what the save keeps;
 * `preview` is what the car on the platform wears. Trying something on is free and only ever
 * touches `preview`. INSTALL makes `installed = preview` and charges — through `spendMoney`, the
 * one place money is taken — for what the preview adds that the player has not paid for yet.
 *
 * WHAT COSTS WHAT (D4; the numbers are `src/content/carParts.ts`'s):
 * - a PART (`part` and `layers` categories) is bought once: `PartDef.price × shop.priceFactor`,
 *   then it is in `owned` and wearing it again is free. Stock parts are everybody's, always.
 * - a non-part change — a colour, a stance step, a finish — is labour and paint, charged every
 *   time it is installed (`changePrice`). Putting a category back to what the stock car wears is
 *   free: undoing to factory never costs.
 * - new plate text is `PLATE_TEXT_PRICE`, back to the stock text free.
 * - vinyl and decal LAYERS: only the parts in them not yet owned are charged; re-colouring,
 *   re-ordering or removing layers of owned vinyls is free.
 *
 * A PREVIEW NEVER OUTLIVES ITS CATEGORY. Leaving a category (`back`, another category, another
 * group) throws the un-installed try-on away, and so does leaving the workshop. So outside
 * `previewing`, `preview` equals `installed`, which is what `WorkshopState` promises the HUD.
 *
 * THE DOOR. `canEnterWorkshop` says whether a visit may start (no race or versus world, no
 * police on the car, nothing else holding it); `openWorkshop` starts one or raises
 * `workshopDenied`. Once open the visit is an activity (`workshopEngaged` in `activities.ts`)
 * and holds the car until `closed`.
 *
 * Pure data in, pure data out. No Three.js, no DOM, no clock of its own: `stepWorkshop` is
 * handed `dt` like every other rule. Commands allocate (they run on a key press); the HUD
 * snapshot does not.
 */

/* ================================================================== timing */

/**
 * The fades, in seconds of simulation time. Each is a round trip through black: the screen goes
 * dark over the first half, the scene is swapped at the midpoint (`workshopShowroomVisible`
 * flips), and the new scene fades up over the second half. ~350 ms each way (§2.4).
 */
export const WORKSHOP_TIMING = {
  enterSeconds: 0.7,
  leaveSeconds: 0.7,
} as const;

/* ================================================================== commands */

/**
 * What the player asked the workshop to do. The UI (`src/ui/workshop/`, agent E) raises its own
 * `WorkshopIntent`; the integrator maps one onto this. Everything a command names is checked —
 * a stale index or a category the shop does not sell is `workshopDenied: 'invalid'`, never a
 * throw. Commands are ignored while `entering`, `leaving` or `closed`.
 *
 * - `group`     — move the carousel to another group, by id or by `delta` (±1, wraps over the
 *                 groups this shop sells). Discards an un-installed preview; ends up `browsing`
 *                 on the group's first category.
 * - `category`  — highlight another category, by id or by `delta` (±1, wraps within the group).
 *                 Discards an un-installed preview. `open: true` goes straight into it
 *                 (`previewing`); otherwise the phase stays what it was — browsing stays on the
 *                 carousel, previewing opens the new category (NFSU2's LB/RB inside a list).
 * - `select`    — open the highlighted category (`browsing` → `previewing`). The rail starts on
 *                 what is installed.
 * - `option`    — move the rail, by `index` or by `delta` (wraps), and put that option on the
 *                 car. From `browsing` it opens the category first. On a `layers` category the
 *                 option is a vinyl/decal to ADD to the preview's layers (see `layerWith`).
 * - `color`     — put a colour on the car in a `color` category (`'off'` for neon, `'none'` for
 *                 the roof): the open one, or `category` (opened if it is not).
 * - `step`      — the same for a `step` category, by `value` or by `delta` (clamped, no wrap).
 * - `finish`    — the same for the paint finish.
 * - `layer`     — replace the preview's whole vinyl or decal list (the UI's layer editor owns the
 *                 editing: which layer is selected, its colour, its zone). Sanitized like a save:
 *                 unknown ids dropped, at most `MAX_VINYLS` vinyls, one decal per zone.
 * - `plateText` — new text on the preview's plate (sanitized: `[A-Z0-9 ]`, 7 at most). Opens
 *                 the `plate` category if it is not open.
 * - `install`   — pay for and keep the preview (see the header for what it costs). Stays in
 *                 the category. Refused with `funds` when the counter cannot cover it.
 * - `back`      — `previewing` → `browsing` (discarding the try-on); `browsing` → leave.
 * - `exit`      — leave from anywhere, discarding the try-on.
 */
export type WorkshopCommand =
  | { type: 'group'; group?: WorkshopGroupId; delta?: number }
  | { type: 'category'; category?: CategoryId; delta?: number; open?: boolean }
  | { type: 'select' }
  | { type: 'option'; index?: number; delta?: number }
  | { type: 'color'; value: ColorId | 'off' | 'none'; category?: CategoryId }
  | { type: 'step'; value?: number; delta?: number; category?: CategoryId }
  | { type: 'finish'; value: PaintFinish }
  | { type: 'layer'; category: 'vinyls'; layers: readonly VinylLayer[] }
  | { type: 'layer'; category: 'decals'; layers: readonly DecalLayer[] }
  | { type: 'plateText'; text: string }
  | { type: 'install' }
  | { type: 'back' }
  | { type: 'exit' };

/* ================================================================== state */

/**
 * A closed workshop wearing `saved` (the save's `readGarage()`, or nothing for today's car).
 * Everything is sanitized again here: the state never holds anything the catalogue rejects.
 * The parts the saved car wears count as owned — it is wearing them.
 */
export function createWorkshopState(saved?: Partial<GarageSave> | null): WorkshopState {
  const installed = sanitizeLoadout(saved?.loadout ?? STOCK_LOADOUT);
  const owned = sanitizeOwnedParts(saved?.owned);
  for (const id of wornParts(installed)) if (!isStockPart(id) && !owned.includes(id)) owned.push(id);
  return {
    phase: 'closed',
    phaseTime: 0,
    shopId: '',
    locked: false,
    group: 'body',
    category: 'frontBumper',
    optionIndex: 0,
    installed,
    preview: cloneLoadout(installed),
    owned,
    purchases: 0,
    lastDenied: null,
    deniedId: 0,
    purchaseId: 0,
  };
}

/** What the save should hold now: `installed` and `owned`. Write it on every `workshopPurchase`. */
export function workshopSave(ws: WorkshopState): GarageSave {
  return { loadout: cloneLoadout(ws.installed), owned: ws.owned.slice() };
}

/** Whether a visit is under way (every phase but `closed`). Same as `workshopEngaged`. */
export function workshopOpen(ws: WorkshopState | null | undefined): boolean {
  return !!ws && ws.phase !== 'closed';
}

/** Whether commands are listened to: the showroom is up and no fade is running. */
function interactive(ws: WorkshopState): boolean {
  return ws.phase === 'browsing' || ws.phase === 'previewing';
}

function deny(ws: WorkshopState, reason: WorkshopDenyReason, category: CategoryId | null, events: GameEvent[]): false {
  ws.lastDenied = reason;
  ws.deniedId += 1;
  events.push({ type: 'workshopDenied', reason, category });
  return false;
}

/* ================================================================== the door */

/** What `canEnterWorkshop` looks at. `GameState` fits it as it is. */
export interface WorkshopDoorContext {
  race?: RaceState | null;
  police?: PoliceState | null;
  rush?: RushState | null;
  passenger?: PassengerState | null;
  circuitGate?: CircuitGateState | null;
  streetGate?: StreetGateState | null;
  intro?: IntroState | null;
  workshop?: WorkshopState | null;
}

/**
 * Why the door would not open right now, or null when it would:
 * - `race`   — a race world (the circuit, a street race, a versus room): Free Roam only.
 * - `police` — the police are on the car: looking (`alert`), chasing, searching, or arresting.
 *              The workshop is not a hiding place. A `cooldown` (escaped, stars fading) is fine.
 * - `locked` — another activity has the car (`engagedActivity`), or a visit is already on.
 *
 * Whether the car is on the ring at all is the caller's (`GarageState.atSite`).
 */
export function canEnterWorkshop(state: WorkshopDoorContext): WorkshopDenyReason | null {
  if (state.race) return 'race';
  const p = state.police;
  if (p && (p.phase === 'alert' || p.phase === 'pursuit' || p.phase === 'escaping' || p.phase === 'busted')) return 'police';
  if (engagedActivity(state) !== null) return 'locked';
  return null;
}

/**
 * Open the door to `shop`: `entering` starts (the fade to the showroom), `workshopEnter` is
 * raised. `denied` is `canEnterWorkshop`'s answer, passed in so this stays a function of the
 * workshop alone; a reason raises `workshopDenied` instead and changes nothing else.
 */
export function openWorkshop(ws: WorkshopState, shop: ShopDef, events: GameEvent[], denied: WorkshopDenyReason | null = null): boolean {
  if (ws.phase !== 'closed') return deny(ws, 'locked', null, events);
  if (denied) return deny(ws, denied, null, events);
  const groups = shopGroups(shop);
  if (groups.length === 0) return deny(ws, 'invalid', null, events);
  ws.phase = 'entering';
  ws.phaseTime = 0;
  ws.shopId = shop.id;
  ws.group = groups[0];
  ws.category = shopCategoriesOf(shop, ws.group)[0];
  ws.optionIndex = installedIndex(ws, ws.category);
  ws.preview = cloneLoadout(ws.installed);
  ws.purchases = 0;
  ws.lastDenied = null;
  events.push({ type: 'workshopEnter', shopId: shop.id });
  return true;
}

/** Start leaving from wherever the visit is: the try-on is thrown away, the fade back begins. */
export function closeWorkshop(ws: WorkshopState, events: GameEvent[]): boolean {
  if (ws.phase === 'closed' || ws.phase === 'leaving') return false;
  discardPreview(ws, events);
  ws.phase = 'leaving';
  ws.phaseTime = 0;
  return true;
}

/**
 * One tick: the fades run out. `entering` becomes `browsing`; `leaving` becomes `closed` and
 * raises `workshopExit` — the moment the car is back on the street wearing `installed`.
 */
export function stepWorkshop(ws: WorkshopState, dt: number, events: GameEvent[]): void {
  if (ws.phase === 'closed') return;
  ws.phaseTime += dt;
  if (ws.phase === 'entering' && ws.phaseTime >= WORKSHOP_TIMING.enterSeconds) {
    ws.phase = 'browsing';
    ws.phaseTime = 0;
  } else if (ws.phase === 'leaving' && ws.phaseTime >= WORKSHOP_TIMING.leaveSeconds) {
    events.push({ type: 'workshopExit', shopId: ws.shopId, purchases: ws.purchases });
    ws.phase = 'closed';
    ws.phaseTime = 0;
    ws.shopId = '';
    ws.preview = cloneLoadout(ws.installed);
  }
}

/** 0 clear .. 1 black: the entering/leaving fade, peaking at the midpoint. 0 while browsing. */
export function workshopFade(ws: WorkshopState): number {
  const span = ws.phase === 'entering' ? WORKSHOP_TIMING.enterSeconds : ws.phase === 'leaving' ? WORKSHOP_TIMING.leaveSeconds : 0;
  if (span <= 0) return 0;
  const u = Math.min(1, Math.max(0, ws.phaseTime / span));
  return 1 - Math.abs(2 * u - 1);
}

/** Whether the showroom (not the street) is the scene to draw: from the entering midpoint to the leaving one. */
export function workshopShowroomVisible(ws: WorkshopState): boolean {
  switch (ws.phase) {
    case 'entering':
      return ws.phaseTime >= WORKSHOP_TIMING.enterSeconds / 2;
    case 'leaving':
      return ws.phaseTime < WORKSHOP_TIMING.leaveSeconds / 2;
    case 'closed':
      return false;
    default:
      return true;
  }
}

/* ================================================================== options */

const optionCache = new Map<CategoryId, readonly (string | number)[]>();

/**
 * Every option of `category`, in rail order: part ids (catalogue order, stock first) for `part`
 * and `layers` categories; palette ids for `color` (neon adds `'off'` first, the roof `'none'`);
 * each whole step from min to max for `step`; `PAINT_FINISHES` for `finish`. Static and cached:
 * never mutate the result.
 */
export function workshopOptions(category: CategoryId): readonly (string | number)[] {
  let list = optionCache.get(category);
  if (list) return list;
  const def = categoryDef(category);
  switch (def.kind) {
    case 'part':
    case 'layers':
      list = partsOf(category).map((p) => p.id);
      break;
    case 'color': {
      const colors = PALETTE.map((c) => c.id as string | number);
      list = category === 'neon' ? ['off', ...colors] : category === 'roofColor' ? ['none', ...colors] : colors;
      break;
    }
    case 'step': {
      const { min, max } = STEP_RANGES[category as StepCategoryId];
      const steps: number[] = [];
      for (let n = min; n <= max; n++) steps.push(n);
      list = steps;
      break;
    }
    case 'finish':
      list = PAINT_FINISHES.slice();
      break;
  }
  optionCache.set(category, list);
  return list;
}

/** Where `installed` sits in the category's rail (0 for layers, or when not found). */
function installedIndex(ws: WorkshopState, category: CategoryId): number {
  if (category === 'vinyls' || category === 'decals') return 0;
  const i = workshopOptions(category).indexOf(getChoice(ws.installed, category));
  return i < 0 ? 0 : i;
}

/** Whether the category's current choice is what the stock car wears. */
function isStockChoice(category: ScalarCategoryId, value: string | number): boolean {
  return getChoice(STOCK_LOADOUT, category) === value;
}

function ownsPart(ws: WorkshopState, id: PartId): boolean {
  return isStockPart(id) || ws.owned.includes(id);
}

/** Every part id the car wears, layers included. */
function wornParts(l: CarLoadout): PartId[] {
  return [
    l.body.frontBumper,
    l.body.rearBumper,
    l.body.skirts,
    l.body.hood,
    l.body.trunk,
    l.body.spoiler,
    l.body.exhaustTips,
    l.wheels.rim,
    ...l.vinyls.map((v) => v.id),
    ...l.decals.map((d) => d.id),
    l.lights.head,
    l.lights.tail,
    l.exhaustSound,
    l.plate.style,
  ];
}

/* ================================================================== pricing */

/** One line of what INSTALL would charge: a category that changed and its price in this shop. */
export interface WorkshopQuoteLine {
  category: CategoryId;
  value: string | number;
  price: number;
}

function vinylsEqual(a: readonly VinylLayer[], b: readonly VinylLayer[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i].id !== b[i].id || a[i].color !== b[i].color) return false;
  return true;
}

function decalsEqual(a: readonly DecalLayer[], b: readonly DecalLayer[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i].id !== b[i].id || a[i].zone !== b[i].zone) return false;
  return true;
}

/** What the unowned parts in a layer list cost in `shop` (each part once, however many layers wear it). */
function layerPrice(ws: WorkshopState, shop: ShopDef, layers: readonly { id: PartId }[]): number {
  let total = 0;
  for (let i = 0; i < layers.length; i++) {
    const id = layers[i].id;
    if (ownsPart(ws, id)) continue;
    let repeat = false;
    for (let j = 0; j < i; j++) if (layers[j].id === id) repeat = true;
    if (!repeat) total += shopPrice(shop, findPart(id)?.price ?? 0);
  }
  return total;
}

/** What `preview` would cost in `category` over `installed`, or -1 when the category is unchanged. */
function categoryPrice(ws: WorkshopState, shop: ShopDef, category: CategoryId): number {
  if (category === 'vinyls') return vinylsEqual(ws.preview.vinyls, ws.installed.vinyls) ? -1 : layerPrice(ws, shop, ws.preview.vinyls);
  if (category === 'decals') return decalsEqual(ws.preview.decals, ws.installed.decals) ? -1 : layerPrice(ws, shop, ws.preview.decals);
  const value = getChoice(ws.preview, category);
  if (value === getChoice(ws.installed, category)) return -1;
  if (categoryDef(category).kind === 'part') return ownsPart(ws, value as PartId) ? 0 : shopPrice(shop, findPart(value)?.price ?? 0);
  return isStockChoice(category, value) ? 0 : shopPrice(shop, changePrice(category, value));
}

/** What new plate text costs, or -1 when the text is unchanged. */
function plateTextPrice(ws: WorkshopState, shop: ShopDef): number {
  const text = ws.preview.plate.text;
  if (text === ws.installed.plate.text) return -1;
  return text === STOCK_LOADOUT.plate.text ? 0 : shopPrice(shop, PLATE_TEXT_PRICE);
}

/**
 * What INSTALL would charge right now: the sum over every category where `preview` differs from
 * `installed`, plus new plate text. -1 when nothing differs (INSTALL has nothing to do). Pass
 * `lines` to also get the itemised quote. Allocation-free without `lines`: the HUD calls it
 * every frame.
 */
export function installQuote(ws: WorkshopState, shop: ShopDef, lines?: WorkshopQuoteLine[]): number {
  let total = -1;
  for (let i = 0; i < CATEGORY_IDS.length; i++) {
    const category = CATEGORY_IDS[i];
    const price = categoryPrice(ws, shop, category);
    if (price < 0) continue;
    total = Math.max(0, total) + price;
    lines?.push({ category, value: previewValue(ws.preview, category), price });
  }
  const plate = plateTextPrice(ws, shop);
  if (plate >= 0) {
    total = Math.max(0, total) + plate;
    lines?.push({ category: 'plate', value: ws.preview.plate.text, price: plate });
  }
  return total;
}

/** What a `workshopPreview`/`workshopPurchase` event reports for a category: the choice, or the top layer. */
function previewValue(l: CarLoadout, category: CategoryId): string | number {
  if (category === 'vinyls') return l.vinyls.length > 0 ? l.vinyls[l.vinyls.length - 1].id : '';
  if (category === 'decals') return l.decals.length > 0 ? l.decals[l.decals.length - 1].id : '';
  return getChoice(l, category);
}

/**
 * What one option costs to install in this shop, alone, over what is installed: 0 when it is
 * installed, owned, stock, or a non-part change back to stock.
 */
export function optionPrice(ws: WorkshopState, shop: ShopDef, category: CategoryId, value: string | number): number {
  const def = categoryDef(category);
  if (def.kind === 'part' || def.kind === 'layers') {
    const id = value as PartId;
    if (ownsPart(ws, id)) return 0;
    return shopPrice(shop, findPart(id)?.price ?? 0);
  }
  const c = category as ScalarCategoryId;
  if (getChoice(ws.installed, c) === value || isStockChoice(c, value)) return 0;
  return shopPrice(shop, changePrice(category, value));
}

/* ================================================================== the machine */

function setPreview(ws: WorkshopState, next: CarLoadout, category: CategoryId, value: string | number, events: GameEvent[]): void {
  ws.preview = next;
  events.push({ type: 'workshopPreview', category, value });
}

/** `installQuote` against any shop answers "does anything differ" the same; this one is never sold from. */
const SHOP_FOR_DIFF: ShopDef = { id: 'diff', npc: '', name: '', categories: CATEGORY_IDS, priceFactor: 1 };

/** Throw away the try-on. Tells the renderer when the car on the platform actually changes. */
function discardPreview(ws: WorkshopState, events: GameEvent[]): void {
  if (installQuote(ws, SHOP_FOR_DIFF) < 0) return;
  ws.preview = cloneLoadout(ws.installed);
  events.push({ type: 'workshopPreview', category: ws.category, value: previewValue(ws.preview, ws.category) });
}

/** Move to `category` (sold by `shop`), discarding the try-on, opening it when `open`. */
function goToCategory(ws: WorkshopState, category: CategoryId, open: boolean, events: GameEvent[]): void {
  if (category !== ws.category) discardPreview(ws, events);
  ws.category = category;
  ws.group = categoryDef(category).group;
  ws.optionIndex = installedIndex(ws, category);
  if (open) ws.phase = 'previewing';
}

/** Make sure `category` is the open one, or deny. */
function ensureOpen(ws: WorkshopState, shop: ShopDef, category: CategoryId, events: GameEvent[]): boolean {
  if (!shopSells(shop, category)) return deny(ws, 'invalid', category, events);
  if (ws.category !== category || ws.phase !== 'previewing') goToCategory(ws, category, true, events);
  return true;
}

/**
 * `layers` categories: the preview's layers with `id` added on top. A vinyl already worn stays
 * where it is; a new one goes on top in its default colour, replacing the top layer when all
 * `MAX_VINYLS` are taken. A decal goes into the first free zone, or replaces the top one.
 */
function layerWith(l: CarLoadout, category: 'vinyls' | 'decals', id: PartId): CarLoadout {
  if (category === 'vinyls') {
    if (l.vinyls.some((v) => v.id === id)) return cloneLoadout(l);
    const layers = l.vinyls.map((v) => ({ ...v }));
    const color = findPart(id)?.defaultColor ?? STOCK_LOADOUT.vinyls[0].color;
    if (layers.length >= MAX_VINYLS) layers[layers.length - 1] = { id, color };
    else layers.push({ id, color });
    return setVinyls(l, layers);
  }
  if (l.decals.some((d) => d.id === id)) return cloneLoadout(l);
  const layers = l.decals.map((d) => ({ ...d }));
  const zone = DECAL_ZONES.find((z) => !layers.some((d) => d.zone === z));
  if (zone) layers.push({ id, zone });
  else if (layers.length > 0) layers[layers.length - 1] = { id, zone: layers[layers.length - 1].zone };
  return setDecals(l, layers);
}

/** Put option `index` of the open category on the car. */
function previewOption(ws: WorkshopState, index: number, events: GameEvent[]): boolean {
  const options = workshopOptions(ws.category);
  if (!Number.isInteger(index) || index < 0 || index >= options.length) return deny(ws, 'invalid', ws.category, events);
  ws.optionIndex = index;
  const value = options[index];
  const category = ws.category;
  if (category === 'vinyls' || category === 'decals') {
    setPreview(ws, layerWith(ws.preview, category, value as PartId), category, value, events);
    return true;
  }
  setPreview(ws, setChoice(ws.preview, category, value), category, value, events);
  return true;
}

/** Put `value` on the car in `category` (a colour, step or finish), opening it if need be. */
function previewValueIn(ws: WorkshopState, shop: ShopDef, category: CategoryId, value: string | number, events: GameEvent[]): boolean {
  if (category === 'vinyls' || category === 'decals' || !isValidChoice(category, value)) return deny(ws, 'invalid', category, events);
  if (!ensureOpen(ws, shop, category, events)) return false;
  const index = workshopOptions(category).indexOf(value);
  return previewOption(ws, index, events);
}

/** INSTALL: pay for the preview and keep it. */
function install(ws: WorkshopState, shop: ShopDef, economy: EconomyState, events: GameEvent[]): boolean {
  if (ws.phase !== 'previewing') return false;
  const lines: WorkshopQuoteLine[] = [];
  const total = installQuote(ws, shop, lines);
  if (total < 0) return false;
  for (const line of lines) if (!shopSells(shop, line.category)) return deny(ws, 'invalid', line.category, events);
  if (!spendMoney(economy, total)) return deny(ws, 'funds', ws.category, events);
  for (const id of wornParts(ws.preview)) if (!ownsPart(ws, id)) ws.owned.push(id);
  ws.installed = cloneLoadout(ws.preview);
  if (total > 0) ws.purchases += 1;
  ws.purchaseId += 1;
  ws.lastDenied = null;
  for (const line of lines) {
    events.push({ type: 'workshopPurchase', shopId: shop.id, category: line.category, value: line.value, price: line.price, balance: economy.money });
  }
  return true;
}

const wrap = (i: number, n: number): number => ((i % n) + n) % n;

/**
 * Apply one command. Returns whether anything changed (a refusal returns false and raises
 * `workshopDenied`; a command in the wrong phase returns false silently). See `WorkshopCommand`.
 */
export function applyWorkshopCommand(
  ws: WorkshopState,
  cmd: WorkshopCommand,
  shop: ShopDef,
  economy: EconomyState,
  events: GameEvent[],
): boolean {
  if (!interactive(ws)) return false;
  switch (cmd.type) {
    case 'group': {
      const groups = shopGroups(shop);
      let group: WorkshopGroupId | undefined = cmd.group;
      if (group === undefined && typeof cmd.delta === 'number' && Number.isFinite(cmd.delta)) {
        const at = groups.indexOf(ws.group);
        group = groups[wrap((at < 0 ? 0 : at) + Math.round(cmd.delta), groups.length)];
      }
      if (!group || !groups.includes(group)) return deny(ws, 'invalid', null, events);
      goToCategory(ws, shopCategoriesOf(shop, group)[0], false, events);
      ws.phase = 'browsing';
      return true;
    }
    case 'category': {
      let category: CategoryId | undefined = cmd.category;
      if (category === undefined && typeof cmd.delta === 'number' && Number.isFinite(cmd.delta)) {
        const list = shopCategoriesOf(shop, ws.group);
        const at = list.indexOf(ws.category);
        category = list[wrap((at < 0 ? 0 : at) + Math.round(cmd.delta), list.length)];
      }
      if (!category || !isCategoryId(category) || !shopSells(shop, category)) return deny(ws, 'invalid', category ?? null, events);
      goToCategory(ws, category, cmd.open === true || ws.phase === 'previewing', events);
      return true;
    }
    case 'select':
      if (ws.phase === 'previewing') return false;
      goToCategory(ws, ws.category, true, events);
      return true;
    case 'option': {
      if (ws.phase === 'browsing') goToCategory(ws, ws.category, true, events);
      const n = workshopOptions(ws.category).length;
      let index = cmd.index;
      if (index === undefined && typeof cmd.delta === 'number' && Number.isFinite(cmd.delta) && n > 0) {
        index = wrap(ws.optionIndex + Math.round(cmd.delta), n);
      }
      return previewOption(ws, index ?? -1, events);
    }
    case 'color': {
      const category = cmd.category ?? ws.category;
      if (!isCategoryId(category) || categoryDef(category).kind !== 'color') return deny(ws, 'invalid', isCategoryId(category) ? category : null, events);
      return previewValueIn(ws, shop, category, cmd.value, events);
    }
    case 'step': {
      const category = cmd.category ?? ws.category;
      if (!isCategoryId(category) || categoryDef(category).kind !== 'step') return deny(ws, 'invalid', isCategoryId(category) ? category : null, events);
      let value = cmd.value;
      if (value === undefined && typeof cmd.delta === 'number' && Number.isFinite(cmd.delta)) {
        const { min, max } = STEP_RANGES[category as StepCategoryId];
        value = Math.min(max, Math.max(min, (getChoice(ws.preview, category as StepCategoryId) as number) + Math.round(cmd.delta)));
      }
      return previewValueIn(ws, shop, category, value ?? NaN, events);
    }
    case 'finish':
      return previewValueIn(ws, shop, 'finish', cmd.value, events);
    case 'layer': {
      if (cmd.category !== 'vinyls' && cmd.category !== 'decals') return deny(ws, 'invalid', null, events);
      if (!ensureOpen(ws, shop, cmd.category, events)) return false;
      const next = cmd.category === 'vinyls' ? setVinyls(ws.preview, cmd.layers as readonly VinylLayer[]) : setDecals(ws.preview, cmd.layers as readonly DecalLayer[]);
      setPreview(ws, next, cmd.category, previewValue(next, cmd.category), events);
      return true;
    }
    case 'plateText': {
      if (typeof cmd.text !== 'string') return deny(ws, 'invalid', 'plate', events);
      if (!ensureOpen(ws, shop, 'plate', events)) return false;
      const next = setPlateText(ws.preview, cmd.text);
      setPreview(ws, next, 'plate', next.plate.text, events);
      return true;
    }
    case 'install':
      return install(ws, shop, economy, events);
    case 'back':
      if (ws.phase === 'previewing') {
        discardPreview(ws, events);
        ws.phase = 'browsing';
        ws.optionIndex = installedIndex(ws, ws.category);
        return true;
      }
      return closeWorkshop(ws, events);
    case 'exit':
      return closeWorkshop(ws, events);
  }
}

/* ================================================================== stars */

/** Non-part categories whose leaving stock earns a little style bonus in `carStars`. */
const STYLE_CATEGORIES: readonly ScalarCategoryId[] = [
  'rimColor',
  'wheelSize',
  'wheelWidth',
  'rideHeight',
  'camberFront',
  'camberRear',
  'trackFront',
  'trackRear',
  'paint',
  'roofColor',
  'finish',
  'headlightColor',
  'neon',
  'interiorLight',
];
const STYLE_BONUS_EACH = 0.15;
const STYLE_BONUS_MAX = 1.5;

/**
 * The car's stars, 0..10 with one decimal, NFSU2-style (D5). The average part rating over the
 * fourteen places a part is worn — seven bodywork slots, the rims, head and tail lights, the
 * exhaust note, the plate, and the best vinyl and the best decal (0 when none) — plus
 * `STYLE_BONUS_EACH` for every colour, stance or finish that is not the factory's, up to
 * `STYLE_BONUS_MAX`. Today's car reads ≈ 1.3; a car built from rating-9 and -10 parts, 10.
 *
 * `loadoutRating` (`src/core/loadout.ts`) is the raw SUM of the same part ratings; this is
 * the number to show.
 */
export function carStars(l: CarLoadout): number {
  const rating = (id: PartId): number => findPart(id)?.rating ?? 0;
  let sum =
    rating(l.body.frontBumper) +
    rating(l.body.rearBumper) +
    rating(l.body.skirts) +
    rating(l.body.hood) +
    rating(l.body.trunk) +
    rating(l.body.spoiler) +
    rating(l.body.exhaustTips) +
    rating(l.wheels.rim) +
    rating(l.lights.head) +
    rating(l.lights.tail) +
    rating(l.exhaustSound) +
    rating(l.plate.style);
  let vinyl = 0;
  for (let i = 0; i < l.vinyls.length; i++) vinyl = Math.max(vinyl, rating(l.vinyls[i].id));
  let decal = 0;
  for (let i = 0; i < l.decals.length; i++) decal = Math.max(decal, rating(l.decals[i].id));
  sum += vinyl + decal;
  let style = 0;
  for (let i = 0; i < STYLE_CATEGORIES.length; i++) {
    const c = STYLE_CATEGORIES[i];
    if (getChoice(l, c) !== getChoice(STOCK_LOADOUT, c)) style += STYLE_BONUS_EACH;
  }
  if (l.plate.text !== STOCK_LOADOUT.plate.text) style += STYLE_BONUS_EACH;
  const stars = sum / 14 + Math.min(STYLE_BONUS_MAX, style);
  return Math.min(10, Math.round(stars * 10) / 10);
}

/* ================================================================== the HUD */

const FINISH_LABELS: Record<PaintFinish, string> = {
  gloss: 'Brillante',
  metallic: 'Metalizado',
  pearl: 'Perlado',
  matte: 'Mate',
  chrome: 'Cromado',
};

/** The Spanish label of one option, as the rail prints it. */
export function optionLabel(category: CategoryId, value: string | number): string {
  const def = categoryDef(category);
  switch (def.kind) {
    case 'part':
    case 'layers':
      return findPart(value)?.name ?? String(value);
    case 'color':
      if (value === 'off') return 'Apagado';
      if (value === 'none') return 'Como la carrocería';
      return findColor(value)?.name ?? String(value);
    case 'step': {
      const n = Number(value);
      return n === 0 ? '0 · de fábrica' : n > 0 ? `+${n}` : String(n);
    }
    case 'finish':
      return FINISH_LABELS[value as PaintFinish] ?? String(value);
  }
}

/** Labels are static per (category, value): cached so the per-frame snapshot never builds a string. */
const labelCache = new Map<string, string>();
function cachedLabel(category: CategoryId, value: string | number): string {
  const key = `${category}|${value}`;
  let label = labelCache.get(key);
  if (label === undefined) {
    label = optionLabel(category, value);
    labelCache.set(key, label);
  }
  return label;
}

/** A fresh snapshot to pass back into `workshopHudSnapshot` every frame. */
export function createWorkshopHudSnapshot(): WorkshopHudSnapshot {
  return {
    open: false,
    phase: 'closed',
    fade: 0,
    shopId: '',
    shopName: '',
    money: 0,
    group: 'body',
    categories: [],
    category: 'frontBumper',
    inCategory: false,
    options: [],
    optionIndex: 0,
    installPrice: 0,
    canInstall: false,
    rating: 0,
    previewRating: 0,
    dirty: false,
    plateText: '',
    lastDenied: null,
    deniedId: 0,
    purchaseId: 0,
  };
}

/**
 * Fill `out` (reused frame to frame; its `options` rows are reused too) from the workshop.
 * `rating`/`previewRating` are `carStars` (0..10), not the raw `loadoutRating` sum. Allocates
 * only when the option rail grows past its longest yet, and on the first sight of a label.
 */
export function workshopHudSnapshot(
  ws: WorkshopState,
  economy: EconomyState,
  shop: ShopDef,
  out: WorkshopHudSnapshot = createWorkshopHudSnapshot(),
): WorkshopHudSnapshot {
  out.open = ws.phase !== 'closed';
  out.phase = ws.phase;
  out.fade = workshopFade(ws);
  out.shopId = ws.shopId;
  out.shopName = shop.name;
  out.money = economy.money;
  out.group = ws.group;
  out.categories = shopCategoriesOf(shop, ws.group);
  out.category = ws.category;
  out.inCategory = ws.phase === 'previewing';
  out.optionIndex = ws.optionIndex;
  out.plateText = ws.preview.plate.text;
  out.lastDenied = ws.lastDenied;
  out.deniedId = ws.deniedId;
  out.purchaseId = ws.purchaseId;
  out.rating = carStars(ws.installed);
  out.previewRating = carStars(ws.preview);

  const quote = installQuote(ws, shop);
  out.installPrice = Math.max(0, quote);
  out.dirty = quote >= 0;
  out.canInstall = ws.phase === 'previewing' && quote >= 0 && economy.money >= quote;

  const rows = out.options as WorkshopOptionView[];
  const values = workshopOptions(ws.category);
  const def = categoryDef(ws.category);
  const layered = def.kind === 'layers';
  const installedChoice = layered ? null : getChoice(ws.installed, ws.category as ScalarCategoryId);
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    let row = rows[i];
    if (!row) {
      row = { value: 0, label: '', price: 0, owned: false, installed: false, swatch: null, rating: 0 };
      rows[i] = row;
    }
    row.value = value;
    row.label = cachedLabel(ws.category, value);
    row.price = optionPrice(ws, shop, ws.category, value);
    if (def.kind === 'part' || layered) {
      row.owned = ownsPart(ws, value as PartId);
      row.installed = layered ? wornLayer(ws.installed, ws.category as 'vinyls' | 'decals', value as PartId) : installedChoice === value;
      row.rating = findPart(value)?.rating ?? 0;
      row.swatch = null;
    } else {
      row.installed = installedChoice === value;
      row.owned = row.installed;
      row.rating = 0;
      row.swatch = def.kind === 'color' ? (findColor(value)?.hex ?? null) : null;
    }
  }
  rows.length = values.length;
  return out;
}

function wornLayer(l: CarLoadout, category: 'vinyls' | 'decals', id: PartId): boolean {
  const layers = category === 'vinyls' ? l.vinyls : l.decals;
  for (let i = 0; i < layers.length; i++) if (layers[i].id === id) return true;
  return false;
}
