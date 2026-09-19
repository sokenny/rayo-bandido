import type { WorkshopDenyReason, WorkshopHudSnapshot } from '../../core/types';
import {
  CATEGORIES,
  GROUPS,
  PALETTE,
  categoryDef,
  partsOf,
  type CategoryDef,
  type CategoryId,
  type PaletteColor,
  type WorkshopGroupId,
} from '../../content/carParts';
import { DECAL_ZONES, MAX_VINYLS, PLATE_MAX_CHARS, type ColorId, type DecalZone } from '../../core/loadout';

/**
 * THE WORKSHOP UI'S CONTRACT AND ITS PURE HELPERS: what the overlay emits (`WorkshopIntent`),
 * what it reads beyond `WorkshopHudSnapshot` (`WorkshopUiSnapshot`), and the small decisions the
 * DOM code leans on — carousel windows, labels, plate text — kept here, free of the DOM and of
 * CSS, so they can be tested under node (`tests/workshopUi.test.ts`).
 *
 * The overlay never reads `GameState` and never changes anything itself: every press becomes a
 * `WorkshopIntent`, and the integrator's controller (`src/workshop/controller.ts`) maps it onto
 * `src/sim/workshop.ts` (agent F). What comes back is the next snapshot.
 */

/* ------------------------------------------------------------------ intents */

/**
 * Everything the player can ask the workshop for. The overlay emits these from the keyboard,
 * the pad, the mouse and touch alike; nothing here is applied by the UI itself except `level`
 * bookkeeping (see `WorkshopUiLevel`).
 *
 * Top level (the group carousel — "Carrocería", "Llantas y stance", …):
 * - `group`          — move the group carousel one step (`delta` −1 / +1, wraps).
 * - `selectGroup`    — jump the group carousel to `id` (a click on a tile).
 *
 * Second level (the category carousel inside `snapshot.group`):
 * - `category`       — move the category carousel one step (Q/E, LB/RB, ←/→ on the carousel).
 *                      Also sent while INSIDE a category (Q/E, LB/RB): the rules decide whether
 *                      that leaves the open category's preview (NFSU2 does: it drops the preview).
 * - `selectCategory` — jump to `id` (a click on a tile). Does not open it.
 * - `open`           — go into the highlighted category: browsing → previewing.
 *
 * Inside a category (`snapshot.inCategory`):
 * - `option`         — move the highlighted option `delta` steps (−1/+1; ±columns on the palette
 *                      grid). The rules clamp or wrap; the UI never assumes which.
 * - `optionIndex`    — jump to option `index` (a click on a rail dot, swatch, notch or chip).
 * - `install`        — INSTALAR / PINTAR / APLICAR. Sent even when `canInstall` is false, so the
 *                      rules can answer with `workshopDenied` ('funds') and the toast shows.
 *                      Never sent for an option that is already `installed`.
 * - `plateText`      — the plate editor's text, already filtered to `[A-Z0-9 ]` and at most
 *                      `PLATE_MAX_CHARS`. Never blank (a blank plate is not sent, so a player
 *                      clearing the field to retype does not bounce back to the stock text).
 * - `layer`          — the vinyl / decal layer list (`kind: 'layers'`):
 *                        `select` a layer; `add` a new one (the rules pick its design, e.g. the
 *                        highlighted option, and its colour, `PartDef.defaultColor`); `remove`
 *                        one; set its `color` (vinyls, a `PALETTE` id); set its `zone` (decals).
 *                      The `options` rail then lists designs for the SELECTED layer and
 *                      `optionIndex` is that layer's design.
 *
 * Anywhere:
 * - `back`           — leave the open category (previewing → browsing; the preview of that
 *                      category is dropped). Only sent from inside a category: on the carousels
 *                      the UI walks back up its own levels, and at the top level it sends `exit`.
 * - `exit`           — SALIR: leave the workshop (the fade back to the street).
 * - `orbit`          — a drag on empty screen (mouse, one finger) or the right stick: turn the
 *                      showroom camera. Radians-ish (`dYaw` +right, `dPitch` +up), already
 *                      scaled; the camera rig (agent D) decides the limits and the return to the
 *                      category's shot.
 * - `level`          — the UI moved between its carousels. For the camera (an overview shot on
 *                      the group level) and for analytics; the rules can ignore it.
 */
