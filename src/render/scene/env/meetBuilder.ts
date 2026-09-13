import { PAL } from './palette';
import { makeRng } from './meshBuilder';
import { groundGlow, halo, type EnvBuilders } from './builders';
import { ROAD_TILE } from './cityBuilder';
import { graffitiCell, grimeSurface, paintSurface } from './graffiti';
import { lampPost } from './propsBuilder';
import type { GraffitiSurface, ReclaimProfile } from './reclaim';
import { signCell } from './textures';
import { inRect } from '../../../world/cityPlan';
import {
  headingForward,
  MEET_CAR_HALF,
  MEET_EDGE,
  MEET_PROP_SIZE,
  meetWalls,
  type CarMeetSpec,
  type MeetCarSpec,
  type MeetPropSpec,
} from '../../../world/carMeet';

/**
 * THE CAR MEETS, drawn (`world/carMeet.ts`): the lot, its paint, its edges, the paint on
 * everything, the lamps, the kiosk and the trucks, and the light the parked cars throw on the
 * ground. All of it into the city's own batches: a meet costs triangles, never a draw call.
 * The cars themselves are `scene/meetVisual.ts`; their underglow is here, because it is
 * light on the asphalt and the asphalt is here.
 *
 * THE LOOK is the references: Daikoku at night. A wide dark lot of old asphalt with worn
 * white bays and big painted arrows, the highway curving over it on pale columns, tall masts
 * throwing sodium and cold white pools, a glowing row of vending machines, trucks parked at
 * the back. And because this one is not sanctioned: every column, hoarding and barrier
 * painted, tyre donuts in the open middle, a fire in a drum.
 */

/** How given-up a meet is, as the graffiti and grime see it: all the way. */
const PAINTED: ReclaimProfile = {
  intensity: 1,
  level: 3,
  vegetation: 0,
  weeds: 0,
  vines: 0,
  graffiti: 1,
  graffitiScale: 1,
  decay: 0.85,
  planter: 0,
  bigTree: false,
  grafWall: true,
};

/** The heights paint and marks are laid at over the lot's asphalt (m). */
const Y = { slab: 0, patch: 0.016, paint: 0.03, marks: 0.036, stain: 0.05, glow: 0.055 } as const;

/** Sodium: the lot's warm light, and the fire's. */
const FIRE = 0xff8a3a;
const WHITE_LIGHT = 0xe8f4ff;

export function buildCarMeets(b: EnvBuilders): void {
  for (const meet of b.plan.meets ?? []) {
    const rng = makeRng(seedOf(meet.tag));
    buildLot(b, meet, rng);
    buildLotPaint(b, meet, rng);
    buildEdges(b, meet);
    buildColumnPaint(b, meet);
    for (const p of meet.props) buildProp(b, p, rng);
    for (const c of meet.cars) buildCarLight(b, c);
  }
}

/* ------------------------------------------------------------------ helpers */

