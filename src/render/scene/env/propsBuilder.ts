import type { GateDef, ZoneId } from '../../../world/cityPlan';
import { PAL } from './palette';
import { makeRng } from './meshBuilder';
import { groundGlow, halo, lampSparks, type EnvBuilders } from './builders';
import { signCell } from './textures';
import { rollLampFault } from './lampFaults';

/**
 * Everything that dresses the streets: guardrails, street lights, the neon route gates from
 * the wet-road reference, holographic billboards and the JDM garage clutter. All of it placed
 * from the plan (`b.plan`), so the test arena and the circuit share every prop.
 *
 * House rule: a prop may only exist where `isSolid()` is true, i.e. inside a collider the
 * simulation already knows about. That single test is what keeps art and collision honest -
 * the player can never drive through a container or clip a lamp post. (The circuit's track
 * builder places its own lamps just outside the guardrails, which the car cannot reach.)
 */
export function buildProps(b: EnvBuilders): void {
  const rng = makeRng(0x7a1ce);
  buildRouteMarkers(b);
  buildPylons(b);
  buildBarriers(b, rng);
  buildStreetLights(b, rng);
  buildGates(b);
  buildBillboards(b);
  buildCables(b, rng);
  buildBladeSigns(b, rng);
  buildBlockClutter(b, rng);
}

/**
 * Projecting shop signs that stick out of the facade and are read along the street - the
 * single most recognisable element of the approved reference. Two back-to-back panels each,
 * hung well above head height so nothing here can ever be driven into.
 */
function buildBladeSigns(b: EnvBuilders, rng: () => number): void {
  const SQUARE = [0, 1, 3, 6, 8, 9, 11, 14];
  const TALL = [13, 4, 7, 5];
  const isRoad = b.plan.isRoad;
  for (const blk of b.plan.blocks) {
    walkLedge(blk, 3.5, 11, (x, z, dx, dz) => {
      if (!isRoad(x + dx * 7, z + dz * 7) && !isRoad(x + dx * 11, z + dz * 11)) return;
      // Rare on purpose. A few blades read as a street; one on every ledge reads as clutter.
      if (rng() > 0.34) return;
      const tall = rng() < 0.4;
      const cell = tall ? TALL[Math.floor(rng() * TALL.length)] : SQUARE[Math.floor(rng() * SQUARE.length)];
      const uv = signCell(cell);
      const w = tall ? 1.9 : 2.6 + rng() * 1.2;
      const h = tall ? 5.5 + rng() * 2 : w;
      const out = 1.4 + w / 2;
      const y = 7 + rng() * 7;
      // The ledge is the block's edge, not a wall: the plot behind it may be empty, or set
      // back, or carry a building that stops below this. Without a wall to bracket onto, the
      // blade and its arm would hang over the pavement on nothing.
      if (!b.walls.faceAt(x, y, z, dx, dz) || !b.walls.faceAt(x, y + h / 2, z, dx, dz)) return;
      const px = x + dx * out;
      const pz = z + dz * out;
      // The blade reads edge-on to the wall, so it faces along the street.
      const bladeRot = dx !== 0 ? 0 : Math.PI / 2;
      b.signs.panel(px, y, pz, w, h, bladeRot, uv.u0, uv.v0, uv.u1, uv.v1);
      b.signs.panel(px, y, pz, w, h, bladeRot + Math.PI, uv.u0, uv.v0, uv.u1, uv.v1);
      b.props.color(PAL.metalDark, 0.8);
      // A tall blade gets a second bracket near its foot. One arm at the top leaves five
      // metres of sign swinging off a single strut with nothing beside it, which reads as
      // floating even though the top is bolted on.
      const arms = h > 4 ? [y + h / 2 - 0.2, y - h / 2 + 0.4] : [y + h / 2 - 0.2];
      for (const ay of arms) {
        if (dx !== 0) b.props.box(x + dx * (out / 2), ay, z, out, 0.2, 0.2);
        else b.props.box(x, ay, z + dz * (out / 2), 0.2, 0.2, out);
      }
      // Two families only: the hot cells bloom magenta, everything else blooms cyan.
      const hot = cell === 0 || cell === 3 || cell === 6 || cell === 10 || cell === 11 || cell === 15;
      const c = hot ? PAL.neonMagenta : PAL.neonCyan;
      halo(b, px, y, pz, w * 4.2, h * 2.6, bladeRot, c, 0.15);
      groundGlow(b, x + dx * 9, z + dz * 9, dx !== 0 ? 26 : 12, dx !== 0 ? 12 : 26, c, 0.1, 0.026);
    });
  }
}

/* ------------------------------------------------------------------ guardrails */

