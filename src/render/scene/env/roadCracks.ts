import type { RibbonDef } from '../../../world/cityPlan';
import { onRibbonAtLevel } from '../../../world/cityGen';
import { offsetAtStation } from '../../../world/track';
import { inRect, makeRng } from './meshBuilder';
import { PAINT_Y } from './cityBuilder';
import { concreteAt, inPieceHole, type EnvBuilders } from './builders';

/**
 * CRACKS IN THE ASPHALT — the Obelisco's fissure (`obeliscoBuilder.ts`) at street scale.
 *
 * Thin, jagged, branching dark lines painted flat on the road: no relief, no collider, nothing
 * the car feels. They are art only, laid over the lane paint, and there is no physics module
 * that reads them.
 *
 * Where: every ribbon is walked in steps of `STEP` metres and each step rolls for a crack
 * against the reclamation field (`reclaim.ts`), so the cracked stretches are the same tired
 * places the weeds and the paint already mark and a kept avenue stays mostly whole. The Stack
 * is the exception: the field sweeps its core for plants, but its concrete streets are the
 * heaviest in the city and carry the most traffic, so the asphalt there is the most broken.
 * Junctions are skipped (two slabs at different lifts) and so is the Obelisco's own fissure.
 */

/** Distance between rolls along a ribbon (m). */
const STEP = 9;
/** Chance per roll where the field is 0 and where it is 1. */
const CHANCE_MIN = 0.025;
const CHANCE_MAX = 0.34;
/** Multiplier on the chance on the heavy streets (`heavyStreet`). */
const HEAVY_BOOST = 1.7;
/** Elevated decks are newer and better kept than the streets. */
const DECK_BIAS = 0.45;
/** Clear of the road edge (m), so no crack runs up onto the kerb band. */
const EDGE_CLEAR = 0.35;
/** Above the lane paint (m). Well under the 2 cm a car can sit on before it looks sunk. */
const CRACK_Y = PAINT_Y + 0.003;
const CRACK_COLOR = 0x040405;

interface CrackPt {
  /** Station along the ribbon and lateral offset from its centreline (m). */
  s: number;
  l: number;
  /** Width here (m). */
  w: number;
}

export function buildRoadCracks(b: EnvBuilders): void {
  const rng = makeRng(0xc4ac5);
  const fissurePts = b.plan.obelisco?.fissures.flat() ?? [];
  for (const rb of b.plan.ribbons) {
    const len = rb.path.length;
    const lift = rb.lift ?? (rb.kind === 'alley' ? 0.006 : 0);
    for (let s = STEP * rng(); s < len - 2; s += STEP) {
      const c = offsetAtStation(rb.path, s, 0);
      if (fissurePts.some((p) => Math.hypot(p.x - c.x, p.z - c.z) < 14)) continue;
      const intensity = b.reclaim.intensityAt(c.x, c.z);
      let chance = CHANCE_MIN + (CHANCE_MAX - CHANCE_MIN) * Math.min(1, intensity * 1.2);
      const heavyHere = heavyStreet(b, c.x, c.z);
      if (heavyHere) chance *= HEAVY_BOOST;
      if (rb.elevated) chance *= DECK_BIAS;
      if (rb.kind === 'alley') chance *= 1.3;
      if (rng() >= chance) continue;
      // A worse spot gets longer cracks, more branches, and now and then a small web.
      const heavy = Math.min(1, intensity + (heavyHere ? 0.35 : 0));
      const room = c.halfWidth - EDGE_CLEAR;
      if (room < 1) continue;
      const s0 = s + (rng() - 0.5) * STEP * 0.8;
      const l0 = (rng() * 2 - 1) * room * 0.85;
      // Mostly across the lane (thermal cracks) or along it (the wheel tracks), sometimes anything.
      const roll = rng();
      const heading = roll < 0.45 ? Math.PI / 2 : roll < 0.8 ? 0 : rng() * Math.PI;
      const length = 1.6 + rng() * (2.5 + heavy * 5);
      const width = 0.09 + rng() * 0.06 + heavy * 0.07;
      const main = walk(rng, s0, l0, heading + (rng() - 0.5) * 0.5, length, width);
      const lines = [main];
      const branches = Math.floor(rng() * (1 + heavy * 2.6));
      for (let k = 0; k < branches; k++) {
        const from = main[1 + Math.floor(rng() * Math.max(1, main.length - 2))];
        const side = rng() < 0.5 ? -1 : 1;
        lines.push(walk(rng, from.s, from.l, heading + side * (0.6 + rng() * 0.7), length * (0.25 + rng() * 0.35), from.w * 0.75));
      }
      if (heavy > 0.6 && rng() < 0.35) {
        // Alligator skin: a handful of short cracks crossing about one spot.
        const n = 3 + Math.floor(rng() * 3);
        for (let k = 0; k < n; k++) {
          const a = rng() * Math.PI;
          const r = 0.4 + rng() * 0.9;
          lines.push(walk(rng, s0 + Math.cos(a) * r * 0.5, l0 + Math.sin(a) * r * 0.5, rng() * Math.PI, 0.8 + rng() * 1.2, width * 0.6));
        }
      }
      // Drawn after every draw of the rng, so skipping one leaves the rest of the city's cracks as they were.
      if (!rb.elevated && inPieceHole(b, c.x, c.z, 10)) continue;
      for (const line of lines) drawLine(b, rb, line, room, lift);
    }
  }
}

