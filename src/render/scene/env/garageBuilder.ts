import { PAL } from './palette';
import { makeRng, type MeshBuilder } from './meshBuilder';
import { groundGlow, halo, type EnvBuilders } from './builders';
import { ROAD_TILE } from './cityBuilder';
import { graffitiCell, grimeSurface, paintSurface } from './graffiti';
import { neonText } from './gasStationBuilder';
import { weeds } from './plants';
import type { GraffitiSurface, ReclaimProfile } from './reclaim';
import { frameAt, frameBox, type GasBox } from '../../../world/gasStation';
import { GARAGE, garageFacing, garageParts, type GarageParts, type GarageSpec } from '../../../world/garage';

/**
 * LOCO MUSTANG'S GARAGE, drawn (`world/garage.ts`). Into the city's own batches, like the gas
 * stations: the garage costs triangles, never a draw call.
 *
 * THE LOOK is Juan's photographs: a single-storey block, whitewashed a long time ago and stained
 * down from the parapet; a moulded ledge across the front at door-head height; the garage mouth
 * open and dark with a strip light in its ceiling and a white van backed in; a turquoise steel
 * door either side, tagged all over, each with a small rusted louvre let into it; a house number
 * and a meter box on the piers; a pile of sand bags against the wall. The city is at night, so it
 * also gets what the photographs did not need: a bulkhead lamp over the mouth throwing a warm
 * pool on the apron, and the name in neon on the parapet so it can be found from the boulevard.
 */

/** Paint everywhere a writer could reach. */
const BOMBED: ReclaimProfile = {
  intensity: 0.8,
  level: 2,
  vegetation: 0,
  weeds: 0,
  vines: 0,
  graffiti: 1,
  graffitiScale: 1,
  decay: 0.9,
  planter: 0,
  bigTree: false,
  grafWall: true,
};

const Y = { slab: 0.006, joint: 0.02, stain: 0.045, glow: 0.055 } as const;

const WHITEWASH = 0xf1eee2;
const TURQUOISE = 0x49a6b3;
const RUST = 0x7a4a2a;
const LAMP = 0xffc98a;
/** The name's colour: the red of the 99 on his shirt. */
const SIGN_RED = 0xff3b2e;

export function buildGarage(b: EnvBuilders): void {
  const s = b.plan.garage;
  if (!s) return;
  const p = garageParts(s);
  const rng = makeRng(seedOf(s.tag));
  apron(b, s, p, rng);
  shell(b, s, p, rng);
  mouth(b, p);
  van(b, p);
  doors(b, s, p, rng);
  sign(b, p);
}

/* ------------------------------------------------------------------ helpers */

