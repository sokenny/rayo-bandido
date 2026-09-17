import { createProjection, projectOntoPath } from '../../../world/track';
import type { BlockRect } from '../../../world/cityPlan';
import { BARRICADE, barricadeBox, type ObeliscoSpec } from '../../../world/metroVilla';
import { GRASS_TILE, drapedSlab, groundGlow, halo, type EnvBuilders } from './builders';
import { neonText, textWidth } from './gasStationBuilder';
import { makeRng, type MeshBuilder } from './meshBuilder';
import { PAL } from './palette';
import { villaMural } from './villaBuilder';
import { clipToSurface, decal, graffitiAspect, graffitiIsBanner, pickPaintCell } from './graffiti';

/**
 * THE OBELISCO, drawn (`world/metroVilla.ts`): the landmark at the end of the descent past the
 * villa, in its plaza in the 9 de Julio, and what stands round it.
 *
 *   - the plaza: an oval the avenue runs round, as the Plaza de la República has it — a kerb, a
 *     ring of lawn, a paved ring walk with its lamps, the inner lawn, and the paving round the
 *     monument, crossed by the walks from st-s3,
 *   - the shaft: thick, tapering, cast concrete gone bad — the concrete photograph on the stone,
 *     cracks up its faces, spalled patches with the rebar showing, a broken tip, rubble on the
 *     plinth — floodlit from the plaza, a red beacon still blinking on what is left of the top,
 *   - the sign: BA, huge, in steel pixels faced with LED panels, on a band that spells NDIDO CITY
 *     under them — BANDIDO CITY, read from the descent — with what is left of the hedge growing
 *     over it,
 *   - the quake: a fissure across the avenue south of the plaza, and the concrete barricades the
 *     protests left,
 *   - the McDonald's on the corner, red and lit, arches on a pylon and on the fascia, and on its
 *     roof a board: BANDIDO CITY SIEMPRE AVANZA,
 *   - the green gantry sign over the ramp, AV. 9 DE JULIO,
 *   - the villa's murals on its frontage to the avenue: VILLA 31 PRESENTE, BARRIO PADRE MUGICA.
 *
 * Only the plaza, the barricades and the McDonald's are solid (`cityWorld.ts`), from the same spec numbers.
 */

const ARCH_YELLOW = 0xffc21a;
const MC_RED = 0xb8121b;
/** Sides of the plaza's ovals. */
const OVAL = 48;

export function buildObelisco(b: EnvBuilders): void {
  const o = b.plan.obelisco;
  if (!o) return;
  const rng = makeRng(0x0be115c0);
  buildPlaza(b, o);
  buildShaft(b, o, rng);
  buildLetters(b, o);
  buildFissures(b, o);
  buildBarricades(b, o);
  buildMcDonalds(b, o, rng);
  buildGantry(b, o);
  buildMurals(b);
}

/* ------------------------------------------------------------------ helpers */

/** An oval wall between two heights, half-axes `rx` × `rz`, faces out. */
function ovalWall(mb: MeshBuilder, x: number, z: number, rx: number, rz: number, ya: number, yb: number): void {
  for (let i = 0; i < OVAL; i++) {
    const a0 = (i / OVAL) * Math.PI * 2;
    const a1 = ((i + 1) / OVAL) * Math.PI * 2;
    const px = x + Math.cos(a0) * rx;
    const pz = z + Math.sin(a0) * rz;
    const qx = x + Math.cos(a1) * rx;
    const qz = z + Math.sin(a1) * rz;
    mb.quad(qx, ya, qz, px, ya, pz, px, yb, pz, qx, yb, qz, 0, 0, 1, 1);
  }
}

/**
 * A flat oval ring at `y`, facing up, from the oval (`rx0`, `rz0`) in to (`rx1`, `rz1`); an inner
 * oval of 0 is a disc. `tile` maps the UVs in world metres.
 */
function ovalRing(mb: MeshBuilder, x: number, z: number, rx0: number, rz0: number, rx1: number, rz1: number, y: number, tile = 0): void {
  const uv = (px: number, pz: number): [number, number] => (tile > 0 ? [px / tile, pz / tile] : [0, 0]);
  for (let i = 0; i < OVAL; i++) {
    const a0 = (i / OVAL) * Math.PI * 2;
    const a1 = ((i + 1) / OVAL) * Math.PI * 2;
    const ox0 = x + Math.cos(a0) * rx0;
    const oz0 = z + Math.sin(a0) * rz0;
    const ox1 = x + Math.cos(a1) * rx0;
    const oz1 = z + Math.sin(a1) * rz0;
    const ix0 = x + Math.cos(a0) * rx1;
    const iz0 = z + Math.sin(a0) * rz1;
    const ix1 = x + Math.cos(a1) * rx1;
    const iz1 = z + Math.sin(a1) * rz1;
    const [u0, v0] = uv(ox0, oz0);
    const [u1, v1] = uv(ix1, iz1);
    // Facing up: the angle runs from +x toward +z, which seen from above is clockwise, so the
    // front face is outer a0, inner a0, inner a1, outer a1.
    mb.quad(ox0, y, oz0, ix0, y, iz0, ix1, y, iz1, ox1, y, oz1, u0, v0, u1, v1);
  }
}

/* ------------------------------------------------------------------ the plaza */

