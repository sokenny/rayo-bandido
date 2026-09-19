/**
 * Agent C's paint-shop screenshots: the harness page (`harness/c-paint.html`) once per shot.
 *
 * Usage: npx vite --port 5193 --strictPort   (in another shell), then
 *        node scripts/harness-shots-c.mjs [--out artifacts/c-paint] [--only substring] [--url http://127.0.0.1:5193]
 *
 * Shots: the stock car old (pre-atlas) vs new from six angles on both backdrops, every vinyl,
 * every finish, every decal zone, every plate style, and the raw atlas for a few loadouts.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const args = process.argv.slice(2);
const getArg = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const outDir = getArg('--out', 'artifacts/c-paint');
const only = getArg('--only', '');
const base = getArg('--url', 'http://127.0.0.1:5193');

const shots = [];
const add = (name, params) => shots.push({ name, params });

// Stock: old vs new.
for (const bg of ['studio', 'night']) {
  for (const view of ['q3f', 'q3r', 'left', 'right', 'top', 'rear']) {
    add(`stock-old-${bg}-${view}`, { look: 'old', bg, view });
    add(`stock-new-${bg}-${view}`, { bg, view });
  }
}
// Vinyls, each on a base that shows it.
const vinyls = [
  ['bolts', 'cyan', 'black'],
  ['tribal', 'gunmetal', 'white'],
  ['flames', 'orange', 'black'],
  ['stripes', 'white', 'blue'],
  ['kanji', 'red', 'white'],
  ['circuit', 'cyan', 'navy'],
  ['camo', 'olive', 'sand'],
  ['fade', 'violet', 'black'],
  ['checker', 'white', 'black'],
  ['rayo', 'cyan', 'midnight'],
  ['rayo', 'lime', 'black'],
];
for (const [id, color, b] of vinyls) {
  for (const view of ['q3f', 'right', 'top']) add(`vinyl-${id}-${color}-${view}`, { base: b, finish: 'gloss', v: `${id}:${color}`, bg: 'studio', view });
  add(`vinyl-${id}-${color}-night-left`, { base: b, finish: 'gloss', v: `${id}:${color}`, bg: 'night', view: 'left' });
}
// Finishes.
const finishes = [
  ['pearl', 'purple'],
  ['pearl', 'white'],
  ['gloss', 'red'],
  ['matte', 'black'],
  ['matte', 'olive'],
  ['chrome', 'silver'],
  ['chrome', 'gold'],
  ['metallic', 'blue'],
];
for (const [finish, b] of finishes) {
  for (const bg of ['studio', 'night']) add(`finish-${finish}-${b}-${bg}`, { base: b, finish, v: '', bg, view: 'q3f' });
}
add('twotone-roof', { base: 'white', finish: 'gloss', roof: 'black', v: '', bg: 'studio', view: 'q3f' });
add('twotone-roof-rear', { base: 'white', finish: 'gloss', roof: 'black', v: '', bg: 'studio', view: 'q3r' });
// The NFSU2 reference: white body, grey tribal.
add('ref-white-tribal', { base: 'white', finish: 'pearl', v: 'tribal:gunmetal', bg: 'studio', view: 'left' });
add('ref-purple-pearl', { base: 'purple', finish: 'pearl', v: '', bg: 'studio', view: 'q3r' });
// Decals: every zone, every decal.
const decalCars = [
  { name: 'decals-a', d: 'rayo-banner@windshield,kaminari@sideLeft,kaminari@sideRight,wakaba@rearQuarterLeft,sun-disc@rearQuarterRight,drift-kanji@hood,neomate@trunk,taller-loco@roof' },
  { name: 'decals-b', d: 'chispa@sideLeft,neomate@sideRight,drift-kanji@rearQuarterLeft,drift-kanji@rearQuarterRight,rayo-banner@hood,kaminari@trunk,wakaba@roof' },
  { name: 'decals-graffiti', d: 'graffiti-mural@sideLeft,graffiti-wild@sideRight,graffiti-tag@hood,graffiti-bubble@roof,graffiti-tag@rearQuarterLeft' },
];
for (const c of decalCars) {
  for (const view of ['q3f', 'q3r', 'left', 'right', 'top', 'hood']) add(`${c.name}-${view}`, { base: 'white', finish: 'gloss', v: '', d: c.d, bg: 'studio', view });
  add(`${c.name}-night-left`, { d: c.d, bg: 'night', view: 'left' });
}
// Plates.
for (const plate of ['stock', 'mercosur', 'classic', 'kei', 'neon']) {
  add(`plate-${plate}`, { plate, text: 'AB123CD', bg: 'studio', view: 'plate' });
  add(`plate-${plate}-night`, { plate, text: 'RAYO 77', bg: 'night', view: 'plate' });
}
// Stacks: four layers.
add('stack-4', { base: 'black', finish: 'metallic', v: 'fade:violet,circuit:cyan,stripes:white,bolts:magenta', d: 'rayo-banner@windshield', bg: 'studio', view: 'q3f' });
// Raw atlases.
add('atlas-stock', { atlas: '1' });
add('atlas-decals-a', { atlas: '1', base: 'white', v: '', d: decalCars[0].d });
add('atlas-stack', { atlas: '1', base: 'black', v: 'fade:violet,circuit:cyan,stripes:white,bolts:magenta', d: 'rayo-banner@windshield', plate: 'mercosur' });

const candidates = [process.env.RB_BROWSER, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome'].filter(Boolean);
const executablePath = candidates.find((p) => existsSync(p));
if (!executablePath) {
  console.error('No Chrome found. Set RB_BROWSER.');
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

const browser = await puppeteer.launch({
  executablePath,
  headless: 'new',
  args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-angle=default'],
  defaultViewport: { width: 1200, height: 720, deviceScaleFactor: 1 },
});
const errors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  for (const shot of shots) {
    if (only && !shot.name.includes(only)) continue;
    const url = `${base}/harness/c-paint.html?${new URLSearchParams(shot.params)}`;
    await page.setViewport(shot.params.atlas ? { width: 1024, height: 1024 } : { width: 1200, height: 720 });
    await page.goto(url, { waitUntil: 'load', timeout: 40000 });
    await page.waitForFunction(() => window.__ready === true, { timeout: 20000 });
    const file = join(outDir, `${shot.name}.png`);
    await page.screenshot({ path: file, type: 'png' });
    console.log(file);
  }
} finally {
  // Chrome sometimes lingers on close with a WebGL page open; do not let that hold the run.
  await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 5000))]);
}
if (errors.length) console.log('page errors:', [...new Set(errors)].join('\n'));
process.exit(0);
