import {
  PARTS,
  categoryDef,
  findPart,
  isColorId,
  isPartOf,
  stockPartId,
  type CategoryId,
  type PartDef,
} from '../content/carParts';

/**
 * WHAT THE PLAYER'S CAR WEARS: the one contract between the workshop's rules, its UI, the
 * save, the renderer and — later — the wire (`docs/GARAGE_PLAN.md` §2.1).
 *
 * EVERYTHING IS AN ID OR A BOUNDED WHOLE NUMBER. Never a free float, never an arbitrary colour:
 * a part is a `PartId` from the catalogue (`src/content/carParts.ts`), a colour is a `ColorId`
 * from its `PALETTE`, a stance setting is an integer step inside `STEP_RANGES`. That is what
 * lets a loadout be validated against the catalogue, stored in the server's save as it is, and
 * sent over a socket in a few dozen bytes (`encodeLoadout`). What a step MEANS in metres or
 * radians is the renderer's business (`src/render/scene/vehicles/wheelRig.ts`), and can be
 * retuned without touching a single save.
 *
 * TODAY'S CAR IS `STOCK_LOADOUT`. The GT wing, the carbon splitter, the wide-body skirts, the
 * five-spoke dish, the cyan/magenta neon and the shard livery (as the `vinyls.rayo` layer) are
 * all the stock choice of their category. `tests/carVisualStock.test.ts` pins the geometry the
 * renderer builds from it to what was drawn before the workshop existed.
 *
 * EVERYTHING READ IS UNTRUSTED, exactly like `progress.ts`: a save is a string a user can edit
 * and a build from last week may have written it. `sanitizeLoadout` takes anything and returns
 * a whole, valid `CarLoadout` — an unknown part falls back to stock, a number is clamped to its
 * range, a vinyl the catalogue no longer has is dropped — and it never throws.
 *
 * COSMETIC ONLY. Nothing here, and nothing that reads it, may change `VEHICLE` or anything the
 * simulation steps (`AGENTS.md`). Performance mods, when they come, get a field of their own.
 *
 * Pure: no Three.js, no DOM, no storage. Safe to import from the simulation, the UI, the
 * renderer and the tests alike.
 */

/** `<category>.<name>`, validated against `PARTS`. See `src/content/carParts.ts`. */
export type PartId = string;
/** An id of `PALETTE` in `src/content/carParts.ts`. */
export type ColorId = string;

export const PAINT_FINISHES = ['gloss', 'metallic', 'pearl', 'matte', 'chrome'] as const;
export type PaintFinish = (typeof PAINT_FINISHES)[number];

/**
 * Where a decal can go. Fixed zones, one decal each, so a decal never needs a free position
 * and the paint atlas (`paintShop.ts`) knows every region it may be asked to paint.
 */
export const DECAL_ZONES = ['hood', 'roof', 'trunk', 'sideLeft', 'sideRight', 'rearQuarterLeft', 'rearQuarterRight', 'windshield'] as const;
export type DecalZone = (typeof DECAL_ZONES)[number];

export type WheelSizeStep = -1 | 0 | 1 | 2;
export type WheelWidthStep = 0 | 1 | 2;

export interface VinylLayer {
  id: PartId;
  color: ColorId;
}

export interface DecalLayer {
  id: PartId;
  zone: DecalZone;
}

