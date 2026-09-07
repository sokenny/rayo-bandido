import { PAL } from './palette';
import { BARK_TILE, FOLIAGE_TILE, type EnvBuilders } from './builders';

/**
 * THE PLANT KIT — every growing thing in the city, from one small set of parts.
 *
 * Nothing here is a species; each archetype is a recipe that a seeded rng shakes into a
 * different plant every time it is called. What they share is the construction: opaque,
 * faceted CANOPY BLOBS instead of alpha-cut leaf cards, four-sided tapered SHAFTS for trunks
 * and branches, and crossed cards only for the small stuff at ground level where a card is
 * cheaper than a blob and reads better anyway.
 *
 * WHY BLOBS
 * A canopy drawn as alpha-tested leaf planes is the classic way and the wrong one here: it
 * costs overdraw, it needs sorting or an alpha test, and at night it reads as grey fuzz. A
 * closed six-lune blob is ten triangles, is opaque, silhouettes cleanly against the neon and
 * takes the leaf texture across its facets so it still shows leaf detail up close.
 *
 * COST (triangles, typical)
 *   weeds 6 · fern 8 · shrub 10-22 · vine 8-16 · sapling 16 · deadTree ~32
 *   crookedTree ~46 · canopyTree ~90 · palm ~116
 *
 * Everything lands in the two shared greenery builders — `foliage` (leaf) and `bark` (wood) —
 * so however much of this the city grows, it is still two draw calls. Nothing here allocates
 * per frame; it all runs once, while the city is generated.
 */

/** Cross-section corners, clockwise seen from above, so a shaft's side quads face outward. */
const CORNERS: ReadonlyArray<readonly [number, number]> = [[-1, -1], [1, -1], [1, 1], [-1, 1]];

/**
 * A four-sided tapered column between two points, square in plan: a trunk, a branch, a stem.
 * Solid from every angle, which two crossed quads are not — the bark material is single-sided.
 */
export function shaft(
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
  // Bark runs up the shaft in world metres and is continuous from segment to segment, and
  // each of the four faces takes its own slice across, so the grain never wraps at a corner.
  const u = (2 * r0) / BARK_TILE;
  const v0 = y0 / BARK_TILE;
  const v1 = y1 / BARK_TILE;
  for (let k = 0; k < 4; k++) {
    const ax = CORNERS[k][0];
    const az = CORNERS[k][1];
    const bx = CORNERS[(k + 1) % 4][0];
    const bz = CORNERS[(k + 1) % 4][1];
    b.bark.quad(
      x0 + bx * r0, y0, z0 + bz * r0,
      x0 + ax * r0, y0, z0 + az * r0,
      x1 + ax * r1, y1, z1 + az * r1,
      x1 + bx * r1, y1, z1 + bz * r1,
      k * u, v0, (k + 1) * u, v1,
    );
  }
}

/** A random window into the leaf tile, so two faces are never the same photograph. */
function leafUv(rng: () => number, span = 0.34): { u0: number; v0: number; u1: number; v1: number } {
  const u0 = rng() * (1 - span);
  const v0 = rng() * (1 - span);
  return { u0, v0, u1: u0 + span, v1: v0 + span };
}

/**
 * A closed, faceted lump of leaf: `sides` lunes between a top and a bottom apex, every
 * vertex jittered so no two blobs are the same shape and none of them reads as a sphere.
 * Two triangles a lune, so five sides is ten triangles and a whole canopy is fifty.
 */
export function canopyBlob(
  b: EnvBuilders,
  cx: number,
  cy: number,
  cz: number,
  rx: number,
  ry: number,
  rz: number,
  sides: number,
  rng: () => number,
): void {
  const ringX: number[] = [];
  const ringY: number[] = [];
  const ringZ: number[] = [];
  for (let i = 0; i < sides; i++) {
    const a = ((i + rng() * 0.22) / sides) * Math.PI * 2;
    // Gentle radius jitter only. Push it further and the ring turns the blob into a star,
    // which is the one shape a canopy must never be.
    const r = 0.88 + rng() * 0.22;
    ringX.push(cx + Math.cos(a) * rx * r);
    ringY.push(cy + (rng() - 0.5) * ry * 0.3);
    ringZ.push(cz + Math.sin(a) * rz * r);
  }
  // Apexes near the ring's own radius, so the lump reads as a squashed ball rather than a
  // spindle or a plate. The ring carries the silhouette; the poles close it.
  const topX = cx + (rng() - 0.5) * rx * 0.3;
  const topY = cy + ry * (0.72 + rng() * 0.2);
  const topZ = cz + (rng() - 0.5) * rz * 0.3;
  const botX = cx + (rng() - 0.5) * rx * 0.3;
  const botY = cy - ry * (0.6 + rng() * 0.2);
  const botZ = cz + (rng() - 0.5) * rz * 0.3;
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    const uv = leafUv(rng, 0.4);
    // top, ring[i] (left seen from outside), bottom, ring[i+1] (right): counter-clockwise
    // from the outside, so the lune faces away from the centre.
    b.foliage.quad(
      topX, topY, topZ,
      ringX[i], ringY[i], ringZ[i],
      botX, botY, botZ,
      ringX[j], ringY[j], ringZ[j],
      uv.u0, uv.v0, uv.u1, uv.v1,
    );
  }
}

