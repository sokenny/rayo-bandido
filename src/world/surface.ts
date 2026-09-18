import type { SurfaceField, SurfaceSample } from '../core/types';
import { DRY_FIELD, type LakeField } from './park';
import type { SetPieceCut, SetPieceSurface, SetPieceSpec } from './setPieces/types';
import { FLAT_TERRAIN, type Terrain } from './terrain';
import { createProjection, projectOntoPath, segmentCount, type TrackPath } from './track';

/**
 * The drivable heights of a world, built from its elevated ribbons (viaducts, ramps, the
 * skyway). The ground at y 0 is always a candidate; every elevated path the point lies on
 * adds another, at that path's height there. Of the candidates, the HIGHEST one the body can
 * step onto wins — anything up to `STEP_UP` above the height it already has — so a car on
 * the deck stays on the deck over the street below, a car on the street stays under the deck
 * (15 m is no step), and a car at the foot of a ramp is carried up it: the ramp is always a
 * few centimetres above where the car was a tick ago. The same rule brings it down again,
 * since the ramp is then the highest surface still under the car.
 *
 * `pad` widens each ribbon a little past its guardrails, so a car pressed into a rail still
 * stands on the deck rather than dropping to the ground beside it.
 *
 * Ground level is the terrain (`terrain.ts`): flat at y 0 in a world without one, a height
 * field with its own gradient in a world with hills. The pavement beside the streets is laid
 * flush with the asphalt, so there is no kerb to climb and nothing to read under a car that
 * strays off the road: on and off the road alike, the ground is the terrain's height there.
 *
 * INDEXED. Every car, bus and police unit asks this every tick, and the open world's elevated
 * loops each run to thousands of segments and have bounding boxes that cover most of the map,
 * so projecting onto them whole was most of the traffic's cost. Each segment is filed, padded
 * by its ribbon's reach, in the grid cells it touches; a point only measures the segments of
 * its own cell. The answer is the exhaustive one: a point near enough a ribbon to stand on it
 * is within reach of that ribbon's nearest segment, which is therefore filed in its cell.
 *
 * LAKES (`park.ts`): where a world has water on the land, the ground candidate is the terrain
 * LESS the lake's depth there, gradient and all, so a car that leaves the road by a lake rolls
 * down the bank into the water instead of driving across it. Dry everywhere in a world without.
 *
 * SET-PIECES (`setPieces/types.ts`): a set-piece's CUT lowers the ground candidate further (dry:
 * nothing here or in `layout.waterDepth` calls it water), and its SURFACES join the contest the
 * way the ribbons do — highest at most `STEP_UP` above the hint wins, `null` meaning no slab at
 * that point. Their grades are central differences of the functions they give. All of it sits
 * behind one bounding box over every cut and slab, so the rest of the map pays one compare.
 *
 * Allocation-free per sample: one scratch projection, the index built once up front.
 */
/** Largest rise a body takes in its stride (m). A ramp climbs a few centimetres per tick. */
export const STEP_UP = 0.6;

/** Side of a cell of the segment index (m). */
const CELL = 16;

/** Finite-difference step for a set-piece's cut and slab grades (m). */
const PIECE_STEP = 0.25;

