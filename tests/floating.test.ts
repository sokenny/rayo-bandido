import { describe, expect, it } from 'vitest';
import { createBuilders } from '../src/render/scene/env/builders';
import type { EnvBuilders } from '../src/render/scene/env/builders';
import type { MeshBuilder } from '../src/render/scene/env/meshBuilder';
import { buildCity } from '../src/render/scene/env/cityBuilder';
import { buildLandmarks } from '../src/render/scene/env/landmarksBuilder';
import { buildProps } from '../src/render/scene/env/propsBuilder';
import { buildTrack } from '../src/render/scene/env/trackBuilder';
import { buildTransit } from '../src/render/scene/env/transitBuilder';
import { buildReclamation } from '../src/render/scene/env/reclaimBuilder';
import { createCityWorld } from '../src/world/cityWorld';

/**
 * Nothing hangs in the air.
 *
 * Signs, screens and shopfront bands are placed against a building, but the code that places
 * them and the code that decides the building's shape are not the same code — and most
 * archetypes stand well inside their plot (a slab takes a third of it, a podium tower half).
 * Anything placed on the plot edge instead of on a wall ends up floating over the setback,
 * which is exactly what the eye picks out first in a night city.
 *
 * So this sweeps the whole generated city: every lit panel and every neon band is checked
 * against a voxel grid of the solid geometry, and must have something solid within reach
 * behind it. It is a contract on the result, not on any one placement site, so it also
 * catches the next builder that reaches for a plot rectangle.
 */

/** Voxel edge (m). Coarse enough to stay cheap, fine enough that a 3 m setback fails. */
const CELL = 1;
/** How far behind a panel solid geometry may be before it reads as floating. */
const REACH = 2.5;

/**
 * The whole city, plus a note of how much of each lit builder the CITY itself produced.
 * The sweep below covers that range only. What comes after it — the plan's free-standing
 * billboards on masts, the ring drum, the bus stops, the route markers — is hand-placed
 * furniture standing on its own structure, deliberately clear of any wall. The generated
 * facade dressing is what has a building to be wrong about, and what this pins down.
 */
function buildEverything(): { b: EnvBuilders; cityTris: (mb: MeshBuilder) => number } {
  const { plan } = createCityWorld();
  const b = createBuilders(plan);
  buildCity(b);
  const cityEnd = new Map<MeshBuilder, number>();
  for (const mb of [b.signs, b.billA, b.billB]) cityEnd.set(mb, mb.positions.length / 9);
  buildTrack(b);
  buildProps(b);
  buildTransit(b);
  buildLandmarks(b);
  buildReclamation(b);
  return { b, cityTris: (mb) => cityEnd.get(mb) ?? 0 };
}

const key = (x: number, y: number, z: number): number =>
  (Math.floor(x / CELL) + 4096) * 16777216 + (Math.floor(y / CELL) + 512) * 8192 + (Math.floor(z / CELL) + 4096);

/**
 * Occupancy of every solid surface. Each triangle is sampled on a grid finer than a voxel,
 * so a big wall is filled in rather than marked only at its corners.
 */
function occupancy(builders: MeshBuilder[]): Set<number> {
  const cells = new Set<number>();
  const STEP = CELL / 2;
  for (const mb of builders) {
    const p = mb.positions;
    for (let i = 0; i < p.length; i += 9) {
      const ax = p[i];
      const ay = p[i + 1];
      const az = p[i + 2];
      const ux = p[i + 3] - ax;
      const uy = p[i + 4] - ay;
      const uz = p[i + 5] - az;
      const vx = p[i + 6] - ax;
      const vy = p[i + 7] - ay;
      const vz = p[i + 8] - az;
      const nu = Math.max(1, Math.ceil(Math.hypot(ux, uy, uz) / STEP));
      const nv = Math.max(1, Math.ceil(Math.hypot(vx, vy, vz) / STEP));
      for (let a = 0; a <= nu; a++) {
        for (let c = 0; c <= nv; c++) {
          const s = a / nu;
          const t = c / nv;
          if (s + t > 1) continue;
          cells.add(key(ax + ux * s + vx * t, ay + uy * s + vy * t, az + uz * s + vz * t));
        }
      }
    }
  }
  return cells;
}

/**
 * Every VERTEX of `mb`, carrying its triangle's facing. Vertices and not centroids: a panel
 * that is centred on its wall but wider than it overhangs at the corners only, and a centroid
 * would never notice.
 */
function faces(mb: MeshBuilder): Array<[number, number, number, number, number, number]> {
  const out: Array<[number, number, number, number, number, number]> = [];
  const p = mb.positions;
  const n = mb.normals;
  for (let i = 0; i < p.length; i += 9) {
    const nx = (n[i] + n[i + 3] + n[i + 6]) / 3;
    const ny = (n[i + 1] + n[i + 4] + n[i + 7]) / 3;
    const nz = (n[i + 2] + n[i + 5] + n[i + 8]) / 3;
    for (let k = 0; k < 3; k++) out.push([p[i + k * 3], p[i + k * 3 + 1], p[i + k * 3 + 2], nx, ny, nz]);
  }
  return out;
}

describe('nothing floats in the air', () => {
  const { b, cityTris } = buildEverything();
  // A rooftop board stands on its own posts above a roof; a sign under the viaduct hangs off
  // the deck. Those are the only two things allowed to be clear of a wall, so they are the
  // only two supports looked for besides the wall itself. Notably absent: `props`. A screen's
  // frame and a board's posts are drawn wherever the panel is, so counting them would let a
  // floating panel vouch for itself.
  const roofs = occupancy([b.roof]);
  const decks = occupancy([b.concrete]);
  /** How far a board may stand above the roof it is posted on. */
  const STILT = 10;
  /** How far a sign may hang below the deck it is bolted to. */
  const DROP = 4;

  /** Panels below this are street furniture on its own post; they carry themselves. */
  const GROUND = 5.5;

  const check = (name: string, mb: MeshBuilder, minY: number): void => {
    it(`${name} panels are all against something`, () => {
      const floating: string[] = [];
      const all = faces(mb).slice(0, cityTris(mb));
      for (const [x, y, z, nx, ny, nz] of all) {
        if (y < minY) continue;
        // Panels in this city are axis-aligned; the normal says which wall they want.
        const dx = Math.abs(nx) > 0.5 ? Math.sign(nx) : 0;
        const dz = Math.abs(nz) > 0.5 ? Math.sign(nz) : 0;
        let found = Math.abs(ny) > 0.5;
        // A wall behind it, on either face — a panel may be wound either way, and both sides
        // of a wall are legitimate places to hang one.
        if (!found && (dx !== 0 || dz !== 0)) {
          found = b.walls.faceAt(x, y, z, dx, dz, REACH) || b.walls.faceAt(x, y, z, -dx, -dz, REACH);
        }
        for (let t = 0; t <= STILT && !found; t += CELL / 2) if (roofs.has(key(x, y - t, z))) found = true;
        for (let t = 0; t <= DROP && !found; t += CELL / 2) if (decks.has(key(x, y + t, z))) found = true;
        if (!found) floating.push(`(${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)})`);
      }
      if (floating.length) console.log(`${name}: ${floating.length} of ${all.length} floating`);
      expect(floating.slice(0, 12).join(' ')).toBe('');
    });
  };

  check('sign', b.signs, GROUND);
  check('billboard A', b.billA, GROUND);
  check('billboard B', b.billB, GROUND);
});
