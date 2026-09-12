/**
 * City viewpoint capture: parks the car at a list of named viewpoints, waits for the scene
 * to settle, and saves a screenshot and the renderer metrics for each. Used to compare the
 * look and the cost of the city before and after an art change.
 *
 * Usage: node scripts/city-shots.mjs --tag before [--mode city|stack] [--url ...] [--headed] [--out artifacts/shots]
 * Requires a dev or preview server on the URL. `&solo=1` keeps the shot out of the shared open
 * world, so nobody else's car turns up in it.
 *
 * `--mode stack` takes The Stack's list instead (`docs/CITY_V2_BRIEF.md`): one shot per level
 * for the Phase 1 gate, and the six frame-test vantage points of `docs/CITY_V2_PLAN.md` §11,
 * at the brief's 1440x900. A Stack view can name a ribbon and a direction instead of a
 * heading, and the car is then stood on that road, pointed along it, at that road's height —
 * the level is chosen by `y`, which the surface field resolves to the deck it can step onto.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { buildTrackPath, createProjection, projectOntoPath } from '../src/world/track.ts';
import { STACK_ELEVATED, STACK_ROADS } from '../src/world/stackSpec.ts';

const args = process.argv.slice(2);
const getArg = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const tag = getArg('--tag', 'shot');
const mode = getArg('--mode', 'city');
const url = getArg('--url', mode === 'stack' ? 'http://127.0.0.1:5173/?mode=stack&debug=1&intro=0' : 'http://127.0.0.1:5178/?mode=city&solo=1&debug=1');
const outDir = getArg('--out', 'artifacts/shots');
const headed = args.includes('--headed');
const viewport = mode === 'stack' ? { width: 1440, height: 900 } : { width: 1600, height: 900 };

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
const CITY_VIEWS = [
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

/**
 * The Stack. `along` stands the car on that ribbon at the nearest point to (x, z), pointed
 * with (+1) or against (-1) its samples, at the ribbon's height there. The first eight are
 * the Phase 1 gate (a shot from every level and both interchanges); the six after them are
 * the plan's frame-test vantage points, recorded now so Phase 2 measures the same frames.
 */
const STACK_VIEWS = [
  { name: 'l0-av-central', x: -56, z: 70, heading: 0, y: 0 },
  { name: 'l0-west-corridor', x: -252, z: 40, heading: 0, y: 0 },
  { name: 'l1-deck-west', along: 'deck', dir: 1, x: -215, z: 0 },
  { name: 'l1-deck-pinch', along: 'deck', dir: 1, x: -35, z: -150 },
  { name: 'l2-spine-east', along: 'spine', dir: 1, x: 178, z: -20 },
  { name: 'l3-ring-west', along: 'ring', dir: 1, x: -105, z: 40 },
  { name: 'ramp-w-up-01', along: 'w-up-01', dir: 1, x: -232, z: 60 },
  { name: 'ramp-e-up-12', along: 'e-up-12', dir: 1, x: 198, z: 20 },
  // Frame test (plan §11).
  { name: 'spine-passage-north', along: 'spine', dir: 1, x: -30, z: -130 },
  { name: 'spine-passage-south', along: 'spine', dir: 1, x: -48, z: 172 },
  // Under the on-ramp's edge, the deck and the spine stacked ahead: the street image.
  { name: 'gran-via-west', x: -234, z: -56, heading: Math.PI / 2, y: 0 },
  // Under the spine's south corner, the deck's bridge building ahead.
  { name: 'st-centre-south', x: 32, z: 183, heading: Math.PI, y: 0 },
  { name: 'ramp-w-up-12', along: 'w-up-12', dir: 1, x: -198, z: -20 },
  { name: 'av-central-ring', x: -56, z: -10, heading: 0, y: 0 },
];

/** Resolve `along` views to a point, heading and height on the named ribbon. */
function resolveStackViews(views) {
  const paths = new Map();
  for (const r of STACK_ROADS) paths.set(r.tag, buildTrackPath(r.spec));
  for (const r of STACK_ELEVATED) paths.set(r.tag, buildTrackPath(r.spec));
  const p = createProjection();
  return views.map((v) => {
    if (!v.along) return v;
    const path = paths.get(v.along);
    if (!path) throw new Error(`no ribbon ${v.along}`);
    projectOntoPath(path, v.x, v.z, p);
    const dir = v.dir ?? 1;
    // In the right-hand lane of the direction of travel, like a driver.
    const lane = Math.min(3.5, p.halfWidth - 2);
    return { name: v.name, x: p.x + -p.tz * lane * dir, z: p.z + p.tx * lane * dir, y: p.y, heading: Math.atan2(p.tx * dir, -p.tz * dir), along: v.along };
  });
}

const VIEWS = mode === 'stack' ? resolveStackViews(STACK_VIEWS) : CITY_VIEWS;

/**
 * The frame test of `docs/CITY_V2_BRIEF.md`, measured in the page:
 *
 *  - SKY: the share of the frame where nothing but the sky dome is drawn. The atmosphere
 *    (dome, rain, storm) is hidden, the scene is rendered once more with every material
 *    replaced by unfogged white on a black clear, and the black pixels are counted. Fog is
 *    not sky: a fogged tower is still a tower and comes out white.
 *  - OVERHEAD: what structure stands over the car within 40 m: a building's ceiling (a
 *    megastructure volume over the point), a deck (the surface field's answer from 45 m up),
 *    a skybridge within 12 m along, or a portal frame (the ribbon carries frames every 30 m
 *    outside its passages, so one is always within 15 m unless a merge or a crossing skipped
 *    it — reported as 'frame', the weakest claim of the four).
 */
