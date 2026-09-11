import { inBusStop, type RailDef, type RibbonDef, type TrackLineDef } from '../../../world/cityPlan';
import { onRibbonAtLevel } from '../../../world/cityGen';
import { createProjection, offsetAtStation, projectOntoPath, segmentCount } from '../../../world/track';
import { PAL } from './palette';
import { makeRng } from './meshBuilder';
import { groundGlow, halo, type EnvBuilders } from './builders';
import { buildViaducts } from './elevatedBuilder';
import { lampColor, lampPost } from './propsBuilder';
import { rollLampFault } from './lampFaults';
import { PAINT_Y, ROAD_TILE, roadTint } from './cityBuilder';
import { signCell } from './textures';

/**
 * The circuit's own art, built from the ribbons and rail segments in the plan:
 *
 *  - asphalt as a strip of quads between consecutive cross-sections, with world-station UVs
 *    so the wet texture runs continuously round the lap,
 *  - lane paint that follows the curve (edge lines, a double centre line, dividers on the
 *    wide highway), broken wherever another road crosses,
 *  - the rails: guardrails on the highway, jersey barriers in the city, striped barriers in
 *    the old town, tall concrete walls in the alleys - one oriented box per collider segment,
 *    so the thing you scrape is exactly the thing you see,
 *  - street lamps just outside the rails, the start/finish gantry and checkered line, slim
 *    checkpoint arches, and the flickering signs that mark an alley mouth.
 *
 * Everything goes into the shared per-material builders; no new draw calls.
 *
 * Heights: every sample carries the road's `y`, so the same code lays a street, a ramp and a
 * viaduct deck; the rails climb with the road (`slopedBox`), the lamps stand on it, and the
 * paint stops where another road crosses AT THE SAME LEVEL only — a street under a viaduct
 * does not break the viaduct's centre line. `elevatedBuilder.ts` adds the slab under a deck.
 */
export function buildTrack(b: EnvBuilders): void {
  const rng = makeRng(0x7ac4);
  for (const rb of b.plan.ribbons) buildRibbon(b, rb);
  if (b.plan.shoulders) for (const rb of b.plan.ribbons) if (!rb.elevated) buildShoulders(b, rb);
  for (const rb of b.plan.ribbons) if (rb.kind === 'track') buildLanePaint(b, rb);
  buildRails(b, b.plan.rails, rng);
  buildViaducts(b, rng);
  for (const rb of b.plan.ribbons) buildRibbonLamps(b, rb, rng);
  for (const rb of b.plan.ribbons) if (rb.kind === 'alley') buildAlleyDressing(b, rb, rng);
  if (b.plan.startLine) buildStartLine(b, b.plan.startLine);
  for (const cp of b.plan.checkpoints) buildCheckpointArch(b, cp);
}

/* ------------------------------------------------------------------ asphalt */

/** Height the asphalt is drawn above the samples: alleys a hair up so their mouths never z-fight. */
function liftOf(rb: RibbonDef): number {
  return rb.lift ?? (rb.kind === 'alley' ? 0.006 : 0);
}

function buildRibbon(b: EnvBuilders, rb: RibbonDef): void {
  const samples = rb.path.samples;
  const segs = segmentCount(rb.path);
  const lift = liftOf(rb);
  const bright = rb.kind === 'alley' ? 0.72 : 1;
  for (let i = 0; i < segs; i++) {
    const a = samples[i];
    const c = samples[(i + 1) % samples.length];
    const sc = i === segs - 1 && rb.path.closed ? rb.path.length : c.s;
    const ay = a.y + lift;
    const cy = c.y + lift;
    b.road.color(roadTint(a.zone), bright);
    // Left/right edge points; u runs across the road in texture tiles, v along the station.
    const alx = a.x + a.tz * a.halfWidth;
    const alz = a.z - a.tx * a.halfWidth;
    const arx = a.x - a.tz * a.halfWidth;
    const arz = a.z + a.tx * a.halfWidth;
    const clx = c.x + c.tz * c.halfWidth;
    const clz = c.z - c.tx * c.halfWidth;
    const crx = c.x - c.tz * c.halfWidth;
    const crz = c.z + c.tx * c.halfWidth;
    const u0 = -a.halfWidth / ROAD_TILE;
    const u1 = a.halfWidth / ROAD_TILE;
    // Winding: back-left, back-right, front-right, front-left gives a +Y normal (see planeY).
    b.road.quad(alx, ay, alz, arx, ay, arz, crx, cy, crz, clx, cy, clz, u0, a.s / ROAD_TILE, u1, sc / ROAD_TILE);
  }
}

