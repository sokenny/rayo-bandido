import type { BlockRect, CityVolume, MegastructureDef, PassageDef, Rect, RibbonDef } from './cityPlan';

/*
 * No value imports here, and none in `stackMassing.ts`: `stackSpec.ts` reaches this module,
 * and `scripts/stack-preview.mjs` and `scripts/city-shots.mjs` load that spec under plain
 * Node, whose TypeScript loader resolves neither extensionless imports nor a bundler's
 * aliases. Types only, and the one chain of value imports spelt with its `.ts` extension.
 */

/** Metres. Roads remain authored in citySpec; this district is cut around those roads. */
export const MEGACITY = {
  districtCount: 6,
  cameraClearance: 9,
  roadMargin: 3,
  heights: [104, 128, 88, 112, 76, 96],
  detailDensity: 0.55,
} as const;

const sites: Rect[] = [
  { minX: -175, maxX: -88, minZ: -246, maxZ: -174 },
  { minX: -49, maxX: 8, minZ: -242, maxZ: -173 },
  { minX: 38, maxX: 98, minZ: -232, maxZ: -176 },
  { minX: -180, maxX: -90, minZ: -142, maxZ: -77 },
  { minX: -51, maxX: 3, minZ: -140, maxZ: -80 },
  { minX: 34, maxX: 95, minZ: -142, maxZ: -82 },
];

/** Subtract a box into six disjoint pieces. No collider ever spans a reserved opening. */
export function subtract(v: CityVolume, cut: CityVolume): CityVolume[] {
  const x0 = Math.max(v.minX, cut.minX), x1 = Math.min(v.maxX, cut.maxX);
  const z0 = Math.max(v.minZ, cut.minZ), z1 = Math.min(v.maxZ, cut.maxZ);
  const y0 = Math.max(v.y0, cut.y0), y1 = Math.min(v.y1, cut.y1);
  if (x0 >= x1 || z0 >= z1 || y0 >= y1) return [v];
  return [
    { ...v, maxX: x0 }, { ...v, minX: x1 },
    { ...v, minX: x0, maxX: x1, maxZ: z0 },
    { ...v, minX: x0, maxX: x1, minZ: z1 },
    { ...v, minX: x0, maxX: x1, minZ: z0, maxZ: z1, y1: y0 },
    { ...v, minX: x0, maxX: x1, minZ: z0, maxZ: z1, y0: y1 },
  ].filter((p) => p.maxX - p.minX > 0.01 && p.maxZ - p.minZ > 0.01 && p.y1 - p.y0 > 0.01);
}

/* ------------------------------------------------------------------ the carve */

/**
 * How a road reserves its way through a building: `roadMargin` metres beyond the asphalt
 * edge on each side, from 2 m under the surface to `cameraClearance` above it (the chase
 * camera rides 2-3 m over the car; the rest is headroom that reads as a passage, not a duct).
 *
 * `clipDiagonals`: a straight road that is not axis-aligned is cut as ONE box per run — the
 * bounding box of its corridor where it crosses `within` — instead of a box per 8 m sample.
 * Per-sample boxes along a diagonal leave a sawtooth wall beside the lane (2 m teeth at 15°);
 * one clipped box leaves a straight wall the road drifts toward and away from, which is what
 * a building with a road through it looks like. Bandido Bay's district leaves this off, so
 * its six blocks come out exactly as they did.
 */
export interface CarveOptions {
  roadMargin: number;
  cameraClearance: number;
  clipDiagonals?: boolean;
  /**
   * Drop carved pieces thinner than this (m) in plan. Two roads 17 m apart with 11-13 m of
   * reservation each leave a blade of building a few decimetres thick between them, which
   * costs as many triangles as a wall and reads as a glitch. Missing: keep everything.
   */
  minSliver?: number;
}

