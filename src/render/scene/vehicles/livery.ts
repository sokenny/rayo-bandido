import * as THREE from 'three';

/**
 * Procedural "Rayo Bandido" livery: dark blue-black paint torn by lengthwise magenta /
 * violet shards with a few electric-cyan splinters. Painted once into a 512x512 canvas and
 * used as the albedo map of the single body material.
 *
 * Returns `null` when there is no DOM (unit tests run under Node), so the body simply falls
 * back to its flat vertex-coloured paint.
 */

const SIZE = 512;

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
    const x = t * SIZE;
    const drift = slant * (t - 0.5) * SIZE;
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
  const x = rand() * SIZE;
  const y = rand() * SIZE;
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

export function createLiveryTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = BASE;
  ctx.fillRect(0, 0, SIZE, SIZE);

  const rand = makeRandom(0x8a17c0de);

  // Broad torn ribbons running along the car's length.
  for (let i = 0; i < 22; i++) {
    const yCenter = rand() * SIZE;
    const thickness = 10 + rand() * 62;
    const slant = (rand() - 0.5) * 0.55;
    const fill = SHARDS[Math.floor(rand() * SHARDS.length)];
    ctx.globalAlpha = 0.55 + rand() * 0.45;
    ribbon(ctx, rand, yCenter, thickness, slant, fill);
  }

  // Sharp splinters for the shattered-glass feel of the reference livery.
  ctx.globalAlpha = 0.9;
  for (let i = 0; i < 16; i++) splinter(ctx, rand, SHARDS[4 + Math.floor(rand() * 4)]);
  ctx.globalAlpha = 0.75;
  for (let i = 0; i < 5; i++) splinter(ctx, rand, SPARKS[Math.floor(rand() * SPARKS.length)]);

  // Thin hot edges.
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = 2;
  for (let i = 0; i < 12; i++) {
    const y = rand() * SIZE;
    const slant = (rand() - 0.5) * 220;
    ctx.strokeStyle = rand() > 0.75 ? SPARKS[0] : '#ff6fdc';
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

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}
