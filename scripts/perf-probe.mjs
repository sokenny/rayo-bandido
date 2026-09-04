/**
 * Performance probe for Rayo Bandido.
 *
 * Launches the locally installed Chrome/Edge with puppeteer-core, loads the running dev (or
 * preview) server and records what actually matters for smoothness:
 *
 *   - startup: how long the page blocks before the first frame, and every long task on the way,
 *   - first-time hitches: the worst frame while each effect appears for the first time
 *     (driving, drift smoke + skid marks, nitro flames + speed blur, lightning, explosion, restart),
 *   - shader programs compiled at each stage (a jump inside a phase is a mid-play compile stall),
 *   - steady-state frame time and draw calls.
 *
 * Every frame from the very first `requestAnimationFrame` is recorded via a hook installed
 * before the game script runs, so the startup frames are not missed.
 *
 * Usage:  node scripts/perf-probe.mjs [--mode test|race] [--url http://127.0.0.1:5173/?mode=test] [--headed] [--out artifacts/perf.json]
 * Requires the dev server (npm run dev) or the preview server (npm run preview) to be running.
 *
 * PERF GATE:  node scripts/perf-probe.mjs --check [--runs 2]   (or `npm run perf:check`)
 * Probes the production build (starts `vite preview` itself if nothing answers on 4173) and
 * fails on regressions that do not depend on how fast the machine is - see `CHECKS` below:
 * a shader compiled mid-play, a frame over 33 ms while an effect first appears, the draw-call
 * and triangle budgets, main-thread cost per frame, console errors. Deterministic checks
 * (program count, budgets, errors) must hold in every run; timing checks only fail when they
 * fail in every run, so a one-off OS hiccup cannot fail the gate on its own.
 *
 * Headless Chrome is not vsync-limited, so absolute averages are headroom, not the shipped
 * frame rate. The numbers to compare between runs are the worst frames and the long tasks.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const check = args.includes('--check');
const mode = getArg('--mode', 'test');
const url = getArg('--url', check ? `http://127.0.0.1:4173/?debug=1&mode=${mode}` : `http://127.0.0.1:5173/?debug=1&mode=${mode}`);
const outFile = getArg('--out', check ? 'artifacts/perf-check.json' : 'artifacts/perf.json');
const headed = args.includes('--headed');
const runs = Number(getArg('--runs', check ? '2' : '1'));

/**
 * The perf gate. Every threshold here is an invariant of the game, not of the machine: headless
 * Chrome is not vsync-limited and integrated GPUs differ, so absolute FPS is deliberately not
 * one of them. If a threshold has to move, say why in docs/PROGRESS.md.
 */
const CHECKS = {
  /** Phases after `idle` must compile nothing: the warm-up owns every shader. Deterministic. */
  noMidPlayCompiles: true,
  /** Worst frame allowed while an effect appears for the first time or during steady play (ms). */
  maxFrameMs: 33,
  /** AGENTS.md budgets. Deterministic. */
  maxDrawCalls: 60,
  maxTriangles: 200_000,
  /** Main-thread ms per frame (sim + render JS) in steady play. Generous: the target is ~1 ms. */
  maxCpuMs: 4,
  /** Total main-thread blocking before the first playable frame (ms). */
  maxStartupLongTaskMs: 1500,
  /** Phases the frame-time check applies to. */
  playPhases: ['drive', 'drift', 'nitro', 'lightning', 'restart', 'steady'],
};

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

/** Frame-time statistics over a slice of frame timestamps. */
function stats(times) {
  if (times.length < 2) return { frames: times.length, avgMs: 0, worstMs: 0, over20ms: 0, over33ms: 0 };
  const deltas = [];
  for (let i = 1; i < times.length; i++) deltas.push(times[i] - times[i - 1]);
  const sum = deltas.reduce((a, b) => a + b, 0);
  return {
    frames: deltas.length,
    avgMs: +(sum / deltas.length).toFixed(2),
    worstMs: +Math.max(...deltas).toFixed(1),
    over20ms: deltas.filter((d) => d > 20).length,
    over33ms: deltas.filter((d) => d > 33).length,
  };
}

