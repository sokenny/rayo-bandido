import type { BlockRect, CityVolume, MegastructureDef, Rect, RibbonDef } from './cityPlan';

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
function subtract(v: CityVolume, cut: CityVolume): CityVolume[] {
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

export function planMegastructures(ribbons: readonly RibbonDef[]): MegastructureDef[] {
  // Conservative segment bounds include the full deck, rail, shoulder and chase camera.
  // Coalesce collinear flat reservations to avoid subdividing facades at every road sample.
  const cuts: CityVolume[] = [];
  for (const rb of ribbons) {
    const s = rb.path.samples;
    for (let i = 0; i < s.length - (rb.path.closed ? 0 : 1); i++) {
      const a = s[i], b = s[(i + 1) % s.length];
      const reach = Math.max(a.halfWidth, b.halfWidth) + MEGACITY.roadMargin;
      const cut: CityVolume = {
        minX: Math.min(a.x, b.x) - reach, maxX: Math.max(a.x, b.x) + reach,
        minZ: Math.min(a.z, b.z) - reach, maxZ: Math.max(a.z, b.z) + reach,
        y0: Math.max(0, Math.min(a.y, b.y) - 2), y1: Math.max(a.y, b.y) + MEGACITY.cameraClearance,
        role: 'body',
      };
      const last = cuts[cuts.length - 1];
      if (last && last.y0 === cut.y0 && last.y1 === cut.y1 &&
        ((last.minX === cut.minX && last.maxX === cut.maxX && last.maxZ >= cut.minZ && last.minZ <= cut.maxZ) ||
         (last.minZ === cut.minZ && last.maxZ === cut.maxZ && last.maxX >= cut.minX && last.minX <= cut.maxX))) {
        last.minX = Math.min(last.minX, cut.minX); last.maxX = Math.max(last.maxX, cut.maxX);
        last.minZ = Math.min(last.minZ, cut.minZ); last.maxZ = Math.max(last.maxZ, cut.maxZ);
      } else cuts.push(cut);
    }
  }
  return sites.slice(0, MEGACITY.districtCount).map((footprint, i) => {
    const h = MEGACITY.heights[i];
    const w = footprint.maxX - footprint.minX;
    // Broad occupied base, deep connecting wing and offset upper tower. Quieter service
    // blocks alternate with twin upper sections; all use the same small volume vocabulary.
    let volumes: CityVolume[] = [
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
    for (const cut of cuts) volumes = volumes.flatMap((v) => subtract(v, cut));
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
    return { tag: `mega-${i}`, footprint, volumes };
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
