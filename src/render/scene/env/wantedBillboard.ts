import * as THREE from 'three';
import { PAL } from './palette';

/**
 * The "RAYO BANDIDO — WANTED" LED billboard that towers over the central drift plaza.
 *
 * Unlike the rest of the arena (fifteen merged, procedural meshes) this is a small standalone
 * group: it owns a portrait poster that can load a real image at runtime, so it can't share the
 * batched sign atlas. It stays cheap all the same — one lit panel, a dark frame, two masts, a
 * ground reflection and a back halo, animated only by scalar colour writes in `update()`.
 *
 * The panel reads as a cyberpunk LED board: neon RAYO BANDIDO lettering, a hazard WANTED banner
 * and a suspect poster on the left. The whole board carries a subtle strobe (a slow breath plus
 * an occasional stutter) so it flickers like real failing neon without ever becoming a seizure
 * strobe.
 */

const LATIN = '"Bahnschrift","DIN Alternate","Arial Narrow",Impact,sans-serif';

/** Where the suspect portrait is loaded from (served out of `public/`). The first format that
 *  loads wins; if none is present a procedural fallback is drawn, so the board always looks
 *  finished. Drop the image in as `public/rayo-wanted.{webp,png,jpg}`. */
const PORTRAIT_URLS = ['/rayo-wanted.webp', '/rayo-wanted.png', '/rayo-wanted.jpg'];

