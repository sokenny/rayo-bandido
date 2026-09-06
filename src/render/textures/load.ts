import * as THREE from 'three';
import { TEXTURE_ROOT, TEXTURES, type TextureSlot, type TextureSpec } from './manifest';

/**
 * Loading for the hand-made textures declared in `manifest.ts`.
 *
 * Start-up never waits on a file: the caller builds its material with a procedural fallback,
 * `attachTexture` swaps the art in when it arrives, and if nothing arrives the fallback is
 * simply what the game keeps. `ready` resolves either way — the loading screen can await it to
 * avoid a visible pop without ever hanging on a missing asset.
 *
 * Tinting and gain run once, into a canvas, at load time; there is no per-frame cost and no
 * shader variant. A slot with neither wraps the decoded image directly.
 */

/** How long a slot waits for its files before the fallback becomes permanent. */
const TIMEOUT_MS = 4000;

export interface TextureHandle {
  /** Resolves once the art is in and applied, or once the slot has been given up on. */
  ready: Promise<void>;
  /** The loaded texture, or null while it is still loading and if no file was found. */
  readonly texture: THREE.Texture | null;
  /** Whether a file was found. Useful in a debug overlay; nothing in the game branches on it. */
  readonly loaded: boolean;
  dispose(): void;
}

/** A material that samples a colour map; every consumer of a slot so far is one of these. */
type MappedMaterial = THREE.Material & { map: THREE.Texture | null };

function applySpec(tex: THREE.Texture, spec: TextureSpec): void {
  tex.colorSpace = spec.linear ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  const wrap = spec.tiling ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.wrapS = wrap;
  tex.wrapT = wrap;
  tex.anisotropy = spec.anisotropy ?? 4;
  tex.needsUpdate = true;
}

/**
 * Redraw the art through the slot's tint, gain and brightness normalisation. All three are
 * plain per-pixel maths on the
 * decoded image, so the file on disk stays the untouched original and the grade lives in the
 * manifest where it can be tuned against the running game.
 */
function graded(img: HTMLImageElement, spec: TextureSpec): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = img.naturalWidth;
  cv.height = img.naturalHeight;
  const ctx = cv.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  ctx.drawImage(img, 0, 0);

  const amount = spec.tint?.amount ?? 0;
  const gain = spec.gain ?? 1;
  const tr = ((spec.tint?.color ?? 0) >> 16) & 255;
  const tg = ((spec.tint?.color ?? 0) >> 8) & 255;
  const tb = (spec.tint?.color ?? 0) & 255;
  const data = ctx.getImageData(0, 0, cv.width, cv.height);
  const d = data.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = Math.min(255, (d[i] + (tr - d[i]) * amount) * gain);
    d[i + 1] = Math.min(255, (d[i + 1] + (tg - d[i + 1]) * amount) * gain);
    d[i + 2] = Math.min(255, (d[i + 2] + (tb - d[i + 2]) * amount) * gain);
  }

  // The brightness lift, if the slot asked for one. Done as a gamma against the tile's own
  // average: `pow(x, k)` with `k = log(target) / log(mean)` moves the mean onto the target and
  // leaves 0 and 1 where they are, so a dark photograph brightens without a clipped highlight.
  const target = spec.normalize;
  if (target !== undefined && target > 0) {
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    const mean = sum / (d.length / 4) / 255;
    if (mean > 0.001 && mean < 0.999) {
      const k = Math.log(target) / Math.log(mean);
      const lut = new Uint8ClampedArray(256);
      for (let v = 0; v < 256; v++) lut[v] = Math.round(255 * Math.pow(v / 255, k));
      for (let i = 0; i < d.length; i += 4) {
        d[i] = lut[d[i]];
        d[i + 1] = lut[d[i + 1]];
        d[i + 2] = lut[d[i + 2]];
      }
    }
  }

  ctx.putImageData(data, 0, 0);
  return cv;
}

/**
 * Load one slot. The returned handle owns the texture: dispose it with whatever owns the
 * material, exactly as the procedural textures are disposed.
 */
export function loadTexture(slot: TextureSlot): TextureHandle {
  const spec: TextureSpec = TEXTURES[slot];
  const img = new Image();
  let texture: THREE.Texture | null = null;
  let settled = false;
  let index = 0;
  let timeout = 0;

  // Same shape as the WANTED board and the BADKALA poster: try each format in turn, settle
  // exactly once, and never let a stalled request hold the game back.
  const tryNext = (): boolean => {
    if (index >= spec.files.length) return false;
    img.src = TEXTURE_ROOT + spec.files[index++];
    return true;
  };

  const ready = new Promise<void>((resolve) => {
    const finish = (found: HTMLImageElement | null): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      if (found) {
        const needsGrade = (spec.tint?.amount ?? 0) > 0 || (spec.gain ?? 1) !== 1 || spec.normalize !== undefined;
        texture = needsGrade ? new THREE.CanvasTexture(graded(found, spec)) : new THREE.Texture(found);
        applySpec(texture, spec);
      }
      resolve();
    };
    img.onload = () => finish(img);
    img.onerror = () => {
      if (!tryNext()) finish(null);
    };
    timeout = window.setTimeout(() => finish(null), TIMEOUT_MS);
    if (!tryNext()) finish(null);
  });

  return {
    ready,
    get texture() {
      return texture;
    },
    get loaded() {
      return texture !== null;
    },
    dispose() {
      settled = true;
      window.clearTimeout(timeout);
      img.onload = null;
      img.onerror = null;
      texture?.dispose();
      texture = null;
    },
  };
}

/**
 * Give `material` its fallback map now and the slot's art when it lands. This is the call a
 * surface makes; `fallback` stays owned by the caller (it is usually a procedural texture that
 * something else samples too), the returned handle owns the art. A null fallback means the
 * material draws untextured — flat vertex colour — until the file lands, which is the right
 * fallback for a surface that was never textured to begin with.
 */
export function attachTexture(
  material: MappedMaterial,
  slot: TextureSlot,
  fallback: THREE.Texture | null,
): TextureHandle {
  material.map = fallback;
  const handle = loadTexture(slot);
  void handle.ready.then(() => {
    const tex = handle.texture;
    if (!tex) return;
    // Carry over whatever tiling the fallback was set up with, so the art lands on the same
    // world scale the UVs were authored for.
    if (fallback) {
      tex.repeat.copy(fallback.repeat);
      tex.offset.copy(fallback.offset);
    }
    material.map = tex;
    material.needsUpdate = true;
  });
  return handle;
}
