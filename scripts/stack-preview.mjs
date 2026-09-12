/**
 * City v2 ("The Stack") road-network preview — Phase 0 of `docs/CITY_V2_BRIEF.md`.
 *
 * The draft ribbons for the four road levels live HERE, in this script, until Phase 1 lifts
 * them verbatim into `src/world/stackSpec.ts`. Builds every ribbon with the real `track.ts`,
 * runs the same geometric checks `tests/cityWorld.test.ts` will run against the new spec
 * (grades, drive-under clearance at every crossing, the merge rule for ramps, reachability
 * between levels), prints the numbers the plan quotes, and writes a plan view to
 * `docs/city-v2-plan-ribbons.svg` (and a PNG beside it when Chrome is available).
 *
 * Usage: node scripts/stack-preview.mjs [--no-png]
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { buildTrackPath, createProjection, maxGrade, projectOntoPath, pointAtStation, segmentCount } from '../src/world/track.ts';

/* ------------------------------------------------------------------ the draft spec */

export const STACK_BOUNDS = { minX: -300, maxX: 300, minZ: -300, maxZ: 300 };
export const WALL_BAND = 12;
export const L1_Y = 12;
export const L2_Y = 24;
export const L3_Y = 36;
const EDGE = WALL_BAND + 2.5;
const XMIN = STACK_BOUNDS.minX + EDGE, XMAX = STACK_BOUNDS.maxX - EDGE;
const ZMIN = STACK_BOUNDS.minZ + EDGE, ZMAX = STACK_BOUNDS.maxZ - EDGE;

/** Districts (`zoneOf`): the core is corporate, the old-town pocket is jdm, the rest urban. */
export function zoneOf(x, z) {
  if (x > 150 && z > 130) return 'jdm';
  if (Math.abs(x) < 175 && z > -150 && z < 200) return 'corporate';
  return 'urban';
}
const n = (x, z, r, width, y, tag) => ({ x, z, r, width, zone: zoneOf(x, z), ...(y !== undefined ? { y } : {}), ...(tag ? { tag } : {}) });
const road = (tag, level, width, nodes, kind = 'track', closed = false) => ({ tag, level, kind, spec: { closed, nodes: nodes.map((nd) => ({ ...nd, width })) } });

/*
 * L0 — streets. Not a grid: two avenues, one long sweeper, two edge streets that double as
 * the interchange corridors' ground level, three cross streets, curved connectors, and
 * narrow one-way cuts. Spacing 70-140 m. Nothing crosses the two interchange corridors
 * (x -252..-180 and 178..250) except av-gran-via and st-south, which the ramps clear.
 */
export const L0 = [
  road('av-central', 0, 22, [n(-60, ZMIN, 0, 22), n(-60, ZMAX, 0, 22)]),
  road('av-gran-via', 0, 20, [n(XMIN, -60, 0, 20), n(XMAX, -60, 0, 20)]),
  // The sweeper: the southern boulevard, one long curve north-east, then straight up the map.
  road('av-sweeper', 0, 18, [n(XMIN, 252, 0, 18), n(20, 252, 170, 18), n(115, 130, 170, 18), n(115, ZMIN, 0, 18)]),
  road('st-west', 0, 13, [n(-252, ZMIN, 0, 13), n(-252, ZMAX, 0, 13)]),
  road('st-east', 0, 13, [n(250, ZMIN, 0, 13), n(250, ZMAX, 0, 13)]),
  road('st-centre', 0, 13, [n(30, ZMIN, 0, 13), n(30, ZMAX, 0, 13)]),
  road('st-north', 0, 13, [n(XMIN, -200, 0, 13), n(XMAX, -200, 0, 13)]),
  road('st-mid', 0, 13, [n(-130, 40, 0, 13), n(60, 40, 0, 13)]),
  road('st-south', 0, 13, [n(XMIN, 130, 0, 13), n(XMAX, 130, 0, 13)]),
  road('st-oldtown', 0, 12, [n(160, 130, 0, 12), n(160, ZMAX, 0, 12)]),
  road('st-market', 0, 12, [n(160, 200, 0, 12), n(250, 200, 0, 12)]),
  // Curved connectors.
  road('cn-northwest', 0, 13, [n(-130, -200, 0, 13), n(-200, -235, 50, 13), n(-252, -235, 0, 13)]),
  road('cn-centre', 0, 13, [n(60, 40, 0, 13), n(60, -10, 40, 13), n(20, -60, 0, 13)]),
  road('cn-southeast', 0, 13, [n(160, 200, 0, 13), n(195, 250, 45, 13), n(250, 250, 0, 13)]),
  // Cuts: narrow one-way alleys between buildings.
  road('cut-a', 0, 7.5, [n(-130, -200, 0, 7.5), n(-130, 130, 0, 7.5)], 'alley'),
  road('cut-b', 0, 7.5, [n(-60, -130, 0, 7.5), n(30, -130, 0, 7.5)], 'alley'),
  road('cut-c', 0, 7.5, [n(-130, 100, 0, 7.5), n(-60, 100, 0, 7.5)], 'alley'),
  road('cut-d', 0, 7.5, [n(0, 130, 0, 7.5), n(0, ZMAX, 0, 7.5)], 'alley'),
  road('cut-e', 0, 7.5, [n(190, 130, 0, 7.5), n(190, ZMAX, 0, 7.5)], 'alley'),
  road('cut-g', 0, 7.5, [n(30, -10, 0, 7.5), n(115, -10, 0, 7.5)], 'alley'),
];

