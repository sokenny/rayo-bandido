/**
 * Bandido Metro plan preview (`src/world/metroSpec.ts`): builds every ribbon with the real
 * `track.ts`, runs the geometric checks `tests/metroWorld.test.ts` runs (grades, drive-under
 * clearance at every crossing, the merge rule for ramps), prints the numbers, and writes a
 * plan view to `docs/metro-plan.svg` (and a PNG beside it when Chrome is available).
 *
 * Usage: node scripts/metro-preview.mjs [--no-png]
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { buildTrackPath, createProjection, maxGrade, projectOntoPath, pointAtStation } from '../src/world/track.ts';
import { METRO_BOUNDS, METRO_QUAY_Z, METRO_SPEC, STACK_RECT, RING, MIDTOWN, SOUTHWEST, METRO_DOWNTOWN } from '../src/world/metroSpec.ts';
import { lakeFieldOf } from '../src/world/park.ts';

const DRIVE_UNDER = 5.5;
const MERGE = 3;
const MAX_GRADE = 0.17;

const ribbons = [
  ...METRO_SPEC.roads.map((r) => ({ tag: r.tag, kind: r.kind, spec: r.spec, elevated: false })),
  ...METRO_SPEC.elevated.map((r) => ({ tag: r.tag, kind: 'track', spec: r.spec, elevated: true })),
].map((r) => {
  let path;
  try { path = buildTrackPath(r.spec); } catch (e) { throw new Error(`${r.tag}: ${e.message}`); }
  return { ...r, path, elevated: path.samples.some((s) => s.y > 0.05) };
});
const P = createProjection();
const problems = [];
let groundLen = 0, elevatedLen = 0;
for (const rb of ribbons) if (rb.elevated) elevatedLen += rb.path.length; else groundLen += rb.path.length;

for (const rb of ribbons) {
  const g = maxGrade(rb.path);
  if (g > MAX_GRADE) problems.push(`GRADE ${rb.tag}: ${(g * 100).toFixed(1)} % > ${MAX_GRADE * 100} %`);
}
// Every elevated sample over every other road: a car's clearance or a merge.
const elevated = ribbons.filter((r) => r.elevated);
for (const rb of elevated) {
  for (const s of rb.path.samples) {
    if (s.y < 0.5) continue;
    for (const other of ribbons) {
      if (other === rb) continue;
      projectOntoPath(other.path, s.x, s.z, P);
      if (P.dist > P.halfWidth + s.halfWidth - 0.5) continue;
      const gap = s.y - P.y;
      if (gap > -MERGE && gap < MERGE) continue;
      if (gap > 0 && gap < DRIVE_UNDER) problems.push(`CLEARANCE ${rb.tag} over ${other.tag} at (${s.x.toFixed(0)}, ${s.z.toFixed(0)}): ${gap.toFixed(1)} m`);
    }
  }
}
// Ramps: both ends inside another road at that road's height.
for (const rb of elevated) {
  if (rb.path.closed) continue;
  for (const end of [rb.path.samples[0], rb.path.samples[rb.path.samples.length - 1]]) {
    let host = null;
    for (const other of ribbons) {
      if (other === rb) continue;
      projectOntoPath(other.path, end.x, end.z, P);
      if (P.dist <= P.halfWidth && Math.abs(P.y - end.y) < 1) { host = other; break; }
    }
    if (!host) problems.push(`DEAD END ${rb.tag} at (${end.x.toFixed(0)}, ${end.z.toFixed(0)}) y ${end.y.toFixed(1)}`);
  }
}

console.log(`bounds ${METRO_BOUNDS.maxX - METRO_BOUNDS.minX} x ${METRO_BOUNDS.maxZ - METRO_BOUNDS.minZ} m, ${ribbons.length} ribbons, ${ribbons.reduce((a, r) => a + r.path.samples.length, 0)} samples`);
console.log(`road length  ground ${(groundLen / 1000).toFixed(1)} km  elevated ${(elevatedLen / 1000).toFixed(1)} km`);
for (const rb of elevated) console.log(`  ${rb.tag.padEnd(12)} ${rb.path.length.toFixed(0).padStart(6)} m  grade ${(maxGrade(rb.path) * 100).toFixed(1).padStart(5)} %${rb.path.closed ? '  loop' : ''}`);
console.log(problems.length ? `PROBLEMS (${problems.length}):\n  ` + problems.join('\n  ') : 'checks: grades, drive-under clearance, dead ends — all clear');

/* ------------------------------------------------------------------ svg */
const B = METRO_BOUNDS;
const pad = 40;
const SCALE = 0.5;
const W = (B.maxX - B.minX) * SCALE + pad * 2;
const H = (B.maxZ - B.minZ) * SCALE + pad * 2;
const sx = (x) => (x - B.minX) * SCALE + pad;
const sz = (z) => (z - B.minZ) * SCALE + pad;
const ribbonPoly = (p, fill, opacity = 1) => {
  const left = p.samples.map((s) => `${sx(s.x + s.tz * s.halfWidth).toFixed(1)},${sz(s.z - s.tx * s.halfWidth).toFixed(1)}`);
  const right = p.samples.slice().reverse().map((s) => `${sx(s.x - s.tz * s.halfWidth).toFixed(1)},${sz(s.z + s.tx * s.halfWidth).toFixed(1)}`);
  return `<polygon points="${[...left, ...right].join(' ')}" fill="${fill}" opacity="${opacity}"/>`;
};
const rect = (r, fill, stroke, dash = '') => `<rect x="${sx(r.minX)}" y="${sz(r.minZ)}" width="${(r.maxX - r.minX) * SCALE}" height="${(r.maxZ - r.minZ) * SCALE}" fill="${fill}" stroke="${stroke}" ${dash ? `stroke-dasharray="${dash}"` : ''}/>`;
let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="background:#0b1219;font-family:system-ui">`;
svg += rect(B, '#101a24', '#3a4b5c');
svg += `<rect x="${sx(B.minX)}" y="${sz(METRO_QUAY_Z)}" width="${(B.maxX - B.minX) * SCALE}" height="${(B.maxZ - METRO_QUAY_Z) * SCALE}" fill="#0f2a3a"/>`;
for (let x = Math.ceil(B.minX / 200) * 200; x <= B.maxX; x += 200) svg += `<line x1="${sx(x)}" y1="${pad}" x2="${sx(x)}" y2="${H - pad}" stroke="#1a2530"/><text x="${sx(x) + 2}" y="${pad - 4}" fill="#5a6b7c" font-size="9">${x}</text>`;
for (let z = Math.ceil(B.minZ / 200) * 200; z <= B.maxZ; z += 200) svg += `<line x1="${pad}" y1="${sz(z)}" x2="${W - pad}" y2="${sz(z)}" stroke="#1a2530"/><text x="${pad - 30}" y="${sz(z) + 3}" fill="#5a6b7c" font-size="9">${z}</text>`;
// The parks: the land in green, the lakes in water, the islands back in green, the planetarium, the meeting places.
for (const p of METRO_SPEC.parks ?? []) {
  svg += rect(p.land, '#14261a', '#2f6e44');
  const poly = (c, fill) => `<polygon points="${c.map((q) => `${sx(q.x).toFixed(1)},${sz(q.z).toFixed(1)}`).join(' ')}" fill="${fill}"/>`;
  for (const lake of p.lakes) {
    svg += poly(lake.shore, '#0f2a3a');
    for (const isl of lake.islands) svg += poly(isl, '#14261a');
  }
  for (const path of p.paths) svg += `<polyline points="${path.points.map((q) => `${sx(q.x).toFixed(1)},${sz(q.z).toFixed(1)}`).join(' ')}" fill="none" stroke="#4a5a4a" stroke-width="1"/>`;
  for (const m of p.masses) svg += `<ellipse cx="${sx(m.x)}" cy="${sz(m.z)}" rx="${m.rx * SCALE}" ry="${m.rz * SCALE}" fill="#1d3a24" opacity="0.6"/>`;
  if (p.planetarium) svg += `<circle cx="${sx(p.planetarium.x)}" cy="${sz(p.planetarium.z)}" r="${p.planetarium.radius * SCALE}" fill="none" stroke="#5fe0ff" stroke-width="1.5"/>`;
  for (const e of p.encounters) svg += `<circle cx="${sx(e.x)}" cy="${sz(e.z)}" r="3" fill="#ff8ad0"/><text x="${sx(e.x) + 5}" y="${sz(e.z) + 3}" fill="#ff8ad0" font-size="7">${e.label}</text>`;
  for (const w of p.walls) svg += `<line x1="${sx(w.ax)}" y1="${sz(w.az)}" x2="${sx(w.bx)}" y2="${sz(w.bz)}" stroke="#9aa" stroke-width="1"/>`;
  const field = lakeFieldOf(p);
  console.log(`park ${p.tag}: ${p.masses.reduce((a, m) => a + m.count, 0)} trees planned, lake field ${(field.bounds.maxX - field.bounds.minX).toFixed(0)} x ${(field.bounds.maxZ - field.bounds.minZ).toFixed(0)} m`);
}
svg += rect(SOUTHWEST, '#1e2a3a', 'none');
svg += rect(MIDTOWN, '#1a2432', 'none');
svg += rect(STACK_RECT, '#2a2418', '#c9a86a', '6 3');
svg += rect(METRO_DOWNTOWN, 'none', '#6f95ad', '6 3');
for (const m of METRO_SPEC.meets ?? []) svg += rect(m.lot, '#1c1426', '#d06bff', '3 2');
const LEVEL_COLOR = { 0: '#8ea3b8', 1: '#f2b84b', 2: '#ff5a5a', 3: '#5fe0ff' };
const levelOf = (rb) => (!rb.elevated ? 0 : Math.max(...rb.path.samples.map((s) => s.y)) > 30 ? 3 : Math.max(...rb.path.samples.map((s) => s.y)) > 20 ? 2 : 1);
for (const level of [0, 1, 2, 3]) for (const rb of ribbons) if (levelOf(rb) === level) svg += ribbonPoly(rb.path, LEVEL_COLOR[level], rb.kind === 'alley' ? 0.45 : level === 0 ? 0.8 : 0.9);
for (const rb of ribbons) { const m = pointAtStation(rb.path, rb.path.length * 0.5, P); svg += `<text x="${sx(m.x) + 3}" y="${sz(m.z) - 3}" fill="${LEVEL_COLOR[levelOf(rb)]}" font-size="7" opacity="0.9">${rb.tag}</text>`; }
for (const l of METRO_SPEC.trafficLoops) svg += rect(l.rect, 'none', '#3fbf7f', '2 3');
for (const r of METRO_SPEC.busRouteLoops) svg += rect(r, 'none', '#ffd86b', '8 4');
for (const s of METRO_SPEC.rushSites) svg += `<circle cx="${sx(s.x)}" cy="${sz(s.z)}" r="5" fill="none" stroke="#ff5a5a" stroke-width="1.5"/><text x="${sx(s.x) + 7}" y="${sz(s.z) + 3}" fill="#ff5a5a" font-size="8">${s.label}</text>`;
for (const s of METRO_SPEC.passengerStops) svg += `<circle cx="${sx(s.x)}" cy="${sz(s.z)}" r="4" fill="none" stroke="#ffffff" stroke-width="1.2"/>`;
// The car meets: a dot per parked car in its underglow (the lots are drawn under the roads).
for (const m of METRO_SPEC.meets ?? []) {
  for (const c of m.cars) svg += `<circle cx="${sx(c.x)}" cy="${sz(c.z)}" r="1.6" fill="#${c.glow.toString(16).padStart(6, '0')}"/>`;
  svg += `<text x="${sx(m.lot.minX) + 2}" y="${sz(m.lot.minZ) - 3}" fill="#d06bff" font-size="8">${m.label}</text>`;
}
if (METRO_SPEC.buhoSite) svg += `<circle cx="${sx(METRO_SPEC.buhoSite.x)}" cy="${sz(METRO_SPEC.buhoSite.z)}" r="4" fill="#c9a86a"/>`;
svg += `<circle cx="${sx(METRO_SPEC.spawn.x)}" cy="${sz(METRO_SPEC.spawn.z)}" r="5" fill="#5fe0ff"/>`;
svg += `<text x="${sx(RING.west) + 4}" y="${sz(RING.north) - 6}" fill="#c9a86a" font-size="10">THE STACK (downtown)</text>`;
svg += `<text x="${sx(SOUTHWEST.minX) + 4}" y="${sz(SOUTHWEST.minZ) + 12}" fill="#6f95ad" font-size="10">SOUTH-WEST · screens</text>`;
svg += `<text x="${pad}" y="${H - 6}" fill="#e6f0ff" font-size="10">grey L0 · amber L1 · red L2 · cyan L3 · green dashed = traffic loops · yellow dashed = bus loops · red rings = RUSH · white rings = passengers · gold = El Búho · violet = car meet · cyan dot = spawn · north up, x east · ${B.maxX - B.minX} x ${B.maxZ - B.minZ} m</text>`;
svg += '</svg>';
mkdirSync('docs', { recursive: true });
writeFileSync('docs/metro-plan.svg', svg);
console.log('wrote docs/metro-plan.svg');

if (!process.argv.includes('--no-png')) {
  const chrome = [process.env.RB_BROWSER, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome'].filter(Boolean).find((p) => existsSync(p));
  if (chrome) {
    const puppeteer = (await import('puppeteer-core')).default;
    const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', defaultViewport: { width: Math.round(W), height: Math.round(H), deviceScaleFactor: 1 } });
    const page = await browser.newPage();
    await page.setContent(`<body style="margin:0;background:#0b1219">${svg}</body>`);
    await page.screenshot({ path: 'docs/metro-plan.png', type: 'png' });
    await browser.close();
    console.log('wrote docs/metro-plan.png');
  }
}
