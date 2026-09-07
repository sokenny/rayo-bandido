import * as THREE from 'three';
import { PAL } from './palette';
import { canvas } from './textures';
import { makeRng } from './meshBuilder';
import { TEXTURE_ROOT } from '../../textures/manifest';
import type { EnvBuilders } from './builders';
import { isClear, type GraffitiSurface, type ReclaimProfile } from './reclaim';

/**
 * GRAFFITI AND GRIME — one atlas, one material, one draw call for every piece of illicit
 * paint and every damp streak in the city.
 *
 * THE PAINT is real graffiti art: nine hand-drawn pieces out of `public/textures/graffiti/`,
 * filling the atlas's twelve paint cells with the first three used a second time mirrored.
 * They carry their own colour, so the quad's vertex colour is not a hue here — it is
 * WEATHERING: how much of
 * the paint is left after a few years of weather, plus the slight wash towards the night the
 * whole city is graded into.
 *
 * They load the same way every other piece of art in this game does — in the background,
 * behind a procedural fallback drawn in the palette's spray colours — so a missing or slow
 * file costs the detail of the tags and nothing else, and start-up never waits.
 *
 * THE GRIME is the last four cells and stays procedural: streaks, a stain, a crack network
 * and corner soot. They ride the same atlas and the same material, tinted with `PAL.grime`
 * instead of left in the art's own colour, which is how the environmental decay costs nothing
 * extra to draw.
 *
 * WHAT KEEPS IT HONEST
 * - Every piece is placed on a `GraffitiSurface` a builder handed over: a rectangle of wall
 *   that is known to be blank, with `keepClear` rectangles for the windows, doors, shutters
 *   and lit signs on it. Nothing is ever painted over glass or over a sign.
 * - The quad stands `out` metres in front of the wall and the material carries a polygon
 *   offset, so no tag can z-fight with the concrete behind it.
 * - Placement is seeded from the surface's own position, so the same wall carries the same
 *   tags on every machine and in every session.
 * - Layering is deliberate and rare: only a heavily reclaimed pocket lets a second piece sit
 *   over the first.
 */

/* ------------------------------------------------------------------ the atlas */

const COLS = 4;
const ROWS = 4;
const CELL = 256;

/**
 * The graffiti art. Each file fills one atlas cell, stretched to the square; `aspect` is the
 * file's own shape, which `paintSurface` uses to size the quad so the piece comes out
 * unstretched on the wall. The values are the files' real pixel sizes — they are fixed
 * assets, and the geometry is built long before the images land, so they cannot be measured.
 */
const GRAFFITI_ART: ReadonlyArray<{ file: string; aspect: number; banner?: boolean }> = [
  { file: 'graffiti/textura-grafiti-1.webp', aspect: 200 / 200 },
  { file: 'graffiti/textura-grafiti-2.webp', aspect: 200 / 100 },
  { file: 'graffiti/textura-grafiti-3.webp', aspect: 200 / 200 },
  { file: 'graffiti/textura-grafiti-4.webp', aspect: 100 / 100 },
  { file: 'graffiti/textura-grafiti-5.webp', aspect: 100 / 50 },
  { file: 'graffiti/textura-grafiti-6.webp', aspect: 100 / 150 },
  // The three long banner pieces: wide, hand-lettered murals rather than tags. They are the
  // `pieces` pool below, so they only go up where a place has been given up on.
  { file: 'graffiti/textura-grafiti-7.webp', aspect: 768 / 256, banner: true },
  { file: 'graffiti/textura-grafiti-8.webp', aspect: 672 / 256, banner: true },
  { file: 'graffiti/textura-grafiti-9.webp', aspect: 512 / 256, banner: true },
];

/** How long the atlas waits for the art before the procedural fallback becomes permanent. */
const ART_TIMEOUT_MS = 4000;

/**
 * How far the art is pulled towards the night, and how hard. Photographed paint is lit by
 * daylight; without this the tags sit in front of the city rather than on it. Same idea as
 * the tint in `render/textures/manifest.ts`, applied here because this atlas is composited
 * from six files rather than loaded from one.
 */
const ART_TINT = 0.2;

/** Which file of `GRAFFITI_ART` a paint cell holds. Cells past the ninth repeat, mirrored. */
export function graffitiArtIndex(cell: number): number {
  return cell % GRAFFITI_ART.length;
}

/** How many distinct pieces of art the atlas draws from. */
export const GRAFFITI_ART_COUNT = GRAFFITI_ART.length;

/** The art a paint cell samples, and whether it is drawn mirrored. */
function artFor(cell: number): { art: (typeof GRAFFITI_ART)[number]; mirror: boolean } {
  return { art: GRAFFITI_ART[graffitiArtIndex(cell)], mirror: cell >= GRAFFITI_ART.length };
}