async function probeOnce(browser, runIndex) {
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));

  // Installed before any page script: records every animation frame and every long task from
  // the moment the document starts, so startup is measured and not guessed.
  await page.evaluateOnNewDocument(() => {
    const perf = { frames: [], longTasks: [], t0: performance.now() };
    window.__perf = perf;
    const tick = (now) => {
      perf.frames.push(now);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    if (typeof PerformanceObserver !== 'undefined') {
      try {
        const obs = new PerformanceObserver((list) => {
          for (const e of list.getEntries()) perf.longTasks.push({ start: +e.startTime.toFixed(0), ms: +e.duration.toFixed(0) });
        });
        obs.observe({ entryTypes: ['longtask'] });
      } catch {
        /* unsupported */
      }
    }
  });

  const navStart = Date.now();
  await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => typeof window.__rb !== 'undefined', { timeout: 15000 });
  // Wait for the game to be actually running (first game frame drawn). Loading-screen builds
  // expose `__rb.ready`; older builds are ready as soon as `__rb` exists.
  await page.waitForFunction(
    () => {
      const rb = window.__rb;
      return !rb.ready || rb.ready();
    },
    { timeout: 30000 },
  );
  await page.click('#game-canvas').catch(() => {});

  const snap = () =>
    page.evaluate(() => {
      const rb = window.__rb;
      const info = rb.renderer.info;
      const m = rb.metrics || {};
      return {
        frameCount: window.__perf.frames.length,
        programs: info.programs.length,
        drawCalls: info.render.calls,
        triangles: info.render.triangles,
        textures: info.memory.textures,
        geometries: info.memory.geometries,
        time: rb.state.time,
        // Debug-overlay averages over the last 0.5 s window (0 on builds without them).
        simMs: +(m.simMs || 0).toFixed(2),
        renderMs: +(m.renderMs || 0).toFixed(2),
        gpuMs: +(m.gpuMs || 0).toFixed(2),
        pixelRatio: m.pixelRatio || rb.renderer.getPixelRatio(),
      };
    });
  const frames = (from, to) => page.evaluate((a, b) => window.__perf.frames.slice(a, b), from, to);
  const inject = (partial, ticks) => page.evaluate((p, t) => window.__rb.inject(p, t), partial, ticks);
  const waitIdle = async (timeoutMs = 20000) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const pending = await page.evaluate(() => (window.__rb.pending ? window.__rb.pending() : 0));
      if (pending <= 0) return;
      await sleep(50);
    }
  };

  const result = { run: runIndex, phases: {}, startup: {}, consoleErrors };

  /** Run one phase: snapshot, act, wait, snapshot; report frames and compiled programs. */
  const phase = async (name, act, settleMs) => {
    const before = await snap();
    await act();
    await waitIdle();
    await sleep(settleMs);
    const after = await snap();
    const slice = await frames(before.frameCount, after.frameCount);
    const s = stats(slice);
    result.phases[name] = {
      ...s,
      programsBefore: before.programs,
      programsAfter: after.programs,
      newPrograms: after.programs - before.programs,
      drawCalls: after.drawCalls,
      triangles: after.triangles,
      simMs: after.simMs,
      renderMs: after.renderMs,
      gpuMs: after.gpuMs,
      pixelRatio: after.pixelRatio,
    };
    console.log(
      `${name.padEnd(12)} frames ${String(s.frames).padStart(4)}  avg ${String(s.avgMs).padStart(6)} ms  worst ${String(s.worstMs).padStart(6)} ms  >20ms ${String(s.over20ms).padStart(3)}  programs ${before.programs} -> ${after.programs}  draws ${after.drawCalls}  cpu ${after.simMs}+${after.renderMs} ms  gpu ${after.gpuMs} ms  scale ${after.pixelRatio}`,
    );
  };

  // Startup: time to the first frame after the game script ran, and long tasks so far.
  const startup = await page.evaluate(() => {
    const p = window.__perf;
    const nav = performance.getEntriesByType('navigation')[0];
    const marks = {};
    for (const m of performance.getEntriesByType('mark')) marks[m.name] = +m.startTime.toFixed(0);
    const measures = {};
    for (const m of performance.getEntriesByType('measure')) measures[m.name] = +m.duration.toFixed(0);
    return {
      domContentLoadedMs: nav ? +nav.domContentLoadedEventEnd.toFixed(0) : 0,
      loadMs: nav ? +nav.loadEventEnd.toFixed(0) : 0,
      firstFrameMs: p.frames.length ? +p.frames[0].toFixed(0) : 0,
      longTasks: p.longTasks,
      longTaskTotalMs: p.longTasks.reduce((a, t) => a + t.ms, 0),
      worstLongTaskMs: p.longTasks.reduce((a, t) => Math.max(a, t.ms), 0),
      marks,
      measures,
    };
  });
  result.startup = { ...startup, wallToReadyMs: Date.now() - navStart };
  console.log(
    `startup      load ${startup.loadMs} ms  first frame ${startup.firstFrameMs} ms  long tasks ${startup.longTasks.length} (total ${startup.longTaskTotalMs} ms, worst ${startup.worstLongTaskMs} ms)`,
  );
  if (Object.keys(startup.measures).length) console.log('             measures', JSON.stringify(startup.measures));

  await phase('idle', async () => {}, 1000);
  await phase('drive', () => inject({ throttle: 1 }, 90), 300);
  await phase(
    'drift',
    async () => {
      await inject({ throttle: 1, steer: 1, handbrake: true }, 30);
      await inject({ throttle: 1, steer: 1 }, 60);
    },
    400,
  );
  await phase('nitro', () => inject({ throttle: 1, nitro: true }, 90), 300);
  await phase(
    'lightning',
    async () => {
      await page.evaluate(() => {
        const s = window.__rb.state;
        const t = s.targets.find((x) => x.status === 'active');
        const v = s.vehicle;
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
        if (t) {
          t.x = 0;
          t.z = -2;
          t.prevX = t.x;
          t.prevZ = t.z;
          t.heading = Math.PI;
          t.patrolSpeed = 0;
        }
        s.lightning.charge = 100;
      });
      await sleep(300);
      await inject({ fire: true }, 1);
    },
    900,
  );
  await phase('restart', () => inject({ restart: true }, 1), 600);
  // Steady state: everything has been seen once; this is the frame cost of just playing.
  await phase(
    'steady',
    async () => {
      for (let i = 0; i < 3; i++) {
        await inject({ throttle: 1, steer: i % 2 ? 1 : -1, handbrake: true }, 12);
        await inject({ throttle: 1, steer: i % 2 ? 1 : -1, nitro: i === 1 }, 90);
        await waitIdle();
      }
    },
    200,
  );

  result.programs = await page.evaluate(() => window.__rb.renderer.info.programs.map((p) => p.name));
  result.gpu = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
  });
  result.userAgent = await page.evaluate(() => navigator.userAgent);
  await page.close();
  return result;
}