export interface CarLoadout {
  /** Format version. A future `2` gets a migration in `sanitizeLoadout`, not a new parser. */
  v: 1;
  body: {
    frontBumper: PartId;
    rearBumper: PartId;
    skirts: PartId;
    hood: PartId;
    trunk: PartId;
    spoiler: PartId;
    exhaustTips: PartId;
  };
  wheels: {
    rim: PartId;
    rimColor: ColorId;
    /** Rim diameter against tyre sidewall, 0 = today. The tyre's OUTER radius never changes. */
    size: WheelSizeStep;
    /** 0 = today's 26 cm. */
    width: WheelWidthStep;
  };
  /** Integer steps inside `STEP_RANGES`, 0 = today. Visual only: the physics never sees them. */
  stance: {
    /** Negative is lower. */
    rideHeight: number;
    /** Negative camber (tops of the wheels in), 0 = upright as today. */
    camberFront: number;
    camberRear: number;
    /** Wheels pushed out (positive) or in, per side. */
    trackFront: number;
    trackRear: number;
  };
  paint: {
    base: ColorId;
    finish: PaintFinish;
    /** A contrasting roof. Absent: the roof wears `base`. */
    roof?: ColorId;
  };
  /** Bottom first. At most `MAX_VINYLS`. */
  vinyls: VinylLayer[];
  /** At most one per zone. */
  decals: DecalLayer[];
  lights: {
    head: PartId;
    headColor: ColorId;
    tail: PartId;
    /** The underglow's resting colour; while the lightning charges it still turns cyan (D2). */
    neon: ColorId | 'off';
    interior: ColorId;
  };
  exhaustSound: PartId;
  plate: {
    /** `[A-Z0-9 ]`, at most `PLATE_MAX_CHARS`. Displayed Mercosur-style by `plate.ts`. */
    text: string;
    style: PartId;
  };
}

export const MAX_VINYLS = 4;
export const PLATE_MAX_CHARS = 7;
const PLATE_RE = /[^A-Z0-9 ]/g;

/** Every `step` category's range, inclusive. 0 is always inside and always today's car. */
export const STEP_RANGES = {
  wheelSize: { min: -1, max: 2 },
  wheelWidth: { min: 0, max: 2 },
  rideHeight: { min: -4, max: 2 },
  camberFront: { min: 0, max: 6 },
  camberRear: { min: 0, max: 8 },
  trackFront: { min: -2, max: 4 },
  trackRear: { min: -2, max: 4 },
} as const satisfies Partial<Record<CategoryId, { min: number; max: number }>>;
export type StepCategoryId = keyof typeof STEP_RANGES;

/** Deep-freeze, so the one shared stock loadout cannot be edited in place by accident. */
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) freeze(v);
    Object.freeze(value);
  }
  return value;
}

/**
 * Today's car. FROZEN: never mutate it — take `stockLoadout()` for a copy to edit. Frozen
 * objects throw on assignment in module code, which is how a stray `loadout.body.hood = …` on
 * the shared stock gets caught in a test instead of repainting every car on the street.
 */
export const STOCK_LOADOUT: CarLoadout = freeze({
  v: 1,
  body: {
    frontBumper: 'frontBumper.stock',
    rearBumper: 'rearBumper.stock',
    skirts: 'skirts.stock',
    hood: 'hood.stock',
    trunk: 'trunk.stock',
    spoiler: 'spoiler.stock',
    exhaustTips: 'exhaustTips.stock',
  },
  wheels: { rim: 'rims.stock', rimColor: 'graphite', size: 0, width: 0 },
  stance: { rideHeight: 0, camberFront: 0, camberRear: 0, trackFront: 0, trackRear: 0 },
  paint: { base: 'midnight', finish: 'metallic' },
  vinyls: [{ id: 'vinyls.rayo', color: 'magenta' }],
  decals: [],
  lights: { head: 'headlights.stock', headColor: 'xenon', tail: 'taillights.stock', neon: 'rayo', interior: 'rayo' },
  exhaustSound: 'exhaustSound.stock',
  plate: { text: 'BANDIDO', style: 'plate.stock' },
} satisfies CarLoadout);

/** A fresh, mutable copy of the stock car. */
export function stockLoadout(): CarLoadout {
  return cloneLoadout(STOCK_LOADOUT);
}

/** A deep copy that shares nothing with `l`. */
export function cloneLoadout(l: CarLoadout): CarLoadout {
  return {
    v: 1,
    body: { ...l.body },
    wheels: { ...l.wheels },
    stance: { ...l.stance },
    paint: l.paint.roof !== undefined ? { base: l.paint.base, finish: l.paint.finish, roof: l.paint.roof } : { base: l.paint.base, finish: l.paint.finish },
    vinyls: l.vinyls.map((layer) => ({ ...layer })),
    decals: l.decals.map((layer) => ({ ...layer })),
    lights: { ...l.lights },
    exhaustSound: l.exhaustSound,
    plate: { ...l.plate },
  };
}