export type WorkshopIntent =
  | { type: 'group'; delta: -1 | 1 }
  | { type: 'selectGroup'; id: WorkshopGroupId }
  | { type: 'category'; delta: -1 | 1 }
  | { type: 'selectCategory'; id: CategoryId }
  | { type: 'open' }
  | { type: 'option'; delta: number }
  | { type: 'optionIndex'; index: number }
  | { type: 'install' }
  | { type: 'plateText'; text: string }
  | { type: 'layer'; action: 'select'; index: number }
  | { type: 'layer'; action: 'add' }
  | { type: 'layer'; action: 'remove'; index: number }
  | { type: 'layer'; action: 'color'; index: number; color: ColorId }
  | { type: 'layer'; action: 'zone'; index: number; zone: DecalZone }
  | { type: 'back' }
  | { type: 'exit' }
  | { type: 'orbit'; dYaw: number; dPitch: number }
  | { type: 'level'; level: WorkshopUiLevel };

/**
 * Which of NFSU2's menus is on screen. `options` is exactly `snapshot.inCategory`; the two
 * carousel levels are the UI's own bookkeeping, because `WorkshopState` has no "choosing a
 * group" phase: `groups` shows the group carousel, `categories` the categories of
 * `snapshot.group`. A snapshot may force it with `WorkshopUiSnapshot.level`.
 */
export type WorkshopUiLevel = 'groups' | 'categories' | 'options';

/* ------------------------------------------------------------------ snapshot extension */

/** One layer of the vinyl or decal list, as the layer panel draws it. */
export interface WorkshopLayerView {
  /** The layer's design, a `PartId` of `vinyls` / `decals`. */
  id: string;
  /** The design's name, Spanish ("Rayo"). */
  label: string;
  /** Vinyls: the layer's `ColorId`. Decals: null. */
  color: ColorId | null;
  /** Decals: the layer's zone. Vinyls: null. */
  zone: DecalZone | null;
}

/**
 * What the overlay reads beyond `WorkshopHudSnapshot` (`src/core/types.ts`). Every field is
 * optional, so a plain `WorkshopHudSnapshot` renders as it is; the integrator adds these to the
 * snapshot (or to `types.ts`) when the controller can fill them.
 */
export interface WorkshopHudExtras {
  /**
   * The open `layers` category's list (vinyls bottom first, decals in any order) and which one
   * the options rail edits. Without it a `layers` category shows its designs only.
   */
  layers?: { items: readonly WorkshopLayerView[]; selected: number };
  /** Loco Mustang's current quip and a counter that ticks per line (like `GarageHudSnapshot.lineId`). */
  line?: string;
  lineId?: number;
  /** The player's name for the NFSU2 name plate bottom-left. Hidden when absent. */
  playerName?: string;
  /** Forces the UI level (see `WorkshopUiLevel`); absent = the UI tracks it itself. */
  level?: WorkshopUiLevel;
}

export type WorkshopUiSnapshot = WorkshopHudSnapshot & WorkshopHudExtras;

/* ------------------------------------------------------------------ carousel */

/** `i` wrapped into `0..n-1` (n > 0). */
export function wrapIndex(i: number, n: number): number {
  if (n <= 0) return 0;
  return ((i % n) + n) % n;
}

/** Signed shortest step from `from` to `to` on a ring of `n` (for the slide direction). */
export function ringDelta(from: number, to: number, n: number): number {
  if (n <= 0 || from === to) return 0;
  let d = wrapIndex(to - from, n);
  if (d > n / 2) d -= n;
  return d;
}

/** Where the progress rail's dot sits, 0..1, for item `index` of `count`. */
export function railFraction(index: number, count: number): number {
  if (count <= 1) return 0;
  return Math.min(1, Math.max(0, index / (count - 1)));
}