/** Width of the kerb-coloured stripe along the road edge (m): the pavement's bright margin. */
const KERB_EDGE = 0.6;
/** Overhang past the band's outer edge (m): the lip that closes the seam at a block's face. */
export const KERB_LIP = 0.3;

/**
 * Pavement from the road's edge out to where the blocks start, laid flush with the asphalt:
 * a step here was worth nothing and cost the car a jolt every time it touched one, so the
 * kerb is colour, not height. `b.plan.kerbs` decides which stretches are paved at all
 * (nothing across a junction) and how far out each one runs.
 */
function buildShoulders(b: EnvBuilders, rb: RibbonDef): void {
  const kerbs = b.plan.kerbs;
  if (!kerbs) return;
  const samples = rb.path.samples;
  const segs = segmentCount(rb.path);
  const lift = liftOf(rb) + 0.012;
  for (let i = 0; i < segs; i++) {
    const a = samples[i];
    const c = samples[(i + 1) % samples.length];
    for (const side of [-1, 1]) {
      if (!kerbs.paved(rb, i, side)) continue;
      // The band's two ends: it tapers between them to meet the blocks behind it squarely.
      const wa = kerbs.widthAt(rb, i, side, 0);
      const wc = kerbs.widthAt(rb, i, side, 1);
      if (Math.min(wa, wc) < 0.8) continue;
      const ay = a.y + lift;
      const cy = c.y + lift;
      /** A point `off` metres outside the road edge on this side, at the near/far sample. */
      const px = (s: typeof a, off: number): number => s.x + -s.tz * (s.halfWidth + off) * side;
      const pz = (s: typeof a, off: number): number => s.z + s.tx * (s.halfWidth + off) * side;
      /**
       * One strip of pavement. The inner and outer offsets are given per end of the segment,
       * so the strip can widen along its run.
       */
      const strip = (o0: number, oa1: number, oc1: number): void => {
        const ax0 = px(a, o0);
        const az0 = pz(a, o0);
        const ax1 = px(a, oa1);
        const az1 = pz(a, oa1);
        const cx0 = px(c, o0);
        const cz0 = pz(c, o0);
        const cx1 = px(c, oc1);
        const cz1 = pz(c, oc1);
        // Winding depends on the side so the pavement always looks up.
        if (side > 0) b.concrete.quad(ax0, ay, az0, ax1, ay, az1, cx1, cy, cz1, cx0, cy, cz0);
        else b.concrete.quad(ax1, ay, az1, ax0, ay, az0, cx0, cy, cz0, cx1, cy, cz1);
      };
      if (rb.kind === 'alley') {
        b.concrete.color(PAL.sidewalk, 0.75);
        strip(0, wa, wc);
        continue;
      }
      // The kerb line, then the pavement behind it: the same band it always was, now all at
      // road level. The bright edge is what reads as a kerb at night.
      b.concrete.color(PAL.curb, 1.05);
      strip(0, KERB_EDGE, KERB_EDGE);
      b.concrete.color(PAL.sidewalk, 0.92);
      // Run a little past the band's edge: the blocks stand exactly there and draw their own
      // pavement 0.3 m inside their collider, so the overhang closes that seam.
      if (Math.max(wa, wc) > KERB_EDGE) strip(KERB_EDGE, wa + KERB_LIP, wc + KERB_LIP);
    }
  }
}