/* L2 — the spine: a closed highway loop through the middle, mid-block on every leg. */
export const L2 = road('spine', 2, 18, [
  n(-180, -130, 40, 18, L2_Y, 'nw'),
  n(178, -130, 40, 18, L2_Y, 'ne'),
  n(178, 110, 40, 18, L2_Y, 'se'),
  n(60, 190, 40, 18, L2_Y, 's'),
  n(-180, 150, 40, 18, L2_Y, 'w'),
], 'track', true);

/* L1 — the deck: a closed loop with a hairpin pinch through the centre; crosses the spine four times. */
export const L1 = road('deck', 1, 14, [
  n(-215, -160, 40, 14, L1_Y, 'w'),
  n(-60, -250, 50, 14, L1_Y, 'nw'),
  n(0, -20, 45, 14, L1_Y, 'pinch'),
  n(215, -180, 50, 14, L1_Y, 'ne'),
  n(215, 170, 50, 14, L1_Y, 'se'),
  n(-40, 215, 50, 14, L1_Y, 's'),
  n(-215, 150, 40, 14, L1_Y, 'sw'),
], 'track', true);

/* L3 — the ring: a small closed loop above the core, fed from the spine. */
export const L3 = road('ring', 3, 13, [
  n(-105, -85, 45, 13, L3_Y),
  n(95, -85, 45, 13, L3_Y),
  n(95, 110, 45, 13, L3_Y),
  n(-105, 110, 45, 13, L3_Y),
], 'track', true);

/*
 * Ramps. Each starts inside one road, runs beside the next one in the gap between them and
 * slides in parallel, like `RAMP_SPECS` in Bandido Bay. Every ramp is drivable both ways;
 * the direction named is the one whose merge is tangential.
 *   west corridor  x: st-west -252 | gap -232 | deck -215 | gap -198 | spine -180
 *   east corridor  x: spine 178 | gap 198 | deck 215 | gap 232 | st-east 250
 */
export const RAMPS = [
  road('w-up-01', 1, 11, [n(-249, 155, 0, 11, 0), n(-232, 115, 30, 11), n(-232, -5, 30, 11, L1_Y), n(-218, -40, 30, 11), n(-217, -75, 0, 11, L1_Y)]),
  road('w-up-12', 2, 11, [n(-214, -118, 0, 11, L1_Y), n(-198, -80, 30, 11), n(-198, 30, 30, 11, L2_Y), n(-183, 62, 30, 11), n(-182, 82, 0, 11, L2_Y)]),
  road('e-up-01', 1, 11, [n(247, -170, 0, 11, 0), n(232, -130, 30, 11), n(232, -10, 30, 11, L1_Y), n(218, 25, 30, 11), n(217, 60, 0, 11, L1_Y)]),
  road('e-up-12', 2, 11, [n(214, 110, 0, 11, L1_Y), n(198, 70, 30, 11), n(198, -40, 30, 11, L2_Y), n(183, -72, 30, 11), n(182, -95, 0, 11, L2_Y)]),
  road('ring-up', 3, 11, [n(-135, -131, 0, 11, L2_Y), n(-95, -131, 30, 11, L2_Y), n(-20, -105, 40, 11), n(0, -86, 30, 11, L3_Y), n(50, -86, 0, 11, L3_Y)]),
  road('ring-down', 2, 11, [n(30, 111, 0, 11, L3_Y), n(-20, 111, 30, 11, L3_Y), n(-90, 145, 40, 11), n(-125, 159, 30, 11, L2_Y), n(-160, 153, 0, 11, L2_Y)]),
  road('ring-up-e', 3, 11, [n(177, -70, 0, 11, L2_Y), n(177, -30, 30, 11, L2_Y), n(118, 22, 40, 11), n(97, 45, 20, 11, L3_Y), n(96, 66, 0, 11, L3_Y)]),
  // The south: up from the sweeper onto the deck's south leg, eastbound.
  road('s-up-01', 1, 11, [n(-150, 256, 0, 11, 0), n(-128, 244, 30, 11), n(-10, 220, 30, 11, L1_Y), n(40, 204, 30, 11, L1_Y), n(80, 194, 0, 11, L1_Y)]),
];