function buildPlaza(b: EnvBuilders, o: ObeliscoSpec): void {
  const y0 = b.plan.padY(o.x, o.z);
  const { rx, rz } = o.plaza;
  const top = y0 + 0.3;
  // The kerb and its cap.
  b.wall.color(PAL.curb, 1.1);
  ovalWall(b.wall, o.x, o.z, rx, rz, y0 - 0.1, top);
  b.concrete.color(PAL.sidewalk, 1.1);
  ovalRing(b.concrete, o.x, o.z, rx, rz, rx - 0.7, rz - 0.7, top + 0.004);
  // The outer lawn, the ring walk, the inner lawn, the paving round the monument.
  b.grass.color(PAL.foliage, 0.95);
  ovalRing(b.grass, o.x, o.z, rx - 0.7, rz - 0.7, rx - 5, rz - 5, top, GRASS_TILE);
  b.concrete.color(PAL.sidewalk, 1.25);
  ovalRing(b.concrete, o.x, o.z, rx - 5, rz - 5, rx - 8.5, rz - 8.5, top + 0.01);
  b.grass.color(PAL.foliage, 0.9);
  ovalRing(b.grass, o.x, o.z, rx - 8.5, rz - 8.5, 11, 13.5, top, GRASS_TILE);
  b.concrete.color(PAL.sidewalk, 1.15);
  ovalRing(b.concrete, o.x, o.z, 11, 13.5, 0, 0, top + 0.01);
  // The walks across from st-s3, both sides, over the lawns to the paving.
  b.concrete.color(PAL.sidewalk, 1.2);
  for (const side of [-1, 1]) {
    const x0 = o.x + side * 10.5;
    const x1 = o.x + side * (rx - 0.6);
    b.concrete.planeY((x0 + x1) / 2, top + 0.02, o.z, Math.abs(x1 - x0), 4);
  }
  // Lamps round the ring walk: a post, a cold head, a pool of light.
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2 + 0.11;
    const lx = o.x + Math.cos(a) * (rx - 6.75);
    const lz = o.z + Math.sin(a) * (rz - 6.75);
    b.props.color(0x22252a, 1);
    b.props.tube(lx, top, lz, lx, top + 4.2, lz, 0.14);
    b.neon.color(0xe8eeff, 0.85);
    b.neon.box(lx, top + 4.3, lz, 0.45, 0.2, 0.45);
    groundGlow(b, lx, lz, 9, 9, 0xdfe8ff, 0.06);
  }
}

/* ------------------------------------------------------------------ the shaft */

