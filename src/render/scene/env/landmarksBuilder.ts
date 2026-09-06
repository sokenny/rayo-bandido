import type { RingBillboardDef, SkybridgeDef, TowerDef } from '../../../world/cityPlan';
import { PAL, zoneAccent } from './palette';
import { makeRng } from './meshBuilder';
import { groundGlow, halo, type EnvBuilders } from './builders';
import { blockSetback } from './cityBuilder';
import { facadeCell } from './facadeAtlas';
import { lampPost } from './propsBuilder';
import { rollLampFault } from './lampFaults';

/**
 * The big city's landmarks, from the plan: the quay along the water, lattice radio masts and
 * the power line across the bay, the drum of screens on its mast, and the enclosed bridges
 * between buildings. Low-poly on purpose — tubes and boxes — with the light doing the work.
 * Everything lands in the shared per-material builders; no new draw calls. The water surface
 * itself is a separate mesh in `environment.ts`.
 */
export function buildLandmarks(b: EnvBuilders): void {
  const rng = makeRng(0x1a7d);
  if (b.plan.water) buildQuay(b, rng);
  const towers = b.plan.towers ?? [];
  for (const t of towers) {
    if (t.kind === 'radio') buildRadioTower(b, t, rng);
    else buildPylon(b, t, rng);
  }
  for (const [i, j] of b.plan.powerLines ?? []) buildPowerLine(b, towers[i], towers[j], rng);
  for (const r of b.plan.ringBillboards ?? []) buildRingBillboard(b, r, rng);
  for (const s of b.plan.skybridges ?? []) buildSkybridge(b, s, rng);
  buildGreenery(b, rng);
}

/* ------------------------------------------------------------------ greenery */

/** A hedge: two stacked boxes, the top one narrower, so it reads as a clipped bush. */
function hedge(b: EnvBuilders, x: number, z: number, y0: number, len: number, along: 'x' | 'z', rng: () => number): void {
  const h = 1.0 + rng() * 0.5;
  const w = 0.9 + rng() * 0.3;
  b.props.color(PAL.foliage, 0.85 + rng() * 0.3);
  b.props.box(x, y0 + h / 2, z, along === 'x' ? len : w, h, along === 'x' ? w : len);
  b.props.color(PAL.foliage, 1.05 + rng() * 0.25);
  b.props.box(x, y0 + h + 0.2, z, along === 'x' ? len - 0.6 : w - 0.3, 0.4, along === 'x' ? w - 0.3 : len - 0.6);
}

/** Cross-section corners, clockwise seen from above, so `shaft`'s side quads face outward. */
const CORNERS: ReadonlyArray<readonly [number, number]> = [[-1, -1], [1, -1], [1, 1], [-1, 1]];

/**
 * A four-sided tapered column between two points, square in plan. Unlike `tube` (two crossed
 * quads, half of them backface-culled) it is solid from every angle, which is what a trunk
 * needs: the props material is single-sided.
 */
function shaft(
  b: EnvBuilders,
  x0: number,
  y0: number,
  z0: number,
  r0: number,
  x1: number,
  y1: number,
  z1: number,
  r1: number,
): void {
  for (let k = 0; k < 4; k++) {
    const ax = CORNERS[k][0];
    const az = CORNERS[k][1];
    const bx = CORNERS[(k + 1) % 4][0];
    const bz = CORNERS[(k + 1) % 4][1];
    b.props.quad(
      x0 + bx * r0, y0, z0 + bz * r0,
      x0 + ax * r0, y0, z0 + az * r0,
      x1 + ax * r1, y1, z1 + az * r1,
      x1 + bx * r1, y1, z1 + bz * r1,
    );
  }
}

/**
 * One tapered blade of a frond, drawn twice: the top face and, 4 cm below it, the underside
 * with the winding reversed. The gap is what keeps the two from z-fighting and gives the
 * frond a little thickness against the sky.
 */
function blade(
  b: EnvBuilders,
  px: number,
  py: number,
  pz: number,
  pw: number,
  qx: number,
  qy: number,
  qz: number,
  qw: number,
  nx: number,
  nz: number,
): void {
  const ax = px - nx * pw;
  const az = pz - nz * pw;
  const bx = px + nx * pw;
  const bz = pz + nz * pw;
  const cx = qx + nx * qw;
  const cz = qz + nz * qw;
  const dx = qx - nx * qw;
  const dz = qz - nz * qw;
  b.props.quad(ax, py + 0.02, az, bx, py + 0.02, bz, cx, qy + 0.02, cz, dx, qy + 0.02, dz);
  b.props.quad(dx, qy - 0.02, dz, cx, qy - 0.02, cz, bx, py - 0.02, bz, ax, py - 0.02, az);
}

