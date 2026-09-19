import * as THREE from 'three';
import { MeshBuilder, makeRng } from '../scene/env/meshBuilder';
import { neonText } from '../scene/env/gasStationBuilder';
import type { SignCell, SignId } from './showroomTextures';
import { ROOM, TABLE } from './showroomLayout';

export { ROOM, TABLE };

/**
 * LOCO MUSTANG'S WORKSHOP, INSIDE: the room the showroom stands the car in, as a handful of
 * merged batches (each one draw call). Geometry only; `showroom.ts` gives it materials, lights
 * and the car.
 *
 * THE LOOK. His building outside is whitewashed block with turquoise steel doors and his name in
 * the red of the 99 on his shirt (`env/garageBuilder.ts`); inside it is the same place at night,
 * dressed the way NFSU2 dressed its garage: a big round turntable in the middle of a polished dark
 * floor, warm work lamps hanging over it and on the pillars, red roll cabs against the back wall
 * under his name in red neon, stacks and racks of tyres, a bench with a pegboard, posters and
 * price tags from brands that do not exist, a turquoise roller door, and his white Daewoo van
 * parked in the corner. The cyberpunk half is the lighting: cyan strips round the top of the
 * walls and under the beams, a cyan ring round the table, a screen running a dyno curve.
 *
 * THE ROOM, in world metres: the turntable at the origin, the car's nose toward -Z when the table
 * is at rest. So the camera's front shots look at the BACK wall (+Z: cabs, name, bench), rear shots
 * at the FRONT wall (-Z: roller door, van), right-flank shots (wheels, skirts) at the LEFT wall
 * (-X: tyre rack, wheels on display) and left-flank ones at the RIGHT wall (+X: oil, posters,
 * the cashier).
 */

/** How far the back wall's name and cabs sit toward -X, so the front three-quarter shots hold the whole name. */
const NAME_SHIFT = 1.5;
const CABS_SHIFT = 0.9;

/** A hanging work lamp over the table: where its bulb is. The showroom puts a point light at each. */
export interface LampSpot {
  x: number;
  y: number;
  z: number;
}

export interface RoomGeometry {
  /** Walls, ceiling, pillars, props: vertex-coloured, lit. */
  lit: THREE.BufferGeometry;
  /** Neon and LEDs: vertex-coloured, unlit, double-sided. Stays on when the shop dims. */
  neon: THREE.BufferGeometry;
  /** Work-lamp bulbs and the insides of their shades: unlit, dims with the shop. */
  lamps: THREE.BufferGeometry;
  /** Soft glows (uv'd for the glow texture) round neon, and the light pools they throw. */
  neonGlow: THREE.BufferGeometry;
  /** The same for the work lamps: halos, pools on walls. Dims. */
  lampGlow: THREE.BufferGeometry;
  /** Light shafts under the hanging lamps, vertex colour fading to black: additive. Dims. */
  beams: THREE.BufferGeometry;
  /** Signs, posters and price tags, uv'd onto the sign sheet. */
  signs: THREE.BufferGeometry;
  /** The turntable's bevelled metal rim (static: it is round). */
  rim: THREE.BufferGeometry;
  /** Hanging lamps over the table (point lights go here). */
  lampsOverTable: LampSpot[];
  /** Where Loco Mustang stands, and which way he faces (rotation.y). */
  figure: { x: number; z: number; rotY: number };
}

/* ------------------------------------------------------------------ colours */

const C = {
  whitewash: 0xcfc6ae,
  wainscot: 0x2b646b,
  rail: 0x173b40,
  grime: 0x3a352c,
  ceiling: 0x121214,
  beam: 0x25272b,
  pillar: 0x8a8274,
  steel: 0x5c616a,
  darkSteel: 0x2a2d33,
  chestRed: 0xb3161d,
  chestDark: 0x5a0a0e,
  chrome: 0xc8ccd2,
  tyre: 0x17181b,
  tyreSide: 0x222326,
  rimGrey: 0x8d939c,
  bench: 0x5a3b22,
  pegboard: 0x6b5a45,
  van: 0xe4e2da,
  glassDark: 0x0b0d10,
  turquoise: 0x3f9aa6,
  lamp: 0xffc98a,
  shade: 0x23332b,
  neonRed: 0xff1e1e,
  cyan: 0x22e6ff,
  magenta: 0xff2fd0,
  hazard: 0xd8b21c,
} as const;

/* ------------------------------------------------------------------ walls */

type WallId = 'back' | 'front' | 'left' | 'right';

interface Wall {
  /** The wall's centre line on the floor. */
  cx: number;
  cz: number;
  /** Inward normal. */
  nx: number;
  nz: number;
  length: number;
}

const WALLS: Record<WallId, Wall> = {
  back: { cx: 0, cz: ROOM.maxZ, nx: 0, nz: -1, length: ROOM.maxX - ROOM.minX },
  front: { cx: 0, cz: ROOM.minZ, nx: 0, nz: 1, length: ROOM.maxX - ROOM.minX },
  left: { cx: ROOM.minX, cz: 0, nx: 1, nz: 0, length: ROOM.maxZ - ROOM.minZ },
  right: { cx: ROOM.maxX, cz: 0, nx: -1, nz: 0, length: ROOM.maxZ - ROOM.minZ },
};