function seedOf(tag: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < tag.length; i++) h = Math.imul(h ^ tag.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** Facing direction of a vertical panel as `MeshBuilder.panel` takes it: rotY 0 faces +Z. */
const faceRot = (nx: number, nz: number): number => Math.atan2(nx, nz);

/**
 * A flat quad on the ground, centred on (cx, cz), `along` metres down (fx, fz) and `across`
 * metres across it, facing up. Corners are laid in `planeY`'s winding.
 */
function groundQuad(
  quad: (ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, dx: number, dy: number, dz: number, u0?: number, v0?: number, u1?: number, v1?: number) => void,
  cx: number,
  cz: number,
  fx: number,
  fz: number,
  along: number,
  across: number,
  y: number,
  uv?: { u0: number; v0: number; u1: number; v1: number },
): void {
  // Local X is the right of forward (-fz, fx); local Z is backward (-fx, -fz). Together they
  // are a rotation of the world axes, so `planeY`'s corner order still faces up.
  const rx = -fz;
  const rz = fx;
  const hx = across / 2;
  const hz = along / 2;
  const at = (lx: number, lz: number): [number, number] => [cx + rx * lx - fx * lz, cz + rz * lx - fz * lz];
  const [ax, az] = at(-hx, hz);
  const [bx, bz] = at(hx, hz);
  const [qx, qz] = at(hx, -hz);
  const [dx, dz] = at(-hx, -hz);
  if (uv) quad(ax, y, az, bx, y, bz, qx, y, qz, dx, y, dz, uv.u0, uv.v0, uv.u1, uv.v1);
  else quad(ax, y, az, bx, y, bz, qx, y, qz, dx, y, dz);
}

/** A painted stripe from (ax, az) to (bx, bz). */
function stripe(b: EnvBuilders, ax: number, az: number, bx: number, bz: number, width: number, y: number = Y.paint): void {
  const len = Math.hypot(bx - ax, bz - az);
  if (len < 1e-3) return;
  groundQuad(b.lane.quad.bind(b.lane), (ax + bx) / 2, (az + bz) / 2, (bx - ax) / len, (bz - az) / len, len, width, y);
}

/** A light pool on the ground, turned to a heading (`groundGlow` is square to the axes). */
function glowPool(b: EnvBuilders, cx: number, cz: number, fx: number, fz: number, along: number, across: number, color: number, strength: number, y: number = Y.glow): void {
  b.glow.color(color, strength);
  groundQuad(b.glow.quad.bind(b.glow), cx, cz, fx, fz, along, across, y);
}

/**
 * A face of something, as a surface the graffiti can be laid on. (x, z) is the face's middle at
 * its foot. The run has to be (nz, -nx): `decal` winds its quad along the run and then up, and
 * the decal material draws front faces only, so a run the other way round is paint nobody sees.
 */
function face(x: number, y: number, z: number, nx: number, nz: number, width: number, height: number, out = 0.03): GraffitiSurface {
  return { x, y, z, nx, nz, tx: nz, tz: -nx, width, height, out };
}

function paintFace(b: EnvBuilders, s: GraffitiSurface, seed: number): void {
  paintSurface(b, s, PAINTED, seed);
  grimeSurface(b, s, PAINTED, seed ^ 0x5bd1, 'streak');
}

/* ------------------------------------------------------------------ the lot */

function buildLot(b: EnvBuilders, meet: CarMeetSpec, rng: () => number): void {
  const l = meet.lot;
  const w = l.maxX - l.minX;
  const d = l.maxZ - l.minZ;
  // Old asphalt, a shade darker and warmer than the streets round it.
  b.road.color(0xd6d4d8, 0.8);
  b.road.planeY((l.minX + l.maxX) / 2, Y.slab, (l.minZ + l.maxZ) / 2, w, d, l.minX / ROAD_TILE, l.maxZ / ROAD_TILE, l.maxX / ROAD_TILE, l.minZ / ROAD_TILE);
  // Patched: rectangles of newer, blacker surface where a trench was dug and filled.
  for (let i = 0; i < 14; i++) {
    const pw = 3 + rng() * 14;
    const pd = 2 + rng() * 6;
    const px = l.minX + pw / 2 + 1 + rng() * (w - pw - 2);
    const pz = l.minZ + pd / 2 + 1 + rng() * (d - pd - 2);
    b.road.color(0xb9bcc4, 0.62 + rng() * 0.12);
    b.road.planeY(px, Y.patch, pz, pw, pd, (px - pw / 2) / ROAD_TILE, (pz + pd / 2) / ROAD_TILE, (px + pw / 2) / ROAD_TILE, (pz - pd / 2) / ROAD_TILE);
  }
}

function buildLotPaint(b: EnvBuilders, meet: CarMeetSpec, rng: () => number): void {
  const l = meet.lot;
  const worn = (): number => 0.55 + rng() * 0.35;

  // Bays nose-in along the north fence.
  for (let x = -557.6; x <= l.maxX - 3; x += 2.9) {
    b.lane.color(PAL.laneWhite, worn());
    stripe(b, x, l.minZ + 0.7, x, l.minZ + 6.3, 0.13);
  }
  // A double row by the west wall: a spine and the bays either side of it.
  b.lane.color(PAL.laneWhite, 0.7);
  stripe(b, -601.5, 290, -566.7, 290, 0.13);
  for (let x = -601.5; x <= -566.6; x += 2.9) {
    b.lane.color(PAL.laneWhite, worn());
    stripe(b, x, 284.4, x, 295.6, 0.13);
  }
  // The long bays in the pocket, for trucks.
  for (const x of [-500.7, -507.4]) {
    b.lane.color(PAL.laneWhite, worn());
    stripe(b, x, 313.5, x, 327.5, 0.14);
  }

  // The big arrows, into the lot from each way in.
  b.lane.color(PAL.laneWhite, 0.85);
  arrow(b, -577, 252, Math.PI, 6.5);
  arrow(b, l.minX + 9, 307, Math.PI / 2, 6.5);
  arrow(b, -549.5, l.maxZ - 5, 0, 5.5);
  arrow(b, l.maxX - 8, 291, -Math.PI / 2, 5.5);

  // Orange blocks across the main gate, the paving the references have at their crossings.
  b.lane.color(0xd8662a, 0.72);
  for (let k = 0; k < 6; k++) {
    const x = -586.2 + k * 3.6;
    b.lane.planeY(x, Y.paint, l.minZ + 7.4, 2.2, 1.6);
  }

  // Hazard squares round the foot of every column on the lot.
  b.lane.color(0xd9b43a, 0.66);
  for (const p of b.plan.pillars ?? []) {
    if (!inRect(l, p.x, p.z)) continue;
    const out = p.halfWidth - 1.6;
    for (const side of [-1, 1]) {
      const cx = p.x - p.tz * out * side;
      const cz = p.z + p.tx * out * side;
      const h = 2.3;
      stripe(b, cx - h, cz - h, cx + h, cz - h, 0.22);
      stripe(b, cx + h, cz - h, cx + h, cz + h, 0.22);
      stripe(b, cx + h, cz + h, cx - h, cz + h, 0.22);
      stripe(b, cx - h, cz + h, cx - h, cz - h, 0.22);
    }
  }

  // Tyre marks: donuts in the open middle, and the long black arcs of somebody leaving.
  b.lane.color(0x07090c, 1);
  donut(b, -566, 262, 5.6, 0, 6.4, rng);
  donut(b, -563.8, 264.5, 6.1, 0.4, 6.1, rng);
  donut(b, -588, 256, 4.8, 1.2, 5.2, rng);
  donut(b, -546, 272, 5.2, 2.5, 3.6, rng);
  arcMark(b, -520, 285, 28, 3.4, 4.4, rng);
  arcMark(b, -521.4, 286.2, 28, 3.4, 4.35, rng);

  // A piece sprayed flat on the asphalt where everyone gathers: the writers got the lot too.
  const piece = graffitiCell(6 + Math.floor(rng() * 3));
  b.decal.color(0xffffff, 0.7);
  groundQuad(b.decal.quad.bind(b.decal), -563, 262, 0, 1, 5.2, 15, Y.stain, piece);

  // Oil where cars have stood and still stand.
  const stain = graffitiCell(13);
  for (const c of meet.cars) {
    if (rng() < 0.35) continue;
    const { fx, fz } = headingForward(c.heading);
    b.decal.color(PAL.grime, 1.1 + rng() * 0.5);
    groundQuad(b.decal.quad.bind(b.decal), c.x + fx * (rng() - 0.5) * 2, c.z + fz * (rng() - 0.5) * 2, fx, fz, 1.8 + rng(), 1.4 + rng(), Y.stain, stain);
  }
  for (let i = 0; i < 18; i++) {
    const x = l.minX + 4 + rng() * (l.maxX - l.minX - 8);
    const z = l.minZ + 4 + rng() * (l.maxZ - l.minZ - 8);
    b.decal.color(PAL.grime, 0.8 + rng() * 0.6);
    groundQuad(b.decal.quad.bind(b.decal), x, z, 0, 1, 1.2 + rng() * 2.5, 1.2 + rng() * 2.5, Y.stain, stain);
  }
}

/** A painted arrow pointing along `heading`, `len` metres long. */
function arrow(b: EnvBuilders, x: number, z: number, heading: number, len: number): void {
  const { fx, fz } = headingForward(heading);
  const shaft = len * 0.62;
  const quad = b.lane.quad.bind(b.lane);
  // Shaft behind the head.
  groundQuad(quad, x - fx * (len / 2 - shaft / 2), z - fz * (len / 2 - shaft / 2), fx, fz, shaft, 0.55, Y.paint);
  // The head: a triangle, as a quad with its tip doubled.
  const rx = -fz;
  const rz = fx;
  const bx = x + fx * (shaft - len / 2);
  const bz = z + fz * (shaft - len / 2);
  const tx = x + fx * (len / 2);
  const tz = z + fz * (len / 2);
  const hw = len * 0.24;
  // Same winding as `groundQuad`: left-back, right-back, then the tip twice.
  b.lane.quad(bx - rx * hw, Y.paint, bz - rz * hw, bx + rx * hw, Y.paint, bz + rz * hw, tx, Y.paint, tz, tx, Y.paint, tz);
}

/** A ring of rubber: `turns` radians of it from `start`, a little ragged. */
function donut(b: EnvBuilders, cx: number, cz: number, r: number, start: number, turns: number, rng: () => number): void {
  const n = Math.ceil(turns / 0.2);
  for (let i = 0; i < n; i++) {
    const a0 = start + (i / n) * turns;
    const a1 = start + ((i + 1) / n) * turns;
    const r0 = r + (rng() - 0.5) * 0.25;
    const r1 = r + (rng() - 0.5) * 0.25;
    stripe(b, cx + Math.cos(a0) * r0, cz + Math.sin(a0) * r0, cx + Math.cos(a1) * r1, cz + Math.sin(a1) * r1, 0.24 + rng() * 0.1, Y.marks);
  }
}

/** An arc of rubber about (cx, cz): `sweep` radians from `start`, radius `r`. */
function arcMark(b: EnvBuilders, cx: number, cz: number, r: number, start: number, sweep: number, rng: () => number): void {
  donut(b, cx, cz, r, start, sweep - start, rng);
}

/* ------------------------------------------------------------------ edges */

function buildEdges(b: EnvBuilders, meet: CarMeetSpec): void {
  const l = meet.lot;
  const cx = (l.minX + l.maxX) / 2;
  const cz = (l.minZ + l.maxZ) / 2;
  for (const e of meetWalls(meet)) {
    const len = Math.hypot(e.bx - e.ax, e.bz - e.az);
    if (len < 0.5) continue;
    const dx = (e.bx - e.ax) / len;
    const dz = (e.bz - e.az) / len;
    // The normal that points onto the lot.
    let nx = -dz;
    let nz = dx;
    if ((cx - e.ax) * nx + (cz - e.az) * nz < 0) {
      nx = -nx;
      nz = -nz;
    }
    const seed = seedOf(`${meet.tag}:${e.side}:${e.from}`);
    if (e.kind === 'hoarding') hoarding(b, e.ax, e.az, dx, dz, nx, nz, len, seed);
    else if (e.kind === 'fence') lowFence(b, e.ax, e.az, dx, dz, nx, nz, len, seed);
    else barriers(b, e.ax, e.az, dx, dz, nx, nz, len, seed);
  }
}

/**
 * Precast panels on posts, each a slightly different age, painted on both faces. Pale concrete
 * rather than dark sheet: at night the paint only reads on a wall the sky can light.
 */
function hoarding(b: EnvBuilders, ax: number, az: number, dx: number, dz: number, nx: number, nz: number, len: number, seed: number): void {
  const rng = makeRng(seed);
  const panel = 2.4;
  const n = Math.max(1, Math.round(len / panel));
  const step = len / n;
  const t = MEET_EDGE.thick * 0.5;
  for (let i = 0; i < n; i++) {
    const s = (i + 0.5) * step;
    const px = ax + dx * s;
    const pz = az + dz * s;
    const h = MEET_EDGE.hoarding - rng() * 0.35;
    b.wall.color(PAL.curb, 1.05 + rng() * 0.3);
    b.wall.orientedBox(px, pz, dx, dz, step - 0.06, t, 0, h);
  }
  // Posts on the lot side, a top rail.
  b.props.color(PAL.metalDark, 1.2);
  for (let i = 0; i <= n; i++) {
    const s = i * step;
    b.props.box(ax + dx * s + nx * 0.25, MEET_EDGE.hoarding / 2, az + dz * s + nz * 0.25, 0.14, MEET_EDGE.hoarding, 0.14);
  }
  // Paint in runs of about twelve metres, both faces: the street gets it as well.
  const runs = Math.max(1, Math.round(len / 12));
  const run = len / runs;
  for (let i = 0; i < runs; i++) {
    const s = (i + 0.5) * run;
    const mx = ax + dx * s;
    const mz = az + dz * s;
    for (const side of [1, -1]) {
      paintFace(b, face(mx + nx * t * 0.5 * side, 0, mz + nz * t * 0.5 * side, nx * side, nz * side, run, MEET_EDGE.hoarding - 0.4), seed + i * 17 + side);
    }
  }
  // A work lamp clamped to the odd post, throwing a pool onto the lot.
  for (let i = 2; i < n; i += 6) {
    const s = i * step;
    const lx = ax + dx * s + nx * 0.45;
    const lz = az + dz * s + nz * 0.45;
    b.props.color(PAL.metalDark, 1.3);
    b.props.box(lx, MEET_EDGE.hoarding + 0.1, lz, 0.4, 0.22, 0.3);
    b.neon.color(WHITE_LIGHT, 0.9);
    b.neon.panel(lx + nx * 0.16, MEET_EDGE.hoarding, lz + nz * 0.16, 0.32, 0.14, faceRot(nx, nz));
    halo(b, lx + nx * 0.3, MEET_EDGE.hoarding - 0.2, lz + nz * 0.3, 3.5, 2.5, faceRot(nx, nz), WHITE_LIGHT, 0.14);
    // Washing down the panel it hangs off, and out over the lot.
    b.glow.color(WHITE_LIGHT, 0.1);
    b.glow.panel(lx + nx * 0.2, MEET_EDGE.hoarding / 2, lz + nz * 0.2, 7, MEET_EDGE.hoarding, faceRot(nx, nz));
    groundGlow(b, lx + nx * 6, lz + nz * 6, 16, 16, WHITE_LIGHT, 0.16, Y.glow);
  }
}

/** A knee-high concrete wall with chain-link over it. */
function lowFence(b: EnvBuilders, ax: number, az: number, dx: number, dz: number, nx: number, nz: number, len: number, seed: number): void {
  const mx = ax + dx * len / 2;
  const mz = az + dz * len / 2;
  const wallTop = MEET_EDGE.fenceWall;
  b.wall.color(PAL.curb, 1.05);
  b.wall.orientedBox(mx, mz, dx, dz, len, 0.34, 0, wallTop);
  b.props.color(PAL.metalDark, 0.55);
  b.props.orientedBox(mx, mz, dx, dz, len, 0.05, wallTop, MEET_EDGE.fence);
  b.props.color(PAL.metalDark, 0.95);
  b.props.orientedBox(mx, mz, dx, dz, len, 0.12, MEET_EDGE.fence - 0.06, MEET_EDGE.fence + 0.06);
  const posts = Math.max(1, Math.round(len / 3));
  for (let i = 0; i <= posts; i++) {
    const s = (i / posts) * len;
    b.props.box(ax + dx * s, (wallTop + MEET_EDGE.fence) / 2, az + dz * s, 0.1, MEET_EDGE.fence - wallTop, 0.1);
  }
  const runs = Math.max(1, Math.round(len / 10));
  const run = len / runs;
  for (let i = 0; i < runs; i++) {
    const s = (i + 0.5) * run;
    for (const side of [1, -1]) {
      paintFace(b, face(ax + dx * s + nx * 0.17 * side, 0, az + dz * s + nz * 0.17 * side, nx * side, nz * side, run, wallTop), seed + i * 13 + side);
    }
  }
}

/** Jersey barriers, pushed roughly into a line. */
function barriers(b: EnvBuilders, ax: number, az: number, dx: number, dz: number, nx: number, nz: number, len: number, seed: number): void {
  const rng = makeRng(seed);
  const unit = 2;
  const n = Math.max(1, Math.round(len / unit));
  const step = len / n;
  for (let i = 0; i < n; i++) {
    const s = (i + 0.5) * step;
    const jog = (rng() - 0.5) * 0.18;
    const px = ax + dx * s + nx * jog;
    const pz = az + dz * s + nz * jog;
    const turn = (rng() - 0.5) * 0.08;
    const tdx = dx - dz * turn;
    const tdz = dz + dx * turn;
    b.wall.color(PAL.curb, 1.0 + rng() * 0.25);
    b.wall.orientedBox(px, pz, tdx, tdz, step - 0.1, 0.62, 0, 0.3);
    b.wall.orientedBox(px, pz, tdx, tdz, step - 0.1, 0.3, 0.3, MEET_EDGE.barrier);
    if (rng() < 0.6) {
      paintFace(b, face(px + nx * 0.16, 0.3, pz + nz * 0.16, nx, nz, step - 0.1, 0.7, 0.02), seed + i * 7);
    }
  }
}

/* ------------------------------------------------------------------ the columns */

/** Every column standing on the lot, painted on all four faces up to where a ladder reaches. */
function buildColumnPaint(b: EnvBuilders, meet: CarMeetSpec): void {
  for (const p of b.plan.pillars ?? []) {
    if (!inRect(meet.lot, p.x, p.z, 2)) continue;
    const out = p.halfWidth - 1.6;
    for (const side of [-1, 1]) {
      const cx = p.x - p.tz * out * side;
      const cz = p.z + p.tx * out * side;
      // The columns are square to the world axes (`elevatedBuilder.buildPillar`).
      for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const s = face(cx + nx * 0.85, 0.95, cz + nz * 0.85, nx, nz, 1.7, 5.4, 0.02);
        paintFace(b, s, seedOf(`${meet.tag}:col:${cx.toFixed(1)}:${cz.toFixed(1)}:${nx}:${nz}`));
      }
    }
  }
}