/* ------------------------------------------------------------------ sanitizing */

type Rec = Record<string, unknown>;
const rec = (value: unknown): Rec => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Rec) : {});

const partOr = (category: CategoryId, id: unknown): PartId => (isPartOf(category, id) ? id : stockPartId(category));
const colorOr = (id: unknown, fallback: ColorId): ColorId => (isColorId(id) ? id : fallback);

function stepOr(category: StepCategoryId, value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  if (!Number.isFinite(n)) return 0;
  const { min, max } = STEP_RANGES[category];
  return Math.min(max, Math.max(min, Math.round(n)));
}

/**
 * Plate text made safe: accents stripped (`Ñ` → `N`), upper case, `[A-Z0-9 ]` only, at most
 * 7 characters; blank → stock.
 */
export function sanitizePlateText(value: unknown): string {
  if (typeof value !== 'string') return STOCK_LOADOUT.plate.text;
  const text = value
    .slice(0, 64)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(PLATE_RE, '')
    .slice(0, PLATE_MAX_CHARS);
  return text.trim() === '' ? STOCK_LOADOUT.plate.text : text;
}

function sanitizeVinyls(value: unknown): VinylLayer[] {
  if (!Array.isArray(value)) return STOCK_LOADOUT.vinyls.map((layer) => ({ ...layer }));
  const out: VinylLayer[] = [];
  for (const raw of value) {
    if (out.length >= MAX_VINYLS) break;
    const r = rec(raw);
    // A vinyl the catalogue no longer sells is dropped rather than turned into another one.
    if (!isPartOf('vinyls', r.id)) continue;
    const def = findPart(r.id) as PartDef;
    out.push({ id: r.id, color: colorOr(r.color, def.defaultColor ?? STOCK_LOADOUT.vinyls[0].color) });
  }
  return out;
}

function sanitizeDecals(value: unknown): DecalLayer[] {
  if (!Array.isArray(value)) return [];
  const out: DecalLayer[] = [];
  const taken = new Set<string>();
  for (const raw of value) {
    const r = rec(raw);
    if (!isPartOf('decals', r.id)) continue;
    if (typeof r.zone !== 'string' || !(DECAL_ZONES as readonly string[]).includes(r.zone) || taken.has(r.zone)) continue;
    taken.add(r.zone);
    out.push({ id: r.id, zone: r.zone as DecalZone });
    if (out.length >= DECAL_ZONES.length) break;
  }
  return out;
}

/**
 * Anything in, a whole valid `CarLoadout` out. Never throws, never returns anything that
 * shares an object with its input or with `STOCK_LOADOUT`.
 *
 * - an unknown or wrong-category part id → that category's `.stock`
 * - an unknown colour → the stock car's colour for that field
 * - a step → rounded and clamped to `STEP_RANGES`; not a number → 0
 * - vinyls → unknown ids dropped, at most `MAX_VINYLS`; not an array → the stock layer
 * - decals → unknown ids or zones dropped, one per zone
 * - plate text → `sanitizePlateText`
 * - `v` other than 1 → read as 1 (there is no other version yet)
 */
