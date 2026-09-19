import './workshop.css';
import { CATEGORIES, GROUPS, PALETTE, categoryDef, findPart, type CategoryId, type WorkshopGroupId } from '../../content/carParts';
import { DECAL_ZONES, PLATE_MAX_CHARS, type DecalZone } from '../../core/loadout';
import type { WorkshopOptionView } from '../../core/types';
import { portraitFor } from '../portraits';
import { CHEVRON, CROSS, PLUS, STAR, workshopIcon } from './icons';
import {
  cycleZone,
  denyMessage,
  filterPlateInput,
  finishLabel,
  formatMoney,
  formatPlate,
  groupIconKey,
  groupLabel,
  installVerb,
  keyAction,
  maxLayers,
  panelKind,
  railFraction,
  stepLabel,
  swatchBackground,
  wrapIndex,
  ZONE_LABELS,
  type PanelKind,
  type WorkshopIntent,
  type WorkshopKeyAction,
  type WorkshopUiLevel,
  type WorkshopUiSnapshot,
} from './model';
import { createWorkshopPad, type WorkshopPad } from './pad';

/**
 * LOCO MUSTANG'S WORKSHOP, ON SCREEN: the NFSU2 customisation screen in Rayo Bandido's colours
 * (`docs/GARAGE_PLAN.md` §2.6).
 *
 *   ┌ TALLER DEL LOCO MUSTANG ─────────────────────────────── ¥ wallet ┐
 *   │ Section title (italic condensed caps)                              │
 *   │ ───●────────────────── progress rail                               │
 *   │ ◀  [icon]  [ ICON ]  [icon]  ▶     translucent icon carousel       │
 *   │            Category name                                           │
 *   │ ▲                                              RATING VISUAL       │
 *   │ ●  option rail                                  12 ★   ┃ meter     │
 *   │ ◉                                                      ┃           │
 *   │ ▼                                                                  │
 *   │            ◀  Part name  ▶   · price · badge   [palette / slider]  │
 *   │ [Loco + quip]  [player]                  [ATRÁS] [INSTALAR] [SALIR]│
 *   └────────────────────────────────────────────────────────────────────┘
 *
 * Three levels like NFSU2: the group carousel (Carrocería, Llantas…), the category carousel of
 * that group, and inside a category the option rail / palette / slider / chips / layer list /
 * plate editor its `CategoryDef.kind` calls for.
 *
 * RENDERS A SNAPSHOT, EMITS INTENTS. It reads `WorkshopUiSnapshot` (the contract's
 * `WorkshopHudSnapshot` plus optional extras, `model.ts`) and the static catalogue, and never
 * changes anything itself: every key, button, click, tap and drag becomes a `WorkshopIntent`.
 * The only state it keeps is which carousel is up (`WorkshopUiLevel`) and the plate field
 * while it is being typed in.
 *
 * CHEAP. Built once; `update` compares against what it last wrote and touches only what
 * changed; the option widgets are rebuilt only when the category (or its option count)
 * changes. Animations are WAAPI one-shots, like `garageOverlay.ts`. `update` may be called
 * every frame; it holds on to nothing from the snapshot past the call.
 *
 * INPUT. Keys are read on `window` in the CAPTURE phase while the workshop is open and never
 * reach the game (Esc would otherwise take the player to the menu); typing on the plate goes to
 * the field and nowhere else. The pad has its own poll (`pad.ts`). A press on the overlay never
 * reaches the game's pointer binding either (no lightning charging under a menu), and a drag on
 * empty screen is an `orbit` for the showroom camera.
 */
export interface WorkshopOverlayOptions {
  onIntent(intent: WorkshopIntent): void;
  /** Where to listen for keys. Default `window` (capture phase). */
  keyTarget?: Window | HTMLElement;
  /** Poll the gamepad while open. Default true. */
  gamepad?: boolean;
}

export interface WorkshopOverlay {
  root: HTMLElement;
  update(s: WorkshopUiSnapshot): void;
  /**
   * Loco Mustang says something: his card lights up and the line shows for `seconds`. The
   * snapshot's `line`/`lineId` do the same; this is for a controller that prefers to push.
   * Voicing it (`speakDialogue`) is the caller's business.
   */
  say(text: string, seconds?: number): void;
  dispose(): void;
}

const canAnimate = typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';
const LOCO_NAME = 'LOCO MUSTANG';
const LINE_SECONDS = 4.5;
/** The rating meter's full scale: `carStars` tops out at ten. */
const RATING_SCALE = 10;
/** Pixels of drag per radian of orbit. */
const ORBIT_PX = 160;

function pick<T extends Element>(root: ParentNode, selector: string): T {
  const el = root.querySelector(selector);
  if (!el) throw new Error(`Rayo Bandido workshop overlay: missing element "${selector}"`);
  return el as T;
}

function esc(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}

const categoryLabels = new Map<string, string>(CATEGORIES.map((c) => [c.id, c.label]));

/** The mini swatch behind a finish chip: what each finish does to light, in CSS. */
const FINISH_SWATCH: Record<string, string> = {
  gloss: 'radial-gradient(circle at 32% 28%, #fff 0 8%, #b14cff 22%, #4a167f 70%, #1c0833 100%)',
  metallic: 'radial-gradient(circle at 32% 28%, #fff 0 6%, #c98cff 16%, #6a2bb8 48%, #22093f 100%), repeating-conic-gradient(rgba(255,255,255,.08) 0 3deg, transparent 3deg 6deg)',
  pearl: 'radial-gradient(circle at 32% 28%, #fff 0 8%, transparent 30%), conic-gradient(from 200deg, #ff9df0, #9df3ff, #c9a4ff, #ffd6f6, #ff9df0)',
  matte: 'radial-gradient(circle at 40% 35%, #7a45b0 0%, #4a1f7a 60%, #2a0f48 100%)',
  chrome: 'linear-gradient(170deg, #fff 0%, #cfd6e4 28%, #3a3f4b 50%, #f2f4f8 62%, #6b7384 100%)',
};