/* ------------------------------------------------------------------ props */

function buildProp(b: EnvBuilders, p: MeetPropSpec, rng: () => number): void {
  switch (p.kind) {
    case 'kiosk':
      return kiosk(b, p);
    case 'vending':
      return vending(b, p);
    case 'truck':
      return truck(b, p);
    case 'container':
      return container(b, p, rng);
    case 'mast':
      return mast(b, p);
    case 'barrel':
      return barrel(b, p);
    case 'speakers':
      return speakers(b, p);
    case 'tyres':
      return tyres(b, p, rng);
    case 'cones':
      return cones(b, p);
    case 'table':
      return table(b, p);
    case 'sign':
      return sign(b, p);
  }
}

/** Forward and right of a prop, and its size. */
function frame(p: MeetPropSpec): { fx: number; fz: number; rx: number; rz: number; along: number; across: number; height: number } {
  const { fx, fz } = headingForward(p.heading);
  return { fx, fz, rx: -fz, rz: fx, ...MEET_PROP_SIZE[p.kind] };
}

/** The rest area's block: toilets and a shuttered counter, the vending machines on its front. */
function kiosk(b: EnvBuilders, p: MeetPropSpec): void {
  const { fx, fz, rx, rz, along, across, height } = frame(p);
  const body = 3.4;
  b.wall.color(PAL.concrete, 1.05);
  b.wall.orientedBox(p.x, p.z, rx, rz, across, along, 0, body);
  b.concrete.color(PAL.curb, 0.85);
  b.concrete.orientedBox(p.x + fx * 0.4, p.z + fz * 0.4, rx, rz, across + 0.8, along + 1.4, body, height, { bottom: true });
  // A shutter on each end, a door at the back with a tube over it.
  b.props.color(PAL.metalDark, 1.25);
  for (const side of [-1, 1]) {
    b.props.panel(p.x + rx * (across / 2 + 0.03) * side, 1.35, p.z + rz * (across / 2 + 0.03) * side, 3.4, 2.7, faceRot(rx * side, rz * side));
  }
  const bx = p.x - fx * (along / 2 + 0.03);
  const bz = p.z - fz * (along / 2 + 0.03);
  b.props.color(0x1a1f26, 1);
  b.props.panel(bx + rx * 3, 1.1, bz + rz * 3, 1.0, 2.2, faceRot(-fx, -fz));
  b.neon.color(WHITE_LIGHT, 0.8);
  b.neon.tube(bx + rx * 2.3 - fx * 0.1, 2.5, bz + rz * 2.3 - fz * 0.1, bx + rx * 3.7 - fx * 0.1, 2.5, bz + rz * 3.7 - fz * 0.1, 0.1);
  groundGlow(b, bx + rx * 3 - fx * 2.5, bz + rz * 3 - fz * 2.5, 6, 6, WHITE_LIGHT, 0.14, Y.glow);
  // A lit board on the fascia over the machines.
  const uv = signCell(5);
  b.signs.panel(p.x + fx * (along / 2 + 1.12), 3.55, p.z + fz * (along / 2 + 1.12), 3.6, 0.9, faceRot(fx, fz), uv.u0, uv.v0, uv.u1, uv.v1);
  // Plant on the roof.
  b.props.color(PAL.metalDark, 1.1);
  b.props.orientedBox(p.x - rx * 3.5, p.z - rz * 3.5, rx, rz, 1.6, 1.1, height, height + 0.9);
  b.props.orientedBox(p.x + rx * 2.8 - fx, p.z + rz * 2.8 - fz, rx, rz, 0.9, 0.9, height, height + 0.6);
  // Paint on the three faces that are not the machines'.
  const seed = seedOf(`kiosk:${p.x}:${p.z}`);
  for (const side of [-1, 1]) {
    paintFace(b, face(p.x + rx * (across / 2) * side, 0, p.z + rz * (across / 2) * side, rx * side, rz * side, along, body), seed + side);
  }
  paintFace(b, face(bx, 0, bz, -fx, -fz, across, body), seed + 5);
}

