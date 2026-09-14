import * as THREE from 'three';
import { SCREEN_CHANNELS, type ScreenChannel, type ScreenFrame, type ScreenMotion, type ScreenShape } from '../../../content/screens';
import { paintScreenDesign } from './screenArt';

/**
 * The screen atlas: every frame of every channel in `content/screens.ts` on one texture, so
 * every LED board, blade sign, ticker and hologram in the city is drawn by two materials (the
 * boards and the holograms) sampling the same pixels.
 *
 * LAYOUT
 * The atlas is 2048 wide and as tall as its frames need. It is cut into one BAND per shape
 * (tall, wide, strip), each a grid of equal slots `perRow` across, and a channel's frames take
 * consecutive slots of its band, wrapping onto the next row as they need to. That is what lets
 * the shader find frame k of a channel from four numbers carried on the vertex (the band's top,
 * the slot size and the channel's first slot) without a table: slot = first + k, column and
 * row by division. Each slot keeps a black gutter so a far-off mip never bleeds a neighbour in.
 *
 * The layout is pure arithmetic over the catalogue, with no DOM, so the builders (and the tests,
 * in Node) place panels from the same numbers the texture is painted from.
 *
 * TEXTURE
 * Painted once at start-up. A frame that is an image of Juan's (`{ image }`) is painted with its
 * fallback design first and redrawn when the file lands; only then is the atlas uploaded again.
 * Nothing else changes it: every bit of motion on a screen (the frame cycle, the scan wipe, the
 * scrolling, glitches, the LED grid) is in the shader (`screenMaterial.ts`), so the texture is
 * never re-uploaded in the frame loop. Video is the one thing that would have to be: the plan is
 * to draw the `<video>` into its slot on a small canvas and copy just that rectangle to the GPU
 * (`WebGLRenderer.copyTextureToTexture`), never the whole atlas.
 */

export const SCREEN_ATLAS_WIDTH = 2048;
/** Tallest the atlas may grow (px). */
export const SCREEN_ATLAS_MAX_HEIGHT = 4096;
/** Black border inside every slot (px): what keeps mip levels from bleeding across frames. */
export const SCREEN_GUTTER = 6;

/** Slot size per shape (px, gutter included). Widths divide the atlas width exactly. */
export const SCREEN_SLOT: Record<ScreenShape, { w: number; h: number }> = {
  tall: { w: 256, h: 512 },
  wide: { w: 512, h: 288 },
  strip: { w: 1024, h: 128 },
};

/** Shader code per motion (`screenMaterial.ts` reads the same numbers). */
export const SCREEN_MOTION_CODE: Record<ScreenMotion, number> = { still: 0, scrollUp: 1, scrollDown: 2, ticker: 3, holo: 4 };

export interface PlacedChannel {
  channel: ScreenChannel;
  /** Index of the channel's first frame in its band's grid. */
  first: number;
  /** Top of the band (canvas px). */
  bandY: number;
  perRow: number;
  slotW: number;
  slotH: number;
}

export interface ScreenLayout {
  width: number;
  height: number;
  channels: Map<string, PlacedChannel>;
}

const BAND_ORDER: ScreenShape[] = ['tall', 'wide', 'strip'];

export function layoutScreens(channels: readonly ScreenChannel[] = SCREEN_CHANNELS): ScreenLayout {
  const placed = new Map<string, PlacedChannel>();
  let y = 0;
  for (const shape of BAND_ORDER) {
    const { w, h } = SCREEN_SLOT[shape];
    const perRow = Math.floor(SCREEN_ATLAS_WIDTH / w);
    let next = 0;
    for (const channel of channels) {
      if (channel.shape !== shape) continue;
      if (placed.has(channel.id)) throw new Error(`screen channel "${channel.id}" is listed twice`);
      if (channel.frames.length === 0) throw new Error(`screen channel "${channel.id}" has no frames`);
      placed.set(channel.id, { channel, first: next, bandY: y, perRow, slotW: w, slotH: h });
      next += channel.frames.length;
    }
    y += Math.ceil(next / perRow) * h;
  }
  if (y > SCREEN_ATLAS_MAX_HEIGHT) throw new Error(`screen atlas needs ${y} px, more than ${SCREEN_ATLAS_MAX_HEIGHT}: too many frames`);
  return { width: SCREEN_ATLAS_WIDTH, height: Math.max(y, 1), channels: placed };
}

/** The catalogue's layout, computed once. */
let shared: ScreenLayout | null = null;
export function screenLayout(): ScreenLayout {
  shared ??= layoutScreens();
  return shared;
}

/** Canvas rectangle of frame `k` of a placed channel, gutter included. */
export function frameRect(pc: PlacedChannel, k: number): { x: number; y: number; w: number; h: number } {
  const slot = pc.first + k;
  return { x: (slot % pc.perRow) * pc.slotW, y: pc.bandY + Math.floor(slot / pc.perRow) * pc.slotH, w: pc.slotW, h: pc.slotH };
}

