/**
 * Track design preview. Builds the race circuit from `src/world/raceSpec.ts`, prints its
 * geometry (length, straights, corners, estimated lap time) and writes an SVG top-down view to
 * `artifacts/track-preview.svg`. Open it in a browser while tuning the spec.
 *
 * Usage:  node scripts/track-preview.mjs   (Node 22.6+ / 24: runs the TypeScript sources directly)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { buildTrackPath, createProjection, longestStraight, maxCornerAngle, minCornerRadius, projectOntoPath } from '../src/world/track.ts';
import { RACE_SPEC, RACE_SHORTCUTS, RACE_BOUNDS, RACE_GATES } from '../src/world/raceSpec.ts';

const path = buildTrackPath(RACE_SPEC);
const shortcuts = RACE_SHORTCUTS.map((s) => buildTrackPath(s));

/* ------------------------------------------------------------------ stats */

const deg = (r) => ((r * 180) / Math.PI).toFixed(0);
console.log(`lap length      ${path.length.toFixed(0)} m`);
console.log(`samples         ${path.samples.length}`);
console.log(`longest straight ${longestStraight(path).toFixed(0)} m`);
console.log(`min corner r    ${minCornerRadius(path).toFixed(0)} m`);
console.log(`max corner angle ${deg(maxCornerAngle(path))} deg`);
console.log('pieces:');
for (const p of path.pieces) {
  if (p.kind === 'straight') console.log(`  straight  node ${String(p.node).padStart(2)}  ${p.length.toFixed(0).padStart(4)} m`);
  else console.log(`  arc       node ${String(p.node).padStart(2)}  r ${p.r.toFixed(0).padStart(3)} m  ${deg(p.angle).padStart(4)} deg  ${p.length.toFixed(0).padStart(4)} m`);
}

// Rough lap-time estimate from a speed profile: grip-limited corner speed v = sqrt(a * r) with
// a = 13 m/s^2, then a forward/backward pass with accel 6 and braking 14 m/s^2, capped at 46 m/s.
{
  const a = 13;
  const vmax = 46;
  const n = path.samples.length;
  const target = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const k = Math.abs(path.samples[i].curvature);
    target[i] = k > 1e-6 ? Math.min(vmax, Math.sqrt(a / k)) : vmax;
  }
  const v = Float64Array.from(target);
  const ds = (i) => {
    const b = path.samples[(i + 1) % n];
    const s0 = path.samples[i].s;
    return i === n - 1 ? path.length - s0 : b.s - s0;
  };
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
  let t = 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const d = ds(i);
    t += d / Math.max(5, (v[i] + v[j]) / 2);
    sum += ((v[i] + v[j]) / 2) * d;
  }
  console.log(`est. lap time   ${t.toFixed(1)} s  (avg ${((sum / path.length) * 3.6).toFixed(0)} km/h) -> 2 laps ${(2 * t).toFixed(0)} s`);
}
const proj = createProjection();
const stationOf = (x, z) => projectOntoPath(path, x, z, proj).s.toFixed(0);
for (const [i, s] of shortcuts.entries()) {
  const a = s.samples[0];
  const b = s.samples[s.samples.length - 1];
  console.log(`shortcut ${i}: ${s.length.toFixed(0)} m, main track station ${stationOf(a.x, a.z)} -> ${stationOf(b.x, b.z)}`);
}
RACE_GATES.forEach((g, i) => console.log(`gate ${i} at (${g.x},${g.z}) = station ${stationOf(g.x, g.z)}`));

/* ------------------------------------------------------------------ svg */

const B = RACE_BOUNDS;
const pad = 30;
const W = B.maxX - B.minX + pad * 2;
const H = B.maxZ - B.minZ + pad * 2;
const sx = (x) => x - B.minX + pad;
const sz = (z) => z - B.minZ + pad;

const edge = (p, side) =>
  p.samples.map((s) => `${sx(s.x + -s.tz * s.halfWidth * side).toFixed(1)},${sz(s.z + s.tx * s.halfWidth * side).toFixed(1)}`).join(' ');
const centre = (p) => p.samples.map((s) => `${sx(s.x).toFixed(1)},${sz(s.z).toFixed(1)}`).join(' ');
const zoneColor = { corporate: '#4ff3ff', urban: '#ff3df0', jdm: '#a8ff3e' };