/** A row of five machines, lit from inside, the brightest thing on the lot. */
function vending(b: EnvBuilders, p: MeetPropSpec): void {
  const { fx, fz, rx, rz, along, across, height } = frame(p);
  const paints = [0xdfe4ea, 0xc0262e, 0x2358b8, 0xdfe4ea, 0x2d8f4e];
  const n = paints.length;
  const w = across / n;
  const rot = faceRot(fx, fz);
  for (let i = 0; i < n; i++) {
    const off = (i + 0.5) * w - across / 2;
    const mx = p.x + rx * off;
    const mz = p.z + rz * off;
    b.props.color(paints[i], 0.9);
    b.props.orientedBox(mx, mz, fx, fz, along, w - 0.06, 0, height);
    const fxp = mx + fx * (along / 2 + 0.02);
    const fzp = mz + fz * (along / 2 + 0.02);
    // The display window, the header in the machine's own colour, the dark slot and buttons.
    b.neon.color(0xeef8ff, 0.95);
    b.neon.panel(fxp, 1.2, fzp, w - 0.3, 1.0, rot);
    b.neon.color(paints[i], 1);
    b.neon.panel(fxp, 1.8, fzp, w - 0.2, 0.2, rot);
    b.props.color(0x0b0e12, 1);
    b.props.panel(fxp + fx * 0.01, 0.35, fzp + fz * 0.01, w - 0.4, 0.26, rot);
  }
  // The canopy over them, a tube under it, and the light they throw.
  b.concrete.color(PAL.curb, 0.8);
  b.concrete.orientedBox(p.x + fx * 0.6, p.z + fz * 0.6, rx, rz, across + 1.2, 2.2, 2.95, 3.15, { bottom: true });
  b.neon.color(WHITE_LIGHT, 0.85);
  b.neon.tube(p.x + fx * 1.2 - rx * across / 2, 2.9, p.z + fz * 1.2 - rz * across / 2, p.x + fx * 1.2 + rx * across / 2, 2.9, p.z + fz * 1.2 + rz * across / 2, 0.1);
  halo(b, p.x + fx * 0.9, 1.3, p.z + fz * 0.9, across + 2, 2.8, rot, 0xdff4ff, 0.24);
  glowPool(b, p.x + fx * 3, p.z + fz * 3, fx, fz, 6, across + 4, 0xdff4ff, 0.34);
}