/** `panel`'s rotY for a face looking along (nx, nz). */
const faceRot = (nx: number, nz: number): number => Math.atan2(nx, nz);

/** The point `u` along wall `w` (positive = right, for someone facing it) and `out` in front of it. */
function onWall(w: Wall, u: number, out: number): { x: number; z: number } {
  // Right of a viewer facing the wall (looking along -n) is (nz, -nx).
  return { x: w.cx + w.nz * u + w.nx * out, z: w.cz - w.nx * u + w.nz * out };
}

/** A box standing against wall `w`: `along` wide on the wall, `deep` out from it, from y0 to y1. */
function wallBox(mb: MeshBuilder, w: Wall, u: number, out: number, along: number, deep: number, y0: number, y1: number): void {
  const p = onWall(w, u, out + deep / 2);
  const alongX = w.nx === 0;
  mb.box(p.x, (y0 + y1) / 2, p.z, alongX ? along : deep, y1 - y0, alongX ? deep : along, { bottom: y0 > 0.01 });
}

/** A flat panel on wall `w`, facing into the room. */
function wallPanel(mb: MeshBuilder, w: Wall, u: number, out: number, y: number, width: number, height: number, uv?: SignCell): void {
  const p = onWall(w, u, out);
  if (uv) mb.panel(p.x, y, p.z, width, height, faceRot(w.nx, w.nz), uv.u0, uv.v0, uv.u1, uv.v1);
  else mb.panel(p.x, y, p.z, width, height, faceRot(w.nx, w.nz));
}

/* ------------------------------------------------------------------ solids */

/**
 * A tyre (and the rim in it), low poly: `seg` sides, axis along `axis`. Tread, both sidewalls, a
 * grey rim face each side set back into it.
 */
function tyre(mb: MeshBuilder, cx: number, cy: number, cz: number, axis: 'x' | 'y' | 'z', R: number, width: number, seg = 12, rimColor: number = C.rimGrey): void {
  const r = R * 0.62;
  const hw = width / 2;
  // Basis: a along the axis, u and v across it.
  const ax = axis === 'x' ? 1 : 0;
  const ay = axis === 'y' ? 1 : 0;
  const az = axis === 'z' ? 1 : 0;
  const ux = axis === 'x' ? 0 : 1;
  const uy = 0;
  const uz = axis === 'x' ? 1 : 0;
  // v = a × u
  const vx = ay * uz - az * uy;
  const vy = az * ux - ax * uz;
  const vz = ax * uy - ay * ux;
  const P = (ang: number, rad: number, s: number): [number, number, number] => {
    const c = Math.cos(ang) * rad;
    const n = Math.sin(ang) * rad;
    return [cx + ux * c + vx * n + ax * s, cy + uy * c + vy * n + ay * s, cz + uz * c + vz * n + az * s];
  };
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2;
    const a1 = ((i + 1) / seg) * Math.PI * 2;
    // Tread, facing out.
    mb.color(C.tyre, 1);
    const t0 = P(a0, R, -hw);
    const t1 = P(a1, R, -hw);
    const t2 = P(a1, R, hw);
    const t3 = P(a0, R, hw);
    mb.quad(...t0, ...t3, ...t2, ...t1);
    // Sidewalls, +a side and -a side.
    mb.color(C.tyreSide, 1);
    const s0 = P(a0, r, hw);
    const s1 = P(a1, r, hw);
    mb.quad(...s0, ...s1, ...t2, ...t3);
    const q0 = P(a0, r, -hw);
    const q1 = P(a1, r, -hw);
    mb.quad(...q1, ...q0, ...t0, ...t1);
    // Rim faces, set back a little into the tyre.
    mb.color(rimColor, 1);
    const hub = P(0, 0, hw * 0.55);
    const m0 = P(a0, r, hw * 0.55);
    const m1 = P(a1, r, hw * 0.55);
    mb.quad(...hub, ...m0, ...m1, ...m1);
    const hub2 = P(0, 0, -hw * 0.55);
    const n0 = P(a0, r, -hw * 0.55);
    const n1 = P(a1, r, -hw * 0.55);
    mb.quad(...hub2, ...n1, ...n0, ...n0);
  }
}