/* ------------------------------------------------------------------ paint */

/** True when (x, z) at height `y` lies on a ribbon other than `self` at that level (a junction), so paint stops there. */
function onOtherRoad(b: EnvBuilders, self: RibbonDef, x: number, z: number, y: number): boolean {
  for (const rb of b.plan.ribbons) {
    if (rb !== self && onRibbonAtLevel(rb, x, z, y, 1.2)) return true;
  }
  return false;
}

const LAMP_PROJ = createProjection();

/** True when another road passes overhead within lamp height of (x, z, y): no post there. */
function coveredAbove(b: EnvBuilders, x: number, z: number, y: number): boolean {
  for (const rb of b.plan.ribbons) {
    if (!rb.elevated) continue;
    const p = projectOntoPath(rb.path, x, z, LAMP_PROJ);
    if (p.dist <= p.halfWidth + 2.5 && p.y > y + 1 && p.y < y + 16) return true;
  }
  return false;
}

/** A painted stripe along the ribbon at lateral `offset`, as a dash/gap pattern. */
function paintStripe(
  b: EnvBuilders,
  rb: RibbonDef,
  offset: number,
  width: number,
  color: number,
  bright: number,
  dashLen: number,
  gapLen: number,
  onlyWhere?: (halfWidth: number) => boolean,
): void {
  const path = rb.path;
  const step = dashLen + gapLen;
  const lift = liftOf(rb) + PAINT_Y;
  b.lane.color(color, bright);
  const end = path.closed ? path.length : path.length - 2;
  for (let s = 1; s + dashLen < end; s += step) {
    const mid = offsetAtStation(path, s + dashLen / 2, offset);
    if (onlyWhere && !onlyWhere(mid.halfWidth)) continue;
    if (onOtherRoad(b, rb, mid.x, mid.z, mid.y)) continue;
    // A dash is one quad following the road: sample its two ends on the curve.
    const p0 = offsetAtStation(path, s, offset);
    const p1 = offsetAtStation(path, s + dashLen, offset);
    const hw = width / 2;
    const y0 = p0.y + lift;
    const y1 = p1.y + lift;
    b.lane.quad(
      p0.x + p0.tz * hw, y0, p0.z - p0.tx * hw,
      p0.x - p0.tz * hw, y0, p0.z + p0.tx * hw,
      p1.x - p1.tz * hw, y1, p1.z + p1.tx * hw,
      p1.x + p1.tz * hw, y1, p1.z - p1.tx * hw,
    );
  }
}