/** A box truck. A dark one is somebody's pride: marker lamps all over the body. */
function truck(b: EnvBuilders, p: MeetPropSpec): void {
  const { fx, fz, rx, rz, along, across } = frame(p);
  const color = p.color ?? 0xcfd5da;
  const at = (a: number, c: number): [number, number] => [p.x + fx * a + rx * c, p.z + fz * a + rz * c];
  b.props.color(0x1a1d22, 1);
  b.props.orientedBox(p.x, p.z, fx, fz, along - 0.6, 2.0, 0.45, 0.95);
  b.props.color(0x0f1114, 1);
  for (const a of [3.0, -2.2, -3.4]) {
    for (const c of [-1.05, 1.05]) {
      const [wx, wz] = at(a, c);
      b.props.orientedBox(wx, wz, fx, fz, 1.0, 0.42, 0, 1.0);
    }
  }
  // Cab, windscreen, cargo box.
  const [cabX, cabZ] = at(along / 2 - 1.15, 0);
  b.props.color(color, 0.95);
  b.props.orientedBox(cabX, cabZ, fx, fz, 2.1, across - 0.1, 0.95, 3.1);
  const [wsX, wsZ] = at(along / 2 - 0.08, 0);
  b.props.color(0x0c141b, 1);
  b.props.panel(wsX, 2.45, wsZ, across - 0.5, 0.95, faceRot(fx, fz));
  const [boxX, boxZ] = at(-1.0, 0);
  const boxLen = along - 2.4;
  b.props.color(color, 1.05);
  b.props.orientedBox(boxX, boxZ, fx, fz, boxLen, across, 1.0, 4.1);
  const dark = (((color >> 16) & 255) + ((color >> 8) & 255) + (color & 255)) / 3 < 110;
  const seed = seedOf(`truck:${p.x}:${p.z}`);
  for (const side of [-1, 1]) {
    const [sx, sz] = at(-1.0, (across / 2) * side);
    paintFace(b, face(sx, 1.1, sz, rx * side, rz * side, boxLen - 0.3, 2.8), seed + side);
  }
  if (dark) {
    // Marker lamps: two rows down each side, round the back, and a crown over the cab.
    b.neon.color(0xffb13b, 0.95);
    for (const side of [-1, 1]) {
      for (const y of [4.02, 1.08]) {
        const [a0x, a0z] = at(-1.0 - boxLen / 2 + 0.2, (across / 2 + 0.04) * side);
        const [a1x, a1z] = at(-1.0 + boxLen / 2 - 0.2, (across / 2 + 0.04) * side);
        b.neon.tube(a0x, y, a0z, a1x, y, a1z, 0.07);
      }
    }
    const [r0x, r0z] = at(-1.0 - boxLen / 2 - 0.04, -across / 2);
    const [r1x, r1z] = at(-1.0 - boxLen / 2 - 0.04, across / 2);
    b.neon.tube(r0x, 4.02, r0z, r1x, 4.02, r1z, 0.08);
    b.neon.color(0x5dff8a, 0.9);
    for (let k = -2; k <= 2; k++) {
      const [lx, lz] = at(along / 2 - 0.3, k * 0.42);
      b.neon.panel(lx, 3.25, lz, 0.18, 0.18, faceRot(fx, fz));
    }
    glowPool(b, boxX, boxZ, fx, fz, along + 2, across + 4, 0xffa640, 0.18);
  }
}

