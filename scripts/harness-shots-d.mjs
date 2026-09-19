/**
 * Agent D's showroom captures: one PNG per workshop category (the camera shot it names), a few
 * intro frames and a free-look frame, and the renderer's draw calls and triangles for each.
 *
 * Usage: npx vite --port 5194 --strictPort   (in another shell)
 *        node scripts/harness-shots-d.mjs [--url http://127.0.0.1:5194/harness/d-showroom.html] [--out artifacts/workshop-d] [--only rims,neon] [--headed]
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const args = process.argv.slice(2);
const getArg = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const url = getArg('--url', 'http://127.0.0.1:5194/harness/d-showroom.html');
const outDir = getArg('--out', 'artifacts/workshop-d');
const only = getArg('--only', '');
const headed = args.includes('--headed');
const viewport = { width: 1600, height: 900 };

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
mkdirSync(outDir, { recursive: true });

const browser = await puppeteer.launch({
  executablePath,
  headless: headed ? false : 'new',
  args: [`--window-size=${viewport.width},${viewport.height + 60}`, '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-angle=default'],
  defaultViewport: { ...viewport, deviceScaleFactor: 1 },
});

const report = { url, viewport, shots: [], errors: [] };
try {
  const page = await browser.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') report.errors.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => report.errors.push(String(e)));
  await page.goto(`${url}${url.includes('?') ? '&' : '?'}shots=1`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__d && window.__d.ready, { timeout: 60000 });
  const meta = await page.evaluate(() => ({ buildMs: window.__d.buildMs, categories: window.__d.categories }));
  report.buildMs = meta.buildMs;

  const filter = only ? new Set(only.split(',')) : null;
  let n = 0;
  const snap = async (name, fn) => {
    const info = await page.evaluate(fn);
    const file = join(outDir, `${String(++n).padStart(2, '0')}-${name}.png`);
    await page.screenshot({ path: file });
    report.shots.push({ name, file, ...info });
    console.log(name.padEnd(34), `calls ${info.calls}`.padEnd(10), `tris ${info.triangles}`);
  };

  // A settled frame per category, in menu order; a category whose shot was already taken is skipped
  // unless it dims (the dimmed frame differs).
  const seen = new Set();
  for (const c of meta.categories) {
    if (filter && !filter.has(c.id) && !filter.has(c.shot)) continue;
    const key = `${c.shot}${c.dim ? '-dim' : ''}`;
    if (seen.has(key) && !filter) continue;
    seen.add(key);
    await snap(`${c.id}-${c.shot}${c.dim ? '-dim' : ''}`, `window.__d.show(${JSON.stringify(c.id)}, 3)`);
  }
  // Shots no category names yet (proposed to agent F), with the lights they are meant for.
  const extra = { headlightsClose: 'headlightColor', exhaustClose: 'exhaustTips', neonLow: 'neon' };
  const named = new Set(meta.categories.map((c) => c.shot));
  for (const [shot, lights] of Object.entries(extra)) {
    if (named.has(shot) || (filter && !filter.has(shot))) continue;
    await snap(`proposed-${shot}${lights === 'neon' ? '-dim' : ''}`, `window.__d.show(${JSON.stringify(shot)}, 3, undefined, ${JSON.stringify(lights)})`);
  }
  if (!filter) {
    // Back to lit, then the intro, free look, and the room's own cost.
    await page.evaluate(() => window.__d.show('frontBumper', 3));
    await snap('intro-0.25s', `window.__d.intro('paint', 0.25)`);
    await snap('intro-0.9s', `window.__d.intro('paint', 0.9)`);
    await snap('drag-free-look', `window.__d.show('rims', 0.4, { dragYaw: 1.3, dragPitch: 0.5, zoom: -6, dragging: false })`);
    await snap('room-only', `window.__d.roomOnly()`);
    report.passes = {};
    for (const c of ['frontBumper', 'paint', 'rims', 'neon']) {
      report.passes[c] = await page.evaluate((id) => {
        window.__d.show(id, 2);
        return window.__d.passes();
      }, c);
      const p = report.passes[c];
      console.log(`${c}: both ${p.both.calls} calls / ${p.both.triangles} tris; main ${p.main.calls} / ${p.main.triangles}`);
    }
    report.disposeCycle = await page.evaluate(() => window.__d.disposeCycle());
    console.log('dispose cycle (GPU geometries/textures):', JSON.stringify(report.disposeCycle));
    report.msPerFrame = await page.evaluate(() => {
      window.__d.show('paint', 1);
      return window.__d.timeRenders(60);
    });
    console.log('ms/frame (update+render, finish-bound):', report.msPerFrame.toFixed(2));
  }
} catch (e) {
  report.errors.push(String(e?.stack ?? e));
} finally {
  await browser.close();
  writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  if (report.errors.length) console.log('errors:', report.errors.slice(0, 10));
  console.log(`wrote ${report.shots.length} shots to ${outDir}`);
}
