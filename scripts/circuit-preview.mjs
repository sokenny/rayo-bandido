/**
 * City-circuit design tool. Builds the versus circuit from `src/world/circuitSpec.ts`, checks
 * that the whole ribbon — edge to edge, at its own height — stands on a road that already
 * exists in `src/world/citySpec.ts`, prints the geometry and an estimated lap time, and writes
 * a top-down SVG to `artifacts/circuit-preview.svg`.
 *
 * Usage:  node scripts/circuit-preview.mjs   (Node 22.6+ / 24: runs the TypeScript sources directly)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { buildTrackPath, createProjection, longestStraight, maxCornerAngle, minCornerRadius, projectOntoPath } from '../src/world/track.ts';
import { CIRCUIT_BOUNDS, CIRCUIT_GATES, CIRCUIT_LAPS, CIRCUIT_SPEC } from '../src/world/circuitSpec.ts';
import { CITY_ROADS, RAMP_SPECS, SKYWAY_SPEC, VIADUCT_SPEC } from '../src/world/citySpec.ts';

/** A ribbon point counts as on the road if a city road covers it within this of its height (m). */
const LEVEL_TOLERANCE = 2.5;
/** Lateral samples across the ribbon, edge to edge. */
const ACROSS = 9;

const roads = [
  ...CITY_ROADS.map((r) => ({ tag: r.tag, path: buildTrackPath(r.spec) })),
  ...RAMP_SPECS.map((r) => ({ tag: r.tag, path: buildTrackPath(r.spec) })),
  { tag: 'viaduct', path: buildTrackPath(VIADUCT_SPEC) },
  { tag: SKYWAY_SPEC.tag, path: buildTrackPath(SKYWAY_SPEC.spec) },
];

const path = buildTrackPath(CIRCUIT_SPEC);

/** Nearest road covering (x, z) at height y, or null. */
const proj = createProjection();
function roadAt(x, z, y) {
  for (const r of roads) {
    projectOntoPath(r.path, x, z, proj);
    if (proj.dist <= proj.halfWidth && Math.abs(proj.y - y) <= LEVEL_TOLERANCE) return r.tag;
  }
  return null;
}

const offRoad = [];
for (const s of path.samples) {
  for (let k = 0; k < ACROSS; k++) {
    const lat = (k / (ACROSS - 1) - 0.5) * 2 * s.halfWidth;
    const x = s.x + -s.tz * lat;
    const z = s.z + s.tx * lat;
    if (!roadAt(x, z, s.y)) offRoad.push({ x, z, s: s.s, y: s.y, node: s.node, lat });
  }
}

/** The biggest radius each corner will take with the whole ribbon still on the road. */
function roomiest(i) {
  let best = 0;
  for (let r = 6; r <= 90; r += 2) {
    const trial = { ...CIRCUIT_SPEC, nodes: CIRCUIT_SPEC.nodes.map((nd, k) => (k === i ? { ...nd, r } : nd)) };
    let ok = true;
    try {
      for (const s of buildTrackPath(trial).samples) {
        if (s.node !== i) continue;
        for (let k = 0; k < ACROSS; k++) {
          const lat = (k / (ACROSS - 1) - 0.5) * 2 * s.halfWidth;
          if (!roadAt(s.x + -s.tz * lat, s.z + s.tx * lat, s.y)) { ok = false; break; }
        }
        if (!ok) break;
      }
    } catch { ok = false; }
    if (!ok) break;
    best = r;
  }
  return best;
}

/* ------------------------------------------------------------------ stats */

const deg = (r) => ((r * 180) / Math.PI).toFixed(0);
const corners = path.pieces.filter((p) => p.kind === 'arc').length;
console.log(`lap length       ${path.length.toFixed(0)} m  x ${CIRCUIT_LAPS} laps = ${(path.length * CIRCUIT_LAPS).toFixed(0)} m`);
console.log(`corners          ${corners}`);
console.log(`longest straight ${longestStraight(path).toFixed(0)} m`);
console.log(`min corner r     ${minCornerRadius(path).toFixed(0)} m   max corner ${deg(maxCornerAngle(path))} deg`);
let climb = 0;
for (let i = 1; i < path.samples.length; i++) climb += Math.abs(path.samples[i].y - path.samples[i - 1].y);
console.log(`height           0 -> ${Math.max(...path.samples.map((s) => s.y)).toFixed(0)} m, ${climb.toFixed(0)} m of climb and fall a lap`);