/** Continuous low neon line along the inner face of the perimeter band, marking the edge of the world. */
function buildRouteMarkers(b: EnvBuilders): void {
  const bounds = b.plan.bounds;
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;
  const colors = [PAL.neonBlue, PAL.neonPink, PAL.neonCyan, PAL.neonMagenta];
  const y = 1.15;
  b.plan.walls.forEach((wall, i) => {
    const horizontal = wall.maxX - wall.minX > wall.maxZ - wall.minZ;
    const c = colors[i % colors.length];
    b.neon.color(c, 0.8);
    if (horizontal) {
      const inner = (wall.minZ + wall.maxZ) / 2 < cz ? wall.maxZ : wall.minZ;
      const glowZ = inner + ((wall.minZ + wall.maxZ) / 2 < cz ? 4 : -4);
      b.neon.tube(wall.minX + 12, y, inner, wall.maxX - 12, y, inner, 0.22);
      groundGlow(b, (wall.minX + wall.maxX) / 2, glowZ, wall.maxX - wall.minX - 24, 16, c, 0.05);
    } else {
      const inner = (wall.minX + wall.maxX) / 2 < cx ? wall.maxX : wall.minX;
      const glowX = inner + ((wall.minX + wall.maxX) / 2 < cx ? 4 : -4);
      b.neon.tube(inner, y, wall.minZ, inner, y, wall.maxZ, 0.22);
      groundGlow(b, glowX, (wall.minZ + wall.maxZ) / 2, 16, wall.maxZ - wall.minZ, c, 0.06);
    }
  });
}

/**
 * Tall light columns (the test arena frames its drift plaza with four). They stand inside the
 * block colliders, so the square itself stays completely empty to slide around in.
 */
function buildPylons(b: EnvBuilders): void {
  for (const { x, z, color: c } of b.plan.pylons) {
    if (!b.plan.isSolid(x, z, 0.6)) continue;
    const h = 15;
    b.props.color(PAL.metalDark, 0.9);
    b.props.box(x, 0.22 + h / 2, z, 1, h, 1);
    b.neonPulse.color(c, 1);
    b.neonPulse.tube(x, 1.4, z, x, 0.22 + h - 0.6, z, 0.42);
    b.neon.color(c, 0.9);
    b.neon.box(x, 0.22 + h + 0.4, z, 1.5, 0.5, 1.5);
    halo(b, x, 0.22 + h * 0.6, z, 9, h * 1.5, 0, c, 0.14);
    halo(b, x, 0.22 + h * 0.6, z, 9, h * 1.5, Math.PI / 2, c, 0.14);
    groundGlow(b, x - Math.sign(x) * 7, z - Math.sign(z) * 7, 34, 34, c, 0.11);
  }
}

function buildBarriers(b: EnvBuilders, rng: () => number): void {
  for (const bar of b.plan.barriers) {
    const along = bar.maxZ - bar.minZ > bar.maxX - bar.minX;
    const min = along ? bar.minZ : bar.minX;
    const max = along ? bar.maxZ : bar.maxX;
    const cross = along ? (bar.minX + bar.maxX) / 2 : (bar.minZ + bar.maxZ) / 2;
    const thick = (along ? bar.maxX - bar.minX : bar.maxZ - bar.minZ) - 0.4;
    const seg = 4;
    let i = 0;
    for (let t = min + 0.3; t + seg < max; t += seg + 0.3, i++) {
      const c = t + seg / 2;
      const px = along ? cross : c;
      const pz = along ? c : cross;
      const striped = bar.zone === 'jdm';
      const shade = striped && i % 2 === 0 ? PAL.neonMagenta : PAL.sidewalk;
      b.props.color(shade, striped && i % 2 === 0 ? 0.5 : 1.15);
      b.props.box(px, 0.34, pz, along ? thick : seg, 0.68, along ? seg : thick);
      b.props.color(shade, striped && i % 2 === 0 ? 0.45 : 0.95);
      b.props.box(px, 0.82, pz, along ? thick * 0.55 : seg, 0.3, along ? seg : thick * 0.55);
      // Reflector strip on top.
      const c2 = bar.zone === 'jdm' ? PAL.neonPink : PAL.neonCyan;
      // Even brightness: the old every-third-segment flash turned each guardrail into a
      // dotted line of bright specks. A guardrail should be one quiet stroke of colour.
      b.neon.color(c2, 0.3);
      if (along) b.neon.tube(px, 1.0, pz - seg * 0.35, px, 1.0, pz + seg * 0.35, 0.14);
      else b.neon.tube(px - seg * 0.35, 1.0, pz, px + seg * 0.35, 1.0, pz, 0.14);
      if (rng() < 0.12) {
        b.props.color(PAL.rust, 1);
        b.props.box(px, 1.15, pz, 0.5, 0.36, 0.5);
      }
    }
  }
}

