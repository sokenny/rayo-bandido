import * as THREE from 'three';
import { ringNext } from './shapes';

/**
 * Floating "+X" score pops at the point of a kill, the way a shooter rewards a takedown:
 * the number punches in slightly oversized, drifts up off the wreck and fades.
 *
 * One pooled `THREE.Sprite` per slot (billboarded by Three, so the number always faces the
 * camera) with its own small canvas texture. The label is only re-rasterized when a slot is
 * spawned, never per frame, and the pool allocates nothing after creation.
 *
 * BUDGET: `SCORE_POPUP_SLOTS` draw calls, and only while pops are on screen - every sprite
 * hides itself when its timer runs out. Depth testing is off so the number is never buried
 * inside the explosion it belongs to.
 */
export const SCORE_POPUP_SLOTS = 5;

/** Seconds a pop stays on screen. Long enough to read at speed, short enough to not litter. */
const LIFE = 1.1;
/** Height above the ground the number starts at (roughly roof height of an electric car). */
const START_Y = 1.9;
/** Metres the number rises across its life. */
const RISE = 1.6;
/** World height of the text at scale 1 (m). */
const TEXT_HEIGHT = 0.95;
/** Random horizontal scatter (m) so two pops in the same spot do not stack exactly. */
const SCATTER = 0.45;

/** Label canvas. 4:1 keeps "+100" comfortable with room for larger rewards. */
const CANVAS_W = 512;
const CANVAS_H = 128;
const FONT_MAX_PX = 92;
const TEXT_ASPECT = CANVAS_W / CANVAS_H;

/** Pop-in overshoot: the number briefly overshoots its size, which reads as impact. */
const POP_IN = 0.1;
const SETTLE = 0.24;
const OVERSHOOT = 1.18;
const START_SCALE = 0.55;
/** Fraction of the life spent at full opacity before the fade starts. */
const HOLD = 0.55;

/** The reward colour, matching the HUD money flash (`--rb-acid`) rather than lightning cyan. */
const ACID = '#a8ff3e';

/** `+1500` style label for a reward amount. Non-finite or negative amounts collapse to `+0`. */
export function formatPoints(amount: number): string {
  const n = Number.isFinite(amount) ? Math.max(0, Math.round(amount)) : 0;
  return `+${n}`;
}

/** Scale multiplier over the normalized life `k` (0 = just spawned, 1 = gone). */
export function popupScale(k: number): number {
  if (k < POP_IN) return START_SCALE + (OVERSHOOT - START_SCALE) * (k / POP_IN);
  if (k < SETTLE) return OVERSHOOT + (1 - OVERSHOOT) * ((k - POP_IN) / (SETTLE - POP_IN));
  return 1;
}

/** Opacity over the normalized life `k`. Full until `HOLD`, then a smooth fall to 0. */
export function popupAlpha(k: number): number {
  if (k <= HOLD) return 1;
  const f = 1 - (k - HOLD) / (1 - HOLD);
  return f * f;
}

/** Metres risen at the normalized life `k`. Fast off the wreck, then coasting. */
export function popupRise(k: number): number {
  const ease = 1 - (1 - k) * (1 - k);
  return RISE * ease;
}

export interface ScorePopups {
  spawn(x: number, z: number, amount: number): void;
  update(dt: number): void;
  reset(): void;
  dispose(): void;
}

interface Slot {
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
  texture: THREE.CanvasTexture;
  ctx: CanvasRenderingContext2D | null;
  timer: number;
  x: number;
  z: number;
}