export const ALL = [...L0, L1, L2, L3, ...RAMPS];

/* ------------------------------------------------------------------ build + checks */

const DRIVE_UNDER = 5.5;
const MERGE = 3;
const MAX_GRADE = 0.17;
const ribbons = ALL.map((r) => {
  let path;
  try { path = buildTrackPath(r.spec); } catch (e) { throw new Error(`${r.tag}: ${e.message}`); }
  const elevated = path.samples.some((s) => s.y > 0.05);
  return { ...r, path, elevated };
});
const P = createProjection();
const problems = [];
const levelLen = [0, 0, 0, 0];
for (const rb of ribbons) levelLen[rb.level] += rb.path.length;

// Grades.
for (const rb of ribbons) {
  const g = maxGrade(rb.path);
  if (g > MAX_GRADE) problems.push(`GRADE ${rb.tag}: ${(g * 100).toFixed(1)} % > ${MAX_GRADE * 100} %`);
}
// Crossings: elevated over ground, and elevated over elevated.
const ground = ribbons.filter((r) => !r.elevated);
const elevated = ribbons.filter((r) => r.elevated);
for (const rb of elevated) {
  const p = rb.path;
  for (const s of p.samples) {
    const fromEnd = p.closed ? Infinity : Math.min(s.s, p.length - s.s);
    if (fromEnd >= 40) {
      for (const g of ground) {
        projectOntoPath(g.path, s.x, s.z, P);
        if (P.dist > P.halfWidth) continue;
        if (s.y < DRIVE_UNDER) problems.push(`LOW ${rb.tag} over ${g.tag} at (${s.x.toFixed(0)}, ${s.z.toFixed(0)}): y ${s.y.toFixed(1)}`);
      }
    }
    for (const o of elevated) {
      if (o === rb) continue;
      projectOntoPath(o.path, s.x, s.z, P);
      if (P.dist > P.halfWidth) continue;
      const dy = Math.abs(P.y - s.y);
      if (dy < MERGE) {
        const oFromEnd = o.path.closed ? Infinity : Math.min(P.s, o.path.length - P.s);
        if (Math.min(fromEnd, oFromEnd) >= 80) problems.push(`INSIDE ${rb.tag} sits inside ${o.tag} at (${s.x.toFixed(0)}, ${s.z.toFixed(0)}) away from both ends`);
      } else if (dy < DRIVE_UNDER) {
        problems.push(`CLEARANCE ${rb.tag} over ${o.tag} at (${s.x.toFixed(0)}, ${s.z.toFixed(0)}): dy ${dy.toFixed(1)}`);
      }
    }
  }
}
// Every ramp end lies inside another road at that road's height (no dead ends).
for (const rb of ribbons) {
  if (rb.path.closed) continue;
  for (const end of [rb.path.samples[0], rb.path.samples[rb.path.samples.length - 1]]) {
    let ok = false;
    for (const o of ribbons) {
      if (o === rb) continue;
      projectOntoPath(o.path, end.x, end.z, P);
      if (P.dist <= P.halfWidth && Math.abs(P.y - end.y) < 1) ok = true;
    }
    // A ground road may simply end at the perimeter wall, like Bandido Bay's streets.
    const atWall = !rb.elevated && (Math.abs(end.x - XMIN) < 1 || Math.abs(end.x - XMAX) < 1 || Math.abs(end.z - ZMIN) < 1 || Math.abs(end.z - ZMAX) < 1);
    if (!ok && !atWall) problems.push(`DEAD END ${rb.tag} at (${end.x.toFixed(0)}, ${end.z.toFixed(0)}) y ${end.y.toFixed(1)}`);
  }
}

/* Reachability: a graph of samples; edges along each ribbon and between ribbons where they
   share a point at the same level. Shortest road distance from each level to each other. */