/**
 * A flat card of leaf standing at (x, z), `w` wide and `h` tall, facing `angle`, leaning by
 * `lean` at the top. Drawn twice, back to back a centimetre apart, so it reads from both
 * sides without a two-sided material: the cheapest unit of greenery there is.
 */
function leafCard(
  b: EnvBuilders,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  angle: number,
  leanX: number,
  leanZ: number,
  rng: () => number,
): void {
  const dx = Math.cos(angle);
  const dz = Math.sin(angle);
  const hw = w / 2;
  const uv = leafUv(rng, 0.45);
  const tx = x + leanX;
  const tz = z + leanZ;
  b.foliage.quad(
    x - dx * hw, y, z - dz * hw,
    x + dx * hw, y, z + dz * hw,
    tx + dx * hw * 0.7, y + h, tz + dz * hw * 0.7,
    tx - dx * hw * 0.7, y + h, tz - dz * hw * 0.7,
    uv.u0, uv.v0, uv.u1, uv.v1,
  );
  b.foliage.quad(
    x + dx * hw, y, z + dz * hw,
    x - dx * hw, y, z - dz * hw,
    tx - dx * hw * 0.7, y + h, tz - dz * hw * 0.7,
    tx + dx * hw * 0.7, y + h, tz + dz * hw * 0.7,
    uv.u0, uv.v0, uv.u1, uv.v1,
  );
}

/**
 * Leaf colour with a per-plant shift, and a dead plant's bleached straw instead.
 *
 * The multipliers run well over 1 on purpose. The city's night is a hemisphere light at 1.9
 * over a dark teal sky, so an unbiased mid-green leaf comes out at a few percent of white and
 * a canopy disappears into the asphalt. Between this and `MeshBuilder.normalUp` the greenery
 * sits where the concept art has it: clearly a plant, still a night-time one.
 */
function leafTint(b: EnvBuilders, rng: () => number, dry: number, mul = 1): void {
  const dead = rng() < dry;
  b.foliage.color(dead ? PAL.foliageDry : PAL.foliage, (dead ? 1.0 : 1.25) * mul + rng() * 0.45);
}

/* ------------------------------------------------------------------ archetypes */

export interface PlantOptions {
  /** Overall size multiplier. 1 is the archetype's natural size. */
  scale?: number;
  /** How much of this plant is dead or dying: 0 healthy, 1 all straw. */
  dry?: number;
  /** Metres of clearance around the plant at ground level. Canopies and fronds are clamped to it. */
  room?: number;
  /**
   * Metres a CANOPY may spread, when it is high enough to be over the road rather than in it
   * (`OVERHANG_CLEAR`). A street tree that cannot lean out over the kerb is a shrub on a
   * stick; this is what lets one lean over the traffic the way the concept art does, while
   * `room` still holds everything at head height back onto the pavement. No collider changes:
   * only leaves cross the kerb line, and only well above anything that drives under them.
   */
  canopyRoom?: number;
  /** Direction the plant leans and reaches, usually away from the wall behind it. */
  outX?: number;
  outZ?: number;
}

/**
 * How high a canopy has to be before it is allowed to spread past `room` and out over the
 * road. A bus is the tallest thing in the city at about 3.4 m, so this leaves a metre on top
 * of it; everything below stays inside the pavement.
 */
export const OVERHANG_CLEAR = 4.6;

/**
 * How far out from the trunk anything may reach at height `y` above the plant's own base:
 * `room` — the clear pavement — until it is over the traffic rather than in it, and
 * `canopyRoom` above that. Every archetype runs its canopy, its fronds and the lean of its
 * own trunk through this, which is what guarantees that nothing a car can hit ever crosses
 * the kerb line and that only leaves, well overhead, ever do.
 */