/** Conservative reservation boxes for every ribbon segment: deck, rail, shoulder and camera. */
export function roadCuts(ribbons: readonly RibbonDef[], opts: CarveOptions, within?: Rect): CityVolume[] {
  const cuts: CityVolume[] = [];
  const push = (cut: CityVolume): void => {
    // Coalesce collinear flat reservations so a facade is not subdivided at every road sample.
    const last = cuts[cuts.length - 1];
    if (last && last.y0 === cut.y0 && last.y1 === cut.y1 &&
      ((last.minX === cut.minX && last.maxX === cut.maxX && last.maxZ >= cut.minZ && last.minZ <= cut.maxZ) ||
       (last.minZ === cut.minZ && last.maxZ === cut.maxZ && last.maxX >= cut.minX && last.minX <= cut.maxX))) {
      last.minX = Math.min(last.minX, cut.minX); last.maxX = Math.max(last.maxX, cut.maxX);
      last.minZ = Math.min(last.minZ, cut.minZ); last.maxZ = Math.max(last.maxZ, cut.maxZ);
    } else cuts.push(cut);
  };
  for (const rb of ribbons) {
    const s = rb.path.samples;
    const segs = s.length - (rb.path.closed ? 0 : 1);
    let i = 0;
    while (i < segs) {
      const a = s[i], b = s[(i + 1) % s.length];
      const diagonal = Math.abs(a.tx) > 1e-3 && Math.abs(a.tz) > 1e-3;
      if (opts.clipDiagonals && within && diagonal && a.curvature === 0) {
        // The whole straight run this segment starts, up to where the tangent turns or the
        // road has climbed more than a car's height: one box for the lot.
        let j = i;
        let yLo = Math.min(a.y, b.y), yHi = Math.max(a.y, b.y);
        let reach = Math.max(a.halfWidth, b.halfWidth);
        while (j + 1 < segs) {
          const n0 = s[j + 1], n1 = s[(j + 2) % s.length];
          if (n0.curvature !== 0 || Math.abs(n0.tx - a.tx) > 1e-4 || Math.abs(n0.tz - a.tz) > 1e-4) break;
          if (Math.max(yHi, n1.y) - Math.min(yLo, n1.y) > 3) break;
          j++;
          yLo = Math.min(yLo, n1.y); yHi = Math.max(yHi, n1.y);
          reach = Math.max(reach, n0.halfWidth, n1.halfWidth);
        }
        const end = s[(j + 1) % s.length];
        reach += opts.roadMargin;
        const box = corridorBox(a.x, a.z, end.x, end.z, a.tx, a.tz, reach, within);
        if (box) push({ ...box, y0: Math.max(0, yLo - 2), y1: yHi + opts.cameraClearance, role: 'body' });
        i = j + 1;
        continue;
      }
      const reach = Math.max(a.halfWidth, b.halfWidth) + opts.roadMargin;
      const cut: CityVolume = {
        minX: Math.min(a.x, b.x) - reach, maxX: Math.max(a.x, b.x) + reach,
        minZ: Math.min(a.z, b.z) - reach, maxZ: Math.max(a.z, b.z) + reach,
        y0: Math.max(0, Math.min(a.y, b.y) - 2), y1: Math.max(a.y, b.y) + opts.cameraClearance,
        role: 'body',
      };
      if (!within || (cut.maxX > within.minX && cut.minX < within.maxX && cut.maxZ > within.minZ && cut.minZ < within.maxZ)) push(cut);
      i++;
    }
  }
  return cuts;
}

/**
 * The bounding box of a straight corridor (from a to b, `reach` either side and past each
 * end) clipped to `within`, or null when they do not meet. Sutherland-Hodgman against the
 * rect's four edges.
 */
function corridorBox(ax: number, az: number, bx: number, bz: number, tx: number, tz: number, reach: number, within: Rect): Rect | null {
  const nx = -tz, nz = tx;
  const x0 = ax - tx * reach, z0 = az - tz * reach;
  const x1 = bx + tx * reach, z1 = bz + tz * reach;
  let poly: Array<[number, number]> = [
    [x0 - nx * reach, z0 - nz * reach],
    [x1 - nx * reach, z1 - nz * reach],
    [x1 + nx * reach, z1 + nz * reach],
    [x0 + nx * reach, z0 + nz * reach],
  ];
  const clip = (inside: (p: [number, number]) => boolean, cross: (p: [number, number], q: [number, number]) => [number, number]): void => {
    const out: Array<[number, number]> = [];
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const pi = inside(p), qi = inside(q);
      if (pi) out.push(p);
      if (pi !== qi) out.push(cross(p, q));
    }
    poly = out;
  };
  const at = (p: [number, number], q: [number, number], t: number): [number, number] => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  clip((p) => p[0] >= within.minX, (p, q) => at(p, q, (within.minX - p[0]) / (q[0] - p[0])));
  if (poly.length === 0) return null;
  clip((p) => p[0] <= within.maxX, (p, q) => at(p, q, (within.maxX - p[0]) / (q[0] - p[0])));
  if (poly.length === 0) return null;
  clip((p) => p[1] >= within.minZ, (p, q) => at(p, q, (within.minZ - p[1]) / (q[1] - p[1])));
  if (poly.length === 0) return null;
  clip((p) => p[1] <= within.maxZ, (p, q) => at(p, q, (within.maxZ - p[1]) / (q[1] - p[1])));
  if (poly.length < 3) return null;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of poly) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  if (maxX - minX < 0.5 || maxZ - minZ < 0.5) return null;
  // A hair wider than the band: a corner left exactly on its edge is inside it by the width
  // of a float, and the tests measure from the samples, not the line.
  const eps = 0.2;
  return { minX: Math.max(within.minX, minX - eps), maxX: Math.min(within.maxX, maxX + eps), minZ: Math.max(within.minZ, minZ - eps), maxZ: Math.min(within.maxZ, maxZ + eps) };
}