export function sanitizeLoadout(value: unknown): CarLoadout {
  const r = rec(value);
  const body = rec(r.body);
  const wheels = rec(r.wheels);
  const stance = rec(r.stance);
  const paint = rec(r.paint);
  const lights = rec(r.lights);
  const plate = rec(r.plate);
  const S = STOCK_LOADOUT;

  const finish = (PAINT_FINISHES as readonly unknown[]).includes(paint.finish) ? (paint.finish as PaintFinish) : S.paint.finish;
  const out: CarLoadout = {
    v: 1,
    body: {
      frontBumper: partOr('frontBumper', body.frontBumper),
      rearBumper: partOr('rearBumper', body.rearBumper),
      skirts: partOr('skirts', body.skirts),
      hood: partOr('hood', body.hood),
      trunk: partOr('trunk', body.trunk),
      spoiler: partOr('spoiler', body.spoiler),
      exhaustTips: partOr('exhaustTips', body.exhaustTips),
    },
    wheels: {
      rim: partOr('rims', wheels.rim),
      rimColor: colorOr(wheels.rimColor, S.wheels.rimColor),
      size: stepOr('wheelSize', wheels.size) as WheelSizeStep,
      width: stepOr('wheelWidth', wheels.width) as WheelWidthStep,
    },
    stance: {
      rideHeight: stepOr('rideHeight', stance.rideHeight),
      camberFront: stepOr('camberFront', stance.camberFront),
      camberRear: stepOr('camberRear', stance.camberRear),
      trackFront: stepOr('trackFront', stance.trackFront),
      trackRear: stepOr('trackRear', stance.trackRear),
    },
    paint: { base: colorOr(paint.base, S.paint.base), finish },
    vinyls: sanitizeVinyls(r.vinyls),
    decals: sanitizeDecals(r.decals),
    lights: {
      head: partOr('headlights', lights.head),
      headColor: colorOr(lights.headColor, S.lights.headColor),
      tail: partOr('taillights', lights.tail),
      neon: lights.neon === 'off' ? 'off' : colorOr(lights.neon, S.lights.neon as ColorId),
      interior: colorOr(lights.interior, S.lights.interior),
    },
    exhaustSound: partOr('exhaustSound', r.exhaustSound),
    plate: { text: sanitizePlateText(plate.text), style: partOr('plate', plate.style) },
  };
  if (isColorId(paint.roof)) out.paint.roof = paint.roof;
  return out;
}

/** Whether two loadouts dress the car identically. */
export function loadoutsEqual(a: CarLoadout, b: CarLoadout): boolean {
  return encodeLoadout(a) === encodeLoadout(b);
}

/* ------------------------------------------------------------ one category at a time */

/** Every category that holds a single value (all but the two layer lists). */
export type ScalarCategoryId = Exclude<CategoryId, 'vinyls' | 'decals'>;

/**
 * What `l` has chosen in one category: a `PartId` for `part` categories, a `ColorId` (or
 * `'off'` for neon, `'none'` for a roof that wears the body colour) for `color` ones, the step
 * for `step` ones, the finish for `finish`. The UI highlights it; the rules compare it.
 */
export function getChoice(l: CarLoadout, category: ScalarCategoryId): string | number {
  switch (category) {
    case 'frontBumper':
    case 'rearBumper':
    case 'skirts':
    case 'hood':
    case 'trunk':
    case 'spoiler':
    case 'exhaustTips':
      return l.body[category];
    case 'rims':
      return l.wheels.rim;
    case 'rimColor':
      return l.wheels.rimColor;
    case 'wheelSize':
      return l.wheels.size;
    case 'wheelWidth':
      return l.wheels.width;
    case 'rideHeight':
    case 'camberFront':
    case 'camberRear':
    case 'trackFront':
    case 'trackRear':
      return l.stance[category];
    case 'paint':
      return l.paint.base;
    case 'roofColor':
      return l.paint.roof ?? 'none';
    case 'finish':
      return l.paint.finish;
    case 'headlights':
      return l.lights.head;
    case 'headlightColor':
      return l.lights.headColor;
    case 'taillights':
      return l.lights.tail;
    case 'neon':
      return l.lights.neon;
    case 'interiorLight':
      return l.lights.interior;
    case 'exhaustSound':
      return l.exhaustSound;
    case 'plate':
      return l.plate.style;
  }
}

/** Whether `value` is a legal choice in `category`, by the same rules `sanitizeLoadout` applies. */
export function isValidChoice(category: ScalarCategoryId, value: unknown): boolean {
  const kind = categoryDef(category).kind;
  if (kind === 'part') return isPartOf(category, value);
  if (kind === 'finish') return (PAINT_FINISHES as readonly unknown[]).includes(value);
  if (kind === 'step') {
    const range = STEP_RANGES[category as StepCategoryId];
    return typeof value === 'number' && Number.isInteger(value) && value >= range.min && value <= range.max;
  }
  // color
  if (category === 'neon' && value === 'off') return true;
  if (category === 'roofColor' && value === 'none') return true;
  return isColorId(value);
}

/**
 * A copy of `l` with one category changed. An illegal `value` changes nothing (the copy is
 * returned as it was) — the caller asks `isValidChoice` first if it needs to know. Allocates;
 * called on a key press in the workshop, never per frame.
 */
