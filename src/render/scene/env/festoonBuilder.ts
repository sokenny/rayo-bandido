import type { FestoonSite } from '../../../world/cityPlan';
import { hash01 } from '../../../world/cityGen';
import { PAL } from './palette';
import { makeRng } from './meshBuilder';
import { densityAt, groundGlow, halo, type EnvBuilders, type WallVolume } from './builders';

/**
 * THE STRINGS OF LAMPS (`CityPlan.festoons`). Across the alleys and the narrow streets, facade
 * to facade, a wire with little bulbs on it — the pasacalles a back street hangs over itself,
 * the one bit of the city that is warm on purpose. Nothing over an avenue: a string of bulbs
 * across eight lanes is a lie.
 *
 * The world says where along which road a string could go; this walks out from the kerb at
 * the string's height to the first wall the city actually registered (`b.walls`) on each side,
 * and hangs one only when it finds both. So a string never ends in the air over a lot, a
 * crossing, a park or a set-back tower's forecourt, and the thinning happens by itself.
 *
 * A run (one alley, one strung stretch of a street) shares a look: warm bulbs, a string of
 * coloured ones, or paper lanterns; hung straight across or zigzagging wall to wall. Every
 * bulb is a speck of unlit neon with a small halo turned down the street, where the driver is
 * looking from, and each string leaves one faint warm pool on the asphalt under it. All of it
 * lands in the existing batches: no draw calls, no lights.
 */

/** Tungsten, and the paper lanterns' red. Fixed, not per palette: these are the city's warm notes. */
const TUNGSTEN = 0xffb866;
const LANTERN_RED = 0xff4b36;
const LANTERN_AMBER = 0xff9a3a;

type Look = 'warm' | 'colour' | 'lantern';

export const FESTOON_LOOK = {
  /** Height of the anchors over the ground at each end (m), by kind: [min, max]. */
  height: { alley: [4.6, 5.4], lane: [5.4, 6.3], street: [5.8, 6.8] } as Record<FestoonSite['kind'], [number, number]>,
  /** Sag at mid-span as a share of the span. Nothing ever hangs below `minClear`. */
  sag: [0.045, 0.08] as [number, number],
  minClear: 4.4,
  /** Height over the ground at which the walls are felt for (m): under every eave in the city. */
  probe: 3,
  /** How far past the kerb to look for a wall to hang from (m), and the longest span wall to wall, by kind. */
  reach: 9,
  maxSpan: { alley: 22, lane: 26, street: 27 } as Record<FestoonSite['kind'], number>,
  /** Along-street shifts (m) tried from a site before it is given up. */
  shifts: [0, 2.5, -2.5, 5, -5],
  /** Closest two strings' middles may come (m). */
  gap: 5.5,
  /** Metres of wire per bulb, by look. */
  spacing: { warm: 0.75, colour: 0.8, lantern: 1.5 } as Record<Look, number>,
  /** Share of runs that take each look, cumulative: warm below the first, colour below the second. */
  lookSplit: [0.5, 0.78],
  /** Share of runs hung zigzag rather than straight across, by kind. */
  zigzag: { alley: 0.65, lane: 0.45, street: 0.3 } as Record<FestoonSite['kind'], number>,
};

const COLOURS = (): number[] => [LANTERN_RED, TUNGSTEN, PAL.neonCyan, LANTERN_AMBER, PAL.neonMagenta];

export interface FestoonStats {
  sites: number;
  hung: number;
  /** Sites given up for want of a wall on one side or the other. */
  noWall: number;
  /** Where each string went up: [x, z, kind] for the QA scripts. */
  at: Array<[number, number, FestoonSite['kind']]>;
}

