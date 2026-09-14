import type { ScreenDesign, ScreenShape } from '../../../content/screens';
import { PAL } from './palette';
import { makeRng } from './meshBuilder';

/**
 * The placeholder ads on the city's screens, painted into the screen atlas at start-up
 * (`screenAtlas.ts`). Stand-ins until Juan's own images and videos take the channels over
 * (`content/screens.ts`), so they aim at the mood of the reference rather than at detail: one
 * loud idea per frame, big type, a key colour, a black ground the LED grid can sit in.
 *
 * The colours are the city's night (teal, cold white, amber, red, a hard yellow) and never
 * violet or pink. The brands are invented. The copy is the city's street Spanish with Japanese
 * on top, the way the signs are.
 *
 * Every painter draws into (0, 0)-(w, h); the atlas has already clipped and translated to the
 * frame. Holograms are drawn light-on-black: they are blended additively, so black is air.
 */

const SANS = '"Arial Black", "Helvetica Neue", Arial, sans-serif';
const COND = '"Arial Narrow", "Helvetica Neue", Arial, sans-serif';
const CJK = '"Noto Sans JP","Yu Gothic","Hiragino Kaku Gothic ProN","MS Gothic","Meiryo",sans-serif';

const TEAL = '#3ff0e8';
const AMBER = '#ffb347';
const YELLOW = '#ffd23f';
const RED = '#ff3d2e';
const WHITE = '#eef8ff';
const INK = '#04070a';

type Ctx = CanvasRenderingContext2D;

export function paintScreenDesign(ctx: Ctx, design: ScreenDesign, page: number, w: number, h: number, shape: ScreenShape): void {
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, w, h);
  PAINTERS[design](ctx, page, w, h, shape);
}

const PAINTERS: Record<ScreenDesign, (ctx: Ctx, page: number, w: number, h: number, shape: ScreenShape) => void> = {
  cola,
  ramen,
  motors,
  news,
  neuro,
  bank,
  volt,
  idol,
  kanji,
  pills,
  ticker: (ctx, _p, w, h) => tickerStrip(ctx, w, h, '#050300', AMBER, 'BANDIDO METRO 23:47  ◆  LLUVIA ÁCIDA 80%  ◆  RAYO COLA ▲2.4  ◆  HIKARI ▼0.8  ◆  NEUROLINK ▲5.1  ◆  夜市場 OPEN  ◆  '),
  alert: (ctx, _p, w, h) => tickerStrip(ctx, w, h, '#2a0404', WHITE, 'ALERTA  ▲  TOQUE DE QUEDA 02:00  ▲  REPORTA ACTIVIDAD SOSPECHOSA  ▲  警告  ▲  ZONA VIGILADA  ▲  '),
  holoKoi,
  holoBolt,
  holoData: (ctx, _p, w, h) => holoColumnArt(ctx, w, h, 0),
  holoColumn: (ctx, _p, w, h) => holoColumnArt(ctx, w, h, 1),
};

/* ------------------------------------------------------------------ helpers */

