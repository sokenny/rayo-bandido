import * as THREE from 'three';
import { PAL } from './palette';

/**
 * The "BADKALA — WANTED" ad poster: one shared texture, drawn once, sampled by every surface
 * that carries the campaign. It hangs in two places, both of them merged batches rather than
 * standalone objects, so the whole campaign costs exactly one draw call:
 *
 * - half the bus shelters, in the side bay where the back-lit poster goes (`transitBuilder`);
 * - the vertical city billboards tagged `variant: 2` (`propsBuilder`).
 *
 * It is the one texture in the environment that loads an image (`public/badkala.*`); a
 * procedural fallback is drawn when it is missing, so the ad is never a blank panel. Both
 * paths go through the same finishing pass — a chroma split, torn glitch rows, an LED dot
 * matrix, scanlines, dust and a vignette — which is what lets a photographic poster sit in a
 * city of hand-drawn neon without looking pasted on. The art is print; the overlay is the
 * screen it is being shown on.
 *
 * The panel is portrait, 1:2, and stays portrait everywhere it is used.
 */

const LATIN = '"Bahnschrift","DIN Alternate","Arial Narrow",Impact,sans-serif';

/** Where the ad art is loaded from (served out of `public/`). First format that loads wins. */
const ART_URLS = ['/badkala.webp', '/badkala.png', '/badkala.jpg'];

/** How long start-up waits for the art before falling back to the procedural poster. */
const ART_TIMEOUT_MS = 2500;

const W = 512;
const H = 1024;
/**
 * The art occupies the top of the panel; the WANTED banner takes the rest. Sized so the art
 * fits the full panel width without cropping — the wordmark runs edge to edge in the artwork,
 * so any horizontal crop eats the first and last letter of the brand.
 */
const ART_H = 640;