/* ------------------------------------------------------------------ labels */

const groupIndex = new Map(GROUPS.map((g, i) => [g.id, i]));

export function groupLabel(id: WorkshopGroupId): string {
  return GROUPS[groupIndex.get(id) ?? 0]?.label ?? id;
}

export function groupIconKey(id: WorkshopGroupId): string {
  return GROUPS[groupIndex.get(id) ?? 0]?.icon ?? id;
}

/** Money as the rest of the HUD writes it: `¥12,340` (`passengerOverlay.formatYen`). */
export function formatMoney(value: number): string {
  return `¥${Math.max(0, Math.round(value)).toLocaleString('en-US')}`;
}

/** The verb on the INSTALL button for a category. */
export function installVerb(def: CategoryDef): string {
  if (def.kind === 'layers') return 'APLICAR';
  if (def.group === 'paint' || def.id === 'rimColor') return 'PINTAR';
  if (def.id === 'plate') return 'GRABAR';
  return 'INSTALAR';
}

/** The denial toast: a shout and a line under it. `short` is how much money is missing. */
export function denyMessage(reason: WorkshopDenyReason, short = 0): { title: string; sub: string } {
  switch (reason) {
    case 'funds':
      return { title: 'SIN PLATA', sub: short > 0 ? `Te faltan ${formatMoney(short)}. Salí a laburar, loco.` : 'No te alcanza, loco.' };
    case 'locked':
      return { title: 'AUTO OCUPADO', sub: 'Terminá lo que estás haciendo primero.' };
    case 'police':
      return { title: 'CON LA YUTA ENCIMA, NO', sub: 'Perdelos y volvé.' };
    case 'race':
      return { title: 'SOLO EN CALLE LIBRE', sub: 'El taller no abre en carrera.' };
    case 'invalid':
      return { title: 'NO DISPONIBLE', sub: 'Esa pieza ya no está en el catálogo.' };
  }
}

/** What the name bar prints for a step option: signed, with today's car called "de fábrica". */
export function stepLabel(value: number): string {
  if (value === 0) return '0';
  return value > 0 ? `+${value}` : `−${Math.abs(value)}`;
}

const FINISH_LABELS: Record<string, string> = {
  gloss: 'Brillante',
  metallic: 'Metalizado',
  pearl: 'Perlado',
  matte: 'Mate',
  chrome: 'Cromado',
};

/** Spanish name of a paint finish id, for when the snapshot's label is the raw id. */
export function finishLabel(id: string): string {
  return FINISH_LABELS[id] ?? id;
}

export const ZONE_LABELS: Record<DecalZone, string> = {
  hood: 'Capot',
  roof: 'Techo',
  trunk: 'Baúl',
  sideLeft: 'Lateral izq.',
  sideRight: 'Lateral der.',
  rearQuarterLeft: 'Cola izq.',
  rearQuarterRight: 'Cola der.',
  windshield: 'Parabrisas',
};

/** The next decal zone after `zone`, `delta` steps round the list. */
export function cycleZone(zone: DecalZone, delta: number): DecalZone {
  const i = DECAL_ZONES.indexOf(zone);
  return DECAL_ZONES[wrapIndex((i < 0 ? 0 : i) + delta, DECAL_ZONES.length)];
}

/** How many layers a `layers` category holds. */
export function maxLayers(category: CategoryId): number {
  return category === 'decals' ? DECAL_ZONES.length : MAX_VINYLS;
}

/* ------------------------------------------------------------------ palette */

const paletteById = new Map<string, PaletteColor>(PALETTE.map((c) => [c.id, c]));

/**
 * The CSS background for a colour option: the swatch, split diagonally with the accent where
 * the palette has one (the stock `rayo` neon is cyan and magenta), a slash for `off` / `none`.
 */