/**
 * A low-poly palm. The trunk is a curved, tapered, four-sided shaft with a flared root, and
 * it leans out over the street — taller palms lean further — so the crown clears the facade
 * behind it. Heights run from head height to fourteen metres, and no frond is allowed to
 * reach further into the block than the pavement it stands on: `outX/outZ` points at the
 * street and `room` is the metres of pavement between the trunk and the wall.
 */
function palm(
  b: EnvBuilders,
  x: number,
  z: number,
  y0: number,
  outX: number,
  outZ: number,
  room: number,
  rng: () => number,
): void {
  // Squared so most palms are young and short and a few are old giants: the spread is the
  // point, a row of identical trees reads as wallpaper.
  const t = rng();
  const h = 4.5 + t * t * 9.5;
  const lean = 0.5 + t * 1.6;
  const drift = (rng() - 0.5) * 1.1;
  const topX = x + outX * lean - outZ * drift;
  const topZ = z + outZ * lean + outX * drift;
  const r = 0.24 + t * 0.2;

  // The shaft, in three segments: straight at the foot, curving into the crown.
  const segs = 3;
  let px = x;
  let py = y0 - 0.25;
  let pz = z;
  let pr = r * 1.6;
  for (let i = 1; i <= segs; i++) {
    const u = i / segs;
    const bend = u * u;
    const nx = x + (topX - x) * bend;
    const nz = z + (topZ - z) * bend;
    const ny = y0 + h * u;
    const nr = r * (1.1 - 0.35 * u);
    // Alternating bands: the old leaf scars that ring a palm trunk.
    b.props.color(PAL.bark, i % 2 ? 0.95 : 1.15);
    shaft(b, px, py, pz, pr, nx, ny, nz, nr);
    px = nx;
    py = ny;
    pz = nz;
    pr = nr;
  }
  // The boot: the stub of old fronds where the crown meets the trunk.
  b.props.color(PAL.bark, 1.2);
  b.props.box(topX, y0 + h + 0.15, topZ, r * 2.7, 0.8, r * 2.7);

  const fronds = 7 + Math.floor(rng() * 4);
  const phase = rng() * Math.PI * 2;
  const cy = y0 + h + 0.4;
  for (let i = 0; i < fronds; i++) {
    const a = phase + (i / fronds) * Math.PI * 2 + (rng() - 0.5) * 0.3;
    const fx = Math.cos(a);
    const fz = Math.sin(a);
    let len = (1.5 + h * 0.3) * (0.8 + rng() * 0.4);
    // How much of this frond points at the wall, and how far it may go before it hits it.
    const inward = -(fx * outX + fz * outZ);
    if (inward > 0.05) len = Math.min(len, Math.max(1.1, (room + lean - 0.4) / inward));
    const droop = len * (0.45 + rng() * 0.35);
    const nx = -fz;
    const nz = fx;
    const mx = topX + fx * len * 0.55;
    const mz = topZ + fz * len * 0.55;
    const my = cy + 0.25 - droop * 0.2;
    const ex = topX + fx * len;
    const ez = topZ + fz * len;
    const ey = cy - droop;
    const shade = 0.95 + rng() * 0.45;
    b.props.color(PAL.foliage, shade);
    blade(b, topX + fx * 0.25, cy, topZ + fz * 0.25, 0.14, mx, my, mz, 0.5, nx, nz);
    // The drooping half catches more of the sky, so it sits a touch brighter.
    b.props.color(PAL.foliage, shade + 0.2);
    blade(b, mx, my, mz, 0.5, ex, ey, ez, 0.1, nx, nz);
  }
}

/**
 * Hedges and palms along every block ledge that faces a street, in every zone: a hedge run
 * or a palm every few metres, thickest along the waterfront. They stand on the pavement
 * inside the block's collider, so nothing here is ever driven into — and they are planted
 * halfway between the kerb and the facade, using the same setback the buildings do, so a
 * narrow plot gets a hedge or nothing rather than a palm growing out of a wall.
 */
