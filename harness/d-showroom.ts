/**
 * Agent D's harness: the showroom with the stock car on the turntable, driven by hand or by
 * `scripts/harness-shots-d.mjs`.
 *
 *   npx vite --port 5194 --strictPort   →   http://127.0.0.1:5194/harness/d-showroom.html
 *
 * By hand: ←/→ step through the workshop categories (the camera travels to each), drag to look
 * round, wheel to zoom, I replays the intro, S toggles the idle spin, R the reflection.
 * `?shots=1` hides the read-out and stops the loop; the script drives `window.__d`.
 */
import * as THREE from 'three';
import { createRenderer } from '../src/render/renderer';
import { createCarVisual } from '../src/render/scene/carVisual';
import { CAMERA_SHOTS, CATEGORIES, categoryDef, type CameraShotKey, type CategoryId } from '../src/content/carParts';
import { createShowroom, NO_INPUT } from '../src/render/workshop/showroom';
import type { WorkshopCameraInput } from '../src/render/workshop/workshopCamera';

const params = new URLSearchParams(location.search);
const shotsMode = params.has('shots');
if (shotsMode) document.body.classList.add('shots');

const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = createRenderer(canvas);
const car = createCarVisual();
const holder = new THREE.Scene();
holder.add(car.root);
const t0 = performance.now();
const showroom = createShowroom(renderer, { reflections: params.get('refl') !== '0' });
const buildMs = performance.now() - t0;
showroom.attach(car);

function resize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  showroom.resize(w, h);
}
resize();
window.addEventListener('resize', resize);

let index = 0;
const ids = CATEGORIES.map((c) => c.id);
showroom.setCategory(ids[index]);
showroom.introShot();

/* ------------------------------------------------------------------ input */
const input: WorkshopCameraInput = { dragYaw: 0, dragPitch: 0, zoom: 0, dragging: false };
let lastX = 0;
let lastY = 0;
canvas.addEventListener('pointerdown', (e) => {
  input.dragging = true;
  lastX = e.clientX;
  lastY = e.clientY;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (!input.dragging) return;
  input.dragYaw -= (e.clientX - lastX) * 0.006;
  input.dragPitch += (e.clientY - lastY) * 0.004;
  lastX = e.clientX;
  lastY = e.clientY;
});
canvas.addEventListener('pointerup', () => (input.dragging = false));
canvas.addEventListener('wheel', (e) => (input.zoom += -Math.sign(e.deltaY)), { passive: true });
let spinning = false;
let reflectionsOn = params.get('refl') !== '0';
window.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    index = (index + (e.key === 'ArrowRight' ? 1 : ids.length - 1)) % ids.length;
    showroom.setCategory(ids[index]);
  } else if (e.key === 'i') showroom.introShot();
  else if (e.key === 's') showroom.setIdleSpin((spinning = !spinning));
  else if (e.key === 'r') reflectionsOn = !reflectionsOn;
});

/* ------------------------------------------------------------------ loop */
const hud = document.getElementById('hud') as HTMLDivElement;
let last = performance.now();
function frame(now: number): void {
  if (shotsMode) return;
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  showroom.update(dt, input);
  input.dragYaw = input.dragPitch = input.zoom = 0;
  render();
  const def = categoryDef(ids[index]);
  const s = showroom.rig.state;
  hud.textContent =
    `${def.label} (${def.id}) → ${def.cameraShot}${def.dimShowroom ? ' · dim' : ''}\n` +
    `yaw ${s.carYaw.toFixed(2)} pitch ${s.pitch.toFixed(2)} dist ${s.distance.toFixed(2)} fov ${s.fov.toFixed(0)}\n` +
    `calls ${renderer.info.render.calls} tris ${renderer.info.render.triangles} · build ${buildMs.toFixed(0)} ms`;
}
requestAnimationFrame(frame);

function render(): void {
  showroom.setReflections(reflectionsOn);
  showroom.render();
}

/* ------------------------------------------------------------------ script API */
interface Info {
  calls: number;
  triangles: number;
  geometries: number;
  textures: number;
  ms: number;
}
function info(ms: number): Info {
  return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, ms };
}

/** Settle the rig on `what` (a category or a shot key) for `seconds` of simulated time, then draw. */
function show(what: string, seconds = 2.5, drag?: Partial<WorkshopCameraInput>, lightsOf: CategoryId = 'frontBumper'): Info {
  if (ids.includes(what as CategoryId)) showroom.setCategory(what as CategoryId);
  else {
    // A bare shot key: the lights of `lightsOf` (dimmed for 'neon'), then the shot.
    showroom.setCategory(lightsOf);
    showroom.setShot(what as CameraShotKey);
  }
  const steps = Math.round(seconds * 30);
  for (let i = 0; i < steps; i++) showroom.update(1 / 30, i === 0 && drag ? { ...NO_INPUT, ...drag } : NO_INPUT);
  const a = performance.now();
  showroom.render();
  return info(performance.now() - a);
}

(window as unknown as { __d: unknown }).__d = {
  ready: true,
  buildMs,
  categories: CATEGORIES.map((c) => ({ id: c.id, shot: c.cameraShot, dim: !!c.dimShowroom })),
  shots: Object.keys(CAMERA_SHOTS),
  show,
  /** Intro frames: `t` seconds into the swoop onto `category`'s shot. */
  intro(category: CategoryId, t: number): Info {
    showroom.setCategory(category);
    showroom.update(1 / 30, NO_INPUT);
    showroom.introShot();
    for (let i = 0; i < Math.round(t * 30); i++) showroom.update(1 / 30, NO_INPUT);
    showroom.render();
    return info(0);
  },
  /** The same frame without the car: the room's own cost. */
  roomOnly(): Info {
    showroom.detach();
    showroom.render();
    const r = info(0);
    showroom.attach(car);
    return r;
  },
  /** The current frame's cost split by pass: both passes, then the main pass alone. */
  passes(): { both: Info; main: Info } {
    showroom.render();
    const both = info(0);
    showroom.setReflections(false);
    showroom.render();
    const main = info(0);
    showroom.setReflections(reflectionsOn);
    showroom.render();
    return { both, main };
  },
  /** Build a second showroom, draw it with the car, dispose it: what it leaves behind on the GPU. */
  disposeCycle(): { before: { geometries: number; textures: number }; during: { geometries: number; textures: number }; after: { geometries: number; textures: number }; carBack: boolean } {
    const mem = () => ({ geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures });
    showroom.detach();
    const before = mem();
    const second = createShowroom(renderer);
    second.attach(car);
    second.setCategory('paint');
    second.update(1 / 30, NO_INPUT);
    second.render();
    const during = mem();
    second.dispose();
    const carBack = car.root.parent === holder;
    const after = mem();
    showroom.attach(car);
    return { before, during, after, carBack };
  },
  /** Average ms of `n` renders of the current frame (GPU-bound numbers need a finish). */
  timeRenders(n: number): number {
    const gl = renderer.getContext();
    gl.finish();
    const a = performance.now();
    for (let i = 0; i < n; i++) {
      showroom.update(1 / 60, NO_INPUT);
      showroom.render();
    }
    gl.finish();
    return (performance.now() - a) / n;
  },
};
