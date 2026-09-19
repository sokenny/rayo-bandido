/**
 * Captures agent G's lamp / neon / cabin-light harness (`harness/g-lights.html`), one PNG per
 * shot. Inspect them at full size (dark scenes lie when downscaled).
 *
 * Usage: npx vite --port 5197 --strictPort   (in another shell)
 *        node scripts/harness-shots-g.mjs [--url http://127.0.0.1:5197] [--out artifacts/harness-g]
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const args = process.argv.slice(2);
const getArg = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const base = getArg('--url', 'http://127.0.0.1:5197');
const outDir = getArg('--out', 'artifacts/harness-g');
const SHOTS = ['heads', 'tails', 'tailsBrake', 'tailsNitro', 'headColors', 'neonRest', 'neonHalf', 'neonCharged', 'cabin'];

const executablePath = [
  process.env.RB_BROWSER,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
]
  .filter(Boolean)
  .find((p) => existsSync(p));
if (!executablePath) {
  console.error('No Chrome found. Set RB_BROWSER.');
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

const browser = await puppeteer.launch({
  executablePath,
  headless: 'new',
  args: ['--ignore-gpu-blocklist', '--use-angle=default'],
  defaultViewport: { width: 1500, height: 840, deviceScaleFactor: 1 },
});
const errors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text()); // 404: the favicon
  });
  for (const shot of SHOTS) {
    await page.goto(`${base}/harness/g-lights.html?shot=${shot}`, { waitUntil: 'load', timeout: 40000 });
    await page.waitForFunction(() => window.__gReady === true, { timeout: 30000 });
    const file = join(outDir, `${shot}.png`);
    await page.screenshot({ path: file });
    console.log(file);
  }
} finally {
  await browser.close();
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