function reachAt(y: number, room: number, canopyRoom: number | undefined): number {
  return y >= OVERHANG_CLEAR && canopyRoom !== undefined ? Math.max(room, canopyRoom) : room;
}

/**
 * Pulls a point back toward the trunk until its outward edge is inside `limit`. Only the
 * outward component is touched: growing sideways along the wall, or back against it, is what
 * a plant in a gap does anyway.
 */
function clampOut(
  px: number,
  pz: number,
  x: number,
  z: number,
  outX: number,
  outZ: number,
  radius: number,
  limit: number,
): [number, number] {
  const out = (px - x) * outX + (pz - z) * outZ;
  const over = out + radius - limit;
  if (over <= 0) return [px, pz];
  return [px - outX * over, pz - outZ * over];
}

/**
 * The most a trunk may lean out from where it is planted.
 *
 * With no `canopyRoom` the caller is saying nothing may leave the pavement at any height, so
 * the lean is simply `room`. With one, the trunk may cross the kerb line as long as it does
 * so above the traffic: a trunk is a straight run from the ground to `h`, so it passes `room`
 * at `h * room / lean`, and requiring that to be over `OVERHANG_CLEAR` caps the lean at
 * `h * room / OVERHANG_CLEAR` — and never past `canopyRoom` itself.
 */
function leanCap(h: number, room: number, canopyRoom: number | undefined, bend = 1): number {
  if (canopyRoom === undefined) return room * 0.8;
  // A trunk that bends as u^2 rather than running straight reaches `room` later, so it may
  // lean further for the same clearance.
  const straight = (h * room) / OVERHANG_CLEAR;
  return Math.min(Math.max(room, canopyRoom), bend === 1 ? straight : room * Math.pow(h / OVERHANG_CLEAR, 2));
}

/**
 * A big, irregular broad-canopy tree: a leaning trunk, two or three limbs, and a canopy of
 * overlapping blobs that is never symmetrical. The only plant in the kit that reads as a
 * landmark, so it is placed sparingly and only in real pockets.
 */
export function canopyTree(b: EnvBuilders, x: number, y0: number, z: number, rng: () => number, o: PlantOptions = {}): void {
  const s = o.scale ?? 1;
  const dry = o.dry ?? 0;
  const room = o.room ?? 4;
  const outX = o.outX ?? 0;
  const outZ = o.outZ ?? 0;
  // Tall on purpose: the crown has to clear a bus before it is allowed to lean over the road.
  const h = (6.5 + rng() * 4.5) * s;
  // The lean is capped so the trunk only crosses the kerb line above the traffic.
  const lean = Math.min((0.5 + rng() * 1.1) * s, leanCap(h, room, o.canopyRoom));
  const topX = x + outX * lean + (rng() - 0.5) * 0.8;
  const topZ = z + outZ * lean + (rng() - 0.5) * 0.8;
  const r = (0.22 + rng() * 0.16) * s;

  // Trunk in two segments, flared at the root, bending toward the light.
  b.bark.color(PAL.bark, 0.85 + rng() * 0.35);
  const midX = x + (topX - x) * 0.45;
  const midZ = z + (topZ - z) * 0.45;
  shaft(b, x, y0 - 0.3, z, r * 1.7, midX, y0 + h * 0.5, midZ, r * 1.05);
  shaft(b, midX, y0 + h * 0.5, midZ, r * 1.05, topX, y0 + h, topZ, r * 0.6);

  // Limbs out of the crotch, each carrying its own lump of canopy. The crown may spread past
  // the pavement only when it is genuinely over the traffic rather than in it.
  const limbs = 3;
  const spread = Math.min(Math.max(room, o.canopyRoom ?? room), (2.2 + rng() * 2.2) * s);
  const phase = rng() * Math.PI * 2;
  /** One lump of canopy, pulled back onto the pavement if it is not yet over the traffic. */
  const lump = (cx: number, cy: number, cz: number, rx: number, ry: number, sides: number): void => {
    const limit = reachAt(cy - ry - y0, room, o.canopyRoom);
    const [px, pz] = clampOut(cx, cz, x, z, outX, outZ, rx, limit);
    canopyBlob(b, px, cy, pz, rx, ry, rx, sides, rng);
  };
  for (let i = 0; i < limbs; i++) {
    const a = phase + (i / limbs) * Math.PI * 2 + (rng() - 0.5) * 0.6;
    const reach = spread * (0.5 + rng() * 0.5);
    const ey = y0 + h + (rng() - 0.35) * 1.1 * s;
    const [ex, ez] = clampOut(topX + Math.cos(a) * reach, topZ + Math.sin(a) * reach, x, z, outX, outZ, 0, reachAt(ey - y0, room, o.canopyRoom));
    b.bark.color(PAL.bark, 0.8 + rng() * 0.3);
    shaft(b, topX, y0 + h * 0.86, topZ, r * 0.6, ex, ey, ez, r * 0.28);
    // One lump a limb, and a smaller one under about half of them: the silhouette has to be
    // lumpy or the canopy reads as a handful of kites hanging in the air, but a second lump
    // on every limb is twelve triangles nobody sees.
    leafTint(b, rng, dry);
    lump(ex, ey + 0.3 * s, ez, spread * (0.5 + rng() * 0.35), (0.8 + rng() * 0.5) * s, 6);
    if (rng() < 0.5) {
      leafTint(b, rng, dry, 0.82);
      lump(
        ex + Math.cos(a + 1.3) * spread * 0.4, ey - (0.3 + rng() * 0.5) * s, ez + Math.sin(a + 1.3) * spread * 0.4,
        spread * (0.34 + rng() * 0.26), (0.55 + rng() * 0.35) * s, 5,
      );
    }
  }
  // One more lump over the crown, so the silhouette closes at the top.
  leafTint(b, rng, dry, 1.12);
  lump(topX, y0 + h + 0.75 * s, topZ, spread * 0.8, (0.9 + rng() * 0.5) * s, 6);
}