function container(b: EnvBuilders, p: MeetPropSpec, rng: () => number): void {
  const { fx, fz, rx, rz, along, across, height } = frame(p);
  const color = p.color ?? PAL.rust;
  b.props.color(color, 0.85);
  b.props.orientedBox(p.x, p.z, fx, fz, along, across, 0, height);
  b.props.color(color, 0.7);
  for (let a = -along / 2 + 0.5; a < along / 2 - 0.3; a += 0.75) {
    for (const side of [-1, 1]) {
      b.props.orientedBox(p.x + fx * a + rx * (across / 2 + 0.03) * side, p.z + fz * a + rz * (across / 2 + 0.03) * side, fx, fz, 0.24, 0.07, 0.08, height - 0.08);
    }
  }
  b.props.color(PAL.metalDark, 1.1);
  b.props.panel(p.x - fx * (along / 2 + 0.02), height / 2, p.z - fz * (along / 2 + 0.02), across - 0.2, height - 0.2, faceRot(-fx, -fz));
  const seed = seedOf(`container:${p.x}:${p.z}`) + Math.floor(rng() * 1000);
  for (const side of [-1, 1]) {
    paintFace(b, face(p.x + rx * (across / 2 + 0.07) * side, 0, p.z + rz * (across / 2 + 0.07) * side, rx * side, rz * side, along, height), seed + side);
  }
}

/** A tall lot mast: the street's own fixture on a longer pole, and a much wider pool. */
function mast(b: EnvBuilders, p: MeetPropSpec): void {
  const { fx, fz, height } = frame(p);
  const color = p.color ?? 0xffb86b;
  const fault = p.faulty ? 0.41 : 0;
  b.concrete.color(PAL.curb, 1.1);
  b.concrete.box(p.x, 0.25, p.z, 0.9, 0.5, 0.9);
  lampPost(b, p.x, p.z, 0.5, fx, fz, 2.4, height - 0.5, color, 6, fault);
  // The lot is read by these pools, the way the references' lots are read by their masts.
  groundGlow(b, p.x + fx * 10, p.z + fz * 10, 42, 42, color, 0.26, Y.glow, fault);
}

