import type { ActivityMarkKind, MinimapData, RaceCourse, RivalCar, TargetState } from '../core/types';
import { MINIMAP, STREET_RACE } from '../config/tuning';
import { slotCss } from '../core/playerColors';

/**
 * Minimap: a north-up picture of the drivable roads with the player, the activity markers and,
 * on the circuit, the line and the checkpoints. Electric cars are not shown — finding them is
 * the game. The roads are drawn once into an offscreen canvas; each frame only clears, blits the
 * part of it under the car and draws a handful of dots. Hidden ribbons (the shortcuts) are deliberately left off — they
 * are for the player to find.
 *
 * WHAT IS AND IS NOT MARKED. The distinction is whether the thing is a destination. An electric
 * car is quarry: a hundred white dots buried the player's own arrow and gave away a hunt that is
 * the point of the mode. The RAYO RUSH circle is somewhere to GO, and one you cannot find is one
 * that does not exist — so it is drawn, in the chrome's hazard yellow, which nothing else on
 * this map uses. The same goes for the other activities, each in a colour of its own: violet for
 * a fare, magenta for the start line the circuit missions are entered on. ONE COLOUR EACH is the
 * whole scheme — the mark is recognised before its shape is, especially at a glance at speed.
 *
 * ONLY THE ACTIVITY IN HAND. While one of them has the car, the others are not marked at all
 * (`src/sim/activities.ts`): the game passes the list it wants drawn, and a run is driven on a
 * map with nothing on it but the run. Marks are drawn per frame over the roads rather than into
 * them, because the corner view pins an off-window mark to its rim and so moves them all the time;
 * there are never more than a handful.
 *
 * Performance contract: no per-frame allocation beyond the arrow's halo gradient; one 2D canvas of
 * `MINIMAP.size` CSS pixels blitting from one prepainted base.
 */
export interface Minimap {
  /** `targets` is accepted but not drawn; `rivals` are the other players (room or local race). */
  update(
    playerX: number,
    playerZ: number,
    heading: number,
    targets: readonly TargetState[],
    rivals?: readonly RivalCar[],
  ): void;
  /**
   * Mark somewhere else. The RAYO RUSH marker moves when a mission is cleared, and the map has
   * to move with it or it is pointing at a street corner with nothing on it. Called on the
   * event and not per frame. `label` is what the full map writes beside the mark; without one
   * the kind's own name is used.
   */
  setActivities(points: readonly { x: number; z: number; kind?: ActivityMarkKind; label?: string }[]): void;
  /** Open or close the full map (also bound to `MINIMAP.key` and a click on the minimap). */
  setExpanded(open: boolean): void;
  dispose(): void;
}

export interface MinimapPose {
  x: number;
  z: number;
  heading: number;
}

/** What the full map calls a mark that did not come with a name of its own. */
const KIND_LABEL: Record<ActivityMarkKind, string> = {
  rush: 'RAYO RUSH',
  passenger: 'PASSENGER',
  destination: 'DROP-OFF',
  circuit: 'CIRCUIT',
  street: 'STREET RACE',
  buho: 'EL BÚHO',
  garage: 'GARAGE',
};

interface Mark {
  x: number;
  z: number;
  kind: ActivityMarkKind;
  label: string;
}

/**
 * `selfColour` is the player's own arrow: cyan alone, their slot colour in a match, so the
 * map says the same thing about them as every other screen does.
 *
 * TWO VIEWS OF ONE PICTURE. The corner is a round window `MINIMAP.viewMeters` across, centred on
 * the car and north up: the roads are painted once, at that zoom, into one large offscreen canvas
 * and each frame blits the square of it under the car — so driving scrolls the map rather than
 * redrawing it. Marks are drawn per frame on top, and one outside the window is pinned to its
 * rim, in its own direction: at this zoom most destinations are off the map most of the time,
 * and a mark you cannot see is one you cannot drive to.
 *
 * The full map (click the circle, or `MINIMAP.key`) fits the whole world into the screen with a
 * name beside every mark. Its own base is painted when it opens, not before — most sessions never
 * open it.
 */
