import * as THREE from 'three';
import { PAL } from './palette';
import { makeRng } from './meshBuilder';

/**
 * Every texture in the arena is drawn procedurally into a canvas at start-up: no art files to
 * ship, no loader to wait for, and the palette stays in one place. Textures are small
 * (256-1024 px), mipmapped and shared by the merged meshes that use them.
 */

function canvas(w: number, h: number): { cv: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  return { cv, ctx };
}

function toTexture(cv: HTMLCanvasElement, repeat = false): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

function rgba(c: number, a: number): string {
  return `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},${a})`;
}

function hex(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`;
}

/** Dark, slightly mottled wet asphalt. Tiles over 8 world metres. */
export function makeAsphaltTexture(base: number, seed: number): THREE.CanvasTexture {
  const { cv, ctx } = canvas(256, 256);
  ctx.fillStyle = hex(base);
  ctx.fillRect(0, 0, 256, 256);
  const rng = makeRng(seed);
  // Coarse damp patches.
  for (let i = 0; i < 26; i++) {
    const x = rng() * 256;
    const y = rng() * 256;
    const r = 18 + rng() * 60;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const light = rng() > 0.45;
    g.addColorStop(0, light ? 'rgba(120,160,200,0.14)' : 'rgba(8,18,30,0.22)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // Fine grain.
  const img = ctx.getImageData(0, 0, 256, 256);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng() - 0.5) * 20;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
  // A couple of long tyre streaks for arcade flavour.
  ctx.globalAlpha = 0.12;
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 6;
  for (let i = 0; i < 4; i++) {
    const x = rng() * 256;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + (rng() - 0.5) * 40, 256);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  return toTexture(cv, true);
}

export interface WindowTextureOptions {
  facade: number;
  /** Window colours to pick from, most common first. */
  lights: number[];
  cols: number;
  rows: number;
  /** 0..1 chance a window is lit. */
  lit: number;
  seed: number;
  /** Draw horizontal floor slabs between window rows. */
  slabs?: boolean;
}

/**
 * A facade tile: dark concrete with a grid of emissive windows. Used as both `map` and
 * `emissiveMap`, so unlit pixels are almost black in both channels and lit ones glow.
 */
export function makeWindowTexture(o: WindowTextureOptions): THREE.CanvasTexture {
  const S = 256;
  const { cv, ctx } = canvas(S, S);
  const rng = makeRng(o.seed);
  ctx.fillStyle = hex(o.facade);
  ctx.fillRect(0, 0, S, S);

  const cw = S / o.cols;
  const ch = S / o.rows;
  // Vertical pilasters and horizontal slabs give the flat facade some read at distance.
  if (o.slabs !== false) {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    for (let r = 0; r < o.rows; r++) ctx.fillRect(0, r * ch, S, ch * 0.16);
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    for (let c = 0; c < o.cols; c++) ctx.fillRect(c * cw, 0, cw * 0.1, S);
  }

  // Wide panes with a soft halo bled around them. The old version stamped a hard white core
  // into every lit window, which is what turned a facade into a field of sparkling dots; here
  // each window is one broad, slightly blurred block of colour that mips down into a smear.
  const wW = cw * 0.74;
  const wH = ch * 0.44;
  for (let r = 0; r < o.rows; r++) {
    for (let c = 0; c < o.cols; c++) {
      const x = c * cw + (cw - wW) / 2;
      const y = r * ch + ch * 0.3;
      if (rng() < o.lit) {
        const color = o.lights[Math.floor(rng() * o.lights.length)];
        const dim = 0.5 + rng() * 0.4;
        // Halo first, so neighbouring windows bleed into one another instead of standing apart.
        const cxp = x + wW / 2;
        const cyp = y + wH / 2;
        const rad = Math.max(wW, wH) * 1.5;
        const g = ctx.createRadialGradient(cxp, cyp, 0, cxp, cyp, rad);
        g.addColorStop(0, hex(color));
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = dim * 0.35;
        ctx.fillStyle = g;
        ctx.fillRect(cxp - rad, cyp - rad, rad * 2, rad * 2);
        // The pane itself, softened at the edges by the halo it sits in.
        ctx.globalAlpha = dim * 0.85;
        ctx.fillStyle = hex(color);
        ctx.fillRect(x, y, wW, wH);
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = hex(PAL.winOff);
        ctx.fillRect(x, y, wW, wH);
      }
    }
  }
  return toTexture(cv, true);
}

/** Soft radial glow used by every additive halo, light pool and wet reflection streak. */
export function makeGlowTexture(): THREE.CanvasTexture {
  const S = 128;
  const { cv, ctx } = canvas(S, S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  // A long, lazy falloff. The tight core the old ramp had made every halo read as a point
  // source; this one spreads, so lights become washes of colour on the wet ground.
  g.addColorStop(0, 'rgba(255,255,255,0.72)');
  g.addColorStop(0.2, 'rgba(255,255,255,0.5)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.26)');
  g.addColorStop(0.75, 'rgba(255,255,255,0.08)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 2;
  return tex;
}

const CJK_FONT = '"Noto Sans JP","Yu Gothic","Hiragino Kaku Gothic ProN","MS Gothic","Meiryo",sans-serif';
const LATIN_FONT = '"Bahnschrift","DIN Alternate","Arial Narrow",Impact,sans-serif';

export const SIGN_COLS = 4;
export const SIGN_ROWS = 4;

/** UV rect of one atlas cell, inset by a couple of texels so mipmaps cannot bleed neighbours. */
export function signCell(index: number): { u0: number; v0: number; u1: number; v1: number } {
  const i = ((index % (SIGN_COLS * SIGN_ROWS)) + SIGN_COLS * SIGN_ROWS) % (SIGN_COLS * SIGN_ROWS);
  const col = i % SIGN_COLS;
  const row = Math.floor(i / SIGN_COLS);
  const pad = 0.004;
  return {
    u0: col / SIGN_COLS + pad,
    u1: (col + 1) / SIGN_COLS - pad,
    // Canvas y grows downward, texture v grows upward.
    v0: 1 - (row + 1) / SIGN_ROWS + pad,
    v1: 1 - row / SIGN_ROWS - pad,
  };
}

function glow(ctx: CanvasRenderingContext2D, color: string, blur: number): void {
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
}

function clearGlow(ctx: CanvasRenderingContext2D): void {
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'transparent';
}

/**
 * 4x4 atlas of neon sign panels. Invented shop words and single kanji only: nothing here
 * references a real brand, game or logo.
 */
export function makeSignAtlas(): THREE.CanvasTexture {
  const C = 256;
  const { cv, ctx } = canvas(C * SIGN_COLS, C * SIGN_ROWS);
  ctx.fillStyle = '#05070c';
  ctx.fillRect(0, 0, cv.width, cv.height);

  const cell = (i: number, draw: (x: number, y: number) => void): void => {
    const x = (i % SIGN_COLS) * C;
    const y = Math.floor(i / SIGN_COLS) * C;
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.rect(0, 0, C, C);
    ctx.clip();
    draw(0, 0);
    ctx.restore();
  };

  const panel = (bg: string, border?: string): void => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, C, C);
    if (border) {
      ctx.strokeStyle = border;
      ctx.lineWidth = 6;
      glow(ctx, border, 26);
      ctx.strokeRect(10, 10, C - 20, C - 20);
      clearGlow(ctx);
    }
  };

  const text = (s: string, color: string, size: number, font: string, y = C / 2): void => {
    ctx.font = `700 ${size}px ${font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    glow(ctx, color, 30);
    ctx.fillStyle = color;
    ctx.fillText(s, C / 2, y);
    ctx.fillText(s, C / 2, y);
    clearGlow(ctx);
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = 0.55;
    ctx.fillText(s, C / 2, y);
    ctx.globalAlpha = 1;
  };

  const bars = (color: string, count: number, vertical: boolean): void => {
    glow(ctx, color, 22);
    ctx.fillStyle = color;
    for (let i = 0; i < count; i++) {
      const t = 24 + (i * (C - 60)) / count;
      if (vertical) ctx.fillRect(t, 26, 10, C - 52);
      else ctx.fillRect(26, t, C - 52, 10);
    }
    clearGlow(ctx);
  };

  // 0: 雷 - the game's motif, hot magenta on black (the reference's red kanji boxes, pinked).
  cell(0, () => {
    panel('#0d0611', hex(PAL.neonMagenta));
    text('雷', hex(PAL.neonMagenta), 150, CJK_FONT);
  });
  // 1: 速度 - speed, cyan.
  cell(1, () => {
    panel('#04080c', hex(PAL.neonCyan));
    text('速度', hex(PAL.neonCyan), 96, CJK_FONT);
  });
  // 2: 電 - electric, clean cyan.
  cell(2, () => {
    panel('#050d12', hex(PAL.neonCyan));
    text('電', hex(PAL.neonCyan), 150, CJK_FONT);
  });
  // 3: RAYO, magenta.
  cell(3, () => {
    panel('#0a040a');
    text('RAYO', hex(PAL.neonMagenta), 74, LATIN_FONT, C * 0.4);
    ctx.fillStyle = hex(PAL.neonViolet);
    glow(ctx, hex(PAL.neonViolet), 20);
    ctx.fillRect(40, C * 0.62, C - 80, 8);
    clearGlow(ctx);
  });
  // 4: cyan bar stack.
  cell(4, () => {
    panel('#04070c');
    bars(hex(PAL.neonCyan), 5, false);
  });
  // 5: magenta chevrons.
  cell(5, () => {
    panel('#0a040a');
    glow(ctx, hex(PAL.neonMagenta), 24);
    ctx.strokeStyle = hex(PAL.neonMagenta);
    ctx.lineWidth = 14;
    for (let i = 0; i < 3; i++) {
      const o = 30 + i * 56;
      ctx.beginPath();
      ctx.moveTo(o, 50);
      ctx.lineTo(o + 46, C / 2);
      ctx.lineTo(o, C - 50);
      ctx.stroke();
    }
    clearGlow(ctx);
  });
  // 6: 24H, soft pink.
  cell(6, () => {
    panel('#0d0710', hex(PAL.neonPink));
    text('24H', hex(PAL.neonPink), 88, LATIN_FONT);
  });
  // 7: cyan dot column.
  cell(7, () => {
    panel('#04070c');
    glow(ctx, hex(PAL.neonCyan), 18);
    ctx.fillStyle = hex(PAL.neonCyan);
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      ctx.arc(C / 2, 34 + i * 38, 12, 0, Math.PI * 2);
      ctx.fill();
    }
    clearGlow(ctx);
  });
  // 8: BANDIDO, violet.
  cell(8, () => {
    panel('#07040c');
    text('BANDIDO', hex(PAL.neonViolet), 44, LATIN_FONT, C * 0.45);
    ctx.fillStyle = hex(PAL.neonCyan);
    glow(ctx, hex(PAL.neonCyan), 16);
    ctx.fillRect(52, C * 0.62, C - 104, 6);
    clearGlow(ctx);
  });
  // 9: 夜 - night, cyan on deep blue.
  cell(9, () => {
    panel('#040a10', hex(PAL.neonBlue));
    text('夜', hex(PAL.neonCyan), 150, CJK_FONT);
  });
  // 10: hazard stripes (JDM garage), in the hot family.
  cell(10, () => {
    panel('#0c0710');
    ctx.save();
    ctx.translate(C / 2, C / 2);
    ctx.rotate(-Math.PI / 4);
    ctx.fillStyle = hex(PAL.neonPink);
    glow(ctx, hex(PAL.neonPink), 14);
    for (let i = -6; i < 6; i++) ctx.fillRect(i * 40, -220, 20, 440);
    clearGlow(ctx);
    ctx.restore();
  });
  // 11: 車 - car, rose garage sign.
  cell(11, () => {
    panel('#0d0709', hex(PAL.neonPink));
    text('車', hex(PAL.winWarm), 150, CJK_FONT);
  });
  // 12: cyan target reticle.
  cell(12, () => {
    panel('#04070c');
    glow(ctx, hex(PAL.neonCyan), 22);
    ctx.strokeStyle = hex(PAL.neonCyan);
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(C / 2, C / 2, 72, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(C / 2, 30);
    ctx.lineTo(C / 2, C - 30);
    ctx.moveTo(30, C / 2);
    ctx.lineTo(C - 30, C / 2);
    ctx.stroke();
    clearGlow(ctx);
  });
  // 13: cyan vertical bars (open / garage bay).
  cell(13, () => {
    panel('#050c11');
    bars(hex(PAL.neonCyan), 4, true);
  });
  // 14: 高速 - expressway, cold white.
  cell(14, () => {
    panel('#060a0e', hex(PAL.neonWhite));
    text('高速', hex(PAL.neonWhite), 96, CJK_FONT);
  });
  // 15: violet static panel.
  cell(15, () => {
    panel('#07040c');
    // Fewer, longer bands: at speed this should read as one soft violet panel, not as static.
    const rng = makeRng(99);
    for (let i = 0; i < 70; i++) {
      ctx.globalAlpha = 0.12 + rng() * 0.32;
      ctx.fillStyle = rng() > 0.5 ? hex(PAL.neonViolet) : hex(PAL.neonMagenta);
      ctx.fillRect(rng() * C * 0.4, rng() * C, C * (0.3 + rng() * 0.6), 6 + rng() * 8);
    }
    ctx.globalAlpha = 1;
  });

  return toTexture(cv, false);
}

