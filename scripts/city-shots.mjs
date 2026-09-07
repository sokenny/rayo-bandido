/**
 * City viewpoint capture: parks the car at a list of named viewpoints, waits for the scene
 * to settle, and saves a screenshot and the renderer metrics for each. Used to compare the
 * look and the cost of the city before and after an art change.
 *
 * Usage: node scripts/city-shots.mjs --tag before [--url ...] [--headed] [--out artifacts/shots]
 * Requires a dev or preview server on the URL. `&solo=1` keeps the shot out of the shared open
 * world, so nobody else's car turns up in it.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const args = process.argv.slice(2);
const getArg = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const tag = getArg('--tag', 'shot');
const url = getArg('--url', 'http://127.0.0.1:5178/?mode=city&solo=1&debug=1');
const outDir = getArg('--out', 'artifacts/shots');
const headed = args.includes('--headed');

/**
 * Free-camera inspection shots: eye position and the point it looks at, in world metres.
 * These bypass the chase camera (see `installFreeCamera`) so a wall, a plant or a tag can be
 * looked at from the pavement, which the gameplay camera can never do.
 */
const CLOSEUPS = [
  { name: 'close-alley', eye: [166, 3.2, 34], at: [150, 4, 20] },
  { name: 'close-pocket-mid', eye: [70, 3, 112], at: [86, 4.5, 104] },
  { name: 'close-pocket-east', eye: [204, 3, 30], at: [190, 4.5, 22] },
  { name: 'close-viaduct', eye: [236, 4, 34], at: [248, 6, 20] },
  { name: 'close-wall', eye: [187, 2.6, 28], at: [178, 2.2, 27] },
  { name: 'close-perimeter', eye: [250, 2.4, 22], at: [258, 2.0, 34] },
  { name: 'close-perimeter-w', eye: [-250, 2.4, 22], at: [-258, 2.0, 34] },
  // Street lamps, the fixture from `propsBuilder`'s `LAMP`. One from the pavement at the
  // height a driver sees the boot and collar, one stood back to read the whole silhouette
  // against the sky, and one along a row to check they do not crowd the street.
  { name: 'close-lamp', eye: [-51.5, 1.9, 152.2], at: [-58.1, 4.2, 153.4] },
  { name: 'close-lamp-full', eye: [-46, 5.5, 149], at: [-58.1, 5.0, 153.5] },
  { name: 'close-lamp-row', eye: [-56, 2.2, 120], at: [-58.1, 5.5, 155] },
];

/** Where to stand and which way to look. Heading 0 is -Z; +PI/2 is +X (see the vehicle sim). */
const VIEWS = [
  { name: 'spawn', x: -70, z: 150, heading: 0 },
  { name: 'downtown-ave', x: -70, z: -20, heading: 0 },
  { name: 'oldtown-water', x: 60, z: 175, heading: Math.PI / 2 },
  { name: 'viaduct-under', x: 150, z: 60, heading: Math.PI / 2 },
  { name: 'alley-east', x: 160, z: 20, heading: 0 },
  { name: 'skyway', x: -70, z: -205, heading: Math.PI / 2 },
  // Reclamation pockets, from `tests` on the field: the places that should look given up.
  { name: 'pocket-west', x: -190, z: 125, heading: 0 },
  { name: 'pocket-mid', x: 65, z: 115, heading: Math.PI / 2 },
  { name: 'pocket-east', x: 207, z: 26, heading: 0 },
  { name: 'pocket-north', x: 258, z: -168, heading: -Math.PI / 2 },
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

mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath,
  headless: headed ? false : 'new',
  args: ['--window-size=1600,960', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-angle=default'],
  defaultViewport: { width: 1600, height: 900, deviceScaleFactor: 1 },
});

const out = { tag, url, views: [], errors: [] };
try {
  const page = await browser.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') out.errors.push(m.text());
  });
  page.on('pageerror', (e) => out.errors.push(String(e)));
  await page.goto(url, { waitUntil: 'load', timeout: 40000 });
  await page.waitForFunction(() => typeof window.__rb !== 'undefined', { timeout: 20000 });
  await page.waitForFunction(() => !window.__rb.ready || window.__rb.ready(), { timeout: 60000 });
  await page.click('#game-canvas').catch(() => {});
  await sleep(1200);

  for (const v of VIEWS) {
    await page.evaluate((view) => {
      const s = window.__rb.state.vehicle;
      s.x = view.x;
      s.z = view.z;
      s.prevX = view.x;
      s.prevZ = view.z;
      s.heading = view.heading;
      s.prevHeading = view.heading;
      s.vx = 0;
      s.vz = 0;
      s.speed = 0;
      s.lateralSpeed = 0;
    }, v);
    // Long enough for the chase camera to settle and the metric window to refill.
    await sleep(2200);
    const file = join(outDir, `${tag}-${v.name}.png`);
    await page.screenshot({ path: file, type: 'png' });
    const m = await page.evaluate(() => JSON.parse(JSON.stringify(window.__rb.metrics)));
    out.views.push({ ...v, file, metrics: m });
    console.log(`${v.name}: ${m.drawCalls} draws, ${m.triangles} tris, ${m.fps.toFixed(1)} fps, gpu ${m.gpuMs.toFixed(2)} ms`);
  }
  // Free-camera close-ups: the chase camera is pinned to the car, so for inspecting a wall
  // or a plant we drive the scene camera ourselves. A requestAnimationFrame callback
  // registered after the game's own re-renders the frame from where we want to stand; the
  // game is untouched and the next reload forgets all of it.
  await page.evaluate(() => {
    const rb = window.__rb;
    window.__shot = { eye: null, at: null };
    const tick = () => {
      const s = window.__shot;
      if (s.eye) {
        rb.camera.position.set(s.eye[0], s.eye[1], s.eye[2]);
        rb.camera.lookAt(s.at[0], s.at[1], s.at[2]);
        rb.camera.updateMatrixWorld();
        rb.renderer.render(rb.scene, rb.camera);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  for (const v of CLOSEUPS) {
    await page.evaluate((view) => {
      window.__shot.eye = view.eye;
      window.__shot.at = view.at;
    }, v);
    await sleep(700);
    const file = join(outDir, `${tag}-${v.name}.png`);
    await page.screenshot({ path: file, type: 'png' });
    out.views.push({ ...v, file });
    console.log(`${v.name}: free camera`);
  }
} finally {
  await browser.close();
}
writeFileSync(join(outDir, `${tag}.json`), JSON.stringify(out, null, 2));
console.log('errors:', out.errors.length ? out.errors : 'none');
console.log('wrote', join(outDir, `${tag}.json`));