/** A roll cab: a red body, drawer fronts and chrome handles, on the floor against the back wall. */
function rollCab(mb: MeshBuilder, x: number, z: number, w: number, h: number, d: number, y0 = 0, drawers = 5): void {
  mb.color(C.chestRed, 1);
  mb.chamfer(0.02);
  mb.box(x, y0 + h / 2 + 0.06, z, w, h - 0.12, d, { bottom: true });
  mb.chamfer(0);
  // Castors, and a dark plinth.
  mb.color(C.darkSteel, 1);
  mb.box(x, y0 + 0.03, z, w - 0.1, 0.06, d - 0.1);
  // Drawer seams and handles on the front (-Z face, toward the room).
  const front = z - d / 2 - 0.005;
  for (let k = 0; k < drawers; k++) {
    const yy = y0 + 0.16 + ((h - 0.24) / drawers) * (k + 0.5);
    const dh = (h - 0.24) / drawers;
    mb.color(C.chestDark, 1);
    mb.box(x, yy + dh / 2 - 0.01, front, w - 0.08, 0.018, 0.012);
    mb.color(C.chrome, 1.1);
    mb.box(x, yy + dh * 0.22, front - 0.012, w * 0.7, 0.03, 0.025);
  }
}

/** One hanging work lamp: cable to the ceiling, a green enamel shade, a hot bulb and a shaft of light. */
function hangingLamp(lit: MeshBuilder, lamps: MeshBuilder, beams: BeamBuilder, x: number, y: number, z: number, beamTo: number): void {
  const seg = 10;
  const top = y + 0.32;
  const rT = 0.1;
  const rB = 0.42;
  lit.color(0x0c0c0e, 1);
  lit.box(x, (top + ROOM.height) / 2, z, 0.02, ROOM.height - top, 0.02);
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2;
    const a1 = ((i + 1) / seg) * Math.PI * 2;
    const c0 = Math.cos(a0);
    const s0 = Math.sin(a0);
    const c1 = Math.cos(a1);
    const s1 = Math.sin(a1);
    // Outside, dark enamel.
    lit.color(C.shade, 1);
    lit.quad(x + c0 * rB, y, z + s0 * rB, x + c0 * rT, top, z + s0 * rT, x + c1 * rT, top, z + s1 * rT, x + c1 * rB, y, z + s1 * rB);
    // Inside, lit hot.
    lamps.color(C.lamp, 1.1);
    lamps.quad(x + c1 * rB * 0.98, y + 0.005, z + s1 * rB * 0.98, x + c1 * rT, top - 0.01, z + s1 * rT, x + c0 * rT, top - 0.01, z + s0 * rT, x + c0 * rB * 0.98, y + 0.005, z + s0 * rB * 0.98);
  }
  // The bulb, a small bright box.
  lamps.color(0xfff1d6, 2.2);
  lamps.box(x, y + 0.12, z, 0.14, 0.14, 0.14, { bottom: true });
  beams.cone(x, y, z, rB * 0.9, beamTo, 1.7, 0.035, 0.026, 0.014);
}

/** A wall lamp on a pillar: a small cone shade throwing light up and down the wall, NFSU2's bulkhead. */
function pillarLamp(lit: MeshBuilder, lamps: MeshBuilder, glow: MeshBuilder, w: Wall, u: number, y: number): void {
  const p = onWall(w, u, 0.62);
  lit.color(C.shade, 1);
  lit.box(p.x, y, p.z, 0.34, 0.26, 0.34, { bottom: true });
  const q = onWall(w, u, 0.2);
  lit.color(C.darkSteel, 1);
  lit.box((p.x + q.x) / 2, y + 0.05, (p.z + q.z) / 2, w.nx === 0 ? 0.05 : 0.42, 0.05, w.nx === 0 ? 0.42 : 0.05);
  lamps.color(C.lamp, 1.6);
  lamps.planeY(p.x, y - 0.135, p.z, 0.28, 0.28);
  lamps.box(p.x, y + 0.14, p.z, 0.26, 0.02, 0.26);
  // The warm splash on the pillar above and below it, and a halo round the lamp.
  const r = faceRot(w.nx, w.nz);
  const s = onWall(w, u, 0.43);
  glow.color(C.lamp, 0.55);
  glow.panel(s.x, y + 0.5, s.z, 1.6, 2.2, r);
  glow.color(C.lamp, 0.35);
  glow.panel(s.x, y - 0.9, s.z, 1.4, 2.4, r);
  const h = onWall(w, u, 0.9);
  glow.color(C.lamp, 0.8);
  glow.panel(h.x, y - 0.05, h.z, 1.1, 1.1, r);
}

/* ------------------------------------------------------------------ beams (vertex-graded) */

/** Open cones with colour graded from the top to black at the bottom: additive light shafts. */
class BeamBuilder {
  readonly positions: number[] = [];
  readonly colors: number[] = [];
  cone(x: number, y: number, z: number, rTop: number, yBottom: number, rBottom: number, r: number, g: number, b: number): void {
    const seg = 14;
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2;
      const a1 = ((i + 1) / seg) * Math.PI * 2;
      const p = [
        [x + Math.cos(a0) * rTop, y, z + Math.sin(a0) * rTop, r, g, b],
        [x + Math.cos(a1) * rTop, y, z + Math.sin(a1) * rTop, r, g, b],
        [x + Math.cos(a1) * rBottom, yBottom, z + Math.sin(a1) * rBottom, 0, 0, 0],
        [x + Math.cos(a0) * rBottom, yBottom, z + Math.sin(a0) * rBottom, 0, 0, 0],
      ];
      for (const k of [0, 1, 2, 0, 2, 3]) {
        this.positions.push(p[k][0], p[k][1], p[k][2]);
        this.colors.push(p[k][3], p[k][4], p[k][5]);
      }
    }
  }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    g.computeBoundingSphere();
    return g;
  }
}

