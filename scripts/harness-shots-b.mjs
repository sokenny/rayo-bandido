/**
 * Agent B's contact sheets (`harness/b-wheels.html`): every rim design, rim colours, wheel
 * sizes and widths, and the stance extremes, each a PNG under the output directory.
 *
 * Usage: node scripts/harness-shots-b.mjs [--url http://localhost:5192/harness/b-wheels.html] [--out artifacts/harness-b]
 * Requires a Vite dev server serving the repo root on the URL.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const args = process.argv.slice(2);
const getArg = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const url = getArg('--url', 'http://localhost:5192/harness/b-wheels.html');
const outDir = getArg('--out', 'artifacts/harness-b');
const only = getArg('--only', '');

const RIMS = ['stock', 'hart-10', 'mesh', 'dish-3p', 'twin-6', 'turbofan', 'concave-5', 'steelie'];
const rim = (r, extra = {}) => ({ rim: `rims.${r}`, ...extra });

const SHEETS = {
  // Every design in its catalogue-default graphite, then in a colour it is known for.
  'rims-graphite': { cols: 4, cells: RIMS.map((r) => ({ view: 'wheel', label: r, loadout: { wheels: rim(r) } })) },
  'rims-colour': {
    cols: 4,
    cells: [
      ['stock', 'graphite'],
      ['hart-10', 'white'],
      ['mesh', 'gold'],
      ['dish-3p', 'black'],
      ['twin-6', 'bronze'],
      ['turbofan', 'white'],
      ['concave-5', 'red'],
      ['steelie', 'black'],
    ].map(([r, c]) => ({ view: 'wheel', label: `${r} ${c}`, loadout: { wheels: rim(r, { rimColor: c }) } })),
  },
  'rims-front34': { cols: 4, cells: RIMS.map((r) => ({ view: 'front34', label: r, loadout: { wheels: rim(r, { rimColor: 'silver' }) } })) },
  'size-width': {
    cols: 4,
    cells: [
      ...[-1, 0, 1, 2].map((s) => ({ view: 'wheel', label: `mesh size ${s}`, loadout: { wheels: rim('mesh', { size: s }) } })),
      { view: 'wheel', label: 'dish size 0 width 0', loadout: { wheels: rim('dish-3p') } },
      { view: 'wheel', label: 'dish size 2 width 2', loadout: { wheels: rim('dish-3p', { size: 2, width: 2 }) } },
      { view: 'front34', label: 'dish size 2 width 2', loadout: { wheels: rim('dish-3p', { size: 2, width: 2 }) } },
      { view: 'wheel', label: 'concave width 2', loadout: { wheels: rim('concave-5', { width: 2 }) } },
    ],
  },
  width: { cols: 3, cells: [0, 1, 2].map((w) => ({ view: 'head', label: `width ${w}`, loadout: { wheels: rim('stock', { width: w }) } })) },
  'ride-height': {
    cols: 3,
    cells: [-4, -3, -2, -1, 0, 2].map((h) => ({ view: 'side', label: `ride ${h}`, loadout: { stance: { rideHeight: h } } })),
  },
  'ride-close': {
    cols: 3,
    cells: [
      { view: 'wheel', label: 'ride -4', loadout: { stance: { rideHeight: -4 } } },
      { view: 'wheelRear', label: 'ride -4 rear', loadout: { stance: { rideHeight: -4 } } },
      { view: 'wheel', label: 'ride -4 camber 6 track 4 width 2', loadout: { wheels: rim('stock', { width: 2 }), stance: { rideHeight: -4, camberFront: 6, trackFront: 4 } } },
      { view: 'wheel', label: 'ride 0', loadout: {} },
      { view: 'wheelRear', label: 'ride -4 camber 8 track 4 rear', loadout: { stance: { rideHeight: -4, camberRear: 8, trackRear: 4 } } },
      { view: 'wheel', label: 'ride 2', loadout: { stance: { rideHeight: 2 } } },
    ],
  },
  camber: {
    cols: 2,
    cells: [
      ...[0, 2, 4, 6].map((c) => ({ view: 'head', label: `camber F ${c}`, loadout: { stance: { camberFront: c } } })),
      { view: 'tail', label: 'camber R 8', loadout: { stance: { camberRear: 8 } } },
      { view: 'tail', label: 'camber R 8 ride -4', loadout: { stance: { camberRear: 8, rideHeight: -4 } } },
    ],
  },
  track: {
    cols: 2,
    cells: [
      ...[-2, 0, 2, 4].map((t) => ({ view: 'head', label: `track F ${t}`, loadout: { stance: { trackFront: t } } })),
      { view: 'tail', label: 'track R 4', loadout: { stance: { trackRear: 4 } } },
      { view: 'tail', label: 'track R 4 width 2', loadout: { wheels: rim('stock', { width: 2 }), stance: { trackRear: 4 } } },
    ],
  },
  stanced: {
    cols: 2,
    cells: [
      { view: 'front34', label: 'stock', loadout: {} },
      {
        view: 'front34',
        label: 'full stance: dish gold, size 1, width 2, ride -4, camber 6/8, track 3/3',
        loadout: { wheels: rim('dish-3p', { rimColor: 'gold', size: 1, width: 2 }), stance: { rideHeight: -4, camberFront: 6, camberRear: 8, trackFront: 3, trackRear: 3 } },
      },
      { view: 'head', label: 'full stance head', loadout: { wheels: rim('dish-3p', { rimColor: 'gold', size: 1, width: 2 }), stance: { rideHeight: -4, camberFront: 6, camberRear: 8, trackFront: 3, trackRear: 3 } } },
      { view: 'side', label: 'full stance side', loadout: { wheels: rim('mesh', { rimColor: 'white', size: 1, width: 2 }), stance: { rideHeight: -4, camberFront: 6, camberRear: 8, trackFront: 3, trackRear: 3 } } },
    ],
  },
};

const executablePath = [process.env.RB_BROWSER, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome']
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
  defaultViewport: { width: 1600, height: 1000, deviceScaleFactor: 1 },
});
const errors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/404/.test(m.text())) errors.push(m.text());
  });
  await page.goto(url, { waitUntil: 'load', timeout: 40000 });
  await page.waitForFunction(() => window.ready === true, { timeout: 30000 });
  for (const [name, sheet] of Object.entries(SHEETS)) {
    if (only && !only.split(',').includes(name)) continue;
    await page.evaluate((s) => window.sheet(s.cells, s.cols), sheet);
    await new Promise((r) => setTimeout(r, 150));
    const path = join(outDir, `${name}.png`);
    await page.screenshot({ path });
    console.log(path);
  }
} finally {
  await browser.close();
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
