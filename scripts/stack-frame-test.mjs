/**
 * The Stack's frame-test page: the six vantage points of `docs/CITY_V2_PLAN.md` §11 beside
 * their reference image, before and after an art pass, with 1:1 crops and MEASURED pixels.
 *
 * Usage: node scripts/stack-frame-test.mjs --before artifacts/stack-phase2/phase2 --after artifacts/stack-phase3/phase3
 *          [--out artifacts/stack-phase3/frame-test.html] [--title "Phase 3"]
 *
 * `--before` / `--after` name a `city-shots.mjs --mode stack` run: `<dir>/<tag>.json` and its
 * `<tag>-<view>.png` files. The page and its numbers are written next to the `after` run.
 *
 * Numbers, not impressions (`docs/CITY_V2_BRIEF.md`, rule 2): for every view and both runs,
 * the mean RGB and luminance of a few named rectangles of the 1440x900 frame are read out of
 * the PNG at 1:1 — the ceiling band, the two walls, the far end of the road, the asphalt
 * either side of the car — so "brighter" and "warmer" are claims with a number on them.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import puppeteer from 'puppeteer-core';

const args = process.argv.slice(2);
const getArg = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const before = getArg('--before', 'artifacts/stack-phase2/phase2');
const after = getArg('--after', 'artifacts/stack-phase3/phase3');
const title = getArg('--title', 'Phase 3');
const out = getArg('--out', join(dirname(after), 'frame-test.html'));

/** The six vantages, the reference each is judged against, and what the brief asks of it. */
const VANTAGES = [
  { name: 'spine-passage-north', ref: 'city-v2-highway.webp', n: 1, need: 'sky < 15 %, structure within 40 m' },
  { name: 'spine-passage-south', ref: 'city-v2-highway.webp', n: 2, need: 'sky < 15 %, structure within 40 m' },
  { name: 'ramp-w-up-12', ref: 'city-v2-highway.webp', n: 5, need: 'far end fogged' },
  { name: 'gran-via-west', ref: 'city-v2-street.webp', n: 3, need: 'sky < 15 %, structure within 40 m' },
  { name: 'st-centre-south', ref: 'city-v2-street.webp', n: 4, need: 'sky < 15 %, structure within 40 m' },
  { name: 'av-central-ring', ref: 'city-v2-street.webp', n: 6, need: 'far end fogged' },
];

/**
 * Rectangles of the 1440x900 frame that are read at 1:1. The debug overlay occupies the top
 * left (x < 330, y < 335) and the car the bottom centre (x 500-940, y 540-900); neither is
 * sampled. `ceiling` is the band over the road ahead, `wallL` / `wallR` the walls at the
 * driver's shoulder, `far` the road's vanishing point, `roadL` / `roadR` the asphalt either
 * side of the car where the lamp pools land.
 */
const PATCHES = {
  ceiling: [420, 40, 1020, 150],
  wallL: [40, 340, 300, 480],
  wallR: [1150, 340, 1400, 480],
  far: [640, 400, 800, 480],
  roadL: [140, 600, 460, 780],
  roadR: [980, 600, 1300, 780],
};

/** The three 1:1 crops Phase 2 showed: ceiling and right wall, the far end, the left kerb. */
const CROPS = [
  { left: 900, top: 0, label: 'ceiling and right wall' },
  { left: 500, top: 260, label: 'the far end of the road' },
  { left: 0, top: 330, label: 'the left kerb' },
];

const candidates = [
  process.env.RB_BROWSER,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
].filter(Boolean);
const executablePath = candidates.find((p) => existsSync(p));
if (!executablePath) {
  console.error('No Chrome found. Set RB_BROWSER.');
  process.exit(1);
}

const load = (run) => {
  const json = JSON.parse(readFileSync(`${run}.json`, 'utf8'));
  const dir = dirname(run);
  const tag = basename(run);
  const views = new Map();
  for (const v of json.views) views.set(v.name, { ...v, png: join(dir, `${tag}-${v.name}.png`) });
  return { json, dir, tag, views };
};
const B = load(before);
const A = load(after);

const browser = await puppeteer.launch({ executablePath, headless: 'new' });
const page = await browser.newPage();
await page.setContent('<canvas id="c"></canvas>');