/* ------------------------------------------------------------------ the room */

export function buildRoom(cells: Record<SignId, SignCell>, shopName: string): RoomGeometry {
  const lit = new MeshBuilder(true);
  const neon = new MeshBuilder(true);
  const lamps = new MeshBuilder(true);
  const neonGlow = new MeshBuilder(true);
  const lampGlow = new MeshBuilder(true);
  const signs = new MeshBuilder(false);
  const beams = new BeamBuilder();
  const rng = makeRng(0x99);

  shell(lit, neon, neonGlow, rng);
  pillars(lit, lamps, lampGlow);
  const lampsOverTable = ceilingLamps(lit, lamps, beams);
  backWall(lit, neon, neonGlow, signs, cells, shopName);
  leftWall(lit, signs, cells, rng);
  rightWall(lit, neon, neonGlow, signs, cells, rng);
  frontWall(lit, lamps, signs, cells, rng);
  floorDressing(lit, neon, neonGlow);

  return {
    lit: lit.build(),
    neon: neon.build(),
    lamps: lamps.build(),
    neonGlow: neonGlow.build(),
    lampGlow: lampGlow.build(),
    beams: beams.build(),
    signs: signs.build(),
    rim: turntableRim(),
    lampsOverTable,
    figure: { x: -3.5, z: 8.3, rotY: Math.atan2(-3.5, 8.3) },
  };
}

/** Walls in three bands, the ceiling with its beams, cyan strips round the top. */
function shell(lit: MeshBuilder, neon: MeshBuilder, glow: MeshBuilder, rng: () => number): void {
  const H = ROOM.height;
  for (const id of Object.keys(WALLS) as WallId[]) {
    const w = WALLS[id];
    const L = w.length;
    // Wainscot, rail, whitewash, and the grimy band under the ceiling.
    lit.color(C.wainscot, 0.5);
    wallPanel(lit, w, 0, 0, 0.6, L, 1.2);
    lit.color(C.rail, 1);
    wallBox(lit, w, 0, 0, L, 0.05, 1.18, 1.3);
    lit.color(C.whitewash, 0.36);
    wallPanel(lit, w, 0, 0, (1.3 + H - 0.6) / 2, L, H - 0.6 - 1.3);
    lit.color(C.grime, 0.45);
    wallPanel(lit, w, 0, 0, H - 0.3, L, 0.6);
    // Stains running down from the top, and scuffs along the wainscot.
    for (let k = 0; k < 9; k++) {
      const u = (rng() - 0.5) * (L - 1);
      const len = 0.8 + rng() * 2.2;
      lit.color(C.whitewash, 0.24 + rng() * 0.06);
      wallPanel(lit, w, u, 0.004, H - 0.6 - len / 2, 0.2 + rng() * 0.5, len);
    }
    // A skirting board.
    lit.color(0x101113, 1);
    wallBox(lit, w, 0, 0, L, 0.03, 0, 0.12);
    // The cyan strip round the top of the walls, and its wash on the wall below.
    const s = onWall(w, 0, 0.06);
    const alongX = w.nx === 0;
    neon.color(C.cyan, 1.6);
    neon.tube(alongX ? -L / 2 : s.x, H - 0.66, alongX ? s.z : -L / 2, alongX ? L / 2 : s.x, H - 0.66, alongX ? s.z : L / 2, 0.035);
    glow.color(C.cyan, 0.3);
    wallPanel(glow, w, 0, 0.03, H - 0.66, L, 0.7);
  }
  // Ceiling, facing down.
  lit.color(C.ceiling, 1);
  lit.quad(ROOM.minX, H, ROOM.minZ, ROOM.maxX, H, ROOM.minZ, ROOM.maxX, H, ROOM.maxZ, ROOM.minX, H, ROOM.maxZ);
  // Steel beams across it, and a cyan strip under two of them.
  for (let z = ROOM.minZ + 1.75; z < ROOM.maxZ; z += 3.5) {
    lit.color(C.beam, 1);
    lit.box(0, H - 0.2, z, ROOM.maxX - ROOM.minX, 0.4, 0.28, { bottom: true });
  }
  for (const x of [-6.2, 6.2]) {
    lit.color(C.beam, 1);
    lit.box(x, H - 0.46, 0, 0.26, 0.12, ROOM.maxZ - ROOM.minZ, { bottom: true });
    neon.color(C.cyan, 1.3);
    neon.tube(x, H - 0.53, ROOM.minZ + 0.5, x, H - 0.53, ROOM.maxZ - 0.5, 0.03);
  }
}