function buildLanePaint(b: EnvBuilders, rb: RibbonDef): void {
  const samples = rb.path.samples;
  // Width varies along the lap, so stripes are placed by the local half width at each dash.
  // Edge lines: continuous-looking (long dashes with a hair of gap).
  const worn = (hw: number): boolean => samples.length > 0 && hw < 6.8;
  const lift = liftOf(rb) + PAINT_Y;
  const paintEdges = (side: number): void => {
    // Placed one metre inside the local edge; `offset` has to follow the width, so we walk
    // stations ourselves and evaluate the width per dash.
    const path = rb.path;
    const end = path.closed ? path.length : path.length - 2;
    for (let s = 1; s + 7 < end; s += 8) {
      const c = offsetAtStation(path, s + 3.5, 0);
      const off = side * (c.halfWidth - 1);
      const isWorn = worn(c.halfWidth);
      const color = isWorn ? PAL.laneWorn : PAL.laneWhite;
      b.lane.color(color, (isWorn ? 0.55 : 1) * 0.85);
      const m = offsetAtStation(path, s + 3.5, off);
      if (onOtherRoad(b, rb, m.x, m.z, m.y)) continue;
      const p0 = offsetAtStation(path, s, off);
      const p1 = offsetAtStation(path, s + 7, off);
      const hw = 0.09;
      const y0 = p0.y + lift;
      const y1 = p1.y + lift;
      b.lane.quad(
        p0.x + p0.tz * hw, y0, p0.z - p0.tx * hw,
        p0.x - p0.tz * hw, y0, p0.z + p0.tx * hw,
        p1.x - p1.tz * hw, y1, p1.z + p1.tx * hw,
        p1.x + p1.tz * hw, y1, p1.z - p1.tx * hw,
      );
    }
  };
  paintEdges(-1);
  paintEdges(1);
  // Double centre line, cold and dim: the road paint is structure, not another colour.
  paintStripe(b, rb, -0.35, 0.16, PAL.laneCenter, 0.75, 7, 1);
  paintStripe(b, rb, 0.35, 0.16, PAL.laneCenter, 0.75, 7, 1);
  // Dashed lane dividers on the highway only (two lanes a side).
  const path = rb.path;
  const end = path.closed ? path.length : path.length - 2;
  for (let s = 1; s + 3.2 < end; s += 8.2) {
    const c = offsetAtStation(path, s + 1.6, 0);
    if (c.halfWidth < 9) continue;
    for (const side of [-1, 1]) {
      const off = (side * c.halfWidth) / 2;
      const m = offsetAtStation(path, s + 1.6, off);
      if (onOtherRoad(b, rb, m.x, m.z, m.y)) continue;
      b.lane.color(PAL.laneWhite, 1);
      const p0 = offsetAtStation(path, s, off);
      const p1 = offsetAtStation(path, s + 3.2, off);
      const hw = 0.1;
      const y0 = p0.y + lift;
      const y1 = p1.y + lift;
      b.lane.quad(
        p0.x + p0.tz * hw, y0, p0.z - p0.tx * hw,
        p0.x - p0.tz * hw, y0, p0.z + p0.tx * hw,
        p1.x - p1.tz * hw, y1, p1.z + p1.tx * hw,
        p1.x + p1.tz * hw, y1, p1.z - p1.tx * hw,
      );
    }
  }
}

/* ------------------------------------------------------------------ rails */

function buildRails(b: EnvBuilders, rails: RailDef[], rng: () => number): void {
  let i = 0;
  for (const r of rails) {
    i++;
    let dx = r.bx - r.ax;
    let dz = r.bz - r.az;
    const len = Math.hypot(dx, dz);
    if (len < 0.05) continue;
    dx /= len;
    dz /= len;
    const cx = (r.ax + r.bx) / 2;
    const cz = (r.az + r.bz) / 2;
    // Overshoot the ends a touch so consecutive segments on a curve leave no seam.
    const ox = dx * 0.025;
    const oz = dz * 0.025;
    const ax = r.ax - ox;
    const az = r.az - oz;
    const bx = r.bx + ox;
    const bz = r.bz + oz;
    const ya = r.ay;
    const yb = r.by;
    const ym = (ya + yb) / 2;
    if (r.kind === 'wall') {
      // Alley: a tall concrete wall with a tired magenta tube along the top.
      b.wall.color(PAL.concrete, 1.05);
      b.wall.slopedBox(ax, az, bx, bz, ya, yb, 0.5, 2.7);
      b.neonFlicker.color(PAL.neonMagenta, 0.55);
      b.neonFlicker.tube(r.ax, ya + 2.8, r.az, r.bx, yb + 2.8, r.bz, 0.14);
      if (rng() < 0.2) {
        b.props.color(PAL.rust, 0.9);
        b.props.orientedBox(cx, cz, dx, dz, 0.6, 0.6, ym + 2.7, ym + 3.1);
      }
      continue;
    }
    if (r.zone === 'corporate') {
      // Highway guardrail: low base, a top rail, an even cyan reflector line.
      b.props.color(PAL.sidewalk, 1.15);
      b.props.slopedBox(ax, az, bx, bz, ya, yb, 0.5, 0.68);
      b.props.color(PAL.sidewalk, 0.95);
      b.props.slopedBox(ax, az, bx, bz, ya + 0.68, yb + 0.68, 0.28, 0.3);
      b.neon.color(PAL.neonCyan, 0.3);
      b.neon.tube(r.ax, ya + 1.0, r.az, r.bx, yb + 1.0, r.bz, 0.14);
      if (rng() < 0.08) {
        b.props.color(PAL.rust, 1);
        b.props.orientedBox(cx, cz, dx, dz, 0.5, 0.5, ym + 0.98, ym + 1.34);
      }
    } else if (r.zone === 'urban') {
      // City street: jersey barrier with a cyan/magenta strip alternating per stretch.
      b.props.color(PAL.concrete, 1.1);
      b.props.slopedBox(ax, az, bx, bz, ya, yb, 0.55, 0.9);
      const c = Math.floor(i / 6) % 2 === 0 ? PAL.neonCyan : PAL.neonMagenta;
      b.neon.color(c, 0.32);
      b.neon.tube(r.ax, ya + 0.94, r.az, r.bx, yb + 0.94, r.bz, 0.13);
    } else {
      // Old town: striped barrier, magenta every other segment, pink reflector.
      const hot = i % 2 === 0;
      b.props.color(hot ? PAL.neonMagenta : PAL.sidewalk, hot ? 0.5 : 1.1);
      b.props.slopedBox(ax, az, bx, bz, ya, yb, 0.55, 0.8);
      b.neon.color(PAL.neonPink, 0.3);
      b.neon.tube(r.ax, ya + 0.84, r.az, r.bx, yb + 0.84, r.bz, 0.13);
    }
  }
}

