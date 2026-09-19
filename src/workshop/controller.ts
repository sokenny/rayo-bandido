import type { WebGLRenderer } from 'three';
import type { EconomyState, GameEvent, GarageState, WorkshopState } from '../core/types';
import type { CarVisual } from '../render/scene/carVisual';
import type { AudioSystem } from '../audio';
import type { Showroom } from '../render/workshop/showroom';
import type { WorkshopCameraInput } from '../render/workshop/workshopCamera';
import type { WorkshopIntent, WorkshopLayerView, WorkshopOverlay, WorkshopUiLevel, WorkshopUiSnapshot } from '../ui/workshop';
import { categoryDef, findPart, type CameraShot, type CameraShotKey, type CategoryId } from '../content/carParts';
import type { ShopDef } from '../content/shops';
import { DECAL_ZONES, MAX_VINYLS, loadoutsEqual, type DecalLayer, type DecalZone, type VinylLayer } from '../core/loadout';
import { writeGarage } from '../core/progress';
import { garageWorkshopLine } from '../sim/garage';
import {
  applyWorkshopCommand,
  closeWorkshop,
  createWorkshopHudSnapshot,
  workshopFade,
  workshopHudSnapshot,
  workshopOptions,
  workshopSave,
  workshopShowroomVisible,
  type WorkshopCommand,
} from '../sim/workshop';
import { speakDialogue, stopDialogue } from '../audio/dialogueVoice';

/**
 * LOCO MUSTANG'S WORKSHOP, RUN: the one piece that knows about all the others
 * (`docs/GARAGE_PLAN.md` §2, "Ola 2").
 *
 * The rules (`src/sim/workshop.ts`) decide what a visit IS — the door, the fades, what the car
 * wears, what it costs — and are stepped by `stepGame` like every other activity. This module is
 * everything a visit needs that is not a rule:
 *
 * - THE SCENE. The showroom (`src/render/workshop/showroom.ts`) and the NFSU2 overlay
 *   (`src/ui/workshop/`) are loaded with `import()` the first time the car rolls onto the ring,
 *   so the menu and the city never pay for them (their CSS comes in the same chunk). Each visit
 *   builds them fresh under the black fade and frees them on the way out: the showroom is a whole
 *   scene with its own textures and render targets, and the city has no use for any of it.
 * - THE CUT. The screen goes black over the first half of the entering fade; at the midpoint
 *   (`workshopShowroomVisible`) the car is taken off the street and stood on the turntable
 *   (`attach`), the camera is put on the open category, the shaders are compiled while it is still
 *   black (`warmUp`), and only then does the picture come up on the camera's swoop (`introShot`).
 *   If that takes longer than the fade (a slow first download), the black simply holds. Leaving
 *   runs it backwards: the camera pulls away (`outroShot`), the car goes back to the street at the
 *   midpoint, and the city fades up.
 * - THE KEYS. The overlay speaks in `WorkshopIntent`s (agent E); the rules take
 *   `WorkshopCommand`s (agent F). `intent` is the translation, and applies it at once — a key
 *   press answers on the same frame, not on the next tick — raising its events into a list of its
 *   own that goes to the game's `handleEvent` (HUD, audio, analytics) like a tick's would.
 * - WHAT FOLLOWS A COMMAND. The car on the table wears `preview` (`car.applyLoadout`), a new
 *   exhaust is heard at once (`audio.setExhaust` + `revDemo`), a purchase is saved
 *   (`writeGarage`, which the account syncs to the server), and Loco Mustang answers
 *   (`garageWorkshopLine`), voiced here beside the overlay's card.
 * - THE LAYER EDITOR. Vinyls and decals are lists the overlay edits one layer at a time; the rules
 *   only take the whole list (`layer`). Which layer is selected is this module's.
 *
 * `frame` is called every rendered frame by `src/game.ts` and returns whether it drew the frame
 * (the showroom is up): the game then draws nothing of the city. The simulation runs underneath
 * throughout (D7): the car is simply held on the ring by the rules.
 */