/* ------------------------------------------------------------------ street lights */

/**
 * Street lamps are the one place the two families sit side by side, so they stay strictly
 * cold-with-an-occasional-rose. No third hue ever enters the street through a lamp head.
 */
export function lampColor(zone: ZoneId, rng: () => number): number {
  if (zone === 'corporate') return rng() < 0.8 ? PAL.winCold : PAL.neonCyan;
  if (zone === 'jdm') return rng() < 0.7 ? PAL.lampWarm : PAL.neonPink;
  return rng() < 0.55 ? PAL.winCold : PAL.lampWarm;
}

/**
 * Proportions of the lamp post kit, as fractions of `poleH` up the pole and metres across it.
 * One shape for the whole city: an alley stub and a corporate mast are the same fixture at
 * two sizes, so the street reads as one municipality rather than a props bin.
 *
 * The design is the industrial reference Juan approved: a wide splayed foot, a boot that
 * steps in twice, a bolted collar halfway up, a slimmer upper shaft, and a stub that carries
 * on past the boom instead of stopping at it. Every one of those is a horizontal break, and
 * horizontal breaks are the only detail this scene's lighting can actually see — the city is
 * lit by a hemisphere, so a surface's brightness follows `normal.y` and almost nothing else.
 * Panel lines and bolt heads down a vertical face would cost triangles and render as one flat
 * tone; a collar with a lit top edge reads from across the street.
 *
 * Widths are given as [depth along the arm, width across it]: the column is a rectangular
 * section that is deeper in the direction it has to cantilever, like the reference.
 */
const LAMP = {
  /** Vertical divisions, as fractions of `poleH`. */
  plateTop: 0.018,
  bootMid: 0.085,
  bootTop: 0.17,
  shaftMid: 0.52,
  collarTop: 0.565,
  shaftTop: 0.945,
  stubTop: 1.05,
  /** Where the boom leaves the column and where the head hangs, as fractions of `poleH`. */
  boomY: 0.965,
  headY: 0.935,
  /** Section [depth, width] in metres at 1x scale. */
  plate: [1.26, 1.02],
  bootLow: [0.9, 0.74],
  bootHigh: [0.62, 0.52],
  shaftLow: [0.42, 0.34],
  collar: [0.52, 0.44],
  shaftHigh: [0.28, 0.23],
  stub: [0.24, 0.2],
  /**
   * The luminaire: a slab housing with the lens recessed into its underside rather than hung
   * below it. The overlap is the whole difference between a fixture and a lit tile — the
   * housing has to overhang the lens at both ends and clip its top edge, or the lens reads
   * as a billboard floating under a separate black box.
   */
  headLen: 2.3,
  headWidth: 0.66,
  headThick: 0.4,
  /** Lens centre below the housing's underside, its width, and its half-length as a fraction
   * of `headLen` — under 0.5 so the housing overhangs it. */
  lensDrop: 0.1,
  lensWidth: 0.26,
  lensReach: 0.36,
  /** The boom: it rises off the column to a knee and then runs out, like the reference,
   * instead of cutting one straight line from pole to head. `kneeOut` is where the bend sits
   * along the arm, `kneeRise` how far above the column top, both scaled. */
  boomWidth: 0.14,
  kneeOut: 0.3,
  kneeRise: 0.24,
  /** Conduit up the side of the column. */
  conduit: 0.1,
  /** The two accent strips, as fractions of `poleH`, and the status pip between them. */
  stripLow: [0.22, 0.4],
  stripHigh: [0.63, 0.79],
  stripWidth: 0.09,
  pipY: 0.5,
  pipHeight: 0.13,
} as const;

/** The kit is drawn at this scale; a 7.4 m street lamp is 1x. */
function lampScale(poleH: number): number {
  return Math.min(1.15, Math.max(0.68, poleH / 7.4));
}

/**
 * One lamp post at (x, z) standing on ground height `y0`, with its arm reaching `arm` metres
 * in the unit direction (dx, dz) toward the road. The spill lands `spill` metres out.
 *
 * `fault` is the lamp's fault seed from `rollLampFault`: 0 for a lamp that works, otherwise
 * the lens, its halo and its pool of light on the road carry the seed and stutter together,
 * so the light on the ground goes with the light in the head. Nothing structural takes the
 * seed — see the note on the boom for why that line matters.
 *
 * See `LAMP` for why the detail here is all horizontal breaks and emission.
 */