function hex(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`;
}

interface WantedTexture {
  texture: THREE.CanvasTexture;
  /** Redraw the panel, compositing the portrait if it has finished loading. */
  redraw(portrait: HTMLImageElement | null): void;
}

function makeWantedTexture(): WantedTexture {
  const W = 1024;
  const H = 560;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');

  const glowText = (s: string, x: number, y: number, size: number, fill: string, glowColor: string): void => {
    ctx.font = `700 ${size}px ${LATIN}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = size * 0.5;
    ctx.fillStyle = fill;
    ctx.fillText(s, x, y);
    ctx.fillText(s, x, y);
    ctx.shadowBlur = 0;
    // Hot white core keeps the letters legible at distance / under mipmapping.
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(s, x, y);
    ctx.globalAlpha = 1;
  };

  // Left poster frame, in canvas pixels.
  const px = 30;
  const py = 30;
  const pw = 300;
  const ph = H - 60;

  const drawPortraitFallback = (): void => {
    // A stylised suspect silhouette: hooded figure against a magenta spotlight. Reads as a
    // mugshot poster until a real image is dropped into public/rayo-wanted.png.
    const g = ctx.createLinearGradient(px, py, px, py + ph);
    g.addColorStop(0, '#1a0a1e');
    g.addColorStop(1, '#05060c');
    ctx.fillStyle = g;
    ctx.fillRect(px, py, pw, ph);
    const spot = ctx.createRadialGradient(px + pw / 2, py + ph * 0.42, 10, px + pw / 2, py + ph * 0.42, pw * 0.7);
    spot.addColorStop(0, 'rgba(255,46,203,0.35)');
    spot.addColorStop(1, 'rgba(255,46,203,0)');
    ctx.fillStyle = spot;
    ctx.fillRect(px, py, pw, ph);
    ctx.fillStyle = '#03040a';
    const cx = px + pw / 2;
    // Shoulders.
    ctx.beginPath();
    ctx.moveTo(cx - pw * 0.42, py + ph);
    ctx.quadraticCurveTo(cx - pw * 0.4, py + ph * 0.62, cx - pw * 0.16, py + ph * 0.55);
    ctx.lineTo(cx + pw * 0.16, py + ph * 0.55);
    ctx.quadraticCurveTo(cx + pw * 0.4, py + ph * 0.62, cx + pw * 0.42, py + ph);
    ctx.closePath();
    ctx.fill();
    // Head.
    ctx.beginPath();
    ctx.ellipse(cx, py + ph * 0.4, pw * 0.15, pw * 0.19, 0, 0, Math.PI * 2);
    ctx.fill();
    // Rim light so the silhouette separates from the spotlight.
    ctx.strokeStyle = 'rgba(54,242,255,0.5)';
    ctx.lineWidth = 3;
    ctx.stroke();
  };

  const drawPortrait = (img: HTMLImageElement): void => {
    // Cover-fit the image into the poster rect.
    const scale = Math.max(pw / img.width, ph / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    ctx.save();
    ctx.beginPath();
    ctx.rect(px, py, pw, ph);
    ctx.clip();
    ctx.drawImage(img, px + (pw - dw) / 2, py + (ph - dh) / 2, dw, dh);
    ctx.restore();
  };

  const redraw = (portrait: HTMLImageElement | null): void => {
    // Panel background.
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#07040c');
    bg.addColorStop(0.5, '#0b0616');
    bg.addColorStop(1, '#06040a');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Poster.
    if (portrait) drawPortrait(portrait);
    else drawPortraitFallback();
    // Poster neon frame.
    ctx.shadowColor = hex(PAL.neonCyan);
    ctx.shadowBlur = 22;
    ctx.strokeStyle = hex(PAL.neonCyan);
    ctx.lineWidth = 6;
    ctx.strokeRect(px, py, pw, ph);
    ctx.shadowBlur = 0;

    // Text column.
    const tx = px + pw + 44;
    glowText('RAYO', tx, 150, 118, hex(PAL.neonMagenta), hex(PAL.neonMagenta));
    glowText('BANDIDO', tx, 250, 96, hex(PAL.neonCyan), hex(PAL.neonCyan));

    // Divider tube.
    ctx.shadowColor = hex(PAL.neonViolet);
    ctx.shadowBlur = 16;
    ctx.fillStyle = hex(PAL.neonViolet);
    ctx.fillRect(tx, 280, W - tx - 40, 6);
    ctx.shadowBlur = 0;

    // WANTED hazard banner.
    const by = 316;
    const bh = 96;
    const bw = W - tx - 40;
    ctx.fillStyle = '#140306';
    ctx.fillRect(tx, by, bw, bh);
    // Hazard chevrons behind the word.
    ctx.save();
    ctx.beginPath();
    ctx.rect(tx, by, bw, bh);
    ctx.clip();
    ctx.fillStyle = 'rgba(255,47,77,0.18)';
    for (let i = -2; i * 46 < bw + bh; i++) {
      ctx.beginPath();
      const ox = tx + i * 46;
      ctx.moveTo(ox, by);
      ctx.lineTo(ox + 22, by);
      ctx.lineTo(ox + 22 - bh, by + bh);
      ctx.lineTo(ox - bh, by + bh);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    ctx.strokeStyle = hex(PAL.neonMagenta);
    ctx.lineWidth = 4;
    ctx.shadowColor = hex(PAL.neonMagenta);
    ctx.shadowBlur = 20;
    ctx.strokeRect(tx, by, bw, bh);
    // WANTED word, letter-spaced by hand so it fills the banner.
    ctx.font = `700 74px ${LATIN}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = hex(PAL.neonMagenta);
    ctx.shadowBlur = 26;
    const word = 'WANTED';
    const spacing = bw / (word.length + 1);
    for (let i = 0; i < word.length; i++) {
      ctx.fillStyle = '#ffe8ea';
      ctx.fillText(word[i], tx + spacing * (i + 1), by + bh / 2 + 2);
    }
    ctx.shadowBlur = 0;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    // Reward / tagline line.
    ctx.font = `700 30px ${LATIN}`;
    ctx.fillStyle = hex(PAL.neonPink);
    ctx.shadowColor = hex(PAL.neonPink);
    ctx.shadowBlur = 12;
    ctx.fillText('REWARD  ¥999,999,999', tx, by + bh + 46);
    ctx.shadowBlur = 0;

    // Scanlines over the whole board to keep it reading as an LED wall.
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = '#000000';
    for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 2);
    ctx.globalAlpha = 1;

    texture.needsUpdate = true;
  };

  const texture = new THREE.CanvasTexture(cv);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  // Not drawn here: `createWantedBillboard` draws it exactly once, when it knows whether the
  // portrait loaded. Drawing a fallback now and again on load would rasterize this 1024 px
  // glow-heavy panel twice and re-upload it mid-game.

  return { texture, redraw };
}

export interface WantedBillboard {
  group: THREE.Group;
  /**
   * Resolves once the panel texture has been drawn: after the portrait loaded, every candidate
   * failed, or `PORTRAIT_TIMEOUT_MS` passed. The loading screen waits on this so the board
   * never re-rasterizes during play on a normal connection.
   */
  ready: Promise<void>;
  /** Subtle strobe. `time` is seconds, `swell` (0..1) is the mid band, which lifts it. */
  update(time: number, swell: number): void;
  dispose(): void;
}

/** How long start-up waits for the portrait before drawing the procedural fallback. */
const PORTRAIT_TIMEOUT_MS = 2500;

export function createWantedBillboard(pose: { x: number; z: number; rotY: number }): WantedBillboard {
  const group = new THREE.Group();
  group.name = 'wanted-billboard';
  // The board is built facing +Z around its own origin and then placed: in the test city on
  // the north edge of the plaza looking south into the square (masts on the blocks either
  // side), on the circuit at the end of the start straight looking down it.
  group.position.set(pose.x, 0, pose.z);
  group.rotation.y = pose.rotY;

  const cx = 0;
  const cz = 0;
  const panelW = 28;
  const panelH = 15.4;
  const panelY = 16.5;

  const disposables: Array<{ dispose(): void }> = [];

  // Dark backing so the lit panel has a body and never shows sky through the frame.
  const backGeo = new THREE.BoxGeometry(panelW + 1.4, panelH + 1.4, 0.6);
  const backMat = new THREE.MeshStandardMaterial({ color: PAL.metalDark, roughness: 0.7, metalness: 0.3 });
  const back = new THREE.Mesh(backGeo, backMat);
  back.position.set(cx, panelY, cz - 0.35);
  group.add(back);
  disposables.push(backGeo, backMat);

  // The lit LED panel.
  const wanted = makeWantedTexture();
  const panelGeo = new THREE.PlaneGeometry(panelW, panelH);
  const panelMat = new THREE.MeshBasicMaterial({ map: wanted.texture, toneMapped: false });
  const panel = new THREE.Mesh(panelGeo, panelMat);
  panel.position.set(cx, panelY, cz);
  group.add(panel);
  disposables.push(panelGeo, panelMat, wanted.texture);

  // Two masts down to the plaza-side blocks.
  const mastGeo = new THREE.BoxGeometry(1, panelY - panelH / 2 + 2, 1);
  const mastMat = new THREE.MeshStandardMaterial({ color: PAL.metalDark, roughness: 0.75, metalness: 0.25 });
  for (const s of [-1, 1]) {
    const mast = new THREE.Mesh(mastGeo, mastMat);
    mast.position.set(cx + s * 12, (panelY - panelH / 2 + 2) / 2, cz - 1.4);
    group.add(mast);
  }
  disposables.push(mastGeo, mastMat);

  // Back halo so the board glows into the night behind it.
  const haloGeo = new THREE.PlaneGeometry(panelW * 1.5, panelH * 1.7);
  const haloMat = new THREE.MeshBasicMaterial({
    color: PAL.neonMagenta,
    transparent: true,
    opacity: 0.14,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const halo = new THREE.Mesh(haloGeo, haloMat);
  halo.position.set(cx, panelY, cz + 0.05);
  group.add(halo);
  disposables.push(haloGeo, haloMat);

  // Light pool spilled on the wet plaza in front of the board.
  const poolGeo = new THREE.PlaneGeometry(panelW * 1.2, 34);
  poolGeo.rotateX(-Math.PI / 2);
  const poolMat = new THREE.MeshBasicMaterial({
    color: PAL.neonMagenta,
    transparent: true,
    opacity: 0.1,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const pool = new THREE.Mesh(poolGeo, poolMat);
  pool.position.set(cx, 0.03, cz + 18);
  group.add(pool);
  disposables.push(poolGeo, poolMat);

  // Load the real portrait if present, trying each format in turn. The panel is drawn once,
  // as soon as the outcome is known: with the portrait, or with the procedural fallback when
  // every candidate failed or the wait ran out. A portrait that arrives after the fallback
  // (very slow connection) still gets composited in; that is the only case that redraws.
  const img = new Image();
  let urlIndex = 0;
  let drawn = false;
  let timeout = 0;
  const tryNextPortrait = (): boolean => {
    if (urlIndex >= PORTRAIT_URLS.length) return false;
    img.src = PORTRAIT_URLS[urlIndex++];
    return true;
  };
  const ready = new Promise<void>((resolve) => {
    const finish = (portrait: HTMLImageElement | null): void => {
      window.clearTimeout(timeout);
      if (!drawn || portrait) wanted.redraw(portrait);
      drawn = true;
      resolve();
    };
    img.onload = () => finish(img);
    img.onerror = () => {
      if (!tryNextPortrait()) finish(null);
    };
    timeout = window.setTimeout(() => finish(null), PORTRAIT_TIMEOUT_MS);
    tryNextPortrait();
  });

  let flickerSlot = -1;
  let flickerValue = 1;

  return {
    group,
    ready,
    update(time, swell) {
      // Slow breath plus an occasional dropped-frame stutter, lifted a little on the mids.
      const breath = 0.86 + 0.1 * Math.sin(time * 2.1);
      const slot = Math.floor(time * 7);
      if (slot !== flickerSlot) {
        flickerSlot = slot;
        const h = Math.abs(Math.sin(slot * 12.9898) * 43758.5453) % 1;
        flickerValue = h < 0.06 ? 0.45 : h < 0.12 ? 0.78 : 1;
      }
      const lift = 1 + 0.25 * swell;
      const level = breath * flickerValue * lift;
      panelMat.color.setScalar(Math.min(1.25, level));
      haloMat.opacity = 0.12 * level;
      poolMat.opacity = 0.09 * level;
    },
    dispose() {
      window.clearTimeout(timeout);
      img.onload = null;
      img.onerror = null;
      for (const d of disposables) d.dispose();
    },
  };
}