/* ------------------------------------------------------------------ lamps */

function buildRibbonLamps(b: EnvBuilders, rb: RibbonDef, rng: () => number): void {
  const path = rb.path;
  const alley = rb.kind === 'alley';
  const step = alley ? 24 : 38;
  let side = 1;
  for (let s = step / 2; s < path.length - (path.closed ? 0 : 4); s += step) {
    side = -side;
    const c = offsetAtStation(path, s, 0);
    const deck = rb.elevated && c.y > 0.5;
    // On a deck the post hangs off the fascia just outside the rail; on the ground it stands
    // on the pavement beyond the kerb.
    const off = c.halfWidth + (deck ? 0.45 : alley ? 0.9 : 1.9);
    const p = offsetAtStation(path, s, side * off);
    // Never plant a post where another road runs through at this level (an alley mouth, a
    // merge), nor under a deck that would swallow its head.
    let blocked = false;
    for (const other of b.plan.ribbons) {
      if (other !== rb && onRibbonAtLevel(other, p.x, p.z, c.y, 0.4)) {
        blocked = true;
        break;
      }
    }
    // A bus shelter stands exactly where this post wants to: it brings its own light.
    if (blocked || coveredAbove(b, p.x, p.z, c.y) || inBusStop(b.plan, p.x, p.z, 1)) continue;
    const zone = c.zone;
    const color = lampColor(zone, rng);
    const y0 = deck ? c.y - 0.4 : rb.elevated ? c.y : b.plan.padY(p.x, p.z);
    // Arm points back toward the road: the opposite of the offset direction.
    const dx = -side * -c.tz;
    const dz = -side * c.tx;
    const poleH = deck ? 7 : alley ? 4.4 : zone === 'corporate' ? 8.2 : 7.2;
    const arm = deck ? 3.4 : alley ? 0.9 : zone === 'corporate' ? 4.6 : 3.6;
    lampPost(b, p.x, p.z, y0, dx, dz, arm, poleH, color, off + 4, rollLampFault(rng));
  }
}

/* ------------------------------------------------------------------ alleys */