function hex(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`;
}

function rgba(c: number, a: number): string {
  return `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},${a})`;
}

export interface BadkalaPoster {
  texture: THREE.CanvasTexture;
  /** Resolves once the art has loaded (or been given up on) and the panel is drawn. */
  ready: Promise<void>;
  dispose(): void;
}

export function createBadkalaPoster(): BadkalaPoster {
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');

  const texture = new THREE.CanvasTexture(cv);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;

  /* ---------------------------------------------------------------- the art */

  /**
   * Fit the loaded art to the full panel width and hang it from the top. Width-fitting rather
   * than cover-fitting is deliberate: the wordmark spans the artwork, so cropping sideways
   * costs letters. Anything the art leaves short at the bottom is filled by the panel's own
   * dark ground, which the WANTED banner sits on anyway.
   */
  const drawArt = (img: HTMLImageElement): void => {
    const scale = W / img.width;
    const dh = img.height * scale;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, ART_H);
    ctx.clip();
    ctx.fillStyle = '#08040e';
    ctx.fillRect(0, 0, W, ART_H);
    // Anchored to the bottom when it overflows: the boots and the wet floor tie the art into
    // the banner, and the sky at the top of the frame is the part worth losing.
    ctx.drawImage(img, 0, Math.min(0, ART_H - dh), W, dh);
    ctx.restore();
  };

  /** Stand-in when no art file is present: a lit figure block under the wordmark. */
  const drawArtFallback = (): void => {
    const g = ctx.createLinearGradient(0, 0, 0, ART_H);
    g.addColorStop(0, '#1b0726');
    g.addColorStop(0.55, '#2a0a33');
    g.addColorStop(1, '#08040e');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, ART_H);
    const spot = ctx.createRadialGradient(W / 2, ART_H * 0.5, 20, W / 2, ART_H * 0.5, W * 0.85);
    spot.addColorStop(0, rgba(PAL.neonMagenta, 0.4));
    spot.addColorStop(1, rgba(PAL.neonMagenta, 0));
    ctx.fillStyle = spot;
    ctx.fillRect(0, 0, W, ART_H);
    // A hooded silhouette, the same shorthand the plaza WANTED board uses.
    ctx.fillStyle = '#05030b';
    const cx = W / 2;
    ctx.beginPath();
    ctx.moveTo(cx - W * 0.34, ART_H);
    ctx.quadraticCurveTo(cx - W * 0.3, ART_H * 0.66, cx - W * 0.13, ART_H * 0.58);
    ctx.lineTo(cx + W * 0.13, ART_H * 0.58);
    ctx.quadraticCurveTo(cx + W * 0.3, ART_H * 0.66, cx + W * 0.34, ART_H);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx, ART_H * 0.45, W * 0.12, W * 0.15, 0, 0, Math.PI * 2);
    ctx.fill();
    // The wordmark, since the fallback has no art carrying it.
    ctx.font = `700 82px ${LATIN}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = hex(PAL.neonMagenta);
    ctx.shadowBlur = 34;
    ctx.fillStyle = '#ffd8f2';
    ctx.fillText('BADKALA', W / 2, 96);
    ctx.shadowBlur = 0;
  };

  /* ---------------------------------------------------------------- the WANTED half */

  const drawWanted = (): void => {
    const y0 = ART_H;
    const h = H - ART_H;
    const bg = ctx.createLinearGradient(0, y0, 0, H);
    bg.addColorStop(0, '#11041a');
    bg.addColorStop(1, '#05030a');
    ctx.fillStyle = bg;
    ctx.fillRect(0, y0, W, h);

    // Divider tube where the art stops.
    ctx.shadowColor = hex(PAL.neonViolet);
    ctx.shadowBlur = 18;
    ctx.fillStyle = hex(PAL.neonViolet);
    ctx.fillRect(24, y0 + 8, W - 48, 5);
    ctx.shadowBlur = 0;

    // The hazard banner: chevrons behind a letter-spaced WANTED, same family as the plaza board.
    const by = y0 + 68;
    const bh = 126;
    const bx = 24;
    const bw = W - 48;
    ctx.fillStyle = '#150309';
    ctx.fillRect(bx, by, bw, bh);
    ctx.save();
    ctx.beginPath();
    ctx.rect(bx, by, bw, bh);
    ctx.clip();
    ctx.fillStyle = rgba(PAL.neonMagenta, 0.18);
    for (let i = -3; i * 52 < bw + bh; i++) {
      const ox = bx + i * 52;
      ctx.beginPath();
      ctx.moveTo(ox, by);
      ctx.lineTo(ox + 24, by);
      ctx.lineTo(ox + 24 - bh, by + bh);
      ctx.lineTo(ox - bh, by + bh);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    ctx.strokeStyle = hex(PAL.neonMagenta);
    ctx.lineWidth = 4;
    ctx.shadowColor = hex(PAL.neonMagenta);
    ctx.shadowBlur = 22;
    ctx.strokeRect(bx, by, bw, bh);

    ctx.font = `700 78px ${LATIN}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = hex(PAL.neonMagenta);
    ctx.shadowBlur = 26;
    const word = 'WANTED';
    const spacing = bw / (word.length + 1);
    ctx.fillStyle = '#ffe8ea';
    for (let i = 0; i < word.length; i++) ctx.fillText(word[i], bx + spacing * (i + 1), by + bh / 2 + 2);
    ctx.shadowBlur = 0;

    // Reward, then the small print under it.
    ctx.font = `700 52px ${LATIN}`;
    ctx.shadowColor = hex(PAL.neonAmber);
    ctx.shadowBlur = 20;
    ctx.fillStyle = hex(PAL.neonAmber);
    ctx.fillText('¥ 450,000,000', W / 2, by + bh + 66);
    ctx.shadowBlur = 0;
    ctx.font = `700 24px ${LATIN}`;
    ctx.fillStyle = rgba(PAL.neonCyan, 0.85);
    ctx.fillText('REWARD · BAY CITY TRANSIT AUTHORITY', W / 2, by + bh + 112);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  };

  /* ---------------------------------------------------------------- the screen it plays on */

  /**
   * Shift the red channel left and the blue channel right by a pixel or two. This is the one
   * pass that reads as "a screen" rather than "a printed sheet", and it is why the poster
   * survives being a photograph in a hand-drawn city.
   */
  const chromaSplit = (): void => {
    const img = ctx.getImageData(0, 0, W, H);
    const d = img.data;
    const src = new Uint8ClampedArray(d);
    const shift = 2;
    for (let y = 0; y < H; y++) {
      const row = y * W * 4;
      for (let x = 0; x < W; x++) {
        const i = row + x * 4;
        const r = row + Math.min(W - 1, x + shift) * 4;
        const b = row + Math.max(0, x - shift) * 4 + 2;
        d[i] = src[r];
        d[i + 2] = src[b];
      }
    }
    ctx.putImageData(img, 0, 0);
  };

  /** A handful of torn rows, offset sideways: a frame the panel did not quite finish. */
  const glitchRows = (): void => {
    const rows: Array<[number, number, number]> = [
      [126, 14, 9],
      [402, 8, -13],
      [560, 20, 6],
      [ART_H - 30, 10, -8],
      [880, 12, 11],
    ];
    for (const [y, h, dx] of rows) {
      const slice = ctx.getImageData(0, y, W, h);
      ctx.putImageData(slice, dx, y);
      // The tear itself glows a little, the way a dropped scanline does.
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = dx > 0 ? hex(PAL.neonCyan) : hex(PAL.neonMagenta);
      ctx.fillRect(0, y, W, 1.5);
      ctx.globalAlpha = 1;
    }
  };

  /** The LED matrix: a dark gap between every emitter, tighter across than down. */
  const ledMatrix = (): void => {
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = '#000000';
    for (let x = 0; x < W; x += 4) ctx.fillRect(x, 0, 1, H);
    ctx.globalAlpha = 0.3;
    for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1.6);
    ctx.globalAlpha = 1;
  };

  /** Dust on the glass, plus a few dead and hot pixels. */
  const dust = (): void => {
    let seed = 9137;
    const rnd = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < 420; i++) {
      const x = rnd() * W;
      const y = rnd() * H;
      const r = 0.6 + rnd() * 2.2;
      ctx.globalAlpha = 0.04 + rnd() * 0.1;
      ctx.fillStyle = rnd() > 0.72 ? '#000000' : '#cfe6ff';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  };

  /** Corner falloff and a cool bloom along the edges, so the panel has a bezel of light. */
  const bezel = (): void => {
    const v = ctx.createRadialGradient(W / 2, H / 2, W * 0.35, W / 2, H / 2, H * 0.62);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    const edge = ctx.createLinearGradient(0, 0, 0, H);
    edge.addColorStop(0, rgba(PAL.neonCyan, 0.16));
    edge.addColorStop(0.5, 'rgba(0,0,0,0)');
    edge.addColorStop(1, rgba(PAL.neonMagenta, 0.16));
    ctx.fillStyle = edge;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = rgba(PAL.neonMagenta, 0.75);
    ctx.lineWidth = 5;
    ctx.shadowColor = hex(PAL.neonMagenta);
    ctx.shadowBlur = 18;
    ctx.strokeRect(3, 3, W - 6, H - 6);
    ctx.shadowBlur = 0;
  };

  const redraw = (art: HTMLImageElement | null): void => {
    ctx.clearRect(0, 0, W, H);
    if (art) drawArt(art);
    else drawArtFallback();
    drawWanted();
    // Everything below is the screen, not the poster, and runs over the whole panel.
    chromaSplit();
    glitchRows();
    ledMatrix();
    dust();
    bezel();
    texture.needsUpdate = true;
  };

  /* ---------------------------------------------------------------- loading */

  // Same shape as the plaza WANTED board: try each format, draw exactly once when the
  // outcome is known, and only redraw if very slow art turns up after the fallback.
  const img = new Image();
  let urlIndex = 0;
  let drawn = false;
  let timeout = 0;
  const tryNext = (): boolean => {
    if (urlIndex >= ART_URLS.length) return false;
    img.src = ART_URLS[urlIndex++];
    return true;
  };
  const ready = new Promise<void>((resolve) => {
    const finish = (art: HTMLImageElement | null): void => {
      window.clearTimeout(timeout);
      if (!drawn || art) redraw(art);
      drawn = true;
      resolve();
    };
    img.onload = () => finish(img);
    img.onerror = () => {
      if (!tryNext()) finish(null);
    };
    timeout = window.setTimeout(() => finish(null), ART_TIMEOUT_MS);
    tryNext();
  });

  return {
    texture,
    ready,
    dispose() {
      window.clearTimeout(timeout);
      img.onload = null;
      img.onerror = null;
      texture.dispose();
    },
  };
}