function buildShaft(b: EnvBuilders, o: ObeliscoSpec, rng: () => number): void {
  const ground = b.plan.padY(o.x, o.z) + 0.3;
  const s = o.base;
  // The plinth: two square steps, and the rubble that has come down onto them.
  b.wall.color(0xa9a7a4, 1.2);
  b.wall.box(o.x, ground + 0.4, o.z, s * 2, 0.8, s * 2, { tileW: 4, tileH: 4 });
  b.wall.box(o.x, ground + 1.1, o.z, s * 1.45, 0.6, s * 1.45, { tileW: 4, tileH: 4 });
  const y0 = ground + 1.4;
  const h = o.height;
  const r0 = (s / 2) * Math.SQRT2;
  const r1 = r0 * 0.6;
  const phase = Math.PI / 4;
  const radiusAt = (y: number): number => r0 + (r1 - r0) * ((y - y0) / h);
  const corner = (r: number, i: number): [number, number] => [o.x + Math.cos(phase + (i / 4) * Math.PI * 2) * r, o.z + Math.sin(phase + (i / 4) * Math.PI * 2) * r];

  // The concrete, cast in formwork panels: flat trim concrete rather than the wall photograph
  // (a 4 m tile, world-mapped, banded the shaft every few metres at this height), each panel a
  // shade off its neighbours along a slow stain up the shaft, so it reads as one poured surface.
  const cols = 5;
  const panelH = 2.4;
  const rows = Math.ceil(h / panelH);
  const stain = (i: number, c: number, r: number): number =>
    0.06 * Math.sin(r * 0.37 + i * 1.7 + c * 0.9) + 0.05 * Math.sin(r * 0.11 + i * 2.3) + 0.05 * (Math.abs(Math.sin(i * 91.3 + c * 17.1 + r * 5.7) * 4375.85) % 1 - 0.5);
  for (let i = 0; i < 4; i++) {
    const face = i === 0 || i === 1 ? 1.5 : 1.2;
    for (let r = 0; r < rows; r++) {
      const ya = y0 + r * panelH;
      const yb = Math.min(y0 + h, ya + panelH);
      const [pax, paz] = corner(radiusAt(ya), i);
      const [qax, qaz] = corner(radiusAt(ya), i + 1);
      const [pbx, pbz] = corner(radiusAt(yb), i);
      const [qbx, qbz] = corner(radiusAt(yb), i + 1);
      for (let c = 0; c < cols; c++) {
        const t0 = c / cols;
        const t1 = (c + 1) / cols;
        const lerp = (a: number, b2: number, t: number): number => a + (b2 - a) * t;
        b.concrete.color(0xd6cbbd, face * (1 + stain(i, c, r)));
        b.concrete.quad(
          lerp(pax, qax, t1), ya, lerp(paz, qaz, t1),
          lerp(pax, qax, t0), ya, lerp(paz, qaz, t0),
          lerp(pbx, qbx, t0), yb, lerp(pbz, qbz, t0),
          lerp(pbx, qbx, t1), yb, lerp(pbz, qbz, t1),
          0, 0, 1, 1,
        );
      }
    }
  }

  // Rain stains: long dark streaks run down from the ledges of the broken panels.
  for (let k = 0; k < 18; k++) {
    const i = Math.floor(rng() * 4);
    const u = (rng() - 0.5) * 0.85;
    const yt = y0 + 6 + rng() * (h - 8);
    const len = 4 + rng() * 14;
    const yb = Math.max(y0, yt - len);
    const sw = 0.5 + rng() * 1.4;
    const at = (y: number, du: number): [number, number] => {
      const r = radiusAt(y);
      const [px, pz] = corner(r, i);
      const [qx, qz] = corner(r, i + 1);
      const t = 0.5 + u + du / Math.hypot(qx - px, qz - pz);
      const na = phase + ((i + 0.5) / 4) * Math.PI * 2;
      return [px + (qx - px) * t + Math.cos(na) * 0.02, pz + (qz - pz) * t + Math.sin(na) * 0.02];
    };
    const [ax0, az0] = at(yb, -sw * 0.05);
    const [bx0, bz0] = at(yb, sw * 0.05);
    const [ax1, az1] = at(yt, -sw / 2);
    const [bx1, bz1] = at(yt, sw / 2);
    b.concrete.color(0xb0a797, 1.2 + rng() * 0.15);
    b.concrete.quad(bx0, yb, bz0, ax0, yb, az0, ax1, yt, az1, bx1, yt, bz1, 0, 0, 1, 1);
  }

  // The broken tip: the pyramid's apex knocked off-centre and down, one face of it gone to a
  // jagged stump.
  const [ax, az] = [o.x + s * 0.12, o.z - s * 0.08];
  const apexY = y0 + h + s * 0.62;
  for (let i = 0; i < 4; i++) {
    const [tpx, tpz] = corner(r1, i);
    const [tqx, tqz] = corner(r1, i + 1);
    const top = y0 + h;
    b.concrete.color(0xd0cbc3, 1.3);
    if (i === 2) {
      // The stump: half the height, a notch in the middle of the break.
      const mx = (tpx + tqx) / 2;
      const mz = (tpz + tqz) / 2;
      b.concrete.quad(tqx, top, tqz, tpx, top, tpz, (tpx + ax) / 2, top + s * 0.3, (tpz + az) / 2, (mx + ax) / 2, top + s * 0.18, (mz + az) / 2, 0, 0, 1, 1);
      b.concrete.quad(tqx, top, tqz, (mx + ax) / 2, top + s * 0.18, (mz + az) / 2, (tqx + ax) / 2, top + s * 0.34, (tqz + az) / 2, (tqx + ax) / 2, top + s * 0.34, (tqz + az) / 2, 0, 0, 1, 1);
      // The inside of the break, darker.
      b.concrete.color(0x6f6a64, 1);
      b.concrete.quad((tpx + ax) / 2, top + s * 0.3, (tpz + az) / 2, (tqx + ax) / 2, top + s * 0.34, (tqz + az) / 2, ax, apexY, az, ax, apexY, az, 0, 0, 1, 1);
    } else {
      b.concrete.quad(tqx, top, tqz, tpx, top, tpz, ax, apexY, az, ax, apexY, az, 0, 0, 1, 1);
    }
  }

  // A point on a face at height `y`, `u` along it (-0.5..0.5), and the face's frame.
  const onFace = (i: number, y: number, u: number): { x: number; z: number; nx: number; nz: number; tx: number; tz: number; w: number } => {
    const r = radiusAt(y);
    const [px, pz] = corner(r, i);
    const [qx, qz] = corner(r, i + 1);
    const w = Math.hypot(qx - px, qz - pz);
    const tx = (qx - px) / w;
    const tz = (qz - pz) / w;
    const na = phase + ((i + 0.5) / 4) * Math.PI * 2;
    return { x: (px + qx) / 2 + tx * u * w, z: (pz + qz) / 2 + tz * u * w, nx: Math.cos(na), nz: Math.sin(na), tx, tz, w };
  };

  // Spalls: patches where the cover has fallen away, darker and rough, with the bars showing.
  for (let k = 0; k < 30; k++) {
    const i = Math.floor(rng() * 4);
    const y = y0 + 2 + rng() * (h - 6);
    // Half of them on an arris, where concrete breaks first.
    const u = rng() < 0.5 ? (rng() < 0.5 ? -0.44 : 0.44) : (rng() - 0.5) * 0.7;
    const f = onFace(i, y, u);
    const pw = 1.2 + rng() * 3;
    const ph = 1 + rng() * 3.4;
    const out = 0.035;
    const cx = f.x + f.nx * out;
    const cz = f.z + f.nz * out;
    // An irregular hexagon: two quads.
    const j = (): number => 0.75 + rng() * 0.5;
    const L = [cx - f.tx * (pw / 2) * j(), cz - f.tz * (pw / 2) * j()];
    const R = [cx + f.tx * (pw / 2) * j(), cz + f.tz * (pw / 2) * j()];
    const a = [cx - f.tx * (pw / 4), cz - f.tz * (pw / 4)];
    const c = [cx + f.tx * (pw / 4), cz + f.tz * (pw / 4)];
    const yb = y - (ph / 2) * j();
    const yt = y + (ph / 2) * j();
    b.wall.color(0x5d5852, 1);
    b.wall.quad(c[0], yb, c[1], a[0], yb + 0.2, a[1], L[0], y, L[1], R[0], y, R[1], 0, 0, 1, 1);
    b.wall.quad(R[0], y, R[1], L[0], y, L[1], a[0], yt, a[1], c[0], yt - 0.25, c[1], 0, 0, 1, 1);
    // Two or three bars across the patch, rusted, one bent out of the wall.
    b.props.color(0x6a3c26, 1);
    const bars = 2 + Math.floor(rng() * 2);
    for (let n = 0; n < bars; n++) {
      const by = yb + ((n + 1) / (bars + 1)) * (yt - yb);
      b.props.tube(L[0] + f.nx * 0.05, by, L[1] + f.nz * 0.05, R[0] + f.nx * 0.05, by, R[1] + f.nz * 0.05, 0.05);
    }
    if (rng() < 0.6) b.props.tube(cx, y, cz, cx + f.nx * (0.5 + rng() * 0.7) + f.tx * 0.3, y - 0.4 - rng() * 0.6, cz + f.nz * (0.5 + rng() * 0.7) + f.tz * 0.3, 0.05);
  }

  // Cracks: dark zigzags climbing the faces.
  b.props.color(0x19181b, 1);
  for (let k = 0; k < 34; k++) {
    const i = Math.floor(rng() * 4);
    let y = y0 + 1 + rng() * (h - 12);
    let u = (rng() - 0.5) * 0.8;
    const segs = 4 + Math.floor(rng() * 4);
    let prev = onFace(i, y, u);
    for (let n = 0; n < segs; n++) {
      const prevY = y;
      y += 1 + rng() * 2.4;
      u = Math.max(-0.48, Math.min(0.48, u + (rng() - 0.5) * 0.18));
      const next = onFace(i, y, u);
      b.props.tube(prev.x + prev.nx * 0.03, prevY, prev.z + prev.nz * 0.03, next.x + next.nx * 0.03, y, next.z + next.nz * 0.03, 0.07);
      prev = next;
    }
  }

  // Rubble on the plinth and the paving: lumps of the shaft and the tip.
  b.wall.color(0xb7b2aa, 1.1);
  for (let k = 0; k < 14; k++) {
    const a = rng() * Math.PI * 2;
    const d = s * 0.8 + rng() * 5;
    const size = 0.3 + rng() * 0.9;
    const x = o.x + Math.cos(a) * d;
    const z = o.z + Math.sin(a) * d;
    const onPlinth = d < s;
    b.wall.box(x, (onPlinth ? ground + 0.8 : ground) + size * 0.4, z, size, size * 0.8, size * (0.7 + rng() * 0.6));
  }

  // The floodlights in the paving, and the light on the stone: soft, low, so the concrete reads.
  groundGlow(b, o.x, o.z, 26, 26, 0xdfe6ff, 0.08);
  for (let i = 0; i < 4; i++) {
    const f = onFace(i, y0, 0);
    const lx = f.x + f.nx * 3.2;
    const lz = f.z + f.nz * 3.2;
    b.props.color(0x1a1c20, 1);
    b.props.box(lx, ground + 0.25, lz, 0.7, 0.5, 0.7);
    b.neon.color(0xeef2ff, 0.9);
    b.neon.box(lx, ground + 0.52, lz, 0.5, 0.06, 0.5);
    const rot = Math.atan2(f.nx, f.nz);
    halo(b, f.x + f.nx * 0.6, y0 + h * 0.22, f.z + f.nz * 0.6, s * 1.6, h * 0.45, rot, 0xdfe6ff, 0.05);
  }
  b.neonFlicker.color(0xff2e2e, 1);
  b.neonFlicker.box(ax, apexY + 0.3, az, 0.4, 0.4, 0.4);
  halo(b, ax, apexY + 0.3, az, 3.5, 3.5, 0, 0xff2e2e, 0.25);
}