/** Concrete pillars along the walls, each with a lamp at head height. */
function pillars(lit: MeshBuilder, lamps: MeshBuilder, glow: MeshBuilder): void {
  const at: Array<[WallId, number]> = [
    ['back', -5.4],
    ['back', 5.4],
    ['front', -5.4],
    ['front', 5.4],
    ['left', -5.5],
    ['left', 5.5],
    ['right', -5.5],
    ['right', 5.5],
  ];
  for (const [id, u] of at) {
    const w = WALLS[id];
    lit.color(C.pillar, 0.5);
    lit.soft(0.05);
    wallBox(lit, w, u, 0, 0.7, 0.42, 0, ROOM.height);
    lit.soft(0);
    lit.color(C.wainscot, 0.7);
    wallBox(lit, w, u, 0, 0.74, 0.44, 0, 1.2);
    pillarLamp(lit, lamps, glow, w, u, 3.3);
  }
}

/** Four work lamps hanging over the table, a fifth and sixth over the cabs and the rack. */
function ceilingLamps(lit: MeshBuilder, lamps: MeshBuilder, beams: BeamBuilder): LampSpot[] {
  const over: LampSpot[] = [
    { x: -2.9, y: 4.05, z: -2.7 },
    { x: 2.9, y: 4.05, z: -2.7 },
    { x: -2.9, y: 4.05, z: 2.9 },
    { x: 2.9, y: 4.05, z: 2.9 },
  ];
  for (const l of over) hangingLamp(lit, lamps, beams, l.x, l.y, l.z, 1.1);
  hangingLamp(lit, lamps, beams, 0, 3.7, 8.6, 1.3);
  hangingLamp(lit, lamps, beams, -7.6, 3.7, -3.6, 0.9);
  hangingLamp(lit, lamps, beams, 7.4, 3.7, 3.4, 0.9);
  return over;
}

/** The back wall: roll cabs under his name in red neon, the bench and pegboard, tyres, signs. */
function backWall(lit: MeshBuilder, neon: MeshBuilder, glow: MeshBuilder, signs: MeshBuilder, cells: Record<SignId, SignCell>, shopName: string): void {
  const w = WALLS.back;
  const z = ROOM.maxZ;
  // Two roll cabs side by side, a top box on them.
  // Everything on this wall sits a little toward -X, so a three-quarter front shot (camera off
  // the car's right front corner, looking back-left) has the whole name in frame.
  const cx = -CABS_SHIFT;
  const nx = -NAME_SHIFT;
  rollCab(lit, cx - 0.78, z - 0.34, 1.5, 1.0, 0.62, 0, 5);
  rollCab(lit, cx + 0.78, z - 0.34, 1.5, 1.0, 0.62, 0, 5);
  rollCab(lit, cx + 0.78, z - 0.3, 1.4, 0.52, 0.5, 1.0, 3);
  // A few tools on top of the left one.
  lit.color(C.steel, 1);
  lit.box(cx - 1.1, 1.04, z - 0.4, 0.5, 0.06, 0.14);
  lit.color(0xffd400, 0.9);
  lit.box(cx - 0.6, 1.08, z - 0.35, 0.22, 0.14, 0.16);

  // The name, in the red of the 99, on a dark board.
  const name = shopName.toUpperCase();
  lit.color(0x0e0f11, 1);
  wallBox(lit, w, NAME_SHIFT, 0, 7.2, 0.08, 2.75, 3.95);
  neonText(neon, name, nx, 3.05, z - 0.14, 0, -1, 0.66, C.neonRed, 1.25);
  glow.color(C.neonRed, 0.45);
  wallPanel(glow, w, NAME_SHIFT, 0.1, 3.35, 8.5, 2.2);
  glow.color(C.neonRed, 0.25);
  glow.planeY(nx, 0.012, z - 1.6, 8, 3.2);

  // The workbench, a pegboard of tools over it, a vise.
  const benchU = 3.8; // right of the viewer = -X
  lit.color(C.bench, 0.9);
  wallBox(lit, w, benchU, 0, 2.6, 0.75, 0.86, 0.94);
  lit.color(C.darkSteel, 1);
  for (const du of [-1.2, 1.2]) wallBox(lit, w, benchU + du, 0.05, 0.08, 0.6, 0, 0.86);
  wallBox(lit, w, benchU, 0.1, 2.4, 0.5, 0.18, 0.22);
  lit.color(C.pegboard, 0.8);
  wallPanel(lit, w, benchU, 0.02, 1.75, 2.4, 1.3);
  lit.color(C.steel, 1.1);
  for (let k = 0; k < 9; k++) {
    const p = onWall(w, benchU - 1 + (k % 5) * 0.5, 0.06);
    lit.box(p.x, 1.45 + Math.floor(k / 5) * 0.55 + (k % 2) * 0.08, p.z, 0.05, 0.36 - (k % 3) * 0.07, 0.03);
  }
  const vise = onWall(w, benchU - 0.9, 0.3);
  lit.color(0x3a4a8a, 1);
  lit.box(vise.x, 1.02, vise.z, 0.22, 0.16, 0.18);
  // Oil drum at the end of the bench.
  lit.color(0x1f4fff, 0.6);
  const drum = onWall(w, benchU + 1.9, 0.45);
  tyreLikeDrum(lit, drum.x, drum.z);

  // Tyre stacks the other side of the cabs.
  for (const [u, n] of [
    [-3.2, 5],
    [-3.95, 4],
    [-4.35, 3],
  ] as Array<[number, number]>) {
    const p = onWall(w, u, 0.55);
    for (let k = 0; k < n; k++) tyre(lit, p.x, 0.12 + k * 0.235, p.z, 'y', 0.33, 0.23, 12);
  }

  // Signs: tyres, a price tag on the stack, the banner on a pillar, the calendar by the bench.
  const sign = (id: SignId, u: number, y: number, h: number, out = 0.03): void => wallPanel(signs, w, u, out, y, h * cells[id].aspect, h, cells[id]);
  sign('kazeTires', -3.8, 2.35, 0.62);
  sign('sale', -3.2, 1.55, 0.3, 0.9);
  sign('calendar', 2.0, 1.9, 0.62);
  sign('banner', 5.4, 2.4, 1.4, 0.45);
  sign('banner', -5.4, 2.4, 1.4, 0.45);
  sign('screen', -2.05, 1.75, 0.5, 0.04);
}