/**
 * Tall holographic billboard panel. Scrolls vertically in `update`, so it repeats on T.
 * `variant` 0 = corporate cyan data wall, 1 = magenta/violet ad column.
 */
export function makeBillboardTexture(variant: number): THREE.CanvasTexture {
  const W = 256;
  const H = 512;
  const { cv, ctx } = canvas(W, H);
  const rng = makeRng(variant === 0 ? 4242 : 8181);
  const a = variant === 0 ? PAL.neonCyan : PAL.neonMagenta;
  const b = variant === 0 ? PAL.neonBlue : PAL.neonViolet;

  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#04060c');
  g.addColorStop(0.5, variant === 0 ? '#061420' : '#12061c');
  g.addColorStop(1, '#04060c');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // Data bands.
  for (let i = 0; i < 18; i++) {
    const y = rng() * H;
    const h = 6 + rng() * 22;
    ctx.globalAlpha = 0.14 + rng() * 0.3;
    ctx.fillStyle = hex(rng() > 0.5 ? a : b);
    ctx.fillRect(rng() * W * 0.4, y, W * (0.25 + rng() * 0.7), h);
  }
  ctx.globalAlpha = 1;

  // Big glyph column.
  ctx.font = `700 120px ${CJK_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  glow(ctx, hex(a), 40);
  ctx.fillStyle = hex(a);
  const glyphs = variant === 0 ? ['高', '速', '電'] : ['雷', '速', '夜'];
  for (let i = 0; i < glyphs.length; i++) ctx.fillText(glyphs[i], W / 2, 90 + i * 160);
  clearGlow(ctx);

  // Scanlines keep it reading as a hologram.
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = '#000000';
  for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 2);
  ctx.globalAlpha = 1;

  const tex = toTexture(cv, true);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/**
 * Equirectangular night sky: black overhead falling into a bruised purple city glow that
 * settles onto the fog colour at the horizon, so the ground plane and the sky meet invisibly.
 */
export function makeSkyTexture(): THREE.CanvasTexture {
  const W = 512;
  const H = 256;
  const { cv, ctx } = canvas(W, H);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, hex(PAL.skyTop));
  g.addColorStop(0.3, hex(PAL.skyTop));
  g.addColorStop(0.6, hex(PAL.skyGlow));
  g.addColorStop(0.8, hex(PAL.skyHorizon));
  g.addColorStop(0.93, hex(PAL.fog));
  g.addColorStop(1, hex(PAL.fog));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // Uneven light domes from the districts beyond the arena.
  // Broad and few: the horizon should glow in two or three big washes, not many small ones.
  const rng = makeRng(7788);
  for (let i = 0; i < 8; i++) {
    const x = rng() * W;
    const r = 90 + rng() * 150;
    const rg = ctx.createRadialGradient(x, H * 0.94, 0, x, H * 0.94, r);
    const c = rng();
    rg.addColorStop(0, rgba(c < 0.62 ? PAL.neonCyan : PAL.neonMagenta, c < 0.62 ? 0.16 : 0.14));
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(x - r, H * 0.94 - r, r * 2, r * 2);
  }
  const tex = toTexture(cv, true);
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.mapping = THREE.EquirectangularReflectionMapping;
  return tex;
}

/**
 * Tiny equirectangular environment map. Not a real reflection probe: just a dark sky with a
 * neon-lit horizon so `metalness` on the asphalt reads as a cheap wet sheen.
 */
export function makeEnvTexture(): THREE.CanvasTexture {
  const W = 256;
  const H = 128;
  const { cv, ctx } = canvas(W, H);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, hex(PAL.night));
  g.addColorStop(0.55, hex(PAL.fog));
  g.addColorStop(0.72, hex(PAL.skyHorizon));
  g.addColorStop(1, hex(PAL.night));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const rng = makeRng(31337);
  for (let i = 0; i < 16; i++) {
    const x = rng() * W;
    const h = 10 + rng() * 24;
    ctx.globalAlpha = 0.2 + rng() * 0.35;
    ctx.fillStyle = rng() < 0.6 ? hex(PAL.neonCyan) : hex(PAL.neonMagenta);
    ctx.fillRect(x, H * 0.6, 6 + rng() * 16, h);
  }
  ctx.globalAlpha = 1;
  const tex = toTexture(cv, true);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  return tex;
}

/* ------------------------------------------------------------------ transit atlas */

/**
 * Every printed and back-lit surface a bus stop or a bus carries, on one atlas: the route
 * map and the name board behind the shelter's bench, the "BUS STOP" band on its fascia, the
 * timetable and the poster in its side bay, and the destination roll, the flank ad strip and
 * the route plate on the bus itself.
 *
 * Unlike the sign atlas this one is NOT a uniform grid — a 4:1 name board and a 1:1.5
 * timetable drawn in square cells would both come out stretched — so the cells are named
 * pixel rectangles and `transitCell` turns one into UVs. Everything on it is invented: made
 * up street names, made up route numbers, made up products.
 */
const TRANSIT_W = 512;
const TRANSIT_H = 704;
const TRANSIT_CELLS = {
  map: [0, 0, 512, 208],
  board0: [0, 208, 352, 80],
  board1: [0, 288, 352, 80],
  board2: [0, 368, 352, 80],
  times: [352, 208, 160, 240],
  ad0: [0, 448, 160, 192],
  ad1: [160, 448, 160, 192],
  roll: [320, 448, 192, 64],
  fleet: [320, 512, 192, 64],
  plate: [320, 576, 192, 64],
  band: [0, 640, 512, 64],
} as const;

export type TransitCell = keyof typeof TRANSIT_CELLS;

/** UV rect of one named panel, inset by a texel so mipmaps cannot bleed its neighbours. */
export function transitCell(name: TransitCell): { u0: number; v0: number; u1: number; v1: number } {
  const [x, y, w, h] = TRANSIT_CELLS[name];
  const px = 1 / TRANSIT_W;
  const py = 1 / TRANSIT_H;
  return {
    u0: x * px + px,
    u1: (x + w) * px - px,
    // Canvas y grows downward, texture v grows upward.
    v0: 1 - (y + h) * py + py,
    v1: 1 - y * py - py,
  };
}

/** The three routes the city runs: name board, number, and the poster that goes with it. */
const TRANSIT_ROUTES = [
  { name: 'UNION ST', number: '48' },
  { name: 'KAIDO ST', number: '12' },
  { name: 'BAY QUAY', number: '07' },
];

export function makeTransitAtlas(): THREE.CanvasTexture {
  const { cv, ctx } = canvas(TRANSIT_W, TRANSIT_H);
  ctx.fillStyle = '#04080a';
  ctx.fillRect(0, 0, TRANSIT_W, TRANSIT_H);
  const amber = hex(PAL.neonAmber);
  const cold = hex(PAL.neonWhite);
  const teal = hex(PAL.neonCyan);
  const hot = hex(PAL.neonMagenta);

  /** Draws into one named cell with the origin at its top-left corner and clipped to it. */
  const cell = (name: TransitCell, draw: (w: number, h: number) => void): void => {
    const [x, y, w, h] = TRANSIT_CELLS[name];
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.translate(x, y);
    ctx.fillStyle = '#05090c';
    ctx.fillRect(0, 0, w, h);
    draw(w, h);
    ctx.restore();
  };

  const label = (s: string, color: string, size: number, x: number, y: number, align: CanvasTextAlign = 'center'): void => {
    ctx.font = `700 ${size}px ${LATIN_FONT}`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    glow(ctx, color, size * 0.5);
    ctx.fillStyle = color;
    ctx.fillText(s, x, y);
    clearGlow(ctx);
  };

  /** The diagonal hazard hatch that ties the whole family together. */
  const hatch = (x: number, y: number, w: number, h: number, color: string): void => {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.85;
    for (let t = -h; t < w + h; t += 18) {
      ctx.beginPath();
      ctx.moveTo(x + t, y + h);
      ctx.lineTo(x + t + 9, y + h);
      ctx.lineTo(x + t + 9 + h, y);
      ctx.lineTo(x + t + h, y);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  };

  /* ---- the route map: the network, drawn as a diagram, with this stop marked */

  cell('map', (w, h) => {
    ctx.fillStyle = '#03110f';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = teal;
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.8;
    ctx.strokeRect(6, 6, w - 12, h - 12);
    ctx.globalAlpha = 1;
    // Four routes of 45-degree dog-legs, the way a transit diagram is drawn.
    const lines: Array<{ color: string; pts: Array<[number, number]> }> = [
      { color: hot, pts: [[30, 150], [90, 150], [150, 90], [280, 90], [330, 140], [470, 140]] },
      { color: hot, pts: [[60, 40], [140, 40], [200, 100], [200, 170], [250, 170], [420, 170]] },
      { color: hex(PAL.neonBlue), pts: [[30, 96], [120, 96], [180, 36], [300, 36], [350, 86], [470, 86]] },
      { color: hex(PAL.neonBlue), pts: [[100, 190], [100, 120], [160, 60], [240, 60], [240, 20]] },
    ];
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const line of lines) {
      ctx.strokeStyle = line.color;
      ctx.lineWidth = 4;
      glow(ctx, line.color, 10);
      ctx.beginPath();
      ctx.moveTo(line.pts[0][0], line.pts[0][1]);
      for (const p of line.pts.slice(1)) ctx.lineTo(p[0], p[1]);
      ctx.stroke();
      clearGlow(ctx);
      // Interchange dots at every bend.
      ctx.fillStyle = cold;
      for (const p of line.pts.slice(1, -1)) {
        ctx.beginPath();
        ctx.arc(p[0], p[1], 3.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // You are here.
    glow(ctx, amber, 18);
    ctx.strokeStyle = amber;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(200, 100, 10, 0, Math.PI * 2);
    ctx.stroke();
    clearGlow(ctx);
    label('YOU ARE HERE', amber, 13, 200, 124);
  });

  /* ---- the name boards: hatch, street, route number */

  TRANSIT_ROUTES.forEach((r, i) => {
    cell(`board${i}` as TransitCell, (w, h) => {
      ctx.fillStyle = '#070d11';
      ctx.fillRect(0, 0, w, h);
      hatch(6, 10, 96, h - 20, amber);
      label(r.name, cold, 44, 120, h / 2 - 4, 'left');
      ctx.fillStyle = amber;
      ctx.globalAlpha = 0.92;
      ctx.fillRect(w - 78, 12, 66, h - 24);
      ctx.globalAlpha = 1;
      ctx.font = `700 40px ${LATIN_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#08110c';
      ctx.fillText(r.number, w - 45, h / 2);
      ctx.fillStyle = amber;
      ctx.fillRect(112, h - 16, w - 200, 5);
    });
  });

  /* ---- the timetable in the side bay */

  cell('times', (w, h) => {
    ctx.fillStyle = '#060e10';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = amber;
    ctx.fillRect(0, 0, w, 26);
    ctx.font = `700 17px ${LATIN_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#08110c';
    ctx.fillText('BUS TIMES', w / 2, 14);
    const rows = ['48  02', '12  06', '07  11', '48  17', '12  24', '07  31', '48  38', '12  45'];
    ctx.font = `700 16px ${LATIN_FONT}`;
    ctx.textAlign = 'left';
    for (let i = 0; i < rows.length; i++) {
      const y = 46 + i * 24;
      ctx.fillStyle = i % 2 === 0 ? teal : cold;
      ctx.globalAlpha = 0.85;
      ctx.fillText(rows[i], 14, y);
      ctx.globalAlpha = 1;
    }
  });

  /* ---- the two back-lit posters */

  cell('ad0', (w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#062a33');
    g.addColorStop(1, '#031418');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = teal;
    ctx.lineWidth = 4;
    glow(ctx, teal, 16);
    ctx.strokeRect(7, 7, w - 14, h - 14);
    clearGlow(ctx);
    label('BE SYNTHETIC', teal, 13, w / 2, 30);
    label('SYNTPOWER', cold, 26, w / 2, 52);
    // A figure with its arms thrown up: a silhouette, no face, no likeness.
    ctx.strokeStyle = cold;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    glow(ctx, teal, 20);
    ctx.beginPath();
    ctx.arc(w / 2, 92, 12, 0, Math.PI * 2);
    ctx.moveTo(w / 2, 106);
    ctx.lineTo(w / 2, 142);
    ctx.moveTo(w / 2, 112);
    ctx.lineTo(w / 2 - 34, 82);
    ctx.moveTo(w / 2, 112);
    ctx.lineTo(w / 2 + 34, 82);
    ctx.moveTo(w / 2, 142);
    ctx.lineTo(w / 2 - 20, 172);
    ctx.moveTo(w / 2, 142);
    ctx.lineTo(w / 2 + 20, 172);
    ctx.stroke();
    clearGlow(ctx);
    label('BUY NOW', amber, 15, w / 2, h - 14);
  });

  cell('ad1', (w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#2a1408');
    g.addColorStop(1, '#150803');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = amber;
    ctx.lineWidth = 4;
    glow(ctx, amber, 16);
    ctx.strokeRect(7, 7, w - 14, h - 14);
    clearGlow(ctx);
    label('HOSHI TEA', amber, 24, w / 2, 34);
    ctx.font = `700 92px ${CJK_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    glow(ctx, hot, 26);
    ctx.fillStyle = hot;
    ctx.fillText('茶', w / 2, h / 2 + 6);
    clearGlow(ctx);
    label('COLD BREWED', cold, 13, w / 2, h - 22);
  });

  /* ---- what the bus itself carries */

  cell('roll', (w, h) => {
    ctx.fillStyle = '#050708';
    ctx.fillRect(0, 0, w, h);
    // A dot-matrix destination roll: the dots are the point.
    ctx.fillStyle = amber;
    ctx.globalAlpha = 0.12;
    for (let y = 8; y < h - 6; y += 5) for (let x = 8; x < w - 6; x += 5) ctx.fillRect(x, y, 3, 3);
    ctx.globalAlpha = 1;
    label('48  UNION ST', amber, 30, w / 2, h / 2);
  });

  cell('fleet', (w, h) => {
    // The strip of little ad screens along the roofline, as in the reference.
    const colors = [hot, teal, amber, cold, hot];
    const pad = 4;
    const cw = (w - pad * (colors.length + 1)) / colors.length;
    for (let i = 0; i < colors.length; i++) {
      const x = pad + i * (cw + pad);
      ctx.fillStyle = '#0a0f12';
      ctx.fillRect(x, pad, cw, h - pad * 2);
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = colors[i];
      ctx.fillRect(x + 3, pad + 3, cw - 6, h - pad * 2 - 6);
      ctx.globalAlpha = 1;
      glow(ctx, colors[i], 12);
      ctx.fillStyle = '#02060a';
      ctx.fillRect(x + 6, h / 2 - 4, cw - 12, 8);
      clearGlow(ctx);
    }
  });

  cell('plate', (w, h) => {
    ctx.fillStyle = '#0a0603';
    ctx.fillRect(0, 0, w, h);
    hatch(w - 62, 8, 54, h - 16, amber);
    label('M6117', amber, 38, 12, h / 2, 'left');
  });

  cell('band', (w, h) => {
    hatch(0, 0, w, h, amber);
    ctx.fillStyle = '#08100a';
    ctx.fillRect(w * 0.28, 4, w * 0.44, h - 8);
    label('- BUS STOP -', amber, 30, w / 2, h / 2 + 1);
  });

  return toTexture(cv);
}