/** Cut every reservation out of the volumes, then glue matching faces back into whole walls. */
export function carveVolumes(volumes: CityVolume[], cuts: readonly CityVolume[], minSliver = 0): CityVolume[] {
  for (const cut of cuts) volumes = volumes.flatMap((v) => subtract(v, cut));
  if (minSliver > 0) volumes = volumes.filter((v) => Math.min(v.maxX - v.minX, v.maxZ - v.minZ) >= minSliver);
  // Restore large wall faces after carving: adjoining boxes with matching cross-sections
  // are one occupied mass, not hundreds of independently decorated sample-sized strips.
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let a = 0; a < volumes.length; a++) for (let b = a + 1; b < volumes.length; b++) {
      const p = volumes[a], q = volumes[b];
      if (p.role !== q.role) continue;
      for (const [lo, hi, u, v, j, k] of [
        ['minX', 'maxX', 'minZ', 'maxZ', 'y0', 'y1'],
        ['minZ', 'maxZ', 'minX', 'maxX', 'y0', 'y1'],
        ['y0', 'y1', 'minX', 'maxX', 'minZ', 'maxZ'],
      ] as const) {
        if (p[u] !== q[u] || p[v] !== q[v] || p[j] !== q[j] || p[k] !== q[k]) continue;
        if (Math.abs(p[hi] - q[lo]) > 0.001 && Math.abs(q[hi] - p[lo]) > 0.001) continue;
        p[lo] = Math.min(p[lo], q[lo]); p[hi] = Math.max(p[hi], q[hi]);
        volumes.splice(b, 1); merged = true; break outer;
      }
    }
  }
  return volumes;
}

/* ------------------------------------------------------------------ passages */

/**
 * The stretches of every ribbon that run under a carved building's ceiling: a run of samples
 * inside the footprint with a volume directly over the centreline within `maxCeiling` of the
 * road. `wallReach` is how far outside the asphalt edge a wall must stand to count as one.
 * Each passage carries the tag of the ribbon it is on.
 */
export function findPassages(
  volumes: readonly CityVolume[],
  footprint: Rect,
  ribbons: readonly RibbonDef[],
  maxCeiling: number,
  wallReach: number,
  margin: number,
): PassageDef[] {
  const out: PassageDef[] = [];
  /** Height of the lowest ceiling over (x, z) above the road at y, or null. */
  const ceilingAt = (x: number, z: number, y: number): number | null => {
    let best: number | null = null;
    for (const v of volumes) {
      if (x < v.minX || x > v.maxX || z < v.minZ || z > v.maxZ) continue;
      if (v.y0 < y + 1 || v.y0 > y + maxCeiling) continue;
      if (best === null || v.y0 - y < best) best = v.y0 - y;
    }
    return best;
  };
  const solidAt = (x: number, z: number, y: number): boolean => {
    for (const v of volumes) if (x >= v.minX && x <= v.maxX && z >= v.minZ && z <= v.maxZ && y >= v.y0 && y <= v.y1) return true;
    return false;
  };
  /**
   * A wall beside the lane: anything solid between bonnet height and the ceiling, from the
   * margin out to `wallReach` past the asphalt edge. A diagonal road through a straight-walled
   * building drifts toward and away from its walls, so the probe walks outward.
   */
  const wallAt = (p: { x: number; z: number; y: number; tx: number; tz: number; halfWidth: number }, side: number): boolean => {
    for (let out = 1; out <= wallReach; out += 1.5) {
      const reach = p.halfWidth + out;
      const x = p.x - p.tz * reach * side;
      const z = p.z + p.tx * reach * side;
      if (solidAt(x, z, p.y + 2.5) || solidAt(x, z, p.y + 5.5)) return true;
    }
    return false;
  };
  for (const rb of ribbons) {
    if (rb.tag === undefined) continue;
    const s = rb.path.samples;
    let run: { s0: number; s1: number; ceiling: number; left: number; right: number; n: number } | null = null;
    const flush = (): void => {
      // Shorter than two samples is an overhang at the building's edge, not a passage.
      if (run && run.s1 - run.s0 >= 16) {
        out.push({ tag: rb.tag!, s0: run.s0, s1: run.s1, clearance: run.ceiling, left: run.left > run.n / 2, right: run.right > run.n / 2, margin });
      }
      run = null;
    };
    for (let i = 0; i < s.length; i++) {
      const p = s[i];
      const inside = p.x >= footprint.minX && p.x <= footprint.maxX && p.z >= footprint.minZ && p.z <= footprint.maxZ;
      const ceiling = inside ? ceilingAt(p.x, p.z, p.y) : null;
      if (ceiling === null) {
        flush();
        continue;
      }
      const left = wallAt(p, -1) ? 1 : 0;
      const right = wallAt(p, 1) ? 1 : 0;
      // The run reaches half a sample past its first and last sample inside: the samples are
      // 8 m apart on a straight, and a passage measured sample to sample would be short by
      // up to that at each end.
      const before = i > 0 ? p.s - s[i - 1].s : 0;
      const after = i + 1 < s.length ? s[i + 1].s - p.s : 0;
      if (!run) run = { s0: p.s - before / 2, s1: p.s, ceiling, left: 0, right: 0, n: 0 };
      run.s1 = p.s + after / 2;
      run.ceiling = Math.min(run.ceiling, ceiling);
      run.left += left;
      run.right += right;
      run.n++;
    }
    flush();
  }
  return out;
}