/** A fire in a drum. */
function barrel(b: EnvBuilders, p: MeetPropSpec): void {
  b.props.color(PAL.rust, 1.4);
  b.props.orientedBox(p.x, p.z, 1, 0, 0.62, 0.62, 0, 0.92);
  b.props.orientedBox(p.x, p.z, Math.SQRT1_2, Math.SQRT1_2, 0.62, 0.62, 0, 0.92);
  b.props.color(PAL.metalDark, 0.8);
  b.props.box(p.x, 0.93, p.z, 0.7, 0.04, 0.7, { sides: true });
  b.neonFlicker.color(FIRE, 1);
  b.neonFlicker.tube(p.x - 0.12, 0.9, p.z, p.x + 0.05, 1.55, p.z + 0.04, 0.34);
  b.neonFlicker.tube(p.x + 0.1, 0.9, p.z - 0.08, p.x - 0.02, 1.35, p.z + 0.02, 0.28);
  b.neon.color(0xffd27a, 0.9);
  b.neon.tube(p.x, 0.92, p.z, p.x, 1.15, p.z, 0.3);
  halo(b, p.x, 1.3, p.z, 3, 2.6, 0, FIRE, 0.32);
  halo(b, p.x, 1.3, p.z, 3, 2.6, Math.PI / 2, FIRE, 0.32);
  groundGlow(b, p.x, p.z, 11, 11, FIRE, 0.38, Y.glow);
}

/** Two cabinets on each other with their cones lit, and the amp beside them. */
function speakers(b: EnvBuilders, p: MeetPropSpec): void {
  const { fx, fz, rx, rz, along, across, height } = frame(p);
  const rot = faceRot(fx, fz);
  b.props.color(0x22262d, 1);
  b.props.orientedBox(p.x, p.z, fx, fz, along, across, 0, 0.72);
  b.props.orientedBox(p.x, p.z, fx, fz, along, across * 0.9, 0.72, height);
  b.props.color(PAL.metalDark, 0.9);
  b.props.orientedBox(p.x - rx * (across / 2 + 0.45), p.z - rz * (across / 2 + 0.45), fx, fz, 0.5, 0.6, 0, 0.35);
  b.neon.color(PAL.neonCyan, 0.9);
  for (const [c, y, r] of [[-0.33, 0.36, 0.22], [0.33, 0.36, 0.22], [0, 1.08, 0.26]] as const) {
    const ox = p.x + fx * (along / 2 + 0.02) + rx * c;
    const oz = p.z + fz * (along / 2 + 0.02) + rz * c;
    for (let k = 0; k < 8; k++) {
      const a0 = (k / 8) * Math.PI * 2;
      const a1 = ((k + 1) / 8) * Math.PI * 2;
      b.neon.tube(ox + rx * Math.cos(a0) * r, y + Math.sin(a0) * r, oz + rz * Math.cos(a0) * r, ox + rx * Math.cos(a1) * r, y + Math.sin(a1) * r, oz + rz * Math.cos(a1) * r, 0.04);
    }
  }
  halo(b, p.x + fx * 0.8, 0.9, p.z + fz * 0.8, 3, 2.2, rot, PAL.neonCyan, 0.12);
}

function tyres(b: EnvBuilders, p: MeetPropSpec, rng: () => number): void {
  b.props.color(0x121417, 1);
  for (let i = 0; i < 4; i++) {
    const ox = (rng() - 0.5) * 0.12;
    const oz = (rng() - 0.5) * 0.12;
    const a = p.heading + rng();
    const y0 = i * 0.26;
    b.props.orientedBox(p.x + ox, p.z + oz, Math.cos(a), Math.sin(a), 0.66, 0.66, y0, y0 + 0.24);
    b.props.orientedBox(p.x + ox, p.z + oz, Math.cos(a + 0.785), Math.sin(a + 0.785), 0.66, 0.66, y0, y0 + 0.24);
  }
}

function cones(b: EnvBuilders, p: MeetPropSpec): void {
  const spots: Array<[number, number]> = [[-0.55, -0.5], [0.5, -0.6], [0.6, 0.45], [-0.4, 0.55]];
  for (const [ox, oz] of spots) {
    const x = p.x + ox;
    const z = p.z + oz;
    b.props.color(0x16181c, 1);
    b.props.box(x, 0.03, z, 0.38, 0.06, 0.38);
    b.props.color(0xff5a1f, 1.25);
    b.props.box(x, 0.2, z, 0.28, 0.28, 0.28, { top: false });
    b.props.color(0xe8e8e8, 1.1);
    b.props.box(x, 0.4, z, 0.21, 0.12, 0.21, { top: false });
    b.props.color(0xff5a1f, 1.25);
    b.props.box(x, 0.55, z, 0.14, 0.18, 0.14);
  }
}

/** A folding table: cans, a lantern. */
function table(b: EnvBuilders, p: MeetPropSpec): void {
  const { fx, fz, rx, rz, along, across, height } = frame(p);
  b.props.color(0x9aa3ab, 1.1);
  b.props.orientedBox(p.x, p.z, rx, rz, across, along, height - 0.05, height);
  b.props.color(PAL.metalDark, 1);
  for (const c of [-1, 1]) for (const a of [-1, 1]) {
    b.props.box(p.x + rx * c * (across / 2 - 0.1) + fx * a * (along / 2 - 0.1), (height - 0.05) / 2, p.z + rz * c * (across / 2 - 0.1) + fz * a * (along / 2 - 0.1), 0.05, height - 0.05, 0.05);
  }
  b.props.color(0xc0262e, 1.2);
  for (const c of [-0.5, -0.3, 0.1]) b.props.box(p.x + rx * c, height + 0.07, p.z + rz * c, 0.07, 0.13, 0.07);
  b.neon.color(0xffd9a0, 1);
  b.neon.tube(p.x + rx * 0.6, height, p.z + rz * 0.6, p.x + rx * 0.6, height + 0.25, p.z + rz * 0.6, 0.12);
  halo(b, p.x + rx * 0.6, height + 0.15, p.z + rz * 0.6, 1.6, 1.2, 0, 0xffd9a0, 0.25);
  groundGlow(b, p.x, p.z, 5, 5, 0xffd9a0, 0.16, Y.glow);
}