/**
 * The two vertex attributes a panel showing `id` carries (`MeshBuilder.screen`):
 * `slot` = (top of the band in UV, slot width in UV, slot height in UV, first slot) and
 * `info` = (frame count, per-screen seed, motion code + 10 when the screen is faulty, seconds a frame).
 */
export function screenAttributes(id: string, seed: number, faulty = false): { slot: [number, number, number, number]; info: [number, number, number, number] } {
  const layout = screenLayout();
  const pc = layout.channels.get(id);
  if (!pc) throw new Error(`no screen channel "${id}"`);
  const c = pc.channel;
  return {
    slot: [1 - pc.bandY / layout.height, pc.slotW / layout.width, pc.slotH / layout.height, pc.first],
    info: [c.frames.length, seed, SCREEN_MOTION_CODE[c.motion] + (faulty ? 10 : 0), c.seconds],
  };
}

export function screenChannel(id: string): ScreenChannel {
  const pc = screenLayout().channels.get(id);
  if (!pc) throw new Error(`no screen channel "${id}"`);
  return pc.channel;
}

/** Channels of a shape a placement may use (`ScreenChannel.use`), in catalogue order. */
export function channelsFor(shape: ScreenShape, use: 'facade' | 'blade' | 'roof' | 'holo'): string[] {
  const out: string[] = [];
  for (const c of SCREEN_CHANNELS) {
    if (c.shape !== shape) continue;
    if (c.use ? c.use.includes(use) : use !== 'holo' && c.motion !== 'holo') out.push(c.id);
  }
  return out;
}

/* ------------------------------------------------------------------ the texture */

export interface ScreenAtlas {
  texture: THREE.CanvasTexture;
  /** Resolves when every image frame has been drawn (or has failed and kept its fallback). */
  ready: Promise<void>;
  dispose(): void;
}

export function createScreenAtlas(): ScreenAtlas {
  const layout = screenLayout();
  const cv = document.createElement('canvas');
  cv.width = layout.width;
  cv.height = layout.height;
  const ctx = cv.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, cv.width, cv.height);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  // Screens are read at grazing angles down a street more than they are read square on.
  tex.anisotropy = 8;

  const loads: Array<Promise<void>> = [];
  let disposed = false;
  for (const pc of layout.channels.values()) {
    pc.channel.frames.forEach((frame, k) => {
      const r = frameRect(pc, k);
      paintFrame(ctx, r, pc.channel.shape, designOf(frame));
      if ('image' in frame) {
        loads.push(
          loadImage(frame.image).then((img) => {
            if (disposed || !img) return;
            drawCover(ctx, r, img);
            tex.needsUpdate = true;
          }),
        );
      }
    });
  }
  tex.needsUpdate = true;

  return {
    texture: tex,
    ready: Promise.all(loads).then(() => undefined),
    dispose() {
      disposed = true;
      tex.dispose();
    },
  };
}

function designOf(frame: ScreenFrame): { design: Parameters<typeof paintScreenDesign>[1]; page: number } | null {
  if ('design' in frame) return { design: frame.design, page: frame.page ?? 0 };
  return frame.fallback ? { design: frame.fallback.design, page: frame.fallback.page ?? 0 } : null;
}

/** Paints one design inside a slot, clipped to the slot less its gutter. */
function paintFrame(
  ctx: CanvasRenderingContext2D,
  r: { x: number; y: number; w: number; h: number },
  shape: ScreenShape,
  d: { design: Parameters<typeof paintScreenDesign>[1]; page: number } | null,
): void {
  const g = SCREEN_GUTTER;
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x + g, r.y + g, r.w - 2 * g, r.h - 2 * g);
  ctx.clip();
  ctx.translate(r.x + g, r.y + g);
  if (d) paintScreenDesign(ctx, d.design, d.page, r.w - 2 * g, r.h - 2 * g, shape);
  else {
    // No design and no image yet: the screen is on, showing nothing.
    ctx.fillStyle = '#05080a';
    ctx.fillRect(0, 0, r.w - 2 * g, r.h - 2 * g);
  }
  ctx.restore();
}

/** An image scaled to cover the slot (cropped, never stretched). */
function drawCover(ctx: CanvasRenderingContext2D, r: { x: number; y: number; w: number; h: number }, img: HTMLImageElement): void {
  const g = SCREEN_GUTTER;
  const w = r.w - 2 * g;
  const h = r.h - 2 * g;
  const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const sw = w / scale;
  const sh = h / scale;
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x + g, r.y + g, w, h);
  ctx.clip();
  ctx.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, r.x + g, r.y + g, w, h);
  ctx.restore();
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => {
      console.warn(`[screens] could not load ${url}; the channel keeps its placeholder`);
      resolve(null);
    };
    img.src = url;
  });
}