/** In check mode, serve the production build ourselves when nothing answers at `url`. */
async function reachable(target) {
  try {
    const res = await fetch(target, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

let previewServer = null;
if (check && !(await reachable(url))) {
  if (!existsSync('dist/index.html')) {
    console.error('perf gate: dist/ is missing. Run `npm run build` first (or use `npm run perf:check`).');
    process.exit(2);
  }
  const port = new URL(url).port || '4173';
  console.log(`starting vite preview on port ${port} for the perf gate`);
  previewServer = spawn(
    process.execPath,
    ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', port, '--strictPort'],
    { stdio: 'ignore' },
  );
  const deadline = Date.now() + 20000;
  while (!(await reachable(url))) {
    if (Date.now() > deadline || previewServer.exitCode !== null) {
      console.error('perf gate: the preview server did not come up.');
      process.exit(2);
    }
    await sleep(250);
  }
}

const browser = await puppeteer.launch({
  executablePath,
  headless: headed ? false : 'new',
  args: [
    '--window-size=1600,960',
    '--ignore-gpu-blocklist',
    '--enable-gpu-rasterization',
    '--use-angle=default',
    '--autoplay-policy=no-user-gesture-required',
  ],
  defaultViewport: { width: 1600, height: 900 },
});

const results = [];
try {
  for (let i = 0; i < runs; i++) {
    if (runs > 1) console.log(`\n--- run ${i + 1}/${runs} ---`);
    results.push(await probeOnce(browser, i));
  }
} finally {
  await browser.close();
}

if (previewServer) previewServer.kill();

/** Evaluate the gate for one run. Returns { hard, soft }: deterministic and timing failures. */
function evaluate(r) {
  const hard = [];
  const soft = [];
  if (r.consoleErrors.length) hard.push(`console errors: ${r.consoleErrors.join(' | ')}`);
  for (const [name, p] of Object.entries(r.phases)) {
    if (name !== 'idle' && CHECKS.noMidPlayCompiles && p.newPrograms > 0) {
      hard.push(`${name}: ${p.newPrograms} shader program(s) compiled mid-play (${p.programsBefore} -> ${p.programsAfter})`);
    }
    if (p.drawCalls > CHECKS.maxDrawCalls) hard.push(`${name}: ${p.drawCalls} draw calls > ${CHECKS.maxDrawCalls}`);
    if (p.triangles > CHECKS.maxTriangles) hard.push(`${name}: ${p.triangles} triangles > ${CHECKS.maxTriangles}`);
    if (CHECKS.playPhases.includes(name) && p.worstMs > CHECKS.maxFrameMs) {
      soft.push(`${name}: worst frame ${p.worstMs} ms > ${CHECKS.maxFrameMs} ms`);
    }
  }
  const steady = r.phases.steady;
  if (steady && steady.simMs + steady.renderMs > CHECKS.maxCpuMs) {
    soft.push(`steady: cpu ${steady.simMs} + ${steady.renderMs} ms > ${CHECKS.maxCpuMs} ms per frame`);
  }
  if (r.startup.longTaskTotalMs > CHECKS.maxStartupLongTaskMs) {
    soft.push(`startup: ${r.startup.longTaskTotalMs} ms of long tasks > ${CHECKS.maxStartupLongTaskMs} ms`);
  }
  return { hard, soft };
}

let gate = null;
if (check) {
  const verdicts = results.map(evaluate);
  const label = (v, i, list) => list.map((m) => `run ${i + 1}: ${m}`);
  const hard = verdicts.flatMap((v, i) => label(v, i, v.hard));
  const softEveryRun = verdicts.every((v) => v.soft.length > 0);
  const softAll = verdicts.flatMap((v, i) => label(v, i, v.soft));
  const soft = softEveryRun ? softAll : [];
  const flaky = softEveryRun ? [] : softAll;
  gate = { passed: hard.length === 0 && soft.length === 0, hard, soft, flaky, checks: CHECKS };
  console.log('\nperf gate');
  for (const m of hard) console.log(`  FAIL  ${m}`);
  for (const m of soft) console.log(`  FAIL  ${m}`);
  for (const m of flaky) console.log(`  warn  ${m} (did not repeat in every run; not counted)`);
  if (gate.passed) {
    const worst = results.reduce((a, r) => Math.max(a, ...Object.values(r.phases).map((p) => p.worstMs)), 0);
    console.log(
      `  PASS  no mid-play shader compiles, worst frame ${worst} ms <= ${CHECKS.maxFrameMs} ms, ` +
        `draws <= ${CHECKS.maxDrawCalls}, tris <= ${CHECKS.maxTriangles}, cpu <= ${CHECKS.maxCpuMs} ms, no console errors`,
    );
  }
}

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify({ url, executablePath, headed, results, gate }, null, 2));
console.log(`\nwrote ${outFile}`);
const errors = results.flatMap((r) => r.consoleErrors);
if (errors.length && !check) {
  console.log('console errors:', errors);
  process.exitCode = 1;
}
if (gate && !gate.passed) process.exitCode = 1;