export function setChoice(l: CarLoadout, category: ScalarCategoryId, value: string | number): CarLoadout {
  const next = cloneLoadout(l);
  if (!isValidChoice(category, value)) return next;
  switch (category) {
    case 'frontBumper':
    case 'rearBumper':
    case 'skirts':
    case 'hood':
    case 'trunk':
    case 'spoiler':
    case 'exhaustTips':
      next.body[category] = value as PartId;
      break;
    case 'rims':
      next.wheels.rim = value as PartId;
      break;
    case 'rimColor':
      next.wheels.rimColor = value as ColorId;
      break;
    case 'wheelSize':
      next.wheels.size = value as WheelSizeStep;
      break;
    case 'wheelWidth':
      next.wheels.width = value as WheelWidthStep;
      break;
    case 'rideHeight':
    case 'camberFront':
    case 'camberRear':
    case 'trackFront':
    case 'trackRear':
      next.stance[category] = value as number;
      break;
    case 'paint':
      next.paint.base = value as ColorId;
      break;
    case 'roofColor':
      if (value === 'none') delete next.paint.roof;
      else next.paint.roof = value as ColorId;
      break;
    case 'finish':
      next.paint.finish = value as PaintFinish;
      break;
    case 'headlights':
      next.lights.head = value as PartId;
      break;
    case 'headlightColor':
      next.lights.headColor = value as ColorId;
      break;
    case 'taillights':
      next.lights.tail = value as PartId;
      break;
    case 'neon':
      next.lights.neon = value as ColorId | 'off';
      break;
    case 'interiorLight':
      next.lights.interior = value as ColorId;
      break;
    case 'exhaustSound':
      next.exhaustSound = value as PartId;
      break;
    case 'plate':
      next.plate.style = value as PartId;
      break;
  }
  return next;
}

/** A copy of `l` wearing `layers` as its vinyls, sanitized (unknown ids dropped, at most 4). */
export function setVinyls(l: CarLoadout, layers: readonly VinylLayer[]): CarLoadout {
  const next = cloneLoadout(l);
  next.vinyls = sanitizeVinyls(layers);
  return next;
}

/** A copy of `l` wearing `layers` as its decals, sanitized (unknown dropped, one per zone). */
export function setDecals(l: CarLoadout, layers: readonly DecalLayer[]): CarLoadout {
  const next = cloneLoadout(l);
  next.decals = sanitizeDecals(layers);
  return next;
}

/** A copy of `l` with new plate text, sanitized. */
export function setPlateText(l: CarLoadout, text: string): CarLoadout {
  const next = cloneLoadout(l);
  next.plate.text = sanitizePlateText(text);
  return next;
}

/**
 * Every part id `l` wears, stock included: what "owned" has to cover for a loadout to be
 * wearable, and what `loadoutRating` sums over.
 */
export function loadoutPartIds(l: CarLoadout): PartId[] {
  return [
    l.body.frontBumper,
    l.body.rearBumper,
    l.body.skirts,
    l.body.hood,
    l.body.trunk,
    l.body.spoiler,
    l.body.exhaustTips,
    l.wheels.rim,
    ...l.vinyls.map((layer) => layer.id),
    ...l.decals.map((layer) => layer.id),
    l.lights.head,
    l.lights.tail,
    l.exhaustSound,
    l.plate.style,
  ];
}

/** The car's visual rating: the sum of what it wears (D5). Shown as a number for now. */
export function loadoutRating(l: CarLoadout): number {
  let sum = 0;
  for (const id of loadoutPartIds(l)) sum += findPart(id)?.rating ?? 0;
  return sum;
}

/* ------------------------------------------------------------------ compact code */

/*
 * THE COMPACT CODE. One line of printable ASCII, for the save's jsonb column if it wants it,
 * a debug URL, and later the `hello` message (Ola 4). Fields are `|`-separated in a fixed order;
 * a part is written without its category prefix (`frontBumper.stock` → `stock`), which is safe
 * because catalogue names are `[a-z0-9-]`. Vinyls are `id:colour` joined by `,`, decals
 * `id@zone` joined by `,`. The plate text is last and is `[A-Z0-9 ]`, so it can hold no
 * separator. `L1` leads, so a future format is told apart at the first two characters.
 *
 * Decoding goes through `sanitizeLoadout`, so a code from another build — or a hand-typed one —
 * decodes to the nearest valid car and never throws.
 */