/**
 * True when a cell holds a lettered banner mural rather than abstract paint. A banner is laid
 * out to fit its wall: the whole line has to be readable, and the aggressive overflow crop
 * that makes an abstract piece read as wall-sized paint would leave a banner as an
 * unrecognisable magnified fragment of two letters.
 */
export function graffitiIsBanner(cell: number): boolean {
  const i = ((cell % 16) + 16) % 16;
  return i < 12 && !!artFor(i).art.banner;
}

/**
 * Width over height of what a cell holds. Paint takes its file's shape; the grime cells are
 * square. `paintSurface` sizes every quad from this, so nothing is ever stretched.
 */
export function graffitiAspect(cell: number): number {
  const i = ((cell % 16) + 16) % 16;
  return i < 12 ? artFor(i).art.aspect : 1;
}

/**
 * What each cell holds. The first twelve are paint, the last four are dirt; the placement
 * below reads these bands rather than magic numbers.
 */
export const GRAFFITI_CELLS = {
  /** The art. Drawn from by `pickPaintCell`, which spreads the files evenly across them. */
  paint: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  /** Not paint: streaks, a stain, cracks, corner soot. Tinted with `PAL.grime`. */
  grime: [12, 13, 14, 15],
} as const;

/**
 * One piece of art, drawn so every file in `GRAFFITI_ART` turns up on the city's walls the
 * same number of times.
 *
 * The atlas has twelve paint cells for nine files, so three of the files own a mirrored
 * second cell. Picking the FILE first and only then choosing between its cells is the whole
 * point of this function: picking a cell instead would make those three files twice as
 * common as the other six.
 */
export function pickPaintCell(rng: () => number): number {
  const n = GRAFFITI_ART.length;
  const art = Math.min(n - 1, Math.floor(rng() * n));
  const mirrored = art + n;
  // Half the time, the file's mirrored cell — for the files that have one.
  return mirrored < GRAFFITI_CELLS.paint.length && rng() < 0.5 ? mirrored : art;
}

/** UV rect of one cell, inset by a couple of texels so mipmaps cannot bleed neighbours. */
export function graffitiCell(index: number): { u0: number; v0: number; u1: number; v1: number } {
  const i = ((index % (COLS * ROWS)) + COLS * ROWS) % (COLS * ROWS);
  const col = i % COLS;
  const row = Math.floor(i / COLS);
  const pad = 0.004;
  return {
    u0: col / COLS + pad,
    u1: (col + 1) / COLS - pad,
    // Canvas rows grow downward, texture v grows upward.
    v0: 1 - (row + 1) / ROWS + pad,
    v1: 1 - row / ROWS - pad,
  };
}

type Ctx = CanvasRenderingContext2D;

/** A wobbling polyline through `pts`, drawn as a spray stroke: soft edge, hard core. */
function stroke(ctx: Ctx, pts: Array<[number, number]>, width: number, alpha: number, rng: () => number): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Halo first (the overspray around a line), then the wet core.
  for (const [w, a] of [
    [width * 2.1, alpha * 0.22],
    [width, alpha],
  ] as const) {
    ctx.strokeStyle = `rgba(255,255,255,${a})`;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
      const [px, py] = pts[i - 1];
      const [x, y] = pts[i];
      // A hand-drawn line is never straight: bend each span off its own midpoint.
      const mx = (px + x) / 2 + (rng() - 0.5) * width * 1.6;
      const my = (py + y) / 2 + (rng() - 0.5) * width * 1.6;
      ctx.quadraticCurveTo(mx, my, x, y);
    }
    ctx.stroke();
  }
}

/** A run of paint down from a point: what a can does when it is held too long. */
function drip(ctx: Ctx, x: number, y: number, len: number, w: number, alpha: number): void {
  ctx.fillStyle = `rgba(255,255,255,${alpha})`;
  ctx.fillRect(x - w / 2, y, w, len);
  ctx.beginPath();
  ctx.arc(x, y + len, w * 0.75, 0, Math.PI * 2);
  ctx.fill();
}

