/**
 * Loco Mustang's workshop, driven end to end in the LIVE game (`docs/GARAGE_PLAN.md`, Ola 2):
 * the car to the ring, F, the fade, the showroom and its overlay, a walk through the groups with
 * the real keyboard, purchases with money from the debug hook, SALIR, the car back in the city
 * wearing them — and a reload, to see the save come back.
 *
 * Captures go to `artifacts/workshop-integration/` (read them at full size: the showroom is dark).
 * Also reports the car's draw calls and the renderer's geometry/texture counts before and after a
 * visit, so a showroom that leaks, or a car that grew a draw call, shows up as a number.
 *
 * Usage: node scripts/workshop-drive.mjs [--url http://127.0.0.1:5199] [--headed]
 * Needs the dev server (`npx vite --port 5199`), because `__rb.workshop.setMoney` is DEV only.
 */
import { existsSync, mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const args = process.argv.slice(2);
const getArg = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const base = getArg('--url', 'http://127.0.0.1:5199');
const url = `${base}/?mode=city&solo=1&intro=0`;
const headed = args.includes('--headed');
const out = 'artifacts/workshop-integration';
mkdirSync(out, { recursive: true });

const exe = [process.env.RB_BROWSER, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome'].filter(Boolean).find((p) => existsSync(p));
if (!exe) {
  console.error('No Chrome found. Set RB_BROWSER.');
  process.exit(1);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = 1600;
const H = 900;
const browser = await puppeteer.launch({
  executablePath: exe,
  headless: headed ? false : 'new',
  args: [`--window-size=${W},${H}`, '--ignore-gpu-blocklist', '--use-angle=default', '--autoplay-policy=no-user-gesture-required'],
  defaultViewport: { width: W, height: H },
});
const errors = [];
const log = (...a) => console.log(...a);
let failures = 0;
const check = (ok, what) => {
  log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
  if (!ok) failures++;
};

async function boot(page) {
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => typeof window.__rb !== 'undefined', { timeout: 60000 });
  await page.waitForFunction(() => !window.__rb.ready || window.__rb.ready(), { timeout: 90000 });
  await page.click('#game-canvas').catch(() => {});
  await sleep(800);
}

/** Draw calls of the player's car: its visible meshes (the damage decals only while it carries any). */
const carCalls = (page) =>
  page.evaluate(() => {
    const root = window.__rb.scene.getObjectByName('player-car');
    if (!root) return -1;
    let n = 0;
    root.traverseVisible((o) => {
      if (o.isMesh && !(o.geometry.drawRange.count === 0) && (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) > 0) n++;
    });
    return n;
  });
const memory = (page) => page.evaluate(() => ({ ...window.__rb.renderer.info.memory, programs: window.__rb.renderer.info.programs?.length ?? 0 }));
const status = (page) => page.evaluate(() => window.__rb.workshop.status());
const shot = async (page, name) => {
  await page.screenshot({ path: `${out}/${name}.png` });
  log(`      shot ${out}/${name}.png`);
};
const key = async (page, code, times = 1) => {
  for (let i = 0; i < times; i++) {
    await page.keyboard.press(code);
    await sleep(140);
  }
};
async function waitFor(page, fn, timeout = 15000, arg) {
  await page.waitForFunction(fn, { timeout, polling: 100 }, arg);
}

try {
  const page = await browser.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));

  // A fresh garage: stock car, nothing bought.
  await page.goto(`${base}/`, { waitUntil: 'load' });
  await page.evaluate(() => localStorage.removeItem('rb.garage'));
  await boot(page);

  const hook = await page.evaluate(() => !!window.__rb.workshop);
  check(hook, '__rb.workshop exists in the open world');
  if (!hook) throw new Error('no workshop hook');

  const callsBefore = await carCalls(page);
  log(`      car draw calls before: ${callsBefore}`);

  // To the ring, nose to the garage.
  await page.evaluate(() => window.__rb.workshop.goToRing());
  await sleep(1500);
  await shot(page, '01-city-ring');
  const atSite = await page.evaluate(() => window.__rb.state.garage.atSite);
  check(atSite, 'the car is on the ring');
  // The baseline with the camera where it will be after the visit (the car faces the street on
  // the way out): three uploads city geometry the first time it is in view, so a baseline taken
  // looking at the garage would count the street as a leak.
  await page.evaluate(() => {
    const site = window.__rb.workshop.site;
    window.__rb.teleport(site.x, site.z, site.heading, site.y);
  });
  await sleep(2500);
  const memBefore = await memory(page);
  log(`      renderer memory before: ${JSON.stringify(memBefore)}`);

  // F — the real key.
  await page.keyboard.press('KeyF');
  await sleep(250);
  await shot(page, '02-fade');
  const phaseAfterF = (await status(page)).phase;
  check(phaseAfterF === 'entering' || phaseAfterF === 'browsing', `F opens the door (phase ${phaseAfterF})`);
  await waitFor(page, () => window.__rb.workshop.status().showroom, 20000);
  await sleep(2600); // the intro swoop
  await shot(page, '03-showroom-groups');
  const moneyStart = await page.evaluate(() => window.__rb.workshop.setMoney(60000));
  log(`      money set to ${moneyStart}`);

  // Carrocería → Paragolpes delantero → next option → INSTALAR.
  await key(page, 'Enter'); // groups → categories
  await key(page, 'Enter'); // open the front bumper
  await key(page, 'ArrowDown');
  await sleep(900);
  let s = await status(page);
  check(s.phase === 'previewing' && s.category === 'frontBumper', `inside the front bumper (${s.phase}/${s.category})`);
  await shot(page, '04-front-bumper-preview');
  await key(page, 'Enter'); // INSTALAR
  await sleep(600);
  s = await status(page);
  check(s.installed.body.frontBumper !== 'frontBumper.stock', `front bumper installed: ${s.installed.body.frontBumper}`);
  check(s.money < 60000, `money was spent: ${s.money}`);

  // Spoiler (the tail is what the chase camera sees).
  await key(page, 'KeyE', 5); // Q/E inside a category: along the body group to the spoiler
  s = await status(page);
  log(`      now in ${s.category}`);
  await key(page, 'ArrowDown', 2);
  await sleep(900);
  await shot(page, '05-spoiler-preview');
  await key(page, 'Enter');
  await sleep(500);

  // Up to the groups, over to Llantas y stance, into the rims.
  await key(page, 'Escape'); // options → categories
  await key(page, 'Escape'); // categories → groups
  await key(page, 'ArrowRight');
  await key(page, 'Enter');
  await key(page, 'Enter');
  await key(page, 'ArrowDown', 2);
  await sleep(1000);
  s = await status(page);
  check(s.category === 'rims', `inside the rims (${s.category})`);
  await shot(page, '06-rims-preview');
  await key(page, 'Enter');
  await sleep(400);

  // Camber, to see whether the shot shows it (B's concern).
  await key(page, 'KeyE', 5); // rims → rimColor → wheelSize → wheelWidth → rideHeight → camberFront
  s = await status(page);
  log(`      now in ${s.category}`);
  await key(page, 'ArrowRight', 4);
  await sleep(1400);
  await shot(page, '07-camber-front');
  await key(page, 'Escape');
  await key(page, 'Escape');

  // Pintura → Color: a red the chase camera cannot miss.
  await key(page, 'ArrowRight');
  await key(page, 'Enter');
  await key(page, 'Enter');
  await sleep(300);
  await page.evaluate(() => {
    const opts = window.__rb.workshop.state && window.__rb.workshop.state.category === 'paint' ? null : null;
    return opts;
  });
  // Walk the palette to red (index 9 in PALETTE: one row down, the rest right).
  const redAt = await page.evaluate(() => 9);
  await page.evaluate((i) => window.__rb.workshop.intent({ type: 'optionIndex', index: i }), redAt);
  await sleep(1400);
  s = await status(page);
  check(s.category === 'paint', `inside the paint (${s.category})`);
  await shot(page, '08-paint-red-preview');
  await key(page, 'Enter');
  await sleep(500);
  s = await status(page);
  check(s.installed.paint.base === 'red', `paint installed: ${s.installed.paint.base}`);

  // Vinyls: the layer editor.
  await key(page, 'KeyE', 3); // paint → roofColor → finish → vinyls
  s = await status(page);
  log(`      now in ${s.category}`);
  await key(page, 'ArrowRight', 2);
  await sleep(1400);
  await shot(page, '09-vinyls');
  // Take the layer off altogether (the stock RAYO vinyl hides most of the paint) and apply: a
  // bare red car is what the street captures below can be judged by.
  await key(page, 'Delete');
  await sleep(300);
  await key(page, 'Enter');
  await sleep(900);
  s = await status(page);
  check(s.installed.vinyls.length === 0, `vinyl layers removed and applied (${s.installed.vinyls.length} left)`);
  await shot(page, '09b-vinyls-removed');
  await key(page, 'Escape');
  await key(page, 'Escape');

  // Luces → Neón, dimmed shop.
  await key(page, 'ArrowRight');
  await key(page, 'Enter');
  await key(page, 'KeyD', 3); // headlights → headlightColor → taillights → neon (on the carousel)
  await key(page, 'Enter');
  await page.evaluate(() => window.__rb.workshop.intent({ type: 'optionIndex', index: 29 }));
  await sleep(2200);
  s = await status(page);
  check(s.category === 'neon', `inside the neon (${s.category})`);
  await shot(page, '10-neon-preview');
  await key(page, 'Enter');
  await sleep(400);
  await key(page, 'Escape');
  await key(page, 'Escape');

  // Escape → Sonido: the rev demo (heard, not seen) and the exhaust close-up.
  await key(page, 'ArrowRight');
  await key(page, 'Enter');
  await key(page, 'KeyD');
  await key(page, 'Enter');
  await key(page, 'ArrowDown');
  await sleep(1400);
  s = await status(page);
  check(s.category === 'exhaustSound', `inside the exhaust sound (${s.category})`);
  const exhaust = await page.evaluate(() => window.__rb.workshop.state.preview.exhaustSound);
  log(`      exhaust previewed: ${exhaust}`);
  await shot(page, '11-exhaust-close');

  // Not enough money: the refusal.
  await page.evaluate(() => window.__rb.workshop.setMoney(10));
  await key(page, 'Enter');
  await sleep(700);
  s = await status(page);
  check(s.lastDenied === 'funds', `refused for money (${s.lastDenied})`);
  await shot(page, '12-denied-funds');
  await page.evaluate(() => window.__rb.workshop.setMoney(40000));

  const installed = (await status(page)).installed;

  // SALIR.
  await key(page, 'KeyX');
  await sleep(200);
  await waitFor(page, () => window.__rb.workshop.status().phase === 'closed', 10000);
  await sleep(1500);
  s = await status(page);
  check(JSON.stringify(s.installed) === JSON.stringify(installed), 'the car left wearing what was installed');
  check(s.carLoadout === JSON.stringify(s.installed), 'the car visual wears the installed loadout (not the try-on)');
  check(installed.exhaustSound === 'exhaustSound.stock', 'the un-installed exhaust try-on was discarded');
  await shot(page, '13-city-after');
  // The chase camera dragged round to the car's flank (the same drag a player does).
  const orbit = async (name) => {
    await page.mouse.move(700, 420);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) await page.mouse.move(700 + i * 45, 420 + i * 4);
    await sleep(120);
    await shot(page, name);
    await page.mouse.up();
  };
  await orbit('13b-city-after-side');
  const engaged = await page.evaluate(() => window.__rb.engaged());
  check(engaged === null, `nothing holds the car after the visit (${engaged})`);
  const pose = await page.evaluate(() => {
    const v = window.__rb.state.vehicle;
    const site = window.__rb.workshop.site;
    return { d: Math.hypot(v.x - site.x, v.z - site.z), dh: Math.abs(Math.atan2(Math.sin(v.heading - site.heading), Math.cos(v.heading - site.heading))) };
  });
  check(pose.d < 0.5 && pose.dh < 0.05, `back on the ring facing the street (d ${pose.d.toFixed(2)} m, dh ${pose.dh.toFixed(3)} rad)`);
  const callsAfter = await carCalls(page);
  check(callsAfter === callsBefore, `car draw calls unchanged (${callsBefore} → ${callsAfter})`);
  const memAfter = await memory(page);
  log(`      renderer memory after: ${JSON.stringify(memAfter)}`);
  // Informational: the first visit may add a few one-off resources (the new parts' geometry, a
  // lazily made texture). The leak test is the second visit below, which must add nothing.
  log(`      first visit added ${memAfter.geometries - memBefore.geometries} geometries, ${memAfter.textures - memBefore.textures} textures`);

  // Drive off a little, and look back at the car from the chase camera.
  await page.evaluate(() => window.__rb.inject({ throttle: 0.6 }, 60));
  await sleep(1800);
  await shot(page, '14-city-driving');

  // A second visit: memory must not grow per visit.
  await page.evaluate(() => window.__rb.workshop.goToRing());
  await sleep(600);
  await page.keyboard.press('KeyF');
  await waitFor(page, () => window.__rb.workshop.status().showroom, 20000);
  await sleep(800);
  await key(page, 'KeyX');
  await waitFor(page, () => window.__rb.workshop.status().phase === 'closed', 10000);
  await sleep(800);
  const memAgain = await memory(page);
  log(`      renderer memory after a second visit: ${JSON.stringify(memAgain)}`);
  check(memAgain.geometries <= memAfter.geometries + 2 && memAgain.textures <= memAfter.textures + 1, 'a second visit leaves nothing behind either');

  // The save, and the reload.
  const saved = await page.evaluate(() => localStorage.getItem('rb.garage'));
  check(!!saved, `rb.garage written: ${saved}`);
  await boot(page);
  const back = await page.evaluate(() => ({ installed: window.__rb.workshop.status().installed, owned: window.__rb.workshop.status().owned, car: window.__rb.workshop.status().carLoadout }));
  check(JSON.stringify(back.installed) === JSON.stringify(installed), 'the reload wears the installed car');
  check(back.car === JSON.stringify(installed), 'the car visual after reload is the installed loadout');
  log(`      owned after reload: ${back.owned.join(', ')}`);
  await page.evaluate(() => window.__rb.workshop.goToRing());
  await sleep(1200);
  await shot(page, '15-city-after-reload');
  await orbit('15b-city-after-reload-side');
} catch (err) {
  failures++;
  console.error(err);
} finally {
  await browser.close();
}
console.log('console errors:', errors.length ? errors : 'none');
console.log(failures ? `${failures} FAILED` : 'ALL PASS');
process.exit(failures > 0 || errors.length > 0 ? 1 : 0);
