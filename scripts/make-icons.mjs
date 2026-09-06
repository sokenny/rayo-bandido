/**
 * Home-screen icons, drawn here rather than checked in as opaque binaries.
 *
 * The installed game needs real PNGs — a manifest icon for Android and an `apple-touch-icon`
 * for iOS, which will not take the SVG the favicon uses — so this script rasterises the same
 * bolt into `public/` with nothing but `zlib`. Re-run it when the mark changes:
 *
 *   node scripts/make-icons.mjs
 *
 * The bolt is drawn small enough to survive a maskable crop: Android may cut the icon to a
 * circle, and anything outside the middle 80% is not guaranteed to be shown.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const BG = [0x05, 0x06, 0x0a];
const INK = [0xfc, 0xee, 0x0a];
/** The favicon's path, as a polygon in its own 32×32 box. */
const BOLT = [
  [18, 2],
  [6, 18],
  [14, 18],
  [12, 30],
  [26, 12],
  [18, 12],
];
/** How much of the icon the bolt is allowed to fill, leaving the maskable safe margin. */
const FILL = 0.62;

function inside(px, py, poly) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** RGBA pixels for one square icon, 4×4 supersampled so the diagonals are not staircases. */
function render(size) {
  const scale = (size * FILL) / 32;
  const offset = (size - 32 * scale) / 2;
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let cover = 0;
      for (let sy = 0; sy < 4; sy++) {
        for (let sx = 0; sx < 4; sx++) {
          const u = (x + (sx + 0.5) / 4 - offset) / scale;
          const v = (y + (sy + 0.5) / 4 - offset) / scale;
          if (inside(u, v, BOLT)) cover++;
        }
      }
      const a = cover / 16;
      const i = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) px[i + c] = Math.round(BG[c] + (INK[c] - BG[c]) * a);
      px[i + 3] = 255;
    }
  }
  return px;
}

function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

function png(size) {
  const px = render(size);
  // One filter byte (0: none) in front of every row, which is what the PNG stream is.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolour with alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const [name, size] of [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
]) {
  writeFileSync(join(OUT, name), png(size));
  console.log(`wrote public/${name} (${size}×${size})`);
}