/** Hanging tubes along the walls and a stuttering sign at each mouth: the only hint. */
function buildAlleyDressing(b: EnvBuilders, rb: RibbonDef, rng: () => number): void {
  const path = rb.path;
  for (let s = 8; s < path.length - 8; s += 13) {
    const c = offsetAtStation(path, s, 0);
    const side = rng() < 0.5 ? -1 : 1;
    const p = offsetAtStation(path, s, side * (c.halfWidth - 0.35));
    // These tubes hug the alley wall. An alley runs past gaps, yards and setbacks as often as
    // it runs between two walls, and a tube hung where there is no wall is a bar of light
    // floating over the lane — so ask the city where its walls actually are.
    const nx = side * -c.tz;
    const nz = side * c.tx;
    const wx = Math.abs(nx) > Math.abs(nz) ? Math.sign(nx) : 0;
    const wz = wx === 0 ? Math.sign(nz) : 0;
    if (!b.walls.faceAt(p.x, 2.2, p.z, wx, wz)) continue;
    const color = rng() < 0.6 ? PAL.neonMagenta : PAL.neonCyan;
    const t = rng() < 0.4 ? b.neonFlicker : b.neonPulse;
    t.color(color, 0.9);
    t.tube(p.x - p.tx * 1.4, 2.2, p.z - p.tz * 1.4, p.x + p.tx * 1.4, 2.2, p.z + p.tz * 1.4, 0.16);
    halo(b, p.x - -p.tz * side * 0.3, 2.2, p.z - p.tx * side * 0.3, 6, 3.5, Math.atan2(-p.tx, -p.tz), color, 0.14);
    groundGlow(b, c.x, c.z, 9, 9, color, 0.08);
  }
  // Mouth signs: a small blade sign over each end, edge-on to the main road so it reads as
  // "there is a street here" only when you look for it.
  for (const end of [0, path.length]) {
    const inward = end === 0 ? 1 : -1;
    const c = offsetAtStation(path, end + inward * 6, 0);
    const p = offsetAtStation(path, end + inward * 6, -(c.halfWidth + 0.2));
    const uv = signCell(rng() < 0.5 ? 10 : 15);
    const rot = Math.atan2(c.tx, c.tz);
    // The sign needs something to be on. A wall at the mouth is the best of it; failing that
    // it goes up a post of its own, which is what a sign at the kerb would really be on.
    const mx = Math.abs(c.tz) > Math.abs(c.tx) ? Math.sign(-c.tz) : 0;
    const mz = mx === 0 ? Math.sign(c.tx) : 0;
    const y0 = b.plan.padY(p.x, p.z);
    if (!b.walls.faceAt(p.x, 4.6, p.z, mx, mz) && !b.walls.faceAt(p.x, 4.6, p.z, -mx, -mz)) {
      b.props.color(PAL.metalDark, 0.8);
      b.props.box(p.x, (y0 + 5.7) / 2, p.z, 0.22, 5.7 - y0, 0.22);
    }
    b.signs.panel(p.x, 4.6, p.z, 2.2, 2.2, rot, uv.u0, uv.v0, uv.u1, uv.v1);
    b.signs.panel(p.x, 4.6, p.z, 2.2, 2.2, rot + Math.PI, uv.u0, uv.v0, uv.u1, uv.v1);
    halo(b, p.x, 4.6, p.z, 8, 5, rot, PAL.neonMagenta, 0.16);
    groundGlow(b, c.x, c.z, 12, 12, PAL.neonMagenta, 0.1);
  }
}

/* ------------------------------------------------------------------ start / finish */

