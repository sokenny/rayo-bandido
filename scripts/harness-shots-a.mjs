/**
 * Screenshots of agent A's body-part harness (`harness/a-body.html`): one PNG per shot below.
 *
 * Usage: node scripts/harness-shots-a.mjs [--base http://127.0.0.1:5191] [--out artifacts/harness-a] [--only name,name]
 * Needs a Vite dev server on --base (`npx vite --port 5191 --strictPort`).
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const args = process.argv.slice(2);
const getArg = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const base = getArg('--base', 'http://127.0.0.1:5191');
const outDir = getArg('--out', 'artifacts/harness-a');
const only = getArg('--only', '').split(',').filter(Boolean);

const SHOTS = [
  { name: 'front-bumper', q: 'slot=frontBumper&views=front34,front,frontLow' },
  { name: 'front-bumper-lock', q: 'slot=frontBumper&views=frontLow,sideLow&stance=low&steer=0.55' },
  { name: 'rear-bumper', q: 'slot=rearBumper&views=rear34,rear,rearLow' },
  { name: 'rear-bumper-tips', q: 'slot=rearBumper&views=rear,rearLow&with=exhaustTips.quad' },
  { name: 'skirts', q: 'slot=skirts&views=side,front34,sideLow' },
  { name: 'skirts-stance', q: 'slot=skirts&views=sideLow,frontLow&stance=low&steer=0.55' },
  { name: 'hood', q: 'slot=hood&views=hood,front34,side' },
  { name: 'trunk', q: 'slot=trunk&views=rearHigh,rear34,side' },
  { name: 'spoiler', q: 'slot=spoiler&views=rear34,side,rear' },
  { name: 'spoiler-ducktail', q: 'slot=spoiler&views=rear34,side&with=trunk.ducktail' },
  { name: 'wing-close', q: 'slot=spoiler&views=wing,wingSide&ids=spoiler.street,spoiler.swan-neck,spoiler.double-gt&with=trunk.ducktail' },
  { name: 'exhaust', q: 'slot=exhaustTips&views=tips,rear34,rearLow' },
  { name: 'exhaust-bigtunnel', q: 'slot=exhaustTips&views=tips,rearLow&with=rearBumper.big-tunnel' },
  { name: 'livery', q: 'slot=frontBumper&views=front34,rear34&paint=1&with=rearBumper.big-tunnel,skirts.aero-box,hood.carbon,spoiler.double-gt,exhaustTips.titanium' },
];

const candidates = [
  process.env.RB_BROWSER,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
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
  headless: 'new',
  args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-angle=default'],
  defaultViewport: { width: 2800, height: 1000, deviceScaleFactor: 1 },
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  for (const shot of SHOTS) {
    if (only.length && !only.includes(shot.name)) continue;
    await page.goto(`${base}/harness/a-body.html?${shot.q}`, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => window.__harnessReady === true, { timeout: 60000 });
    const el = await page.$('#wrap');
    const file = join(outDir, `${shot.name}.png`);
    await el.screenshot({ path: file });
    console.log(file);
  }
  if (errors.length) console.error('page errors:\n' + errors.join('\n'));
} finally {
  await browser.close();
}
