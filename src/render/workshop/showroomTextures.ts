import * as THREE from 'three';

/**
 * The showroom's canvases: the polished floor and its roughness, the turntable's plate, the
 * sheet of signs and posters (invented brands only), a soft glow and the car's contact shadow.
 * Drawn once when the showroom is built; the showroom disposes them.
 */

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (!g) throw new Error('showroom: no 2d canvas');
  return [c, g];
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function texture(c: HTMLCanvasElement, srgb: boolean): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/** Metres of floor one repeat of the floor texture covers: 4 × 4 tiles of a metre. */
export const FLOOR_TILE_REPEAT_M = 4;

/**
 * Sealed dark tiles, a metre square, with grout, a little tone variation, scuffs and oil. The
 * colour map; `floorRoughness` is its twin (tiles polished, grout and oil rough).
 */
export function floorTextures(): { map: THREE.CanvasTexture; roughness: THREE.CanvasTexture } {
  const S = 512;
  const T = S / FLOOR_TILE_REPEAT_M;
  const [c, g] = canvas(S, S);
  const [rc, rg] = canvas(S, S);
  const r = rng(99);
  g.fillStyle = '#0c0d10';
  g.fillRect(0, 0, S, S);
  rg.fillStyle = '#ffffff';
  rg.fillRect(0, 0, S, S);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      const v = 34 + Math.floor(r() * 12);
      g.fillStyle = `rgb(${v},${v + 1},${v + 4})`;
      g.fillRect(i * T + 3, j * T + 3, T - 6, T - 6);
      // Polished: low roughness (the map's green channel), a little uneven.
      const rough = 40 + Math.floor(r() * 30);
      rg.fillStyle = `rgb(${rough},${rough},${rough})`;
      rg.fillRect(i * T + 3, j * T + 3, T - 6, T - 6);
      // A soft highlight across each tile, so it reads as a glazed surface.
      const grad = g.createLinearGradient(i * T, j * T, i * T + T, j * T + T);
      grad.addColorStop(0, 'rgba(255,255,255,0.035)');
      grad.addColorStop(1, 'rgba(0,0,0,0.05)');
      g.fillStyle = grad;
      g.fillRect(i * T + 3, j * T + 3, T - 6, T - 6);
    }
  }
  // Scuffs and tyre marks: faint arcs, lighter on the colour, rougher on the roughness.
  for (let k = 0; k < 26; k++) {
    const x = r() * S;
    const y = r() * S;
    const rad = 20 + r() * 90;
    const a0 = r() * Math.PI * 2;
    g.strokeStyle = `rgba(0,0,0,${0.12 + r() * 0.15})`;
    g.lineWidth = 2 + r() * 5;
    g.beginPath();
    g.arc(x, y, rad, a0, a0 + 0.4 + r() * 0.9);
    g.stroke();
    rg.strokeStyle = 'rgba(150,150,150,0.5)';
    rg.lineWidth = g.lineWidth;
    rg.beginPath();
    rg.arc(x, y, rad, a0, a0 + 0.4 + r() * 0.9);
    rg.stroke();
  }
  // Oil: dark, and rough (no reflection on it).
  for (let k = 0; k < 5; k++) {
    const x = r() * S;
    const y = r() * S;
    const rad = 10 + r() * 26;
    const grad = g.createRadialGradient(x, y, 0, x, y, rad);
    grad.addColorStop(0, 'rgba(0,0,0,0.55)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    const rgr = rg.createRadialGradient(x, y, 0, x, y, rad);
    rgr.addColorStop(0, 'rgba(200,200,200,0.7)');
    rgr.addColorStop(1, 'rgba(200,200,200,0)');
    rg.fillStyle = rgr;
    rg.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  const map = texture(c, true);
  const roughness = texture(rc, false);
  for (const t of [map, roughness]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
  }
  return { map, roughness };
}

/**
 * The turntable's plate, seen from above, radius = half the canvas: brushed steel rings, eight
 * seams out from the hub, and the shop's name run round the edge in red.
 */
export function turntableTexture(name: string): THREE.CanvasTexture {
  const S = 1024;
  const [c, g] = canvas(S, S);
  const R = S / 2;
  g.fillStyle = '#1c1d21';
  g.fillRect(0, 0, S, S);
  // Brushed rings.
  const r = rng(7);
  for (let rad = R; rad > 8; rad -= 3) {
    const v = 30 + Math.floor(r() * 16);
    g.strokeStyle = `rgb(${v},${v + 2},${v + 6})`;
    g.lineWidth = 3;
    g.beginPath();
    g.arc(R, R, rad, 0, Math.PI * 2);
    g.stroke();
  }
  // Grooves: a few deeper rings.
  for (const f of [0.28, 0.62, 0.86]) {
    g.strokeStyle = 'rgba(8,8,10,0.9)';
    g.lineWidth = 5;
    g.beginPath();
    g.arc(R, R, R * f, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = 'rgba(160,165,175,0.25)';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(R, R, R * f + 4, 0, Math.PI * 2);
    g.stroke();
  }
  // Seams out from the hub, the plate being eight welded segments.
  g.strokeStyle = 'rgba(10,10,12,0.8)';
  g.lineWidth = 4;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    g.beginPath();
    g.moveTo(R + Math.cos(a) * R * 0.28, R + Math.sin(a) * R * 0.28);
    g.lineTo(R + Math.cos(a) * R * 0.86, R + Math.sin(a) * R * 0.86);
    g.stroke();
  }
  // The name round the outer band.
  const text = ` ${name.toUpperCase()} · 99 · `;
  g.save();
  g.translate(R, R);
  g.font = 'bold 30px "Arial Black", Impact, sans-serif';
  g.fillStyle = '#8c1c17';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const full = text + text + text;
  const step = (Math.PI * 2) / full.length;
  for (let i = 0; i < full.length; i++) {
    g.save();
    g.rotate(i * step);
    g.translate(0, -R * 0.93);
    g.fillText(full[i], 0, 0);
    g.restore();
  }
  g.restore();
  // Rim of the plate: a bright ring where it meets the bevel.
  g.strokeStyle = '#9aa0aa';
  g.lineWidth = 6;
  g.beginPath();
  g.arc(R, R, R - 3, 0, Math.PI * 2);
  g.stroke();
  return texture(c, true);
}

/** A soft round spot, white, for every glow and light pool (vertex colour tints it). */
export function glowTexture(): THREE.CanvasTexture {
  const S = 128;
  const [c, g] = canvas(S, S);
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.5)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  return texture(c, true);
}