function buildGreenery(b: EnvBuilders, rng: () => number): void {
  const isRoad = b.plan.isRoad;
  const quayZ = b.plan.water ? b.plan.water.quayZ : Infinity;
  const downtown = b.plan.downtown;
  for (const blk of b.plan.blocks) {
    const nearWater = blk.maxZ > quayZ - 40;
    const inDowntown = !!downtown && blk.minX >= downtown.minX && blk.maxX <= downtown.maxX && blk.minZ >= downtown.minZ && blk.maxZ <= downtown.maxZ;
    const step = nearWater ? 7 : 9;
    const palmChance = nearWater ? 0.55 : inDowntown ? 0.12 : 0.22;
    const hedgeChance = inDowntown ? 0.3 : 0.4;
    const setback = blockSetback(blk.maxX - blk.minX, blk.maxZ - blk.minZ);
    /**
     * `outX/outZ` points from the block out at the street; `pave` is the pavement between
     * the collider edge and the facade on that side.
     */
    const place = (edgeX: number, edgeZ: number, outX: number, outZ: number, pave: number, along: 'x' | 'z'): void => {
      // Halfway out on the ledge, but never so close to the kerb that a bumper clips it.
      const off = Math.min(1.6, Math.max(0.7, pave * 0.5));
      const x = edgeX - outX * off;
      const z = edgeZ - outZ * off;
      const y0 = b.plan.padY(x, z);
      const room = pave - off;
      const r = rng();
      if (r < palmChance && room > 0.7) palm(b, x, z, y0, outX, outZ, room, rng);
      else if (r < palmChance + hedgeChance && room > 0.5) hedge(b, x, z, y0, 2.4 + rng() * 3, along, rng);
    };
    for (let x = blk.minX + 3; x < blk.maxX - 3; x += step) {
      if (isRoad(x, blk.minZ - 6)) place(x, blk.minZ, 0, -1, setback.z, 'x');
      if (isRoad(x, blk.maxZ + 6)) place(x, blk.maxZ, 0, 1, setback.z, 'x');
    }
    for (let z = blk.minZ + 3; z < blk.maxZ - 3; z += step) {
      if (isRoad(blk.minX - 6, z)) place(blk.minX, z, -1, 0, setback.x, 'z');
      if (isRoad(blk.maxX + 6, z)) place(blk.maxX, z, 1, 0, setback.x, 'z');
    }
  }
}

/* ------------------------------------------------------------------ waterfront */

function buildQuay(b: EnvBuilders, rng: () => number): void {
  const water = b.plan.water!;
  const bounds = b.plan.bounds;
  const qz = water.quayZ;
  const x0 = bounds.minX;
  const x1 = bounds.maxX;
  // The wall: down into the water, up to a low parapet.
  b.concrete.color(PAL.concrete, 0.95);
  b.concrete.box((x0 + x1) / 2, -1.6, qz + 0.6, x1 - x0, 3.9, 1.2);
  // Pavement between the boulevard and the edge.
  b.concrete.color(PAL.sidewalk, 0.95);
  b.concrete.planeY((x0 + x1) / 2, 0.2, qz - 3, x1 - x0, 6);
  // Railing, lamps and bollards, broken wherever a ramp comes ashore.
  const seg = 3;
  let n = 0;
  for (let x = x0 + 2; x < x1 - 2; x += seg, n++) {
    const mx = x + seg / 2;
    if (b.plan.isRoad(mx, qz - 1, 1.5)) continue;
    b.props.color(PAL.metalDark, 0.9);
    b.props.box(x, 0.85, qz - 0.2, 0.12, 1.25, 0.12);
    b.props.tube(x, 1.42, qz - 0.2, x + seg, 1.42, qz - 0.2, 0.09);
    b.props.tube(x, 0.9, qz - 0.2, x + seg, 0.9, qz - 0.2, 0.07);
    if (n % 3 === 0) {
      b.props.color(PAL.metalDark, 1.1);
      b.props.box(x + 1.4, 0.55, qz - 1.6, 0.5, 0.7, 0.5);
    }
    if (n % 9 === 4) {
      const c = rng() < 0.7 ? PAL.winCold : PAL.neonCyan;
      lampPost(b, mx, qz - 1.2, 0.22, 0, -1, 2.2, 6.4, c, 7, rollLampFault(rng));
    }
  }
  // Neon strip along the parapet, the line the whole waterfront reads by.
  b.neonPulse.color(PAL.neonCyan, 0.55);
  b.neonPulse.tube(x0 + 4, 0.42, qz + 0.05, x1 - 4, 0.42, qz + 0.05, 0.16);

  // Reflections on the water: long streaks running away from the shore, in the colours of
  // the city behind them. They are the whole "wet" of the bay for the price of a few quads.
  for (let i = 0; i < 34; i++) {
    const x = x0 + 8 + rng() * (x1 - x0 - 16);
    const len = 50 + rng() * 140;
    const w = 2 + rng() * 7;
    const r = rng();
    const c = r < 0.45 ? PAL.neonCyan : r < 0.8 ? PAL.neonMagenta : PAL.neonViolet;
    groundGlow(b, x, qz + len / 2 + 2, w, len, c, 0.05 + rng() * 0.06, -0.5);
  }
  // The city's own glow on the water near the shore.
  groundGlow(b, (x0 + x1) / 2, qz + 45, x1 - x0, 90, PAL.neonViolet, 0.035, -0.52);
}

