/**
 * Automated browser QA for Rayo Bandido.
 *
 * Launches the locally installed Chrome or Edge with puppeteer-core (no browser download),
 * loads the running dev server, drives the car through the whole loop using the
 * `window.__rb.inject` automation hook, saves screenshots into artifacts/ and writes
 * artifacts/qa-metrics.json with FPS, draw calls, triangles and the gameplay checks.
 *
 * Usage:  node scripts/qa-drive.mjs [--url http://127.0.0.1:5173/] [--headed] [--out artifacts]
 * Requires the dev server (npm run dev) or preview server to be running.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const url = getArg('--url', 'http://127.0.0.1:5173/?debug=1');
const outDir = getArg('--out', 'artifacts');
const headed = args.includes('--headed');

const candidates = [
  process.env.RB_BROWSER,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);
const executablePath = candidates.find((p) => existsSync(p));
if (!executablePath) {
  console.error('No Chrome/Edge found. Set RB_BROWSER to a Chromium executable.');
  process.exit(2);
}

mkdirSync(outDir, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = { url, executablePath, headed, checks: {}, metrics: {}, screenshots: [] };

const browser = await puppeteer.launch({
  executablePath,
  headless: headed ? false : 'new',
  args: [
    '--window-size=1600,960',
    '--ignore-gpu-blocklist',
    '--enable-gpu-rasterization',
    '--use-angle=default',
    '--disable-frame-rate-limit=false',
    '--autoplay-policy=no-user-gesture-required',
  ],
  defaultViewport: { width: 1600, height: 900 },
});

try {
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));

  await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => typeof window.__rb !== 'undefined', { timeout: 15000 });
  // The loading screen warms the GPU before the loop starts; drive only once it is running.
  await page.waitForFunction(() => !window.__rb.ready || window.__rb.ready(), { timeout: 30000 });
  await page.click('#game-canvas').catch(() => {});
  await sleep(800);

  const shot = async (name) => {
    const file = join(outDir, name);
    await page.screenshot({ path: file, type: 'png' });
    results.screenshots.push(file);
    console.log('screenshot', file);
  };
  const read = () =>
    page.evaluate(() => {
      const s = window.__rb.state;
      const v = s.vehicle;
      const m = window.__rb.metrics;
      return {
        x: v.x,
        z: v.z,
        speedKmh: v.speed * 3.6,
        slipDeg: (v.slipAngle * 180) / Math.PI,
        drifting: s.drift.active,
        driftDuration: s.drift.duration,
        chain: s.drift.chain,
        charge: s.lightning.charge,
        nitro: s.nitro.amount,
        nitroActive: s.nitro.active,
        acquired: s.lightning.acquiredTargetId,
        money: s.economy.money,
        destroyed: s.economy.destroyed,
        activeTargets: s.targets.filter((t) => t.status === 'active').length,
        time: s.time,
        fps: m.fps,
        frameMs: m.frameMs,
        drawCalls: m.drawCalls,
        triangles: m.triangles,
      };
    });
  const inject = (partial, ticks) => page.evaluate((p, t) => window.__rb.inject(p, t), partial, ticks);
  /** Wait until every injected tick has been consumed by the simulation. */
  const waitIdle = async (timeoutMs = 20000) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const pending = await page.evaluate(() => (window.__rb.pending ? window.__rb.pending() : 0));
      if (pending <= 0) return;
      await sleep(100);
    }
  };

  // 1. Spawn.
  await shot('01-spawn.png');
  const spawn = await read();
  results.checks.spawnFullNitro = spawn.nitro >= 99;
  results.checks.spawnZeroCharge = spawn.charge === 0;
  results.checks.atLeastThreeTargets = spawn.activeTargets >= 3;

  // 2. Straight driving with metrics sampling.
  await inject({ throttle: 1 }, 240);
  const samples = [];
  for (let i = 0; i < 8; i++) {
    await sleep(500);
    samples.push(await read());
  }
  const driving = samples[samples.length - 1];
  // The 240 injected ticks end at 4.0 s of sim time, right around the last sample; judge the
  // acceleration on the fastest sample rather than on whichever side of the cut-off it lands.
  results.checks.accelerates = Math.max(...samples.map((s) => s.speedKmh)) > 60;
  results.checks.noChargeWithoutDrift = driving.charge === 0;
  await shot('02-driving.png');

  // 3. Drift: brake down to a cornering speed, handbrake kick, then hold throttle + steer.
  await waitIdle();
  await inject({ brake: 1 }, 40);
  await inject({ throttle: 1, steer: 1, handbrake: true }, 12);
  await inject({ throttle: 1, steer: 1 }, 150);
  let drifted = false;
  let maxSlip = 0;
  let chargeAfterDrift = 0;
  let driftSamples = 0;
  for (let i = 0; i < 8; i++) {
    await sleep(400);
    const r = await read();
    if (r.drifting) {
      drifted = true;
      driftSamples++;
    }
    maxSlip = Math.max(maxSlip, Math.abs(r.slipDeg));
    chargeAfterDrift = Math.max(chargeAfterDrift, r.charge);
    if (i === 2) await shot('03-drift.png');
  }
  await waitIdle();
  results.checks.driftActivates = drifted;
  results.checks.chargeFromDrift = chargeAfterDrift > 0;
  results.metrics.maxSlipDeg = maxSlip;
  results.metrics.driftSamples = driftSamples;
  results.metrics.chargeAfterDrift = chargeAfterDrift;

  // 4. Nitro.
  // Keep the car moving after the boost so recharge (which requires motion) can be observed.
  await inject({ throttle: 1, nitro: true }, 90);
  await sleep(1000);
  const nitroState = await read();
  results.checks.nitroDrains = nitroState.nitro < spawn.nitro;
  results.checks.nitroBoostsSpeed = nitroState.nitroActive || nitroState.speedKmh > 60;
  await shot('04-nitro.png');
  await waitIdle();
  await inject({ throttle: 1, steer: -0.5 }, 240);
  await sleep(3200);
  const afterNitro = await read();
  results.checks.nitroRecharges = afterNitro.nitro > nitroState.nitro;
  await waitIdle();
  results.metrics.nitroAfterBoost = nitroState.nitro;
  results.metrics.nitroAfterRecharge = afterNitro.nitro;

  // 5. Lightning: line up with the nearest active target (QA teleport), earn charge if needed, fire.
  const target = await page.evaluate(() => {
    const s = window.__rb.state;
    const t = s.targets.find((x) => x.status === 'active');
    if (!t) return null;
    const v = s.vehicle;
    // QA teleport: put the car in the open plaza facing -Z and park the target 24 m ahead.
    v.x = 0;
    v.z = 22;
    v.heading = 0;
    v.prevX = v.x;
    v.prevZ = v.z;
    v.prevHeading = 0;
    v.vx = 0;
    v.vz = 0;
    v.speed = 0;
    v.lateralSpeed = 0;
    t.x = 0;
    t.z = -2;
    t.prevX = t.x;
    t.prevZ = t.z;
    t.heading = Math.PI;
    t.patrolSpeed = 0;
    return { id: t.id, x: t.x, z: t.z };
  });
  results.checks.targetAvailable = !!target;
  const before = await read();
  if (before.charge < 50) {
    // Not enough charge earned by the scripted drift: grant it and record that fact honestly.
    results.checks.chargeGrantedForQa = true;
    await page.evaluate(() => {
      window.__rb.state.lightning.charge = 100;
    });
  } else {
    results.checks.chargeGrantedForQa = false;
  }
  await sleep(400);
  const locked = await read();
  results.checks.targetAcquiredInCone = locked.acquired >= 0;
  const moneyBefore = locked.money;
  const chargeBefore = locked.charge;
  await inject({ fire: true }, 1);
  await sleep(40);
  await shot('05-lightning.png');
  await sleep(600);
  const afterFire = await read();
  results.checks.fireConsumesCharge = afterFire.charge < chargeBefore;
  results.checks.moneyIncreases = afterFire.money > moneyBefore;
  results.checks.destroyedIncrements = afterFire.destroyed === locked.destroyed + 1;
  await shot('06-destroyed.png');
  // Fire again immediately: must not double-pay for the same target.
  await inject({ fire: true }, 1);
  await sleep(300);
  const afterSecond = await read();
  results.checks.noDuplicateReward = afterSecond.destroyed <= afterFire.destroyed + 1 && afterSecond.money <= afterFire.money + 100;

  // 6. Restart.
  await inject({ restart: true }, 1);
  await sleep(300);
  const restarted = await read();
  results.checks.restartResets =
    restarted.money === 0 && restarted.charge === 0 && restarted.activeTargets >= 3 && Math.abs(restarted.speedKmh) < 1;
  await shot('07-restart.png');

  // 7. Sustained stress: drift and fire repeatedly for ~20 s, then check responsiveness.
  const stressStart = await read();
  for (let i = 0; i < 6; i++) {
    await inject({ throttle: 1, steer: i % 2 ? 1 : -1, handbrake: true }, 12);
    await inject({ throttle: 1, steer: i % 2 ? 1 : -1, nitro: i % 3 === 0 }, 120);
    await waitIdle();
    await page.evaluate(() => {
      window.__rb.state.lightning.charge = 100;
    });
    await inject({ fire: true }, 1);
    await sleep(300);
  }
  const stressEnd = await read();
  results.metrics.stressSeconds = stressEnd.time - stressStart.time;
  results.metrics.fpsAfterStress = stressEnd.fps;
  results.checks.responsiveAfterStress = stressEnd.fps > 25;
  await shot('08-stress.png');

  const fpsSamples = samples.map((s) => s.fps).filter((f) => f > 0);
  results.metrics.fpsDrivingAvg = fpsSamples.length ? fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length : 0;
  results.metrics.fpsDrivingMin = fpsSamples.length ? Math.min(...fpsSamples) : 0;
  results.metrics.frameMsDriving = driving.frameMs;
  results.metrics.drawCalls = driving.drawCalls;
  results.metrics.triangles = driving.triangles;
  results.metrics.userAgent = await page.evaluate(() => navigator.userAgent);
  results.metrics.gpu = await page.evaluate(() => {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
  });
  results.consoleErrors = consoleErrors;
  results.checks.noConsoleErrors = consoleErrors.length === 0;
} finally {
  await browser.close();
}

writeFileSync(join(outDir, 'qa-metrics.json'), JSON.stringify(results, null, 2));
const failed = Object.entries(results.checks).filter(([k, v]) => v === false && k !== 'chargeGrantedForQa');
console.log('\nQA summary');
for (const [k, v] of Object.entries(results.checks)) console.log(`  ${v ? 'PASS' : 'FAIL'}  ${k}`);
console.log('\nmetrics', JSON.stringify(results.metrics, null, 2));
if (results.consoleErrors.length) console.log('\nconsole errors:', results.consoleErrors);
process.exit(failed.length ? 1 : 0);