/* ------------------------------------------------------------------ the letters */

/** A 5 × 7 block font, rows from the top: the hedge's BA and the band's NDIDO CITY. */
const PIXELS: Record<string, string[]> = {
  B: ['XXXX.', 'X...X', 'X...X', 'XXXX.', 'X...X', 'X...X', 'XXXX.'],
  A: ['.XXX.', 'X...X', 'X...X', 'XXXXX', 'X...X', 'X...X', 'X...X'],
  N: ['X...X', 'XX..X', 'X.X.X', 'X..XX', 'X...X', 'X...X', 'X...X'],
  D: ['XXXX.', 'X...X', 'X...X', 'X...X', 'X...X', 'X...X', 'XXXX.'],
  I: ['XXXXX', '..X..', '..X..', '..X..', '..X..', '..X..', 'XXXXX'],
  O: ['.XXX.', 'X...X', 'X...X', 'X...X', 'X...X', 'X...X', '.XXX.'],
  C: ['.XXXX', 'X....', 'X....', 'X....', 'X....', 'X....', '.XXXX'],
  T: ['XXXXX', '..X..', '..X..', '..X..', '..X..', '..X..', '..X..'],
  Y: ['X...X', 'X...X', '.X.X.', '..X..', '..X..', '..X..', '..X..'],
};

/** How wide a word is in the block font at pixel size `px`, with `gap` between letters. */
function pixelWidth(text: string, px: number, gap: number): number {
  return text.length * 5 * px + (text.length - 1) * gap;
}

/**
 * Walk a word in the block font, left to right as seen from the south, handing each run of lit
 * pixels in a row to `emit` as its x extent, its centre height, its row and its letter index.
 */
function pixelRuns(text: string, x: number, y: number, px: number, gap: number, emit: (x0: number, x1: number, cy: number, row: number, letter: number) => void): void {
  let pen = x - pixelWidth(text, px, gap) / 2;
  [...text].forEach((ch, letter) => {
    const rows = PIXELS[ch];
    rows?.forEach((row, r) => {
      const cy = y + (rows.length - 1 - r) * px + px / 2;
      let c = 0;
      while (c < row.length) {
        if (row[c] !== 'X') {
          c++;
          continue;
        }
        let e = c;
        while (e < row.length && row[e] === 'X') e++;
        emit(pen + c * px, pen + e * px, cy, r, letter);
        c = e;
      }
    });
    pen += 5 * px + gap;
  });
}

