import type { RingBillboardDef, SkybridgeDef, TowerDef } from '../../../world/cityPlan';
import { PAL, zoneAccent } from './palette';
import { makeRng } from './meshBuilder';
import { groundGlow, halo, type EnvBuilders } from './builders';
import { facadeCell } from './facadeAtlas';
import { lampPost } from './propsBuilder';
import { rollLampFault } from './lampFaults';

/**
 * The big city's landmarks, from the plan: the quay along the water, lattice radio masts and
 * the power line across the bay, the drum of screens on its mast, and the enclosed bridges
 * between buildings. Low-poly on purpose — tubes and boxes — with the light doing the work.
 * Everything lands in the shared per-material builders; no new draw calls. The water surface
 * itself is a separate mesh in `environment.ts`.
 *
 * The greenery that used to live here — a hedge or a palm every few metres along every block
 * ledge in the city — is gone. What grows now grows where the city has been let go, from
 * `reclaimBuilder.ts` and the plant kit in `plants.ts`.
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