export function swatchBackground(value: string | number, swatch: string | null): string {
  const def = typeof value === 'string' ? paletteById.get(value) : undefined;
  const base = swatch ?? def?.hex ?? null;
  if (!base) return 'none';
  if (def?.accent) return `linear-gradient(135deg, ${base} 0 50%, ${def.accent} 50% 100%)`;
  return base;
}

export function paletteColor(id: string | null | undefined): PaletteColor | undefined {
  return id ? paletteById.get(id) : undefined;
}

/* ------------------------------------------------------------------ rating */

/**
 * The best visual rating a car can wear: the top part of every single-choice part category,
 * plus a full stack of the best vinyl and a decal in every zone. The meter's full scale; the
 * rules' `loadoutRating` sums the same parts (`src/core/loadout.ts`).
 */
export function maxLoadoutRating(): number {
  const best = (cat: CategoryId): number => partsOf(cat).reduce((m, p) => Math.max(m, p.rating), 0);
  let sum = 0;
  for (const c of CATEGORIES) {
    if (c.kind === 'part') sum += best(c.id);
  }
  sum += best('vinyls') * MAX_VINYLS;
  sum += best('decals') * DECAL_ZONES.length;
  return Math.max(1, sum);
}

/* ------------------------------------------------------------------ plate */

const PLATE_STRIP = /[^A-Z0-9 ]/g;

/**
 * What the plate field keeps of what was typed: accents stripped, upper case, `[A-Z0-9 ]`,
 * at most `PLATE_MAX_CHARS`. Unlike `sanitizePlateText` it may return '' (mid-edit).
 */
export function filterPlateInput(raw: string): string {
  return raw
    .slice(0, 64)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(PLATE_STRIP, '')
    .slice(0, PLATE_MAX_CHARS);
}

/**
 * The plate as it is printed on the Mercosur preview: `AB123CD` → `AB 123 CD`; anything that
 * is not the two-three-two pattern prints as typed.
 */
export function formatPlate(text: string): string {
  const t = text.trim();
  const m = /^([A-Z]{2})\s?(\d{3})\s?([A-Z]{2})$/.exec(t);
  return m ? `${m[1]} ${m[2]} ${m[3]}` : t;
}

/* ------------------------------------------------------------------ keyboard */

/** What a key does in the workshop, before the level decides what that means. */
export type WorkshopKeyAction =
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'prevCategory'
  | 'nextCategory'
  | 'confirm'
  | 'back'
  | 'exit'
  | 'layerAdd'
  | 'layerRemove'
  | 'colorPrev'
  | 'colorNext';

/** `KeyboardEvent.code` → action. Arrows and WASD both move; Q/E are LB/RB. */
export function keyAction(code: string): WorkshopKeyAction | null {
  switch (code) {
    case 'ArrowLeft':
    case 'KeyA':
      return 'left';
    case 'ArrowRight':
    case 'KeyD':
      return 'right';
    case 'ArrowUp':
    case 'KeyW':
      return 'up';
    case 'ArrowDown':
    case 'KeyS':
      return 'down';
    case 'KeyQ':
    case 'PageUp':
      return 'prevCategory';
    case 'KeyE':
    case 'PageDown':
      return 'nextCategory';
    case 'Enter':
    case 'NumpadEnter':
    case 'Space':
      return 'confirm';
    case 'Escape':
    case 'Backspace':
      return 'back';
    case 'KeyX':
      return 'exit';
    case 'Insert':
    case 'Equal':
    case 'NumpadAdd':
      return 'layerAdd';
    case 'Delete':
    case 'Minus':
    case 'NumpadSubtract':
      return 'layerRemove';
    case 'BracketLeft':
    case 'Comma':
      return 'colorPrev';
    case 'BracketRight':
    case 'Period':
      return 'colorNext';
    default:
      return null;
  }
}

/** The kind the option panel draws for a category; the plate is a `part` with a text editor. */
export type PanelKind = 'part' | 'color' | 'step' | 'finish' | 'layers' | 'plate';

export function panelKind(category: CategoryId): PanelKind {
  if (category === 'plate') return 'plate';
  return categoryDef(category).kind;
}