export function buildFestoons(b: EnvBuilders): FestoonStats {
  const sites = b.plan.festoons ?? [];
  const stats: FestoonStats = { sites: sites.length, hung: 0, noWall: 0, at: [] };
  const rng = makeRng(0xf35700);
  const padY = b.plan.padY;

  // The first wall met walking out from the kerb, and the band of heights a string could be
  // tied to it at: over the clearance, under its eaves, and on the wall rather than under an
  // overhang that starts higher up. A stacked building registers a volume per band, so the
  // band is followed up through the volumes above it.
  const near: WallVolume[] = [];
  const hit = { d: -1, lo: 0, hi: 0 };
  const wallAt = (x: number, z: number, nx: number, nz: number, from: number, reach: number): typeof hit => {
    hit.d = -1;
    b.walls.collect(x + nx * (from + reach / 2), z + nz * (from + reach / 2), reach / 2 + 1, near);
    for (let d = from; d < from + reach; d += 0.25) {
      const px = x + nx * d;
      const pz = z + nz * d;
      const g = padY(px, pz);
      for (const v of near) {
        if (px < v.minX || px > v.maxX || pz < v.minZ || pz > v.maxZ) continue;
        if (v.y0 - g > FESTOON_LOOK.height.street[1] || v.y1 - g < FESTOON_LOOK.minClear + 0.6) continue;
        let top = v.y1;
        for (const u of near) if (u.y0 <= top + 0.05 && u.y1 > top && px >= u.minX && px <= u.maxX && pz >= u.minZ && pz <= u.maxZ) top = u.y1;
        hit.d = d - 0.05;
        hit.lo = Math.max(v.y0 - g + 0.3, FESTOON_LOOK.minClear + 0.3);
        hit.hi = top - g - 0.35;
        return hit;
      }
    }
    return hit;
  };

  const mids: Array<[number, number]> = [];
  for (const f of sites) {
    const density = densityAt(b, f.x, f.z);
    if (density < 1 && rng() > density + 0.35) continue;
    const roll = hash01(f.run * 3.1, 17.3);
    const look: Look = roll < FESTOON_LOOK.lookSplit[0] ? 'warm' : roll < FESTOON_LOOK.lookSplit[1] ? 'colour' : 'lantern';
    const zig = hash01(f.run * 5.7, 4.1) < FESTOON_LOOK.zigzag[f.kind];
    const [hLo, hHi] = FESTOON_LOOK.height[f.kind];
    const h = hLo + (hHi - hLo) * hash01(f.run, f.seq * 0.61);

    // Left is -normal, right +normal. A zigzag leans each string the other way from the last,
    // so neighbours meet near the same point on the wall.
    const nx = -f.tz;
    const nz = f.tx;
    const lean0 = zig ? (f.seq % 2 === 0 ? 1 : -1) * (f.kind === 'alley' ? 3.8 : 4.8) : 0;
    // A string is only hung where the street reads narrow: walls far back behind a pavement
    // and a forecourt make a plaza of it, and a 40 m span of bulbs is a fairground.
    const reach = Math.min(FESTOON_LOOK.reach, (FESTOON_LOOK.maxSpan[f.kind] - f.halfWidth * 2) / 2);
    // The station, then a few metres either way along the street (a gap between two buildings,
    // a doorway recess), then straight across if the zigzag's lean found nothing.
    let found: { ax: number; az: number; bx: number; bz: number; hang: number } | null = null;
    for (const lean of lean0 !== 0 ? [lean0, 0] : [0]) {
      for (const shift of FESTOON_LOOK.shifts) {
        const cx = f.x + f.tx * shift;
        const cz = f.z + f.tz * shift;
        const lx0 = cx - f.tx * lean;
        const lz0 = cz - f.tz * lean;
        const rx0 = cx + f.tx * lean;
        const rz0 = cz + f.tz * lean;
        const left = wallAt(lx0, lz0, -nx, -nz, f.halfWidth, reach);
        if (left.d < 0) continue;
        const dl = left.d;
        const loL = left.lo;
        const hiL = left.hi;
        const right = wallAt(rx0, rz0, nx, nz, f.halfWidth, reach);
        if (right.d < 0) continue;
        // Where both walls can take it, as near the run's own height as they allow.
        const lo = Math.max(loL, right.lo);
        const hi = Math.min(hiL, right.hi);
        if (lo > hi) continue;
        // Not on top of the last one: a shifted neighbour can land where this one already hangs.
        const mx = (lx0 + rx0) / 2;
        const mz = (lz0 + rz0) / 2;
        if (mids.some(([px, pz]) => Math.hypot(px - mx, pz - mz) < FESTOON_LOOK.gap)) continue;
        found = { ax: lx0 - nx * dl, az: lz0 - nz * dl, bx: rx0 + nx * right.d, bz: rz0 + nz * right.d, hang: Math.min(Math.max(h, lo), hi) };
        break;
      }
      if (found) break;
    }
    if (!found) {
      stats.noWall++;
      continue;
    }
    const { ax, az, bx, bz, hang } = found;
    mids.push([(ax + bx) / 2, (az + bz) / 2]);
    const ay = padY(ax, az) + hang;
    const by = padY(bx, bz) + hang;
    const span = Math.hypot(bx - ax, bz - az);
    const sagShare = FESTOON_LOOK.sag[0] + (FESTOON_LOOK.sag[1] - FESTOON_LOOK.sag[0]) * rng();
    const ground = padY(f.x, f.z);
    const sag = Math.max(0, Math.min(span * sagShare, Math.min(ay, by) - ground - FESTOON_LOOK.minClear));
    const at = (t: number): [number, number, number] => [ax + (bx - ax) * t, ay + (by - ay) * t - sag * 4 * t * (1 - t), az + (bz - az) * t];

    // The wire, and a bracket where it meets each wall.
    b.props.color(PAL.metalDark, 0.3);
    const segs = 10;
    let prev = at(0);
    for (let i = 1; i <= segs; i++) {
      const p = at(i / segs);
      b.props.tube(prev[0], prev[1], prev[2], p[0], p[1], p[2], 0.035);
      prev = p;
    }
    b.props.color(PAL.metalDark, 0.5);
    b.props.box(ax, ay, az, 0.14, 0.14, 0.14);
    b.props.box(bx, by, bz, 0.14, 0.14, 0.14);

    // The bulbs. Their halos face down the street, the way the driver looks at them.
    const rotY = Math.atan2(f.tx, f.tz);
    const palette = COLOURS();
    const count = Math.max(3, Math.round(span / FESTOON_LOOK.spacing[look]));
    const phase = Math.floor(hash01(f.run, f.seq) * palette.length);
    for (let i = 1; i < count; i++) {
      const [px, py, pz] = at(i / count);
      if (look === 'lantern') {
        const c = (i + f.seq) % 3 === 0 ? LANTERN_AMBER : LANTERN_RED;
        b.props.color(PAL.metalDark, 0.3);
        b.props.box(px, py - 0.12, pz, 0.02, 0.24, 0.02);
        b.neon.color(c, 0.85).fault(0);
        b.neon.box(px, py - 0.44, pz, 0.3, 0.4, 0.3);
        halo(b, px, py - 0.44, pz, 1.5, 1.5, rotY, c, 0.26);
      } else {
        const c = look === 'warm' ? TUNGSTEN : palette[(i + phase) % palette.length];
        // A bulb or two out on the odd string: a string that is all perfect reads as new.
        if (look === 'warm' && hash01(px * 7.3, pz * 1.9) < 0.06) {
          b.props.color(PAL.metalDark, 0.8);
          b.props.box(px, py - 0.1, pz, 0.1, 0.12, 0.1);
          continue;
        }
        b.neon.color(c, 1.15).fault(0);
        b.neon.box(px, py - 0.1, pz, 0.12, 0.15, 0.12);
        halo(b, px, py - 0.1, pz, 0.75, 0.75, rotY, c, 0.34);
      }
    }
    // One warm pool on the asphalt under the string, stretched along the street.
    const [mx, , mz] = at(0.5);
    const pool = look === 'colour' ? LANTERN_AMBER : look === 'lantern' ? LANTERN_RED : TUNGSTEN;
    const across = Math.abs(nx) > Math.abs(nz);
    const wAcross = f.halfWidth * 2 + 1;
    const wAlong = f.kind === 'alley' ? 7 : 9;
    groundGlow(b, mx, mz, across ? wAcross : wAlong, across ? wAlong : wAcross, pool, f.kind === 'alley' ? 0.085 : 0.065);
    stats.hung++;
    stats.at.push([f.x, f.z, f.kind]);
  }
  return stats;
}