function buildStartLine(b: EnvBuilders, line: TrackLineDef): void {
  const nx = -line.tz;
  const nz = line.tx;
  const tx = line.tx;
  const tz = line.tz;
  // Checkered band: two rows of squares across the whole width.
  const cell = 1.0;
  const cols = Math.floor((line.halfWidth * 2) / cell);
  const rows = 2;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const light = (r + c) % 2 === 0;
      b.lane.color(light ? PAL.laneWhite : PAL.night, light ? 1.1 : 0.9);
      const u = -line.halfWidth + (c + 0.5) * cell;
      const v = (r - rows / 2 + 0.5) * cell;
      const px = line.x + nx * u + tx * v;
      const pz = line.z + nz * u + tz * v;
      const h = cell / 2;
      b.lane.quad(
        px - nx * h - tx * h, PAINT_Y + 0.002, pz - nz * h - tz * h,
        px + nx * h - tx * h, PAINT_Y + 0.002, pz + nz * h - tz * h,
        px + nx * h + tx * h, PAINT_Y + 0.002, pz + nz * h + tz * h,
        px - nx * h + tx * h, PAINT_Y + 0.002, pz - nz * h + tz * h,
      );
    }
  }
  // Gantry: two pylons outside the rails, a deep beam, and a neon underline across the road.
  const height = 12;
  const reach = line.halfWidth + 2.4;
  for (const side of [-1, 1]) {
    const x = line.x + nx * side * reach;
    const z = line.z + nz * side * reach;
    b.props.color(PAL.metalDark, 0.9);
    b.props.box(x, height / 2, z, 1.2, height, 1.2);
    const c = side < 0 ? PAL.neonCyan : PAL.neonMagenta;
    b.neonPulse.color(c, 1);
    b.neonPulse.tube(x, 1.2, z, x, height - 0.8, z, 0.36);
    halo(b, x - tx * 0.8, height / 2, z - tz * 0.8, 9, height * 1.2, Math.atan2(-tx, -tz), c, 0.16);
    groundGlow(b, x - nx * side * 5, z - nz * side * 5, 26, 26, c, 0.12);
  }
  b.props.color(PAL.metalDark, 0.85);
  b.props.orientedBox(line.x, line.z, nx, nz, reach * 2 + 1.2, 2.2, height - 2.4, height);
  // Neon under the beam, cyan into magenta across the width: the line the whole lap is measured from.
  const half = reach;
  b.neon.color(PAL.neonCyan, 1);
  b.neon.tube(line.x - nx * half, height - 2.6, line.z - nz * half, line.x, height - 2.6, line.z, 0.26);
  b.neon.color(PAL.neonMagenta, 1);
  b.neon.tube(line.x, height - 2.6, line.z, line.x + nx * half, height - 2.6, line.z + nz * half, 0.26);
  b.neonPulse.color(PAL.neonWhite, 0.9);
  b.neonPulse.tube(line.x - nx * half, height - 2.0, line.z - nz * half, line.x + nx * half, height - 2.0, line.z + nz * half, 0.16);
  halo(b, line.x, height - 2.3, line.z, reach * 2, 6, Math.atan2(-tx, -tz), PAL.neonViolet, 0.14);
  groundGlow(b, line.x, line.z, reach * 2.2, 30, PAL.neonViolet, 0.1);
}

/** Slim cyan arch: a checkpoint. Legible from far, cheap up close. */
function buildCheckpointArch(b: EnvBuilders, cp: TrackLineDef): void {
  const nx = -cp.tz;
  const nz = cp.tx;
  const height = 7.5;
  const reach = cp.halfWidth + 2.0;
  for (const side of [-1, 1]) {
    const x = cp.x + nx * side * reach;
    const z = cp.z + nz * side * reach;
    b.props.color(PAL.metalDark, 0.8);
    b.props.box(x, height / 2, z, 0.5, height, 0.5);
    b.neon.color(PAL.neonCyan, 0.9);
    b.neon.tube(x, 0.8, z, x, height, z, 0.22);
  }
  b.neonPulse.color(PAL.neonCyan, 1);
  b.neonPulse.tube(cp.x - nx * reach, height, cp.z - nz * reach, cp.x + nx * reach, height, cp.z + nz * reach, 0.24);
  halo(b, cp.x, height - 1, cp.z, reach * 2, 5, Math.atan2(-cp.tx, -cp.tz), PAL.neonCyan, 0.12);
  groundGlow(b, cp.x, cp.z, reach * 2, 18, PAL.neonCyan, 0.07);
}