let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style="background:#0b1020;font-family:system-ui">`;
svg += `<rect x="${pad}" y="${pad}" width="${B.maxX - B.minX}" height="${B.maxZ - B.minZ}" fill="none" stroke="#3a4b5c" stroke-dasharray="4 4"/>`;
// Grid every 50 m.
for (let x = Math.ceil(B.minX / 50) * 50; x <= B.maxX; x += 50) svg += `<line x1="${sx(x)}" y1="${pad}" x2="${sx(x)}" y2="${H - pad}" stroke="#1c2838"/>`;
for (let z = Math.ceil(B.minZ / 50) * 50; z <= B.maxZ; z += 50) svg += `<line x1="${pad}" y1="${sz(z)}" x2="${W - pad}" y2="${sz(z)}" stroke="#1c2838"/>`;
// Ribbon: filled polygon between the two edges.
const ribbon = (p, fill) => {
  const left = edge(p, -1);
  const right = p.samples
    .slice()
    .reverse()
    .map((s) => `${sx(s.x + -s.tz * s.halfWidth).toFixed(1)},${sz(s.z + s.tx * s.halfWidth).toFixed(1)}`)
    .join(' ');
  return `<polygon points="${left} ${right}" fill="${fill}" stroke="none"/>`;
};
for (const s of shortcuts) svg += ribbon(s, '#2a3a2a');
svg += ribbon(path, '#3a4b5c');
// Zone-coloured centreline.
for (let i = 0; i < path.samples.length; i++) {
  const a = path.samples[i];
  const b = path.samples[(i + 1) % path.samples.length];
  svg += `<line x1="${sx(a.x)}" y1="${sz(a.z)}" x2="${sx(b.x)}" y2="${sz(b.z)}" stroke="${zoneColor[a.zone]}" stroke-width="1.2" opacity="0.8"/>`;
}
for (const s of shortcuts) svg += `<polyline points="${centre(s)}" fill="none" stroke="#a8ff3e" stroke-width="1" stroke-dasharray="3 3"/>`;
// Station ticks every 100 m.
for (let st = 0; st < path.length; st += 100) {
  let lo = 0;
  while (lo < path.samples.length - 1 && path.samples[lo + 1].s <= st) lo++;
  const s = path.samples[lo];
  svg += `<circle cx="${sx(s.x)}" cy="${sz(s.z)}" r="2" fill="#fff"/><text x="${sx(s.x) + 4}" y="${sz(s.z) - 4}" fill="#e6f0ff" font-size="8">${st}</text>`;
}
// Nodes.
RACE_SPEC.nodes.forEach((nd, i) => {
  svg += `<circle cx="${sx(nd.x)}" cy="${sz(nd.z)}" r="2.5" fill="none" stroke="#ff9db4"/>`;
  svg += `<text x="${sx(nd.x) + 4}" y="${sz(nd.z) + 10}" fill="#ff9db4" font-size="8">${i}${nd.tag ? ' ' + nd.tag : ''} r${nd.r}</text>`;
});
// Gates (start/finish first).
RACE_GATES.forEach((g, i) => {
  const pr = projectOntoPath(path, g.x, g.z, proj);
  const s = { x: pr.x, z: pr.z, tx: pr.tx, tz: pr.tz, halfWidth: pr.halfWidth };
  const hx = -s.tz * (s.halfWidth + 2);
  const hz = s.tx * (s.halfWidth + 2);
  svg += `<line x1="${sx(s.x - hx)}" y1="${sz(s.z - hz)}" x2="${sx(s.x + hx)}" y2="${sz(s.z + hz)}" stroke="${i === 0 ? '#ffffff' : '#ffd166'}" stroke-width="${i === 0 ? 3 : 1.5}"/>`;
  svg += `<text x="${sx(s.x + hx) + 3}" y="${sz(s.z + hz)}" fill="#ffd166" font-size="8">${i === 0 ? 'S/F' : 'CP' + i}</text>`;
});
svg += `<text x="${pad}" y="${pad - 10}" fill="#e6f0ff" font-size="11">lap ${path.length.toFixed(0)} m · longest straight ${longestStraight(path).toFixed(0)} m · min r ${minCornerRadius(path).toFixed(0)} m · max corner ${deg(maxCornerAngle(path))}°  (north is up, x east)</text>`;
svg += '</svg>';

mkdirSync('artifacts', { recursive: true });
writeFileSync('artifacts/track-preview.svg', svg);
console.log('wrote artifacts/track-preview.svg');