/* ------------------------------------------------------------------ lattice masts */

/** Four tapering legs, rings of braces, an X on every other bay. */
function lattice(b: EnvBuilders, x: number, z: number, y0: number, height: number, base: number, top: number, bay: number, legW: number): void {
  const corners: Array<[number, number]> = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  const at = (k: number, y: number): [number, number, number] => {
    const t = (y - y0) / height;
    const half = (base + (top - base) * t) / 2;
    return [x + corners[k][0] * half, y, z + corners[k][1] * half];
  };
  b.props.color(PAL.metalDark, 0.95);
  for (let k = 0; k < 4; k++) {
    const [ax, ay, az] = at(k, y0);
    const [bx, by, bz] = at(k, y0 + height);
    b.props.tube(ax, ay, az, bx, by, bz, legW);
  }
  let ring = 0;
  for (let y = y0 + bay; y < y0 + height - 0.5; y += bay, ring++) {
    for (let k = 0; k < 4; k++) {
      const [ax, ay, az] = at(k, y);
      const [bx, by, bz] = at((k + 1) % 4, y);
      b.props.tube(ax, ay, az, bx, by, bz, legW * 0.55);
      if (ring % 2 === 0 && y + bay < y0 + height) {
        const [cx, cy, cz] = at((k + 1) % 4, y + bay);
        const [dx, dy, dz] = at(k, y + bay);
        b.props.tube(ax, ay, az, cx, cy, cz, legW * 0.4);
        b.props.tube(bx, by, bz, dx, dy, dz, legW * 0.4);
      }
    }
  }
}

function buildRadioTower(b: EnvBuilders, t: TowerDef, rng: () => number): void {
  const y0 = b.plan.padY(t.x, t.z);
  const h = t.height;
  lattice(b, t.x, t.z, y0, h, t.base, t.base * 0.22, 7.5, 0.34);
  // Platforms a third and two thirds of the way up, with dishes.
  for (const f of [0.34, 0.68]) {
    const y = y0 + h * f;
    const s = t.base * (1 - f * 0.78) + 1.6;
    b.props.color(PAL.metalDark, 0.8);
    b.props.box(t.x, y, t.z, s, 0.5, s);
    b.props.color(PAL.sidewalk, 1.1);
    b.props.box(t.x + s / 2 + 0.6, y + 1.4, t.z, 0.5, 2.4, 2.4);
    b.props.box(t.x, y + 1.2, t.z - s / 2 - 0.6, 2.2, 2.2, 0.5);
  }
  // The mast on top and its beacon: the one slow blink on the skyline.
  const mastH = 8 + rng() * 6;
  b.props.color(PAL.metalDark, 0.7);
  b.props.box(t.x, y0 + h + mastH / 2, t.z, 0.5, mastH, 0.5);
  b.neonFlicker.color(PAL.neonMagenta, 0.9);
  b.neonFlicker.box(t.x, y0 + h + mastH, t.z, 1.2, 1.2, 1.2);
  halo(b, t.x, y0 + h + mastH, t.z, 9, 9, 0, PAL.neonMagenta, 0.16);
  halo(b, t.x, y0 + h + mastH, t.z, 9, 9, Math.PI / 2, PAL.neonMagenta, 0.16);
  // Mid-height marker lights, dim and steady.
  for (const f of [0.25, 0.5, 0.75]) {
    b.neon.color(PAL.neonMagenta, 0.5);
    b.neon.box(t.x, y0 + h * f, t.z, 0.6, 0.6, 0.6);
  }
}

