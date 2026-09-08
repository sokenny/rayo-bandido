/**
 * Which objects the draw calls actually went to.
 *
 * `npm run perf` reports that a frame cost 108 draw calls against a budget of 60; this says
 * WHICH 108, by wrapping `renderBufferDirect` and tallying every submission by object, parent
 * chain and material over a sample of frames. That is the difference between knowing the
 * budget is blown and knowing what to merge, instance or cull.
 *
 * It found the open world's problem first time: the environment is properly merged (about
 * twenty-five calls for the whole city) and the traffic is not — 126 electric cars, three or
 * four calls each because every car clones its own materials, reaching 248 calls looking down
 * a long boulevard. Instancing the fleet is the fix; that has not been done yet.
 *
 * Usage:  node scripts/perf-drawcalls.mjs [--url http://127.0.0.1:8088/?mode=city&solo=1] [--drive]
 *         --drive gets the car moving and drifting first, so the transient effects are counted.
 * Requires a server on the URL (`npm run host`, or `npm run build` then `npm start`).
 *
 * Deterministic: it counts submissions, not milliseconds, so unlike a frame-time benchmark it
 * is worth trusting on a loaded machine.
 */
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const args = process.argv.slice(2);
const get = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const url = get('--url', 'http://127.0.0.1:8088/?debug=1&mode=city&solo=1');
const drive = args.includes('--drive');

const candidates = [
  process.env.RB_BROWSER,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);
const executablePath = candidates.find((p) => existsSync(p));

const browser = await puppeteer.launch({
  executablePath, headless: 'new',
  args: ['--window-size=1600,960', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-angle=default', '--autoplay-policy=no-user-gesture-required'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
await page.goto(url, { waitUntil: 'load', timeout: 30000 });
await page.waitForFunction(() => typeof window.__rb !== 'undefined', { timeout: 20000 });
await page.waitForFunction(() => { const rb = window.__rb; return !rb.ready || rb.ready(); }, { timeout: 40000 });
await page.click('#game-canvas').catch(() => {});
await new Promise((r) => setTimeout(r, 800));

if (drive) {
  // Get moving and drifting so the transient effects are on screen.
  await page.evaluate(() => window.__rb.inject({ throttle: 1 }, 120));
  await page.evaluate(() => window.__rb.inject({ throttle: 1, steer: 1, handbrake: true }, 40));
  await page.evaluate(() => window.__rb.inject({ throttle: 1, steer: 1, nitro: true }, 60));
}

const out = await page.evaluate(async (sampleFrames) => {
  const r = window.__rb.renderer;
  const tally = new Map();
  const orig = r.renderBufferDirect.bind(r);
  r.renderBufferDirect = function (camera, scene, geometry, material, object, group) {
    const idx = geometry.index;
    const tris = (idx ? idx.count : (geometry.attributes.position ? geometry.attributes.position.count : 0)) / 3;
    const inst = object.isInstancedMesh ? object.count : 1;
    let p = object.parent; const chain = [];
    while (p && chain.length < 3) { if (p.name) chain.push(p.name); p = p.parent; }
    const key = `${object.type} :: ${object.name || '(unnamed)'} :: under[${chain.join('<')}] :: ${material.type}`;
    const e = tally.get(key) || { calls: 0, tris: 0, inst: 0 };
    e.calls++; e.tris += tris; e.inst = inst;
    tally.set(key, e);
    return orig(camera, scene, geometry, material, object, group);
  };
  let frames = 0;
  await new Promise((res) => { const tick = () => { frames++; if (frames >= sampleFrames) res(); else requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
  r.renderBufferDirect = orig;
  const rows = [...tally.entries()].map(([k, v]) => ({ k, cpf: +(v.calls / frames).toFixed(2), tpf: Math.round(v.tris / frames), inst: v.inst }));
  rows.sort((a, b) => b.cpf - a.cpf);
  return { frames, totalCalls: +rows.reduce((a, x) => a + x.cpf, 0).toFixed(1), totalTris: rows.reduce((a, x) => a + x.tpf, 0), rows };
}, 90);

console.log(`\n${url}`);
console.log(`frames ${out.frames}   draw calls/frame ${out.totalCalls}   triangles/frame ${out.totalTris}\n`);
console.log('calls/f  tris/f   object');
for (const row of out.rows) console.log(`${String(row.cpf).padStart(6)}  ${String(row.tpf).padStart(7)}   ${row.k}`);
await browser.close();
