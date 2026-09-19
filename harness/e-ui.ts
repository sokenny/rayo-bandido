/**
 * Harness for agent E (the workshop UI): mounts `createWorkshopOverlay` over a painted stand-in
 * for the showroom and drives it with a small mock of the rules, so every category kind can be
 * clicked, typed and screenshotted without the game, the showroom or `sim/workshop.ts`.
 *
 * The mock is deliberately NOT the rules: it invents a few parts per category (the real
 * catalogue only has the stock ones until the Ola 1 agents land), charges on INSTALL, refuses
 * when the money is short and ticks the counters the overlay watches. Intents are logged
 * (`?log=1`).
 *
 * URL: `/harness/e-ui.html?scene=<name>` jumps straight to a state (see SCENES), for
 * `scripts/harness-shots-e.mjs`. `window.__ws` exposes the mock for puppeteer.
 */
import '../src/styles.css';
import { CATEGORIES, GROUPS, PALETTE, categoriesOf, categoryDef, type CategoryId, type WorkshopGroupId } from '../src/content/carParts';
import { DECAL_ZONES, MAX_VINYLS, PAINT_FINISHES, STEP_RANGES, type DecalZone, type StepCategoryId } from '../src/core/loadout';
import type { WorkshopOptionView } from '../src/core/types';
import { createWorkshopOverlay } from '../src/ui/workshop';
import type { WorkshopIntent, WorkshopLayerView, WorkshopUiSnapshot } from '../src/ui/workshop/model';
import { workshopIcon } from '../src/ui/workshop/icons';

document.getElementById('car')!.innerHTML = workshopIcon('body');

/* ------------------------------------------------------------------ invented parts */

interface MockPart {
  value: string;
  label: string;
  price: number;
  rating: number;
}

const NAMES: Partial<Record<CategoryId, string[]>> = {
  frontBumper: ['De fábrica', 'Labio Street', 'Splitter N1', 'Aero Kaido', 'Bōsōzoku', 'Canard GT'],
  rearBumper: ['De fábrica', 'Difusor Track', 'Valance liso', 'Kaido doble'],
  skirts: ['De fábrica', 'Lisas', 'Aero N1', 'Wide-body 2'],
  hood: ['De fábrica', 'Liso', 'Toma central', 'Carbono ventilado', 'Bulge'],
  trunk: ['De fábrica', 'Ducktail', 'Carbono'],
  spoiler: ['GT', 'Ninguno', 'Lip', 'Ducktail', 'GT alto doble plano'],
  rims: ['5 rayos', 'Multi-rayo', 'Malla 8', 'Dish profundo', '6 dobles', 'Turbofan'],
  headlights: ['De fábrica', 'Proyector', 'Ojo de ángel', 'Tira LED'],
  taillights: ['De fábrica', 'Barra', 'Anillos', 'Humo'],
  exhaustTips: ['Doble redondo', 'Cañón', 'Cuádruple', 'Lateral'],
  exhaustSound: ['De fábrica', 'Rugido', 'Rotativo', 'Straight pipe'],
  plate: ['Lisa', 'Mercosur vieja', 'Negra JDM', 'Carbono'],
  vinyls: ['Rayo', 'Llamas', 'Tribal', 'Franjas', 'Kanji', 'Relámpago'],
  decals: ['Estrella', 'Kanji 走', 'Sponsor', 'Grafiti'],
};