/** The Stack's streets: the concrete finish (`CityPlan.finishAt`) and the downtown core inside it. */
function heavyStreet(b: EnvBuilders, x: number, z: number): boolean {
  return concreteAt(b, x, z) || (!!b.plan.downtown && inRect(b.plan.downtown, x, z));
}

/** A jagged random walk from (s, l) in road space: short kinked steps, tapering at both ends. */
function walk(rng: () => number, s: number, l: number, heading: number, length: number, width: number): CrackPt[] {
  const pts: CrackPt[] = [];
  let a = heading;
  let travelled = 0;
  let ps = s;
  let pl = l;
  while (true) {
    const t = travelled / length;
    // Fat in the middle, a hairline at the tips.
    const taper = Math.sin(Math.PI * Math.min(1, Math.max(0, t)));
    pts.push({ s: ps, l: pl, w: Math.max(0.025, width * (0.35 + 0.65 * taper) * (0.75 + rng() * 0.5)) });
    if (travelled >= length) break;
    const step = 0.3 + rng() * 0.5;
    a += (rng() - 0.5) * 1.1;
    // Keep wandering around the chosen heading instead of curling back.
    a += (heading - a) * 0.35;
    ps += Math.cos(a) * step;
    pl += Math.sin(a) * step;
    travelled += step;
  }
  return pts;
}

/** Lay one crack polyline on the ribbon, stopping at its edge and wherever another road crosses. */
function drawLine(b: EnvBuilders, rb: RibbonDef, pts: CrackPt[], room: number, lift: number): void {
  const len = rb.path.length;
  const world = pts.map((p) => {
    const inside = Math.abs(p.l) <= room && (rb.path.closed || (p.s > 0.5 && p.s < len - 0.5));
    const s = rb.path.closed ? ((p.s % len) + len) % len : p.s;
    const o = offsetAtStation(rb.path, s, p.l);
    const y = (rb.elevated ? o.y : b.plan.padY(o.x, o.z)) + lift + CRACK_Y;
    return { ...o, pathY: o.y, y, w: p.w, ok: inside };
  });
  for (const q of world) {
    if (!q.ok) continue;
    for (const other of b.plan.ribbons) {
      if (other !== rb && onRibbonAtLevel(other, q.x, q.z, q.pathY, 0.8)) {
        q.ok = false;
        break;
      }
    }
  }
  b.props.color(CRACK_COLOR, 1);
  for (let i = 0; i < world.length - 1; i++) {
    const e = world[i];
    const f = world[i + 1];
    if (!e.ok || !f.ok) continue;
    let dx = f.x - e.x;
    let dz = f.z - e.z;
    const d = Math.hypot(dx, dz) || 1;
    dx /= d;
    dz /= d;
    // The left of the direction of travel, as `trackBuilder.ts` takes it.
    const nx = dz;
    const nz = -dx;
    const el = e.w * 0.5;
    const fl = f.w * 0.5;
    // Winding gives a +Y normal: left-back, right-back, right-front, left-front.
    b.props.quad(
      e.x + nx * el, e.y, e.z + nz * el,
      e.x - nx * el, e.y, e.z - nz * el,
      f.x - nx * fl, f.y, f.z - nz * fl,
      f.x + nx * fl, f.y, f.z + nz * fl,
      0, 0, 1, 1,
    );
  }
}