/**
 * A smaller street tree that has grown crooked out of a gap in the paving: one bent trunk,
 * two lumps of canopy, thin. The workhorse of a reclaimed pocket.
 */
export function crookedTree(b: EnvBuilders, x: number, y0: number, z: number, rng: () => number, o: PlantOptions = {}): void {
  const s = o.scale ?? 1;
  const dry = o.dry ?? 0;
  const room = o.room ?? 3;
  const outX = o.outX ?? 0;
  const outZ = o.outZ ?? 0;
  const h = (4.2 + rng() * 3) * s;
  // A crooked tree bends twice, and the second bend is the one you notice — but never so far
  // that the trunk crosses the kerb line below head height.
  const bend = Math.min((0.5 + rng() * 0.9) * s, leanCap(h, room, o.canopyRoom) * 0.5);
  const a1 = rng() * Math.PI * 2;
  const m1x = x + Math.cos(a1) * bend * 0.4 + outX * bend * 0.3;
  const m1z = z + Math.sin(a1) * bend * 0.4 + outZ * bend * 0.3;
  const topX = m1x + outX * bend + (rng() - 0.5) * bend;
  const topZ = m1z + outZ * bend + (rng() - 0.5) * bend;
  const r = (0.12 + rng() * 0.1) * s;
  b.bark.color(PAL.bark, 0.8 + rng() * 0.4);
  shaft(b, x, y0 - 0.2, z, r * 1.6, m1x, y0 + h * 0.55, m1z, r);
  shaft(b, m1x, y0 + h * 0.55, m1z, r, topX, y0 + h, topZ, r * 0.55);
  const spread = Math.min(Math.max(room, o.canopyRoom ?? room), (1.5 + rng() * 1.4) * s);
  const lumps = 2 + (rng() < 0.45 ? 1 : 0);
  for (let i = 0; i < lumps; i++) {
    const a = rng() * Math.PI * 2;
    const d = spread * (0.15 + rng() * 0.55);
    const cy = y0 + h + (0.05 + rng() * 0.7) * s;
    const rx = spread * (0.5 + rng() * 0.45);
    const ry = (0.55 + rng() * 0.4) * s;
    const [px, pz] = clampOut(topX + Math.cos(a) * d, topZ + Math.sin(a) * d, x, z, outX, outZ, rx, reachAt(cy - ry - y0, room, o.canopyRoom));
    leafTint(b, rng, dry, i === 0 ? 1 : 0.85);
    canopyBlob(b, px, cy, pz, rx, ry, rx, i === 0 ? 6 : 5, rng);
  }
}

/**
 * One tapered blade of a palm frond, drawn twice: the top face and, 4 cm below it, the
 * underside with the winding reversed, which gives the frond thickness against the sky.
 */