function hex(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`;
}

function vGradient(ctx: Ctx, w: number, h: number, stops: Array<[number, string]>): void {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  for (const [t, c] of stops) g.addColorStop(t, c);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function radial(ctx: Ctx, x: number, y: number, r: number, inner: string, outer: string): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

interface TextOpts {
  size: number;
  color: string;
  font?: string;
  weight?: number | string;
  align?: CanvasTextAlign;
  base?: CanvasTextBaseline;
  glow?: number;
  glowColor?: string;
  /** Squeeze to this width when the text would run wider. */
  maxW?: number;
  italic?: boolean;
}

function text(ctx: Ctx, s: string, x: number, y: number, o: TextOpts): void {
  ctx.save();
  ctx.font = `${o.italic ? 'italic ' : ''}${o.weight ?? 900} ${o.size}px ${o.font ?? SANS}`;
  ctx.textAlign = o.align ?? 'left';
  ctx.textBaseline = o.base ?? 'alphabetic';
  if (o.glow) {
    ctx.shadowColor = o.glowColor ?? o.color;
    ctx.shadowBlur = o.glow;
  }
  ctx.fillStyle = o.color;
  if (o.maxW) {
    const m = ctx.measureText(s).width;
    if (m > o.maxW) {
      // Squeezed about the anchor, which the alignment already measures from.
      const k = o.maxW / m;
      ctx.translate(x, y);
      ctx.scale(k, 1);
      ctx.fillText(s, 0, 0);
      ctx.restore();
      return;
    }
  }
  ctx.fillText(s, x, y);
  ctx.restore();
}

function stripes(ctx: Ctx, x: number, y: number, w: number, h: number, a: string, b: string, step: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = a;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = b;
  for (let i = -h; i < w + h; i += step * 2) {
    ctx.beginPath();
    ctx.moveTo(x + i, y + h);
    ctx.lineTo(x + i + step, y + h);
    ctx.lineTo(x + i + step + h, y);
    ctx.lineTo(x + i + h, y);
    ctx.fill();
  }
  ctx.restore();
}

/** A lightning bolt in a (x, y, w, h) box. */
function bolt(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  const p: Array<[number, number]> = [
    [0.62, 0],
    [0.12, 0.56],
    [0.46, 0.56],
    [0.3, 1],
    [0.9, 0.38],
    [0.54, 0.38],
    [0.78, 0],
  ];
  ctx.beginPath();
  p.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(x + px * w, y + py * h) : ctx.lineTo(x + px * w, y + py * h)));
  ctx.closePath();
}

/** A drinks can standing at (cx, bottom). */
function can(ctx: Ctx, cx: number, bottom: number, cw: number, ch: number, body: string, band: string, mark: string): void {
  const x = cx - cw / 2;
  const top = bottom - ch;
  const rim = cw * 0.16;
  const g = ctx.createLinearGradient(x, 0, x + cw, 0);
  g.addColorStop(0, shade(body, 0.45));
  g.addColorStop(0.35, body);
  g.addColorStop(0.55, shade(body, 1.35));
  g.addColorStop(1, shade(body, 0.35));
  ctx.fillStyle = g;
  ctx.fillRect(x, top + rim, cw, ch - rim * 2);
  ctx.beginPath();
  ctx.ellipse(cx, bottom - rim, cw / 2, rim, 0, 0, Math.PI);
  ctx.fill();
  ctx.fillStyle = '#c9d3d8';
  ctx.beginPath();
  ctx.ellipse(cx, top + rim, cw / 2, rim, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#7d8a90';
  ctx.beginPath();
  ctx.ellipse(cx, top + rim, cw / 2.6, rim * 0.62, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = band;
  ctx.fillRect(x, top + ch * 0.3, cw, ch * 0.08);
  ctx.fillStyle = mark;
  bolt(ctx, cx - cw * 0.26, top + ch * 0.42, cw * 0.52, ch * 0.34);
  ctx.fill();
}

/** Multiplies a #rrggbb colour's brightness. */
function shade(c: string, k: number): string {
  const n = parseInt(c.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * k));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * k));
  const b = Math.min(255, Math.round((n & 255) * k));
  return `rgb(${r},${g},${b})`;
}

/** Faint horizontal lines and a few dropped rows: a board that has been on for years. */
function wear(ctx: Ctx, w: number, h: number, seed: number): void {
  const rng = makeRng(seed);
  ctx.save();
  ctx.globalAlpha = 0.08;
  ctx.fillStyle = '#000000';
  for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
  ctx.globalAlpha = 0.5;
  for (let i = 0; i < 2; i++) ctx.fillRect(0, rng() * h, w, 1 + rng() * 2);
  ctx.restore();
}

/* ------------------------------------------------------------------ wide boards */

function cola(ctx: Ctx, page: number, w: number, h: number): void {
  if (page === 0) {
    radial(ctx, w * 0.72, h * 0.5, w * 0.7, '#e21c16', '#3a0303');
    ctx.fillStyle = 'rgba(255,210,63,0.35)';
    bolt(ctx, w * 0.5, -h * 0.1, w * 0.45, h * 1.2);
    ctx.fill();
    can(ctx, w * 0.76, h * 0.94, w * 0.2, h * 0.78, '#d0140f', WHITE, YELLOW);
    text(ctx, 'RAYO', 22, h * 0.42, { size: 92, color: WHITE, glow: 18, glowColor: '#ff6040' });
    text(ctx, 'COLA', 22, h * 0.72, { size: 92, color: YELLOW, glow: 18, glowColor: '#ff9040' });
    text(ctx, '¡SIENTE LA DESCARGA!', 26, h * 0.9, { size: 22, color: WHITE, font: COND, weight: 700, maxW: w * 0.58 });
  } else if (page === 1) {
    vGradient(ctx, w, h, [[0, '#120302'], [1, '#000000']]);
    ctx.fillStyle = YELLOW;
    ctx.shadowColor = '#ffae00';
    ctx.shadowBlur = 30;
    bolt(ctx, w * 0.06, h * 0.08, h * 0.62, h * 0.84);
    ctx.fill();
    ctx.shadowBlur = 0;
    text(ctx, '100%', w * 0.4, h * 0.42, { size: 84, color: WHITE, glow: 10 });
    text(ctx, 'ELÉCTRICA', w * 0.4, h * 0.64, { size: 50, color: RED, glow: 12, maxW: w * 0.57 });
    text(ctx, 'ラヨ・コーラ', w * 0.4, h * 0.86, { size: 34, color: YELLOW, font: CJK, weight: 700 });
  } else {
    stripes(ctx, 0, 0, w, h, '#b50f0b', '#8d0906', 26);
    text(ctx, '2x1', w * 0.05, h * 0.7, { size: 150, color: YELLOW, glow: 20, glowColor: '#000000' });
    text(ctx, 'SOLO HOY', w * 0.62, h * 0.38, { size: 44, color: WHITE, maxW: w * 0.34 });
    text(ctx, 'EN TODO EL METRO', w * 0.62, h * 0.52, { size: 20, color: WHITE, font: COND, weight: 700, maxW: w * 0.34 });
    can(ctx, w * 0.8, h * 0.95, w * 0.12, h * 0.36, '#d0140f', WHITE, YELLOW);
  }
  wear(ctx, w, h, 11 + page);
}

function ramen(ctx: Ctx, page: number, w: number, h: number): void {
  if (page === 0) {
    radial(ctx, w * 0.62, h * 0.62, w * 0.6, '#5a2a06', '#0d0501');
    // Steam.
    ctx.strokeStyle = 'rgba(255,240,220,0.35)';
    ctx.lineWidth = 6;
    for (let i = 0; i < 3; i++) {
      const x = w * (0.52 + i * 0.1);
      ctx.beginPath();
      ctx.moveTo(x, h * 0.5);
      ctx.bezierCurveTo(x - 20, h * 0.36, x + 20, h * 0.26, x, h * 0.1);
      ctx.stroke();
    }
    // Bowl.
    ctx.fillStyle = '#b21d12';
    ctx.beginPath();
    ctx.ellipse(w * 0.62, h * 0.58, w * 0.25, h * 0.33, 0, 0, Math.PI);
    ctx.fill();
    ctx.fillStyle = '#ffcf7a';
    ctx.beginPath();
    ctx.ellipse(w * 0.62, h * 0.58, w * 0.25, h * 0.07, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#e8a642';
    ctx.lineWidth = 3;
    for (let i = 0; i < 7; i++) {
      ctx.beginPath();
      ctx.ellipse(w * 0.62, h * 0.58, w * (0.05 + i * 0.028), h * 0.03, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.strokeStyle = '#2a1608';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(w * 0.5, h * 0.62);
    ctx.lineTo(w * 0.95, h * 0.12);
    ctx.moveTo(w * 0.55, h * 0.64);
    ctx.lineTo(w * 0.98, h * 0.22);
    ctx.stroke();
    text(ctx, '怪獣', w * 0.04, h * 0.44, { size: 86, color: WHITE, font: CJK, glow: 14, glowColor: AMBER });
    text(ctx, 'KAIJU RAMEN', w * 0.05, h * 0.66, { size: 34, color: AMBER, glow: 8, maxW: w * 0.38 });
    stripes(ctx, 0, h * 0.8, w, h * 0.2, '#ffb347', '#e39322', 18);
    text(ctx, 'ABIERTO 24H  ·  ラーメン', w * 0.5, h * 0.94, { size: 26, color: INK, align: 'center', font: CJK, weight: 900, maxW: w * 0.9 });
  } else {
    vGradient(ctx, w, h, [[0, '#06141c'], [0.7, '#123846'], [1, '#050b0e']]);
    // Skyline.
    const rng = makeRng(77);
    ctx.fillStyle = '#02080b';
    for (let x = 0; x < w; x += 22 + rng() * 20) ctx.fillRect(x, h * (0.45 + rng() * 0.3), 20 + rng() * 22, h);
    // The kaiju: a hunched silhouette with a noodle.
    ctx.fillStyle = '#0e4a3e';
    ctx.beginPath();
    ctx.moveTo(w * 0.52, h);
    ctx.quadraticCurveTo(w * 0.5, h * 0.35, w * 0.66, h * 0.22);
    ctx.quadraticCurveTo(w * 0.8, h * 0.14, w * 0.86, h * 0.3);
    ctx.lineTo(w * 0.78, h * 0.38);
    ctx.quadraticCurveTo(w * 0.8, h * 0.6, w * 0.9, h);
    ctx.fill();
    ctx.fillStyle = YELLOW;
    ctx.fillRect(w * 0.72, h * 0.24, 10, 6);
    ctx.strokeStyle = '#ffd98a';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(w * 0.84, h * 0.34);
    ctx.bezierCurveTo(w * 0.9, h * 0.6, w * 0.78, h * 0.7, w * 0.86, h);
    ctx.stroke();
    text(ctx, '¡MÁS GRANDE', w * 0.04, h * 0.36, { size: 44, color: WHITE, glow: 10, maxW: w * 0.5 });
    text(ctx, 'QUE TU HAMBRE!', w * 0.04, h * 0.56, { size: 44, color: AMBER, glow: 10, maxW: w * 0.5 });
    text(ctx, 'KAIJU RAMEN', w * 0.04, h * 0.84, { size: 30, color: TEAL, maxW: w * 0.44 });
  }
  wear(ctx, w, h, 21 + page);
}

function motors(ctx: Ctx, page: number, w: number, h: number): void {
  vGradient(ctx, w, h, [[0, '#010608'], [0.6, '#03161b'], [1, '#000000']]);
  // Perspective floor grid.
  ctx.strokeStyle = 'rgba(63,240,232,0.35)';
  ctx.lineWidth = 1.5;
  const hy = h * 0.58;
  for (let i = -10; i <= 10; i++) {
    ctx.beginPath();
    ctx.moveTo(w / 2, hy);
    ctx.lineTo(w / 2 + i * w * 0.12, h);
    ctx.stroke();
  }
  for (let i = 0; i < 7; i++) {
    const y = hy + (h - hy) * Math.pow(i / 6, 1.8);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  if (page === 0) {
    // A low wedge coupe, tail lights smearing.
    ctx.fillStyle = 'rgba(255,61,46,0.55)';
    ctx.fillRect(0, h * 0.66, w * 0.3, 5);
    ctx.fillRect(0, h * 0.7, w * 0.22, 3);
    ctx.fillStyle = '#0b1114';
    ctx.beginPath();
    ctx.moveTo(w * 0.28, h * 0.78);
    ctx.lineTo(w * 0.34, h * 0.6);
    ctx.lineTo(w * 0.52, h * 0.5);
    ctx.lineTo(w * 0.68, h * 0.52);
    ctx.lineTo(w * 0.86, h * 0.66);
    ctx.lineTo(w * 0.88, h * 0.78);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = TEAL;
    ctx.lineWidth = 3;
    ctx.shadowColor = TEAL;
    ctx.shadowBlur = 12;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = RED;
    ctx.fillRect(w * 0.285, h * 0.63, w * 0.05, 5);
    ctx.fillStyle = '#10181c';
    for (const x of [0.39, 0.77]) {
      ctx.beginPath();
      ctx.arc(w * x, h * 0.79, h * 0.08, 0, Math.PI * 2);
      ctx.fill();
    }
    text(ctx, 'BANDIDO MOTORS', w * 0.5, h * 0.22, { size: 50, color: WHITE, align: 'center', italic: true, glow: 12, glowColor: TEAL, maxW: w * 0.92 });
    text(ctx, 'TUNING  ·  NITRO  ·  DRIFT', w * 0.5, h * 0.36, { size: 22, color: TEAL, align: 'center', font: COND, weight: 700 });
  } else {
    // A boost gauge and the claim.
    ctx.lineWidth = 16;
    ctx.strokeStyle = '#123036';
    ctx.beginPath();
    ctx.arc(w * 0.25, h * 0.55, h * 0.34, Math.PI * 0.8, Math.PI * 2.2);
    ctx.stroke();
    ctx.strokeStyle = AMBER;
    ctx.shadowColor = AMBER;
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.arc(w * 0.25, h * 0.55, h * 0.34, Math.PI * 0.8, Math.PI * 1.95);
    ctx.stroke();
    ctx.shadowBlur = 0;
    text(ctx, 'N₂O', w * 0.25, h * 0.62, { size: 40, color: WHITE, align: 'center' });
    text(ctx, 'NITRO', w * 0.5, h * 0.4, { size: 70, color: WHITE, italic: true, glow: 10 });
    text(ctx, '+40%', w * 0.5, h * 0.72, { size: 92, color: AMBER, italic: true, glow: 18 });
    ctx.fillStyle = 'rgba(255,179,71,0.6)';
    for (let i = 0; i < 6; i++) ctx.fillRect(w * (0.52 + i * 0.07), h * 0.8, w * 0.04, 4);
  }
  wear(ctx, w, h, 31 + page);
}

function news(ctx: Ctx, page: number, w: number, h: number): void {
  if (page === 0) {
    vGradient(ctx, w, h, [[0, '#0a2a44'], [1, '#04101c']]);
    const rng = makeRng(404);
    ctx.fillStyle = 'rgba(160,210,255,0.18)';
    for (let x = 0; x < w; x += 26 + rng() * 18) {
      const bh = h * (0.2 + rng() * 0.45);
      ctx.fillRect(x, h * 0.72 - bh, 18 + rng() * 16, bh);
    }
    // Lightning over the skyline: the storm is the story.
    ctx.strokeStyle = '#e6f7ff';
    ctx.lineWidth = 3;
    ctx.shadowColor = '#9fdcff';
    ctx.shadowBlur = 16;
    ctx.beginPath();
    ctx.moveTo(w * 0.78, 0);
    ctx.lineTo(w * 0.72, h * 0.2);
    ctx.lineTo(w * 0.8, h * 0.26);
    ctx.lineTo(w * 0.7, h * 0.5);
    ctx.stroke();
    ctx.shadowBlur = 0;
    // The anchor.
    ctx.fillStyle = '#081420';
    ctx.beginPath();
    ctx.arc(w * 0.3, h * 0.34, h * 0.12, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(w * 0.3, h * 0.74, h * 0.28, h * 0.26, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = RED;
    ctx.fillRect(0, h * 0.7, w, h * 0.16);
    ctx.fillStyle = WHITE;
    ctx.fillRect(0, h * 0.86, w, h * 0.14);
    text(ctx, 'TORMENTA ELÉCTRICA SOBRE EL METRO', 14, h * 0.82, { size: 28, color: WHITE, maxW: w - 28 });
    text(ctx, 'NOTICIAS 24  ·  EN VIVO  ·  23:47', 14, h * 0.96, { size: 20, color: '#0a1a2a', font: COND, weight: 700, maxW: w - 28 });
    ctx.fillStyle = RED;
    ctx.beginPath();
    ctx.arc(w - 26, 24, 9, 0, Math.PI * 2);
    ctx.fill();
    text(ctx, 'EN VIVO', w - 42, 32, { size: 20, color: WHITE, align: 'right', font: COND, weight: 700 });
  } else {
    stripes(ctx, 0, 0, w, h * 0.14, '#111111', AMBER, 20);
    stripes(ctx, 0, h * 0.86, w, h * 0.14, '#111111', AMBER, 20);
    ctx.fillStyle = '#140a02';
    ctx.fillRect(0, h * 0.14, w, h * 0.72);
    text(ctx, 'SE BUSCA', w * 0.04, h * 0.42, { size: 70, color: AMBER, glow: 14, maxW: w * 0.56 });
    text(ctx, 'COUPÉ SIN PLACAS', w * 0.04, h * 0.58, { size: 26, color: WHITE, font: COND, weight: 700, maxW: w * 0.56 });
    text(ctx, 'RECOMPENSA  ₡ 50.000', w * 0.04, h * 0.76, { size: 30, color: RED, maxW: w * 0.56 });
    // A grainy camera still of the car.
    ctx.fillStyle = '#26211b';
    ctx.fillRect(w * 0.62, h * 0.2, w * 0.34, h * 0.6);
    ctx.fillStyle = '#0a0806';
    ctx.beginPath();
    ctx.moveTo(w * 0.64, h * 0.64);
    ctx.lineTo(w * 0.7, h * 0.46);
    ctx.lineTo(w * 0.86, h * 0.44);
    ctx.lineTo(w * 0.94, h * 0.64);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = RED;
    ctx.fillRect(w * 0.66, h * 0.56, 16, 6);
    ctx.fillRect(w * 0.88, h * 0.56, 16, 6);
    ctx.strokeStyle = AMBER;
    ctx.lineWidth = 2;
    ctx.strokeRect(w * 0.62, h * 0.2, w * 0.34, h * 0.6);
    text(ctx, 'CAM 07', w * 0.63, h * 0.27, { size: 14, color: AMBER, font: COND, weight: 700 });
  }
  wear(ctx, w, h, 41 + page);
}

function neuro(ctx: Ctx, page: number, w: number, h: number): void {
  vGradient(ctx, w, h, [[0, '#021a1c'], [1, '#010809']]);
  if (page === 0) {
    // A head in profile, wired.
    ctx.strokeStyle = TEAL;
    ctx.lineWidth = 4;
    ctx.shadowColor = TEAL;
    ctx.shadowBlur = 14;
    const cx = w * 0.72;
    const cy = h * 0.5;
    ctx.beginPath();
    ctx.moveTo(cx - 30, h * 0.98);
    ctx.lineTo(cx - 28, h * 0.78);
    ctx.quadraticCurveTo(cx - 100, h * 0.7, cx - 90, cy - 10);
    ctx.quadraticCurveTo(cx - 80, h * 0.05, cx + 10, h * 0.08);
    ctx.quadraticCurveTo(cx + 110, h * 0.12, cx + 90, cy);
    ctx.lineTo(cx + 104, cy + 30);
    ctx.lineTo(cx + 84, cy + 36);
    ctx.quadraticCurveTo(cx + 90, h * 0.8, cx + 40, h * 0.8);
    ctx.lineTo(cx + 40, h * 0.98);
    ctx.stroke();
    ctx.shadowBlur = 0;
    const rng = makeRng(512);
    const nodes: Array<[number, number]> = [];
    for (let i = 0; i < 9; i++) nodes.push([cx - 60 + rng() * 110, h * 0.16 + rng() * h * 0.36]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(63,240,232,0.7)';
    for (let i = 1; i < nodes.length; i++) {
      ctx.beginPath();
      ctx.moveTo(nodes[i - 1][0], nodes[i - 1][1]);
      ctx.lineTo(nodes[i][0], nodes[i - 1][1]);
      ctx.lineTo(nodes[i][0], nodes[i][1]);
      ctx.stroke();
    }
    ctx.fillStyle = WHITE;
    for (const [x, y] of nodes) ctx.fillRect(x - 4, y - 4, 8, 8);
    text(ctx, 'NEUROLINK+', w * 0.04, h * 0.4, { size: 54, color: WHITE, glow: 10, glowColor: TEAL, maxW: w * 0.56 });
    text(ctx, 'MEJÓRATE.', w * 0.04, h * 0.62, { size: 44, color: TEAL, maxW: w * 0.56 });
    text(ctx, '脳を アップグレード', w * 0.04, h * 0.84, { size: 26, color: 'rgba(238,248,255,0.8)', font: CJK, weight: 700, maxW: w * 0.56 });
  } else {
    const rng = makeRng(900);
    ctx.font = `700 16px ${COND}`;
    ctx.fillStyle = 'rgba(63,240,232,0.25)';
    for (let x = 8; x < w; x += 18) for (let y = 16; y < h; y += 18) if (rng() < 0.5) ctx.fillText(rng() < 0.5 ? '0' : '1', x, y);
    text(ctx, 'MEMORIA', w / 2, h * 0.36, { size: 58, color: WHITE, align: 'center', glow: 10 });
    text(ctx, 'ILIMITADA', w / 2, h * 0.58, { size: 58, color: TEAL, align: 'center', glow: 12 });
    ctx.strokeStyle = WHITE;
    ctx.lineWidth = 3;
    ctx.strokeRect(w * 0.12, h * 0.7, w * 0.76, h * 0.12);
    ctx.fillStyle = TEAL;
    ctx.fillRect(w * 0.13, h * 0.72, w * 0.74 * 0.98, h * 0.08);
    text(ctx, '98%', w * 0.5, h * 0.93, { size: 22, color: WHITE, align: 'center', font: COND, weight: 700 });
  }
  wear(ctx, w, h, 51 + page);
}

function bank(ctx: Ctx, _page: number, w: number, h: number): void {
  vGradient(ctx, w, h, [[0, '#0f5f66'], [1, '#03191c']]);
  ctx.strokeStyle = 'rgba(238,248,255,0.12)';
  ctx.lineWidth = 1;
  for (let x = 0; x < w; x += 25) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  // Rising line.
  ctx.strokeStyle = WHITE;
  ctx.lineWidth = 4;
  ctx.shadowColor = WHITE;
  ctx.shadowBlur = 10;
  ctx.beginPath();
  const rng = makeRng(8);
  for (let i = 0; i <= 12; i++) {
    const x = w * (0.42 + (i / 12) * 0.54);
    const y = h * (0.78 - (i / 12) * 0.5 + (rng() - 0.5) * 0.1);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = WHITE;
  ctx.beginPath();
  ctx.arc(w * 0.2, h * 0.42, h * 0.26, 0, Math.PI * 2);
  ctx.fill();
  text(ctx, '光', w * 0.2, h * 0.52, { size: 96, color: '#0f5f66', align: 'center', font: CJK });
  text(ctx, 'HIKARI BANK', w * 0.04, h * 0.86, { size: 34, color: WHITE, maxW: w * 0.5 });
  text(ctx, 'TU FUTURO, ASEGURADO.', w * 0.96, h * 0.94, { size: 20, color: 'rgba(238,248,255,0.85)', align: 'right', font: COND, weight: 700 });
}

/* ------------------------------------------------------------------ tall banners */

function volt(ctx: Ctx, page: number, w: number, h: number): void {
  if (page === 0) {
    stripes(ctx, 0, 0, w, h, '#0a0a06', '#171405', 16);
    stripes(ctx, 0, 0, w, h * 0.08, '#111111', YELLOW, 14);
    stripes(ctx, 0, h * 0.92, w, h * 0.08, '#111111', YELLOW, 14);
    text(ctx, 'VOLT', w / 2, h * 0.24, { size: 84, color: YELLOW, align: 'center', glow: 20, maxW: w * 0.92 });
    can(ctx, w / 2, h * 0.8, w * 0.42, h * 0.46, '#1a1a1a', YELLOW, YELLOW);
    text(ctx, '+300% VOLTAJE', w / 2, h * 0.88, { size: 26, color: WHITE, align: 'center', font: COND, weight: 700, maxW: w * 0.9 });
  } else {
    radial(ctx, w / 2, h * 0.42, h * 0.5, '#3a3000', '#000000');
    ctx.fillStyle = YELLOW;
    ctx.shadowColor = '#ffae00';
    ctx.shadowBlur = 36;
    bolt(ctx, w * 0.1, h * 0.08, w * 0.8, h * 0.6);
    ctx.fill();
    ctx.shadowBlur = 0;
    text(ctx, '¡NO', w / 2, h * 0.8, { size: 62, color: WHITE, align: 'center' });
    text(ctx, 'DUERMAS!', w / 2, h * 0.93, { size: 44, color: YELLOW, align: 'center', maxW: w * 0.92 });
  }
  wear(ctx, w, h, 61 + page);
}

function idol(ctx: Ctx, page: number, w: number, h: number): void {
  vGradient(ctx, w, h, [[0, '#2a0605'], [0.55, '#b3261a'], [1, '#ff9a3c']]);
  if (page === 0) {
    // Concentric stage rings.
    ctx.strokeStyle = 'rgba(255,230,190,0.25)';
    ctx.lineWidth = 3;
    for (let i = 1; i < 7; i++) {
      ctx.beginPath();
      ctx.arc(w / 2, h * 0.45, i * 34, 0, Math.PI * 2);
      ctx.stroke();
    }
    // The singer: long hair, a microphone.
    ctx.fillStyle = '#12060a';
    ctx.beginPath();
    ctx.arc(w * 0.5, h * 0.3, w * 0.13, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(w * 0.34, h * 0.3);
    ctx.quadraticCurveTo(w * 0.28, h * 0.55, w * 0.36, h * 0.62);
    ctx.lineTo(w * 0.64, h * 0.62);
    ctx.quadraticCurveTo(w * 0.72, h * 0.55, w * 0.66, h * 0.3);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(w * 0.26, h);
    ctx.quadraticCurveTo(w * 0.3, h * 0.56, w * 0.5, h * 0.52);
    ctx.quadraticCurveTo(w * 0.7, h * 0.56, w * 0.74, h);
    ctx.fill();
    ctx.strokeStyle = '#12060a';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(w * 0.58, h * 0.52);
    ctx.lineTo(w * 0.52, h * 0.36);
    ctx.stroke();
    text(ctx, 'AIKO', w / 2, h * 0.14, { size: 70, color: WHITE, align: 'center', glow: 16, glowColor: '#ffcf8a', maxW: w * 0.92 });
    text(ctx, 'EN VIVO · 夜', w / 2, h * 0.95, { size: 28, color: WHITE, align: 'center', font: CJK, weight: 900, maxW: w * 0.92 });
  } else {
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, w, h);
    const rng = makeRng(333);
    ctx.fillStyle = WHITE;
    for (let i = 0; i < 40; i++) {
      const x = rng() * w;
      const y = rng() * h;
      const s = 1 + rng() * 3;
      ctx.fillRect(x - s * 3, y, s * 6, 1.5);
      ctx.fillRect(x, y - s * 3, 1.5, s * 6);
    }
    text(ctx, 'アイコ', w / 2, h * 0.32, { size: 60, color: WHITE, align: 'center', font: CJK, glow: 12, maxW: w * 0.92 });
    text(ctx, 'TOUR', w / 2, h * 0.52, { size: 64, color: AMBER, align: 'center', glow: 10 });
    text(ctx, '2087', w / 2, h * 0.68, { size: 64, color: WHITE, align: 'center', glow: 10 });
    text(ctx, 'ESTADIO DEL PUERTO', w / 2, h * 0.84, { size: 22, color: WHITE, align: 'center', font: COND, weight: 700, maxW: w * 0.9 });
  }
  wear(ctx, w, h, 71 + page);
}

function kanji(ctx: Ctx, page: number, w: number, h: number): void {
  const inverse = page === 1;
  if (inverse) vGradient(ctx, w, h, [[0, '#6ff6ee'], [1, '#1bb3ad']]);
  const glyphs = inverse ? ['夜', '市', '場'] : ['電', '脳', '街'];
  for (let i = 0; i < 3; i++) {
    text(ctx, glyphs[i], w / 2, h * (0.26 + i * 0.28), {
      size: 128,
      color: inverse ? INK : TEAL,
      align: 'center',
      base: 'middle',
      font: CJK,
      glow: inverse ? 0 : 26,
    });
  }
  ctx.fillStyle = RED;
  ctx.fillRect(w * 0.14, h * 0.9, w * 0.72, h * 0.07);
  text(ctx, inverse ? '↓ 100 M' : 'ABIERTO 24H', w / 2, h * 0.955, { size: 22, color: WHITE, align: 'center', font: COND, weight: 700 });
  if (!inverse) wear(ctx, w, h, 81);
}

function pills(ctx: Ctx, page: number, w: number, h: number): void {
  vGradient(ctx, w, h, [[0, '#eaf7f2'], [1, '#9fd6c6']]);
  if (page === 0) {
    ctx.save();
    ctx.translate(w / 2, h * 0.4);
    ctx.rotate(-0.5);
    const pw = w * 0.34;
    const ph = h * 0.36;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.roundRect(-pw / 2, -ph / 2, pw, ph, pw / 2);
    ctx.fill();
    ctx.fillStyle = '#138b82';
    ctx.beginPath();
    ctx.roundRect(-pw / 2, 0, pw, ph / 2, [0, 0, pw / 2, pw / 2]);
    ctx.fill();
    ctx.restore();
    text(ctx, 'CALMEX', w / 2, h * 0.76, { size: 52, color: '#0b3c3a', align: 'center', maxW: w * 0.92 });
    text(ctx, 'TOMA UNA.', w / 2, h * 0.86, { size: 28, color: '#0b3c3a', align: 'center', font: COND, weight: 700 });
    text(ctx, 'SONRÍE.', w / 2, h * 0.93, { size: 28, color: '#138b82', align: 'center', font: COND, weight: 700 });
  } else {
    ctx.fillStyle = '#0b3c3a';
    ctx.beginPath();
    ctx.arc(w * 0.36, h * 0.3, 14, 0, Math.PI * 2);
    ctx.arc(w * 0.64, h * 0.3, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 12;
    ctx.strokeStyle = '#0b3c3a';
    ctx.beginPath();
    ctx.arc(w / 2, h * 0.34, w * 0.26, 0.2 * Math.PI, 0.8 * Math.PI);
    ctx.stroke();
    text(ctx, 'TODO', w / 2, h * 0.66, { size: 56, color: '#0b3c3a', align: 'center' });
    text(ctx, 'ESTÁ', w / 2, h * 0.77, { size: 56, color: '#0b3c3a', align: 'center' });
    text(ctx, 'BIEN', w / 2, h * 0.88, { size: 56, color: '#138b82', align: 'center' });
  }
}

/* ------------------------------------------------------------------ tickers */

/**
 * A ticker the shader scrolls sideways and wraps. The message is squeezed to exactly the strip's
 * width, so its end meets its start without a seam.
 */
function tickerStrip(ctx: Ctx, w: number, h: number, ground: string, ink: string, message: string): void {
  ctx.fillStyle = ground;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.fillRect(0, 0, w, h * 0.12);
  ctx.fillRect(0, h * 0.88, w, h * 0.12);
  ctx.save();
  ctx.font = `900 ${Math.round(h * 0.56)}px ${CJK}`;
  ctx.textBaseline = 'middle';
  const m = ctx.measureText(message).width;
  ctx.scale(w / m, 1);
  ctx.shadowColor = ink;
  ctx.shadowBlur = 10;
  ctx.fillStyle = ink;
  ctx.fillText(message, 0, h * 0.53);
  ctx.restore();
}

/* ------------------------------------------------------------------ holograms */

/** A koi in three bends of the same stroke; light on black. */
function holoKoi(ctx: Ctx, page: number, w: number, h: number): void {
  const bend = [-1, 0, 1][page % 3];
  const cx = w / 2;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const spine = (t: number): [number, number] => [cx + Math.sin(t * Math.PI * 1.2) * bend * w * 0.14 * t, h * (0.1 + t * 0.78)];
  // Body.
  const left: Array<[number, number]> = [];
  const right: Array<[number, number]> = [];
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    const [x, y] = spine(t);
    const half = w * 0.2 * Math.sin(Math.min(1, t * 1.6 + 0.15) * Math.PI * 0.9) * (1 - t * 0.75);
    left.push([x - half, y]);
    right.push([x + half, y]);
  }
  const body = new Path2D();
  body.moveTo(left[0][0], left[0][1]);
  for (const [x, y] of left) body.lineTo(x, y);
  for (let i = right.length - 1; i >= 0; i--) body.lineTo(right[i][0], right[i][1]);
  body.closePath();
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(63,240,232,0.55)');
  g.addColorStop(1, 'rgba(63,160,255,0.2)');
  ctx.fillStyle = g;
  ctx.fill(body);
  ctx.strokeStyle = '#bffcff';
  ctx.lineWidth = 3;
  ctx.shadowColor = TEAL;
  ctx.shadowBlur = 16;
  ctx.stroke(body);
  // Tail fan.
  const [tx, ty] = spine(1);
  ctx.beginPath();
  ctx.moveTo(tx, ty - 10);
  ctx.quadraticCurveTo(tx - w * 0.2 - bend * 12, ty + h * 0.06, tx - w * 0.12 + bend * 10, ty + h * 0.11);
  ctx.lineTo(tx, ty + h * 0.03);
  ctx.lineTo(tx + w * 0.12 + bend * 10, ty + h * 0.11);
  ctx.quadraticCurveTo(tx + w * 0.2 - bend * 12, ty + h * 0.06, tx, ty - 10);
  ctx.stroke();
  // Fins and scales.
  const [fx, fy] = spine(0.32);
  ctx.beginPath();
  ctx.moveTo(fx - w * 0.14, fy);
  ctx.lineTo(fx - w * 0.3, fy + h * 0.07 - bend * 6);
  ctx.moveTo(fx + w * 0.14, fy);
  ctx.lineTo(fx + w * 0.3, fy + h * 0.07 + bend * 6);
  ctx.stroke();
  ctx.lineWidth = 1.6;
  ctx.shadowBlur = 6;
  for (let i = 3; i < 15; i += 2) {
    const [sx, sy] = spine(i / 20);
    ctx.beginPath();
    ctx.arc(sx, sy, w * 0.07, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
  }
  ctx.fillStyle = '#ffffff';
  const [ex, ey] = spine(0.1);
  ctx.fillRect(ex - w * 0.08, ey, 5, 5);
  ctx.fillRect(ex + w * 0.08 - 5, ey, 5, 5);
  ctx.restore();
}

/** The RAYO bolt charging: outline, filled, filled and ringed. */
function holoBolt(ctx: Ctx, page: number, w: number, h: number): void {
  ctx.save();
  ctx.shadowColor = AMBER;
  ctx.shadowBlur = 22;
  bolt(ctx, w * 0.12, h * 0.1, w * 0.76, h * 0.62);
  if (page === 0) {
    ctx.strokeStyle = '#ffe2a0';
    ctx.lineWidth = 5;
    ctx.stroke();
  } else {
    ctx.fillStyle = page === 2 ? '#fff2c8' : 'rgba(255,194,71,0.8)';
    ctx.fill();
  }
  if (page === 2) {
    ctx.strokeStyle = 'rgba(255,194,71,0.7)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(w / 2, h * 0.41, w * 0.46, h * 0.36, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  const rng = makeRng(90 + page);
  ctx.strokeStyle = '#fff6d8';
  ctx.lineWidth = 2;
  for (let i = 0; i < 4 + page * 3; i++) {
    let x = w * (0.2 + rng() * 0.6);
    let y = h * (0.1 + rng() * 0.6);
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let k = 0; k < 3; k++) {
      x += (rng() - 0.5) * 30;
      y += (rng() - 0.5) * 30;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();
  text(ctx, 'RAYO', w / 2, h * 0.9, { size: 62, color: '#ffe2a0', align: 'center', glow: 18, glowColor: AMBER, maxW: w * 0.9 });
}

/**
 * The Bay's two holographic data columns, as `makeBillboardTexture` drew them: 0 the corporate
 * cyan data wall, 1 the hot ad column. Scrolled by the shader instead of a texture offset.
 */
function holoColumnArt(ctx: Ctx, w: number, h: number, variant: number): void {
  const rng = makeRng(variant === 0 ? 4242 : 8181);
  const a = variant === 0 ? PAL.neonCyan : PAL.neonMagenta;
  const b = variant === 0 ? PAL.neonBlue : PAL.neonViolet;
  vGradient(ctx, w, h, [[0, '#04060c'], [0.5, variant === 0 ? '#061420' : '#12061c'], [1, '#04060c']]);
  for (let i = 0; i < 18; i++) {
    const y = rng() * h;
    const bh = 6 + rng() * 22;
    ctx.globalAlpha = 0.14 + rng() * 0.3;
    ctx.fillStyle = hex(rng() > 0.5 ? a : b);
    ctx.fillRect(rng() * w * 0.4, y, w * (0.25 + rng() * 0.7), bh);
  }
  ctx.globalAlpha = 1;
  const glyphs = variant === 0 ? ['高', '速', '電'] : ['雷', '速', '夜'];
  for (let i = 0; i < glyphs.length; i++) {
    text(ctx, glyphs[i], w / 2, (90 + i * 160) * (h / 512), { size: 116, color: hex(a), align: 'center', base: 'middle', font: CJK, glow: 40 });
  }
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = '#000000';
  for (let y = 0; y < h; y += 4) ctx.fillRect(0, y, w, 2);
  ctx.globalAlpha = 1;
}