export function lampPost(
  b: EnvBuilders,
  x: number,
  z: number,
  y0: number,
  dx: number,
  dz: number,
  arm: number,
  poleH: number,
  color: number,
  spill: number,
  fault = 0,
): void {
  const alongX = Math.abs(dx) > Math.abs(dz);
  // The arm direction, normalised: the circuit hands us diagonals, so the column is oriented
  // off it rather than snapped to an axis.
  const len = Math.hypot(dx, dz) || 1;
  const ax = dx / len;
  const az = dz / len;
  const s = lampScale(poleH);
  const yAt = (f: number): number => y0 + poleH * f;
  const seg = (a: number, bTop: number, sec: readonly [number, number]): void => {
    b.props.orientedBox(x, z, ax, az, sec[0] * s, sec[1] * s, yAt(a), yAt(bTop));
  };

  // Column, bottom to top. The plate, the collar and the stub are drawn a shade brighter than
  // the shafts: they are the pieces with an exposed top face, and the top face is the only
  // one the hemisphere really lights, so lifting them is what makes the breaks read.
  b.props.color(PAL.metalDark, 1.45);
  seg(0, LAMP.plateTop, LAMP.plate);
  b.props.color(PAL.metalDark, 0.95);
  seg(LAMP.plateTop, LAMP.bootMid, LAMP.bootLow);
  seg(LAMP.bootMid, LAMP.bootTop, LAMP.bootHigh);
  b.props.color(PAL.metalDark, 1.1);
  seg(LAMP.bootTop, LAMP.shaftMid, LAMP.shaftLow);
  b.props.color(PAL.metalDark, 1.45);
  seg(LAMP.shaftMid, LAMP.collarTop, LAMP.collar);
  b.props.color(PAL.metalDark, 1.1);
  seg(LAMP.collarTop, LAMP.shaftTop, LAMP.shaftHigh);
  b.props.color(PAL.metalDark, 1.45);
  seg(LAMP.shaftTop, LAMP.stubTop, LAMP.stub);

  // Cable conduit clipped up the side of the column and elbowing over the top into the boom.
  // Up the SIDE rather than the back, and lifted well clear of the shaft's own tone: on the
  // back it sat inside the column's outline and against a black pole at night that is the
  // same as not drawing it. On the side it widens the silhouette, which is a shape the eye
  // gets for free from any angle.
  const side = (LAMP.shaftHigh[1] / 2 + LAMP.conduit / 2) * s;
  const bx = x - az * side;
  const bz = z + ax * side;
  b.props.color(PAL.metalDark, 1.5);
  b.props.tube(bx, yAt(LAMP.bootTop), bz, bx, yAt(LAMP.shaftTop), bz, LAMP.conduit * s);
  b.props.tube(bx, yAt(LAMP.shaftTop), bz, x + ax * side, yAt(LAMP.boomY), z + az * side, LAMP.conduit * s);

  const hx = x + ax * arm;
  const hz = z + az * arm;
  const headY = yAt(LAMP.headY);

  // The boom: solid metal, rising off the column to a knee and then running out to the head.
  //
  // It has to be solid, and this is the rule the whole fixture is built to. Everything drawn
  // into `neon` or `glow` is scaled by the lamp's fault level in the vertex shader
  // (`lampFaults.ts`), so on a faulty lamp it drops to an ember for seconds at a time. That is
  // right for light and wrong for structure: the old lamp got away with an emissive bracket
  // because the head it carried was emissive too, and the pair vanished together. This head is
  // a solid housing, so an emissive boom left a black slab hanging in the air over a pole it
  // was no longer joined to every time the ballast cut out.
  //
  // So: every piece of the fixture that is METAL goes in `props` and is always there, and only
  // the lens, the halo and the pool of light on the road carry the fault. A broken lamp goes
  // dark; it never comes apart.
  const kneeOut = arm * LAMP.kneeOut;
  const kx = x + ax * kneeOut;
  const kz = z + az * kneeOut;
  const kneeY = yAt(LAMP.boomY) + LAMP.kneeRise * s;
  const joinX = hx - ax * LAMP.headLen * 0.3 * s;
  const joinZ = hz - az * LAMP.headLen * 0.3 * s;
  b.props.color(PAL.metalDark, 1.5);
  b.props.tube(x, yAt(LAMP.boomY), z, kx, kneeY, kz, LAMP.boomWidth * s);
  b.props.tube(kx, kneeY, kz, joinX, headY + LAMP.headThick * s, joinZ, LAMP.boomWidth * s);

  // Accent strips up the road-facing side of the column. Always the cold family whatever the
  // head burns: they are the fixture's own service lighting, not part of the street's colour
  // script, and keeping them one hue is what makes a row of lamps look like one product.
  // No fault seed either, for the same reason the boom is metal — they are what still draws
  // the pole when the head is out, and a lamp post that disappears entirely is a hole in the
  // street, not a broken lamp.
  const front = (LAMP.shaftLow[0] / 2 + LAMP.stripWidth / 2) * s;
  const fx = x + ax * front;
  const fz = z + az * front;
  b.neon.fault(0).color(PAL.neonCyan, 0.85);
  b.neon.tube(fx, yAt(LAMP.stripLow[0]), fz, fx, yAt(LAMP.stripLow[1]), fz, LAMP.stripWidth * s);
  b.neon.tube(fx, yAt(LAMP.stripHigh[0]), fz, fx, yAt(LAMP.stripHigh[1]), fz, LAMP.stripWidth * s);
  // The status pip, on its own supply like the strips.
  b.neon.color(PAL.neonMagenta, 1);
  b.neon.tube(fx, yAt(LAMP.pipY), fz, fx, yAt(LAMP.pipY) + LAMP.pipHeight * s, fz, 0.07 * s);

  // The luminaire: a dark slab housing, elongated along the boom, with the lit lens slung
  // under it. Splitting the two is the whole point of the head — a bar of light with a solid
  // body over it reads as a fixture, where one glowing box reads as a floating tile.
  b.props.color(PAL.metalDark, 1.25);
  b.props.orientedBox(
    hx, hz, ax, az,
    LAMP.headLen * s, LAMP.headWidth * s,
    headY, headY + LAMP.headThick * s,
    { bottom: true },
  );
  b.neon.color(color, 1).fault(fault);
  const lensHalf = LAMP.headLen * LAMP.lensReach * s;
  const lensY = headY - LAMP.lensDrop * s;
  b.neon.tube(hx - ax * lensHalf, lensY, hz - az * lensHalf, hx + ax * lensHalf, lensY, hz + az * lensHalf, LAMP.lensWidth * s);
  b.neon.fault(0);
  // The bad connection into the lens, letting go every few seconds and raining down the pole's
  // own height onto the pavement. At the lens, not at the pole: it is the same joint that makes
  // the head strobe.
  if (fault > 0) lampSparks(b, hx, lensY, hz, color, fault);
  // The boom is perpendicular to the street, so the halo faces along the street (rotY 0 = +Z).
  halo(b, hx, lensY - 0.05, hz, 6, 4, alongX ? 0 : Math.PI / 2, color, 0.2, fault);
  // The spill always lands on the asphalt, whatever the pole ended up standing on.
  groundGlow(b, x + dx * spill, z + dz * spill, alongX ? 20 : 30, alongX ? 30 : 20, color, 0.14, 0.03, fault);
}