export interface WorkshopControllerOptions {
  renderer: WebGLRenderer;
  car: CarVisual;
  audio: AudioSystem;
  shop: ShopDef;
  /** The live rules state. Read through getters: `resetGameState` swaps the economy object out. */
  workshop(): WorkshopState | null;
  garage(): GarageState | null;
  economy(): EconomyState;
  /** Where the overlay and the fade are mounted (the page body: above the HUD, which is hidden). */
  mount: HTMLElement;
  /** Events raised by a key press inside the workshop, for the game's `handleEvent`. */
  onEvents(events: readonly GameEvent[]): void;
  /**
   * The showroom took the screen (true) or gave it back (false). The game parks the car on the
   * ring facing the street, hides its HUD and settles its own camera.
   */
  onShowroom(visible: boolean): void;
  /** The account's name for the overlay's name plate; '' hides it. */
  playerName(): string;
}

export interface WorkshopController {
  /** Once per rendered frame. True when the showroom drew this frame (draw nothing else). */
  frame(dt: number): boolean;
  /** Start downloading the showroom and the overlay now (the car is on the ring): no wait at the door. */
  prefetch(): void;
  resize(width: number, height: number): void;
  /** For automation: send an intent as the overlay would. */
  intent(intent: WorkshopIntent): void;
  /** For tuning shots (`src/content/workshopShots.ts`) with the game running: ease to this one now. */
  shot(shot: CameraShotKey | CameraShot): void;
  /** For automation: where the visit is. */
  status(): {
    phase: string;
    category: CategoryId;
    showroom: boolean;
    loaded: boolean;
    layer: number;
    uiLevel: WorkshopUiLevel;
    carLoadout: string;
  };
  dispose(): void;
}

type ShowroomModule = typeof import('../render/workshop/showroom');
type OverlayModule = typeof import('../ui/workshop');

/** A visit's scene: built on the way in, freed on the way out. */
interface Session {
  showroom: Showroom | null;
  overlay: WorkshopOverlay | null;
  /** The car is on the turntable. */
  attached: boolean;
  /** Shaders compiled, intro started: the showroom may be drawn. */
  warm: boolean;
  /** Built and then torn down again before loading finished (a visit cut short). */
  dead: boolean;
}

/** Colour of a new vinyl layer when the part names none. */
const FALLBACK_VINYL_COLOR = 'white';
/** Seconds a line stays on Loco Mustang's card in the overlay. */
const LINE_SECONDS = 4.5;