const CODE_PREFIX = 'L1';
const FINISH_CODES: Record<PaintFinish, string> = { gloss: 'g', metallic: 'm', pearl: 'p', matte: 't', chrome: 'c' };

const short = (id: PartId): string => id.slice(id.indexOf('.') + 1);
const full = (category: CategoryId, name: string): PartId => `${category}.${name}`;

export function encodeLoadout(l: CarLoadout): string {
  const fields: Array<string | number> = [
    CODE_PREFIX,
    short(l.body.frontBumper),
    short(l.body.rearBumper),
    short(l.body.skirts),
    short(l.body.hood),
    short(l.body.trunk),
    short(l.body.spoiler),
    short(l.body.exhaustTips),
    short(l.wheels.rim),
    l.wheels.rimColor,
    l.wheels.size,
    l.wheels.width,
    l.stance.rideHeight,
    l.stance.camberFront,
    l.stance.camberRear,
    l.stance.trackFront,
    l.stance.trackRear,
    l.paint.base,
    FINISH_CODES[l.paint.finish],
    l.paint.roof ?? '',
    l.vinyls.map((layer) => `${short(layer.id)}:${layer.color}`).join(','),
    l.decals.map((layer) => `${short(layer.id)}@${layer.zone}`).join(','),
    short(l.lights.head),
    l.lights.headColor,
    short(l.lights.tail),
    l.lights.neon,
    l.lights.interior,
    short(l.exhaustSound),
    short(l.plate.style),
    l.plate.text,
  ];
  return fields.join('|');
}

/** The inverse of `encodeLoadout`. Anything else — garbage, null, an older code — sanitizes. */
export function decodeLoadout(code: unknown): CarLoadout {
  if (typeof code !== 'string' || code.length > 1024) return stockLoadout();
  const f = code.split('|');
  if (f[0] !== CODE_PREFIX || f.length !== 30) return stockLoadout();
  const finish = (Object.keys(FINISH_CODES) as PaintFinish[]).find((k) => FINISH_CODES[k] === f[18]);
  const num = (s: string): number => (s === '' ? NaN : Number(s));
  return sanitizeLoadout({
    v: 1,
    body: {
      frontBumper: full('frontBumper', f[1]),
      rearBumper: full('rearBumper', f[2]),
      skirts: full('skirts', f[3]),
      hood: full('hood', f[4]),
      trunk: full('trunk', f[5]),
      spoiler: full('spoiler', f[6]),
      exhaustTips: full('exhaustTips', f[7]),
    },
    wheels: { rim: full('rims', f[8]), rimColor: f[9], size: num(f[10]), width: num(f[11]) },
    stance: { rideHeight: num(f[12]), camberFront: num(f[13]), camberRear: num(f[14]), trackFront: num(f[15]), trackRear: num(f[16]) },
    paint: { base: f[17], finish, roof: f[19] === '' ? undefined : f[19] },
    vinyls: f[20] === '' ? [] : f[20].split(',').map((s) => {
      const [name, color] = s.split(':');
      return { id: full('vinyls', name), color };
    }),
    decals: f[21] === '' ? [] : f[21].split(',').map((s) => {
      const [name, zone] = s.split('@');
      return { id: full('decals', name), zone };
    }),
    lights: { head: full('headlights', f[22]), headColor: f[23], tail: full('taillights', f[24]), neon: f[25], interior: f[26] },
    exhaustSound: full('exhaustSound', f[27]),
    plate: { style: full('plate', f[28]), text: f[29] },
  });
}

/** Every stock part the catalogue must carry for `STOCK_LOADOUT` to be wearable. For tests. */
export function stockPartsMissing(): PartId[] {
  return loadoutPartIds(STOCK_LOADOUT).filter((id) => !PARTS.some((p) => p.id === id));
}