function blade(
  b: EnvBuilders,
  px: number, py: number, pz: number, pw: number,
  qx: number, qy: number, qz: number, qw: number,
  nx: number, nz: number,
  u0: number, v0: number, u1: number, v1: number,
): void {
  const ax = px - nx * pw;
  const az = pz - nz * pw;
  const bx = px + nx * pw;
  const bz = pz + nz * pw;
  const cx = qx + nx * qw;
  const cz = qz + nz * qw;
  const dx = qx - nx * qw;
  const dz = qz - nz * qw;
  b.foliage.quad(ax, py + 0.02, az, bx, py + 0.02, bz, cx, qy + 0.02, cz, dx, qy + 0.02, dz, u0, v0, u1, v1);
  b.foliage.quad(dx, qy - 0.02, dz, cx, qy - 0.02, cz, bx, py - 0.02, bz, ax, py - 0.02, az, u0, v0, u1, v1);
}

/**
 * A palm: a curved, tapered trunk with a flared root and old leaf scars banded up it, a boot
 * of dead frond stubs under the crown, and a crown whose fronds droop by their own length.
 * Now with a proper taper — thick at the root, thin under the boot — and a ring of hanging
 * dead fronds, which is what a neglected palm actually looks like.
 *
 * `room` is the metres of clear space between the trunk and whatever stands behind it: no
 * frond is allowed to reach further in than that, so a palm on a narrow pavement keeps its
 * crown out of the wall.
 */
export function palm(b: EnvBuilders, x: number, y0: number, z: number, rng: () => number, o: PlantOptions = {}): void {
  const s = o.scale ?? 1;
  const dry = o.dry ?? 0.2;
  const room = o.room ?? 3;
  const outX = o.outX ?? 0;
  const outZ = o.outZ ?? 0;
  // Squared, so most palms are young and short and a few are old giants: a row of identical
  // trees reads as wallpaper.
  const t = rng();
  const h = (4.5 + t * t * 9) * s;
  // A palm's trunk bends as the square of its height, so it passes `room` later than a
  // straight one; the cap keeps that point over the traffic all the same.
  const lean = Math.min((0.5 + t * 1.5) * s, leanCap(h, room, o.canopyRoom, 2));
  const drift = (rng() - 0.5) * 1.1;
  const topX = x + outX * lean - outZ * drift;
  const topZ = z + outZ * lean + outX * drift;
  const r = (0.2 + t * 0.16) * s;

  // Four segments now rather than three, and the taper runs the whole way: a palm trunk is
  // fat at the ground and about half that under the crown.
  const segs = 4;
  let px = x;
  let py = y0 - 0.25;
  let pz = z;
  let pr = r * 1.9;
  for (let i = 1; i <= segs; i++) {
    const u = i / segs;
    const bend = u * u;
    const nx = x + (topX - x) * bend;
    const nz = z + (topZ - z) * bend;
    const ny = y0 + h * u;
    const nr = r * (1.35 - 0.7 * u);
    // Alternating bands: the old leaf scars that ring a palm trunk.
    b.bark.color(PAL.bark, i % 2 ? 0.9 : 1.2);
    shaft(b, px, py, pz, pr, nx, ny, nz, nr);
    px = nx;
    py = ny;
    pz = nz;
    pr = nr;
  }
  // The boot: the stub of old fronds where the crown meets the trunk.
  b.bark.color(PAL.bark, 1.2);
  b.bark.box(topX, y0 + h + 0.15, topZ, r * 2.4, 0.8, r * 2.4, { tileW: BARK_TILE, tileH: BARK_TILE });

  const fronds = 7 + Math.floor(rng() * 4);
  const phase = rng() * Math.PI * 2;
  const cy = y0 + h + 0.4;
  for (let i = 0; i < fronds; i++) {
    const a = phase + (i / fronds) * Math.PI * 2 + (rng() - 0.5) * 0.35;
    const fx = Math.cos(a);
    const fz = Math.sin(a);
    let len = (1.5 + h * 0.3) * (0.8 + rng() * 0.4);
    // How much of this frond points at the wall, and how far it may go before it hits it.
    const inward = -(fx * outX + fz * outZ);
    if (inward > 0.05) len = Math.min(len, Math.max(1.1, (room + lean - 0.4) / inward));
    // A dead frond has collapsed: it hangs almost straight down against the trunk.
    const dead = rng() < dry;
    const droop = dead ? len * (1.1 + rng() * 0.4) : len * (0.45 + rng() * 0.35);
    // And how far it may reach the other way, out over the kerb. A tall palm's crown is well
    // clear of the traffic and may lean out over it; a short one has to stay on its pavement.
    const outward = fx * outX + fz * outZ;
    if (outward > 0.05) {
      const tipY = cy - droop - y0;
      len = Math.min(len, Math.max(0.6, (reachAt(tipY, room, o.canopyRoom) - lean) / outward));
    }
    const nx = -fz;
    const nz = fx;
    const reach = dead ? len * 0.45 : len;
    const mx = topX + fx * reach * 0.55;
    const mz = topZ + fz * reach * 0.55;
    const my = cy + 0.25 - droop * 0.2;
    const ex = topX + fx * reach;
    const ez = topZ + fz * reach;
    const ey = cy - droop;
    const shade = 0.95 + rng() * 0.45;
    // Each frond takes its own window into the leaf tile — a random third of it, across and
    // down — so a crown of ten blades is ten different bits of foliage rather than the same
    // photograph ten times.
    const wu = 0.34;
    const wv = Math.min(0.9, (len / FOLIAGE_TILE) * 0.34);
    const u0 = rng() * (1 - wu);
    const v0 = rng() * (1 - wv);
    const tint = dead ? PAL.foliageDry : PAL.foliage;
    b.foliage.color(tint, shade * (dead ? 0.8 : 1));
    blade(b, topX + fx * 0.22, cy, topZ + fz * 0.22, 0.14 * s, mx, my, mz, 0.5 * s, nx, nz, u0, v0, u0 + wu, v0 + wv * 0.55);
    // The drooping half catches more of the sky, so it sits a touch brighter.
    b.foliage.color(tint, shade * (dead ? 0.8 : 1) + 0.2);
    blade(b, mx, my, mz, 0.5 * s, ex, ey, ez, 0.1 * s, nx, nz, u0, v0 + wv * 0.55, u0 + wu, v0 + wv);
  }
}