function seedOf(tag: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < tag.length; i++) h = Math.imul(h ^ tag.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** Facing of a vertical panel as `MeshBuilder.panel` takes it: rotY 0 faces +Z. */
const faceRot = (nx: number, nz: number): number => Math.atan2(nx, nz);

function boxOf(mb: MeshBuilder, g: GasBox, bottom = false): void {
  mb.box((g.minX + g.maxX) / 2, (g.y0 + g.y1) / 2, (g.minZ + g.maxZ) / 2, g.maxX - g.minX, g.y1 - g.y0, g.maxZ - g.minZ, { bottom });
}

function surface(x: number, y: number, z: number, nx: number, nz: number, width: number, height: number): GraffitiSurface {
  return { x, y, z, nx, nz, tx: nz, tz: -nx, width, height, out: 0.03 };
}

/** Frame helpers for one garage: a box, and a panel on the front face, by (u, v). */
function frameTools(p: GarageParts) {
  const f = p.frame;
  const out = garageFacing(f);
  const rot = faceRot(out.x, out.z);
  return {
    f,
    out,
    rot,
    box: (mb: MeshBuilder, u: number, v: number, lu: number, lv: number, y0: number, y1: number, bottom = false): void =>
      boxOf(mb, frameBox(f, u, v, lu, lv, y0, y1), bottom),
    /** A panel on a face at depth `v`, facing the street, `proud` in front of it. */
    front: (mb: MeshBuilder, u: number, v: number, y: number, w: number, h: number, proud = 0.02): void => {
      const at = frameAt(f, u, v - proud);
      mb.panel(at.x, y, at.z, w, h, rot);
    },
  };
}

/* ------------------------------------------------------------------ the apron */

function apron(b: EnvBuilders, s: GarageSpec, p: GarageParts, rng: () => number): void {
  const l = s.lot;
  const a = p.apron;
  const w = l.maxX - l.minX;
  const d = l.maxZ - l.minZ;
  // Old concrete over the whole lot, greyer than a station's and cracked.
  b.road.color(0xc9c6bd, 0.95);
  b.road.planeY((l.minX + l.maxX) / 2, Y.slab, (l.minZ + l.maxZ) / 2, w, d, l.minX / ROAD_TILE, l.maxZ / ROAD_TILE, l.maxX / ROAD_TILE, l.minZ / ROAD_TILE);
  b.lane.color(0x0b0e12, 0.7);
  for (let x = a.minX + 4; x < a.maxX - 1; x += 4) b.lane.planeY(x, Y.joint, (a.minZ + a.maxZ) / 2, 0.06, a.maxZ - a.minZ);
  // Oil where cars have stood in front of the mouth, and cracks across the rest.
  const { f } = frameTools(p);
  const stain = graffitiCell(13);
  for (let k = 0; k < 6; k++) {
    const at = frameAt(f, (rng() - 0.5) * 7, 2 + rng() * 6);
    b.decal.color(PAL.grime, 1 + rng() * 0.6);
    b.decal.planeY(at.x, Y.stain, at.z, 1.4 + rng() * 1.6, 1.4 + rng() * 1.6, stain.u0, stain.v0, stain.u1, stain.v1);
  }
  const crack = graffitiCell(14);
  for (let k = 0; k < 4; k++) {
    const at = frameAt(f, (rng() - 0.5) * (f.length - 4), 1 + rng() * 7);
    b.decal.color(PAL.grime, 0.8);
    b.decal.planeY(at.x, Y.stain + 0.002, at.z, 2.5, 2.5, crack.u0, crack.v0, crack.u1, crack.v1);
  }
}

/* ------------------------------------------------------------------ the building */

function shell(b: EnvBuilders, s: GarageSpec, p: GarageParts, rng: () => number): void {
  const t = frameTools(p);
  const { f, out } = t;
  const M = GARAGE;
  const mw = M.mouth.width / 2;
  const v0 = M.apron;
  const L = f.length;
  const u0 = -L / 2 + M.margin;
  const u1 = L / 2 - M.margin;
  const depth = f.depth - M.margin - v0;

  // The whitewashed blocks either side of the mouth and behind it, and the lintel over it.
  b.wall.color(WHITEWASH, 1);
  boxOf(b.wall, p.left);
  boxOf(b.wall, p.right);
  boxOf(b.wall, p.back);
  t.box(b.wall, 0, v0 + 0.3, M.mouth.width, 0.6, M.mouth.height, M.height, true);

  // The roof, and the parapet's lip round it, stained darker.
  b.roof.color(0x3a3a36, 1);
  t.box(b.roof, (u0 + u1) / 2, v0 + depth / 2, u1 - u0 - 0.4, depth - 0.4, M.height - 0.05, M.height + 0.02);
  b.wall.color(WHITEWASH, 0.78);
  t.box(b.wall, (u0 + u1) / 2, v0 + 0.2, u1 - u0 + 0.1, 0.45, M.height, M.height + M.parapet);
  t.box(b.wall, u0 + 0.2, v0 + depth / 2, 0.4, depth, M.height, M.height + M.parapet);
  t.box(b.wall, u1 - 0.2, v0 + depth / 2, 0.4, depth, M.height, M.height + M.parapet);
  t.box(b.wall, (u0 + u1) / 2, v0 + depth - 0.2, u1 - u0, 0.4, M.height, M.height + M.parapet);
  // A corrugated shed roof pitched up behind the parapet at the back, rusting.
  b.props.color(RUST, 0.8);
  t.box(b.props, (u0 + u1) / 2, v0 + depth * 0.72, u1 - u0 - 1.2, depth * 0.45, M.height, M.height + 1.1);
  b.props.color(0x5b3a22, 1);
  for (let u = u0 + 1; u < u1 - 1; u += 0.9) t.box(b.props, u, v0 + depth * 0.72, 0.08, depth * 0.45 + 0.05, M.height + 1.1, M.height + 1.16);

  // The ledge across the front at door-head height, and the piers either side of the mouth.
  const ledgeY = M.door.height + 0.35;
  b.wall.color(0xc7bfa8, 0.9);
  t.box(b.wall, (u0 + u1) / 2, v0 - 0.12, u1 - u0 + 0.2, 0.26, ledgeY, ledgeY + 0.22);
  for (const side of [-1, 1]) {
    t.box(b.wall, side * (mw + M.pier / 2), v0 - 0.08, M.pier, 0.18, 0, M.mouth.height + 0.2, true);
  }

  // The house number on the left pier, and the meter box under it.
  const pierU = -(mw + M.pier / 2);
  b.props.color(0x16181b, 1);
  t.front(b.props, pierU, v0 - 0.2, 2.6, 0.95, 0.38, 0.01);
  neonText(b.neon, '2022', frameAt(f, pierU, v0 - 0.23).x, 2.46, frameAt(f, pierU, v0 - 0.23).z, out.x, out.z, 0.26, 0xf4efe0, 0.55);
  b.props.color(0x8b9196, 1);
  t.box(b.props, pierU, v0 - 0.3, 0.55, 0.22, 1.55, 2.2);
  b.neon.color(0x9fd8ff, 0.35);
  t.front(b.neon, pierU, v0 - 0.42, 1.95, 0.32, 0.3, 0.005);
  // A light switch box on the other pier.
  b.props.color(0xe8e8e2, 1);
  t.box(b.props, mw + M.pier / 2, v0 - 0.22, 0.2, 0.12, 1.9, 2.25);

  // Stains down the front from the parapet, paint and grime down the street side and the back.
  // Either side of the mouth, never across it: a streak hanging in front of the dark would float.
  for (const side of [-1, 1]) {
    const run = u1 - mw - M.pier;
    const at = frameAt(f, side * (mw + M.pier + run / 2), v0 - 0.2);
    grimeSurface(b, surface(at.x, 0, at.z, out.x, out.z, run, M.height), BOMBED, seedOf(`${s.tag}:front:${side}`), 'streak');
    grimeSurface(b, surface(at.x, 0, at.z, out.x, out.z, run, M.height), BOMBED, seedOf(`${s.tag}:stain:${side}`), 'stain');
  }
  const side = frameAt(f, u1 + 0.02, v0 + depth / 2);
  paintSurface(b, surface(side.x, 0, side.z, f.ax, f.az, depth - 2, M.height - 0.8), BOMBED, seedOf(`${s.tag}:side`));
  grimeSurface(b, surface(side.x, 0, side.z, f.ax, f.az, depth, M.height), BOMBED, seedOf(`${s.tag}:side-grime`), 'streak');
  const back = frameAt(f, 0, v0 + depth + 0.02);
  paintSurface(b, surface(back.x, 0, back.z, f.dx, f.dz, u1 - u0 - 2, M.height - 0.8), BOMBED, seedOf(`${s.tag}:back`));

  // Weeds along the foot of the front, where the apron meets the wall.
  for (let u = u0 + 0.4; u < u1; u += 1.2 + rng() * 2.5) {
    if (Math.abs(u) < mw + 0.4) continue;
    const at = frameAt(f, u, v0 - 0.35);
    weeds(b, at.x, 0, at.z, rng, { scale: 0.8 + rng() * 0.5, dry: 0.4, room: 0.3 });
  }
  // Sand bags against the wall by the right-hand door, the way they are in the photograph.
  b.props.color(0xe9ecef, 1);
  for (let k = 0; k < 5; k++) {
    const at = frameAt(f, u1 - 1.6 + (k % 3) * 0.55, v0 - 0.55 - (k > 2 ? 0.5 : 0));
    const h = k > 2 ? 0.3 : 0.26;
    b.props.box(at.x, (k > 2 ? 0.26 : 0) + h / 2, at.z, 0.62, h, 0.42);
  }
}

/** Inside the mouth: dark walls and floor, a strip light, the pool of light spilling out of it. */
function mouth(b: EnvBuilders, p: GarageParts): void {
  const t = frameTools(p);
  const { f, out } = t;
  const M = GARAGE;
  const mw = M.mouth.width / 2;
  const v0 = M.apron;
  const vd = v0 + M.mouth.depth;
  const inside = 0x1a1b1d;

  b.props.color(0x101112, 1);
  const floor = frameBox(f, 0, (v0 + vd) / 2, M.mouth.width, M.mouth.depth, 0, 0);
  b.props.planeY((floor.minX + floor.maxX) / 2, 0.02, (floor.minZ + floor.maxZ) / 2, floor.maxX - floor.minX, floor.maxZ - floor.minZ);
  // The walls of the bay are the blocks' own faces: lined in near-black so the mouth reads as a hole.
  b.props.color(inside, 1);
  for (const side of [-1, 1]) {
    const at = frameAt(f, side * (mw - 0.02), (v0 + vd) / 2);
    b.props.panel(at.x, M.mouth.height / 2, at.z, M.mouth.depth, M.mouth.height, faceRot(-f.ax * side, -f.az * side));
  }
  const backAt = frameAt(f, 0, vd - 0.02);
  b.props.panel(backAt.x, M.mouth.height / 2, backAt.z, M.mouth.width, M.mouth.height, t.rot);
  // The ceiling, a slab just under the lintel.
  b.props.color(0x141516, 1);
  t.box(b.props, 0, (v0 + vd) / 2, M.mouth.width, M.mouth.depth, M.mouth.height, M.mouth.height + 0.05);

  // Two strip lights down the ceiling, cold, and the faint wash they put on the floor and the van.
  b.neon.color(0xe8f2ff, 0.85);
  for (const v of [v0 + 3, v0 + 7.5]) {
    const a = frameAt(f, -0.9, v);
    const c = frameAt(f, 0.9, v);
    b.neon.tube(a.x, M.mouth.height - 0.08, a.z, c.x, M.mouth.height - 0.08, c.z, 0.08);
    const g = frameAt(f, 0, v);
    groundGlow(b, g.x, g.z, 4.5, 4.5, 0xe8f2ff, 0.1, Y.glow);
  }
  // Tools on the wall of the bay: a board with a few shapes on it.
  b.props.color(0x3b3f44, 1);
  const board = frameAt(f, -(mw - 0.05), v0 + 5);
  b.props.panel(board.x, 1.7, board.z, 2.4, 1.1, faceRot(f.ax, f.az));
  b.props.color(0x8a9097, 1);
  for (let k = 0; k < 5; k++) {
    const at = frameAt(f, -(mw - 0.08), v0 + 4 + k * 0.5);
    b.props.box(at.x, 1.6 + (k % 2) * 0.25, at.z, 0.04, 0.5, 0.08);
  }

  // The bulkhead lamp over the mouth, off to one side of the lettering, and the warm pool it throws on the apron.
  const lamp = frameAt(f, -2.1, v0 - 0.35);
  b.props.color(PAL.metalDark, 1.2);
  b.props.box(lamp.x, M.mouth.height + 0.75, lamp.z, 0.5, 0.26, 0.4);
  b.neon.color(LAMP, 1);
  b.neon.planeY(lamp.x, M.mouth.height + 0.61, lamp.z, 0.4, 0.3);
  halo(b, lamp.x + out.x * 0.3, M.mouth.height + 0.6, lamp.z + out.z * 0.3, 2.4, 1.6, t.rot, LAMP, 0.35);
  const pool = frameAt(f, 0, v0 - 3.5);
  groundGlow(b, pool.x, pool.z, 11, 9, LAMP, 0.32, Y.glow);
  groundGlow(b, pool.x, pool.z, 5, 4, LAMP, 0.22, Y.glow + 0.003);
}

/** The white van backed into the mouth: rear to the street, plate and tail lights showing. */
function van(b: EnvBuilders, p: GarageParts): void {
  const t = frameTools(p);
  const { f, out } = t;
  const g = p.van;
  const V = GARAGE.van;
  const cu = 0.25;
  const vRear = GARAGE.apron + GARAGE.mouth.depth - 0.5 - V.length;
  const vMid = vRear + V.length / 2;
  const clear = 0.32;

  // Wheels, the body on them, a narrower cab roof, and the bumper.
  b.props.color(0x0d0e10, 1);
  for (const du of [-V.width / 2 + 0.15, V.width / 2 - 0.15]) {
    for (const dv of [0.8, V.length - 0.9]) t.box(b.props, cu + du, vRear + dv, 0.26, 0.62, 0, 0.62);
  }
  b.props.color(0xe8e8e2, 1.05);
  boxOf(b.props, { ...g, y0: clear, y1: V.height - 0.08 });
  t.box(b.props, cu, vMid, V.width - 0.08, V.length - 0.1, V.height - 0.08, V.height);
  b.props.color(0x1d1f22, 1);
  t.box(b.props, cu, vRear - 0.06, V.width + 0.04, 0.16, clear + 0.02, clear + 0.28);
  // The rear window, dark; the badge strip under it; the plate; the tail lights.
  const rear = vRear - 0.01;
  b.props.color(0x0b0c0e, 1);
  t.front(b.props, cu, rear, 1.42, V.width - 0.3, 0.52, 0.005);
  b.props.color(0x2a2c30, 1);
  t.front(b.props, cu, rear, 1.02, 0.7, 0.12, 0.008);
  b.props.color(0xf2f2f2, 1.1);
  t.front(b.props, cu, rear, 0.78, 0.52, 0.16, 0.008);
  b.props.color(0x1d2a4a, 1);
  t.front(b.props, cu, rear, 0.84, 0.52, 0.035, 0.012);
  b.neon.color(0xff2a2a, 0.55);
  for (const side of [-1, 1]) t.front(b.neon, cu + side * (V.width / 2 - 0.1), rear, 0.95, 0.12, 0.34, 0.01);
  // The light from the strip catches its roof.
  halo(b, frameAt(f, cu, rear - 0.2).x + out.x * 0.1, 1.2, frameAt(f, cu, rear - 0.2).z + out.z * 0.1, V.width + 0.6, 2, t.rot, 0xe8f2ff, 0.06);
}

/** The two turquoise doors, each with a louvre, tagged over. */
function doors(b: EnvBuilders, s: GarageSpec, p: GarageParts, rng: () => number): void {
  const t = frameTools(p);
  const { f, out } = t;
  const D = GARAGE.door;
  const v0 = GARAGE.apron;
  p.doorsU.forEach((du, i) => {
    // The steel, a frame round it and the seam down the middle of a double door.
    b.props.color(0x2d2f31, 1);
    t.front(b.props, du, v0, D.height / 2 + 0.05, D.width + 0.24, D.height + 0.12, 0.015);
    b.props.color(TURQUOISE, 0.95 + rng() * 0.1);
    t.front(b.props, du, v0, D.height / 2 + 0.05, D.width, D.height, 0.03);
    b.props.color(0x2a6d77, 1);
    t.front(b.props, du, v0, D.height / 2 + 0.05, 0.05, D.height, 0.04);
    // The louvre: a rusted panel of slats, low on the side toward the mouth.
    const lu = du + (du < 0 ? 1 : -1) * (D.width / 2 - 0.75);
    b.props.color(0x3f4a36, 1);
    t.front(b.props, lu, v0, 1.05, 0.95, 1.85, 0.05);
    for (let y = 0.25; y < 1.95; y += 0.13) {
      b.props.color(rng() < 0.4 ? RUST : 0x56663f, 0.9 + rng() * 0.3);
      t.box(b.props, lu, v0 - 0.08, 0.9, 0.05, y, y + 0.07);
    }
    // Paint over the lot of it.
    const at = frameAt(f, du, v0 - 0.04);
    paintSurface(b, surface(at.x, 0.15, at.z, out.x, out.z, D.width - 0.2, D.height - 0.3), BOMBED, seedOf(`${s.tag}:door:${i}`));
  });
}

/** The name on the parapet, in the red of the 99 on his shirt, and GARAGE under it on the ledge. */
function sign(b: EnvBuilders, p: GarageParts): void {
  const t = frameTools(p);
  const { f, out } = t;
  const M = GARAGE;
  const top = M.height + M.parapet;
  const at = frameAt(f, 0, M.apron - 0.12);
  b.props.color(0x121315, 1);
  t.box(b.props, 0, M.apron + 0.05, 11.2, 0.3, top + 0.05, top + 1.55);
  neonText(b.neon, 'LOCO MUSTANG', at.x, top + 0.38, at.z, out.x, out.z, 0.8, SIGN_RED, 1);
  halo(b, at.x + out.x * 0.4, top + 0.8, at.z + out.z * 0.4, 13, 2.8, t.rot, SIGN_RED, 0.28);
  const ledge = frameAt(f, 0, M.apron - 0.02);
  neonText(b.neon, 'GARAGE', ledge.x, M.door.height + 0.62, ledge.z, out.x, out.z, 0.42, 0xf4efe0, 0.75);
  halo(b, ledge.x + out.x * 0.3, M.door.height + 0.85, ledge.z + out.z * 0.3, 4.4, 1.2, t.rot, 0xf4efe0, 0.12);
}