function buildStreetLights(b: EnvBuilders, rng: () => number): void {
  const isSolid = b.plan.isSolid;
  for (const road of b.plan.roads) {
    if (road.axis === 'open') continue;
    const along = road.axis === 'z';
    const min = along ? road.minZ : road.minX;
    const max = along ? road.maxZ : road.maxX;
    const lo = along ? road.minX : road.minZ;
    const hi = along ? road.maxX : road.maxZ;
    const alley = road.lanes === 0;
    // Sparser than a real street would be: each pool of light should be its own event.
    const step = alley ? 22 : 38;
    for (let t = min + 8; t < max - 8; t += step) {
      for (const side of [-1, 1]) {
        const edge = side < 0 ? lo : hi;
        // Walk outward from the kerb until we find something solid to bolt the pole to.
        let off = 1.7;
        while (off < 9 && !isSolid(along ? edge + side * off : t, along ? t : edge + side * off, 0.5)) off += 0.7;
        if (off >= 9) continue;
        const ax = along ? edge + side * off : t;
        const az = along ? t : edge + side * off;
        if (!isSolid(ax, az, 0.5)) continue;
        const zone = b.plan.zoneAt(ax, az);
        const c = lampColor(zone, rng);
        const y0 = b.plan.padY(ax, az);
        const poleH = alley ? 4.4 : 7.4;
        // The arm reaches over the kerb, but never grows silly on a deep sidewalk.
        const arm = alley ? 0.9 : Math.min(off + 2.2, 5.2);
        const dx = along ? -side : 0;
        const dz = along ? 0 : -side;
        lampPost(b, ax, az, y0, dx, dz, arm, poleH, c, off + 5, rollLampFault(rng));
      }
    }
  }
}

/* ------------------------------------------------------------------ neon route gates */