/** A volunteer sapling: one thin whippy stem out of a crack, three leaves, no ceremony. */
export function sapling(b: EnvBuilders, x: number, y0: number, z: number, rng: () => number, o: PlantOptions = {}): void {
  const s = o.scale ?? 1;
  const cap = o.room ?? Infinity;
  const h = (1.1 + rng() * 1.4) * s;
  const outX = o.outX ?? 0;
  const outZ = o.outZ ?? 0;
  const lean = Math.min((0.2 + rng() * 0.5) * s, cap * 0.5);
  const topX = x + outX * lean + (rng() - 0.5) * 0.4;
  const topZ = z + outZ * lean + (rng() - 0.5) * 0.4;
  b.bark.color(PAL.bark, 0.75 + rng() * 0.35);
  shaft(b, x, y0 - 0.1, z, 0.05 * s, topX, y0 + h, topZ, 0.025 * s);
  leafTint(b, rng, o.dry ?? 0.1);
  const sr = Math.min((0.32 + rng() * 0.24) * s, Math.max(0.12, cap - lean));
  canopyBlob(b, topX, y0 + h + 0.12 * s, topZ, sr, (0.28 + rng() * 0.2) * s, sr, 4, rng);
}

/** A coarse shrub: one or two lumps sitting straight on the ground, wider than they are tall. */
export function shrub(b: EnvBuilders, x: number, y0: number, z: number, rng: () => number, o: PlantOptions = {}): void {
  const s = o.scale ?? 1;
  const dry = o.dry ?? 0.12;
  // `room` is a hard radius here: a shrub at the foot of a wall on a metre of pavement has to
  // be a metre of shrub, however big its scale would like it to be.
  const cap = o.room ?? Infinity;
  const w = Math.min((0.55 + rng() * 0.75) * s, cap);
  const h = (0.4 + rng() * 0.55) * s;
  leafTint(b, rng, dry);
  canopyBlob(b, x, y0 + h * 0.8, z, w, h, Math.min(w * (0.7 + rng() * 0.5), cap), 6, rng);
  // One satellite at most. The city grows thousands of these, and the difference between one
  // lump and three is twenty triangles a shrub — which is tens of thousands across the map.
  const extra = rng() < 0.55 ? 1 : 0;
  for (let i = 0; i < extra; i++) {
    const a = rng() * Math.PI * 2;
    const r2 = w * 0.6;
    const d = Math.min(w * (0.5 + rng() * 0.55), Math.max(0, cap - r2));
    leafTint(b, rng, dry, i === 0 ? 1.15 : 0.8);
    canopyBlob(b, x + Math.cos(a) * d, y0 + h * (0.45 + rng() * 0.4), z + Math.sin(a) * d, r2, h * 0.7, r2, 5, rng);
  }
}