export function createSurfaceField(
  paths: readonly TrackPath[],
  pad = 1.5,
  terrain: Terrain = FLAT_TERRAIN,
  lakes: LakeField = DRY_FIELD,
  setPieces: readonly SetPieceSpec[] = [],
): SurfaceField {
  const proj = createProjection();
  const cuts: SetPieceCut[] = [];
  const slabs: SetPieceSurface[] = [];
  for (const sp of setPieces) {
    if (sp.cut) cuts.push(sp.cut);
    if (sp.surfaces) slabs.push(...sp.surfaces);
  }
  // One box over every cut and slab: outside it a sample never looks at a set-piece.
  let pMinX = Infinity;
  let pMaxX = -Infinity;
  let pMinZ = Infinity;
  let pMaxZ = -Infinity;
  for (const r of [...cuts.map((c) => c.bounds), ...slabs.map((sl) => sl.bounds)]) {
    pMinX = Math.min(pMinX, r.minX);
    pMaxX = Math.max(pMaxX, r.maxX);
    pMinZ = Math.min(pMinZ, r.minZ);
    pMaxZ = Math.max(pMaxZ, r.maxZ);
  }
  const slabY = (sl: SetPieceSurface, x: number, z: number): number | null => {
    const y = sl.heightAt(x, z);
    return y === null || !sl.onGround ? y : y + terrain.heightAt(x, z);
  };
  const flat = terrain.flat;
  const dry = lakes === DRY_FIELD;
  const basin: SurfaceSample = { y: 0, gx: 0, gz: 0 };
  const reaches = paths.map((path) => {
    let reach = 0;
    for (const s of path.samples) if (s.halfWidth > reach) reach = s.halfWidth;
    return reach + pad;
  });

  // The grid covers every padded segment.
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  paths.forEach((path, p) => {
    for (const s of path.samples) {
      minX = Math.min(minX, s.x - reaches[p]);
      maxX = Math.max(maxX, s.x + reaches[p]);
      minZ = Math.min(minZ, s.z - reaches[p]);
      maxZ = Math.max(maxZ, s.z + reaches[p]);
    }
  });
  const empty = paths.length === 0;
  const nx = empty ? 0 : Math.max(1, Math.ceil((maxX - minX) / CELL));
  const nz = empty ? 0 : Math.max(1, Math.ceil((maxZ - minZ) / CELL));

  // Per cell, (path, segment) pairs, in path order and then segment order: the order the
  // exhaustive search visited them in, so ties resolve the same way.
  const lists: number[][] = Array.from({ length: nx * nz }, () => []);
  paths.forEach((path, p) => {
    const samples = path.samples;
    const n = samples.length;
    const r = reaches[p];
    const segs = segmentCount(path);
    for (let i = 0; i < segs; i++) {
      const a = samples[i];
      const b = samples[(i + 1) % n];
      const c0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - r - minX) / CELL));
      const c1 = Math.min(nx - 1, Math.floor((Math.max(a.x, b.x) + r - minX) / CELL));
      const r0 = Math.max(0, Math.floor((Math.min(a.z, b.z) - r - minZ) / CELL));
      const r1 = Math.min(nz - 1, Math.floor((Math.max(a.z, b.z) + r - minZ) / CELL));
      for (let row = r0; row <= r1; row++) for (let col = c0; col <= c1; col++) lists[row * nx + col].push(p, i);
    }
  });
  const cellStart = new Int32Array(nx * nz + 1);
  for (let c = 0; c < lists.length; c++) cellStart[c + 1] = cellStart[c] + lists[c].length;
  const entries = new Int32Array(cellStart[lists.length]);
  for (let c = 0; c < lists.length; c++) entries.set(lists[c], cellStart[c]);

  return {
    sample(x: number, z: number, yHint: number, out: SurfaceSample): void {
      // The ground is always a candidate, at the terrain's height and grade there.
      if (flat) {
        out.y = 0;
        out.gx = 0;
        out.gz = 0;
      } else terrain.sample(x, z, out);
      if (!dry) {
        lakes.sample(x, z, basin);
        out.y -= basin.y;
        out.gx -= basin.gx;
        out.gz -= basin.gz;
      }
      const inPieces = x >= pMinX && x <= pMaxX && z >= pMinZ && z <= pMaxZ;
      if (inPieces) {
        // A dig below grade: the ground candidate sinks by its depth, grade and all.
        for (let c = 0; c < cuts.length; c++) {
          const b = cuts[c].bounds;
          if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
          const depth = cuts[c].depthAt(x, z);
          if (!(depth > 0)) continue;
          const d = PIECE_STEP;
          out.y -= depth;
          out.gx -= (cuts[c].depthAt(x + d, z) - cuts[c].depthAt(x - d, z)) / (2 * d);
          out.gz -= (cuts[c].depthAt(x, z + d) - cuts[c].depthAt(x, z - d)) / (2 * d);
        }
      }
      let bestY = out.y;
      let bestGx = out.gx;
      let bestGz = out.gz;
      const col = Math.floor((x - minX) / CELL);
      const row = Math.floor((z - minZ) / CELL);
      if (col >= 0 && col < nx && row >= 0 && row < nz) {
        const ceiling = yHint + STEP_UP;
        const cell = row * nx + col;
        const end = cellStart[cell + 1];
        let k = cellStart[cell];
        while (k < end) {
          // One path's segments in this cell: find its nearest, as the full projection would.
          const p = entries[k];
          const path = paths[p];
          const samples = path.samples;
          const n = samples.length;
          let nearest = -1;
          let nearestD2 = Infinity;
          for (; k < end && entries[k] === p; k += 2) {
            const i = entries[k + 1];
            const a = samples[i];
            const b = samples[(i + 1) % n];
            const dx = b.x - a.x;
            const dz = b.z - a.z;
            const len2 = dx * dx + dz * dz;
            let t = len2 > 0 ? ((x - a.x) * dx + (z - a.z) * dz) / len2 : 0;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const px = a.x + dx * t - x;
            const pz = a.z + dz * t - z;
            const d2 = px * px + pz * pz;
            if (d2 < nearestD2) {
              nearestD2 = d2;
              nearest = i;
            }
          }
          // A window of none: exactly that segment, projected the one way the rest of the sim does.
          projectOntoPath(path, x, z, proj, nearest, 0);
          if (proj.dist > proj.halfWidth + pad) continue;
          const y = proj.y;
          if (y > ceiling || y <= bestY) continue;
          bestY = y;
          // Grade of this segment along its tangent, as a gradient on the XZ plane.
          const a = samples[proj.index];
          const b = samples[(proj.index + 1) % n];
          const run = Math.hypot(b.x - a.x, b.z - a.z);
          const grade = run > 1e-6 && proj.index < segmentCount(path) ? (b.y - a.y) / run : 0;
          bestGx = proj.tx * grade;
          bestGz = proj.tz * grade;
        }
      }
      if (inPieces) {
        // The set-pieces' slabs, by the ribbons' rule.
        const ceiling = yHint + STEP_UP;
        for (let k = 0; k < slabs.length; k++) {
          const sl = slabs[k];
          const b = sl.bounds;
          if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
          const y = slabY(sl, x, z);
          if (y === null || y > ceiling || y <= bestY) continue;
          bestY = y;
          // Central differences, one-sided where the slab ends within a step.
          const d = PIECE_STEP;
          const xp = slabY(sl, x + d, z);
          const xm = slabY(sl, x - d, z);
          const zp = slabY(sl, x, z + d);
          const zm = slabY(sl, x, z - d);
          bestGx = xp !== null && xm !== null ? (xp - xm) / (2 * d) : xp !== null ? (xp - y) / d : xm !== null ? (y - xm) / d : 0;
          bestGz = zp !== null && zm !== null ? (zp - zm) / (2 * d) : zp !== null ? (zp - y) / d : zm !== null ? (y - zm) / d : 0;
        }
      }
      out.y = bestY;
      out.gx = bestGx;
      out.gz = bestGz;
    },
  };
}