export function createMinimap(root: HTMLElement, data: MinimapData, race: RaceCourse | null, selfColour = '#4ff3ff'): Minimap {
  const size = MINIMAP.size;
  const dpr = Math.min(2, typeof devicePixelRatio === 'number' ? devicePixelRatio : 1);

  // A button, so the pointer handler that fires the lightning leaves the click alone
  // (`src/core/input/keyboard.ts`) — and it never takes focus, or the next Space (the handbrake)
  // would press it.
  const wrap = document.createElement('button');
  wrap.type = 'button';
  wrap.tabIndex = -1;
  wrap.className = 'rb-minimap';
  wrap.setAttribute('aria-label', 'Open map');
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  wrap.appendChild(canvas);
  const keyBadge = document.createElement('span');
  keyBadge.className = 'rb-minimap__key';
  keyBadge.textContent = MINIMAP.keyLabel;
  wrap.appendChild(keyBadge);
  root.appendChild(wrap);
  const ctx = canvas.getContext('2d');

  // The zoomed base: the whole world at the corner's zoom, capped so a big world still fits in
  // one canvas the browser will allocate.
  const b = data.bounds;
  const spanX = b.maxX - b.minX;
  const spanZ = b.maxZ - b.minZ;
  const scale = Math.min((size * dpr) / MINIMAP.viewMeters, MINIMAP.maxBasePx / Math.max(spanX, spanZ));
  const base = document.createElement('canvas');
  base.width = Math.ceil(spanX * scale);
  base.height = Math.ceil(spanZ * scale);
  const bctx = base.getContext('2d');
  if (bctx) drawBase(bctx, data, race, (x) => (x - b.minX) * scale, (z) => (z - b.minZ) * scale, scale, dpr);

  const marks: Mark[] = [];
  for (const a of data.activities ?? []) {
    const kind = a.kind ?? 'rush';
    marks.push({ x: a.x, z: a.z, kind, label: KIND_LABEL[kind] });
  }
  const dotR = 2.2 * dpr;
  const half = canvas.width / 2;
  const rimR = half - 1.5 * dpr;
  const markRimR = rimR - 9 * dpr * MINIMAP.iconScale;
  const rivalRimR = rimR - 3 * dpr;

  /* ------------------------------------------------------------ the full map */

  const overlay = document.createElement('div');
  overlay.className = 'rb-bigmap';
  overlay.hidden = true;
  overlay.innerHTML =
    `<div class="rb-bigmap__panel">` +
    `<div class="rb-bigmap__head"><span class="rb-bigmap__title">MAP</span>` +
    `<button type="button" tabindex="-1" class="rb-bigmap__close"><span class="rb-key">${MINIMAP.keyLabel}</span> <span class="rb-key">ESC</span> close</button></div>` +
    `<div class="rb-bigmap__stage"><canvas></canvas><div class="rb-bigmap__labels"></div></div>` +
    `</div>`;
  root.appendChild(overlay);
  const panel = overlay.querySelector('.rb-bigmap__panel') as HTMLElement;
  const stage = overlay.querySelector('.rb-bigmap__stage') as HTMLElement;
  const big = overlay.querySelector('canvas') as HTMLCanvasElement;
  const labelsEl = overlay.querySelector('.rb-bigmap__labels') as HTMLElement;
  const bigCtx = big.getContext('2d');
  const bigBase = document.createElement('canvas');
  const bigBaseCtx = bigBase.getContext('2d');
  let bigScale = 1;
  let bigCssScale = 1;
  let expanded = false;
  const bigPx = (x: number): number => (x - b.minX) * bigScale;
  const bigPz = (z: number): number => (z - b.minZ) * bigScale;

  const youLabel = document.createElement('div');
  youLabel.className = 'rb-bigmap__label rb-bigmap__label--you';
  youLabel.textContent = 'YOU';
  youLabel.style.color = selfColour;
  const rivalLabels: HTMLDivElement[] = [];

  function layoutBig(): void {
    // Fit the world into the window with room for the header, keeping its proportions.
    const maxW = Math.max(200, window.innerWidth * 0.9 - 32);
    const maxH = Math.max(200, window.innerHeight * 0.9 - 80);
    const cssScale = Math.min(maxW / spanX, maxH / spanZ);
    const w = Math.round(spanX * cssScale);
    const h = Math.round(spanZ * cssScale);
    bigCssScale = cssScale;
    bigScale = cssScale * dpr;
    big.width = Math.round(w * dpr);
    big.height = Math.round(h * dpr);
    big.style.width = `${w}px`;
    big.style.height = `${h}px`;
    stage.style.width = `${w}px`;
    stage.style.height = `${h}px`;
    bigBase.width = big.width;
    bigBase.height = big.height;
    if (bigBaseCtx) drawBase(bigBaseCtx, data, race, bigPx, bigPz, bigScale, dpr);
    buildLabels();
  }

  function placeLabel(el: HTMLElement, x: number, z: number): void {
    el.style.transform = `translate(${((x - b.minX) * bigCssScale).toFixed(1)}px, ${((z - b.minZ) * bigCssScale).toFixed(1)}px)`;
  }

  function buildLabels(): void {
    labelsEl.textContent = '';
    for (const m of marks) {
      const el = document.createElement('div');
      el.className = `rb-bigmap__label rb-bigmap__label--${m.kind}`;
      el.textContent = m.label;
      placeLabel(el, m.x, m.z);
      labelsEl.appendChild(el);
    }
    labelsEl.appendChild(youLabel);
    for (const el of rivalLabels) labelsEl.appendChild(el);
  }

  function setExpanded(open: boolean): void {
    if (open === expanded) return;
    expanded = open;
    overlay.hidden = !open;
    wrap.classList.toggle('is-open', open);
    if (open) layoutBig();
  }

  wrap.addEventListener('mousedown', (e) => e.preventDefault());
  wrap.addEventListener('click', () => setExpanded(!expanded));
  overlay.addEventListener('mousedown', (e) => e.preventDefault());
  overlay.addEventListener('click', (e) => {
    // The backdrop and the close button shut it; a click on the map itself does not.
    const t = e.target as Element;
    if (!panel.contains(t) || t.closest('.rb-bigmap__close')) setExpanded(false);
  });
  // Capture phase, so ESC closes the map before the game's own ESC takes the player to the menu.
  const onKey = (e: KeyboardEvent): void => {
    const t = e.target as Element | null;
    if (t && t.closest?.('input, textarea, select, [contenteditable]')) return;
    if (e.code === MINIMAP.key && !e.repeat) {
      setExpanded(!expanded);
      e.preventDefault();
    } else if (e.code === 'Escape' && expanded) {
      setExpanded(false);
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  };
  window.addEventListener('keydown', onKey, true);
  const onResize = (): void => {
    if (expanded) layoutBig();
  };
  window.addEventListener('resize', onResize);

  function drawPlayer(c: CanvasRenderingContext2D, cx: number, cz: number, heading: number, k: number): void {
    c.save();
    c.translate(cx, cz);
    c.scale(k, k);

    // A soft halo behind the arrow: on a busy grid the eye finds the glow first, then
    // reads the heading off the arrow inside it.
    const halo = c.createRadialGradient(0, 0, 0, 0, 0, 13 * dpr);
    halo.addColorStop(0, 'rgba(255, 255, 255, 0.32)');
    halo.addColorStop(1, 'rgba(255, 255, 255, 0)');
    c.fillStyle = halo;
    c.beginPath();
    c.arc(0, 0, 13 * dpr, 0, Math.PI * 2);
    c.fill();

    // Heading 0 faces -Z, which is up on the map; positive = clockwise.
    c.rotate(heading);
    c.fillStyle = selfColour;
    c.strokeStyle = 'rgba(8, 12, 20, 0.95)';
    c.lineWidth = 1.6 * dpr;
    c.lineJoin = 'round';
    c.shadowColor = selfColour;
    c.shadowBlur = 10 * dpr;
    c.beginPath();
    c.moveTo(0, -9 * dpr);
    c.lineTo(6.4 * dpr, 7.2 * dpr);
    c.lineTo(0, 3.8 * dpr);
    c.lineTo(-6.4 * dpr, 7.2 * dpr);
    c.closePath();
    c.fill();
    c.shadowBlur = 0;
    c.stroke();
    c.restore();
  }

  function drawBig(playerX: number, playerZ: number, heading: number, rivals?: readonly RivalCar[]): void {
    if (!bigCtx) return;
    bigCtx.clearRect(0, 0, big.width, big.height);
    bigCtx.drawImage(bigBase, 0, 0);
    for (const m of marks) drawActivity(bigCtx, bigPx(m.x), bigPz(m.z), dpr, m.kind);
    let shown = 0;
    if (rivals) {
      for (let i = 0; i < rivals.length; i++) {
        const r = rivals[i];
        if (!r.present) continue;
        bigCtx.fillStyle = slotCss(r.slot);
        bigCtx.beginPath();
        bigCtx.arc(bigPx(r.x), bigPz(r.z), dotR * 1.6, 0, Math.PI * 2);
        bigCtx.fill();
        let el = rivalLabels[shown];
        if (!el) {
          el = document.createElement('div');
          el.className = 'rb-bigmap__label rb-bigmap__label--rival';
          rivalLabels.push(el);
          labelsEl.appendChild(el);
        }
        if (el.textContent !== r.name) el.textContent = r.name;
        el.style.color = slotCss(r.slot);
        el.hidden = false;
        placeLabel(el, r.x, r.z);
        shown++;
      }
    }
    for (let i = shown; i < rivalLabels.length; i++) rivalLabels[i].hidden = true;
    drawPlayer(bigCtx, bigPx(playerX), bigPz(playerZ), heading, 1.25);
    placeLabel(youLabel, playerX, playerZ);
  }

  return {
    setActivities(points) {
      marks.length = 0;
      for (const p of points) {
        const kind = p.kind ?? 'rush';
        marks.push({ x: p.x, z: p.z, kind, label: p.label ?? KIND_LABEL[kind] });
      }
      if (expanded) buildLabels();
    },

    setExpanded,

    update(playerX, playerZ, heading, _targets, rivals) {
      if (expanded) drawBig(playerX, playerZ, heading, rivals);
      if (!ctx) return;
      const w = canvas.width;
      ctx.clearRect(0, 0, w, w);
      ctx.save();
      ctx.beginPath();
      ctx.arc(half, half, rimR, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = 'rgba(5, 7, 13, 0.78)';
      ctx.fillRect(0, 0, w, w);

      // The square of the base under the car, clipped to the base's own edges so the browser is
      // never asked for pixels outside it.
      const sx = (playerX - b.minX) * scale - half;
      const sz = (playerZ - b.minZ) * scale - half;
      const x0 = Math.max(0, sx);
      const z0 = Math.max(0, sz);
      const x1 = Math.min(base.width, sx + w);
      const z1 = Math.min(base.height, sz + w);
      if (x1 > x0 && z1 > z0) ctx.drawImage(base, x0, z0, x1 - x0, z1 - z0, x0 - sx, z0 - sz, x1 - x0, z1 - z0);

      // Electric cars are deliberately not drawn: a hundred-odd white dots buried the
      // player's own arrow and the route. Hunting them is the game.

      // Destinations, pinned to the rim when they are off the window, pointing the way.
      for (let i = 0; i < marks.length; i++) {
        const m = marks[i];
        let mx = (m.x - playerX) * scale;
        let mz = (m.z - playerZ) * scale;
        const d = Math.hypot(mx, mz);
        if (d > markRimR) {
          mx *= markRimR / d;
          mz *= markRimR / d;
        }
        drawActivity(ctx, half + mx, half + mz, dpr, m.kind);
      }

      // Other players, in their own colour, over the activity marks and under the player's arrow.
      // The window is only a few hundred metres across and the city is kilometres wide, so a player
      // off the window is pinned to the rim as a chevron pointing at them — the corner map alone
      // says where everyone is, without opening the full map.
      if (rivals) {
        for (let i = 0; i < rivals.length; i++) {
          const r = rivals[i];
          if (!r.present) continue;
          const rx = (r.x - playerX) * scale;
          const rz = (r.z - playerZ) * scale;
          const d = Math.hypot(rx, rz);
          ctx.fillStyle = slotCss(r.slot);
          ctx.strokeStyle = 'rgba(5, 7, 13, 0.9)';
          ctx.lineWidth = 1.5 * dpr;
          ctx.beginPath();
          if (d <= rivalRimR) {
            ctx.arc(half + rx, half + rz, dotR * 1.7, 0, Math.PI * 2);
          } else {
            const ux = rx / d;
            const uz = rz / d;
            const tipX = half + ux * rivalRimR;
            const tipZ = half + uz * rivalRimR;
            const len = 9 * dpr;
            const wing = 5 * dpr;
            ctx.moveTo(tipX, tipZ);
            ctx.lineTo(tipX - ux * len - uz * wing, tipZ - uz * len + ux * wing);
            ctx.lineTo(tipX - ux * len * 0.6, tipZ - uz * len * 0.6);
            ctx.lineTo(tipX - ux * len + uz * wing, tipZ - uz * len - ux * wing);
            ctx.closePath();
          }
          ctx.fill();
          ctx.stroke();
        }
      }

      drawPlayer(ctx, half, half, heading, MINIMAP.playerScale);
      ctx.restore();

      // The rim, and a north tick on it: the map does not turn with the car.
      ctx.strokeStyle = 'rgba(180, 214, 255, 0.28)';
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();
      ctx.arc(half, half, rimR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#4ff3ff';
      ctx.beginPath();
      ctx.moveTo(half, 1 * dpr);
      ctx.lineTo(half + 4 * dpr, 8 * dpr);
      ctx.lineTo(half - 4 * dpr, 8 * dpr);
      ctx.closePath();
      ctx.fill();
    },
    dispose() {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onResize);
      wrap.remove();
      overlay.remove();
    },
  };
}

/**
 * One activity marker: a ringed bolt in hazard yellow, on a dark disc so it reads over a road.
 *
 * Drawn at a FIXED PIXEL SIZE rather than to world scale. The circle it stands for is 7.5 m
 * across in a city about 540 m wide, which on a 176 px map is under three pixels — a mark the
 * player has to be able to spot has to be sized for the eye, not for the ground.
 *
 * The bolt is a stroked zigzag rather than the filled silhouette the HUD and the world marker
 * share, because at ten pixels a filled bolt is a blob and three strokes still read as lightning.
 */
function drawActivity(ctx: CanvasRenderingContext2D, cx: number, cz: number, pxRatio: number, kind: ActivityMarkKind = 'rush'): void {
  // Every mark is drawn in units of `dpr`, so scaling it scales the whole icon at once.
  const dpr = pxRatio * MINIMAP.iconScale;
  if (kind === 'circuit') {
    drawCircuitMark(ctx, cx, cz, dpr);
    return;
  }
  if (kind === 'buho') {
    drawBuhoMark(ctx, cx, cz, dpr);
    return;
  }
  if (kind === 'garage') {
    drawGarageMark(ctx, cx, cz, dpr);
    return;
  }
  if (kind === 'street') {
    drawStreetMark(ctx, cx, cz, dpr);
    return;
  }
  if (kind !== 'rush') {
    drawPassengerMark(ctx, cx, cz, dpr, kind);
    return;
  }
  const r = 6.6 * dpr;
  const YELLOW = '#fcee0a';

  ctx.save();
  ctx.translate(cx, cz);

  // Dark disc, so the mark never has to compete with the road under it.
  ctx.fillStyle = 'rgba(5, 7, 13, 0.85)';
  ctx.beginPath();
  ctx.arc(0, 0, r + 1.6 * dpr, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = YELLOW;
  ctx.shadowColor = YELLOW;
  ctx.shadowBlur = 6 * dpr;
  ctx.lineWidth = 1.5 * dpr;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();

  ctx.lineWidth = 1.7 * dpr;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(1.4 * dpr, -3.4 * dpr);
  ctx.lineTo(-1.3 * dpr, -0.2 * dpr);
  ctx.lineTo(1.3 * dpr, 0.2 * dpr);
  ctx.lineTo(-1.4 * dpr, 3.4 * dpr);
  ctx.stroke();

  ctx.restore();
}

/**
 * The circuit missions on the map: a ringed chequered flag in the magenta this game already
 * paints a start line with — which is what the mark stands on, so the colour is doing the same
 * job here as it does on the race's own minimap.
 *
 * The chequer is four filled squares in a 2x2, which at this size is the most of one that still
 * reads: eight of them at three pixels each is a grey smear. Fixed pixel size, same reason as
 * the RUSH mark — a thing the player has to be able to spot is sized for the eye.
 */
function drawCircuitMark(ctx: CanvasRenderingContext2D, cx: number, cz: number, dpr: number): void {
  const r = 6.2 * dpr;
  const MAGENTA = '#ff3df0';

  ctx.save();
  ctx.translate(cx, cz);

  // Dark disc, so the mark never has to compete with the road under it.
  ctx.fillStyle = 'rgba(5, 7, 13, 0.85)';
  ctx.beginPath();
  ctx.arc(0, 0, r + 1.6 * dpr, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = MAGENTA;
  ctx.shadowColor = MAGENTA;
  ctx.shadowBlur = 6 * dpr;
  ctx.lineWidth = 1.5 * dpr;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();

  // The chequer: two squares on one diagonal, so the eye fills in the two that are not there.
  const cell = 1.9 * dpr;
  ctx.shadowBlur = 0;
  ctx.fillStyle = MAGENTA;
  ctx.fillRect(-cell, -cell, cell, cell);
  ctx.fillRect(0, 0, cell, cell);
  // And the two that are, hairlined, so the block never reads as one bar.
  ctx.lineWidth = 1 * dpr;
  ctx.strokeRect(0, -cell, cell, cell);
  ctx.strokeRect(-cell, 0, cell, cell);

  ctx.restore();
}

/**
 * A STREET RACE meetup on the map: a ring in the series' own amber (`STREET_RACE.icon`) with
 * two car silhouettes nose to nose inside it — the same duel the world marker hangs, at ten
 * pixels. Fixed pixel size, same reason as the RUSH mark.
 */
function drawStreetMark(ctx: CanvasRenderingContext2D, cx: number, cz: number, dpr: number): void {
  const r = 6.2 * dpr;
  const AMBER = STREET_RACE.icon.mapColour;

  ctx.save();
  ctx.translate(cx, cz);

  ctx.fillStyle = 'rgba(5, 7, 13, 0.85)';
  ctx.beginPath();
  ctx.arc(0, 0, r + 1.6 * dpr, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = AMBER;
  ctx.shadowColor = AMBER;
  ctx.shadowBlur = 6 * dpr;
  ctx.lineWidth = 1.5 * dpr;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();

  // Two cars in profile, one above the other, facing each other: a bar and a cabin each.
  ctx.shadowBlur = 0;
  ctx.fillStyle = AMBER;
  ctx.fillRect(-3.6 * dpr, -2.9 * dpr, 4.6 * dpr, 1.5 * dpr);
  ctx.fillRect(-2.6 * dpr, -3.9 * dpr, 2 * dpr, 1 * dpr);
  ctx.fillRect(-1 * dpr, 1.4 * dpr, 4.6 * dpr, 1.5 * dpr);
  ctx.fillRect(0.6 * dpr, 0.4 * dpr, 2 * dpr, 1 * dpr);

  ctx.restore();
}

/**
 * El Búho's bay under the viaduct: a ring in acid green — nothing else on this map uses it —
 * around an owl's face, two big eyes under a pair of ear tufts. Fixed pixel size, same reason as
 * the RUSH mark.
 */
function drawBuhoMark(ctx: CanvasRenderingContext2D, cx: number, cz: number, dpr: number): void {
  const r = 6.2 * dpr;
  const GREEN = '#7dff6a';

  ctx.save();
  ctx.translate(cx, cz);

  ctx.fillStyle = 'rgba(5, 7, 13, 0.85)';
  ctx.beginPath();
  ctx.arc(0, 0, r + 1.6 * dpr, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = GREEN;
  ctx.shadowColor = GREEN;
  ctx.shadowBlur = 6 * dpr;
  ctx.lineWidth = 1.5 * dpr;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();

  // Ear tufts, then two eyes with dark pupils.
  ctx.shadowBlur = 0;
  ctx.fillStyle = GREEN;
  ctx.beginPath();
  ctx.moveTo(-3.6 * dpr, -3.6 * dpr);
  ctx.lineTo(-1.2 * dpr, -1.8 * dpr);
  ctx.lineTo(-3.2 * dpr, -1.2 * dpr);
  ctx.closePath();
  ctx.moveTo(3.6 * dpr, -3.6 * dpr);
  ctx.lineTo(1.2 * dpr, -1.8 * dpr);
  ctx.lineTo(3.2 * dpr, -1.2 * dpr);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.arc(-1.8 * dpr, 0.9 * dpr, 1.7 * dpr, 0, Math.PI * 2);
  ctx.arc(1.8 * dpr, 0.9 * dpr, 1.7 * dpr, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(5, 7, 13, 0.95)';
  ctx.beginPath();
  ctx.arc(-1.8 * dpr, 0.9 * dpr, 0.7 * dpr, 0, Math.PI * 2);
  ctx.arc(1.8 * dpr, 0.9 * dpr, 0.7 * dpr, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

/**
 * Loco Mustang's garage: a ring in the red of the 99 on his shirt around a spanner, head up and
 * to the left. Fixed pixel size, same reason as the RUSH mark.
 */
function drawGarageMark(ctx: CanvasRenderingContext2D, cx: number, cz: number, dpr: number): void {
  const r = 6.2 * dpr;
  const RED = '#ff5a3c';

  ctx.save();
  ctx.translate(cx, cz);

  ctx.fillStyle = 'rgba(5, 7, 13, 0.85)';
  ctx.beginPath();
  ctx.arc(0, 0, r + 1.6 * dpr, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = RED;
  ctx.shadowColor = RED;
  ctx.shadowBlur = 6 * dpr;
  ctx.lineWidth = 1.5 * dpr;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();

  // The spanner: a shaft corner to corner, an open jaw at the top-left end.
  ctx.shadowBlur = 0;
  ctx.rotate(-Math.PI / 4);
  ctx.fillStyle = RED;
  ctx.fillRect(-0.9 * dpr, -1.2 * dpr, 1.8 * dpr, 5.4 * dpr);
  ctx.beginPath();
  ctx.arc(0, -2.4 * dpr, 2.3 * dpr, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(5, 7, 13, 0.95)';
  ctx.fillRect(-0.85 * dpr, -5 * dpr, 1.7 * dpr, 2.9 * dpr);

  ctx.restore();
}

/**
 * A passenger on the map: a ringed dot in the chrome's violet — nothing else on this map uses
 * it — for someone waiting, and the same ring with a hollow centre and a dark bar for where they
 * are going. Fixed pixel size, same reason as the RUSH mark.
 */
function drawPassengerMark(ctx: CanvasRenderingContext2D, cx: number, cz: number, dpr: number, kind: ActivityMarkKind): void {
  const r = 5.6 * dpr;
  const VIOLET = '#c9a4ff';

  ctx.save();
  ctx.translate(cx, cz);

  ctx.fillStyle = 'rgba(5, 7, 13, 0.85)';
  ctx.beginPath();
  ctx.arc(0, 0, r + 1.6 * dpr, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = VIOLET;
  ctx.shadowColor = VIOLET;
  ctx.shadowBlur = 6 * dpr;
  ctx.lineWidth = 1.5 * dpr;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();

  if (kind === 'passenger') {
    // A head and shoulders, four strokes: reads as a person at ten pixels.
    ctx.fillStyle = VIOLET;
    ctx.beginPath();
    ctx.arc(0, -1.6 * dpr, 1.6 * dpr, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 2.6 * dpr, 2.6 * dpr, Math.PI, 0);
    ctx.fill();
  } else {
    // The destination: a flag on the ring.
    ctx.lineWidth = 1.6 * dpr;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-1.6 * dpr, 3 * dpr);
    ctx.lineTo(-1.6 * dpr, -3 * dpr);
    ctx.lineTo(2.4 * dpr, -1.6 * dpr);
    ctx.lineTo(-1.6 * dpr, 0);
    ctx.stroke();
  }

  ctx.restore();
}

function drawBase(
  ctx: CanvasRenderingContext2D,
  data: MinimapData,
  race: RaceCourse | null,
  px: (x: number) => number,
  pz: (z: number) => number,
  scale: number,
  dpr: number,
): void {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // The bay, under everything.
  if (data.water) {
    const w = data.water;
    ctx.fillStyle = 'rgba(36, 92, 140, 0.35)';
    ctx.fillRect(px(w.minX), pz(w.minZ), (w.maxX - w.minX) * scale, (w.maxZ - w.minZ) * scale);
  }
  // The lakes, the same water: a park's shore is a contour rather than a rectangle.
  if (data.lakes) {
    ctx.fillStyle = 'rgba(36, 92, 140, 0.45)';
    for (const lake of data.lakes) {
      if (lake.length < 3) continue;
      ctx.beginPath();
      ctx.moveTo(px(lake[0].x), pz(lake[0].z));
      for (let i = 1; i < lake.length; i++) ctx.lineTo(px(lake[i].x), pz(lake[i].z));
      ctx.closePath();
      ctx.fill();
    }
  }

  // Road body, then a thin cold outline so the network reads against the dark panel.
  // Viaducts and the skyway are drawn last, in a muted magenta, so they read as a layer above
  // without competing with the activity marks and the player - they are scenery, not a route.
  const passes: Array<{ stroke: string; widen: number }> = [
    { stroke: 'rgba(79, 243, 255, 0.35)', widen: 1.6 * dpr },
    { stroke: 'rgba(214, 232, 255, 0.55)', widen: 0 },
  ];
  for (const pass of passes) {
    ctx.strokeStyle = pass.stroke;
    ctx.fillStyle = pass.stroke;
    for (const r of data.rects) {
      const x = px(r.minX);
      const z = pz(r.minZ);
      const w = (r.maxX - r.minX) * scale;
      const h = (r.maxZ - r.minZ) * scale;
      ctx.fillRect(x - pass.widen / 2, z - pass.widen / 2, w + pass.widen, h + pass.widen);
    }
    for (const rb of data.ribbons) {
      if (rb.hidden || rb.elevated || rb.points.length < 2) continue;
      ctx.lineWidth = Math.max(1.5 * dpr, rb.width * scale + pass.widen);
      ctx.beginPath();
      ctx.moveTo(px(rb.points[0].x), pz(rb.points[0].z));
      for (let i = 1; i < rb.points.length; i++) ctx.lineTo(px(rb.points[i].x), pz(rb.points[i].z));
      if (rb.closed) ctx.closePath();
      ctx.stroke();
    }
  }
  for (const rb of data.ribbons) {
    if (rb.hidden || !rb.elevated || rb.points.length < 2) continue;
    ctx.strokeStyle = 'rgba(255, 61, 240, 0.32)';
    ctx.lineWidth = Math.max(1 * dpr, rb.width * scale * 0.45);
    ctx.beginPath();
    ctx.moveTo(px(rb.points[0].x), pz(rb.points[0].z));
    for (let i = 1; i < rb.points.length; i++) ctx.lineTo(px(rb.points[i].x), pz(rb.points[i].z));
    if (rb.closed) ctx.closePath();
    ctx.stroke();
  }

  if (race) {
    // Checkpoints in cyan, the line in magenta, both drawn a little longer than the road.
    race.gates.forEach((g, i) => {
      ctx.strokeStyle = i === 0 ? '#ff3df0' : 'rgba(79, 243, 255, 0.9)';
      ctx.lineWidth = (i === 0 ? 2.4 : 1.6) * dpr;
      ctx.beginPath();
      ctx.moveTo(px(g.ax), pz(g.az));
      ctx.lineTo(px(g.bx), pz(g.bz));
      ctx.stroke();
    });
  }
}