export function createWorkshopOverlay(options: WorkshopOverlayOptions): WorkshopOverlay {
  const emit = (intent: WorkshopIntent): void => options.onIntent(intent);
  // The snapshot's rating is the car's stars, 0..10 (`carStars`, `src/sim/workshop.ts`), not the
  // raw part-rating sum `maxLoadoutRating` measures: the meter's full scale is ten stars.
  const maxRating = RATING_SCALE;

  /* ------------------------------------------------------------------ markup */

  const root = document.createElement('div');
  root.className = 'rb-ws';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Taller');
  root.innerHTML =
    `<div class="rb-ws-vignette" aria-hidden="true"></div>` +
    `<header class="rb-ws-top">` +
    `<div class="rb-ws-titlebar">` +
    `<div class="rb-ws-titles"><span class="rb-ws-shop"></span><h1 class="rb-ws-title"></h1></div>` +
    `<div class="rb-ws-wallet"><span class="rb-ws-wallet__label">BILLETERA</span><b class="rb-ws-wallet__value"></b></div>` +
    `</div>` +
    `<div class="rb-ws-progress" aria-hidden="true"><i class="rb-ws-progress__dot"></i></div>` +
    `<div class="rb-ws-carousel">` +
    `<button type="button" class="rb-ws-carousel__arrow is-prev" data-act="car-prev" aria-label="Anterior">${CHEVRON}</button>` +
    `<div class="rb-ws-carousel__viewport"><div class="rb-ws-carousel__track"><div class="rb-ws-carousel__slide"></div></div></div>` +
    `<button type="button" class="rb-ws-carousel__arrow is-next" data-act="car-next" aria-label="Siguiente">${CHEVRON}</button>` +
    `</div>` +
    `<div class="rb-ws-catname"></div>` +
    `</header>` +
    `<aside class="rb-ws-rail" aria-label="Opciones">` +
    `<button type="button" class="rb-ws-rail__arrow is-up" data-act="opt-prev" aria-label="Opción anterior">${CHEVRON}</button>` +
    `<div class="rb-ws-rail__dots"></div>` +
    `<button type="button" class="rb-ws-rail__arrow is-down" data-act="opt-next" aria-label="Opción siguiente">${CHEVRON}</button>` +
    `<div class="rb-ws-rail__track" aria-hidden="true"><i class="rb-ws-rail__thumb"></i></div>` +
    `</aside>` +
    `<aside class="rb-ws-layers" aria-label="Capas"><div class="rb-ws-layers__head"><span>CAPAS</span><b class="rb-ws-layers__count"></b></div><div class="rb-ws-layers__list"></div></aside>` +
    `<aside class="rb-ws-rating">` +
    `<div class="rb-ws-rating__label">RATING VISUAL</div>` +
    `<div class="rb-ws-rating__row"><span class="rb-ws-rating__delta"></span><b class="rb-ws-rating__value"></b><span class="rb-ws-rating__star">${STAR}</span></div>` +
    `<div class="rb-ws-rating__meter" aria-hidden="true"><i class="rb-ws-rating__ghost"></i><i class="rb-ws-rating__fill"></i></div>` +
    `</aside>` +
    `<div class="rb-ws-toast" aria-live="assertive"><b class="rb-ws-toast__title"></b><span class="rb-ws-toast__sub"></span></div>` +
    `<div class="rb-ws-dock">` +
    `<div class="rb-ws-part">` +
    `<button type="button" class="rb-ws-part__arrow is-prev" data-act="opt-prev" aria-label="Anterior">${CHEVRON}</button>` +
    `<div class="rb-ws-part__body"><div class="rb-ws-part__name"></div><div class="rb-ws-part__meta"><span class="rb-ws-part__count"></span><span class="rb-ws-part__price"></span><span class="rb-ws-part__badge"></span></div><div class="rb-ws-part__blurb"></div></div>` +
    `<button type="button" class="rb-ws-part__arrow is-next" data-act="opt-next" aria-label="Siguiente">${CHEVRON}</button>` +
    `<div class="rb-ws-stamp" aria-hidden="true">INSTALADO</div>` +
    `</div>` +
    `<div class="rb-ws-panel"></div>` +
    `</div>` +
    `<footer class="rb-ws-foot">` +
    `<div class="rb-ws-loco"><div class="rb-ws-loco__portrait"></div><div class="rb-ws-loco__text"><b class="rb-ws-loco__name"></b><span class="rb-ws-loco__line"></span></div></div>` +
    `<div class="rb-ws-player"><span class="rb-ws-player__label">PILOTO</span><b class="rb-ws-player__name"></b></div>` +
    `<div class="rb-ws-hints" aria-hidden="true"></div>` +
    `<div class="rb-ws-buttons">` +
    `<button type="button" class="rb-ws-btn is-back" data-act="back"><span class="rb-ws-btn__key">ESC</span><span class="rb-ws-btn__label">ATRÁS</span></button>` +
    `<button type="button" class="rb-ws-btn is-install" data-act="install"><span class="rb-ws-btn__key">ENTER</span><span class="rb-ws-btn__label"></span></button>` +
    `<button type="button" class="rb-ws-btn is-exit" data-act="exit"><span class="rb-ws-btn__key">X</span><span class="rb-ws-btn__label">SALIR</span></button>` +
    `</div>` +
    `</footer>` +
    `<div class="rb-ws-fade" aria-hidden="true"></div>`;

  const shopEl = pick<HTMLElement>(root, '.rb-ws-shop');
  const titleEl = pick<HTMLElement>(root, '.rb-ws-title');
  const walletEl = pick<HTMLElement>(root, '.rb-ws-wallet__value');
  const progressDotEl = pick<HTMLElement>(root, '.rb-ws-progress__dot');
  const trackEl = pick<HTMLElement>(root, '.rb-ws-carousel__track');
  const slideEl = pick<HTMLElement>(root, '.rb-ws-carousel__slide');
  const catNameEl = pick<HTMLElement>(root, '.rb-ws-catname');
  const railEl = pick<HTMLElement>(root, '.rb-ws-rail');
  const railDotsEl = pick<HTMLElement>(root, '.rb-ws-rail__dots');
  const railThumbEl = pick<HTMLElement>(root, '.rb-ws-rail__thumb');
  const layersListEl = pick<HTMLElement>(root, '.rb-ws-layers__list');
  const layersCountEl = pick<HTMLElement>(root, '.rb-ws-layers__count');
  const ratingValueEl = pick<HTMLElement>(root, '.rb-ws-rating__value');
  const ratingDeltaEl = pick<HTMLElement>(root, '.rb-ws-rating__delta');
  const ratingFillEl = pick<HTMLElement>(root, '.rb-ws-rating__fill');
  const ratingGhostEl = pick<HTMLElement>(root, '.rb-ws-rating__ghost');
  const toastEl = pick<HTMLElement>(root, '.rb-ws-toast');
  const toastTitleEl = pick<HTMLElement>(root, '.rb-ws-toast__title');
  const toastSubEl = pick<HTMLElement>(root, '.rb-ws-toast__sub');
  const partEl = pick<HTMLElement>(root, '.rb-ws-part');
  const partNameEl = pick<HTMLElement>(root, '.rb-ws-part__name');
  const partCountEl = pick<HTMLElement>(root, '.rb-ws-part__count');
  const partPriceEl = pick<HTMLElement>(root, '.rb-ws-part__price');
  const partBadgeEl = pick<HTMLElement>(root, '.rb-ws-part__badge');
  const partBlurbEl = pick<HTMLElement>(root, '.rb-ws-part__blurb');
  const stampEl = pick<HTMLElement>(root, '.rb-ws-stamp');
  const panelEl = pick<HTMLElement>(root, '.rb-ws-panel');
  const locoEl = pick<HTMLElement>(root, '.rb-ws-loco');
  const locoLineEl = pick<HTMLElement>(root, '.rb-ws-loco__line');
  const playerEl = pick<HTMLElement>(root, '.rb-ws-player');
  const playerNameEl = pick<HTMLElement>(root, '.rb-ws-player__name');
  const hintsEl = pick<HTMLElement>(root, '.rb-ws-hints');
  const installBtn = pick<HTMLButtonElement>(root, '.rb-ws-btn.is-install');
  const installLabelEl = pick<HTMLElement>(installBtn, '.rb-ws-btn__label');
  const fadeEl = pick<HTMLElement>(root, '.rb-ws-fade');

  pick<HTMLElement>(root, '.rb-ws-loco__portrait').innerHTML = portraitFor('mustang');
  pick<HTMLElement>(root, '.rb-ws-loco__name').textContent = LOCO_NAME;

  /* ------------------------------------------------------------------ animation */

  const animations = new Map<Element, Animation>();
  function play(el: Element, keyframes: Keyframe[], opts: number | KeyframeAnimationOptions): void {
    if (!canAnimate) return;
    animations.get(el)?.cancel();
    const o: KeyframeAnimationOptions = typeof opts === 'number' ? { duration: opts, easing: 'cubic-bezier(.2,.8,.2,1)' } : opts;
    animations.set(el, el.animate(keyframes, o));
  }

  /* ------------------------------------------------------------------ what is on screen */

  let shownOpen = false;
  let shownFade = -1;
  let localLevel: WorkshopUiLevel = 'groups';
  let shownLevel: WorkshopUiLevel | '' = '';
  let wasInCategory = false;

  let carouselKey = '';
  let carouselIds: string[] = [];
  let carouselIndex = -1;
  let tiles: HTMLElement[] = [];

  let shownTitle = '';
  let shownShop = '';
  let shownCatName = '';
  let shownMoney = -1;

  let panelKey = '';
  let kind: PanelKind = 'part';
  let optionCount = 0;
  let optionIndex = -1;
  let optionEls: HTMLElement[] = [];
  let railDots: HTMLElement[] = [];
  let optionStates: string[] = [];
  let paletteEls: HTMLElement[] = [];
  let zoneEls: HTMLElement[] = [];
  let paletteCols = 16;
  let shownPartKey = '';
  let shownInstallKey = '';

  let layersKey = '';
  let layerCount = 0;
  let layerSelected = -1;
  let layerColor: string | null = null;
  let layerZone: DecalZone | null = null;
  let layerMax = 4;
  let shownLayerSelKey = '';

  let shownRatingKey = '';
  let deniedId = -1;
  let purchaseId = -1;
  let lineId = -1;
  let shownPlayer = '';
  let shownHints = '';

  // The live values the input handlers act on (the snapshot itself is not kept).
  const current = {
    group: GROUPS[0].id as WorkshopGroupId,
    category: CATEGORIES[0].id as CategoryId,
    installed: false,
    categoryCount: 0,
  };

  let plateInput: HTMLInputElement | null = null;
  let plateTextEl: HTMLElement | null = null;
  let plateValue = '';

  let lineTimer: ReturnType<typeof setTimeout> | null = null;

  function level(): WorkshopUiLevel {
    return shownLevel === '' ? localLevel : shownLevel;
  }

  function setLocalLevel(next: WorkshopUiLevel): void {
    if (next === localLevel) return;
    localLevel = next;
    emit({ type: 'level', level: next });
  }

  /* ------------------------------------------------------------------ carousel */

  function buildCarousel(ids: readonly string[], lvl: WorkshopUiLevel): void {
    carouselIds = ids.slice();
    slideEl.innerHTML = carouselIds
      .map((id, i) => {
        const icon = lvl === 'groups' ? groupIconKey(id as WorkshopGroupId) : categoryDef(id as CategoryId).icon;
        const label = lvl === 'groups' ? groupLabel(id as WorkshopGroupId) : (categoryLabels.get(id) ?? id);
        return `<button type="button" class="rb-ws-tile" data-act="tile" data-i="${i}" aria-label="${esc(label)}">${workshopIcon(icon)}</button>`;
      })
      .join('');
    tiles = Array.from(slideEl.children) as HTMLElement[];
    slideEl.style.setProperty('--n', String(carouselIds.length));
    carouselIndex = -1;
    play(slideEl, [{ opacity: 0, transform: 'scale(0.94)' }, { opacity: 1, transform: 'none' }], 240);
  }

  function setCarouselIndex(index: number): void {
    if (index === carouselIndex) return;
    const previous = carouselIndex;
    carouselIndex = index;
    trackEl.style.setProperty('--i', String(Math.max(0, index)));
    for (let i = 0; i < tiles.length; i++) {
      const d = Math.min(3, Math.abs(i - index));
      tiles[i].dataset.d = String(d);
      tiles[i].classList.toggle('is-on', i === index);
    }
    progressDotEl.style.left = `${(railFraction(index, carouselIds.length) * 100).toFixed(2)}%`;
    if (previous >= 0 && index >= 0) {
      const d = index - previous;
      // Slide from where the strip was: the track's own translate already jumped to the new
      // centre, so the slide starts `d` tiles back and eases to zero.
      play(slideEl, [{ transform: `translateX(${((d * 100) / Math.max(1, carouselIds.length)).toFixed(3)}%)` }, { transform: 'none' }], 260);
      const tile = tiles[index];
      if (tile) play(tile, [{ transform: 'scale(0.9)' }, { transform: 'scale(1.04)', offset: 0.6 }, { transform: 'none' }], 300);
      play(catNameEl, [{ opacity: 0, transform: `translateX(${d > 0 ? 18 : -18}px)` }, { opacity: 1, transform: 'none' }], 240);
    }
  }

  /* ------------------------------------------------------------------ option widgets */

  function railDotHtml(i: number): string {
    return `<button type="button" class="rb-ws-dot" data-act="opt" data-i="${i}" aria-label="Opción ${i + 1}"><i></i></button>`;
  }

  function buildPanel(s: WorkshopUiSnapshot, k: PanelKind): void {
    kind = k;
    optionCount = s.options.length;
    optionIndex = -1;
    optionStates = new Array(optionCount).fill('');
    shownPartKey = '';
    layersKey = '';
    shownLayerSelKey = '';
    paletteEls = [];
    zoneEls = [];
    optionEls = [];
    plateInput = null;
    plateTextEl = null;

    // The rail: parts, plate styles. Layers keep a rail too, for the design of the selected layer.
    railDotsEl.innerHTML = k === 'part' || k === 'plate' ? s.options.map((_, i) => railDotHtml(i)).join('') : '';
    railDots = Array.from(railDotsEl.children) as HTMLElement[];
    railEl.style.setProperty('--n', String(Math.max(1, railDots.length)));

    let html = '';
    if (k === 'color') {
      html =
        `<div class="rb-ws-palette">` +
        s.options
          .map((o, i) => {
            const bg = swatchBackground(o.value, o.swatch);
            const off = bg === 'none' ? ' is-none' : '';
            return `<button type="button" class="rb-ws-swatch${off}" data-act="opt" data-i="${i}" aria-label="${esc(o.label)}" style="--sw:${bg}"></button>`;
          })
          .join('') +
        `</div>`;
    } else if (k === 'step') {
      const n = s.options.length;
      const zero = s.options.findIndex((o) => o.value === 0);
      html =
        `<div class="rb-ws-slider" style="--n:${n};--zero:${Math.max(0, zero)}">` +
        `<div class="rb-ws-slider__rail"><i class="rb-ws-slider__fill"></i></div>` +
        `<div class="rb-ws-slider__notches">` +
        s.options
          .map((o, i) => {
            const label = typeof o.value === 'number' ? stepLabel(o.value) : o.label;
            return `<button type="button" class="rb-ws-notch${o.value === 0 ? ' is-zero' : ''}" data-act="opt" data-i="${i}" aria-label="${esc(label)}"><i></i><span>${esc(label)}</span></button>`;
          })
          .join('') +
        `</div>` +
        `<div class="rb-ws-slider__ends"><span>${esc(stepEndLabel(s.category, -1))}</span><span>FÁBRICA = 0</span><span>${esc(stepEndLabel(s.category, 1))}</span></div>` +
        `</div>`;
    } else if (k === 'finish') {
      html =
        `<div class="rb-ws-chips">` +
        s.options
          .map((o, i) => {
            const id = String(o.value);
            const label = o.label && o.label !== id ? o.label : finishLabel(id);
            return `<button type="button" class="rb-ws-chip" data-act="opt" data-i="${i}"><i class="rb-ws-chip__ball" style="--fin:${FINISH_SWATCH[id] ?? '#555'}"></i><span>${esc(label)}</span></button>`;
          })
          .join('') +
        `</div>`;
    } else if (k === 'layers') {
      if (s.category === 'decals') {
        html =
          `<div class="rb-ws-zones"><span class="rb-ws-panel__label">ZONA</span>` +
          DECAL_ZONES.map((z) => `<button type="button" class="rb-ws-zone" data-act="zone" data-zone="${z}">${esc(ZONE_LABELS[z])}</button>`).join('') +
          `</div>`;
      } else {
        html =
          `<div class="rb-ws-palette is-layer"><span class="rb-ws-panel__label">COLOR DE CAPA</span>` +
          PALETTE.map(
            (c) => `<button type="button" class="rb-ws-swatch" data-act="layer-color" data-color="${c.id}" aria-label="${esc(c.name)}" style="--sw:${swatchBackground(c.id, c.hex)}"></button>`,
          ).join('') +
          `</div>`;
      }
    } else if (k === 'plate') {
      html =
        `<label class="rb-ws-plate" data-act="plate">` +
        `<span class="rb-ws-plate__band"><span class="rb-ws-plate__flag"></span><span class="rb-ws-plate__country">REPÚBLICA ARGENTINA</span><span class="rb-ws-plate__merc">MERCOSUR</span></span>` +
        `<span class="rb-ws-plate__text"></span>` +
        `<input class="rb-ws-plate__input" type="text" autocomplete="off" autocorrect="off" autocapitalize="characters" spellcheck="false" enterkeyhint="done" aria-label="Texto de la patente">` +
        `</label>` +
        `<div class="rb-ws-plate__hint">HASTA ${PLATE_MAX_CHARS} · LETRAS, NÚMEROS, ESPACIO</div>`;
    }
    panelEl.innerHTML = html;
    panelEl.dataset.kind = k;
    root.dataset.kind = k;

    if (k === 'color' || k === 'step' || k === 'finish') {
      optionEls = Array.from(panelEl.querySelectorAll<HTMLElement>('[data-act="opt"]'));
    }
    if (k === 'layers') {
      paletteEls = Array.from(panelEl.querySelectorAll<HTMLElement>('[data-act="layer-color"]'));
      zoneEls = Array.from(panelEl.querySelectorAll<HTMLElement>('[data-act="zone"]'));
    }
    layoutPalettes();
    if (k === 'plate') {
      plateInput = pick<HTMLInputElement>(panelEl, '.rb-ws-plate__input');
      plateTextEl = pick<HTMLElement>(panelEl, '.rb-ws-plate__text');
      plateValue = s.plateText;
      plateInput.value = plateValue;
      renderPlateText();
      plateInput.addEventListener('input', onPlateInput);
      plateInput.addEventListener('focus', onPlateFocus);
      plateInput.addEventListener('blur', onPlateFocus);
      // A keyboard player can type straight away; a phone waits for a tap (it would pop the
      // on-screen keyboard over the car).
      if (!coarsePointer()) plateInput.focus({ preventScroll: true });
    }
    play(panelEl, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], 220);
  }

  function stepEndLabel(category: CategoryId, side: -1 | 1): string {
    switch (category) {
      case 'rideHeight':
        return side < 0 ? 'MÁS BAJO' : 'MÁS ALTO';
      case 'camberFront':
      case 'camberRear':
        return side < 0 ? 'DERECHO' : 'MÁS CAMBER';
      case 'trackFront':
      case 'trackRear':
        return side < 0 ? 'ADENTRO' : 'AFUERA';
      case 'wheelSize':
        return side < 0 ? 'MÁS GOMA' : 'MÁS LLANTA';
      case 'wheelWidth':
        return side < 0 ? 'ANGOSTA' : 'ANCHA';
      default:
        return side < 0 ? 'MENOS' : 'MÁS';
    }
  }

  /** Palette columns: two rows on a wide screen, three on a phone (matches `workshop.css`). */
  function computeCols(count: number): number {
    const w = typeof window !== 'undefined' ? window.innerWidth : 1280;
    return Math.max(1, Math.ceil(count / (w <= 560 ? 3 : 2)));
  }

  function layoutPalettes(): void {
    for (const grid of panelEl.querySelectorAll<HTMLElement>('.rb-ws-palette')) {
      const cols = computeCols(grid.querySelectorAll('.rb-ws-swatch').length);
      grid.style.setProperty('--cols', String(cols));
      if (kind === 'color') paletteCols = cols;
    }
  }

  function coarsePointer(): boolean {
    return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  }

  function renderPlateText(): void {
    if (!plateTextEl) return;
    const text = formatPlate(plateValue) || ' ';
    plateTextEl.textContent = text;
  }

  function onPlateInput(): void {
    if (!plateInput) return;
    const filtered = filterPlateInput(plateInput.value);
    if (filtered !== plateInput.value) plateInput.value = filtered;
    plateValue = filtered;
    renderPlateText();
    if (filtered.trim() !== '') emit({ type: 'plateText', text: filtered });
  }

  function onPlateFocus(e: Event): void {
    const on = document.activeElement === plateInput;
    root.classList.toggle('is-typing', on);
    // The field is usually full (seven characters): typing replaces the plate, it does not
    // append to it. The filter (not `maxlength`) caps the length, so a pasted "AB-123-CD" fits.
    if (on && e.type === 'focus') plateInput?.select();
  }

  function optionState(o: WorkshopOptionView): string {
    return `${o.installed ? 'i' : ''}${o.owned ? 'o' : ''}`;
  }

  function renderOptions(s: WorkshopUiSnapshot): void {
    const opts = s.options;
    // Per-option marks: installed and owned. Compared as short strings; no allocation when equal.
    for (let i = 0; i < opts.length && i < optionStates.length; i++) {
      const st = optionState(opts[i]);
      if (st === optionStates[i]) continue;
      optionStates[i] = st;
      const targets = [railDots[i], optionEls[i]];
      for (const t of targets) {
        if (!t) continue;
        t.classList.toggle('is-installed', opts[i].installed);
        t.classList.toggle('is-owned', opts[i].owned);
      }
    }

    const index = opts.length ? wrapIndex(s.optionIndex, opts.length) : -1;
    if (index !== optionIndex) {
      const previous = optionIndex;
      optionIndex = index;
      for (let i = 0; i < railDots.length; i++) railDots[i].classList.toggle('is-on', i === index);
      for (let i = 0; i < optionEls.length; i++) optionEls[i].classList.toggle('is-on', i === index);
      railThumbEl.style.top = `${(railFraction(index, opts.length) * 100).toFixed(2)}%`;
      if (kind === 'step') {
        const slider = panelEl.querySelector<HTMLElement>('.rb-ws-slider');
        slider?.style.setProperty('--at', String(Math.max(0, index)));
      }
      if (previous >= 0 && index >= 0) {
        const d = index > previous ? 1 : -1;
        play(partNameEl, [{ opacity: 0, transform: `translateX(${d * 22}px)`, filter: 'brightness(2.2)' }, { opacity: 1, transform: 'none', filter: 'none' }], 220);
        play(partEl, [{ boxShadow: 'inset 0 0 0 1px rgba(255,61,240,.9), 0 0 26px rgba(255,61,240,.45)' }, { boxShadow: 'inset 0 0 0 1px rgba(255,61,240,0), 0 0 0 rgba(255,61,240,0)' }], 380);
        const on = railDots[index] ?? optionEls[index];
        if (on) play(on, [{ transform: 'scale(1.35)' }, { transform: 'none' }], 240);
      }
      optionEls[index]?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }

    const o = index >= 0 ? opts[index] : undefined;
    const partKey = o ? `${index}|${o.label}|${o.price}|${o.owned}|${o.installed}|${s.installPrice}|${opts.length}` : '-';
    if (partKey !== shownPartKey) {
      shownPartKey = partKey;
      if (!o) {
        partNameEl.textContent = '—';
        partCountEl.textContent = '';
        partPriceEl.textContent = '';
        partBadgeEl.textContent = '';
        partBlurbEl.textContent = '';
      } else {
        partNameEl.textContent = displayLabel(o);
        partCountEl.textContent = `${index + 1}/${opts.length}`;
        const price = s.installPrice > 0 ? s.installPrice : o.price;
        partPriceEl.textContent = o.installed ? '' : price > 0 ? formatMoney(price) : o.owned ? '' : 'GRATIS';
        partBadgeEl.textContent = o.installed ? 'INSTALADO' : o.owned ? 'COMPRADO' : '';
        partBadgeEl.className = `rb-ws-part__badge${o.installed ? ' is-installed' : o.owned ? ' is-owned' : ''}`;
        const blurb = typeof o.value === 'string' ? findPart(o.value)?.blurb : undefined;
        partBlurbEl.textContent = blurb ?? '';
      }
    }
    // Whether ENTER has anything to do. `dirty` (the preview differs from what is installed) is
    // the rules' answer; the highlighted option's `installed` mark is not enough on its own: a
    // layer removed or recoloured, or new plate text, leaves the design / plate style on the rail
    // exactly as installed. A snapshot without `dirty` (a harness mock) falls back to the mark.
    current.installed = s.dirty === undefined ? !!o?.installed : !s.dirty;
  }

  function displayLabel(o: WorkshopOptionView): string {
    if (kind === 'finish') return o.label && o.label !== String(o.value) ? o.label : finishLabel(String(o.value));
    if (kind === 'step' && typeof o.value === 'number') return stepLabel(o.value);
    return o.label;
  }

  function renderLayers(s: WorkshopUiSnapshot): void {
    const layers = s.layers;
    const items = layers?.items ?? [];
    layerMax = maxLayers(s.category);
    const key = `${s.category}|${items.map((l) => `${l.id}:${l.color ?? ''}:${l.zone ?? ''}:${l.label}`).join(',')}`;
    if (key !== layersKey) {
      layersKey = key;
      layerCount = items.length;
      let html = '';
      items.forEach((l, i) => {
        const sw = l.color ? swatchBackground(l.color, null) : 'none';
        const sub = l.zone ? ZONE_LABELS[l.zone] : (PALETTE.find((c) => c.id === l.color)?.name ?? '');
        html +=
          `<div class="rb-ws-layer" data-act="layer-sel" data-i="${i}">` +
          `<span class="rb-ws-layer__n">${i + 1}</span>` +
          `<i class="rb-ws-layer__sw${l.color ? '' : ' is-none'}" style="--sw:${sw}"></i>` +
          `<span class="rb-ws-layer__text"><b>${esc(l.label)}</b><span>${esc(sub)}</span></span>` +
          `<button type="button" class="rb-ws-layer__rm" data-act="layer-rm" data-i="${i}" aria-label="Quitar capa ${i + 1}">${CROSS}</button>` +
          `</div>`;
      });
      if (items.length < layerMax) {
        html += `<button type="button" class="rb-ws-layer is-add" data-act="layer-add">${PLUS}<span>AGREGAR CAPA</span></button>`;
      }
      layersListEl.innerHTML = html;
      layersCountEl.textContent = `${items.length}/${layerMax}`;
      shownLayerSelKey = '';
    }
    const selected = layers && items.length ? Math.min(items.length - 1, Math.max(0, layers.selected)) : -1;
    const sel = selected >= 0 ? items[selected] : undefined;
    layerSelected = selected;
    layerColor = sel?.color ?? null;
    layerZone = sel?.zone ?? null;
    const selKey = `${selected}|${layerColor}|${layerZone}`;
    if (selKey !== shownLayerSelKey) {
      shownLayerSelKey = selKey;
      const rows = layersListEl.querySelectorAll<HTMLElement>('.rb-ws-layer[data-i]');
      rows.forEach((row, i) => row.classList.toggle('is-on', i === selected));
      for (const p of paletteEls) p.classList.toggle('is-on', p.dataset.color === layerColor);
      for (const z of zoneEls) z.classList.toggle('is-on', z.dataset.zone === layerZone);
      panelEl.classList.toggle('is-disabled', selected < 0);
    }
  }

  /* ------------------------------------------------------------------ buttons and hints */

  function renderInstall(s: WorkshopUiSnapshot, lvl: WorkshopUiLevel): void {
    let label: string;
    let state = '';
    if (lvl === 'groups') label = 'ENTRAR';
    else if (lvl === 'categories') label = 'ELEGIR';
    else {
      const o = s.options.length ? s.options[wrapIndex(s.optionIndex, s.options.length)] : undefined;
      const verb = installVerb(categoryDef(s.category));
      // See `renderOptions`: with `dirty` known, "nothing to install" is the rules' call.
      const done = s.dirty === undefined ? !!o?.installed : !s.dirty;
      if (!o && s.dirty !== true) {
        label = verb;
        state = 'is-done';
      } else if (done) {
        label = 'INSTALADO';
        state = 'is-done';
      } else if (s.installPrice > 0) {
        label = `${verb} · ${formatMoney(s.installPrice)}`;
        if (!s.canInstall) state = 'is-short';
      } else {
        label = verb;
      }
    }
    const key = `${label}|${state}`;
    if (key === shownInstallKey) return;
    shownInstallKey = key;
    installLabelEl.textContent = label;
    installBtn.classList.toggle('is-done', state === 'is-done');
    installBtn.classList.toggle('is-short', state === 'is-short');
    installBtn.setAttribute('aria-disabled', state === 'is-done' ? 'true' : 'false');
  }

  function renderHints(lvl: WorkshopUiLevel): void {
    let hints: string;
    if (lvl === 'groups') hints = '←→ SECCIÓN · ENTER ENTRAR · ESC SALIR';
    else if (lvl === 'categories') hints = '←→ / Q E CATEGORÍA · ENTER ELEGIR · ESC VOLVER';
    else if (kind === 'color') hints = '←→↑↓ COLOR · Q E CATEGORÍA · ARRASTRÁ PARA GIRAR';
    else if (kind === 'step' || kind === 'finish') hints = '←→ AJUSTE · Q E CATEGORÍA · ARRASTRÁ PARA GIRAR';
    else if (kind === 'layers') hints = '↑↓ CAPA · ←→ DISEÑO · [ ] COLOR · + AGREGAR · SUPR QUITAR';
    else if (kind === 'plate') hints = 'ESCRIBÍ LA PATENTE · ↑↓ CHAPA · ENTER GRABAR';
    else hints = '↑↓ PIEZA · Q E CATEGORÍA · ARRASTRÁ PARA GIRAR';
    if (hints === shownHints) return;
    shownHints = hints;
    hintsEl.textContent = hints;
  }

  /* ------------------------------------------------------------------ talk */

  function say(text: string, seconds = LINE_SECONDS): void {
    locoLineEl.textContent = text;
    const on = text.trim() !== '';
    locoEl.classList.toggle('is-talking', on);
    if (on) play(locoLineEl, [{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], 200);
    if (lineTimer !== null) clearTimeout(lineTimer);
    lineTimer = on
      ? setTimeout(() => {
          lineTimer = null;
          locoEl.classList.remove('is-talking');
        }, seconds * 1000)
      : null;
  }

  /* ------------------------------------------------------------------ actions */

  function act(action: WorkshopKeyAction): void {
    const lvl = level();
    if (action === 'exit') return emit({ type: 'exit' });
    if (lvl === 'groups') {
      if (action === 'left' || action === 'prevCategory') emit({ type: 'group', delta: -1 });
      else if (action === 'right' || action === 'nextCategory') emit({ type: 'group', delta: 1 });
      else if (action === 'confirm' || action === 'down') setLocalLevel('categories');
      else if (action === 'back') emit({ type: 'exit' });
      return;
    }
    if (lvl === 'categories') {
      if (action === 'left' || action === 'prevCategory') emit({ type: 'category', delta: -1 });
      else if (action === 'right' || action === 'nextCategory') emit({ type: 'category', delta: 1 });
      else if (action === 'confirm' || action === 'down') emit({ type: 'open' });
      else if (action === 'back' || action === 'up') setLocalLevel('groups');
      return;
    }
    // Inside a category.
    switch (action) {
      case 'prevCategory':
        return emit({ type: 'category', delta: -1 });
      case 'nextCategory':
        return emit({ type: 'category', delta: 1 });
      case 'confirm':
        if (!current.installed) emit({ type: 'install' });
        return;
      case 'back':
        return emit({ type: 'back' });
      default:
        break;
    }
    if (kind === 'layers') {
      if (action === 'up' || action === 'down') {
        if (layerCount > 0) {
          const next = Math.min(layerCount - 1, Math.max(0, layerSelected + (action === 'up' ? -1 : 1)));
          if (next !== layerSelected) emit({ type: 'layer', action: 'select', index: next });
        }
      } else if (action === 'left') emit({ type: 'option', delta: -1 });
      else if (action === 'right') emit({ type: 'option', delta: 1 });
      else if (action === 'layerAdd') {
        if (layerCount < layerMax) emit({ type: 'layer', action: 'add' });
      } else if (action === 'layerRemove') {
        if (layerSelected >= 0) emit({ type: 'layer', action: 'remove', index: layerSelected });
      } else if (action === 'colorPrev' || action === 'colorNext') {
        const d = action === 'colorPrev' ? -1 : 1;
        if (layerSelected < 0) return;
        if (current.category === 'decals') {
          emit({ type: 'layer', action: 'zone', index: layerSelected, zone: cycleZone(layerZone ?? DECAL_ZONES[0], d) });
        } else {
          const i = PALETTE.findIndex((c) => c.id === layerColor);
          emit({ type: 'layer', action: 'color', index: layerSelected, color: PALETTE[wrapIndex((i < 0 ? 0 : i) + d, PALETTE.length)].id });
        }
      }
      return;
    }
    if (action === 'left') emit({ type: 'option', delta: -1 });
    else if (action === 'right') emit({ type: 'option', delta: 1 });
    else if (action === 'up') emit({ type: 'option', delta: kind === 'color' ? -paletteCols : -1 });
    else if (action === 'down') emit({ type: 'option', delta: kind === 'color' ? paletteCols : 1 });
  }

  /* ------------------------------------------------------------------ keyboard */

  const keyTarget: Window | HTMLElement = options.keyTarget ?? window;
  const onKeyDown = (e: KeyboardEvent): void => {
    if (!shownOpen) return;
    // Nothing typed in the workshop reaches the game (Esc would leave for the menu, R restart…).
    e.stopImmediatePropagation();
    if (plateInput && document.activeElement === plateInput) {
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        e.preventDefault();
        act('confirm');
      } else if (e.code === 'Escape') {
        e.preventDefault();
        plateInput.blur();
        act('back');
      } else if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
        e.preventDefault();
        act(e.code === 'ArrowUp' ? 'up' : 'down');
      } else if (e.code === 'Tab') {
        e.preventDefault();
        plateInput.blur();
      }
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const action = keyAction(e.code);
    if (!action) return;
    e.preventDefault();
    const repeatable = action === 'left' || action === 'right' || action === 'up' || action === 'down' || action === 'colorPrev' || action === 'colorNext';
    if (e.repeat && !repeatable) return;
    act(action);
  };
  keyTarget.addEventListener('keydown', onKeyDown as EventListener, true);

  /* ------------------------------------------------------------------ pad */

  let pad: WorkshopPad | null = null;
  function setPad(on: boolean): void {
    if (options.gamepad === false) return;
    if (on && !pad) {
      pad = createWorkshopPad({
        onAction: (a) => {
          if (plateInput && document.activeElement === plateInput && a !== 'up' && a !== 'down' && a !== 'confirm' && a !== 'back') return;
          act(a);
        },
        onOrbit: (dYaw, dPitch) => emit({ type: 'orbit', dYaw, dPitch }),
      });
    } else if (!on && pad) {
      pad.dispose();
      pad = null;
    }
  }

  /* ------------------------------------------------------------------ pointer */

  let dragId = -1;
  let dragX = 0;
  let dragY = 0;
  const onPointerDown = (e: PointerEvent): void => {
    // The game's own pointer binding (hold to charge lightning) must never see a workshop press.
    e.stopPropagation();
    const t = e.target instanceof Element ? e.target : null;
    if (t?.closest('button, input, label, [data-act], .rb-ws-carousel, .rb-ws-dock, .rb-ws-rail, .rb-ws-layers')) return;
    if (e.button !== 0 || dragId !== -1) return;
    dragId = e.pointerId;
    dragX = e.clientX;
    dragY = e.clientY;
    root.classList.add('is-dragging');
    try {
      root.setPointerCapture(e.pointerId);
    } catch {
      /* a synthetic event has no capture to take */
    }
  };
  const onPointerMove = (e: PointerEvent): void => {
    if (e.pointerId !== dragId) return;
    const dx = e.clientX - dragX;
    const dy = e.clientY - dragY;
    dragX = e.clientX;
    dragY = e.clientY;
    if (dx !== 0 || dy !== 0) emit({ type: 'orbit', dYaw: -dx / ORBIT_PX, dPitch: dy / ORBIT_PX });
  };
  const onPointerUp = (e: PointerEvent): void => {
    if (e.pointerId !== dragId) return;
    dragId = -1;
    root.classList.remove('is-dragging');
  };
  root.addEventListener('pointerdown', onPointerDown);
  root.addEventListener('pointermove', onPointerMove);
  root.addEventListener('pointerup', onPointerUp);
  root.addEventListener('pointercancel', onPointerUp);

  let wheelAcc = 0;
  const onWheel = (e: WheelEvent): void => {
    const t = e.target instanceof Element ? e.target : null;
    const onRail = !!t?.closest('.rb-ws-rail, .rb-ws-part');
    const onCarousel = !!t?.closest('.rb-ws-carousel');
    if (!onRail && !onCarousel) return;
    e.preventDefault();
    wheelAcc += Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    if (Math.abs(wheelAcc) < 60) return;
    const d = wheelAcc > 0 ? 1 : -1;
    wheelAcc = 0;
    if (onCarousel) act(d > 0 ? 'right' : 'left');
    else if (level() === 'options') emit({ type: 'option', delta: d });
  };
  root.addEventListener('wheel', onWheel, { passive: false });

  const onClick = (e: MouseEvent): void => {
    const t = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-act]') : null;
    if (!t || !root.contains(t)) return;
    const a = t.dataset.act;
    const i = Number(t.dataset.i ?? -1);
    const lvl = level();
    switch (a) {
      case 'tile': {
        const id = carouselIds[i];
        if (id === undefined) return;
        if (lvl === 'groups') {
          if (i === carouselIndex) setLocalLevel('categories');
          else emit({ type: 'selectGroup', id: id as WorkshopGroupId });
        } else if (i === carouselIndex && lvl === 'categories') emit({ type: 'open' });
        else if (i !== carouselIndex) emit({ type: 'selectCategory', id: id as CategoryId });
        return;
      }
      case 'car-prev':
        return act(lvl === 'options' ? 'prevCategory' : 'left');
      case 'car-next':
        return act(lvl === 'options' ? 'nextCategory' : 'right');
      case 'opt':
        if (i >= 0) emit({ type: 'optionIndex', index: i });
        return;
      case 'opt-prev':
        return void emit({ type: 'option', delta: -1 });
      case 'opt-next':
        return void emit({ type: 'option', delta: 1 });
      case 'install':
        if (lvl === 'options') {
          if (!current.installed) emit({ type: 'install' });
        } else act('confirm');
        return;
      case 'back':
        return act('back');
      case 'exit':
        return emit({ type: 'exit' });
      case 'layer-sel':
        if (i >= 0 && i !== layerSelected) emit({ type: 'layer', action: 'select', index: i });
        return;
      case 'layer-rm':
        e.stopPropagation();
        if (i >= 0) emit({ type: 'layer', action: 'remove', index: i });
        return;
      case 'layer-add':
        if (layerCount < layerMax) emit({ type: 'layer', action: 'add' });
        return;
      case 'layer-color': {
        const color = t.dataset.color;
        if (color && layerSelected >= 0) emit({ type: 'layer', action: 'color', index: layerSelected, color });
        return;
      }
      case 'zone': {
        const zone = t.dataset.zone as DecalZone | undefined;
        if (zone && layerSelected >= 0) emit({ type: 'layer', action: 'zone', index: layerSelected, zone });
        return;
      }
      case 'plate':
        plateInput?.focus({ preventScroll: true });
        return;
    }
  };
  root.addEventListener('click', onClick);

  const onResize = (): void => {
    if (panelKey !== '') layoutPalettes();
  };
  window.addEventListener('resize', onResize);

  /* ------------------------------------------------------------------ update */

  function update(s: WorkshopUiSnapshot): void {
    if (s.open !== shownOpen) {
      shownOpen = s.open;
      root.classList.toggle('is-open', s.open);
      setPad(s.open);
      if (s.open) {
        // A fresh visit starts on the group carousel, and a refusal or a purchase from the last
        // visit is not news.
        localLevel = s.inCategory ? 'options' : 'groups';
        wasInCategory = s.inCategory;
        deniedId = s.deniedId;
        purchaseId = s.purchaseId;
        lineId = s.lineId ?? -1;
        play(root, [{ opacity: 0 }, { opacity: 1 }], 260);
      } else {
        plateInput?.blur();
        dragId = -1;
      }
    }
    if (!s.open) return;

    const fade = Math.round(s.fade * 100) / 100;
    if (fade !== shownFade) {
      shownFade = fade;
      fadeEl.style.opacity = String(fade);
      fadeEl.style.visibility = fade > 0 ? 'visible' : 'hidden';
    }

    // Levels: `options` is the rules' (`inCategory`); the two carousels are the UI's.
    if (s.inCategory) localLevel = 'options';
    else if (wasInCategory || localLevel === 'options') localLevel = 'categories';
    wasInCategory = s.inCategory;
    const lvl: WorkshopUiLevel = s.level ?? localLevel;
    if (lvl !== shownLevel) {
      shownLevel = lvl;
      root.dataset.level = lvl;
    }
    current.group = s.group;
    current.category = s.category;
    current.categoryCount = s.categories.length;

    // Carousel.
    const cKey = lvl === 'groups' ? 'groups' : `c:${s.group}:${s.categories.join(',')}`;
    if (cKey !== carouselKey) {
      carouselKey = cKey;
      buildCarousel(lvl === 'groups' ? GROUPS.map((g) => g.id) : s.categories, lvl);
    }
    setCarouselIndex(lvl === 'groups' ? Math.max(0, carouselIds.indexOf(s.group)) : Math.max(0, carouselIds.indexOf(s.category)));

    // Titles.
    if (s.shopName !== shownShop) {
      shownShop = s.shopName;
      shopEl.textContent = s.shopName.toUpperCase();
    }
    const title = lvl === 'groups' ? 'Taller' : groupLabel(s.group);
    if (title !== shownTitle) {
      shownTitle = title;
      titleEl.textContent = title;
      play(titleEl, [{ opacity: 0, transform: 'translateX(-14px)' }, { opacity: 1, transform: 'none' }], 240);
    }
    const catName = lvl === 'groups' ? groupLabel(s.group) : (categoryLabels.get(s.category) ?? s.category);
    if (catName !== shownCatName) {
      shownCatName = catName;
      catNameEl.textContent = catName;
    }

    // Wallet.
    if (s.money !== shownMoney) {
      const before = shownMoney;
      shownMoney = s.money;
      walletEl.textContent = formatMoney(s.money);
      if (before >= 0) {
        const spent = s.money < before;
        play(walletEl, [{ color: spent ? '#ff2b3d' : '#a8ff3e', transform: 'scale(1.12)' }, { color: '', transform: 'none' }], 520);
      }
    }

    // Option widgets.
    if (lvl === 'options') {
      const k = panelKind(s.category);
      const pKey = `${s.category}|${s.options.length}`;
      if (pKey !== panelKey) {
        panelKey = pKey;
        buildPanel(s, k);
      }
      renderOptions(s);
      if (k === 'layers') renderLayers(s);
      if (k === 'plate' && plateInput && document.activeElement !== plateInput && s.plateText !== plateValue) {
        plateValue = s.plateText;
        plateInput.value = plateValue;
        renderPlateText();
      }
    } else if (panelKey !== '') {
      panelKey = '';
      panelEl.innerHTML = '';
      railDotsEl.innerHTML = '';
      railDots = [];
      optionEls = [];
      plateInput = null;
      plateTextEl = null;
      root.classList.remove('is-typing');
      delete root.dataset.kind;
      current.installed = false;
    }

    // Rating.
    const rKey = `${s.rating}|${s.previewRating}`;
    if (rKey !== shownRatingKey) {
      const first = shownRatingKey === '';
      shownRatingKey = rKey;
      ratingValueEl.textContent = String(s.previewRating);
      // One decimal, like the stars themselves: 1.6 − 1.3 is 0.3, not 0.30000000000000004.
      const delta = Math.round((s.previewRating - s.rating) * 10) / 10;
      ratingDeltaEl.textContent = delta === 0 ? '' : delta > 0 ? `+${delta}` : `−${-delta}`;
      ratingDeltaEl.className = `rb-ws-rating__delta${delta > 0 ? ' is-up' : delta < 0 ? ' is-down' : ''}`;
      ratingFillEl.style.height = `${Math.min(100, (s.previewRating / maxRating) * 100).toFixed(1)}%`;
      ratingGhostEl.style.bottom = `${Math.min(100, (s.rating / maxRating) * 100).toFixed(1)}%`;
      if (!first) play(ratingValueEl, [{ transform: 'scale(1.3)', color: '#ffffff' }, { transform: 'none', color: '' }], 300);
    }

    renderInstall(s, lvl);
    renderHints(lvl);

    // Denial toast.
    if (s.deniedId !== deniedId) {
      deniedId = s.deniedId;
      if (s.lastDenied) {
        const short = s.lastDenied === 'funds' ? Math.max(0, s.installPrice - s.money) : 0;
        const msg = denyMessage(s.lastDenied, short);
        toastTitleEl.textContent = msg.title;
        toastSubEl.textContent = msg.sub;
        toastEl.classList.add('is-on');
        play(
          toastEl,
          [
            { opacity: 0, transform: 'translate(-50%, 10px) scale(0.96)' },
            { opacity: 1, transform: 'translate(-50%, 0) scale(1.03)', offset: 0.06 },
            { opacity: 1, transform: 'translate(-50%, 0)', offset: 0.12 },
            { opacity: 1, transform: 'translate(-50%, 0)', offset: 0.85 },
            { opacity: 0, transform: 'translate(-50%, -6px)' },
          ],
          { duration: 2600, easing: 'linear' },
        );
        play(installBtn, [{ transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(-4px)' }, { transform: 'none' }], 280);
      }
    }

    // Purchase stamp.
    if (s.purchaseId !== purchaseId) {
      purchaseId = s.purchaseId;
      play(
        stampEl,
        [
          { opacity: 0, transform: 'translate(-50%, -50%) rotate(-8deg) scale(1.8)' },
          { opacity: 1, transform: 'translate(-50%, -50%) rotate(-8deg) scale(1)', offset: 0.18 },
          { opacity: 1, transform: 'translate(-50%, -50%) rotate(-8deg) scale(1)', offset: 0.75 },
          { opacity: 0, transform: 'translate(-50%, -50%) rotate(-8deg) scale(1)' },
        ],
        { duration: 1300, easing: 'ease-out' },
      );
    }

    // Loco's line.
    if (s.lineId !== undefined && s.lineId !== lineId) {
      lineId = s.lineId;
      say(s.line ?? '');
    }

    const player = s.playerName ?? '';
    if (player !== shownPlayer) {
      shownPlayer = player;
      playerNameEl.textContent = player.toUpperCase();
      playerEl.classList.toggle('is-on', player !== '');
    }
  }

  return {
    root,
    update,
    say,
    dispose() {
      setPad(false);
      keyTarget.removeEventListener('keydown', onKeyDown as EventListener, true);
      root.removeEventListener('pointerdown', onPointerDown);
      root.removeEventListener('pointermove', onPointerMove);
      root.removeEventListener('pointerup', onPointerUp);
      root.removeEventListener('pointercancel', onPointerUp);
      root.removeEventListener('wheel', onWheel);
      root.removeEventListener('click', onClick);
      window.removeEventListener('resize', onResize);
      if (lineTimer !== null) clearTimeout(lineTimer);
      for (const animation of animations.values()) animation.cancel();
      animations.clear();
      root.remove();
    },
  };
}