/** The car's contact shadow: a soft dark rounded rectangle, alpha only. */
export function shadowTexture(): THREE.CanvasTexture {
  const W = 128;
  const H = 256;
  const [c, g] = canvas(W, H);
  // alphaMap reads the green channel: white is shadow, black is none.
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  g.filter = 'blur(14px)';
  g.fillStyle = '#fff';
  const pad = 26;
  g.beginPath();
  g.roundRect(pad, pad, W - pad * 2, H - pad * 2, 22);
  g.fill();
  g.filter = 'none';
  return texture(c, false);
}

/* ------------------------------------------------------------------ the sheet of signs */

/** A rectangle of the sign sheet, in UV (0..1, v up). */
export interface SignCell {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  /** Width over height, so a caller sizes the panel right. */
  aspect: number;
}

export type SignId =
  | 'kazeTires'
  | 'rayoOil'
  | 'hikariWheels'
  | 'sale'
  | 'oferta'
  | 'caja'
  | 'noFumar'
  | 'posterTouge'
  | 'posterNeko'
  | 'banner'
  | 'screen'
  | 'calendar';

const SHEET = 1024;
/** Where each sign is drawn on the sheet, in pixels: x, y, w, h. */
const LAYOUT: Record<SignId, [number, number, number, number]> = {
  kazeTires: [0, 0, 512, 160],
  rayoOil: [512, 0, 512, 160],
  hikariWheels: [0, 160, 512, 160],
  sale: [512, 160, 256, 128],
  oferta: [768, 160, 256, 128],
  caja: [512, 288, 256, 96],
  noFumar: [768, 288, 256, 96],
  posterTouge: [0, 320, 256, 384],
  posterNeko: [256, 320, 256, 384],
  banner: [512, 384, 128, 512],
  screen: [640, 384, 384, 256],
  calendar: [640, 640, 256, 352],
};