export function buildGate(b: EnvBuilders, g: GateDef): void {
  const ends: Array<[number, number]> = [
    [g.x0, g.z0],
    [g.x1, g.z1],
  ];
  const colors = [g.left, g.right];
  let dx = g.x1 - g.x0;
  let dz = g.z1 - g.z0;
  const span = Math.hypot(dx, dz) || 1;
  dx /= span;
  dz /= span;
  // The gate spans the road, so its halos face along the road: the span's normal.
  const faceRot = Math.atan2(-dz, dx);
  for (let i = 0; i < 2; i++) {
    const [x, z] = ends[i];
    if (!g.trusted && !b.plan.isSolid(x, z, 0.2)) continue;
    const c = colors[i];
    // Structural pylon.
    b.props.color(PAL.metalDark, 0.9);
    b.props.box(x, g.height / 2, z, 0.9, g.height, 0.9);
    // Neon strip up the pylon: the gate reads as two lit posts and a beam, nothing else.
    const inward = i === 0 ? 1 : -1;
    const ox = dx * inward;
    const oz = dz * inward;
    b.neonPulse.color(c, 1);
    b.neonPulse.tube(x + ox * 0.5, 1.6, z + oz * 0.5, x + ox * 0.5, g.height - 0.6, z + oz * 0.5, 0.3);
    halo(b, x + ox * 0.5, g.height / 2, z + oz * 0.5, 5, g.height * 1.2, faceRot, c, 0.16);
    groundGlow(b, x + ox * 2, z + oz * 2, 18, 18, c, 0.15);
  }
  // Top beam.
  const mx = (g.x0 + g.x1) / 2;
  const mz = (g.z0 + g.z1) / 2;
  b.props.color(PAL.metalDark, 0.8);
  b.props.orientedBox(mx, mz, dx, dz, span, 0.8, g.height - 0.8, g.height);
  b.neonPulse.color(g.left, 1);
  b.neonPulse.tube(g.x0, g.height - 1, g.z0, g.x1, g.height - 1, g.z1, 0.2);
}

function buildGates(b: EnvBuilders): void {
  for (const g of b.plan.gates) buildGate(b, g);
}

/* ------------------------------------------------------------------ billboards */

function buildBillboards(b: EnvBuilders): void {
  for (const d of b.plan.billboards) {
    // 0 and 1 scroll the hologram atlas; 2 is the portrait BADKALA WANTED ad, which owns a
    // whole texture rather than a strip of one, so it takes the full UV rect.
    const target = d.variant === 0 ? b.billA : d.variant === 1 ? b.billB : b.badkala;
    target.panel(d.x, d.y, d.z, d.w, d.h, d.rotY);
    // Frame + masts.
    const nx = Math.sin(d.rotY);
    const nz = Math.cos(d.rotY);
    const tx = Math.cos(d.rotY);
    const tz = -Math.sin(d.rotY);
    b.props.color(PAL.metalDark, 0.7);
    for (const s of [-1, 1]) {
      b.props.box(d.x + tx * s * (d.w / 2 + 0.6) - nx * 0.4, d.y, d.z + tz * s * (d.w / 2 + 0.6) - nz * 0.4, 1.2, d.h + 1.4, 1.2);
      b.props.box(
        d.x + tx * s * (d.w / 2 - 3) - nx * 0.9,
        (d.y - d.h / 2) / 2,
        d.z + tz * s * (d.w / 2 - 3) - nz * 0.9,
        1,
        d.y - d.h / 2,
        1,
      );
    }
    b.neonPulse.color(d.color, 1);
    b.neonPulse.tube(
      d.x + tx * (d.w / 2) + nx * 0.3,
      d.y - d.h / 2 - 0.5,
      d.z + tz * (d.w / 2) + nz * 0.3,
      d.x - tx * (d.w / 2) + nx * 0.3,
      d.y - d.h / 2 - 0.5,
      d.z - tz * (d.w / 2) + nz * 0.3,
      0.3,
    );
    halo(b, d.x + nx * 0.6, d.y, d.z + nz * 0.6, d.w * 2, d.h * 2.2, d.rotY, d.color, 0.13);
    groundGlow(b, d.x + nx * 18, d.z + nz * 18, Math.abs(nx) > 0.5 ? 52 : d.w * 1.5, Math.abs(nx) > 0.5 ? d.w * 1.5 : 52, d.color, 0.08);
  }
}

/* ------------------------------------------------------------------ cables */