/** The dust a can throws around the line: scattered dots, thickest near the middle. */
function overspray(ctx: Ctx, cx: number, cy: number, r: number, n: number, alpha: number, rng: () => number): void {
  for (let i = 0; i < n; i++) {
    const a = rng() * Math.PI * 2;
    const d = Math.pow(rng(), 0.6) * r;
    const s = 0.6 + rng() * 2.2;
    ctx.fillStyle = `rgba(255,255,255,${alpha * (0.25 + rng() * 0.75)})`;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, s, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** A scrawl: an angular, looping run across the cell. No letters, nothing readable. */
function scrawl(ctx: Ctx, rng: () => number, x0: number, y0: number, w: number, h: number, steps: number, width: number, alpha: number): void {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // Zig-zag up and down the band, with the odd big overshoot: the flourish of a tag.
    const over = rng() < 0.25 ? 1.35 : 1;
    pts.push([x0 + w * t + (rng() - 0.5) * w * 0.06, y0 + h * (0.5 + Math.sin(t * Math.PI * steps * 0.55 + rng()) * 0.42 * over)]);
  }
  stroke(ctx, pts, width, alpha, rng);
  if (rng() < 0.7) drip(ctx, pts[Math.floor(rng() * pts.length)][0], y0 + h * 0.72, 10 + rng() * 34, width * 0.4, alpha * 0.55);
}

/** An outlined blob: the body of a throw-up. */
function blob(ctx: Ctx, rng: () => number, cx: number, cy: number, rx: number, ry: number, fill: number, line: number): void {
  const n = 7;
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = 0.72 + rng() * 0.4;
    const x = cx + Math.cos(a) * rx * r;
    const y = cy + Math.sin(a) * ry * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = `rgba(255,255,255,${fill})`;
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = `rgba(255,255,255,${line})`;
  ctx.stroke();
}

/**
 * The 4 x 4 atlas. Everything is white-on-transparent; the mesh supplies the colour. The
 * shapes are deliberately abstract — no letters, no words, nothing that could be read as a
 * name or a brand.
 */
function makeAtlasCanvas(): { cv: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const { cv, ctx } = canvas(CELL * COLS, CELL * ROWS);
  ctx.clearRect(0, 0, cv.width, cv.height);

  const cell = (i: number, draw: (rng: () => number) => void): void => {
    const x = (i % COLS) * CELL;
    const y = Math.floor(i / COLS) * CELL;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, CELL, CELL);
    ctx.clip();
    ctx.translate(x, y);
    draw(makeRng(0x6e0d + i * 977));
    // The paint cells are drawn white and then washed with one of the palette's spray
    // colours: this is only the fallback, so it wants to read as paint at a glance rather
    // than to compete with the art that is about to replace it.
    if (i < 12) {
      ctx.globalCompositeOperation = 'source-atop';
      const c = PAL.paint[i % PAL.paint.length];
      ctx.fillStyle = `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},0.8)`;
      ctx.fillRect(0, 0, CELL, CELL);
    }
    ctx.restore();
  };

  // 0-2 quick tags: one stroke across the cell, at three angles and weights.
  cell(0, (rng) => {
    scrawl(ctx, rng, 14, 52, 228, 150, 7, 17, 0.95);
    overspray(ctx, 128, 128, 108, 160, 0.32, rng);
  });
  cell(1, (rng) => {
    scrawl(ctx, rng, 18, 34, 220, 180, 5, 24, 0.92);
    stroke(ctx, [[22, 212], [234, 200]], 11, 0.7, rng);
    overspray(ctx, 128, 130, 120, 140, 0.28, rng);
  });
  cell(2, (rng) => {
    scrawl(ctx, rng, 20, 70, 214, 120, 9, 12, 0.88);
    scrawl(ctx, rng, 36, 132, 180, 92, 6, 9, 0.6);
    overspray(ctx, 128, 128, 104, 120, 0.24, rng);
  });

  // 3-4 throw-ups: bubbles and blocks, an outline over a half-filled body.
  cell(3, (rng) => {
    for (let i = 0; i < 3; i++) blob(ctx, rng, 52 + i * 76, 128 + (rng() - 0.5) * 26, 52, 62, 0.72, 0.98);
    for (let i = 0; i < 3; i++) drip(ctx, 44 + i * 78 + rng() * 20, 172, 18 + rng() * 46, 6, 0.5);
    overspray(ctx, 128, 128, 118, 80, 0.2, rng);
  });
  cell(4, (rng) => {
    ctx.lineWidth = 9;
    for (let i = 0; i < 4; i++) {
      const x = 26 + i * 56;
      const h = 92 + rng() * 64;
      ctx.strokeStyle = 'rgba(255,255,255,0.98)';
      ctx.fillStyle = 'rgba(255,255,255,0.62)';
      ctx.beginPath();
      ctx.moveTo(x, 190);
      ctx.lineTo(x + 12 + rng() * 12, 190 - h);
      ctx.lineTo(x + 44, 190 - h * (0.5 + rng() * 0.4));
      ctx.lineTo(x + 34, 190);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    scrawl(ctx, rng, 30, 30, 196, 44, 6, 6, 0.6);
  });

  // 5-6 pieces: the big abstract wall paintings. Layered tones, arrows, a highlight.
  cell(5, (rng) => {
    ctx.fillStyle = 'rgba(255,255,255,0.52)';
    ctx.fillRect(12, 46, 232, 164);
    ctx.lineWidth = 13;
    for (let i = 0; i < 5; i++) {
      const x = 20 + i * 46;
      ctx.strokeStyle = `rgba(255,255,255,${0.55 + rng() * 0.4})`;
      ctx.beginPath();
      ctx.moveTo(x, 200 - rng() * 24);
      ctx.lineTo(x + 20 + rng() * 22, 60 + rng() * 30);
      ctx.lineTo(x + 44, 190 - rng() * 40);
      ctx.stroke();
    }
    // A cut-through arrow: the one shape every piece has.
    stroke(ctx, [[16, 82], [140, 66], [244, 96]], 13, 0.95, rng);
    stroke(ctx, [[214, 60], [244, 96], [206, 122]], 13, 0.95, rng);
    overspray(ctx, 128, 128, 130, 110, 0.18, rng);
  });
  cell(6, (rng) => {
    for (let i = 0; i < 6; i++) {
      ctx.save();
      ctx.translate(40 + rng() * 176, 50 + rng() * 150);
      ctx.rotate((rng() - 0.5) * 1.4);
      ctx.fillStyle = `rgba(255,255,255,${0.42 + rng() * 0.5})`;
      ctx.fillRect(-40 - rng() * 40, -14 - rng() * 16, 80 + rng() * 80, 28 + rng() * 30);
      ctx.restore();
    }
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.strokeRect(18, 44, 220, 168);
    scrawl(ctx, rng, 34, 96, 188, 76, 7, 12, 0.9);
  });

  // 7-9 marks: a drip band, an overspray cloud with a tag in it, a hard stencil.
  cell(7, (rng) => {
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillRect(10, 96, 236, 26);
    for (let i = 0; i < 12; i++) drip(ctx, 20 + rng() * 216, 120, 12 + rng() * 90, 4 + rng() * 7, 0.35 + rng() * 0.4);
    overspray(ctx, 128, 110, 124, 90, 0.22, rng);
  });
  cell(8, (rng) => {
    overspray(ctx, 128, 128, 116, 420, 0.32, rng);
    scrawl(ctx, rng, 40, 100, 176, 64, 6, 9, 0.9);
  });
  cell(9, (rng) => {
    // A stencil: hard edges, a few cut bridges, sprayed through in one pass.
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    for (let i = 0; i < 5; i++) {
      const w = 24 + rng() * 46;
      ctx.fillRect(30 + i * 40, 72 + rng() * 30, w, 96 + rng() * 40);
    }
    ctx.clearRect(0, 118, CELL, 12);
    ctx.clearRect(0, 160, CELL, 8);
    overspray(ctx, 128, 128, 128, 60, 0.16, rng);
  });

  // 10-11 buffed and layered: a roller patch with something coming back through it, and a
  // fresh tag over an older one.
  cell(10, (rng) => {
    scrawl(ctx, rng, 20, 70, 216, 110, 7, 14, 0.9);
    // The buff: a rectangle of mismatched paint over most of it, drawn by erasing.
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0,0,0,0.78)';
    ctx.fillRect(8, 54, 214, 146);
    ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.fillRect(8, 54, 214, 146);
    for (let i = 0; i < 5; i++) drip(ctx, 20 + rng() * 200, 200, 10 + rng() * 30, 5, 0.2);
  });
  cell(11, (rng) => {
    scrawl(ctx, rng, 12, 66, 232, 118, 9, 15, 0.4);
    scrawl(ctx, rng, 46, 88, 168, 80, 6, 9, 0.95);
    overspray(ctx, 128, 128, 110, 70, 0.2, rng);
  });

  // 12-15 grime. Not paint: tinted dark and used on concrete, kerbs, columns and soffits.
  // 12 moisture streaks: what runs down a wall from a broken gutter.
  cell(12, (rng) => {
    for (let i = 0; i < 16; i++) {
      const x = rng() * CELL;
      const w = 3 + rng() * 16;
      const g = ctx.createLinearGradient(0, 0, 0, CELL);
      const a = 0.2 + rng() * 0.5;
      g.addColorStop(0, `rgba(255,255,255,${a})`);
      g.addColorStop(0.65, `rgba(255,255,255,${a * 0.5})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x, rng() * 40, w, CELL - rng() * 50);
    }
  });
  // 13 stain: an irregular damp blotch, darkest in the middle.
  cell(13, (rng) => {
    for (let i = 0; i < 26; i++) {
      const x = 128 + (rng() - 0.5) * 150;
      const y = 128 + (rng() - 0.5) * 150;
      const r = 20 + rng() * 60;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(255,255,255,${0.1 + rng() * 0.16})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  // 14 cracks: a thin branching network, the way concrete actually fails.
  cell(14, (rng) => {
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineCap = 'round';
    const walk = (x: number, y: number, a: number, len: number, w: number, depth: number): void => {
      if (depth > 3 || len < 6) return;
      let px = x;
      let py = y;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(px, py);
      const steps = 5;
      for (let i = 0; i < steps; i++) {
        a += (rng() - 0.5) * 0.7;
        px += Math.cos(a) * (len / steps);
        py += Math.sin(a) * (len / steps);
        ctx.lineTo(px, py);
      }
      ctx.stroke();
      if (rng() < 0.8) walk(px, py, a + (rng() - 0.5) * 1.5, len * 0.62, w * 0.7, depth + 1);
      if (rng() < 0.45) walk(px, py, a + (rng() - 0.5) * 2.2, len * 0.5, w * 0.6, depth + 1);
    };
    for (let i = 0; i < 3; i++) walk(rng() * CELL, rng() * 40, Math.PI / 2 + (rng() - 0.5) * 0.8, 90, 3.5, 0);
  });
  // 15 soot: a corner of grime, heaviest where two surfaces meet.
  cell(15, (rng) => {
    const g = ctx.createLinearGradient(0, CELL, 0, 0);
    g.addColorStop(0, 'rgba(255,255,255,0.5)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.18)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CELL, CELL);
    overspray(ctx, 128, 210, 140, 260, 0.2, rng);
  });

  return { cv, ctx };
}

export interface GraffitiAtlas {
  texture: THREE.CanvasTexture;
  /** Resolves once the art is composited in, or once it has been given up on. */
  ready: Promise<void>;
  dispose(): void;
}

/**
 * The atlas: the procedural fallback now, the real art as soon as it arrives.
 *
 * Twelve paint cells are filled from nine files, the first three of them used a second time
 * mirrored. Every file is stretched to fill its square cell — `graffitiAspect` then gives the quad its
 * true shape back — which keeps the atlas free of transparent padding and every tag as large
 * on the wall as the cell can make it.
 */
export function makeGraffitiAtlas(): GraffitiAtlas {
  const { cv, ctx } = makeAtlasCanvas();
  const texture = new THREE.CanvasTexture(cv);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 4;
  texture.needsUpdate = true;

  let disposed = false;
  const images: HTMLImageElement[] = [];

  const load = (file: string): Promise<HTMLImageElement | null> =>
    new Promise((resolve) => {
      const img = new Image();
      images.push(img);
      let settled = false;
      const finish = (found: HTMLImageElement | null): void => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(found);
      };
      const timer = window.setTimeout(() => finish(null), ART_TIMEOUT_MS);
      img.onload = () => finish(img);
      img.onerror = () => finish(null);
      img.src = TEXTURE_ROOT + file;
    });

  const ready = Promise.all(GRAFFITI_ART.map((a) => load(a.file))).then((loaded) => {
    if (disposed) return;
    let any = false;
    for (let i = 0; i < 12; i++) {
      const { art, mirror } = artFor(i);
      const img = loaded[GRAFFITI_ART.indexOf(art)];
      if (!img) continue;
      any = true;
      const x = (i % COLS) * CELL;
      const y = Math.floor(i / COLS) * CELL;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, CELL, CELL);
      ctx.clip();
      // Clear the fallback out from under it: the art carries its own alpha.
      ctx.clearRect(x, y, CELL, CELL);
      ctx.translate(x + (mirror ? CELL : 0), y);
      ctx.scale(mirror ? -1 : 1, 1);
      ctx.drawImage(img, 0, 0, CELL, CELL);
      // The wash into the night, applied only where the paint is.
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = `rgba(${(PAL.fog >> 16) & 255},${(PAL.fog >> 8) & 255},${PAL.fog & 255},${ART_TINT})`;
      ctx.fillRect(0, 0, CELL, CELL);
      ctx.restore();
    }
    if (any) texture.needsUpdate = true;
  });

  return {
    texture,
    ready,
    dispose() {
      disposed = true;
      for (const img of images) {
        img.onload = null;
        img.onerror = null;
      }
      texture.dispose();
    },
  };
}

/** Program cache key for the one shader patch this material carries. */
export const DECAL_CACHE_KEY = 'rb-decal-v2';

/**
 * How hard fresh paint reads at night. The city is lit by a hemisphere light and nothing
 * else, so a tag on a vertical wall would come out as dark as the concrete under it and the
 * graffiti would simply not be there. A small emissive, tinted by the quad's own colour, is
 * what puts it back — cheap, and consistent with a city whose windows, signs and neon are all
 * emissive rather than lit. It is deliberately well under a sign's: paint catches light, it
 * does not give any off. The grime cells ride the same material and tint dark, so their
 * emissive comes out near black on its own.
 */
export const DECAL_EMISSIVE = 0.3;

/**
 * How opaque paint comes out on the wall. Spray on concrete is thin: the wall's texture and
 * its grime come through the colour rather than being covered by it, and a piece drawn at
 * full alpha reads as a sticker stuck on the building instead of as paint that soaked into
 * it. The grime cells are exempt — dirt is not thin — so this is not the material's own
 * `opacity` but a factor applied in the shader against the atlas row: the last row is grime,
 * everything above it is paint.
 */
export const PAINT_ALPHA = 0.5;

/**
 * How far past its wall a piece is allowed to run before it is cut. At 3 a piece is laid out
 * three times the height of the barrier it is on and the barrier shows the middle third of
 * it — which is what makes trackside paint read as paint at speed rather than as a sticker
 * with air around it. Higher than this and the visible band is too small a fraction of the
 * art to be recognisable as anything.
 */
const OVERFLOW = 3;

/** v below this is the grime row of the atlas; above it is paint. */
const PAINT_V = 1 / ROWS;

/**
 * The one decal material. Standard-lit, so paint on a wall takes the same light the wall
 * does; alpha-blended without writing depth and with a polygon offset, so a tag can never
 * fight the concrete it sits on nor punch a hole in what is behind it.
 *
 * The one shader patch takes the vertex colour into the emissive term as well as the diffuse:
 * `emissiveMap` is the atlas, which is white where the paint is, so the emissive comes out in
 * the tag's own colour without a second texture or a second material.
 */
export function createDecalMaterial(atlas: THREE.Texture): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    map: atlas,
    emissive: 0xffffff,
    emissiveMap: atlas,
    emissiveIntensity: DECAL_EMISSIVE,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    roughness: 0.96,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
    side: THREE.FrontSide,
  });
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance *= vColor;',
      )
      // Thin the paint, and only the paint: `step` is 1 on the twelve paint cells and 0 on
      // the grime row along the bottom of the atlas.
      .replace(
        '#include <alphamap_fragment>',
        `#include <alphamap_fragment>\n\tdiffuseColor.a *= mix(1.0, ${PAINT_ALPHA.toFixed(3)}, step(${PAINT_V.toFixed(4)}, vMapUv.y));`,
      );
  };
  material.customProgramCacheKey = () => DECAL_CACHE_KEY;
  return material;
}

/* ------------------------------------------------------------------ placement */

/**
 * The part of a cell a quad shows, as fractions of the cell: what is left of a piece after
 * the wall it is on has cut the rest of it off.
 */
interface Crop {
  fu0: number;
  fv0: number;
  fu1: number;
  fv1: number;
}

/** A cell's UV rect narrowed to the part of the art a cropped quad actually shows. */
function cropCell(uv: { u0: number; v0: number; u1: number; v1: number }, crop?: Crop): typeof uv {
  if (!crop) return uv;
  const du = uv.u1 - uv.u0;
  const dv = uv.v1 - uv.v0;
  return {
    u0: uv.u0 + du * crop.fu0,
    u1: uv.u0 + du * crop.fu1,
    v0: uv.v0 + dv * crop.fv0,
    v1: uv.v0 + dv * crop.fv1,
  };
}

/**
 * The visible part of a piece that was laid out bigger than the wall it is on: the rectangle
 * where the wanted quad and the surface overlap, plus the slice of the art that rectangle
 * shows. This is how a piece gets to be larger than the concrete — the paint runs off the top
 * and the ends of the wall and is simply cut there, the way it is when someone paints a
 * barrier that is shorter than the piece they had in mind. Returns null if the overlap is
 * too small to be worth a quad.
 */
function clipToSurface(
  s: GraffitiSurface,
  across: number,
  up: number,
  w: number,
  h: number,
): { across: number; up: number; w: number; h: number; crop?: Crop } | null {
  const x0 = Math.max(across - w / 2, -s.width / 2);
  const x1 = Math.min(across + w / 2, s.width / 2);
  const y0 = Math.max(up - h / 2, 0);
  const y1 = Math.min(up + h / 2, s.height);
  if (x1 - x0 < 0.15 || y1 - y0 < 0.15) return null;
  const vw = x1 - x0;
  const vh = y1 - y0;
  // Untouched: no crop, so the caller keeps its tilt and the whole cell is drawn.
  if (vw > w - 1e-4 && vh > h - 1e-4) return { across, up, w, h };
  return {
    across: (x0 + x1) / 2,
    up: (y0 + y1) / 2,
    w: vw,
    h: vh,
    crop: {
      fu0: (x0 - (across - w / 2)) / w,
      fu1: (x1 - (across - w / 2)) / w,
      fv0: (y0 - (up - h / 2)) / h,
      fv1: (y1 - (up - h / 2)) / h,
    },
  };
}

/**
 * One decal on a face, at `across` metres from its centre and `up` metres above its base,
 * tilted by `tilt` radians in the plane of the wall. Written straight into the decal builder
 * as a single quad: two triangles, whatever the piece. `crop` narrows the slice of the cell
 * it shows, for a piece the wall has cut down (see `clipToSurface`).
 */
export function decal(
  b: EnvBuilders,
  s: GraffitiSurface,
  across: number,
  up: number,
  w: number,
  h: number,
  tilt: number,
  cellIndex: number,
  color: number,
  bright: number,
  flip = false,
  crop?: Crop,
): void {
  const uv = cropCell(graffitiCell(cellIndex), crop);
  // In-plane axes: `t` along the run (which may climb — see `GraffitiSurface.ty`) and `u` up
  // the wall, perpendicular to it. `u` is the face normal crossed with `t`, which comes out
  // as straight world-up on the level walls that are most of the city.
  const ty = s.ty ?? 0;
  const tl = Math.hypot(s.tx, ty, s.tz) || 1;
  const tux = s.tx / tl;
  const tuy = ty / tl;
  const tuz = s.tz / tl;
  let ux = -s.nz * tuy;
  let uy = s.nz * tux - s.nx * tuz;
  let uz = s.nx * tuy;
  // The cross product's sign follows which side of the run the face is on; "up the wall" is
  // up either way.
  const ul = (Math.hypot(ux, uy, uz) || 1) * (uy < 0 ? -1 : 1);
  ux /= ul;
  uy /= ul;
  uz /= ul;
  const ox = s.x + s.nx * s.out + tux * across + ux * up;
  const oy = s.y + tuy * across + uy * up;
  const oz = s.z + s.nz * s.out + tuz * across + uz * up;
  // Both axes rotated by the tilt, in the plane of the wall.
  const c = Math.cos(tilt);
  const sn = Math.sin(tilt);
  const ax = tux * c + ux * sn;
  const ay = tuy * c + uy * sn;
  const az = tuz * c + uz * sn;
  const bx = -tux * sn + ux * c;
  const by = -tuy * sn + uy * c;
  const bz = -tuz * sn + uz * c;
  const hw = w / 2;
  const hh = h / 2;
  const u0 = flip ? uv.u1 : uv.u0;
  const u1 = flip ? uv.u0 : uv.u1;
  b.decal.color(color, bright);
  b.decal.quad(
    ox - ax * hw - bx * hh, oy - ay * hw - by * hh, oz - az * hw - bz * hh,
    ox + ax * hw - bx * hh, oy + ay * hw - by * hh, oz + az * hw - bz * hh,
    ox + ax * hw + bx * hh, oy + ay * hw + by * hh, oz + az * hw + bz * hh,
    ox - ax * hw + bx * hh, oy - ay * hw + by * hh, oz - az * hw + bz * hh,
    u0, uv.v0, u1, uv.v1,
  );
}

/**
 * How much of a piece is left. The art carries its own colour, so the vertex colour here is
 * weathering, not hue: near-white for something painted last week, dropped a long way and
 * pulled towards the night for something that has been through twenty winters. A small hue
 * shift towards one of the palette's spray colours keeps two pieces of the same art from
 * reading as the same piece.
 */
function weather(rng: () => number, profile: ReclaimProfile): { color: number; bright: number } {
  // Most paint here is old. A heavily reclaimed pocket has fresh work in it as well.
  const fresh = rng() < 0.25 + profile.intensity * 0.4;
  const c = PAL.paint[Math.floor(rng() * PAL.paint.length)];
  // Blend that spray colour a little way into white: at 0.25 it is a tint on the art's own
  // colours, not a replacement for them.
  const mix = 0.18 + rng() * 0.16;
  const r = Math.round(255 * (1 - mix) + ((c >> 16) & 255) * mix);
  const g = Math.round(255 * (1 - mix) + ((c >> 8) & 255) * mix);
  const b = Math.round(255 * (1 - mix) + (c & 255) * mix);
  return { color: (r << 16) | (g << 8) | b, bright: fresh ? 0.85 + rng() * 0.35 : 0.4 + rng() * 0.35 };
}

/**
 * Paint a surface. How many pieces, how big and how layered all come from the reclamation
 * profile: a maintained wall gets one small tag near the ground if anything, a given-up one
 * gets a piece across it with tags over the top.
 *
 * `detail` thins the work on surfaces that are only ever seen from a distance (the far side
 * of a viaduct, a column deep under a deck): one simple mark instead of a composition.
 */
export function paintSurface(
  b: EnvBuilders,
  s: GraffitiSurface,
  profile: ReclaimProfile,
  seed: number,
  detail: 'near' | 'far' = 'near',
): void {
  if (profile.graffiti <= 0.02) return;
  const rng = makeRng(seed);
  if (rng() > profile.graffiti) return;
  const area = s.width * s.height;
  // One piece per twenty square metres of wall at full intensity — the pieces are wall-sized
  // now, so this is already several layers of paint over each other. `profile.graffiti` is
  // what makes a maintained street carry one tag and a given-up pocket carry the cap.
  const budget = detail === 'far' ? 1 : Math.min(6, Math.max(1, Math.round((area / 20) * profile.graffiti)));
  const scale = profile.graffitiScale;

  for (let i = 0; i < budget; i++) {
    // Which art, and how big a go the writer had at it, are two independent draws. They used
    // to be one — a "kind of piece" that chose a pool and a size together — which meant the
    // art in the small pools covered several times as much of the city as the art in the big
    // ones. The size still varies the same way; it just no longer decides which piece it is.
    const cellIndex = pickPaintCell(rng);
    // A big go at it: a piece across the wall rather than something quick at eye level. Only
    // where a place has been let go, and never on a surface only ever seen from a distance.
    const big = detail !== 'far' && rng() < (profile.level >= 2 ? 0.3 : 0.16);

    // Size: paint here is building-sized, and it is NOT limited by the wall. A piece is laid
    // out at the size the writer wanted it and then cut by the concrete it is on: a barrier a
    // metre tall carries the middle band of a three-metre piece, with the top and the ends of
    // it running off the edges. `clipToSurface` does the cutting in UV space, so the overflow
    // costs nothing and nothing ever hangs in the air past the wall. `OVERFLOW` is the limit
    // on how much of a piece may be lost — beyond it the crop is so tight that what is left
    // reads as an abstract smear rather than as paint. A lettered banner is the exception: it
    // is fitted to its wall, because a cropped one cannot be read at all.
    const aspect = graffitiAspect(cellIndex);
    const want = (big ? 34 + rng() * 34 : 17 + rng() * 20) * (0.65 + scale * 0.6);
    let w = want;
    let h = w / aspect;
    const room = graffitiIsBanner(cellIndex) ? 0.98 : OVERFLOW;
    const fit = Math.min(1, (s.width * room) / w, (s.height * room) / h);
    w *= fit;
    h *= fit;
    const halfH = h / 2;
    // Somewhere on the wall a person could reach: low, unless the piece is a big one. A piece
    // taller than the wall is centred on it, so it crops evenly top and bottom.
    let across = 0;
    let up = 0;
    let vis: ReturnType<typeof clipToSurface> = null;
    for (let attempt = 0; attempt < 6 && !vis; attempt++) {
      across = (rng() - 0.5) * Math.max(0, s.width - w);
      if (h >= s.height) {
        up = s.height / 2;
      } else {
        const reach = Math.max(halfH, Math.min(s.height - halfH, big ? s.height * 0.8 : 3.4));
        up = halfH + rng() * Math.max(0.05, reach - halfH);
      }
      const clipped = clipToSurface(s, across, up, w, h);
      // Only what survives the crop has to stay off the windows and the signs.
      if (clipped && isClear(s.keepClear, clipped.across, clipped.up, clipped.w / 2, clipped.h / 2)) vis = clipped;
    }
    if (!vis) continue;
    const { color, bright } = weather(rng, profile);
    // The art is already mirrored in half the atlas, so a flip here would only undo it. A
    // cropped piece is drawn square to the wall: the crop is axis-aligned, so a tilt on top
    // of it would cut the art along the wrong line.
    decal(
      b, s, vis.across, vis.up, vis.w, vis.h,
      vis.crop ? 0 : (rng() - 0.5) * 0.18,
      cellIndex, color, bright, false, vis.crop,
    );
    // A second, smaller tag straight over the first, only where the place has been given up.
    if (profile.level >= 3 && rng() < 0.35) {
      const over = pickPaintCell(rng);
      const w2 = w * (0.45 + rng() * 0.35);
      const h2 = w2 / graffitiAspect(over);
      // Cut by the wall like the piece under it, rather than shrunk to fit inside it.
      const v2 = clipToSurface(s, across + (rng() - 0.5) * w * 0.4, up + (rng() - 0.5) * h * 0.3, w2, h2);
      if (v2) {
        const c2 = weather(rng, profile);
        decal(
          b, s, v2.across, v2.up, v2.w, v2.h,
          v2.crop ? 0 : (rng() - 0.5) * 0.35,
          over, c2.color, c2.bright, false, v2.crop,
        );
      }
    }
  }
}

/**
 * Dirt rather than paint: damp streaks under a lip, a stain on a column, a crack network in
 * a slab. Same atlas, same material, tinted with the palette's grime.
 */
export function grimeSurface(
  b: EnvBuilders,
  s: GraffitiSurface,
  profile: ReclaimProfile,
  seed: number,
  kind: 'streak' | 'stain' | 'crack' | 'soot' = 'stain',
): void {
  if (profile.decay <= 0.02) return;
  const rng = makeRng(seed);
  if (rng() > profile.decay) return;
  const cellIndex = kind === 'streak' ? 12 : kind === 'stain' ? 13 : kind === 'crack' ? 14 : 15;
  const n = 1 + (profile.level >= 2 && rng() < 0.5 ? 1 : 0);
  for (let i = 0; i < n; i++) {
    // Streaks hang from the top of the surface; everything else sits anywhere on it.
    const w = Math.min(s.width * 0.9, (kind === 'streak' ? 1.4 : 1.8) + rng() * 3.4);
    const h = Math.min(s.height * 0.95, kind === 'streak' ? s.height * (0.5 + rng() * 0.5) : w * (0.6 + rng() * 0.7));
    const across = (rng() - 0.5) * Math.max(0, s.width - w);
    const up = kind === 'streak' ? s.height - h / 2 : kind === 'soot' ? h / 2 : h / 2 + rng() * Math.max(0.1, s.height - h);
    decal(b, s, across, up, w, h, 0, cellIndex, PAL.grime, 0.55 + rng() * 0.6, rng() < 0.5);
  }
}