/** A fern or broad-leaf clump: a rosette of cards splaying out of one point. */
export function fern(b: EnvBuilders, x: number, y0: number, z: number, rng: () => number, o: PlantOptions = {}): void {
  const s = o.scale ?? 1;
  const cap = o.room ?? Infinity;
  const n = 2 + Math.floor(rng() * 2);
  const h = (0.4 + rng() * 0.5) * s;
  const phase = rng() * Math.PI;
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * Math.PI;
    const lean = Math.min((0.18 + rng() * 0.3) * s, cap * 0.5);
    const w = Math.min((0.4 + rng() * 0.4) * s, Math.max(0.12, (cap - lean) * 2));
    leafTint(b, rng, o.dry ?? 0.1);
    leafCard(b, x, y0, z, w, h * (0.7 + rng() * 0.6), a, Math.cos(a + 1.2) * lean, Math.sin(a + 1.2) * lean, rng);
  }
}

/**
 * A tuft of tall grass or weed: two crossed cards, eight triangles (each card is drawn from
 * both sides, which is what lets the whole greenery share one single-sided material). This is
 * the thing that actually sells neglect — and the city grows thousands of them, so its cost
 * is the one in the kit that is worth counting twice. Two cards rather than three is the
 * difference between 8 and 12 triangles a tuft, and nobody can tell them apart at a metre.
 */
export function weeds(b: EnvBuilders, x: number, y0: number, z: number, rng: () => number, o: PlantOptions = {}): void {
  const s = o.scale ?? 1;
  const dry = o.dry ?? 0.35;
  const cap = o.room ?? Infinity;
  const h = (0.28 + rng() * 0.5) * s;
  const phase = rng() * Math.PI;
  for (let i = 0; i < 2; i++) {
    const a = phase + (i / 2) * Math.PI;
    const lean = (rng() - 0.5) * 0.28 * s;
    const w = Math.min((0.26 + rng() * 0.34) * s, Math.max(0.1, (cap - Math.abs(lean) - 0.07) * 2));
    leafTint(b, rng, dry);
    leafCard(b, x + (rng() - 0.5) * 0.14, y0, z + (rng() - 0.5) * 0.14, w, h * (0.7 + rng() * 0.7), a, Math.cos(a) * lean, Math.sin(a) * lean, rng);
  }
}

/** A dead thing: a bare stem and three or four bare branches. No leaves at all. */
export function deadTree(b: EnvBuilders, x: number, y0: number, z: number, rng: () => number, o: PlantOptions = {}): void {
  const s = o.scale ?? 1;
  const h = (1.8 + rng() * 2.4) * s;
  const lean = (rng() - 0.5) * 0.9 * s;
  const topX = x + lean;
  const topZ = z + (rng() - 0.5) * 0.9 * s;
  b.bark.color(PAL.bark, 0.6 + rng() * 0.25);
  shaft(b, x, y0 - 0.15, z, 0.11 * s, topX, y0 + h, topZ, 0.05 * s);
  const n = 3 + Math.floor(rng() * 2);
  for (let i = 0; i < n; i++) {
    const a = rng() * Math.PI * 2;
    const t = 0.45 + rng() * 0.5;
    const bx = x + (topX - x) * t;
    const bz = z + (topZ - z) * t;
    const by = y0 + h * t;
    const reach = (0.4 + rng() * 0.9) * s;
    b.bark.color(PAL.bark, 0.55 + rng() * 0.25);
    b.bark.tube(bx, by, bz, bx + Math.cos(a) * reach, by + reach * (0.4 + rng() * 0.6), bz + Math.sin(a) * reach, 0.05 * s);
  }
}

/**
 * A vine on a wall or hanging off a lip. `drop` positive hangs it down from (x, y, z);
 * negative climbs it up. `width` is how far it spreads across the face; `(nx, nz)` is the
 * wall's outward normal, `(tx, tz)` the direction across it.
 *
 * Built as a run of narrow cards that follow the face, each one leaning a little further off
 * the wall as it falls, plus a few leaf lumps where the growth is thick. It hugs the surface,
 * so it never reaches out into anywhere a car can be.
 */