/** Overhead cables strung between facing blocks, as in the approved reference. */
function buildCables(b: EnvBuilders, rng: () => number): void {
  const isSolid = b.plan.isSolid;
  for (const [x0, z0, x1, z1] of b.plan.cableRuns) {
    if (!isSolid(x0, z0, 0.2) || !isSolid(x1, z1, 0.2)) continue;
    const y = 8 + rng() * 2.5;
    const sag = 0.8 + rng() * 0.9;
    b.props.color(PAL.metalDark, 0.35);
    const mx = (x0 + x1) / 2;
    const mz = (z0 + z1) / 2;
    b.props.tube(x0, y, z0, mx, y - sag, mz, 0.09);
    b.props.tube(mx, y - sag, mz, x1, y, z1, 0.09);
    // One lamp every handful of cables, not one on half of them.
    if (rng() < 0.16) {
      const c = rng() < 0.5 ? PAL.winWarm : PAL.neonCyan;
      b.props.color(PAL.metalDark, 0.4);
      b.props.box(mx, y - sag - 0.5, mz, 0.1, 1, 0.1);
      b.neonFlicker.color(c, 1);
      b.neonFlicker.box(mx, y - sag - 1.1, mz, 0.42, 0.42, 0.42);
      // Face the halo down the street the cable crosses, not along the cable.
      halo(b, mx, y - sag - 1.1, mz, 6, 6, Math.abs(x1 - x0) > Math.abs(z1 - z0) ? 0 : Math.PI / 2, c, 0.2);
      groundGlow(b, mx, mz, 16, 16, c, 0.09);
    }
  }
}

/* ------------------------------------------------------------------ block clutter */

/** Walks the inside edge of a block, calling back with a point and its outward normal. */
function walkLedge(
  blk: { minX: number; maxX: number; minZ: number; maxZ: number },
  inset: number,
  step: number,
  cb: (x: number, z: number, dx: number, dz: number, along: 'x' | 'z') => void,
): void {
  for (let x = blk.minX + inset + 2; x < blk.maxX - inset - 2; x += step) {
    cb(x, blk.minZ + inset, 0, -1, 'x');
    cb(x, blk.maxZ - inset, 0, 1, 'x');
  }
  for (let z = blk.minZ + inset + 2; z < blk.maxZ - inset - 2; z += step) {
    cb(blk.minX + inset, z, -1, 0, 'z');
    cb(blk.maxX - inset, z, 1, 0, 'z');
  }
}

/** Weathered, desaturated, and all inside the two families. Nothing here is a fresh hue. */
const CONTAINER_COLORS = [PAL.rust, 0x27384f, 0x3a2f46, 0x4a2a3a, 0x2d3a48];

