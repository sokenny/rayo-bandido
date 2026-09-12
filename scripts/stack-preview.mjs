/**
 * City v2 ("The Stack") road-network preview — Phase 0 of `docs/CITY_V2_BRIEF.md`.
 *
 * The ribbons come from `src/world/stackSpec.ts` (they lived here in Phase 0, and were lifted
 * into the spec in Phase 1). Builds every ribbon with the real `track.ts`,
 * runs the same geometric checks `tests/cityWorld.test.ts` will run against the new spec
 * (grades, drive-under clearance at every crossing, the merge rule for ramps, reachability
 * between levels), prints the numbers the plan quotes, and writes a plan view to
 * `docs/city-v2-plan-ribbons.svg` (and a PNG beside it when Chrome is available).
 *
 * Usage: node scripts/stack-preview.mjs [--no-png]
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { buildTrackPath, createProjection, maxGrade, projectOntoPath, pointAtStation, segmentCount } from '../src/world/track.ts';

/* ------------------------------------------------------------------ the spec */

import {
  STACK_BOUNDS,
  STACK_ELEVATED,
  STACK_L1_Y as L1_Y,
  STACK_L2_Y as L2_Y,
  STACK_L3_Y as L3_Y,
  STACK_ROADS,
  STACK_WALL_BAND as WALL_BAND,
} from '../src/world/stackSpec.ts';

const EDGE = WALL_BAND + 2.5;
const XMIN = STACK_BOUNDS.minX + EDGE, XMAX = STACK_BOUNDS.maxX - EDGE;
const ZMIN = STACK_BOUNDS.minZ + EDGE, ZMAX = STACK_BOUNDS.maxZ - EDGE;

/** Every ribbon with the level it belongs to: streets 0, the loops and ramps as the spec says. */
export const ALL = [
  ...STACK_ROADS.map((r) => ({ tag: r.tag, level: 0, kind: r.kind, spec: r.spec })),
  ...STACK_ELEVATED.map((r) => ({ tag: r.tag, level: r.level, kind: 'track', spec: r.spec })),
];

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