export function vine(
  b: EnvBuilders,
  x: number,
  y: number,
  z: number,
  nx: number,
  nz: number,
  tx: number,
  tz: number,
  width: number,
  drop: number,
  rng: () => number,
  o: PlantOptions = {},
): void {
  const dry = o.dry ?? 0.15;
  const strands = Math.max(2, Math.min(6, Math.round(width / (0.7 + rng() * 0.7))));
  const climbing = drop < 0;
  const span = Math.abs(drop);
  for (let i = 0; i < strands; i++) {
    const across = (-0.5 + (i + 0.3 + rng() * 0.4) / strands) * width;
    const sx = x + tx * across;
    const sz = z + tz * across;
    // Each strand is its own length: a curtain with a level bottom edge is a hedge, not a vine.
    const len = span * (0.35 + rng() * 0.75);
    const w = 0.16 + rng() * 0.26;
    // The tail swings off the wall and sideways as it falls — but never far. A vine is the
    // one plant that grows on a surface a car can be pressed right up against, so it stays
    // inside the hand's breadth the collision rule allows for something on a wall face.
    const outLean = (0.08 + rng() * 0.18) * (climbing ? 0.4 : 1);
    const sideLean = (rng() - 0.5) * 0.5;
    const y0 = climbing ? y : y - len;
    const y1 = climbing ? y + len : y;
    const tipX = sx + nx * outLean + tx * sideLean;
    const tipZ = sz + nz * outLean + tz * sideLean;
    const uv = leafUv(rng, 0.4);
    leafTint(b, rng, dry);
    // A tapering ribbon down the wall, drawn from both sides.
    const bottomX = climbing ? sx : tipX;
    const bottomZ = climbing ? sz : tipZ;
    const topX = climbing ? tipX : sx;
    const topZ = climbing ? tipZ : sz;
    const bw = climbing ? w : w * 0.45;
    const tw = climbing ? w * 0.45 : w;
    b.foliage.quad(
      bottomX - tx * bw, y0, bottomZ - tz * bw,
      bottomX + tx * bw, y0, bottomZ + tz * bw,
      topX + tx * tw, y1, topZ + tz * tw,
      topX - tx * tw, y1, topZ - tz * tw,
      uv.u0, uv.v0, uv.u1, uv.v1,
    );
    b.foliage.quad(
      bottomX + tx * bw, y0, bottomZ + tz * bw,
      bottomX - tx * bw, y0, bottomZ - tz * bw,
      topX - tx * tw, y1, topZ - tz * tw,
      topX + tx * tw, y1, topZ + tz * tw,
      uv.u0, uv.v0, uv.u1, uv.v1,
    );
    // A lump of leaf where the growth is heaviest: at the lip it hangs from, or the top of
    // the climb. Only on some strands, or the vine reads as a row of pom-poms. Flattened
    // against the wall — wide across it, thin off it — so a vine can never be the thing that
    // sticks out into the street.
    if (rng() < 0.3) {
      const ly = climbing ? y1 - 0.1 : y - 0.15;
      const across = w * 2.2;
      const off = w * 0.45;
      const alongX = Math.abs(nx) > Math.abs(nz);
      leafTint(b, rng, dry, 1.05);
      canopyBlob(b, sx + nx * 0.05, ly, sz + nz * 0.05, alongX ? off : across, 0.22 + rng() * 0.24, alongX ? across : off, 4, rng);
    }
  }
}

/**
 * Grass and weed along a run: the line of green that comes up through the joint between a
 * wall and the pavement, or along a kerb. `count` tufts spaced unevenly, skipping gaps, so
 * it never reads as a planted border.
 */
export function weedLine(
  b: EnvBuilders,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  y: number,
  count: number,
  rng: () => number,
  o: PlantOptions = {},
): void {
  for (let i = 0; i < count; i++) {
    // Uneven along the run, with a real chance of nothing at all: gaps are the point.
    if (rng() < 0.28) continue;
    const t = (i + rng() * 0.9) / count;
    weeds(b, ax + (bx - ax) * t, y, az + (bz - az) * t, rng, o);
  }
}

/** Every archetype by name, for the scatter tables and the tests. */
export const PLANTS = {
  canopyTree,
  crookedTree,
  palm,
  sapling,
  shrub,
  fern,
  weeds,
  deadTree,
} as const;

export type PlantKind = keyof typeof PLANTS;

/** Rough triangle cost of each archetype, for budgeting a scatter before it is built. */
export const PLANT_COST: Record<PlantKind, number> = {
  canopyTree: 120,
  crookedTree: 62,
  palm: 116,
  sapling: 20,
  shrub: 22,
  fern: 12,
  weeds: 8,
  deadTree: 32,
};