export function signSheet(): { texture: THREE.CanvasTexture; cells: Record<SignId, SignCell> } {
  const [c, g] = canvas(SHEET, SHEET);
  g.fillStyle = '#000';
  g.fillRect(0, 0, SHEET, SHEET);
  const at = (id: SignId): [number, number, number, number] => LAYOUT[id];

  const sans = '"Arial Black", Impact, "Helvetica Neue", sans-serif';
  const board = (x: number, y: number, w: number, h: number, bg: string, edge: string): void => {
    g.fillStyle = edge;
    g.fillRect(x + 2, y + 2, w - 4, h - 4);
    g.fillStyle = bg;
    g.fillRect(x + 10, y + 10, w - 20, h - 20);
  };
  const text = (s: string, x: number, y: number, size: number, color: string, font = sans, align: CanvasTextAlign = 'center'): void => {
    g.font = `${size}px ${font}`;
    g.fillStyle = color;
    g.textAlign = align;
    g.textBaseline = 'middle';
    g.fillText(s, x, y);
  };

  // KAZE TIRES: a tyre shop's board, red on white, with a tread drawn beside the name.
  {
    const [x, y, w, h] = at('kazeTires');
    board(x, y, w, h, '#f1efe8', '#b3191c');
    text('KAZE', x + 140, y + h / 2 - 6, 68, '#c1121f');
    text('TIRES', x + 362, y + h / 2 - 6, 56, '#1b1c20');
    g.fillStyle = '#1b1c20';
    for (let i = 0; i < 9; i++) g.fillRect(x + 40 + i * 50, y + h - 34, 30, 12);
  }
  // RAYO OIL: dark board, yellow bolt.
  {
    const [x, y, w, h] = at('rayoOil');
    board(x, y, w, h, '#141821', '#f2c200');
    g.fillStyle = '#f2c200';
    g.beginPath();
    g.moveTo(x + 70, y + 30);
    g.lineTo(x + 40, y + 90);
    g.lineTo(x + 66, y + 90);
    g.lineTo(x + 46, y + 134);
    g.lineTo(x + 104, y + 70);
    g.lineTo(x + 78, y + 70);
    g.lineTo(x + 98, y + 30);
    g.closePath();
    g.fill();
    text('RAYO', x + 250, y + 62, 70, '#f2c200');
    text('MOTOR OIL · 10W-40', x + 290, y + 118, 26, '#9fe8ff', '"Helvetica Neue", Arial, sans-serif');
  }
  // HIKARI WHEELS: cyan on black, a five-spoke mark.
  {
    const [x, y, w, h] = at('hikariWheels');
    board(x, y, w, h, '#07090d', '#22e6ff');
    const cx = x + 86;
    const cy = y + h / 2;
    g.strokeStyle = '#22e6ff';
    g.lineWidth = 8;
    g.beginPath();
    g.arc(cx, cy, 50, 0, Math.PI * 2);
    g.stroke();
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 - Math.PI / 2;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * 10, cy + Math.sin(a) * 10);
      g.lineTo(cx + Math.cos(a) * 46, cy + Math.sin(a) * 46);
      g.stroke();
    }
    text('HIKARI', x + 300, y + 64, 68, '#e9fbff');
    text('WHEELS · 光', x + 300, y + 120, 30, '#22e6ff');
  }
  // Price tags.
  {
    const [x, y, w, h] = at('sale');
    board(x, y, w, h, '#ffffff', '#d11a2a');
    text('SALE', x + w / 2, y + 52, 58, '#d11a2a');
    text('-20%', x + w / 2, y + 98, 30, '#1b1c20');
  }
  {
    const [x, y, w, h] = at('oferta');
    board(x, y, w, h, '#ffd400', '#1b1c20');
    text('OFERTA', x + w / 2, y + 54, 50, '#1b1c20');
    text('LLANTAS 2×1', x + w / 2, y + 98, 26, '#b3191c', '"Helvetica Neue", Arial, sans-serif');
  }
  {
    const [x, y, w, h] = at('caja');
    board(x, y, w, h, '#f1efe8', '#b3191c');
    text('CAJA', x + w / 2, y + h / 2, 54, '#b3191c');
  }
  {
    const [x, y, w, h] = at('noFumar');
    board(x, y, w, h, '#f1efe8', '#1b1c20');
    text('PROHIBIDO FUMAR', x + w / 2, y + h / 2, 21, '#1b1c20');
  }
  // Posters: a touge night event and a racing team, the car only a shape.
  {
    const [x, y, w, h] = at('posterTouge');
    const grad = g.createLinearGradient(x, y, x, y + h);
    grad.addColorStop(0, '#2a0f45');
    grad.addColorStop(0.6, '#ff2fa8');
    grad.addColorStop(1, '#ffb347');
    g.fillStyle = grad;
    g.fillRect(x + 6, y + 6, w - 12, h - 12);
    g.fillStyle = '#ffe9a8';
    g.beginPath();
    g.arc(x + w / 2, y + 205, 60, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#12061f';
    g.beginPath();
    g.moveTo(x + 6, y + 300);
    g.lineTo(x + 80, y + 250);
    g.lineTo(x + 140, y + 280);
    g.lineTo(x + 250, y + 230);
    g.lineTo(x + 250, y + h - 6);
    g.lineTo(x + 6, y + h - 6);
    g.closePath();
    g.fill();
    // The coupe, a silhouette on the ridge.
    g.beginPath();
    g.moveTo(x + 50, y + 300);
    g.lineTo(x + 70, y + 282);
    g.lineTo(x + 120, y + 276);
    g.lineTo(x + 150, y + 262);
    g.lineTo(x + 190, y + 264);
    g.lineTo(x + 210, y + 282);
    g.lineTo(x + 220, y + 300);
    g.closePath();
    g.fill();
    text('TOUGE', x + w / 2, y + 60, 60, '#ffe9a8');
    text('NIGHT', x + w / 2, y + 112, 44, '#22e6ff');
    text('SÁB · 23 HS', x + w / 2, y + h - 30, 24, '#ffe9a8', '"Helvetica Neue", Arial, sans-serif');
  }
  {
    const [x, y, w, h] = at('posterNeko');
    g.fillStyle = '#0d0f14';
    g.fillRect(x + 6, y + 6, w - 12, h - 12);
    g.fillStyle = '#22e6ff';
    g.fillRect(x + 6, y + 150, w - 12, 10);
    g.fillStyle = '#ff2fd0';
    g.fillRect(x + 6, y + 166, w - 12, 6);
    // A cat's head in two strokes.
    g.fillStyle = '#e9ecf2';
    g.beginPath();
    g.moveTo(x + 88, y + 110);
    g.lineTo(x + 96, y + 50);
    g.lineTo(x + 122, y + 78);
    g.lineTo(x + 138, y + 78);
    g.lineTo(x + 164, y + 50);
    g.lineTo(x + 172, y + 110);
    g.closePath();
    g.fill();
    text('NEKO', x + w / 2, y + 230, 62, '#e9ecf2');
    text('RACING', x + w / 2, y + 282, 40, '#ff2fd0');
    text('猫 · DRIFT TEAM', x + w / 2, y + 336, 24, '#22e6ff', '"Helvetica Neue", Arial, sans-serif');
  }
  // A vertical banner, kanji: "走り屋" (street racer).
  {
    const [x, y, w, h] = at('banner');
    g.fillStyle = '#b3191c';
    g.fillRect(x + 8, y + 4, w - 16, h - 8);
    g.fillStyle = '#f1efe8';
    g.fillRect(x + 16, y + 12, w - 32, h - 24);
    for (const [k, ch] of ['走', 'り', '屋'].entries()) text(ch, x + w / 2, y + 90 + k * 150, 96, '#b3191c', '"Hiragino Sans", "Noto Sans CJK JP", "Yu Gothic", sans-serif');
  }
  // A workshop screen: an engine readout in cyan.
  {
    const [x, y, w, h] = at('screen');
    g.fillStyle = '#031016';
    g.fillRect(x, y, w, h);
    g.strokeStyle = '#22e6ff';
    g.lineWidth = 3;
    g.strokeRect(x + 10, y + 10, w - 20, h - 20);
    g.beginPath();
    for (let i = 0; i <= 60; i++) {
      const px = x + 24 + i * ((w - 48) / 60);
      const py = y + 170 - Math.pow(i / 60, 1.6) * 110 + Math.sin(i * 0.9) * 4;
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.stroke();
    g.fillStyle = '#ff2fd0';
    for (let i = 0; i < 10; i++) g.fillRect(x + 30 + i * 32, y + 200, 22, 24 - (i % 4) * 4);
    text('DYNO · 8200 RPM', x + w / 2, y + 40, 26, '#9fe8ff', '"Helvetica Neue", Arial, sans-serif');
  }
  // A parts calendar with a car on it.
  {
    const [x, y, w, h] = at('calendar');
    g.fillStyle = '#e9ecf2';
    g.fillRect(x + 6, y + 6, w - 12, h - 12);
    g.fillStyle = '#1f4fff';
    g.fillRect(x + 16, y + 16, w - 32, 170);
    g.fillStyle = '#0b0c10';
    g.beginPath();
    g.moveTo(x + 40, y + 160);
    g.lineTo(x + 70, y + 120);
    g.lineTo(x + 150, y + 108);
    g.lineTo(x + 200, y + 126);
    g.lineTo(x + 222, y + 160);
    g.closePath();
    g.fill();
    text('SEPTIEMBRE', x + w / 2, y + 212, 26, '#1b1c20');
    g.fillStyle = '#9aa0aa';
    for (let r = 0; r < 5; r++) for (let q = 0; q < 7; q++) g.fillRect(x + 22 + q * 31, y + 236 + r * 20, 24, 14);
  }

  const cells = {} as Record<SignId, SignCell>;
  for (const id of Object.keys(LAYOUT) as SignId[]) {
    const [x, y, w, h] = LAYOUT[id];
    cells[id] = { u0: x / SHEET, u1: (x + w) / SHEET, v0: 1 - (y + h) / SHEET, v1: 1 - y / SHEET, aspect: w / h };
  }
  return { texture: texture(c, true), cells };
}