let lapTime = 0;
{
  // Same speed profile as scripts/track-preview.mjs, so the circuits compare directly.
  const a = 13;
  const vmax = 46;
  const n = path.samples.length;
  const v = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const k = Math.abs(path.samples[i].curvature);
    v[i] = k > 1e-6 ? Math.min(vmax, Math.sqrt(a / k)) : vmax;
  }
  const ds = (i) => (i === n - 1 ? path.length - path.samples[i].s : path.samples[i + 1].s - path.samples[i].s);
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      v[j] = Math.min(v[j], Math.sqrt(v[i] * v[i] + 2 * 6 * ds(i)));
    }
    for (let i = n - 1; i >= 0; i--) {
      const j = (i + 1) % n;
      v[i] = Math.min(v[i], Math.sqrt(v[j] * v[j] + 2 * 14 * ds(i)));
    }
  }
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const d = ds(i);
    lapTime += d / Math.max(5, (v[i] + v[(i + 1) % n]) / 2);
    sum += ((v[i] + v[(i + 1) % n]) / 2) * d;
  }
  console.log(`est. lap time    ${lapTime.toFixed(1)} s  (avg ${((sum / path.length) * 3.6).toFixed(0)} km/h)`);
  console.log(`est. race        ${(lapTime * CIRCUIT_LAPS).toFixed(0)} s over ${CIRCUIT_LAPS} laps`);
}

console.log('\ncorners (r used -> largest r that stays on the road):');
CIRCUIT_SPEC.nodes.forEach((nd, i) => {
  const room = roomiest(i);
  const flag = room < nd.r ? '   <-- TOO BIG' : room > nd.r + 6 ? '   (room to open up)' : '';
  console.log(`  ${String(i).padStart(2)} ${nd.tag.padEnd(15)} (${String(nd.x).padStart(4)}, ${String(nd.z).padStart(4)}) w ${String(nd.width).padStart(4)}  r ${String(nd.r).padStart(2)} -> ${String(room).padStart(2)}${flag}`);
});

console.log('\npieces:');
for (const p of path.pieces) {
  if (p.kind === 'straight') console.log(`  straight  node ${String(p.node).padStart(2)}  ${p.length.toFixed(0).padStart(4)} m`);
  else console.log(`  arc       node ${String(p.node).padStart(2)}  r ${p.r.toFixed(0).padStart(3)} m  ${deg(p.angle).padStart(4)} deg  ${p.length.toFixed(0).padStart(4)} m`);
}

console.log('');
CIRCUIT_GATES.forEach((g, i) => {
  const p = projectOntoPath(path, g.x, g.z, createProjection());
  console.log(`gate ${i} (${g.x},${g.z}) -> station ${p.s.toFixed(0).padStart(4)} of ${path.length.toFixed(0)}, ${p.dist.toFixed(1)} m off the line`);
});

console.log('');
if (offRoad.length === 0) console.log('OK  the whole ribbon stands on city roads.');
else {
  console.log(`FAIL  ${offRoad.length} of ${path.samples.length * ACROSS} ribbon points are off the road:`);
  const step = Math.max(1, Math.ceil(offRoad.length / 20));
  for (let i = 0; i < offRoad.length; i += step) {
    const o = offRoad[i];
    console.log(`      node ${String(o.node).padStart(2)} station ${o.s.toFixed(0).padStart(4)} lat ${o.lat.toFixed(1).padStart(6)} at (${o.x.toFixed(1)}, ${o.z.toFixed(1)}) y ${o.y.toFixed(1)}`);
  }
}

/* ------------------------------------------------------------------ svg */