const nodes = [];
const adj = new Map();
const link = (a, b, w) => { (adj.get(a) ?? adj.set(a, []).get(a)).push([b, w]); };
for (const rb of ribbons) {
  const base = nodes.length;
  const smp = rb.path.samples;
  for (let i = 0; i < smp.length; i++) nodes.push({ rb, i, x: smp[i].x, z: smp[i].z, y: smp[i].y, level: rb.level });
  const segs = segmentCount(rb.path);
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % smp.length;
    const w = Math.hypot(smp[j].x - smp[i].x, smp[j].z - smp[i].z);
    link(base + i, base + j, w); link(base + j, base + i, w);
  }
}
for (let a = 0; a < nodes.length; a++) {
  const na = nodes[a];
  for (const o of ribbons) {
    if (o === na.rb) continue;
    projectOntoPath(o.path, na.x, na.z, P);
    if (P.dist > P.halfWidth + 1 || Math.abs(P.y - na.y) > MERGE) continue;
    const ob = nodes.findIndex((nb) => nb.rb === o && nb.i === P.index);
    if (ob >= 0) { link(a, ob, P.dist); link(ob, a, P.dist); }
  }
}
function dijkstra(src) {
  const dist = new Float64Array(nodes.length).fill(Infinity);
  dist[src] = 0;
  const seen = new Uint8Array(nodes.length);
  for (;;) {
    let u = -1;
    for (let i = 0; i < nodes.length; i++) if (!seen[i] && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0 || dist[u] === Infinity) break;
    seen[u] = 1;
    for (const [v, w] of adj.get(u) ?? []) if (dist[u] + w < dist[v]) dist[v] = dist[u] + w;
  }
  return dist;
}
/** For each level pair, the worst-case "from any point on level A, road distance to the nearest point of level B". */
const reach = [];
const levelNodes = [0, 1, 2, 3].map((l) => nodes.map((nd, i) => [nd, i]).filter(([nd]) => nd.level === l && nd.rb.path.closed).map(([, i]) => i));
// Distances are computed from a sparse subset of level A (every 6th sample) to keep the O(n^2) Dijkstra cheap.
for (let a = 0; a < 4; a++) {
  const row = [];
  for (let b = 0; b < 4; b++) {
    if (a === b) { row.push(0); continue; }
    let worst = 0;
    const streets = nodes.map((nd, i) => [nd, i]).filter(([nd]) => nd.level === 0 && nd.rb.kind === 'track').map(([, i]) => i);
    const from = a === 0 ? streets : levelNodes[a];
    const to = b === 0 ? streets : levelNodes[b];
    for (let k = 0; k < from.length; k += 6) {
      const d = dijkstra(from[k]);
      let best = Infinity;
      for (const i of to) if (d[i] < best) best = d[i];
      if (best > worst) worst = best;
    }
    row.push(worst);
  }
  reach.push(row);
}

/* Stacked crossings: L0 street samples with L1 within 16 m and L2 within 16 m overhead. */
const stacked = [];
for (const g of ground) {
  if (g.kind === 'alley') continue;
  for (const s of g.path.samples) {
    let l1 = false, l2 = false;
    for (const e of elevated) {
      projectOntoPath(e.path, s.x, s.z, P);
      if (P.dist > P.halfWidth + 30) continue;
      if (P.y > 9 && P.y < 16) l1 = true;
      if (P.y >= 20) l2 = true;
    }
    if (l1 && l2 && !stacked.some((q) => Math.hypot(q.x - s.x, q.z - s.z) < 40)) stacked.push({ x: s.x, z: s.z, tag: g.tag });
  }
}