function buildPylon(b: EnvBuilders, t: TowerDef, rng: () => number): void {
  const tx = t.tx ?? 1;
  const tz = t.tz ?? 0;
  const nx = -tz;
  const nz = tx;
  const wet = !!b.plan.water && t.z > b.plan.water.quayZ;
  const y0 = wet ? -3 : b.plan.padY(t.x, t.z);
  const h = t.height;
  lattice(b, t.x, t.z, y0, h, t.base, t.base * 0.3, 6, 0.3);
  // Two cross arms; the cables hang off their ends.
  for (const arm of pylonArms(t)) {
    b.props.color(PAL.metalDark, 0.9);
    b.props.orientedBox(t.x, t.z, nx, nz, arm.reach * 2, 0.7, arm.y - 0.5, arm.y);
    for (const side of [-1, 1]) {
      const ax = t.x + nx * arm.reach * side;
      const az = t.z + nz * arm.reach * side;
      b.props.color(PAL.sidewalk, 0.8);
      b.props.box(ax, arm.y - 1.2, az, 0.35, 1.4, 0.35);
    }
  }
  b.neonFlicker.color(PAL.neonMagenta, 0.6);
  b.neonFlicker.box(t.x, y0 + h + 0.4, t.z, 0.8, 0.8, 0.8);
  if (rng() < 0.5) halo(b, t.x, y0 + h + 0.4, t.z, 6, 6, 0, PAL.neonMagenta, 0.12);
}

function pylonArms(t: TowerDef): Array<{ y: number; reach: number }> {
  const base = t.z > (0) ? -3 : 0;
  return [
    { y: base + t.height - 5, reach: 6.5 },
    { y: base + t.height - 11, reach: 8 },
  ];
}

function buildPowerLine(b: EnvBuilders, from: TowerDef | undefined, to: TowerDef | undefined, rng: () => number): void {
  if (!from || !to) return;
  const nx = -(from.tx ?? 1) * 0 - (from.tz ?? 0);
  const nz = from.tx ?? 1;
  const armsA = pylonArms(from);
  const armsB = pylonArms(to);
  b.props.color(PAL.metalDark, 0.5);
  for (let i = 0; i < armsA.length; i++) {
    for (const side of [-1, 1]) {
      const ax = from.x + nx * armsA[i].reach * side;
      const az = from.z + nz * armsA[i].reach * side;
      const bx = to.x + nx * armsB[i].reach * side;
      const bz = to.z + nz * armsB[i].reach * side;
      const y = armsA[i].y - 1.9;
      const sag = 3 + rng() * 2;
      const mx = (ax + bx) / 2;
      const mz = (az + bz) / 2;
      b.props.tube(ax, y, az, mx, y - sag, mz, 0.12);
      b.props.tube(mx, y - sag, mz, bx, y, bz, 0.12);
    }
  }
}

/* ------------------------------------------------------------------ the drum */