/** Two colours mixed, `t` of the way from `a` to `b`. */
function mixColor(a: number, b: number, t: number): number {
  const ch = (shift: number): number => Math.round(((a >> shift) & 255) * (1 - t) + ((b >> shift) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/**
 * THE SIGN: what the city put up where the planted BA used to be. BA in 1.3 m pixels of black
 * steel, each run of pixels faced with an LED panel graded from magenta at the top to cyan at
 * the bottom — a few dead, a few glitching out of line — on a steel band that spells NDIDO CITY
 * in cold white LEDs between two strips of breathing magenta: BANDIDO CITY, read from the
 * descent. What is left of the hedge grows over the steel in clumps. Searchlights in the lawn
 * throw beams up past the letters.
 */
function buildLetters(b: EnvBuilders, o: ObeliscoSpec): void {
  const rng = makeRng(0xba5eba11);
  const ground = b.plan.padY(o.x, o.z) + 0.3;
  const front = o.z + o.plaza.rz - 13;
  const MAGENTA = 0xff2fb4;
  const CYAN = 0x3fe8ff;

  // The band: black steel, LED strips top and bottom, NDIDO CITY in cold white pixels.
  const bandH = 3.2;
  const bandW = 26;
  const bandD = 2.4;
  b.props.color(0x121419, 1);
  b.props.box(o.x, ground + bandH / 2, front - bandD / 2, bandW, bandH, bandD);
  b.props.color(0x2a2e36, 1);
  b.props.box(o.x, ground + bandH + 0.08, front - bandD / 2, bandW + 0.4, 0.16, bandD + 0.3);
  b.neonPulse.color(MAGENTA, 0.95);
  b.neonPulse.tube(o.x - bandW / 2, ground + bandH - 0.12, front + 0.03, o.x + bandW / 2, ground + bandH - 0.12, front + 0.03, 0.12);
  b.neonPulse.tube(o.x - bandW / 2, ground + 0.14, front + 0.03, o.x + bandW / 2, ground + 0.14, front + 0.03, 0.12);
  const small = 0.3;
  pixelRuns('NDIDO CITY', o.x, ground + (bandH - 7 * small) / 2, small, small * 1.5, (x0, x1, cy) => {
    const mb = rng() < 0.06 ? b.neonFlicker : b.neon;
    mb.color(0xdbe8ff, 0.8);
    mb.box((x0 + x1) / 2, cy, front + 0.05, x1 - x0 - 0.04, small - 0.04, 0.08);
  });

  // BA: steel pixels with LED faces.
  const big = 1.3;
  const depth = 1.4;
  const baseY = ground + bandH + 0.16;
  const gz = front - 0.4;
  pixelRuns('BA', o.x, baseY, big, big * 1.3, (x0, x1, cy, row, letter) => {
    // A glitch: now and then a run sits out of line.
    const shift = rng() < 0.03 ? (rng() < 0.5 ? -1 : 1) * big * 0.25 : 0;
    const cx = (x0 + x1) / 2 + shift;
    const w = x1 - x0;
    b.props.color(0x0d0f13, 1);
    b.props.box(cx, cy, gz - depth / 2, w, big, depth);
    const roll = rng();
    if (roll < 0.05) {
      // Dead: a dark panel with a crack of light.
      b.neon.color(0x0a1220, 1);
      b.neon.panel(cx, cy, gz + 0.03, w - 0.16, big - 0.16, 0);
      b.neonFlicker.color(CYAN, 0.5);
      b.neonFlicker.tube(cx - w * 0.3, cy + big * 0.2, gz + 0.05, cx + w * 0.1, cy - big * 0.25, gz + 0.05, 0.05);
    } else {
      const t = row / 6;
      const mb = shift !== 0 || roll > 0.93 ? b.neonFlicker : b.neon;
      mb.color(mixColor(MAGENTA, CYAN, t), 1 - letter * 0.05);
      mb.panel(cx, cy, gz + 0.03, w - 0.06, big - 0.06, 0);
      // A scanline across the panel.
      b.props.color(0x05060a, 1);
      b.props.panel(cx, cy, gz + 0.045, w - 0.06, 0.05, 0);
    }
    // What is left of the hedge, growing over the top of the steel.
    if (rng() < 0.14) {
      b.foliage.color(0x3f8f3f, 1.3);
      b.foliage.box(cx + (rng() - 0.5) * w * 0.5, cy + big * 0.55, gz - depth / 2, w * (0.4 + rng() * 0.5), big * 0.4, depth * 1.1, { tileW: 1.2, tileH: 1.2 });
    }
  });
  const baW = pixelWidth('BA', big, big * 1.3);
  // The frame it hangs on, behind: two steel masts and a beam.
  b.props.color(0x2a2e36, 1);
  for (const side of [-1, 1]) b.props.tube(o.x + side * (baW / 2 - 1), baseY, gz - depth - 0.4, o.x + side * (baW / 2 - 1), baseY + 7 * big + 1.5, gz - depth - 0.4, 0.3);
  b.props.tube(o.x - baW / 2 + 1, baseY + 7 * big + 1.2, gz - depth - 0.4, o.x + baW / 2 - 1, baseY + 7 * big + 1.2, gz - depth - 0.4, 0.22);
  b.neonFlicker.color(0xff2e2e, 1);
  for (const side of [-1, 1]) b.neonFlicker.box(o.x + side * (baW / 2 - 1), baseY + 7 * big + 1.7, gz - depth - 0.4, 0.3, 0.3, 0.3);

  // The light: a magenta haze on the sign, its pool on the lawn, and searchlights going up.
  halo(b, o.x, baseY + 3.5 * big, front + 0.6, baW + 4, 7 * big + 3, 0, MAGENTA, 0.07);
  halo(b, o.x, ground + bandH / 2, front + 0.6, bandW + 3, bandH + 1.2, 0, CYAN, 0.05);
  groundGlow(b, o.x, front + 4, bandW + 6, 8, MAGENTA, 0.1);
  for (const side of [-1, 1]) {
    const sx = o.x + side * (bandW / 2 + 1.5);
    b.props.color(0x1a1c20, 1);
    b.props.box(sx, ground + 0.35, front + 1.5, 0.9, 0.7, 0.9);
    b.neon.color(0xeaf4ff, 1);
    b.neon.box(sx, ground + 0.75, front + 1.5, 0.7, 0.1, 0.7);
    // A beam: a tall additive quad each way, leaning out.
    for (const rot of [0, Math.PI / 2]) halo(b, sx + side * 3, ground + 22, front + 1.5, 2.2, 44, rot, 0xbfe6ff, 0.035);
  }
}

/* ------------------------------------------------------------------ the quake */

/**
 * The fissure the quake opened across the avenue: a jagged black opening flush with the asphalt
 * (no heaved lips: a slab the car drives straight through reads false), and something still
 * glowing down in it where it is widest.
 */
function buildFissures(b: EnvBuilders, o: ObeliscoSpec): void {
  const rng = makeRng(0xf155e7);
  const avenue = b.plan.ribbons.find((r) => r.tag === 'st-e3');
  const lift = avenue?.lift ?? 0;
  for (const line of o.fissures) {
    // Subdivide each span with jitter, so the edge is jagged at a metre's scale.
    const pts: Array<{ x: number; z: number; w: number }> = [];
    for (let i = 0; i < line.length - 1; i++) {
      const a = line[i];
      const c = line[i + 1];
      const steps = Math.max(2, Math.round(Math.hypot(c.x - a.x, c.z - a.z) / 1.6));
      for (let k = 0; k < steps; k++) {
        const t = k / steps;
        const w = a.w + (c.w - a.w) * t;
        pts.push({ x: a.x + (c.x - a.x) * t, z: a.z + (c.z - a.z) * t, w: Math.max(0.15, w * 1.5 * (0.7 + rng() * 0.6)) });
      }
    }
    pts.push({ ...line[line.length - 1], w: line[line.length - 1].w * 1.5 });
    const edges = pts.map((p, i) => {
      const q = pts[Math.min(pts.length - 1, i + 1)];
      const r = pts[Math.max(0, i - 1)];
      let tx = q.x - r.x;
      let tz = q.z - r.z;
      const len = Math.hypot(tx, tz) || 1;
      tx /= len;
      tz /= len;
      // Normal, and a lopsided jag each side.
      const nx = -tz;
      const nz = tx;
      const l = (p.w / 2) * (0.7 + rng() * 0.6);
      const rr = (p.w / 2) * (0.7 + rng() * 0.6);
      const y = b.plan.padY(p.x, p.z) + lift + 0.03;
      return { p, y, lx: p.x + nx * l, lz: p.z + nz * l, rx: p.x - nx * rr, rz: p.z - nz * rr };
    });
    for (let i = 0; i < edges.length - 1; i++) {
      const e = edges[i];
      const f = edges[i + 1];
      // The void.
      b.props.color(0x030304, 1);
      b.props.quad(e.lx, e.y + 0.01, e.lz, e.rx, e.y + 0.01, e.rz, f.rx, f.y + 0.01, f.rz, f.lx, f.y + 0.01, f.lz, 0, 0, 1, 1);
      b.props.quad(f.lx, f.y + 0.01, f.lz, f.rx, f.y + 0.01, f.rz, e.rx, e.y + 0.01, e.rz, e.lx, e.y + 0.01, e.lz, 0, 0, 1, 1);
      // Down in the widest part, a glow: cables burning, or the city under the city.
      if (e.p.w > 3.2 && f.p.w > 3.2 && rng() < 0.6) {
        b.neonPulse.color(0xff5a1e, 0.22);
        b.neonPulse.tube(e.p.x, e.y - 0.25, e.p.z, f.p.x, f.y - 0.25, f.p.z, Math.min(e.p.w, f.p.w) * 0.12);
        if (i % 2 === 0) groundGlow(b, e.p.x, e.p.z, e.p.w * 2.5, e.p.w * 2.5, 0xff6a2a, 0.035);
      }
    }
  }
}

/* ------------------------------------------------------------------ the barricades */

/** The protests' barriers: jersey-shaped, taller than a man, grey, covered in graffiti, some knocked over. */
function buildBarricades(b: EnvBuilders, o: ObeliscoSpec): void {
  const rng = makeRng(0xbacca7);
  for (const bc of o.barricades) {
    const r = barricadeBox(bc);
    const y = b.plan.padY(bc.x, bc.z);
    const cx = (r.minX + r.maxX) / 2;
    const cz = (r.minZ + r.maxZ) / 2;
    const sx = r.maxX - r.minX;
    const sz = r.maxZ - r.minZ;
    b.wall.color(0x9d9a93, 0.9 + rng() * 0.25);
    if (bc.toppled) {
      // On its side: the wide foot one way, the narrow top the other.
      const tall = BARRICADE.width;
      b.wall.box(cx, y + tall / 2, cz, sx, tall, sz, { tileW: 4, tileH: 4 });
    } else {
      const foot = BARRICADE.height * 0.3;
      b.wall.box(cx, y + foot / 2, cz, sx, foot, sz, { tileW: 4, tileH: 4 });
      const nx = bc.alongX ? sx : sx * 0.45;
      const nz = bc.alongX ? sz * 0.45 : sz;
      b.wall.box(cx, y + foot + (BARRICADE.height - foot) / 2, cz, nx, BARRICADE.height - foot, nz, { tileW: 4, tileH: 4 });
    }
    // Paint: most of them are bombed end to end, both long faces; the rest carry a stripe of
    // hazard or a slash of the protest's colour.
    const faceZ = bc.alongX;
    const rot = faceZ ? 0 : Math.PI / 2;
    const across = faceZ ? sz : sx;
    if (rng() < 0.8) {
      // One side down shows a single flat face; one standing shows its foot and the narrower
      // wall above it. Both bands of a standing one share the layout below, so a piece runs
      // down from the upper wall onto the foot as one piece of paint.
      const faceH = bc.toppled ? BARRICADE.width : BARRICADE.height;
      const foot = BARRICADE.height * 0.3;
      const bands = bc.toppled
        ? [{ inset: across / 2, y0: 0, h: faceH }]
        : [{ inset: across / 2, y0: 0, h: foot }, { inset: across * 0.225, y0: foot, h: faceH - foot }];
      const toward = faceZ ? 1 : Math.sign(o.x - bc.x) || 1;
      for (const side of [toward, -toward]) {
        const nx = faceZ ? 0 : side;
        const nz = faceZ ? side : 0;
        // The layout, in face coordinates: pieces two to three times the barrier's height, laid
        // edge to edge along it with some overlap and cut wherever the concrete ends. What is
        // on the barrier is a slice of something much bigger — not a sticker with wall around it.
        const layout: Array<{ cell: number; along: number; up: number; w: number; h: number; bright: number }> = [];
        let x = -BARRICADE.length / 2 - rng() * 1.5;
        while (x < BARRICADE.length / 2) {
          let cell = pickPaintCell(rng);
          // A lettered banner cut down to a slice cannot be read, so the barriers skip them.
          for (let tries = 0; graffitiIsBanner(cell) && tries < 8; tries++) cell = pickPaintCell(rng);
          if (graffitiIsBanner(cell)) break;
          const h = faceH * (2 + rng() * 1.2);
          const w = h * graffitiAspect(cell);
          layout.push({ cell, along: x + w / 2, up: faceH * (0.35 + rng() * 0.3), w, h, bright: 1.3 + rng() * 0.5 });
          x += w * (0.55 + rng() * 0.25);
        }
        for (const band of bands) {
          const surface = {
            x: cx + nx * band.inset, y: y + band.y0, z: cz + nz * band.inset,
            nx, nz, tx: faceZ ? 1 : 0, tz: faceZ ? 0 : 1,
            width: BARRICADE.length, height: band.h, out: 0.03,
          };
          for (const p of layout) {
            const vis = clipToSurface(surface, p.along, p.up - band.y0, p.w, p.h);
            if (vis) decal(b, surface, vis.across, vis.up, vis.w, vis.h, 0, p.cell, 0xffffff, p.bright, false, vis.crop);
          }
        }
      }
    } else {
      const off = across / 2 + 0.02;
      const fx = faceZ ? cx : cx + off;
      const fz = faceZ ? cz + off : cz;
      if (rng() < 0.55) {
        b.props.color(0xd8b020, 0.8);
        b.props.panel(fx, y + BARRICADE.height * 0.45, fz, BARRICADE.length * 0.8, 0.3, rot);
        b.props.color(0x16181c, 1);
        b.props.panel(fx, y + BARRICADE.height * 0.45, fz + (faceZ ? 0.005 : 0), BARRICADE.length * 0.8, 0.1, rot);
      } else {
        b.neon.color(rng() < 0.5 ? PAL.neonMagenta : PAL.neonCyan, 0.35);
        b.neon.panel(fx, y + BARRICADE.height * 0.5, fz, 1.6 + rng() * 1.5, 0.6, rot);
      }
    }
    // The lifting eyes on top of the ones still standing: a barrier this size goes on with a crane.
    if (!bc.toppled) {
      b.props.color(0x3a2a22, 1);
      for (const t of [-0.3, 0.3]) {
        const ex = bc.alongX ? cx + t * sx : cx;
        const ez = bc.alongX ? cz : cz + t * sz;
        b.props.tube(ex, y + BARRICADE.height, ez, ex, y + BARRICADE.height + 0.25, ez, 0.08);
      }
    }
  }
}

/* ------------------------------------------------------------------ the McDonald's */

function buildMcDonalds(b: EnvBuilders, o: ObeliscoSpec, rng: () => number): void {
  const m = o.mcdonalds;
  const base = b.plan.padY((m.minX + m.maxX) / 2, (m.minZ + m.maxZ) / 2);
  // Its forecourt: the pavement to the edge of the lot.
  b.concrete.color(PAL.sidewalk, 1);
  drapedSlab(b, b.concrete, { minX: m.minX + 0.3, maxX: m.maxX - 0.3, minZ: m.minZ + 0.3, maxZ: m.maxZ - 0.3 }, 0.006);
  const bx0 = m.minX + 1.5;
  const bx1 = m.maxX - 1.5;
  const bz0 = m.minZ + 1.5;
  const bz1 = m.maxZ - 1.5;
  const w = bx1 - bx0;
  const d = bz1 - bz0;
  const cx = (bx0 + bx1) / 2;
  const cz = (bz0 + bz1) / 2;
  const top = base + 8.5;
  // The upper floor and the roof: red panels, a dark parapet.
  b.wall.color(MC_RED, 0.95);
  b.wall.box(cx, base + 3.9 + (top - base - 3.9) / 2, cz, w, top - base - 3.9, d, { tileW: 6, tileH: 6 });
  b.roof.color(0x1b1d20, 1);
  b.roof.planeY(cx, top + 0.02, cz, w, d);
  // The ground floor: glass all round the corner faces, lit warm from inside.
  b.wall.color(0x2a1a1a, 1);
  b.wall.box(cx, base + 1.95, cz, w - 0.6, 3.9, d - 0.6, { top: false });
  const glass = (x: number, z: number, len: number, rot: number): void => {
    b.neon.color(0xffd9a0, 0.6);
    b.neon.panel(x, base + 1.8, z, len, 2.9, rot);
  };
  glass(bx0 - 0.02, cz, d - 2, -Math.PI / 2);
  glass(cx, bz0 - 0.02, w - 2, Math.PI);
  // The yellow band at the first floor, on the two street faces.
  b.neon.color(ARCH_YELLOW, 0.55);
  b.neon.panel(bx0 - 0.08, base + 4.15, cz, d, 0.45, -Math.PI / 2);
  b.neon.panel(cx, base + 4.15, bz0 - 0.08, w, 0.45, Math.PI);
  // The arches and the name on the avenue face.
  arches(b.neon, bx0 - 0.1, base + 5.4, cz - d * 0.22, -1, 0, 3.2, 2.6);
  neonText(b.neon, "MCDONALD'S", bx0 - 0.1, base + 5.3, cz + d * 0.12, -1, 0, 1.05, 0xffffff, 0.8);
  groundGlow(b, bx0 - 5, cz, 9, d + 6, 0xffb060, 0.08);
  groundGlow(b, cx, bz0 - 5, w + 6, 9, 0xffb060, 0.06);
  // The pylon on the corner: a red column and the arches high over the crossing.
  const pyx = m.minX + 1.2;
  const pyz = m.minZ + 1.2;
  b.props.color(0x2b2e33, 1);
  b.props.box(pyx, base + 7, pyz, 0.55, 14, 0.55, { top: false });
  b.wall.color(MC_RED, 1);
  b.wall.box(pyx, base + 15.2, pyz, 0.6, 3.6, 4.4);
  arches(b.neon, pyx - 0.32, base + 14, pyz, -1, 0, 3.4, 2.8);
  arches(b.neon, pyx + 0.32, base + 14, pyz, 1, 0, 3.4, 2.8);
  halo(b, pyx - 0.8, base + 15.2, pyz, 7, 5, -Math.PI / 2, ARCH_YELLOW, 0.14);

  // The board on the roof, facing down the avenue toward the descent.
  const bw = 21;
  const bh = 7.5;
  const by = top + 3 + bh / 2;
  const bcx = cx + 1;
  const bcz = cz + 2;
  // Facing south-west: down the avenue at the descent, and across it.
  const rot = -Math.PI * 0.22;
  const nx = Math.sin(rot);
  const nz = Math.cos(rot);
  b.props.color(0x16181c, 1);
  for (const side of [-1, 1]) {
    const lx = bcx + Math.cos(rot) * side * bw * 0.35;
    const lz = bcz - Math.sin(rot) * side * bw * 0.35;
    b.props.tube(lx, top, lz, lx, by, lz, 0.28);
  }
  b.props.color(0x0b0d12, 1);
  b.props.panel(bcx - nx * 0.05, by, bcz - nz * 0.05, bw + 0.6, bh + 0.6, rot);
  b.neon.color(0x071722, 1);
  b.neon.panel(bcx, by, bcz, bw, bh, rot);
  const lines = ['BANDIDO CITY', 'SIEMPRE', 'AVANZA'];
  const lh = 1.35;
  lines.forEach((line, i) => {
    const ty = by + bh / 2 - 1.2 - (i + 1) * (lh + 0.55) + lh;
    const shift = -bw / 2 + 1.1 + textWidth(line, lh) / 2;
    // The text starts at the board's left edge as its viewer sees it: right of the face is (nz, -nx).
    neonText(b.neon, line, bcx + nz * shift + nx * 0.04, ty, bcz - nx * shift + nz * 0.04, nx, nz, lh, PAL.neonCyan, 0.95);
  });
  // A slash of light across the corner, the board's accent.
  b.neonPulse.color(PAL.neonCyan, 0.9);
  b.neonPulse.tube(bcx + nz * (bw * 0.28) + nx * 0.1, by - bh * 0.35, bcz - nx * (bw * 0.28) + nz * 0.1, bcx + nz * (bw * 0.44) + nx * 0.1, by + bh * 0.1, bcz - nx * (bw * 0.44) + nz * 0.1, 0.22);
  halo(b, bcx + nx * 1.5, by, bcz + nz * 1.5, bw * 1.3, bh * 1.5, rot, PAL.neonCyan, 0.12);
  void rng;
}

/**
 * The golden arches: two tall rounded arches side by side, as tubes, on a wall facing
 * (`nx`, `nz`), centred at (x, z), feet at `y`, `w` wide and `h` tall.
 */
function arches(mb: MeshBuilder, x: number, y: number, z: number, nx: number, nz: number, w: number, h: number): void {
  const rx = nz;
  const rz = -nx;
  mb.color(ARCH_YELLOW, 1);
  const steps = 10;
  const tube = Math.max(0.12, w * 0.07);
  for (const centre of [-w / 4, w / 4]) {
    let lu = 0;
    let lv = 0;
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * Math.PI;
      const u = centre - Math.cos(t) * (w / 4);
      const v = Math.pow(Math.sin(t), 0.45) * h;
      if (i > 0) mb.tube(x + rx * lu + nx * 0.05, y + lv, z + rz * lu + nz * 0.05, x + rx * u + nx * 0.05, y + v, z + rz * u + nz * 0.05, tube);
      lu = u;
      lv = v;
    }
  }
}

/* ------------------------------------------------------------------ the gantry */

function buildGantry(b: EnvBuilders, o: ObeliscoSpec): void {
  const g = o.gantry;
  const ramp = b.plan.ribbons.find((r) => r.tag === 'ramp-e-s');
  if (!ramp) return;
  const p = createProjection();
  projectOntoPath(ramp.path, g.x, g.z, p);
  const deck = p.y;
  const half = g.width / 2 + 0.6;
  const beamY = deck + g.y;
  // Posts on the rails, the beam across, the green board facing the traffic coming down (south face).
  b.props.color(0x3a3f46, 1);
  b.props.tube(p.x - half, deck, p.z, p.x - half, beamY + 1.3, p.z, 0.32);
  b.props.tube(p.x + half, deck, p.z, p.x + half, beamY + 1.3, p.z, 0.32);
  b.props.tube(p.x - half, beamY + 1.3, p.z, p.x + half, beamY + 1.3, p.z, 0.22);
  b.props.color(0x0f5a32, 1.1);
  b.props.box(p.x, beamY + 1.3, p.z, g.width, 2.8, 0.25);
  b.neon.color(0xf2f6f0, 0.75);
  const face = p.z + 0.14;
  neonText(b.neon, 'AV. 9 DE JULIO', p.x, beamY + 1.75, face, 0, 1, 0.95, 0xf2f6f0, 0.75);
  // Three arrows down, one per lane and one for luck.
  for (const k of [-1, 0, 1]) {
    const ax = p.x + k * (g.width * 0.3);
    const ay = beamY + 0.35;
    b.neon.color(0xf2f6f0, 0.75);
    b.neon.tube(ax, ay + 0.9, face + 0.02, ax, ay, face + 0.02, 0.12);
    b.neon.tube(ax - 0.35, ay + 0.35, face + 0.02, ax, ay, face + 0.02, 0.12);
    b.neon.tube(ax + 0.35, ay + 0.35, face + 0.02, ax, ay, face + 0.02, 0.12);
  }
  // White border.
  b.neon.color(0xf2f6f0, 0.5);
  const x0 = p.x - g.width / 2 + 0.15;
  const x1 = p.x + g.width / 2 - 0.15;
  const y0 = beamY + 0.05;
  const y1 = beamY + 2.55;
  b.neon.tube(x0, y0, face, x1, y0, face, 0.06);
  b.neon.tube(x0, y1, face, x1, y1, face, 0.06);
  b.neon.tube(x0, y0, face, x0, y1, face, 0.06);
  b.neon.tube(x1, y0, face, x1, y1, face, 0.06);
}

/* ------------------------------------------------------------------ the murals */

/**
 * The villa block whose wall faces the avenue nearest to `z`: on the west side (`side` -1) the
 * one reaching furthest east short of `limit`, on the east side the one starting furthest west.
 */
function villaFrontage(b: EnvBuilders, z: number, side: -1 | 1, limit: number): BlockRect | null {
  let best: BlockRect | null = null;
  for (const blk of b.plan.blocks) {
    if (!blk.villa || blk.minZ > z - 6 || blk.maxZ < z + 6) continue;
    if (side < 0 ? blk.maxX > limit : blk.minX < limit) continue;
    if (!best || (side < 0 ? blk.maxX > best.maxX : blk.minX < best.minX)) best = blk;
  }
  return best;
}

function buildMurals(b: EnvBuilders): void {
  // West of the avenue, facing the descent's foot: VILLA 31 PRESENTE, over two lines.
  const west = villaFrontage(b, 590, -1, 476);
  if (west) {
    const x = west.maxX - 1.6 + 0.4;
    const z = 590;
    const y = b.plan.padY(x, z);
    villaMural(b, 'VILLA 31', x, y + 1.9, z, 1, 0, 1.3, 0xf0ece4);
    villaMural(b, 'PRESENTE', x, y + 0.35, z, 1, 0, 1.1, PAL.neonMagenta);
  }
  // Further up the same frontage, where the descent lands: BARRIO PADRE MUGICA.
  const foot = villaFrontage(b, 536, -1, 476);
  if (foot) {
    const x = foot.maxX - 1.6 + 0.4;
    const z = 536;
    const y = b.plan.padY(x, z);
    villaMural(b, 'BARRIO', x, y + 1.9, z, 1, 0, 1.2, 0xf0ece4);
    villaMural(b, 'PADRE MUGICA', x, y + 0.35, z, 1, 0, 1.0, PAL.neonCyan);
  }
}