/* ------------------------------------------------------------------ report */
const km = (m) => `${m.toFixed(0)} m`;
console.log(`bounds ${STACK_BOUNDS.maxX - STACK_BOUNDS.minX} x ${STACK_BOUNDS.maxZ - STACK_BOUNDS.minZ} m, ${ribbons.length} ribbons, ${ribbons.reduce((a, r) => a + r.path.samples.length, 0)} samples`);
console.log(`road length per level  L0 ${km(levelLen[0])}  L1 ${km(levelLen[1])}  L2 ${km(levelLen[2])}  L3 ${km(levelLen[3])}  (ramps counted at the level they climb to)`);
for (const rb of ribbons) if (rb.elevated) console.log(`  ${rb.tag.padEnd(12)} ${km(rb.path.length).padStart(7)}  grade ${(maxGrade(rb.path) * 100).toFixed(1).padStart(5)} %${rb.path.closed ? '  loop' : ''}`);
console.log(`stacked crossings (L1 and L2 both over an L0 street): ${stacked.length}  ${stacked.map((q) => `${q.tag}@(${q.x.toFixed(0)},${q.z.toFixed(0)})`).join(' ')}`);
/* Distance from any point of a level to the nearest ramp junction on that level (where a level change starts). */
const junctions = [];
for (const rb of ribbons) if (!rb.path.closed && rb.elevated) for (const end of [0, rb.path.samples.length - 1]) junctions.push(nodes.findIndex((nd) => nd.rb === rb && nd.i === end));
const toRamp = [];
for (let a = 0; a < 4; a++) {
  const from = a === 0 ? nodes.map((nd, i) => [nd, i]).filter(([nd]) => nd.level === 0 && nd.rb.kind === 'track').map(([, i]) => i) : levelNodes[a];
  let worst = 0, worstAt = null, sum = 0, count = 0;
  for (let k = 0; k < from.length; k += 6) {
    const d = dijkstra(from[k]);
    let best = Infinity;
    for (const j of junctions) if (d[j] < best) best = d[j];
    sum += best; count++;
    if (best > worst) { worst = best; worstAt = nodes[from[k]]; }
  }
  toRamp.push({ worst, mean: sum / count, at: worstAt });
}
console.log('road distance to the nearest ramp junction, per level (m):');
for (let a = 0; a < 4; a++) console.log(`  L${a}: worst ${toRamp[a].worst.toFixed(0)} at ${toRamp[a].at.rb.tag} (${toRamp[a].at.x.toFixed(0)}, ${toRamp[a].at.z.toFixed(0)}), mean ${toRamp[a].mean.toFixed(0)}`);
console.log('worst road distance from any point of a level to the nearest point of another level, ramp included (m):');
for (let a = 0; a < 4; a++) console.log(`  from L${a}: ` + reach[a].map((d, b) => `L${b} ${d === Infinity ? 'unreachable' : d.toFixed(0)}`).join('  '));
console.log(problems.length ? `PROBLEMS (${problems.length}):\n  ` + problems.join('\n  ') : 'checks: grades, drive-under clearance, merges, dead ends — all clear');