/** The green highway sign over the way in, both faces lit: an arrow and three lines of text. */
function sign(b: EnvBuilders, p: MeetPropSpec): void {
  const { fx, fz, height } = frame(p);
  const rx = -fz;
  const rz = fx;
  const w = 5.2;
  const h = 2.2;
  const y = height - h / 2 - 0.2;
  b.props.color(PAL.metalDark, 1.1);
  for (const c of [-w / 2 + 0.3, w / 2 - 0.3]) b.props.box(p.x + rx * c, (y - h / 2) / 2, p.z + rz * c, 0.2, y - h / 2, 0.2);
  b.props.color(0x0b4a2c, 1);
  b.props.orientedBox(p.x, p.z, rx, rz, w, 0.14, y - h / 2, y + h / 2);
  for (const side of [1, -1]) {
    const nx = fx * side;
    const nz = fz * side;
    const ox = p.x + nx * 0.08;
    const oz = p.z + nz * 0.08;
    const rot = faceRot(nx, nz);
    // Across the face, left to right as it is read from this side.
    const lx = rx * side;
    const lz = rz * side;
    b.neon.color(0x0e7a44, 0.5);
    b.neon.panel(ox, y, oz, w - 0.1, h - 0.1, rot);
    b.neon.color(0xeaf4f0, 0.95);
    const p0 = (a: number, up: number): [number, number, number] => [ox + nx * 0.01 + lx * a, y + up, oz + nz * 0.01 + lz * a];
    const t = (a0: number, u0: number, a1: number, u1: number, wd: number): void => {
      const [x0, y0, z0] = p0(a0, u0);
      const [x1, y1, z1] = p0(a1, u1);
      b.neon.tube(x0, y0, z0, x1, y1, z1, wd);
    };
    // Border.
    t(-w / 2 + 0.15, -h / 2 + 0.15, w / 2 - 0.15, -h / 2 + 0.15, 0.05);
    t(-w / 2 + 0.15, h / 2 - 0.15, w / 2 - 0.15, h / 2 - 0.15, 0.05);
    t(-w / 2 + 0.15, -h / 2 + 0.15, -w / 2 + 0.15, h / 2 - 0.15, 0.05);
    t(w / 2 - 0.15, -h / 2 + 0.15, w / 2 - 0.15, h / 2 - 0.15, 0.05);
    // The arrow: up and bending left, like an exit.
    t(-1.5, -0.7, -1.5, 0.2, 0.16);
    t(-1.5, 0.2, -1.95, -0.2, 0.14);
    t(-1.5, 0.2, -1.05, -0.2, 0.14);
    // Text, as bars.
    t(-0.6, 0.45, 1.9, 0.45, 0.22);
    t(-0.6, 0.0, 1.3, 0.0, 0.16);
    t(-0.6, -0.45, 1.6, -0.45, 0.16);
    halo(b, ox + nx * 0.4, y, oz + nz * 0.4, w + 1.5, h + 1.2, rot, 0x2ee08a, 0.08);
  }
}

/* ------------------------------------------------------------------ the cars' light */

/** Underglow on the asphalt, the sill tubes, and the lamps a car was left with on. */
function buildCarLight(b: EnvBuilders, c: MeetCarSpec): void {
  const { fx, fz } = headingForward(c.heading);
  const rx = -fz;
  const rz = fx;
  const at = (a: number, s: number): [number, number] => [c.x + fx * a + rx * s, c.z + fz * a + rz * s];
  glowPool(b, c.x, c.z, fx, fz, 7.4, 4.6, c.glow, 0.5);
  glowPool(b, c.x, c.z, fx, fz, 5.2, 2.6, c.glow, 0.5, Y.glow + 0.005);
  b.neon.color(c.glow, 1);
  for (const side of [-1, 1]) {
    const [x0, z0] = at(-1.8, (MEET_CAR_HALF.across - 0.02) * side);
    const [x1, z1] = at(1.8, (MEET_CAR_HALF.across - 0.02) * side);
    b.neon.tube(x0, 0.1, z0, x1, 0.1, z1, 0.06);
  }
  for (const a of [-2.02, 2.02]) {
    const [x0, z0] = at(a, -0.62);
    const [x1, z1] = at(a, 0.62);
    b.neon.tube(x0, 0.08, z0, x1, 0.08, z1, 0.05);
  }
  if (c.head) {
    const rot = faceRot(fx, fz);
    b.neon.color(0xeef6ff, 1);
    for (const side of [-1, 1]) {
      const [hx, hz] = at(2.13, 0.6 * side);
      b.neon.panel(hx, 0.6, hz, 0.34, 0.12, rot);
    }
    const [nx, nz] = at(2.6, 0);
    halo(b, nx, 0.6, nz, 2.6, 1.0, rot, 0xdfefff, 0.2);
    const [px, pz] = at(7, 0);
    glowPool(b, px, pz, fx, fz, 9, 4.2, 0xdfefff, 0.2);
  }
  if (c.tail) {
    const [tx, tz] = at(-3.2, 0);
    glowPool(b, tx, tz, fx, fz, 2.6, 2.6, 0xff1a2e, 0.2);
  }
}