/** Mean RGB and luminance of each patch of one PNG, read at 1:1. */
async function measure(png) {
  const data = `data:image/png;base64,${readFileSync(png).toString('base64')}`;
  return page.evaluate(
    async (src, patches) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const cv = document.getElementById('c');
      cv.width = img.naturalWidth;
      cv.height = img.naturalHeight;
      const ctx = cv.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const out = {};
      for (const [name, [x0, y0, x1, y1]] of Object.entries(patches)) {
        const d = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
        let r = 0, g = 0, b = 0;
        const n = d.length / 4;
        for (let i = 0; i < d.length; i += 4) {
          r += d[i];
          g += d[i + 1];
          b += d[i + 2];
        }
        r /= n;
        g /= n;
        b /= n;
        out[name] = { r: Math.round(r), g: Math.round(g), b: Math.round(b), luma: +(0.2126 * r + 0.7152 * g + 0.0722 * b).toFixed(1) };
      }
      return { width: img.naturalWidth, height: img.naturalHeight, patches: out };
    },
    data,
    PATCHES,
  );
}

const rows = [];
for (const v of VANTAGES) {
  const a = A.views.get(v.name);
  const b = B.views.get(v.name);
  if (!a) throw new Error(`after run has no view ${v.name}`);
  const ma = await measure(a.png);
  const mb = b ? await measure(b.png) : null;
  rows.push({ ...v, a, b, ma, mb });
  console.log(v.name, Object.entries(ma.patches).map(([k, p]) => `${k} ${p.luma}${mb ? ` (was ${mb.patches[k].luma})` : ''}`).join('  '));
}
await browser.close();

/* ---------------------------------------------------------------- the page */

const outDir = dirname(out);
const rel = (p) => relative(outDir, p).split('\\').join('/');
const refPath = (name) => rel(join('assets', 'references', name));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const rgb = (p) => `rgb(${p.r},${p.g},${p.b})`;
const swatch = (p) => `<span class="sw" style="background:${rgb(p)}"></span>${p.r},${p.g},${p.b} · L ${p.luma}`;

const fogAt = (density, d) => 1 - Math.exp(-(d * density) * (d * density));

let html = `<!doctype html>
<meta charset="utf-8">
<title>The Stack — ${esc(title)} frame test</title>
<style>
  body { margin: 0; background: #0b1416; color: #cfe; font: 13px/1.4 -apple-system, Helvetica, Arial, sans-serif; }
  h1 { font-size: 18px; margin: 18px 20px 6px; }
  h2 { font-size: 14px; margin: 18px 20px 4px; color: #9dd; }
  .row { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; padding: 0 20px 8px; }
  .row img { width: 100%; display: block; background: #000; }
  .row .lbl { color: #9bb; font-size: 12px; margin-bottom: 3px; }
  .cap { color: #9bb; margin: 2px 20px 6px; }
  .crops { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; padding: 0 20px 6px; }
  .crop { width: 460px; height: 300px; overflow: hidden; background: #000; position: relative; }
  .crop img { position: absolute; max-width: none; }
  .croplbl { color: #9bb; font-size: 12px; padding: 0 20px 14px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .note { padding: 0 20px 12px; color: #9bb; max-width: 1200px; }
  table { border-collapse: collapse; margin: 0 20px 18px; font-size: 12px; }
  td, th { border: 1px solid #2a4; padding: 3px 8px; text-align: right; white-space: nowrap; }
  th:first-child, td:first-child { text-align: left; }
  .sw { display: inline-block; width: 12px; height: 12px; vertical-align: -2px; margin-right: 4px; border: 1px solid #467; }
</style>
<h1>The Stack — ${esc(title)}: the six frame-test vantages, before and after, against the two references</h1>
<div class="note">Left: the reference. Middle: before (${esc(B.tag)}). Right: after (${esc(A.tag)}). The game frames are 1440×900, DPR 1, chase camera, <code>?debug=1</code> overlay on. Under each row: three 1:1 crops of the AFTER frame (nothing is scaled), then the same crops of the BEFORE frame. The table gives the mean colour and luminance (0-255) of six rectangles of each frame, read straight out of the PNGs: the ceiling band over the road ahead, the two walls at the driver's shoulder, the road's vanishing point, and the asphalt either side of the car.</div>
`;