/* ------------------------------------------------------------------ svg */
const B = STACK_BOUNDS;
const pad = 40;
const W = B.maxX - B.minX + pad * 2;
const H = B.maxZ - B.minZ + pad * 2;
const sx = (x) => x - B.minX + pad;
const sz = (z) => z - B.minZ + pad;
const LEVEL_COLOR = ['#8ea3b8', '#f2b84b', '#ff5a5a', '#5fe0ff'];
const ribbonPoly = (p, fill, opacity = 1) => {
  const left = p.samples.map((s) => `${sx(s.x + s.tz * s.halfWidth).toFixed(1)},${sz(s.z - s.tx * s.halfWidth).toFixed(1)}`);
  const right = p.samples.slice().reverse().map((s) => `${sx(s.x - s.tz * s.halfWidth).toFixed(1)},${sz(s.z + s.tx * s.halfWidth).toFixed(1)}`);
  return `<polygon points="${[...left, ...right].join(' ')}" fill="${fill}" opacity="${opacity}"/>`;
};
let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W * 1.6}" height="${H * 1.6}" style="background:#0b1219;font-family:system-ui">`;
svg += `<rect x="${pad}" y="${pad}" width="${B.maxX - B.minX}" height="${B.maxZ - B.minZ}" fill="#101a24" stroke="#3a4b5c"/>`;
svg += `<rect x="${pad + WALL_BAND}" y="${pad + WALL_BAND}" width="${B.maxX - B.minX - 2 * WALL_BAND}" height="${B.maxZ - B.minZ - 2 * WALL_BAND}" fill="none" stroke="#2a3a4a" stroke-dasharray="4 4"/>`;
for (let x = -300; x <= 300; x += 100) svg += `<line x1="${sx(x)}" y1="${pad}" x2="${sx(x)}" y2="${H - pad}" stroke="#1a2530"/><text x="${sx(x) + 2}" y="${pad - 4}" fill="#5a6b7c" font-size="9">${x}</text>`;
for (let z = -300; z <= 300; z += 100) svg += `<line x1="${pad}" y1="${sz(z)}" x2="${W - pad}" y2="${sz(z)}" stroke="#1a2530"/><text x="${pad - 28}" y="${sz(z) + 3}" fill="#5a6b7c" font-size="9">${z}</text>`;
// Districts.
svg += `<rect x="${sx(150)}" y="${sz(150)}" width="${sx(288) - sx(150)}" height="${sz(288) - sz(150)}" fill="#3a2f1a" opacity="0.5"/><text x="${sx(160)}" y="${sz(280)}" fill="#c9a86a" font-size="10">OLD TOWN</text>`;
svg += `<rect x="${sx(-170)}" y="${sz(-170)}" width="${sx(170) - sx(-170)}" height="${sz(170) - sz(-170)}" fill="none" stroke="#2f4a5c" stroke-dasharray="6 3"/><text x="${sx(-165)}" y="${sz(-160)}" fill="#6f95ad" font-size="10">CORE · towers 80-160 m</text>`;
// Levels bottom-up so the higher road draws over the lower one.
for (const level of [0, 1, 2, 3]) for (const rb of ribbons) if (rb.level === level) svg += ribbonPoly(rb.path, LEVEL_COLOR[level], rb.kind === 'alley' ? 0.45 : level === 0 ? 0.75 : 0.9);
// Enclosed stretches planned for Phase 2 (megastructure passages on the spine) and portal frames.
const ENCLOSED = [
  { tag: 'north A', from: -120, to: -70, z: -130 },
  { tag: 'north B', from: -45, to: 20, z: -130 },
  { tag: 'north C', from: 45, to: 105, z: -130 },
];
for (const e of ENCLOSED) svg += `<rect x="${sx(e.from)}" y="${sz(e.z) - 16}" width="${e.to - e.from}" height="32" fill="none" stroke="#ffffff" stroke-width="1.2" stroke-dasharray="3 2"/><text x="${sx(e.from)}" y="${sz(e.z) - 19}" fill="#ffffff" font-size="9">PASSAGE ${e.tag}</text>`;
for (const q of stacked) svg += `<circle cx="${sx(q.x)}" cy="${sz(q.z)}" r="6" fill="none" stroke="#ffffff" stroke-width="1.5"/>`;
svg += `<text x="${sx(-250)}" y="${sz(40)}" fill="#fff" font-size="10">WEST INTERCHANGE</text><text x="${sx(190)}" y="${sz(-100)}" fill="#fff" font-size="10">EAST INTERCHANGE</text>`;
// Ribbon labels.
for (const rb of ribbons) { const m = pointAtStation(rb.path, rb.path.length * 0.5, P); svg += `<text x="${sx(m.x) + 3}" y="${sz(m.z) - 3}" fill="${LEVEL_COLOR[rb.level]}" font-size="8" opacity="0.9">${rb.tag}</text>`; }
// Legend.
const legend = ['L0 street (y 0)', 'L1 deck (y 12)', 'L2 spine (y 24)', 'L3 ring (y 36)'];
legend.forEach((t, i) => { svg += `<rect x="${pad}" y="${H - pad + 8 + i * 0}" width="0" height="0"/><rect x="${pad + i * 150}" y="${H - 26}" width="14" height="8" fill="${LEVEL_COLOR[i]}"/><text x="${pad + i * 150 + 18}" y="${H - 18}" fill="#e6f0ff" font-size="10">${t}</text>`; });
svg += `<text x="${pad}" y="${H - 4}" fill="#e6f0ff" font-size="10">○ stacked crossing (L1 + L2 over a street) · dashed white = Phase 2 passages · north up, x east · ${STACK_BOUNDS.maxX - STACK_BOUNDS.minX} m square</text>`;
svg += '</svg>';
mkdirSync('docs', { recursive: true });
writeFileSync('docs/city-v2-plan-ribbons.svg', svg);
console.log('wrote docs/city-v2-plan-ribbons.svg');

if (!process.argv.includes('--no-png')) {
  const chrome = [process.env.RB_BROWSER, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome'].filter(Boolean).find((p) => existsSync(p));
  if (chrome) {
    const puppeteer = (await import('puppeteer-core')).default;
    const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', defaultViewport: { width: Math.round(W * 1.6), height: Math.round(H * 1.6), deviceScaleFactor: 1 } });
    const page = await browser.newPage();
    await page.setContent(`<body style="margin:0;background:#0b1219">${svg}</body>`);
    await page.screenshot({ path: 'docs/city-v2-plan-ribbons.png', type: 'png' });
    await browser.close();
    console.log('wrote docs/city-v2-plan-ribbons.png');
  }
}
