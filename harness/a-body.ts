/**
 * Visual QA for agent A's body parts (`docs/GARAGE_PLAN.md` §6.3). Not part of the game.
 *
 * Renders a grid: one column per variant of `?slot=`, one row per view in `?views=`. Every cell
 * is the same `CarVisual` re-dressed with `applyLoadout` and drawn into its own viewport.
 *
 *   ?slot=frontBumper            which slot's variants make the columns
 *   &views=front34,side          rows (see VIEWS)
 *   &paint=1                     keep the livery (default: map off, so paint reads white and
 *                                carbon/grille tints read as themselves)
 *   &stance=low                  stock | low (lowest ride, widest track, max camber, widest tyre)
 *                                | narrow (lowest ride, narrowest track, widest tyre)
 *   &steer=0.55                  front wheel lock (rad)
 *   &with=trunk.ducktail,...     extra part ids worn in every cell
 *   &ids=a,b                     only these variants
 *
 * `window.__harnessReady` turns true once drawn (scripts/harness-shots-a.mjs waits on it).
 */
import * as THREE from 'three';
import { createCarVisual } from '../src/render/scene/carVisual';
import { STOCK_LOADOUT, STEP_RANGES, cloneLoadout, type CarLoadout } from '../src/core/loadout';
import { SLOT_MODULES, type CustomBodySlot } from '../src/render/scene/vehicles/parts';

const q = new URLSearchParams(location.search);
const slot = (q.get('slot') ?? 'frontBumper') as CustomBodySlot;
const viewNames = (q.get('views') ?? 'front34,side,rear34').split(',');
const keepPaint = q.get('paint') === '1';
const stance = q.get('stance') ?? 'stock';
const steer = Number(q.get('steer') ?? '0');
const extra = (q.get('with') ?? '').split(',').filter(Boolean);
const only = (q.get('ids') ?? '').split(',').filter(Boolean);

/** Camera eye and target (car frame: nose −Z, +X right). */
const VIEWS: Record<string, { eye: [number, number, number]; at: [number, number, number]; fov: number }> = {
  front34: { eye: [-4.6, 1.5, -5.6], at: [0, 0.5, -0.4], fov: 30 },
  front: { eye: [0, 0.8, -7.5], at: [0, 0.45, 0], fov: 26 },
  frontLow: { eye: [-2.2, 0.35, -4.4], at: [0, 0.3, -1.6], fov: 34 },
  hood: { eye: [-1.2, 3.4, -5.4], at: [0, 0.7, -1.2], fov: 30 },
  side: { eye: [-8.2, 1.0, 0], at: [0, 0.55, 0], fov: 30 },
  sideLow: { eye: [-6.5, 0.25, 0], at: [0, 0.3, 0], fov: 30 },
  rear34: { eye: [4.6, 1.5, 5.6], at: [0, 0.5, 0.4], fov: 30 },
  rear: { eye: [0, 0.8, 7.5], at: [0, 0.45, 0], fov: 26 },
  rearHigh: { eye: [1.8, 3.2, 5.8], at: [0, 0.85, 1.2], fov: 30 },
  rearLow: { eye: [2.0, 0.35, 4.6], at: [0, 0.3, 1.8], fov: 34 },
  wing: { eye: [3.2, 1.9, 4.0], at: [0, 1.05, 1.8], fov: 30 },
  wingSide: { eye: [-4.2, 1.2, 1.8], at: [0, 1.0, 1.8], fov: 30 },
  tips: { eye: [0.6, 0.55, 4.2], at: [0, 0.3, 2.1], fov: 30 },
};

const CELL_W = 460;
const CELL_H = 300;
const ids = SLOT_MODULES[slot].variants.filter((id) => only.length === 0 || only.includes(id));
const cols = ids.length;
const rows = viewNames.length;

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(CELL_W * cols, CELL_H * rows);
renderer.setScissorTest(true);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
const wrap = document.getElementById('wrap')!;
wrap.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8a8f99);
scene.add(new THREE.HemisphereLight(0xdfe6ff, 0x4a4540, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(-4, 8, -3);
scene.add(sun);
const back = new THREE.DirectionalLight(0xbfd0ff, 1.0);
back.position.set(5, 4, 6);
scene.add(back);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x6e737c, roughness: 0.9 }));
ground.rotation.x = -Math.PI / 2;
scene.add(ground);
// A 10 cm grid of lines on the ground near the car, for judging clearance.
const grid = new THREE.GridHelper(8, 80, 0x50545c, 0x5c6068);
grid.position.y = 0.002;
scene.add(grid);

function loadoutFor(id: string): CarLoadout {
  const l = cloneLoadout(STOCK_LOADOUT);
  for (const e of extra) {
    const s = e.split('.')[0] as CustomBodySlot;
    if (s in l.body) l.body[s] = e;
  }
  l.body[slot] = id;
  if (stance === 'low' || stance === 'narrow') {
    l.stance.rideHeight = STEP_RANGES.rideHeight.min;
    l.wheels.width = STEP_RANGES.wheelWidth.max;
    const track = stance === 'low' ? 'max' : 'min';
    l.stance.trackFront = STEP_RANGES.trackFront[track];
    l.stance.trackRear = STEP_RANGES.trackRear[track];
    l.stance.camberFront = stance === 'low' ? STEP_RANGES.camberFront.max : 0;
    l.stance.camberRear = stance === 'low' ? STEP_RANGES.camberRear.max : 0;
  }
  return l;
}

const car = createCarVisual({ loadout: loadoutFor(ids[0]) });
scene.add(car.root);
const camera = new THREE.PerspectiveCamera(30, CELL_W / CELL_H, 0.05, 100);

function flatten(): void {
  if (keepPaint) return;
  const body = car.root.getObjectByName('player-car-body') as THREE.Mesh | undefined;
  const mat = body?.material as THREE.MeshStandardMaterial | undefined;
  if (mat) {
    mat.map = null;
    mat.emissiveMap = null;
    mat.emissive.set(0x000000);
    mat.color.set(0xe8e8ec);
    mat.needsUpdate = true;
  }
}

for (let c = 0; c < cols; c++) {
  car.applyLoadout(loadoutFor(ids[c]));
  flatten();
  car.wheels[0].steer.rotation.y = steer;
  car.wheels[1].steer.rotation.y = steer;
  car.update(1 / 60, 0);
  for (let r = 0; r < rows; r++) {
    const v = VIEWS[viewNames[r]] ?? VIEWS.side;
    camera.fov = v.fov;
    camera.updateProjectionMatrix();
    camera.position.set(...v.eye);
    camera.lookAt(new THREE.Vector3(...v.at));
    const x = c * CELL_W;
    const y = (rows - 1 - r) * CELL_H; // GL viewports count from the bottom
    renderer.setViewport(x, y, CELL_W, CELL_H);
    renderer.setScissor(x, y, CELL_W, CELL_H);
    renderer.render(scene, camera);
    if (r === 0 || c === 0) {
      const label = document.createElement('div');
      label.className = 'label';
      label.style.left = `${x + 4}px`;
      label.style.top = `${r * CELL_H + 4}px`;
      label.textContent = r === 0 ? `${ids[c]}${c === 0 ? ` · ${viewNames[r]}` : ''}` : viewNames[r];
      wrap.appendChild(label);
    }
  }
}

(window as unknown as { __harnessReady: boolean }).__harnessReady = true;
