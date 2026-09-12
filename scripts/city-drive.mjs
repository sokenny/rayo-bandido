/**
 * Drive-through checks for the free-roam cities. Two shapes, picked by `--mode`:
 *
 *   --mode city   (default) Bandido Bay: the reclaimed streets. Runs the car down a list of
 *                 streets under throttle in the LIVE game and records whether anything stops
 *                 it. The reclamation adds no colliders, so the contract is simply that driving
 *                 through a reclaimed street is exactly as uneventful as driving through a
 *                 clean one.
 *   --mode stack  The Stack (`docs/CITY_V2_BRIEF.md`, Phase 1 gate): follows a ROUTE through
 *                 every level — street, deck, spine, ring and back down — stage by stage, with
 *                 the real simulation (`stepGame` at 120 Hz, the real layout, the real surface
 *                 field) run inside the page from the same modules the game is built from, as
 *                 `scripts/megacity-check.mjs` did for the district. Traffic is taken out for
 *                 the traversal, so a collision can only be the road's fault: a rail, a pillar,
 *                 a building, a merge that is not a merge. Reports every stage's distance,
 *                 height at the end and how far the car strayed from the centreline.
 *
 * Usage: node scripts/city-drive.mjs [--mode city|stack] [--url ...] [--headed]
 *
 * `&solo=1` is on the city URL on purpose: the open world is a server now, and a capture that
 * joined the live city would have other people's cars driving through it.
 */
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const args = process.argv.slice(2);
const getArg = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const mode = getArg('--mode', 'city');
const url = getArg('--url', `http://127.0.0.1:5173/?mode=${mode}&solo=1&debug=1&intro=0`);
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

/**
 * The Stack's route: each stage is a ribbon and the direction to follow it in (+1 along its
 * samples, -1 against them; a ramp against its samples is the other direction's exit). A stage
 * ends where the next stage's road begins — the projection of its entry point onto this one —
 * so the car changes road exactly where the ramp merges.
 *
 *   L0 st-west north → w-up-01 → L1 deck clockwise (a full lap: the up-ramp is behind the
 *   merge) → w-up-12 → L2 spine clockwise → ring-up → L3 ring clockwise → ring-down → L2 spine
 *   clockwise → e-up-12 backwards → L1 deck clockwise → s-up-01 backwards → L0 the sweeper,
 *   westbound.
 *
 * Every hand-off is tangential: no U-turn anywhere. Coming off the spine clockwise lands the
 * car on the deck clockwise (south down the east leg), and the deck's clockwise exit to the
 * street is the south ramp driven backwards, not the east on-ramp (which leaves the deck
 * heading north).
 */
const STACK_ROUTE = {
  start: { x: -252, z: 250, heading: 0 },
  stages: [
    { tag: 'st-west', dir: -1 },
    { tag: 'w-up-01', dir: 1 },
    { tag: 'deck', dir: 1 },
    { tag: 'w-up-12', dir: 1 },
    { tag: 'spine', dir: 1 },
    { tag: 'ring-up', dir: 1 },
    { tag: 'ring', dir: 1 },
    { tag: 'ring-down', dir: 1 },
    { tag: 'spine', dir: 1 },
    { tag: 'e-up-12', dir: -1 },
    { tag: 'deck', dir: 1 },
    { tag: 's-up-01', dir: -1 },
    { tag: 'av-sweeper', dir: -1, run: 80 },
  ],
};

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

  if (mode === 'stack') {
    bad += await driveRoute(page, STACK_ROUTE);
  } else {
    bad += await straightRuns(page);
  }
} finally {
  await browser.close();
}
console.log('console errors:', errors.length ? errors : 'none');
process.exit(bad > 0 || errors.length > 0 ? 1 : 0);

/* ------------------------------------------------------------------ the city: straight runs */

