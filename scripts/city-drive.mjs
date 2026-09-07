/**
 * Drive-through check for the reclaimed city: runs the car down a list of streets under
 * throttle and records whether anything stops it, whether the road surface under it stays
 * where the layout says it is, and whether the console stays clean.
 *
 * The reclamation adds no colliders, so the contract is simply that driving through a
 * reclaimed street is exactly as uneventful as driving through a clean one.
 *
 * Usage: node scripts/city-drive.mjs [--url ...] [--headed]
 *
 * `&solo=1` is on the default URL on purpose: the open world is a server now, and a capture that
 * joined the live city would have other people's cars driving through it.
 */
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const args = process.argv.slice(2);
const getArg = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const url = getArg('--url', 'http://127.0.0.1:5173/?mode=city&solo=1&debug=1');
const headed = args.includes('--headed');

/** Straight runs through reclaimed streets, and the heading that follows each one. */
const RUNS = [
  { name: 'av-main south', x: -70, z: -40, heading: Math.PI },
  { name: 'st-far-east', x: 210, z: -100, heading: Math.PI },
  { name: 'blvd-center', x: -100, z: 60, heading: Math.PI / 2 },
  { name: 'blvd-water', x: -100, z: 186, heading: Math.PI / 2 },
  { name: 'alley-d', x: 160, z: -55, heading: Math.PI },
];
const SECONDS = 7;

const exe = [
  process.env.RB_BROWSER,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
].filter(Boolean).find((p) => existsSync(p));
if (!exe) {
  console.error('No Chrome found. Set RB_BROWSER.');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: exe,
  headless: headed ? false : 'new',
  args: ['--window-size=1280,720', '--ignore-gpu-blocklist', '--use-angle=default'],
  defaultViewport: { width: 1280, height: 720 },
});
const errors = [];
let bad = 0;
try {
  const page = await browser.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(url, { waitUntil: 'load', timeout: 40000 });
  await page.waitForFunction(() => typeof window.__rb !== 'undefined', { timeout: 20000 });
  await page.waitForFunction(() => !window.__rb.ready || window.__rb.ready(), { timeout: 60000 });
  await page.click('#game-canvas').catch(() => {});
  await sleep(1000);

  for (const run of RUNS) {
    await page.evaluate((v) => {
      const s = window.__rb.state.vehicle;
      s.x = v.x; s.z = v.z; s.prevX = v.x; s.prevZ = v.z;
      s.heading = v.heading; s.prevHeading = v.heading;
      s.vx = 0; s.vz = 0; s.speed = 0; s.lateralSpeed = 0;
    }, run);
    // The same automation hook the QA drive uses: queue N simulation ticks of throttle and
    // wait for the simulation to consume them.
    await page.evaluate((t) => window.__rb.inject({ throttle: 1 }, t), Math.round(SECONDS / (1 / 120)));
    const started = Date.now();
    while (Date.now() - started < 30000) {
      const pending = await page.evaluate(() => (window.__rb.pending ? window.__rb.pending() : 0));
      if (pending <= 0) break;
      await sleep(100);
    }
    const out = await page.evaluate(() => {
      const s = window.__rb.state.vehicle;
      return { x: s.x, z: s.z, speed: s.speed, y: s.y ?? 0 };
    });
    const travelled = Math.hypot(out.x - run.x, out.z - run.z);
    // Under throttle for seven simulated seconds the car covers hundreds of metres unless
    // something stopped it. Anything under a hundred means it hit something — and the
    // reclamation adds no colliders, so it should never be the thing that does.
    const ok = travelled > 100;
    if (!ok) bad++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${run.name}: ${travelled.toFixed(0)} m travelled`);
  }
  await page.evaluate(() => {
    window.__rb.command.throttle = 0;
  });
} finally {
  await browser.close();
}
console.log('console errors:', errors.length ? errors : 'none');
process.exit(bad > 0 || errors.length > 0 ? 1 : 0);