function drawLabel(ctx: CanvasRenderingContext2D, text: string): void {
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Shrink to fit rather than clipping, so an unexpectedly large reward still reads.
  let px = FONT_MAX_PX;
  const font = (size: number) => `italic 800 ${size}px system-ui, "Segoe UI", Roboto, Arial, sans-serif`;
  ctx.font = font(px);
  const maxWidth = CANVAS_W - 48;
  while (px > 24 && ctx.measureText(text).width > maxWidth) {
    px -= 6;
    ctx.font = font(px);
  }

  const cx = CANVAS_W / 2;
  const cy = CANVAS_H / 2;

  // Dark casing first: the number has to survive over neon signs and over the explosion.
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(4, 8, 16, 0.94)';
  ctx.lineWidth = px * 0.2;
  ctx.shadowColor = 'rgba(168, 255, 62, 0.85)';
  ctx.shadowBlur = px * 0.5;
  ctx.strokeText(text, cx, cy);
  ctx.shadowBlur = 0;
  ctx.strokeText(text, cx, cy);

  const gradient = ctx.createLinearGradient(0, cy - px * 0.55, 0, cy + px * 0.55);
  gradient.addColorStop(0, '#ffffff');
  gradient.addColorStop(0.45, '#e8ffb4');
  gradient.addColorStop(1, ACID);
  ctx.fillStyle = gradient;
  ctx.fillText(text, cx, cy);
}

export function createScorePopups(parent: THREE.Object3D): ScorePopups {
  const slots: Slot[] = [];
  for (let i = 0; i < SCORE_POPUP_SLOTS; i++) {
    const canvas = document.createElement('canvas');
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    const texture = new THREE.CanvasTexture(canvas);
    texture.name = `fx-score-popup-${i}`;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;

    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      opacity: 1,
      depthTest: false,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.name = `fx-score-popup-${i}`;
    sprite.renderOrder = 12;
    sprite.visible = false;
    sprite.scale.set(TEXT_HEIGHT * TEXT_ASPECT, TEXT_HEIGHT, 1);
    parent.add(sprite);

    slots.push({
      sprite,
      material,
      texture,
      ctx: canvas.getContext('2d'),
      timer: 0,
      x: 0,
      z: 0,
    });
  }

  let head = 0;

  function hide(slot: Slot): void {
    slot.timer = 0;
    slot.sprite.visible = false;
  }

  return {
    spawn(x, z, amount) {
      const slot = slots[head];
      head = ringNext(head, SCORE_POPUP_SLOTS);
      if (slot.ctx) {
        drawLabel(slot.ctx, formatPoints(amount));
        slot.texture.needsUpdate = true;
      }
      slot.timer = LIFE;
      slot.x = x + (Math.random() - 0.5) * 2 * SCATTER;
      slot.z = z + (Math.random() - 0.5) * 2 * SCATTER;
      const scale = popupScale(0);
      slot.sprite.position.set(slot.x, START_Y, slot.z);
      slot.sprite.scale.set(TEXT_HEIGHT * TEXT_ASPECT * scale, TEXT_HEIGHT * scale, 1);
      slot.material.opacity = popupAlpha(0);
      slot.sprite.visible = true;
    },

    update(dt) {
      for (let i = 0; i < SCORE_POPUP_SLOTS; i++) {
        const slot = slots[i];
        if (slot.timer <= 0) continue;
        const next = slot.timer - dt;
        if (next <= 0) {
          hide(slot);
          continue;
        }
        slot.timer = next;
        const k = 1 - next / LIFE;
        const scale = popupScale(k);
        slot.sprite.position.set(slot.x, START_Y + popupRise(k), slot.z);
        slot.sprite.scale.set(TEXT_HEIGHT * TEXT_ASPECT * scale, TEXT_HEIGHT * scale, 1);
        slot.material.opacity = popupAlpha(k);
      }
    },

    reset() {
      for (let i = 0; i < SCORE_POPUP_SLOTS; i++) hide(slots[i]);
      head = 0;
    },

    dispose() {
      for (let i = 0; i < SCORE_POPUP_SLOTS; i++) {
        const slot = slots[i];
        parent.remove(slot.sprite);
        slot.material.dispose();
        slot.texture.dispose();
      }
      slots.length = 0;
    },
  };
}