async function straightRuns(page) {
  let failed = 0;
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
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${run.name}: ${travelled.toFixed(0)} m travelled`);
  }
  await page.evaluate(() => {
    window.__rb.command.throttle = 0;
  });
  return failed;
}

/* ------------------------------------------------------------------ the stack: a route */

async function driveRoute(page, route) {
  const result = await page.evaluate(async (route) => {
    const { createCityWorld } = await import('/src/world/cityWorld.ts');
    const { STACK_SPEC } = await import('/src/world/stackSpec.ts');
    const { createInitialGameState, stepGame } = await import('/src/sim/gameState.ts');
    const { createPlayerCommand } = await import('/src/core/input/keyboard.ts');
    const { createProjection, projectOntoPath, pointAtStation } = await import('/src/world/track.ts');
    const { layout, plan } = createCityWorld(STACK_SPEC);
    // The traversal is about the roads: no traffic to meet, so a collision is the road's.
    layout.targetSpawns = [];
    layout.targetPatrols = [];
    layout.busRoutes = [];
    layout.walls = layout.walls.filter((w) => w.tag !== 'bus');
    const state = createInitialGameState(layout);
    const v = state.vehicle;
    const command = createPlayerCommand();
    const p = createProjection();
    const aim = createProjection();
    const ribbon = (tag) => {
      const rb = plan.ribbons.find((r) => r.tag === tag);
      if (!rb) throw new Error(`no ribbon ${tag}`);
      return rb.path;
    };
    Object.assign(v, { x: route.start.x, z: route.start.z, prevX: route.start.x, prevZ: route.start.z, y: 0, prevY: 0, heading: route.start.heading, prevHeading: route.start.heading, vx: 0, vz: 0, speed: 0 });
    let collisions = 0;
    const stages = [];
    for (let k = 0; k < route.stages.length; k++) {
      const stage = route.stages[k];
      const path = ribbon(stage.tag);
      const dir = stage.dir;
      const next = route.stages[k + 1];
      // Where this stage ends: at the point the next road is entered from this one, or after
      // a fixed run when it is the last. When the next road is a ramp that starts on this one,
      // that is the ramp's entry end; otherwise this road is a ramp ending inside the next,
      // and the hand-off is this path's own far end.
      projectOntoPath(path, v.x, v.z, p);
      const startS = p.s;
      let need;
      if (next) {
        const np = ribbon(next.tag);
        const rampEnd = next.dir > 0 ? np.samples[0] : np.samples[np.samples.length - 1];
        projectOntoPath(path, rampEnd.x, rampEnd.z, aim);
        const entry = aim.dist <= aim.halfWidth + 1 ? rampEnd : dir > 0 ? path.samples[path.samples.length - 1] : path.samples[0];
        projectOntoPath(path, entry.x, entry.z, aim);
        need = dir > 0 ? aim.s - startS : startS - aim.s;
        if (path.closed) need = ((need % path.length) + path.length) % path.length;
      } else {
        need = stage.run ?? 100;
      }
      let travelled = 0;
      let last = startS;
      let done = false;
      let maxError = 0;
      const hits = [];
      const before = collisions;
      for (let tick = 0; tick < 120 * 400; tick++) {
        projectOntoPath(path, v.x, v.z, p);
        let ds = p.s - last;
        if (path.closed && ds < -path.length / 2) ds += path.length;
        if (path.closed && ds > path.length / 2) ds -= path.length;
        travelled += ds * dir;
        last = p.s;
        if (travelled >= need - 3) {
          done = true;
          break;
        }
        pointAtStation(path, p.s + dir * 9, aim);
        const angle = Math.atan2(aim.x - v.x, -(aim.z - v.z));
        const error = Math.atan2(Math.sin(angle - v.heading), Math.cos(angle - v.heading));
        command.steer = Math.max(-1, Math.min(1, error * 1.8 - v.yawRate * 0.28));
        command.throttle = v.speed < 13 ? 0.8 : 0;
        command.brake = v.speed > 16 ? 0.3 : 0;
        stepGame(state, command, layout, 1 / 120, { respawnTraffic: false });
        if (state.events.some((e) => e.type === 'collision')) {
          collisions++;
          if (hits.length < 4) hits.push(`(${v.x.toFixed(0)}, ${v.y.toFixed(1)}, ${v.z.toFixed(0)})`);
        }
        maxError = Math.max(maxError, p.dist);
      }
      stages.push({ name: `${stage.tag}${dir < 0 ? ' (reversed)' : ''}`, done, travelled: Math.round(travelled), need: Math.round(need), x: Math.round(v.x), z: Math.round(v.z), y: +v.y.toFixed(2), maxError: +maxError.toFixed(2), collisions: collisions - before, hits });
      if (!done) break;
    }
    return { stages, collisions };
  }, route);
  let failed = 0;
  for (const s of result.stages) {
    const ok = s.done && s.collisions === 0;
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${s.name.padEnd(20)} ${String(s.travelled).padStart(5)} m of ${String(s.need).padStart(5)}  ends (${s.x}, ${s.z}) y ${s.y}  off-centre max ${s.maxError} m  collisions ${s.collisions}${s.hits.length ? ' at ' + s.hits.join(' ') : ''}`);
  }
  if (result.stages.length < route.stages.length) {
    failed++;
    console.log(`FAIL  stopped after ${result.stages.length} of ${route.stages.length} stages`);
  }
  console.log(`collisions over the whole route: ${result.collisions}`);
  return failed;
}