export function createWorkshopController(o: WorkshopControllerOptions): WorkshopController {
  let modules: Promise<[ShowroomModule, OverlayModule]> | null = null;
  let loaded: [ShowroomModule, OverlayModule] | null = null;
  let session: Session | null = null;
  let lastPhase = 'closed';
  let lastCategory: CategoryId | null = null;
  let uiLevel: WorkshopUiLevel = 'groups';
  /** Selected layer of the open `layers` category (vinyls / decals); -1 when there are none. */
  let layerSel = -1;
  /** The garage line last voiced here, so each is said once. */
  let spokenLineId = o.garage()?.lineId ?? 0;
  /** A line said while the overlay was not up yet (the welcome, under the fade). */
  let pendingSay = '';
  let lastExhaust = o.car.loadout.exhaustSound;
  let disposed = false;

  const camInput: WorkshopCameraInput = { dragYaw: 0, dragPitch: 0, zoom: 0, dragging: false };
  const snap = createWorkshopHudSnapshot() as WorkshopUiSnapshot;
  let layerKey: unknown = null;
  let layerSelKey = -2;
  let layerItems: WorkshopLayerView[] = [];

  /* ------------------------------------------------------------------ the black */

  const fade = document.createElement('div');
  fade.className = 'rb-ws-cut';
  fade.setAttribute('aria-hidden', 'true');
  fade.style.cssText = 'position:fixed;inset:0;z-index:80;background:#000;opacity:0;visibility:hidden;pointer-events:none;';
  o.mount.appendChild(fade);
  let shownFade = -1;
  function setFade(v: number): void {
    const f = Math.round(Math.min(1, Math.max(0, v)) * 100) / 100;
    if (f === shownFade) return;
    shownFade = f;
    fade.style.opacity = String(f);
    fade.style.visibility = f > 0 ? 'visible' : 'hidden';
  }

  /* ------------------------------------------------------------------ loading */

  function load(): Promise<[ShowroomModule, OverlayModule]> {
    if (!modules) {
      modules = Promise.all([import('../render/workshop/showroom'), import('../ui/workshop')]).then((m) => {
        loaded = m;
        return m;
      });
      // A failed download (offline, a deploy swapped the chunks) must not leave the player in the
      // black with no overlay to leave by: the visit is closed from here, and the next knock on
      // the door tries the download again.
      modules.catch((err: unknown) => {
        console.error('[workshop] could not load the showroom', err);
        modules = null;
        const ws = o.workshop();
        const out: GameEvent[] = [];
        if (ws) closeWorkshop(ws, out);
        if (out.length) o.onEvents(out);
      });
    }
    return modules;
  }

  function build(s: Session, [showroomModule, overlayModule]: [ShowroomModule, OverlayModule]): void {
    if (s.dead || disposed) return;
    s.showroom = showroomModule.createShowroom(o.renderer);
    s.showroom.setShop(o.shop);
    const size = o.renderer.domElement;
    s.showroom.resize(size.clientWidth || window.innerWidth, size.clientHeight || window.innerHeight);
    s.overlay = overlayModule.createWorkshopOverlay({ onIntent: intent });
    o.mount.appendChild(s.overlay.root);
  }

  function begin(): void {
    const s: Session = { showroom: null, overlay: null, attached: false, warm: false, dead: false };
    session = s;
    uiLevel = 'groups';
    lastCategory = null;
    layerSel = -1;
    if (loaded) build(s, loaded);
    else void load().then((m) => build(s, m), () => {});
  }

  /** The car onto the turntable, the camera onto the open category, shaders compiled under black. */
  function attach(s: Session, ws: WorkshopState): void {
    const showroom = s.showroom;
    if (!showroom) return;
    s.attached = true;
    showroom.attach(o.car);
    if (!loadoutsEqual(o.car.loadout, ws.preview)) o.car.applyLoadout(ws.preview);
    showroom.setCategory(ws.category);
    lastCategory = ws.category;
    o.onShowroom(true);
    void showroom
      .warmUp()
      .catch(() => {})
      .then(() => {
        if (s.dead || session !== s) return;
        s.warm = true;
        showroom.introShot();
      });
  }

  /** The car back to the street wearing what is installed, and the scene freed. */
  function teardown(s: Session): void {
    s.dead = true;
    const ws = o.workshop();
    if (s.attached) {
      s.showroom?.detach();
      s.attached = false;
      if (ws && !loadoutsEqual(o.car.loadout, ws.installed)) o.car.applyLoadout(ws.installed);
      o.onShowroom(false);
    }
    s.overlay?.dispose();
    s.showroom?.dispose();
    s.overlay = null;
    s.showroom = null;
    if (session === s) session = null;
    stopDialogue('loco-mustang');
    pendingSay = '';
  }

  /* ------------------------------------------------------------------ intents → commands */

  const events: GameEvent[] = [];

  /** One command, and everything that follows from it. */
  function run(cmd: WorkshopCommand): void {
    const ws = o.workshop();
    if (!ws) return;
    events.length = 0;
    applyWorkshopCommand(ws, cmd, o.shop, o.economy(), events);
    after(ws);
  }

  function after(ws: WorkshopState): void {
    let purchased = false;
    for (let i = 0; i < events.length; i++) if (events[i].type === 'workshopPurchase') purchased = true;
    // Saved on the purchase itself: the counter was debited in the same breath.
    if (purchased) writeGarage(workshopSave(ws));
    const garage = o.garage();
    if (garage && events.length > 0) garageWorkshopLine(garage, events, 0);
    // The car on the table wears the preview; only a real change rebuilds it.
    if (session?.attached && !loadoutsEqual(o.car.loadout, ws.preview)) o.car.applyLoadout(ws.preview);
    // A new exhaust is heard at once, with a blip when it was picked in its own category.
    if (ws.preview.exhaustSound !== lastExhaust) {
      lastExhaust = ws.preview.exhaustSound;
      o.audio.setExhaust(lastExhaust);
      if (ws.category === 'exhaustSound' && ws.phase === 'previewing') o.audio.revDemo();
    }
    if (events.length > 0) o.onEvents(events.slice());
    events.length = 0;
  }

  /* ------------------------------------------------------------------ the layer editor */

  function layerList(ws: WorkshopState, cat: CategoryId): readonly (VinylLayer | DecalLayer)[] {
    return cat === 'vinyls' ? ws.preview.vinyls : ws.preview.decals;
  }

  function clampSel(ws: WorkshopState): void {
    const cat = ws.category;
    if (cat !== 'vinyls' && cat !== 'decals') return;
    const n = layerList(ws, cat).length;
    if (n === 0) layerSel = -1;
    else if (layerSel < 0 || layerSel >= n) layerSel = n - 1;
  }

  function sendLayers(cat: 'vinyls' | 'decals', layers: Array<VinylLayer | DecalLayer>): void {
    if (cat === 'vinyls') run({ type: 'layer', category: 'vinyls', layers: layers as VinylLayer[] });
    else run({ type: 'layer', category: 'decals', layers: layers as DecalLayer[] });
  }

  /** Put design `index` of the rail on the selected layer, or on a new one when there is none. */
  function layerDesign(ws: WorkshopState, cat: 'vinyls' | 'decals', index: number): void {
    const options = workshopOptions(cat);
    const n = options.length;
    if (n === 0) return;
    const id = String(options[((index % n) + n) % n]);
    const list = layerList(ws, cat).map((l) => ({ ...l }));
    if (layerSel < 0 || layerSel >= list.length) {
      // Nothing to re-design: the rules add it as a new layer on top.
      run({ type: 'option', index: ((index % n) + n) % n });
      const now = o.workshop();
      if (now) layerSel = layerList(now, cat).length - 1;
      return;
    }
    list[layerSel].id = id;
    sendLayers(cat, list);
  }

  function selectedDesignIndex(ws: WorkshopState, cat: 'vinyls' | 'decals'): number {
    const list = layerList(ws, cat);
    if (layerSel < 0 || layerSel >= list.length) return 0;
    const i = workshopOptions(cat).indexOf(list[layerSel].id);
    return i < 0 ? 0 : i;
  }

  function layerIntent(ws: WorkshopState, intent: Extract<WorkshopIntent, { type: 'layer' }>): void {
    const cat = ws.category;
    if (cat !== 'vinyls' && cat !== 'decals') return;
    const list = layerList(ws, cat).map((l) => ({ ...l }));
    switch (intent.action) {
      case 'select':
        if (intent.index >= 0 && intent.index < list.length) layerSel = intent.index;
        return;
      case 'add': {
        const options = workshopOptions(cat);
        const id = String(options[selectedDesignIndex(ws, cat)] ?? options[0]);
        if (cat === 'vinyls') {
          if (list.length >= MAX_VINYLS) return;
          const color = findPart(id)?.defaultColor ?? FALLBACK_VINYL_COLOR;
          list.push({ id, color });
        } else {
          const taken = new Set(list.map((l) => (l as DecalLayer).zone));
          const zone = DECAL_ZONES.find((z) => !taken.has(z));
          if (!zone) return;
          list.push({ id, zone });
        }
        layerSel = list.length - 1;
        sendLayers(cat, list);
        return;
      }
      case 'remove':
        if (intent.index < 0 || intent.index >= list.length) return;
        list.splice(intent.index, 1);
        layerSel = Math.min(layerSel, list.length - 1);
        sendLayers(cat, list);
        return;
      case 'color': {
        if (cat !== 'vinyls') return;
        const layer = list[intent.index] as VinylLayer | undefined;
        if (!layer) return;
        layer.color = intent.color;
        sendLayers(cat, list);
        return;
      }
      case 'zone': {
        if (cat !== 'decals') return;
        const layer = list[intent.index] as DecalLayer | undefined;
        if (!layer) return;
        // One decal per zone: a zone already taken swaps with this layer's.
        const other = (list as DecalLayer[]).find((l, i) => i !== intent.index && l.zone === intent.zone);
        if (other) other.zone = layer.zone;
        layer.zone = intent.zone as DecalZone;
        sendLayers(cat, list);
        return;
      }
    }
  }

  function intent(i: WorkshopIntent): void {
    const ws = o.workshop();
    if (!ws || disposed) return;
    const kind = categoryDef(ws.category).kind;
    switch (i.type) {
      case 'group':
        return run({ type: 'group', delta: i.delta });
      case 'selectGroup':
        return run({ type: 'group', group: i.id });
      case 'category':
        return run({ type: 'category', delta: i.delta });
      case 'selectCategory':
        return run({ type: 'category', category: i.id });
      case 'open':
        run({ type: 'select' });
        layerSel = -1;
        clampSel(ws);
        return;
      case 'option':
        if (kind === 'layers' && ws.phase === 'previewing') return layerDesign(ws, ws.category as 'vinyls' | 'decals', selectedDesignIndex(ws, ws.category as 'vinyls' | 'decals') + i.delta);
        // A slider stops at its ends; a list and a palette go round.
        if (kind === 'step') return run({ type: 'step', delta: i.delta });
        return run({ type: 'option', delta: i.delta });
      case 'optionIndex':
        if (kind === 'layers' && ws.phase === 'previewing') return layerDesign(ws, ws.category as 'vinyls' | 'decals', i.index);
        return run({ type: 'option', index: i.index });
      case 'install':
        return run({ type: 'install' });
      case 'plateText':
        return run({ type: 'plateText', text: i.text });
      case 'layer':
        return layerIntent(ws, i);
      case 'back':
        return run({ type: 'back' });
      case 'exit':
        return run({ type: 'exit' });
      case 'orbit':
        camInput.dragYaw += i.dYaw;
        camInput.dragPitch += i.dPitch;
        camInput.dragging = true;
        return;
      case 'level':
        uiLevel = i.level;
        // The group carousel shows the whole car; a category carousel travels with the highlight.
        if (session?.showroom) {
          if (i.level === 'groups') session.showroom.setShot('overview');
          else session.showroom.setCategory(ws.category);
        }
        return;
    }
  }

  /* ------------------------------------------------------------------ the snapshot */

  function fillSnapshot(ws: WorkshopState, open: boolean): WorkshopUiSnapshot {
    workshopHudSnapshot(ws, o.economy(), o.shop, snap);
    snap.open = open;
    // The cut is this module's black (`fade`), drawn over everything; the overlay's own stays off.
    snap.fade = 0;
    snap.playerName = o.playerName();
    const cat = ws.category;
    if ((cat === 'vinyls' || cat === 'decals') && ws.phase === 'previewing') {
      clampSel(ws);
      const list = layerList(ws, cat);
      if (list !== layerKey || layerSel !== layerSelKey) {
        layerKey = list;
        layerSelKey = layerSel;
        layerItems = list.map((l) => ({
          id: l.id,
          label: findPart(l.id)?.name ?? l.id,
          color: 'color' in l ? l.color : null,
          zone: 'zone' in l ? l.zone : null,
        }));
        snap.layers = { items: layerItems, selected: Math.max(0, layerSel) };
      }
      snap.optionIndex = selectedDesignIndex(ws, cat);
    } else if (snap.layers) {
      snap.layers = undefined;
      layerKey = null;
      layerSelKey = -2;
    }
    return snap;
  }

  /* ------------------------------------------------------------------ the frame */

  function voice(ws: WorkshopState): void {
    const garage = o.garage();
    if (!garage) return;
    if (garage.lineId === spokenLineId) return;
    spokenLineId = garage.lineId;
    // Only what is said INSIDE: the street's lines (the hello, the door, the goodbye) are the
    // HUD's garage card's to say, in the city (`garageOverlay.ts`).
    if (ws.phase === 'closed' || !garage.line) return;
    const k = garage.lineKind;
    if (k !== 'welcome' && k !== 'install' && k !== 'broke') return;
    void speakDialogue({ characterId: 'loco-mustang', text: garage.line, interrupt: true });
    pendingSay = garage.line;
  }

  function frame(dt: number): boolean {
    const ws = o.workshop();
    if (!ws || disposed) return false;
    const open = ws.phase !== 'closed';
    voice(ws);

    if (!open) {
      if (session) teardown(session);
      lastPhase = ws.phase;
      setFade(0);
      return false;
    }
    if (!session) {
      // The second half of the way out: the scene is already gone, only the black lifts.
      if (ws.phase === 'leaving') {
        setFade(workshopFade(ws));
        return false;
      }
      begin();
    }
    const s = session as Session;

    if (ws.phase === 'leaving' && lastPhase !== 'leaving') s.showroom?.outroShot();
    lastPhase = ws.phase;

    const wanted = workshopShowroomVisible(ws);
    if (wanted && !s.attached && s.showroom) attach(s, ws);
    if (!wanted && s.attached) {
      // Past the leaving midpoint: the street is the scene again.
      teardown(s);
      setFade(workshopFade(ws));
      return false;
    }
    const drawing = wanted && s.attached && s.warm;
    // Past the midpoint but not drawable yet (still downloading, still compiling): hold the black.
    setFade(wanted && !drawing ? 1 : workshopFade(ws));
    if (!drawing || !s.showroom) return false;

    if (ws.category !== lastCategory) {
      lastCategory = ws.category;
      layerSel = -1;
      clampSel(ws);
      if (uiLevel !== 'groups') s.showroom.setCategory(ws.category);
    }
    s.showroom.update(dt, camInput);
    camInput.dragYaw = 0;
    camInput.dragPitch = 0;
    camInput.zoom = 0;
    camInput.dragging = false;
    s.showroom.render();
    if (s.overlay) {
      s.overlay.update(fillSnapshot(ws, true));
      if (pendingSay) {
        s.overlay.say(pendingSay, LINE_SECONDS);
        pendingSay = '';
      }
    }
    return true;
  }

  return {
    frame,
    prefetch() {
      if (!modules) void load().catch(() => {});
    },
    resize(width, height) {
      session?.showroom?.resize(width, height);
    },
    intent,
    shot(next) {
      session?.showroom?.setShot(next);
    },
    status() {
      const ws = o.workshop();
      return {
        phase: ws?.phase ?? 'none',
        category: ws?.category ?? 'frontBumper',
        showroom: !!session && session.attached && session.warm,
        loaded: !!loaded,
        layer: layerSel,
        uiLevel,
        carLoadout: o.car.loadout ? JSON.stringify(o.car.loadout) : '',
      };
    },
    dispose() {
      disposed = true;
      if (session) teardown(session);
      fade.remove();
    },
  };
}
