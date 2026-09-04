/**
 * Automated multiplayer QA for Rayo Bandido: two real browsers race each other.
 *
 * Starts a private match server on a free port, launches two headless Chrome instances (two
 * PROCESSES, not two tabs — a background tab stops animating, and a stopped client is not a
 * client), walks both through the lobby, lets the host start the race, puts both cars on
 * cruise control and then measures what the two screens disagree about:
 *
 *   - traffic: distance between the host's copy of every electric car and the other client's
 *     copy, sampled at the same instant; whether any electric car is off the circuit or
 *     inside a building; how much the non-host's cars wobble;
 *   - rivals: the per-frame movement of the rival car as the non-host draws it — a smooth
 *     rival advances by about the same amount every frame, a stuttering one alternates
 *     between big and small steps;
 *   - colours: whether each player is painted the same colour on both screens.
 *
 * `--lag ms` puts a relay between the second browser and the server that delays every frame
 * by that much each way (plus `--jitter ms` of random extra), so the numbers describe a real
 * connection rather than two windows a millisecond apart.
 *
 * `--chaos` makes the two cars misbehave the way players do: a third of the way in, each in
 * turn is dropped behind the nearest electric car and driven into it flat out, and both fire
 * lightning whenever they have a lock. That exercises the shoves and the kills that the two
 * screens have to agree about, and the report then also counts FLICKER — a car that one
 * screen shows destroyed, alive and destroyed again within a couple of seconds.
 *
 * Usage:  node scripts/qa-mp.mjs [--url http://127.0.0.1:5173] [--lag 80] [--jitter 20]
 *                                [--seconds 25] [--chaos] [--headed] [--out artifacts]
 * Requires the dev server (npm run dev) or preview server to be running at --url.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { WebSocket, WebSocketServer } from 'ws';

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const baseUrl = getArg('--url', 'http://127.0.0.1:5173').replace(/\/$/, '');
const lag = Number(getArg('--lag', '0'));
const jitter = Number(getArg('--jitter', '0'));
const seconds = Number(getArg('--seconds', '25'));
const outDir = getArg('--out', 'artifacts');
const headed = args.includes('--headed');
const chaos = args.includes('--chaos');

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ENTRY = join(ROOT, 'server', 'index.mjs');

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------- match server */

function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [ENTRY, '--port', '0'], { cwd: ROOT });
    const timer = setTimeout(() => reject(new Error('the match server did not start in time')), 10_000);
    child.stdout.on('data', (chunk) => {
      const match = /http:\/\/127\.0\.0\.1:(\d+)/.exec(chunk.toString());
      if (match) {
        clearTimeout(timer);
        resolve({ child, port: Number(match[1]) });
      }
    });
    child.stderr.on('data', (chunk) => process.stderr.write(`[server] ${chunk}`));
    child.on('error', reject);
  });
}

/**
 * A delaying relay: every frame in either direction is held for `lag` ms (+ up to `jitter`).
 * Order is preserved by scheduling each frame no earlier than the previous one, the way a
 * real link reorders nothing but stretches everything.
 */
function startLagProxy(targetPort) {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0, path: '/ws' });
    wss.on('connection', (client) => {
      const upstream = new WebSocket(`ws://127.0.0.1:${targetPort}/ws`);
      const queue = [];
      let lastUp = 0;
      let lastDown = 0;
      const delay = () => lag + Math.random() * jitter;
      const schedule = (dir, fn) => {
        const at = Math.max(Date.now() + delay(), dir === 'up' ? lastUp : lastDown);
        if (dir === 'up') lastUp = at;
        else lastDown = at;
        setTimeout(fn, Math.max(0, at - Date.now()));
      };
      client.on('message', (data) => {
        const text = data.toString();
        schedule('up', () => {
          if (upstream.readyState === WebSocket.OPEN) upstream.send(text);
          else queue.push(text);
        });
      });
      upstream.on('open', () => {
        for (const text of queue) upstream.send(text);
        queue.length = 0;
      });
      upstream.on('message', (data) => {
        const text = data.toString();
        schedule('down', () => {
          if (client.readyState === WebSocket.OPEN) client.send(text);
        });
      });
      client.on('close', () => upstream.close());
      upstream.on('close', () => client.close());
      upstream.on('error', () => client.close());
    });
    wss.on('listening', () => resolve({ wss, port: wss.address().port }));
  });
}

/* ------------------------------------------------------------------ browser */

