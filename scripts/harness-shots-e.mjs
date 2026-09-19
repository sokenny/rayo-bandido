/**
 * Screenshots of the workshop UI harness (`harness/e-ui.html`, agent E): every scene at the
 * three viewports the brief asks for, plus a landscape phone.
 *
 * Usage: npx vite --port 5195 --strictPort   (in another shell)
 *        node scripts/harness-shots-e.mjs [--url http://127.0.0.1:5195] [--out artifacts/shots/workshop-ui] [--scenes part,color]
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const args = process.argv.slice(2);
const getArg = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const base = getArg('--url', 'http://127.0.0.1:5195');
const outDir = getArg('--out', 'artifacts/shots/workshop-ui');
const scenes = getArg('--scenes', 'groups,categories,part,owned,color,neon,step,finish,vinyls,decals,plate,denied').split(',');
const sizes = getArg('--sizes', '1440x900,1280x720,390x844,844x390')
  .split(',')
  .map((s) => {
    const [width, height] = s.split('x').map(Number);
    return { width, height };
  });

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath, headless: 'new' });
const errors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(m.text());
  });
  for (const size of sizes) {
    const mobile = size.width < 900 && size.height < 900;
    await page.setViewport({ ...size, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
    for (const scene of scenes) {
      await page.goto(`${base}/harness/e-ui.html?scene=${scene}`, { waitUntil: 'load' });
      await page.waitForFunction(() => typeof window.__ws !== 'undefined', { timeout: 15000 });
      // Scenes that animate in (the toast, the stamp) are caught mid-hold.
      await sleep(scene === 'denied' ? 450 : 700);
      const file = join(outDir, `${scene}-${size.width}x${size.height}.png`);
      await page.screenshot({ path: file });
      console.log(file);
    }
  }
} finally {
  await browser.close();
}
if (errors.length) {
  console.error('page errors:\n' + errors.join('\n'));
  process.exitCode = 1;
}