function buildRingBillboard(b: EnvBuilders, r: RingBillboardDef, rng: () => number): void {
  const y0 = b.plan.padY(r.x, r.z);
  const bottom = r.y - r.height / 2;
  const top = r.y + r.height / 2;
  // Mast and collar.
  b.props.color(PAL.metalDark, 0.9);
  b.props.box(r.x, (y0 + bottom) / 2, r.z, 2.6, bottom - y0, 2.6);
  b.props.box(r.x, bottom - 1.6, r.z, 5, 1.2, 5);
  // Four struts from the mast to the rim.
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    b.props.color(PAL.metalDark, 0.8);
    b.props.tube(r.x, bottom - 9, r.z, r.x + Math.cos(a) * (r.radius - 0.4), bottom - 0.2, r.z + Math.sin(a) * (r.radius - 0.4), 0.5);
  }
  // The drum: a faceted cylinder of screens, the two holographic textures alternating
  // around it in thirds so it scrolls in both directions at once.
  const N = 30;
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * Math.PI * 2;
    const a1 = ((i + 1) / N) * Math.PI * 2;
    const x0 = r.x + Math.cos(a0) * r.radius;
    const z0 = r.z + Math.sin(a0) * r.radius;
    const x1 = r.x + Math.cos(a1) * r.radius;
    const z1 = r.z + Math.sin(a1) * r.radius;
    const third = Math.floor((i * 3) / N);
    const target = third % 2 === 0 ? b.billA : b.billB;
    const u0 = (i % 3) / 3;
    const u1 = u0 + 1 / 3;
    // Outward winding: the later angle first (see `panel` in meshBuilder for the convention).
    target.quad(x1, bottom, z1, x0, bottom, z0, x0, top, z0, x1, top, z1, u0, 0, u1, 1);
  }
  // Rim tubes and caps.
  for (const [y, c, t] of [
    [top + 0.15, PAL.neonCyan, b.neonPulse],
    [bottom - 0.15, PAL.neonMagenta, b.neon],
  ] as const) {
    t.color(c, 1);
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * Math.PI * 2;
      const a1 = ((i + 1) / N) * Math.PI * 2;
      t.tube(r.x + Math.cos(a0) * (r.radius + 0.2), y, r.z + Math.sin(a0) * (r.radius + 0.2), r.x + Math.cos(a1) * (r.radius + 0.2), y, r.z + Math.sin(a1) * (r.radius + 0.2), 0.3);
    }
  }
  b.props.color(PAL.metalDark, 0.6);
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * Math.PI * 2;
    const a1 = ((i + 1) / N) * Math.PI * 2;
    const x0 = r.x + Math.cos(a0) * r.radius;
    const z0 = r.z + Math.sin(a0) * r.radius;
    const x1 = r.x + Math.cos(a1) * r.radius;
    const z1 = r.z + Math.sin(a1) * r.radius;
    // Top cap faces up, bottom cap faces down (degenerate fourth corner: a triangle each).
    b.props.quad(r.x, top, r.z, x1, top, z1, x0, top, z0, r.x, top, r.z);
    b.props.quad(r.x, bottom, r.z, x0, bottom, z0, x1, bottom, z1, r.x, bottom, r.z);
  }
  // Light: four halos facing the four ways, and a wash down the mast onto the roofs.
  for (let k = 0; k < 4; k++) {
    const rot = (k * Math.PI) / 2;
    const c = k % 2 === 0 ? PAL.neonCyan : PAL.neonMagenta;
    halo(b, r.x + Math.sin(rot) * (r.radius + 1), r.y, r.z + Math.cos(rot) * (r.radius + 1), r.radius * 2.6, r.height * 2.4, rot, c, 0.14);
  }
  b.glow.color(PAL.neonViolet, 0.12);
  b.glow.planeY(r.x, bottom - 0.4, r.z, r.radius * 2.4, r.radius * 2.4);
  groundGlow(b, r.x, r.z, r.radius * 4, r.radius * 4, PAL.neonViolet, 0.08 + rng() * 0.02, y0 + 0.02);
}

/* ------------------------------------------------------------------ skybridges */

function buildSkybridge(b: EnvBuilders, s: SkybridgeDef, rng: () => number): void {
  let dx = s.bx - s.ax;
  let dz = s.bz - s.az;
  const len = Math.hypot(dx, dz);
  if (len < 4) return;
  dx /= len;
  dz /= len;
  const cx = (s.ax + s.bx) / 2;
  const cz = (s.az + s.bz) / 2;
  const y0 = s.y - s.height / 2;
  const y1 = s.y + s.height / 2;
  // Body as one ribbon of windows in the district's light, floor and roof slabs in dark metal.
  const cell = facadeCell('ribbon');
  const lights = s.zone === 'corporate' ? PAL.windowsCorp : s.zone === 'jdm' ? PAL.windowsJdm : PAL.windowsUrban;
  b.facade.color(lights[Math.floor(rng() * lights.length)], 0.9).cell(cell.u0, cell.v0, 0.9);
  b.facade.orientedBox(cx, cz, dx, dz, len, s.width, y0 + 0.35, y1 - 0.35);
  b.props.color(PAL.metalDark, 0.85);
  b.props.orientedBox(cx, cz, dx, dz, len, s.width + 0.5, y0 - 0.1, y0 + 0.35);
  b.props.orientedBox(cx, cz, dx, dz, len, s.width + 0.5, y1 - 0.35, y1 + 0.1);
  // A line of light under each side, in the zone's accent.
  const accents = zoneAccent(s.zone);
  const c = accents[Math.floor(rng() * accents.length)];
  const nx = -dz;
  const nz = dx;
  const hw = s.width / 2 + 0.3;
  b.neonPulse.color(c, 0.8);
  b.neonPulse.tube(s.ax + nx * hw, y0 - 0.05, s.az + nz * hw, s.bx + nx * hw, y0 - 0.05, s.bz + nz * hw, 0.16);
  b.neonPulse.tube(s.ax - nx * hw, y0 - 0.05, s.az - nz * hw, s.bx - nx * hw, y0 - 0.05, s.bz - nz * hw, 0.16);
  groundGlow(b, cx, cz, Math.abs(dx) > 0.5 ? len : s.width * 4, Math.abs(dx) > 0.5 ? s.width * 4 : len, c, 0.07);
}