let lastRef = '';
for (const r of rows) {
  if (r.ref !== lastRef) {
    lastRef = r.ref;
    html += `<h2>${r.ref === 'city-v2-highway.webp' ? 'Reference A — the L2 driving experience' : 'Reference B — the street under the stacked decks'}</h2>\n`;
  }
  const fa = r.a.frame ?? {};
  const fb = r.b?.frame ?? {};
  html += `<div class="row"><div><div class="lbl">reference</div><img src="${refPath(r.ref)}"></div><div><div class="lbl">before · ${esc(B.tag)}</div>${r.b ? `<img src="${rel(r.b.png)}">` : ''}</div><div><div class="lbl">after · ${esc(A.tag)}</div><img src="${rel(r.a.png)}"></div></div>\n`;
  html += `<div class="cap">${r.n} · ${esc(r.name)} (${r.a.at.x}, ${r.a.at.y}, ${r.a.at.z}) — needs: ${esc(r.need)} — after: sky ${(fa.sky * 100).toFixed(1)} %, overhead ${(fa.overhead ?? []).join(' + ') || 'none'}, ${r.a.metrics.drawCalls} draws, ${r.a.metrics.triangles} tris, ${r.a.metrics.fps.toFixed(0)} fps, gpu ${r.a.metrics.gpuMs.toFixed(2)} ms${r.b ? ` — before: sky ${(fb.sky * 100).toFixed(1)} %, ${r.b.metrics.drawCalls} draws, ${r.b.metrics.triangles} tris` : ''}</div>\n`;
  html += `<div class="crops">${CROPS.map((c) => `<div class="crop"><img src="${rel(r.a.png)}" style="left:-${c.left}px;top:-${c.top}px"></div>`).join('')}</div>\n`;
  html += `<div class="croplbl">${CROPS.map((c) => `<div>after · ${c.label}</div>`).join('')}</div>\n`;
  if (r.b) {
    html += `<div class="crops">${CROPS.map((c) => `<div class="crop"><img src="${rel(r.b.png)}" style="left:-${c.left}px;top:-${c.top}px"></div>`).join('')}</div>\n`;
    html += `<div class="croplbl">${CROPS.map((c) => `<div>before · ${c.label}</div>`).join('')}</div>\n`;
  }
}

html += `<h2>Measured pixels (mean of each rectangle, 0-255)</h2>\n<table><tr><th>view</th><th>run</th>${Object.keys(PATCHES).map((k) => `<th>${k}</th>`).join('')}</tr>\n`;
for (const r of rows) {
  if (r.mb) html += `<tr><td>${esc(r.name)}</td><td>before</td>${Object.keys(PATCHES).map((k) => `<td>${swatch(r.mb.patches[k])}</td>`).join('')}</tr>\n`;
  html += `<tr><td>${esc(r.name)}</td><td>after</td>${Object.keys(PATCHES).map((k) => `<td>${swatch(r.ma.patches[k])}</td>`).join('')}</tr>\n`;
}
html += `</table>\n<div class="note">Patches (x0, y0, x1, y1): ${Object.entries(PATCHES).map(([k, p]) => `${k} ${p.join(',')}`).join(' · ')}.</div>\n`;
html += `<h2>Frame test, all six</h2>\n<table><tr><th>view</th><th>sky %</th><th>overhead</th><th>draws</th><th>tris</th><th>fps</th><th>gpu ms</th></tr>\n`;
for (const r of rows) {
  const f = r.a.frame ?? {};
  html += `<tr><td>${esc(r.name)}</td><td>${(f.sky * 100).toFixed(1)}</td><td>${(f.overhead ?? []).join(' + ') || 'none'}</td><td>${r.a.metrics.drawCalls}</td><td>${r.a.metrics.triangles}</td><td>${r.a.metrics.fps.toFixed(1)}</td><td>${r.a.metrics.gpuMs.toFixed(2)}</td></tr>\n`;
}
html += `</table>\n`;
if (A.json.fog) {
  const k = A.json.fog.density;
  html += `<div class="note">Fog: exp² density ${k.toFixed(5)} in the scene → ${(fogAt(k, 100) * 100).toFixed(0)} % at 100 m, ${(fogAt(k, 250) * 100).toFixed(0)} % at 250 m, ${(fogAt(k, 400) * 100).toFixed(0)} % at 400 m.</div>\n`;
}
writeFileSync(out, html);
writeFileSync(out.replace(/\.html$/, '.json'), JSON.stringify({ before, after, patches: PATCHES, rows: rows.map((r) => ({ name: r.name, after: r.ma.patches, before: r.mb?.patches ?? null })) }, null, 2));
console.log('wrote', out);