async function measureFrame(page) {
  return page.evaluate(async () => {
    const rb = window.__rb;
    // A white, unfogged, unlit material: the lane paint's, cloned, with its colour and its
    // vertex colours taken off. Borrowed from the scene so nothing here imports three.
    const white = rb.scene.getObjectByName('env-lanes').material.clone();
    white.vertexColors = false;
    white.fog = false;
    white.map = null;
    white.color.setHex(0xffffff);
    white.needsUpdate = true;
    const atmosphere = rb.scene.getObjectByName('atmosphere');
    const r = rb.renderer;
    const gl = r.getContext();
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const wasVisible = atmosphere ? atmosphere.visible : true;
    const prevOverride = rb.scene.overrideMaterial;
    let sky = 0;
    try {
      if (atmosphere) atmosphere.visible = false;
      rb.scene.overrideMaterial = white;
      const c = r.getClearColor(new (Object.getPrototypeOf(white.color).constructor)());
      const alpha = r.getClearAlpha();
      r.setClearColor(0x000000, 1);
      r.render(rb.scene, rb.camera);
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let black = 0;
      for (let i = 0; i < px.length; i += 4) if (px[i] < 16 && px[i + 1] < 16 && px[i + 2] < 16) black++;
      sky = black / (w * h);
      r.setClearColor(c, alpha);
    } finally {
      rb.scene.overrideMaterial = prevOverride;
      if (atmosphere) atmosphere.visible = wasVisible;
      white.dispose();
    }
    // Overhead structure within 40 m.
    const { createCityWorld } = await import('/src/world/cityWorld.ts');
    const { STACK_SPEC } = await import('/src/world/stackSpec.ts');
    const { createProjection, projectOntoPath } = await import('/src/world/track.ts');
    window.__stackPlan ??= createCityWorld(STACK_SPEC).plan;
    const plan = window.__stackPlan;
    const v = rb.state.vehicle;
    const x = v.x, z = v.z, y = v.y ?? 0;
    const overhead = [];
    for (const m of plan.megastructures ?? []) for (const vol of m.volumes) {
      if (x >= vol.minX && x <= vol.maxX && z >= vol.minZ && z <= vol.maxZ && vol.y0 > y + 1 && vol.y0 <= y + 40) { overhead.push(`ceiling@${(vol.y0 - y).toFixed(0)}m`); break; }
    }
    const sample = { y: 0, gx: 0, gz: 0 };
    rb.layout.surface.sample(x, z, y + 45, sample);
    if (sample.y > y + 1) overhead.push(`deck@${(sample.y - y).toFixed(0)}m`);
    for (const sb of plan.skybridges ?? []) {
      const dx = sb.bx - sb.ax, dz = sb.bz - sb.az, len = Math.hypot(dx, dz);
      const t = ((x - sb.ax) * dx + (z - sb.az) * dz) / (len * len);
      const px2 = sb.ax + dx * t, pz2 = sb.az + dz * t;
      if (t > 0 && t < 1 && Math.hypot(px2 - x, pz2 - z) < 12 && sb.y > y + 1 && sb.y < y + 40) { overhead.push(`skybridge@${(sb.y - y).toFixed(0)}m`); break; }
    }
    const P = createProjection();
    for (const tag of plan.portalFrames ?? []) {
      const rbn = plan.ribbons.find((q) => q.tag === tag);
      if (!rbn) continue;
      projectOntoPath(rbn.path, x, z, P);
      if (P.dist > P.halfWidth || Math.abs(P.y - y) > 1) continue;
      const inPassage = (plan.passages ?? []).some((pd) => pd.tag === tag && P.s > pd.s0 - 12 && P.s < pd.s1 + 12);
      if (!inPassage) overhead.push('frame');
    }
    return { sky, overhead, width: w, height: h };
  });
}

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
  defaultViewport: { ...viewport, deviceScaleFactor: 1 },
});

const out = { tag, mode, url, viewport, views: [], errors: [] };
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
      const rb = window.__rb;
      const s = rb.state.vehicle;
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
      // Stand on the level the view asks for: the surface field's answer from just above it,
      // so a view on a ramp lands on the ramp and a view under a deck stays under it.
      if (view.y !== undefined) {
        let y = view.y;
        if (rb.layout.surface) {
          const out = { y: 0, gx: 0, gz: 0 };
          rb.layout.surface.sample(view.x, view.z, view.y + 0.5, out);
          y = out.y;
        }
        s.y = y;
        s.prevY = y;
        s.pitch = 0;
      }
    }, v);
    // Long enough for the chase camera to settle and the metric window to refill.
    await sleep(2200);
    const file = join(outDir, `${tag}-${v.name}.png`);
    await page.screenshot({ path: file, type: 'png' });
    const m = await page.evaluate(() => JSON.parse(JSON.stringify(window.__rb.metrics)));
    const at = await page.evaluate(() => {
      const s = window.__rb.state.vehicle;
      return { x: +s.x.toFixed(1), y: +(s.y ?? 0).toFixed(2), z: +s.z.toFixed(1) };
    });
    const frame = mode === 'stack' ? await measureFrame(page) : null;
    out.views.push({ ...v, at, file, metrics: m, ...(frame ? { frame } : {}) });
    const extra = frame ? `  sky ${(frame.sky * 100).toFixed(1)}%  overhead ${frame.overhead.join('+') || 'none'}` : '';
    console.log(`${v.name}: at (${at.x}, ${at.y}, ${at.z})  ${m.drawCalls} draws, ${m.triangles} tris, ${m.fps.toFixed(1)} fps, gpu ${m.gpuMs.toFixed(2)} ms${extra}`);
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
  for (const v of mode === 'stack' ? [] : CLOSEUPS) {
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
