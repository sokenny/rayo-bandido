import * as THREE from 'three';
import { createCarVisual } from '../src/render/scene/carVisual';
import { STOCK_LOADOUT, sanitizeLoadout, type CarLoadout } from '../src/core/loadout';

/**
 * Agent B's harness: the player car dressed in a loadout, framed from a fixed set of views,
 * rendered into the cells of a contact sheet. `window.sheet(cells, cols)` draws and resolves;
 * `scripts/harness-shots-b.mjs` screenshots the page.
 */
type View = 'wheel' | 'wheelRear' | 'side' | 'front34' | 'head' | 'tail';
interface Cell {
  loadout: Partial<CarLoadout> & { wheels?: Partial<CarLoadout['wheels']>; stance?: Partial<CarLoadout['stance']> };
  view: View;
  label?: string;
}

const W = 1600;
const H = 1000;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.28;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setScissorTest(true);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2a2e38);
scene.add(new THREE.HemisphereLight(0xdfe6ff, 0x3a3530, 1.6));
const key = new THREE.DirectionalLight(0xffffff, 2.2);
key.position.set(4, 6, -3);
scene.add(key);
const fill = new THREE.DirectionalLight(0x9fb4ff, 0.8);
fill.position.set(-5, 3, 4);
scene.add(fill);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x4a4d55, roughness: 0.8 }));
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

const car = createCarVisual();
scene.add(car.root);
const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 100);

function frame(view: View, aspect: number): void {
  camera.aspect = aspect;
  camera.near = 0.05;
  switch (view) {
    case 'wheel': // close on the front-right wheel, axle height, slightly ahead
      camera.fov = 34;
      camera.position.set(2.3, 0.36, -1.75);
      camera.lookAt(0.8, 0.36, -1.3);
      break;
    case 'wheelRear':
      camera.fov = 34;
      camera.position.set(2.3, 0.36, 1.75);
      camera.lookAt(0.8, 0.36, 1.3);
      break;
    case 'side':
      camera.fov = 30;
      camera.position.set(7.5, 0.4, 0);
      camera.lookAt(0, 0.55, 0);
      break;
    case 'front34':
      camera.fov = 40;
      camera.position.set(3.2, 0.75, -4.6);
      camera.lookAt(0.2, 0.45, -1.2);
      break;
    // Head-on and tail-on SECTIONS at the axle: the near plane cuts the bumper away just ahead
    // of the wheels, so the camber and the track read against the arches.
    case 'head': // the front-right wheel (on the left of the frame)
      camera.fov = 12;
      camera.position.set(0.8, 0.42, -7.3);
      camera.lookAt(0.8, 0.42, -1.3);
      camera.near = 7.3 - 1.3 - 0.36;
      break;
    case 'tail': // the rear-right wheel (on the right of the frame)
      camera.fov = 12;
      camera.position.set(0.8, 0.42, 7.3);
      camera.lookAt(0.8, 0.42, 1.3);
      camera.near = 7.3 - 1.3 - 0.36;
      break;
  }
  camera.updateProjectionMatrix();
}

function dress(partial: Cell['loadout']): void {
  const l = sanitizeLoadout({
    ...STOCK_LOADOUT,
    ...partial,
    wheels: { ...STOCK_LOADOUT.wheels, ...(partial.wheels ?? {}) },
    stance: { ...STOCK_LOADOUT.stance, ...(partial.stance ?? {}) },
  });
  car.applyLoadout(l);
  car.resetBody();
  car.update(1 / 60, 0);
}

const labels: HTMLDivElement[] = [];
function label(text: string, x: number, y: number): void {
  const d = document.createElement('div');
  d.textContent = text;
  Object.assign(d.style, {
    position: 'absolute',
    left: `${x + 6}px`,
    top: `${y + 4}px`,
    font: '13px monospace',
    color: '#fff',
    background: 'rgba(0,0,0,.55)',
    padding: '1px 4px',
  });
  document.body.appendChild(d);
  labels.push(d);
}

(window as unknown as { sheet: (cells: Cell[], cols: number) => void }).sheet = (cells, cols) => {
  for (const d of labels.splice(0)) d.remove();
  const rows = Math.ceil(cells.length / cols);
  const cw = Math.floor(W / cols);
  const ch = Math.floor(H / rows);
  renderer.setScissor(0, 0, W, H);
  renderer.setViewport(0, 0, W, H);
  renderer.setClearColor(0x000000);
  renderer.clear();
  cells.forEach((cell, i) => {
    const cx = (i % cols) * cw;
    const cy = Math.floor(i / cols) * ch;
    dress(cell.loadout);
    frame(cell.view, (cw - 2) / (ch - 2));
    // WebGL's viewport origin is bottom-left.
    renderer.setViewport(cx + 1, H - cy - ch + 1, cw - 2, ch - 2);
    renderer.setScissor(cx + 1, H - cy - ch + 1, cw - 2, ch - 2);
    renderer.render(scene, camera);
    if (cell.label) label(cell.label, cx, cy);
  });
};
(window as unknown as { ready: boolean }).ready = true;
