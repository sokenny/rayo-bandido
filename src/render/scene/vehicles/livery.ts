import * as THREE from 'three';

/**
 * Procedural "Rayo Bandido" livery: dark blue-black paint torn by lengthwise magenta /
 * violet shards with a few electric-cyan splinters.
 *
 * Since the workshop this is the `vinyls.rayo` layer of the paint shop (`paintShop.ts`): the
 * shards are painted once per colour into a 512² canvas exactly as they always were, and the
 * paint shop lays that canvas onto every region of the body atlas with the same projection the
 * old lengthwise uvs used, so the stock car looks as it did. In magenta (the stock layer colour)
 * the shards are the original colours to the byte; in any other palette colour they are the
 * same shards hue-rotated onto it.
 *
 * `createLiveryTexture()` is the pre-workshop texture itself (base + shards, for the old
 * lengthwise uvs), kept so the paint harness can render the old look beside the new one.
 * Returns `null` when there is no DOM (unit tests run under Node).
 */

export const LIVERY_SIZE = 512;

const BASE = '#070915';
const SHARDS = [
  '#1b1f52',
  '#2a1b6b',
  '#5b21b6',
  '#7c2ff0',
  '#b32ad6',
  '#e0219a',
  '#ff2fa8',
  '#ff5bd0',
];
const SPARKS = ['#22d3ee', '#7df9ff'];
const HOT_EDGE = '#ff6fdc';

/** The colours the shards are cut from. */
export interface LiveryPalette {
  shards: readonly string[];
  sparks: readonly string[];
  hotEdge: string;
}

export const RAYO_PALETTE: LiveryPalette = { shards: SHARDS, sparks: SPARKS, hotEdge: HOT_EDGE };

/** The stock layer's colour (`magenta` in the palette): the one the shards were drawn for. */
export const RAYO_REFERENCE_HEX = '#ff2fd0';

/* ---------------------------------------------------------------- colour maths */

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const hue = (p: number, q: number, t: number): number => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  let r: number;
  let g: number;
  let b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue(p, q, h + 1 / 3);
    g = hue(p, q, h);
    b = hue(p, q, h - 1 / 3);
  }
  const to = (v: number): string => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

/**
 * The shard palette moved onto `hex`: every colour turned by the hue between magenta and
 * `hex`, its saturation scaled by theirs and its lightness pulled a little toward `hex`'s. Magenta
 * itself returns the original palette untouched (the stock car).
 */
export function liveryPaletteFor(hex: string): LiveryPalette {
  if (hex.toLowerCase() === RAYO_REFERENCE_HEX) return RAYO_PALETTE;
  const [rh, rs, rl] = rgbToHsl(...hexToRgb(RAYO_REFERENCE_HEX));
  const [th, ts, tl] = rgbToHsl(...hexToRgb(hex));
  const dh = th - rh;
  const sat = rs > 0 ? ts / rs : 1;
  const move = (c: string): string => {
    const [h, s, l] = rgbToHsl(...hexToRgb(c));
    const nl = l + (tl - rl) * 0.45 * Math.min(1, l / Math.max(0.01, rl));
    return hslToHex((h + dh + 1) % 1, Math.min(1, s * sat), Math.max(0, Math.min(0.95, nl)));
  };
  return { shards: SHARDS.map(move), sparks: SPARKS.map(move), hotEdge: move(HOT_EDGE) };
}

/* -------------------------------------------------------------------- drawing */

/** Tiny deterministic PRNG so the livery is identical on every run. */
function makeRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function ribbon(
  ctx: CanvasRenderingContext2D,
  rand: () => number,
  yCenter: number,
  thickness: number,
  slant: number,
  fill: string,
): void {
  const steps = 6;
  const top: number[] = [];
  const bottom: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = t * LIVERY_SIZE;
    const drift = slant * (t - 0.5) * LIVERY_SIZE;
    const jitter = (rand() - 0.5) * thickness * 1.1;
    top.push(x, yCenter + drift + jitter - thickness * 0.5);
    bottom.push(x, yCenter + drift + jitter + thickness * 0.5);
  }
  ctx.beginPath();
  ctx.moveTo(top[0], top[1]);
  for (let i = 1; i <= steps; i++) ctx.lineTo(top[i * 2], top[i * 2 + 1]);
  for (let i = steps; i >= 0; i--) ctx.lineTo(bottom[i * 2], bottom[i * 2 + 1]);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

function splinter(ctx: CanvasRenderingContext2D, rand: () => number, fill: string): void {
  const x = rand() * LIVERY_SIZE;
  const y = rand() * LIVERY_SIZE;
  const len = 60 + rand() * 220;
  const dy = (rand() - 0.5) * 120;
  const w = 3 + rand() * 16;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + len, y + dy);
  ctx.lineTo(x + len * 0.55, y + dy * 0.55 + w);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

/**
 * The shards, into a `LIVERY_SIZE`² context. With `base` the canvas is filled with it first
 * (the old texture); without, the shards go onto transparency (the vinyl layer), which composites
 * over the paint to exactly what drawing them on it would have.
 */
export function drawLivery(ctx: CanvasRenderingContext2D, palette: LiveryPalette = RAYO_PALETTE, base: string | null = BASE): void {
  const SIZE = LIVERY_SIZE;
  const shards = palette.shards;
  const sparks = palette.sparks;
  ctx.save();
  if (base) {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, SIZE, SIZE);
  } else {
    ctx.clearRect(0, 0, SIZE, SIZE);
  }

  const rand = makeRandom(0x8a17c0de);

  // Broad torn ribbons running along the car's length.
  for (let i = 0; i < 22; i++) {
    const yCenter = rand() * SIZE;
    const thickness = 10 + rand() * 62;
    const slant = (rand() - 0.5) * 0.55;
    const fill = shards[Math.floor(rand() * shards.length)];
    ctx.globalAlpha = 0.55 + rand() * 0.45;
    ribbon(ctx, rand, yCenter, thickness, slant, fill);
  }

  // Sharp splinters for the shattered-glass feel of the reference livery.
  ctx.globalAlpha = 0.9;
  for (let i = 0; i < 16; i++) splinter(ctx, rand, shards[4 + Math.floor(rand() * 4)]);
  ctx.globalAlpha = 0.75;
  for (let i = 0; i < 5; i++) splinter(ctx, rand, sparks[Math.floor(rand() * sparks.length)]);

  // Thin hot edges.
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = 2;
  for (let i = 0; i < 12; i++) {
    const y = rand() * SIZE;
    const slant = (rand() - 0.5) * 220;
    ctx.strokeStyle = rand() > 0.75 ? sparks[0] : palette.hotEdge;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(SIZE, y + slant);
    ctx.stroke();
  }

  // Keep the lower half darker so the car reads low and heavy.
  ctx.globalAlpha = 1;
  const shade = ctx.createLinearGradient(0, 0, 0, SIZE);
  shade.addColorStop(0, 'rgba(0,0,0,0.55)');
  shade.addColorStop(0.42, 'rgba(0,0,0,0.05)');
  shade.addColorStop(1, 'rgba(0,0,0,0.62)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.restore();
}

/** The pre-workshop livery texture (base + shards), for the old lengthwise uvs. */
export function createLiveryTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = LIVERY_SIZE;
  canvas.height = LIVERY_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  drawLivery(ctx);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}
