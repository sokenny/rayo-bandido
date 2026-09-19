/**
 * Agent G's visual harness: the player's car on a dark lot, one cell per lamp / neon / cabin
 * choice, so every option can be compared side by side at 1:1. Not shipped (outside `src/`).
 *
 *   npx vite --port 5197 --strictPort   then   /harness/g-lights.html?shot=heads
 *
 * `?shot=` one of the keys of `SHOTS` below. `scripts/harness-shots-g.mjs` captures them all.
 * Sets `window.__gReady = true` once the frame is drawn.
 */
import * as THREE from 'three';
import { createCarVisual } from '../src/render/scene/carVisual';
import { STOCK_LOADOUT, cloneLoadout, sanitizeLoadout, type CarLoadout } from '../src/core/loadout';
import { partsOf } from '../src/content/carParts';

type View = 'front' | 'rear' | 'side' | 'cabin';

interface Cell {
  label: string;
  lights?: Partial<CarLoadout['lights']>;
  charge?: number;
  brake?: boolean;
  nitro?: number;
  view: View;
}

const ids = (cat: 'headlights' | 'taillights') => partsOf(cat).map((p) => p.id);

const SHOTS: Record<string, Cell[]> = {
  heads: ids('headlights').map((head) => ({ label: head, lights: { head }, view: 'front' })),
  tails: ids('taillights').map((tail) => ({ label: tail, lights: { tail }, view: 'rear' })),
  tailsBrake: ids('taillights').map((tail) => ({ label: `${tail} brake`, lights: { tail }, brake: true, view: 'rear' })),
  tailsNitro: ids('taillights').map((tail) => ({ label: `${tail} nitro`, lights: { tail }, nitro: 1, view: 'rear' })),
  headColors: ['xenon', 'white', 'sky', 'yellow', 'halogen', 'magenta'].map((headColor) => ({
    label: `quad ${headColor}`,
    lights: { head: 'headlights.quad', headColor },
    view: 'front',
  })),
  neonRest: ['rayo', 'red', 'lime', 'violet', 'amber', 'off'].map((neon) => ({ label: `neon ${neon} rest`, lights: { neon }, charge: 0, view: 'side' })),
  neonCharged: ['rayo', 'red', 'lime', 'violet', 'amber', 'off'].map((neon) => ({ label: `neon ${neon} charge 1`, lights: { neon }, charge: 1, view: 'side' })),
  neonHalf: ['rayo', 'red', 'lime', 'violet', 'amber', 'off'].map((neon) => ({ label: `neon ${neon} charge .4`, lights: { neon }, charge: 0.4, view: 'side' })),
  cabin: ['rayo', 'lime', 'red', 'white', 'violet', 'amber'].map((interior) => ({ label: `cabin ${interior}`, lights: { interior }, view: 'cabin' })),
};

const params = new URLSearchParams(location.search);
const shot = SHOTS[params.get('shot') ?? 'heads'] ?? SHOTS.heads;
const COLS = 3;
const ROWS = Math.ceil(shot.length / COLS);

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.28;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setScissorTest(true);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05060a);
scene.add(new THREE.HemisphereLight(0x3a4a6a, 0x0a0a10, 0.55));
const key = new THREE.DirectionalLight(0x8fa0c0, 0.5);
key.position.set(-4, 6, -3);
scene.add(key);
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(40, 40),
  new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 0.85, metalness: 0.1 }),
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const car = createCarVisual();
scene.add(car.root);

const camera = new THREE.PerspectiveCamera(34, 1, 0.05, 100);
const VIEWS: Record<View, { eye: [number, number, number]; at: [number, number, number]; fov: number }> = {
  front: { eye: [1.9, 0.95, -5.0], at: [0, 0.5, -1.7], fov: 30 },
  rear: { eye: [1.7, 1.05, 5.1], at: [0, 0.55, 1.7], fov: 30 },
  side: { eye: [5.8, 1.3, 0.4], at: [0, 0.25, 0], fov: 42 },
  cabin: { eye: [0, 1.75, 3.2], at: [0, 1.02, -0.2], fov: 28 },
};

function dress(cell: Cell): void {
  const l = cloneLoadout(STOCK_LOADOUT);
  Object.assign(l.lights, cell.lights ?? {});
  car.applyLoadout(sanitizeLoadout(l));
  car.setCharge(cell.charge ?? 0);
  car.setBrakeLights(!!cell.brake);
  car.setNitro(cell.nitro ?? 0);
  car.update(1 / 60, 0.37);
}

const W = window.innerWidth;
const H = window.innerHeight;
const cw = Math.floor(W / COLS);
const ch = Math.floor(H / ROWS);
shot.forEach((cell, i) => {
  const col = i % COLS;
  const row = Math.floor(i / COLS);
  const x = col * cw;
  const yTop = row * ch;
  dress(cell);
  const v = VIEWS[cell.view];
  camera.fov = v.fov;
  camera.aspect = cw / ch;
  camera.position.set(...v.eye);
  camera.lookAt(new THREE.Vector3(...v.at));
  camera.updateProjectionMatrix();
  renderer.setViewport(x, H - yTop - ch, cw, ch);
  renderer.setScissor(x, H - yTop - ch, cw, ch);
  renderer.render(scene, camera);
  const label = document.createElement('div');
  label.className = 'label';
  label.textContent = cell.label;
  label.style.left = `${x + 6}px`;
  label.style.top = `${yTop + 6}px`;
  document.body.appendChild(label);
});

(window as unknown as { __gReady: boolean }).__gReady = true;