/* ------------------------------------------------------------------ Bandido Bay's district */

export function planMegastructures(ribbons: readonly RibbonDef[]): MegastructureDef[] {
  const cuts = roadCuts(ribbons, MEGACITY);
  return sites.slice(0, MEGACITY.districtCount).map((footprint, i) => {
    const h = MEGACITY.heights[i];
    const w = footprint.maxX - footprint.minX;
    // Broad occupied base, deep connecting wing and offset upper tower. Quieter service
    // blocks alternate with twin upper sections; all use the same small volume vocabulary.
    const volumes: CityVolume[] = [
      { ...footprint, y0: 0, y1: 38, role: 'podium' },
      { ...footprint, minZ: footprint.minZ + 4, maxZ: footprint.maxZ - 5, y0: 38, y1: 53, role: 'wing' },
      { ...footprint, minX: footprint.minX + 5, maxX: footprint.minX + w * 0.58,
        minZ: footprint.minZ + 9, maxZ: footprint.maxZ - 10, y0: 53, y1: h, role: 'body' },
      { ...footprint, minX: footprint.minX + w * 0.67, maxX: footprint.maxX - 3,
        minZ: footprint.minZ + 5, maxZ: footprint.maxZ - 15, y0: 53, y1: h - 18, role: 'body' },
    ];
    if (i % 3 === 1) {
      // A single stepped slab instead of paired towers.
      volumes.pop();
      volumes[2].maxX = footprint.maxX - 5;
      volumes[2].maxZ = footprint.maxZ - 18;
    } else if (i % 3 === 2) {
      // Industrial shoulder with a tall shaft and an occupied cantilever above it.
      volumes[3].y1 = 64;
      volumes.push({ ...footprint, minX: footprint.minX + 3, maxX: footprint.maxX - 3,
        minZ: footprint.minZ + 8, maxZ: footprint.maxZ - 12, y0: h - 9, y1: h, role: 'wing' });
    }
    return { tag: `mega-${i}`, footprint, volumes: carveVolumes(volumes, cuts) };
  });
}

/** Reserve whole plots before the legacy infill generator can dress them. */
export function reserveMegastructurePlots(blocks: BlockRect[], buildings: MegastructureDef[]): BlockRect[] {
  return blocks.flatMap((b) => {
    let parts: CityVolume[] = [{ ...b, y0: 0, y1: 1, role: 'body' }];
    for (const m of buildings) parts = parts.flatMap((v) => subtract(v, { ...m.footprint, y0: 0, y1: 1, role: 'body' }));
    return parts.filter((p) => p.maxX - p.minX >= 6 && p.maxZ - p.minZ >= 6).map((p, i) => ({
      ...b, minX: p.minX, maxX: p.maxX, minZ: p.minZ, maxZ: p.maxZ, tag: `${b.tag}-${i}`,
    }));
  });
}