const B = CIRCUIT_BOUNDS;
const pad = 30;
const W = B.maxX - B.minX + pad * 2;
const H = B.maxZ - B.minZ + pad * 2;
const sx = (x) => x - B.minX + pad;
const sz = (z) => z - B.minZ + pad;
const ribbon = (p, fill) => {
  const left = p.samples.map((s) => `${sx(s.x + s.tz * s.halfWidth).toFixed(1)},${sz(s.z - s.tx * s.halfWidth).toFixed(1)}`).join(' ');
  const right = p.samples.slice().reverse().map((s) => `${sx(s.x - s.tz * s.halfWidth).toFixed(1)},${sz(s.z + s.tx * s.halfWidth).toFixed(1)}`).join(' ');
  return `<polygon points="${left} ${right}" fill="${fill}" stroke="none"/>`;
};
const edge = (p, side) =>
  p.samples.concat(p.closed ? [p.samples[0]] : []).map((s) => `${sx(s.x - s.tz * s.halfWidth * side).toFixed(1)},${sz(s.z + s.tx * s.halfWidth * side).toFixed(1)}`).join(' ');

let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style="background:#0b1020;font-family:system-ui">`;
for (let x = Math.ceil(B.minX / 50) * 50; x <= B.maxX; x += 50) svg += `<line x1="${sx(x)}" y1="${pad}" x2="${sx(x)}" y2="${H - pad}" stroke="#151d29"/>`;
for (let z = Math.ceil(B.minZ / 50) * 50; z <= B.maxZ; z += 50) svg += `<line x1="${pad}" y1="${sz(z)}" x2="${W - pad}" y2="${sz(z)}" stroke="#151d29"/>`;
for (const r of roads) svg += ribbon(r.path, r.path.samples[0].y > 1 || r.tag.startsWith('ramp') || r.tag === 'viaduct' ? '#1b2a33' : '#212a36');
svg += ribbon(path, '#4a2170');
for (const side of [-1, 1]) svg += `<polyline points="${edge(path, side)}" fill="none" stroke="#3ff0e8" stroke-width="1.6"/>`;
svg += `<polyline points="${path.samples.concat([path.samples[0]]).map((s) => `${sx(s.x).toFixed(1)},${sz(s.z).toFixed(1)}`).join(' ')}" fill="none" stroke="#ffffff" stroke-width="0.7" stroke-dasharray="5 5"/>`;
for (let st = 0; st < path.length; st += 100) {
  let lo = 0;
  while (lo < path.samples.length - 1 && path.samples[lo + 1].s <= st) lo++;
  const s = path.samples[lo];
  svg += `<circle cx="${sx(s.x)}" cy="${sz(s.z)}" r="2" fill="#fff"/><text x="${sx(s.x) + 4}" y="${sz(s.z) - 4}" fill="#e6f0ff" font-size="8">${st}</text>`;
}
CIRCUIT_SPEC.nodes.forEach((nd, i) => {
  svg += `<text x="${sx(nd.x) + 5}" y="${sz(nd.z) + 11}" fill="#ff9db4" font-size="7">${i} ${nd.tag} r${nd.r}</text>`;
});
CIRCUIT_GATES.forEach((g, i) => {
  const pr = projectOntoPath(path, g.x, g.z, createProjection());
  const hx = pr.tz * (pr.halfWidth + 5);
  const hz = -pr.tx * (pr.halfWidth + 5);
  svg += `<line x1="${sx(pr.x - hx)}" y1="${sz(pr.z - hz)}" x2="${sx(pr.x + hx)}" y2="${sz(pr.z + hz)}" stroke="${i === 0 ? '#ffffff' : '#ffd166'}" stroke-width="${i === 0 ? 3 : 1.5}"/>`;
  svg += `<text x="${sx(pr.x) + 6}" y="${sz(pr.z) - 6}" fill="#ffd166" font-size="8">${i === 0 ? 'S/F' : 'CP' + i}</text>`;
});
for (const o of offRoad) svg += `<circle cx="${sx(o.x)}" cy="${sz(o.z)}" r="2" fill="#ff2d2d"/>`;
svg += `<text x="${pad}" y="${pad - 10}" fill="#e6f0ff" font-size="11">Bandido Grid · lap ${path.length.toFixed(0)} m · ${corners} corners · est ${lapTime.toFixed(0)} s/lap · off-road ${offRoad.length}  (north up, x east)</text>`;
svg += '</svg>';
mkdirSync('artifacts', { recursive: true });
writeFileSync('artifacts/circuit-preview.svg', svg);
console.log('\nwrote artifacts/circuit-preview.svg');