function buildBlockClutter(b: EnvBuilders, rng: () => number): void {
  const isRoad = b.plan.isRoad;
  const padY = b.plan.padY;
  for (const blk of b.plan.blocks) {
    walkLedge(blk, 1.4, 7, (x, z, dx, dz, along) => {
      // Only dress ledges that actually face a street.
      if (!isRoad(x + dx * 6, z + dz * 6)) return;
      const zone = blk.zone;
      const y0 = padY(x, z);
      const rotY = dx === 1 ? Math.PI / 2 : dx === -1 ? -Math.PI / 2 : dz === 1 ? 0 : Math.PI;
      const r = rng();
      if (zone === 'jdm') {
        if (r < 0.3) {
          // Shipping container, long side parallel to the street.
          const stack = rng() < 0.25 ? 2 : 1;
          for (let i = 0; i < stack; i++) {
            b.props.color(CONTAINER_COLORS[Math.floor(rng() * CONTAINER_COLORS.length)], 0.8 + rng() * 0.5);
            b.props.box(
              x - dx * 0.2,
              y0 + 1.22 + i * 2.5,
              z - dz * 0.2,
              along === 'x' ? 6.1 : 2.5,
              2.44,
              along === 'x' ? 2.5 : 6.1,
            );
          }
          if (rng() < 0.5) {
            const uv = signCell(rng() < 0.5 ? 10 : 15);
            b.signs.panel(
              x + dx * 1.35,
              y0 + 1.5 + (stack - 1) * 2.5,
              z + dz * 1.35,
              2.4,
              1.8,
              rotY,
              uv.u0,
              uv.v0,
              uv.u1,
              uv.v1,
            );
          }
        } else if (r < 0.5) {
          // Oil drums and crates.
          for (let i = 0; i < 3; i++) {
            b.props.color(rng() < 0.5 ? PAL.rust : PAL.metalDark, 0.7 + rng() * 0.6);
            b.props.box(x + (rng() - 0.5) * 3.4, y0 + 0.46, z + (rng() - 0.5) * 3.4, 0.62, 0.92, 0.62);
          }
        } else if (r < 0.62) {
          // Junk pile.
          b.props.color(PAL.metalDark, 0.6);
          b.props.box(x, y0 + 0.6, z, 2.4, 1.2, 1.8);
          b.props.color(PAL.rust, 0.8);
          b.props.box(x + 0.6, y0 + 1.5, z - 0.3, 1.4, 0.8, 1.2);
        }
      } else if (r < 0.22 && r >= 0.12 && zone === 'urban') {
        // A street stall under an awning, lit warm from underneath: the cosy note.
        const warm = rng() < 0.75 ? PAL.neonAmber : PAL.neonPink;
        b.props.color(PAL.rust, 1.05);
        b.props.box(x, y0 + 1.1, z, along === 'x' ? 3 : 1.8, 2.2, along === 'x' ? 1.8 : 3);
        b.props.color(PAL.rust, 0.8);
        b.props.box(x + dx * 0.7, y0 + 2.35, z + dz * 0.7, along === 'x' ? 3.6 : 3.2, 0.14, along === 'x' ? 3.2 : 3.6);
        b.neon.color(warm, 0.8);
        if (along === 'x') b.neon.tube(x - 1.5, y0 + 2.2, z + dz * 1.5, x + 1.5, y0 + 2.2, z + dz * 1.5, 0.12);
        else b.neon.tube(x + dx * 1.5, y0 + 2.2, z - 1.5, x + dx * 1.5, y0 + 2.2, z + 1.5, 0.12);
        halo(b, x + dx * 1.6, y0 + 1.4, z + dz * 1.6, 5, 3.4, rotY, warm, 0.18);
        groundGlow(b, x + dx * 3.2, z + dz * 3.2, 10, 10, warm, 0.13);
        b.props.color(PAL.metalDark, 0.8);
        b.props.box(x + (along === 'x' ? 2.2 : 0), y0 + 0.45, z + (along === 'x' ? 0 : 2.2), 0.8, 0.9, 0.8);
      } else if (r < 0.12) {
        // Vending machines and kiosks glowing on the sidewalk. Rare enough to be a landmark.
        const c = zone === 'corporate' ? PAL.neonCyan : rng() < 0.5 ? PAL.neonMagenta : PAL.winWarm;
        b.props.color(PAL.metalDark, 1);
        b.props.box(x, y0 + 0.95, z, along === 'x' ? 1.9 : 0.8, 1.9, along === 'x' ? 0.8 : 1.9);
        b.neon.color(c, 1);
        b.neon.panel(x + dx * 0.45, y0 + 1.05, z + dz * 0.45, along === 'x' ? 1.5 : 0.55, 1.3, rotY);
        halo(b, x + dx * 0.7, y0 + 1.05, z + dz * 0.7, 7, 6, rotY, c, 0.17);
        groundGlow(b, x + dx * 3.5, z + dz * 3.5, 13, 13, c, 0.1);
      }
    });

    if (blk.zone !== 'jdm') continue;
    // Pipe runs, AC units and graffiti on the garage walls.
    walkLedge(blk, 3.6, 5.5, (x, z, dx, dz, along) => {
      if (!isRoad(x + dx * 8, z + dz * 8)) return;
      const rotY = dx === 1 ? Math.PI / 2 : dx === -1 ? -Math.PI / 2 : dz === 1 ? 0 : Math.PI;
      const y0 = padY(x, z);
      // Same rule as the blades: all of this is bolted to a garage wall, so there has to be
      // one. The tallest thing here reaches about 6.5 m up.
      if (!b.walls.faceAt(x, y0 + 1.2, z, dx, dz) || !b.walls.faceAt(x, y0 + 6.4, z, dx, dz)) return;
      const r = rng();
      if (r < 0.45) {
        b.props.color(PAL.metalDark, 0.85);
        const py = y0 + 1.2 + rng() * 4;
        if (along === 'x') b.props.box(x, py, z + dz * 0.35, 5.4, 0.24, 0.24);
        else b.props.box(x + dx * 0.35, py, z, 0.24, 0.24, 5.4);
        b.props.box(x + dx * 0.35, (y0 + py) / 2, z + dz * 0.35, 0.22, py - y0, 0.22);
      }
      if (r > 0.4 && r < 0.7) {
        b.props.color(PAL.metalDark, 1.1);
        b.props.box(
          x + dx * 0.6,
          y0 + 3.4 + rng() * 3,
          z + dz * 0.6,
          along === 'x' ? 1.3 : 0.9,
          1,
          along === 'x' ? 0.9 : 1.3,
        );
      }
      if (r > 0.86) {
        const uv = signCell(rng() < 0.5 ? 10 : 11);
        b.signs.panel(x + dx * 0.32, y0 + 2.6, z + dz * 0.32, 3.2, 3.2, rotY, uv.u0, uv.v0, uv.u1, uv.v1);
        halo(b, x + dx * 0.6, y0 + 2.6, z + dz * 0.6, 10, 9, rotY, PAL.neonPink, 0.13);
        groundGlow(b, x + dx * 5.5, z + dz * 5.5, 18, 18, PAL.neonPink, 0.09);
      }
    });
  }
}