function tyreLikeDrum(mb: MeshBuilder, x: number, z: number): void {
  const seg = 12;
  const r = 0.29;
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2;
    const a1 = ((i + 1) / seg) * Math.PI * 2;
    mb.quad(x + Math.cos(a0) * r, 0, z + Math.sin(a0) * r, x + Math.cos(a0) * r, 0.88, z + Math.sin(a0) * r, x + Math.cos(a1) * r, 0.88, z + Math.sin(a1) * r, x + Math.cos(a1) * r, 0, z + Math.sin(a1) * r);
    mb.quad(x, 0.88, z, x + Math.cos(a1) * r, 0.88, z + Math.sin(a1) * r, x + Math.cos(a0) * r, 0.88, z + Math.sin(a0) * r, x + Math.cos(a0) * r, 0.88, z + Math.sin(a0) * r);
  }
}

/** The left wall (-X): a tyre rack, wheels on display, the wheel brand's sign. */
function leftWall(lit: MeshBuilder, signs: MeshBuilder, cells: Record<SignId, SignCell>, rng: () => number): void {
  const w = WALLS.left;
  // The rack: steel uprights and two shelves, tyres standing on their treads side by side.
  const u0 = -1.2;
  const u1 = 4.2;
  lit.color(0x8a2a1c, 0.9);
  for (let u = u0; u <= u1 + 0.01; u += (u1 - u0) / 3) wallBox(lit, w, u, 0.05, 0.08, 0.9, 0, 2.7);
  for (const y of [0.3, 1.45]) {
    lit.color(C.darkSteel, 1);
    wallBox(lit, w, (u0 + u1) / 2, 0.05, u1 - u0, 0.9, y - 0.05, y);
    for (let u = u0 + 0.2; u < u1 - 0.1; u += 0.27) {
      const p = onWall(w, u, 0.5);
      tyre(lit, p.x, y + 0.34, p.z, 'z', 0.34, 0.24, 12, rng() < 0.3 ? C.chrome : C.rimGrey);
    }
  }
  const sign = (id: SignId, u: number, y: number, h: number, out = 0.03): void => wallPanel(signs, w, u, out, y, h * cells[id].aspect, h, cells[id]);
  sign('sale', 0.6, 2.55, 0.34, 1.0);
  sign('oferta', 3.0, 2.55, 0.34, 1.0);
  sign('hikariWheels', -3.4, 3.0, 0.7);

  // Wheels on display: a board of rims on the wall.
  lit.color(0x0e0f11, 1);
  wallPanel(lit, w, -3.4, 0.02, 1.75, 2.6, 1.7);
  for (let k = 0; k < 6; k++) {
    const u = -4.2 + (k % 3) * 0.8;
    const y = 1.35 + Math.floor(k / 3) * 0.78;
    const p = onWall(w, u, 0.1);
    tyre(lit, p.x, y, p.z, 'x', 0.3, 0.12, 12, k % 2 ? C.chrome : 0xffd400);
  }
  // A stack in the corner.
  const c = onWall(w, -8.8, 0.6);
  for (let k = 0; k < 6; k++) tyre(lit, c.x, 0.12 + k * 0.235, c.z, 'y', 0.33, 0.23, 12);
}