function partsFor(cat: CategoryId): MockPart[] {
  const names = NAMES[cat] ?? ['De fábrica'];
  return names.map((label, i) => ({
    value: `${cat}.${i === 0 && categoryDef(cat).kind === 'part' ? 'stock' : label.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
    label,
    price: i === 0 ? 0 : 900 + i * 1350,
    rating: i === 0 ? 1 : Math.min(10, 2 + i),
  }));
}

/* ------------------------------------------------------------------ the mock rules */

interface Layer {
  id: string;
  color: string | null;
  zone: DecalZone | null;
}

const state = {
  open: true,
  group: 'body' as WorkshopGroupId,
  category: 'frontBumper' as CategoryId,
  inCategory: false,
  optionIndex: 0,
  money: 18450,
  installed: new Map<CategoryId, string | number>(),
  owned: new Set<string>(),
  layers: new Map<CategoryId, { items: Layer[]; selected: number }>([
    ['vinyls', { items: [{ id: 'vinyls.rayo', color: 'magenta', zone: null }], selected: 0 }],
    ['decals', { items: [], selected: 0 }],
  ]),
  plateText: 'BANDIDO',
  lastDenied: null as WorkshopUiSnapshot['lastDenied'],
  deniedId: 0,
  purchaseId: 0,
  line: '',
  lineId: 0,
  fade: 0,
};

function valuesOf(cat: CategoryId): Array<{ value: string | number; label: string; price: number; rating: number; swatch: string | null }> {
  const def = categoryDef(cat);
  if (def.kind === 'part' || def.kind === 'layers') return partsFor(cat).map((p) => ({ ...p, swatch: null }));
  if (def.kind === 'color') {
    const list = PALETTE.map((c) => ({ value: c.id as string | number, label: c.name, price: def.price, rating: 0, swatch: c.hex as string | null }));
    if (cat === 'neon') list.unshift({ value: 'off', label: 'Apagado', price: def.price, rating: 0, swatch: null });
    if (cat === 'roofColor') list.unshift({ value: 'none', label: 'Igual a la carrocería', price: def.price, rating: 0, swatch: null });
    return list;
  }
  if (def.kind === 'step') {
    const r = STEP_RANGES[cat as StepCategoryId];
    const out = [];
    for (let v = r.min; v <= r.max; v++) out.push({ value: v, label: v > 0 ? `+${v}` : String(v), price: def.price, rating: 0, swatch: null });
    return out;
  }
  return PAINT_FINISHES.map((f) => ({ value: f, label: { gloss: 'Brillante', metallic: 'Metalizado', pearl: 'Perlado', matte: 'Mate', chrome: 'Cromado' }[f], price: def.price, rating: 0, swatch: null }));
}

function stockValue(cat: CategoryId): string | number {
  const def = categoryDef(cat);
  if (def.kind === 'step') return 0;
  if (def.kind === 'finish') return 'metallic';
  if (def.kind === 'color') return ({ paint: 'midnight', rimColor: 'graphite', headlightColor: 'xenon', neon: 'rayo', interiorLight: 'rayo', roofColor: 'none' } as Record<string, string>)[cat] ?? 'white';
  return valuesOf(cat)[0].value;
}

function installedValue(cat: CategoryId): string | number {
  return state.installed.get(cat) ?? stockValue(cat);
}

function currentLayer(): Layer | undefined {
  const l = state.layers.get(state.category);
  return l?.items[l.selected];
}

function options(): WorkshopOptionView[] {
  const def = categoryDef(state.category);
  const inst = def.kind === 'layers' ? currentLayer()?.id : installedValue(state.category);
  return valuesOf(state.category).map((v) => {
    const owned = def.kind === 'part' || def.kind === 'layers' ? v.price === 0 || state.owned.has(String(v.value)) : false;
    return { value: v.value, label: v.label, price: owned ? 0 : v.price, owned, installed: v.value === inst, swatch: v.swatch, rating: v.rating };
  });
}

function rating(preview: boolean): number {
  let sum = 0;
  for (const c of CATEGORIES) {
    if (c.kind !== 'part') continue;
    const v = preview && state.inCategory && c.id === state.category ? valuesOf(c.id)[state.optionIndex]?.value : installedValue(c.id);
    sum += partsFor(c.id).find((p) => p.value === v)?.rating ?? 0;
  }
  for (const l of state.layers.get('vinyls')!.items) sum += partsFor('vinyls').find((p) => p.value === l.id)?.rating ?? 0;
  return sum;
}

function snapshot(): WorkshopUiSnapshot {
  const opts = state.inCategory ? options() : [];
  const o = opts[state.optionIndex];
  const installPrice = o && !o.installed ? o.price : 0;
  const lay = state.layers.get(state.category);
  const partsOfCat = categoryDef(state.category).kind === 'layers' ? partsFor(state.category) : [];
  const layers =
    state.inCategory && lay
      ? {
          items: lay.items.map<WorkshopLayerView>((l) => ({ id: l.id, label: partsOfCat.find((p) => p.value === l.id)?.label ?? l.id, color: l.color, zone: l.zone })),
          selected: lay.selected,
        }
      : undefined;
  return {
    open: state.open,
    phase: state.inCategory ? 'previewing' : 'browsing',
    fade: state.fade,
    shopId: 'loco-mustang',
    shopName: 'Taller del Loco Mustang',
    money: state.money,
    group: state.group,
    categories: categoriesOf(state.group).map((c) => c.id),
    category: state.category,
    inCategory: state.inCategory,
    options: opts,
    optionIndex: state.optionIndex,
    installPrice,
    canInstall: !!o && !o.installed && installPrice <= state.money,
    rating: rating(false),
    previewRating: rating(true),
    plateText: state.plateText,
    lastDenied: state.lastDenied,
    deniedId: state.deniedId,
    purchaseId: state.purchaseId,
    layers,
    line: state.line,
    lineId: state.lineId,
    playerName: 'Juan',
  };
}

function openCategoryIndex(): number {
  const def = categoryDef(state.category);
  const vals = valuesOf(state.category);
  const cur = def.kind === 'layers' ? currentLayer()?.id : installedValue(state.category);
  return Math.max(0, vals.findIndex((v) => v.value === cur));
}

function wrap(i: number, n: number): number {
  return ((i % n) + n) % n;
}

const QUIPS = ['¡Eso, loco! Ahora sí tiene cara de auto.', 'Te lo dejo volando, hermano.', 'Mirá ese brillo. Una joya.'];

function apply(intent: WorkshopIntent): void {
  const cats = categoriesOf(state.group).map((c) => c.id);
  switch (intent.type) {
    case 'group':
    case 'selectGroup': {
      const i = GROUPS.findIndex((g) => g.id === state.group);
      const next = intent.type === 'group' ? GROUPS[wrap(i + intent.delta, GROUPS.length)] : GROUPS.find((g) => g.id === intent.id)!;
      state.group = next.id;
      state.category = categoriesOf(next.id)[0].id;
      break;
    }
    case 'category':
    case 'selectCategory': {
      const i = cats.indexOf(state.category);
      state.category = intent.type === 'category' ? cats[wrap(i + intent.delta, cats.length)] : intent.id;
      if (state.inCategory) state.optionIndex = openCategoryIndex();
      break;
    }
    case 'open':
      state.inCategory = true;
      state.optionIndex = openCategoryIndex();
      break;
    case 'option': {
      const n = valuesOf(state.category).length;
      state.optionIndex = wrap(state.optionIndex + intent.delta, n);
      layerPreview();
      break;
    }
    case 'optionIndex':
      state.optionIndex = intent.index;
      layerPreview();
      break;
    case 'install': {
      const o = options()[state.optionIndex];
      if (!o || o.installed) break;
      if (o.price > state.money) {
        state.lastDenied = 'funds';
        state.deniedId++;
        break;
      }
      state.money -= o.price;
      if (categoryDef(state.category).kind !== 'layers') state.installed.set(state.category, o.value);
      if (o.price > 0 && (categoryDef(state.category).kind === 'part' || categoryDef(state.category).kind === 'layers')) state.owned.add(String(o.value));
      state.purchaseId++;
      state.line = QUIPS[state.purchaseId % QUIPS.length];
      state.lineId++;
      break;
    }
    case 'back':
      state.inCategory = false;
      break;
    case 'exit':
      state.fade = 1;
      setTimeout(() => {
        state.fade = 0;
      }, 600);
      break;
    case 'plateText':
      state.plateText = intent.text;
      break;
    case 'layer': {
      const lay = state.layers.get(state.category);
      if (!lay) break;
      if (intent.action === 'select') lay.selected = intent.index;
      else if (intent.action === 'add' && lay.items.length < (state.category === 'decals' ? DECAL_ZONES.length : MAX_VINYLS)) {
        const free = DECAL_ZONES.find((z) => !lay.items.some((l) => l.zone === z)) ?? 'hood';
        lay.items.push({ id: String(valuesOf(state.category)[state.optionIndex].value), color: state.category === 'vinyls' ? 'cyan' : null, zone: state.category === 'decals' ? free : null });
        lay.selected = lay.items.length - 1;
      } else if (intent.action === 'remove') {
        lay.items.splice(intent.index, 1);
        lay.selected = Math.max(0, Math.min(lay.selected, lay.items.length - 1));
      } else if (intent.action === 'color') lay.items[intent.index].color = intent.color;
      else if (intent.action === 'zone') lay.items[intent.index].zone = intent.zone;
      state.optionIndex = openCategoryIndex();
      break;
    }
    default:
      break;
  }
}

function layerPreview(): void {
  const lay = state.layers.get(state.category);
  const l = lay?.items[lay.selected];
  if (l) l.id = String(valuesOf(state.category)[state.optionIndex].value);
}

/* ------------------------------------------------------------------ mount */

const logEl = document.getElementById('harness-log')!;
const log: string[] = [];
if (new URLSearchParams(location.search).get('log') === '1') document.body.classList.add('show-log');

const overlay = createWorkshopOverlay({
  onIntent(intent) {
    log.push(JSON.stringify(intent));
    if (log.length > 12) log.shift();
    logEl.textContent = log.join('\n');
    apply(intent);
  },
});
document.body.appendChild(overlay.root);

/* ------------------------------------------------------------------ scenes */

type Scene = () => void;
const enter = (group: WorkshopGroupId, category: CategoryId, index?: number): void => {
  state.group = group;
  state.category = category;
  state.inCategory = true;
  state.optionIndex = index ?? openCategoryIndex();
};
const SCENES: Record<string, Scene> = {
  groups: () => {},
  categories: () => {
    state.group = 'wheels';
    state.category = 'rims';
  },
  part: () => enter('body', 'frontBumper', 2),
  owned: () => {
    state.owned.add('spoiler.lip');
    enter('body', 'spoiler', 2);
  },
  color: () => enter('paint', 'paint', 27),
  neon: () => enter('lights', 'neon', 0),
  step: () => enter('wheels', 'rideHeight', 1),
  finish: () => enter('paint', 'finish', 2),
  vinyls: () => {
    state.layers.get('vinyls')!.items.push({ id: 'vinyls.llamas', color: 'orange', zone: null }, { id: 'vinyls.kanji', color: 'white', zone: null });
    state.layers.get('vinyls')!.selected = 1;
    enter('paint', 'vinyls');
  },
  decals: () => {
    state.layers.get('decals')!.items.push({ id: 'decals.estrella', color: null, zone: 'hood' }, { id: 'decals.sponsor', color: null, zone: 'sideLeft' });
    enter('paint', 'decals');
  },
  plate: () => {
    state.plateText = 'AB123CD';
    enter('plate', 'plate', 2);
  },
  denied: () => {
    state.money = 800;
    enter('wheels', 'rims', 4);
  },
};

const sceneName = new URLSearchParams(location.search).get('scene') ?? 'groups';

// `?scene=icons`: every carousel icon on one sheet, big, for checking the drawings.
if (sceneName === 'icons') {
  const keys = [...GROUPS.map((g) => g.icon), ...CATEGORIES.map((c) => c.icon)];
  const sheet = document.createElement('div');
  sheet.style.cssText = 'position:fixed;inset:0;z-index:200;display:grid;grid-template-columns:repeat(7,1fr);gap:10px;padding:14px;background:#1a1030;overflow:auto;color:#fff;font:11px ui-monospace,monospace';
  sheet.innerHTML = keys
    .map((k) => `<div style="background:rgba(80,40,130,.5);padding:6px;text-align:center">${workshopIcon(k)}<div>${k}</div></div>`)
    .join('');
  document.body.appendChild(sheet);
}
// The overlay starts closed, opens on the first snapshot, and only then learns the scene, so a
// scene is played as the player would reach it: open, then the jump.
overlay.update({ ...snapshot(), open: false });
overlay.update(snapshot());
if (sceneName === 'categories') {
  SCENES.categories();
  overlay.update(snapshot());
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', bubbles: true }));
} else if (SCENES[sceneName]) {
  SCENES[sceneName]();
}
if (sceneName === 'denied') {
  overlay.update(snapshot());
  apply({ type: 'install' });
}
if (sceneName === 'part' || sceneName === 'color') {
  state.line = 'Ese splitter le queda pintado, loco. Probalo, que probar es gratis.';
  state.lineId++;
}

function frame(): void {
  overlay.update(snapshot());
  requestAnimationFrame(frame);
}
frame();

(window as unknown as { __ws: unknown }).__ws = { state, apply, overlay, snapshot, SCENES };