async function launch() {
  return puppeteer.launch({
    executablePath,
    headless: headed ? false : 'new',
    args: [
      '--window-size=1280,800',
      '--ignore-gpu-blocklist',
      '--enable-gpu-rasterization',
      '--use-angle=default',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
    ],
    defaultViewport: { width: 1280, height: 720 },
  });
}

/**
 * Both browsers meet in one room. `&create=1` alongside `&room=` means "join this code, open
 * it if it is not there yet", so the two pages can be started in either order without either
 * having to read the other's screen for a code.
 */
const QA_ROOM = 'QA77';

async function openLobby(browser, name, wsPort) {
  const page = await browser.newPage();
  page.on('pageerror', (err) => console.error(`[${name}] page error: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.error(`[${name}] console: ${msg.text()}`);
  });
  // `listed=0` keeps the probe's room out of the public list, the way it has always been: the
  // QA server is private anyway, and the list is not what this harness is measuring.
  const url =
    `${baseUrl}/?mp=1&room=${QA_ROOM}&create=1&label=QA&listed=0&debug=1` +
    `&server=${encodeURIComponent(`ws://127.0.0.1:${wsPort}/ws`)}`;
  await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
  await page.waitForSelector('[data-role="ready"]', { timeout: 15_000 });
  // Connected: the status line stops saying CONNECTING.
  await page.waitForFunction(
    () => !/CONNECTING/.test(document.querySelector('[data-role="status"]')?.textContent || ''),
    { timeout: 15_000 },
  );
  await page.evaluate((n) => {
    const input = document.querySelector('[data-role="name"]');
    input.value = n;
    input.dispatchEvent(new Event('change'));
  }, name);
  return page;
}

async function waitForRacing(page, label) {
  await page.waitForFunction(() => typeof window.__rb !== 'undefined' && window.__rb.multiplayer, { timeout: 60_000 });
  await page.waitForFunction(() => window.__rb.ready && window.__rb.ready(), { timeout: 60_000 });
  await page.waitForFunction(() => window.__rb.state.race && window.__rb.state.race.phase === 'racing', { timeout: 60_000 });
  console.log(`  ${label}: racing`);
}

/** Everything the report needs, read in one evaluate so it is one instant of that client. */
const SNAPSHOT = () => {
  const rb = window.__rb;
  const s = rb.state;
  const layout = rb.layout;
  const bb = layout.minimap.bounds;
  const insideBox = (x, z) => {
    for (const b of layout.colliders) {
      if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ) return true;
    }
    return false;
  };
  return {
    now: performance.now(),
    time: s.time,
    phase: s.race ? s.race.phase : 'none',
    lap: s.race ? s.race.lap : 0,
    vehicle: { x: s.vehicle.x, z: s.vehicle.z, heading: s.vehicle.heading, speed: s.vehicle.speed },
    targets: s.targets.map((t) => ({
      x: t.x,
      z: t.z,
      heading: t.heading,
      status: t.status,
      patrolIndex: t.patrolIndex,
      offMap: t.x < bb.minX || t.x > bb.maxX || t.z < bb.minZ || t.z > bb.maxZ,
      inBuilding: insideBox(t.x, t.z),
    })),
    rivals: rb.rivals.map((r) => ({ id: r.id, slot: r.slot, present: r.present, x: r.x, z: r.z, speed: r.speed })),
    selfSlot: rb.selfSlot ?? null,
    selfColour: rb.selfColour ?? null,
    rivalColours: rb.rivalColours ?? null,
    frames: window.__rbFrames ? window.__rbFrames.splice(0) : [],
  };
};

/** Drop the car a few lengths behind the nearest electric car, pointing at it, and floor it. */
const RAM = () => {
  const rb = window.__rb;
  const v = rb.state.vehicle;
  let best = null;
  let bestD = Infinity;
  for (const t of rb.state.targets) {
    if (t.status !== 'active') continue;
    const d = Math.hypot(t.x - v.x, t.z - v.z);
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  if (!best) return -1;
  const back = 14;
  rb.teleport(best.x - Math.sin(best.heading) * back, best.z + Math.cos(best.heading) * back, best.heading);
  rb.inject({ throttle: 1, nitro: true, steer: 0 }, 150);
  return best.id;
};

/** Fire the lightning at whatever is locked, with a full charge. Returns the target hit, or -1. */
const FIRE = () => {
  const rb = window.__rb;
  const l = rb.state.lightning;
  if (l.acquiredTargetId < 0 || l.cooldown > 0) return -1;
  l.charge = 100; // plenty: the sim clamps what it spends
  rb.inject({ fire: true }, 2);
  return l.acquiredTargetId;
};

/** Record the rival's drawn position every animation frame, for the smoothness figures. */
const START_FRAME_LOG = () => {
  window.__rbFrames = [];
  const tick = (t) => {
    const r = window.__rb.rivals[0];
    if (r && r.present) window.__rbFrames.push({ t, x: r.x, z: r.z });
    if (window.__rbFrames.length < 100_000) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

/* --------------------------------------------------------------------- main */

const stats = (values) => {
  if (values.length === 0) return { n: 0, mean: 0, max: 0, p95: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  return {
    n: sorted.length,
    mean: +mean.toFixed(3),
    p95: +sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))].toFixed(3),
    max: +sorted[sorted.length - 1].toFixed(3),
  };
};

const wrap = (a) => {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
};

const { child: server, port: serverPort } = await startServer();
let proxy = null;
let clientPort = serverPort;
if (lag > 0 || jitter > 0) {
  proxy = await startLagProxy(serverPort);
  clientPort = proxy.port;
}
console.log(`match server on ${serverPort}${proxy ? `, second player through a ${lag}+${jitter} ms relay on ${clientPort}` : ''}`);

const hostBrowser = await launch();
const guestBrowser = await launch();
const report = { url: baseUrl, lag, jitter, seconds, ok: true, problems: [] };

try {
  const host = await openLobby(hostBrowser, 'HOST', serverPort);
  const guest = await openLobby(guestBrowser, 'GUEST', clientPort);
  console.log('both in the lobby');

  await host.click('[data-role="ready"]');
  await guest.click('[data-role="ready"]');
  await host.waitForFunction(() => !document.querySelector('[data-role="start"]').hidden, { timeout: 10_000 });
  await host.click('[data-role="start"]');
  console.log('host started the race');

  await Promise.all([waitForRacing(host, 'host'), waitForRacing(guest, 'guest')]);

  // Let each client name its own slot, so the colour check can be done without a GPU.
  for (const page of [host, guest]) {
    await page.evaluate(() => window.__rb.cruise(true));
    await page.evaluate(START_FRAME_LOG);
  }

  // Every 250 ms, read both screens back to back. The ~2 ms between the two reads is
  // noise against a 10 Hz traffic feed.
  const samples = [];
  const actions = [];
  const started = Date.now();
  let guestRammed = false;
  let hostRammed = false;
  let lastFire = 0;
  while (Date.now() - started < seconds * 1000) {
    const elapsed = Date.now() - started;
    if (chaos) {
      if (!guestRammed && elapsed > seconds * 333) {
        guestRammed = true;
        const id = await guest.evaluate(RAM);
        actions.push({ at: elapsed, who: 'guest', what: 'ram', target: id });
        setTimeout(() => guest.evaluate(() => window.__rb.cruise(true)).catch(() => {}), 3000);
      }
      if (!hostRammed && elapsed > seconds * 600) {
        hostRammed = true;
        const id = await host.evaluate(RAM);
        actions.push({ at: elapsed, who: 'host', what: 'ram', target: id });
        setTimeout(() => host.evaluate(() => window.__rb.cruise(true)).catch(() => {}), 3000);
      }
      if (elapsed - lastFire > 1500) {
        lastFire = elapsed;
        const [a, b] = await Promise.all([host.evaluate(FIRE), guest.evaluate(FIRE)]);
        if (a >= 0) actions.push({ at: elapsed, who: 'host', what: 'fire', target: a });
        if (b >= 0) actions.push({ at: elapsed, who: 'guest', what: 'fire', target: b });
      }
    }
    const [h, g] = await Promise.all([host.evaluate(SNAPSHOT), guest.evaluate(SNAPSHOT)]);
    samples.push({ at: elapsed, host: h, guest: g });
    await sleep(250);
  }
  report.actions = actions;

  /* ---------------------------------------------------------------- traffic */
  const trafficError = [];
  const trafficHeadingError = [];
  const patrolMismatch = [];
  const statusMismatch = [];
  let offMap = 0;
  let inBuilding = 0;
  let offMapHost = 0;
  let inBuildingHost = 0;
  const guestWobble = [];
  const hostWobble = [];
  // Status flicker: destroyed -> active -> destroyed (or the reverse) within two seconds on
  // one screen. A real respawn takes twelve, so anything faster is the two copies arguing.
  const flicker = { host: 0, guest: 0 };
  const lastChange = { host: new Map(), guest: new Map() };
  let previous = null;
  for (const s of samples) {
    const n = Math.min(s.host.targets.length, s.guest.targets.length);
    let mismatch = 0;
    let statusDiff = 0;
    for (let i = 0; i < n; i++) {
      const a = s.host.targets[i];
      const b = s.guest.targets[i];
      if (b.offMap) offMap++;
      if (b.inBuilding) inBuilding++;
      if (a.offMap) offMapHost++;
      if (a.inBuilding) inBuildingHost++;
      if (a.status !== b.status) statusDiff++;
      if (previous) {
        for (const side of ['host', 'guest']) {
          const now = s[side].targets[i].status;
          const was = previous[side].targets[i].status;
          if (now === was) continue;
          const last = lastChange[side].get(i);
          if (last !== undefined && s.at - last < 2000) flicker[side]++;
          lastChange[side].set(i, s.at);
        }
      }
      if (a.status !== 'active' || b.status !== 'active') continue;
      trafficError.push(Math.hypot(a.x - b.x, a.z - b.z));
      trafficHeadingError.push(Math.abs(wrap(a.heading - b.heading)));
      // One waypoint apart is a report from the past; more is two different patrols.
      if (Math.abs(a.patrolIndex - b.patrolIndex) > 1) mismatch++;
      if (previous) {
        const pa = previous.host.targets[i];
        const pb = previous.guest.targets[i];
        if (pa.status === 'active' && pb.status === 'active') {
          // Heading change per sample, host vs guest: a car being fought over turns more.
          hostWobble.push(Math.abs(wrap(a.heading - pa.heading)));
          guestWobble.push(Math.abs(wrap(b.heading - pb.heading)));
        }
      }
    }
    patrolMismatch.push(mismatch);
    statusMismatch.push(statusDiff);
    previous = s;
  }
  report.traffic = {
    positionError: stats(trafficError),
    headingError: stats(trafficHeadingError),
    patrolIndexMismatches: stats(patrolMismatch),
    statusMismatches: stats(statusMismatch),
    guestOffMapSamples: offMap,
    guestInBuildingSamples: inBuilding,
    hostOffMapSamples: offMapHost,
    hostInBuildingSamples: inBuildingHost,
    turnPerSample: { host: stats(hostWobble), guest: stats(guestWobble) },
    flicker,
  };

  /* ----------------------------------------------------------------- rivals */
  const smoothness = (side) => {
    const frames = samples.flatMap((s) => s[side].frames);
    const steps = [];
    for (let i = 1; i < frames.length; i++) {
      const a = frames[i - 1];
      const b = frames[i];
      const dt = (b.t - a.t) / 1000;
      if (dt <= 0 || dt > 0.1) continue;
      steps.push(Math.hypot(b.x - a.x, b.z - a.z) / dt);
    }
    // How uneven consecutive per-frame speeds are: 0 is perfectly smooth.
    const jumps = [];
    for (let i = 1; i < steps.length; i++) jumps.push(Math.abs(steps[i] - steps[i - 1]));
    const stalls = steps.filter((v) => v < 0.5).length;
    return { frames: frames.length, apparentSpeed: stats(steps), speedJumpBetweenFrames: stats(jumps), stalledFrames: stalls };
  };
  report.rivals = { asGuestSeesHost: smoothness('guest'), asHostSeesGuest: smoothness('host') };

  /* ---------------------------------------------------------------- colours */
  const last = samples[samples.length - 1];
  report.colours = {
    host: { selfSlot: last.host.selfSlot, selfColour: last.host.selfColour, rivals: last.host.rivalColours },
    guest: { selfSlot: last.guest.selfSlot, selfColour: last.guest.selfColour, rivals: last.guest.rivalColours },
  };
  const hostSeesGuestAs = last.host.rivalColours?.[0]?.colour ?? null;
  const guestSeesHostAs = last.guest.rivalColours?.[0]?.colour ?? null;
  report.colours.consistent =
    last.host.selfColour !== null &&
    last.guest.selfColour !== null &&
    last.host.selfColour === guestSeesHostAs &&
    last.guest.selfColour === hostSeesGuestAs;

  /* ---------------------------------------------------------------- verdict */
  const t = report.traffic;
  if (t.positionError.p95 > 1.5) report.problems.push(`traffic disagrees by ${t.positionError.p95} m (p95)`);
  if (t.guestOffMapSamples > 0 || t.hostOffMapSamples > 0) report.problems.push('an electric car left the circuit');
  if (t.guestInBuildingSamples > 0 || t.hostInBuildingSamples > 0) report.problems.push('an electric car was inside a building');
  if (t.patrolIndexMismatches.max > 0) report.problems.push('patrol progress disagreed between screens');
  if (t.flicker.host > 0 || t.flicker.guest > 0) report.problems.push('an electric car flickered between destroyed and alive');
  if (t.statusMismatches.mean > 0.5) report.problems.push('the screens kept disagreeing about which cars are destroyed');
  if (t.turnPerSample.guest.mean > t.turnPerSample.host.mean * 1.5 + 0.02) report.problems.push('non-host traffic wobbles');
  const r = report.rivals.asGuestSeesHost;
  if (r.stalledFrames > r.frames * 0.05) report.problems.push('the rival car stalls between frames');
  if (!report.colours.consistent) report.problems.push('players are not the same colour on both screens');
  report.ok = report.problems.length === 0;

  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, `qa-mp${lag ? `-lag${lag}` : ''}${chaos ? '-chaos' : ''}.json`);
  writeFileSync(file, JSON.stringify(report, null, 2));
  await host.screenshot({ path: join(outDir, 'qa-mp-host.png') }).catch(() => {});
  await guest.screenshot({ path: join(outDir, 'qa-mp-guest.png') }).catch(() => {});

  console.log('\ntraffic (host copy vs guest copy)');
  console.log(`  position error m   mean ${t.positionError.mean}  p95 ${t.positionError.p95}  max ${t.positionError.max}  (${t.positionError.n} pairs)`);
  console.log(`  heading error rad  mean ${t.headingError.mean}  p95 ${t.headingError.p95}  max ${t.headingError.max}`);
  console.log(`  patrol index mismatches per sample  mean ${t.patrolIndexMismatches.mean}  max ${t.patrolIndexMismatches.max}`);
  console.log(`  status mismatches per sample        mean ${t.statusMismatches.mean}  max ${t.statusMismatches.max}`);
  console.log(`  turn per sample rad  host ${t.turnPerSample.host.mean}  guest ${t.turnPerSample.guest.mean}`);
  console.log(`  off the circuit: host ${t.hostOffMapSamples}, guest ${t.guestOffMapSamples}   inside a building: host ${t.hostInBuildingSamples}, guest ${t.guestInBuildingSamples}`);
  console.log(`  status flicker: host ${t.flicker.host}, guest ${t.flicker.guest}`);
  if (chaos) console.log(`  actions: ${actions.map((a) => `${a.who} ${a.what} #${a.target} @${(a.at / 1000).toFixed(1)}s`).join(', ') || 'none'}`);
  console.log('rival as the guest draws the host');
  console.log(`  frames ${r.frames}  apparent speed mean ${r.apparentSpeed.mean} m/s  speed jump between frames mean ${r.speedJumpBetweenFrames.mean} p95 ${r.speedJumpBetweenFrames.p95} max ${r.speedJumpBetweenFrames.max}  stalled ${r.stalledFrames}`);
  const r2 = report.rivals.asHostSeesGuest;
  console.log(`  (host drawing guest: speed jump mean ${r2.speedJumpBetweenFrames.mean} p95 ${r2.speedJumpBetweenFrames.p95} stalled ${r2.stalledFrames})`);
  console.log('colours');
  console.log(`  host is slot ${last.host.selfSlot} painted ${last.host.selfColour}; guest sees host as ${guestSeesHostAs}`);
  console.log(`  guest is slot ${last.guest.selfSlot} painted ${last.guest.selfColour}; host sees guest as ${hostSeesGuestAs}`);
  console.log(`\n${report.ok ? 'OK' : 'PROBLEMS'}${report.problems.length ? ': ' + report.problems.join('; ') : ''}`);
  console.log(`report: ${file}`);
} catch (err) {
  console.error(err);
  report.ok = false;
  report.problems.push(String(err));
} finally {
  await hostBrowser.close().catch(() => {});
  await guestBrowser.close().catch(() => {});
  proxy?.wss.close();
  server.kill();
}
process.exit(report.ok ? 0 : 1);