/** The right wall (+X): shelves of oil, the cashier's counter, posters, a screen. */
function rightWall(lit: MeshBuilder, neon: MeshBuilder, glow: MeshBuilder, signs: MeshBuilder, cells: Record<SignId, SignCell>, rng: () => number): void {
  const w = WALLS.right;
  // Shelving: three shelves of cans and boxes.
  const u0 = -4.2;
  const u1 = -0.6;
  lit.color(C.darkSteel, 1);
  for (const u of [u0, u1]) wallBox(lit, w, u, 0.05, 0.06, 0.5, 0, 2.3);
  const colours = [0xffd400, 0xd11a2a, 0x1f4fff, 0x1fbf5b, 0xe9ecf2, 0xff6a13];
  for (const y of [0.35, 1.05, 1.75]) {
    lit.color(C.darkSteel, 1);
    wallBox(lit, w, (u0 + u1) / 2, 0.05, u1 - u0, 0.5, y - 0.04, y);
    for (let u = u0 + 0.2; u < u1 - 0.1; u += 0.2 + rng() * 0.1) {
      const tall = 0.2 + rng() * 0.18;
      lit.color(colours[Math.floor(rng() * colours.length)], 0.85);
      const p = onWall(w, u, 0.3);
      lit.box(p.x, y + tall / 2, p.z, 0.2, tall, 0.14);
    }
  }
  const sign = (id: SignId, u: number, y: number, h: number, out = 0.03): void => wallPanel(signs, w, u, out, y, h * cells[id].aspect, h, cells[id]);
  sign('rayoOil', (u0 + u1) / 2, 2.85, 0.62);
  // Posters beyond the pillar.
  sign('posterTouge', 1.4, 2.2, 1.35);
  sign('posterNeko', 2.55, 2.2, 1.35);
  sign('noFumar', 2.0, 1.25, 0.26);
  // The cashier: a counter, a till, the sign over it, a dyno screen glowing.
  const cu = -8.2;
  lit.color(0x2a2c30, 1);
  wallBox(lit, w, cu, 0, 2.4, 0.7, 0, 1.05);
  lit.color(C.chestRed, 0.8);
  wallBox(lit, w, cu, 0.7, 2.4, 0.02, 0.2, 0.95);
  lit.color(0x1b1c20, 1);
  const till = onWall(w, cu + 0.5, 0.35);
  lit.box(till.x, 1.14, till.z, 0.3, 0.18, 0.34);
  sign('caja', cu, 2.35, 0.36);
  sign('screen', cu - 0.2, 1.65, 0.62, 0.03);
  const scr = onWall(w, cu - 0.2, 0.06);
  glow.color(C.cyan, 0.3);
  glow.panel(scr.x, 1.65, scr.z, 1.7, 1.2, faceRot(w.nx, w.nz));
  // A magenta tube over the posters.
  const a = onWall(w, 0.8, 0.08);
  const b = onWall(w, 3.2, 0.08);
  neon.color(C.magenta, 1.6);
  neon.tube(a.x, 3.15, a.z, b.x, 3.15, b.z, 0.035);
  glow.color(C.magenta, 0.35);
  wallPanel(glow, w, 2.0, 0.05, 3.1, 3.4, 1.1);
  // Tyre stacks in the corner.
  for (const [u, n] of [
    [8.6, 5],
    [7.9, 3],
  ] as Array<[number, number]>) {
    const p = onWall(w, u, 0.55);
    for (let k = 0; k < n; k++) tyre(lit, p.x, 0.12 + k * 0.235, p.z, 'y', 0.33, 0.23, 12);
  }
}

/** The front wall (-Z): the turquoise roller door, and his Daewoo van parked beside it. */
function frontWall(lit: MeshBuilder, lamps: MeshBuilder, signs: MeshBuilder, cells: Record<SignId, SignCell>, rng: () => number): void {
  const w = WALLS.front;
  // The door: a frame, slats, a handle bar.
  lit.color(0x1d1f22, 1);
  wallPanel(lit, w, 0, 0.01, 2.1, 6.4, 4.2);
  for (let y = 0.1; y < 3.95; y += 0.2) {
    lit.color(C.turquoise, 0.62 + rng() * 0.08);
    wallBox(lit, w, 0, 0.02, 6.0, 0.05, y, y + 0.17);
  }
  lit.color(C.darkSteel, 1);
  wallBox(lit, w, 0, 0.02, 6.4, 0.3, 3.95, 4.25);
  lit.color(C.chrome, 0.8);
  wallBox(lit, w, 0, 0.07, 0.8, 0.05, 0.9, 0.95);
  const sign = (id: SignId, u: number, y: number, h: number, out = 0.03): void => wallPanel(signs, w, u, out, y, h * cells[id].aspect, h, cells[id]);
  sign('noFumar', -4.2, 2.1, 0.3);
  sign('posterNeko', 3.9, 2.2, 1.2);

  // The van: a white Daewoo one-box, nose toward the room, parked in the corner.
  const vx = 7.0;
  const vz = -7.6;
  const L = 3.5;
  const W = 1.42;
  const Hh = 1.9;
  const clear = 0.3;
  lit.color(0x0d0e10, 1);
  for (const dx of [-W / 2 + 0.12, W / 2 - 0.12]) {
    for (const dz of [-L / 2 + 0.55, L / 2 - 0.5]) tyre(lit, vx + dx, 0.28, vz + dz, 'x', 0.28, 0.18, 10, 0x5c616a);
  }
  lit.color(C.van, 0.55);
  lit.chamfer(0.05);
  lit.box(vx, clear + (Hh - clear) / 2, vz - 0.12, W, Hh - clear, L - 0.24, { bottom: true });
  // Nose: a short sloped front below the windscreen.
  lit.box(vx, clear + 0.45, vz + L / 2 - 0.2, W - 0.02, 0.9, 0.4, { bottom: true });
  lit.chamfer(0);
  // Windscreen and side glass, dark.
  lit.color(C.glassDark, 1);
  lit.quad(vx - W / 2 + 0.08, 1.25, vz + L / 2 - 0.36, vx + W / 2 - 0.08, 1.25, vz + L / 2 - 0.36, vx + W / 2 - 0.1, 1.78, vz + L / 2 - 0.62, vx - W / 2 + 0.1, 1.78, vz + L / 2 - 0.62);
  for (const s of [-1, 1]) {
    const x = vx + s * (W / 2 + 0.005);
    if (s > 0) lit.quad(x, 1.2, vz + L / 2 - 0.7, x, 1.2, vz - L / 2 + 0.4, x, 1.72, vz - L / 2 + 0.4, x, 1.72, vz + L / 2 - 0.7);
    else lit.quad(x, 1.2, vz - L / 2 + 0.4, x, 1.2, vz + L / 2 - 0.7, x, 1.72, vz + L / 2 - 0.7, x, 1.72, vz - L / 2 + 0.4);
  }
  // Bumper, grille, lamps.
  lit.color(0x1d1f22, 1);
  lit.box(vx, 0.42, vz + L / 2 + 0.02, W + 0.04, 0.2, 0.12);
  lit.box(vx, 0.78, vz + L / 2 + 0.01, 0.7, 0.14, 0.04);
  lamps.color(0xf4efe0, 0.5);
  for (const s of [-1, 1]) lamps.box(vx + s * (W / 2 - 0.2), 0.8, vz + L / 2 + 0.02, 0.24, 0.14, 0.04);
  // A red 99 on the door, his number.
  lit.color(0xd8262a, 1);
  lit.box(vx - W / 2 - 0.01, 1.0, vz - 0.1, 0.02, 0.3, 0.5);
}

/** A painted hazard ring round the table, and the cyan LED line at the foot of its bevel. */
function floorDressing(lit: MeshBuilder, neon: MeshBuilder, glow: MeshBuilder): void {
  const seg = 72;
  const r0 = 4.3;
  const r1 = 4.42;
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2;
    const a1 = ((i + 1) / seg) * Math.PI * 2;
    lit.color(i % 6 < 3 ? C.hazard : 0x111111, 0.55);
    lit.quad(Math.cos(a0) * r0, 0.006, Math.sin(a0) * r0, Math.cos(a0) * r1, 0.006, Math.sin(a0) * r1, Math.cos(a1) * r1, 0.006, Math.sin(a1) * r1, Math.cos(a1) * r0, 0.006, Math.sin(a1) * r0);
    // Wind the other way too: the ring's quads face +Y whichever way `quad` takes it.
    const R = TABLE.foot + 0.05;
    neon.color(C.cyan, 1.8);
    neon.tube(Math.cos(a0) * R, 0.02, Math.sin(a0) * R, Math.cos(a1) * R, 0.02, Math.sin(a1) * R, 0.03);
    // The glow the LED throws on the floor, as tangent strips.
    const gx = Math.cos((a0 + a1) / 2) * (R + 0.15);
    const gz = Math.sin((a0 + a1) / 2) * (R + 0.15);
    if (i % 2 === 0) {
      glow.color(C.cyan, 0.3);
      const t = (a0 + a1) / 2;
      // A tangent-aligned quad on the floor: along (−sin t, cos t), across (cos t, sin t).
      const hl = ((Math.PI * 2 * R) / seg) * 1.6;
      const hw = 0.5;
      const tx = -Math.sin(t);
      const tz = Math.cos(t);
      const nx = Math.cos(t);
      const nz = Math.sin(t);
      glow.quad(gx - tx * hl - nx * hw, 0.01, gz - tz * hl - nz * hw, gx - tx * hl + nx * hw, 0.01, gz - tz * hl + nz * hw, gx + tx * hl + nx * hw, 0.01, gz + tz * hl + nz * hw, gx + tx * hl - nx * hw, 0.01, gz + tz * hl - nz * hw);
    }
  }
}

/** The bevelled rim round the plate: a lathe from the floor up to the plate's edge. */
function turntableRim(): THREE.BufferGeometry {
  const pts = [
    new THREE.Vector2(TABLE.foot, 0),
    new THREE.Vector2(TABLE.foot, 0.025),
    new THREE.Vector2(TABLE.foot - 0.1, 0.1),
    new THREE.Vector2(TABLE.radius + 0.06, TABLE.top + 0.004),
    new THREE.Vector2(TABLE.radius - 0.01, TABLE.top + 0.004),
  ];
  // Lathe winds its faces for a profile running outward-in when seen from above; reversed here
  // so the bevel faces up and out.
  const g = new THREE.LatheGeometry(pts.reverse(), 72);
  g.computeVertexNormals();
  return g;
}
