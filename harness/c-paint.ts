/**
 * Agent C's paint harness: one car, one view, one backdrop, from the URL. Screenshotted by
 * `scripts/harness-shots-c.mjs`; open by hand at `/harness/c-paint.html?...` under `npx vite`.
 *
 *   look=new|old          old = the pre-workshop livery (lengthwise uvs + the 512² texture)
 *   base, finish, roof    paint (palette ids, finish name)
 *   v=rayo:magenta,...    vinyl layers (name:colour), bottom first; v= (empty) for none
 *   d=kaminari@sideLeft   decals (name@zone)
 *   plate, text           plate style name and text
 *   bg=studio|night       lit neutral backdrop, or a dark street-ish one
 *   view=q3f|q3r|left|right|rear|front|top|plate
 *   atlas=1               show the paint atlas canvas itself instead of the car
 *
 * `window.__ready` turns true once the frame is final (after the graffiti art has had a moment).
 */
import * as THREE from 'three';
import { createCarVisual } from '../src/render/scene/carVisual';
import { STOCK_LOADOUT, cloneLoadout, sanitizeLoadout, type CarLoadout, type DecalZone } from '../src/core/loadout';
import { applyLengthwiseUVs } from '../src/render/scene/vehicles/geometryKit';
import { createLiveryTexture } from '../src/render/scene/vehicles/livery';
import { composePaint } from '../src/render/scene/vehicles/paintShop';

declare global {
  interface Window {
    __ready?: boolean;
  }
}

const q = new URLSearchParams(location.search);
const W = Number(q.get('w') ?? 1200);
const H = Number(q.get('h') ?? 720);

function loadoutFromQuery(): CarLoadout {
  const l = cloneLoadout(STOCK_LOADOUT);
  if (q.has('base')) l.paint.base = q.get('base')!;
  if (q.has('finish')) l.paint.finish = q.get('finish') as CarLoadout['paint']['finish'];
  if (q.has('roof')) l.paint.roof = q.get('roof')!;
  if (q.has('v')) {
    const v = q.get('v')!;
    l.vinyls = v === '' ? [] : v.split(',').map((s) => {
      const [name, color] = s.split(':');
      return { id: `vinyls.${name}`, color: color ?? 'magenta' };
    });
  }
  if (q.has('d')) {
    l.decals = q.get('d')!.split(',').filter(Boolean).map((s) => {
      const [name, zone] = s.split('@');
      return { id: `decals.${name}`, zone: zone as DecalZone };
    });
  }
  if (q.has('plate')) l.plate.style = `plate.${q.get('plate')}`;
  if (q.has('text')) l.plate.text = q.get('text')!;
  return sanitizeLoadout(l);
}

const loadout = loadoutFromQuery();

if (q.get('atlas') === '1') {
  const cv = document.createElement('canvas');
  cv.width = 1024;
  cv.height = 1024;
  document.body.appendChild(cv);
  composePaint(cv.getContext('2d')!, loadout);
  setTimeout(() => {
    composePaint(cv.getContext('2d')!, loadout);
    window.__ready = true;
  }, 1500);
} else {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const night = q.get('bg') === 'night';
  if (night) {
    renderer.toneMappingExposure = 1.28;
    scene.background = new THREE.Color(0x05060e);
    scene.fog = new THREE.Fog(0x05060e, 18, 40);
    scene.add(new THREE.HemisphereLight(0x2f6f7a, 0x0d1a1c, 1.9));
    const street = new THREE.PointLight(0xffe2b0, 18, 14, 1.6);
    street.position.set(-2.5, 5, -1);
    scene.add(street);
    const neon = new THREE.PointLight(0xff2fd0, 10, 10, 1.6);
    neon.position.set(4, 1.5, 3);
    scene.add(neon);
  } else {
    renderer.toneMappingExposure = 1.0;
    scene.background = new THREE.Color(0x9aa0aa);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x6a6e76, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(-4, 8, -3);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xdfe8ff, 0.9);
    fill.position.set(5, 3, 6);
    scene.add(fill);
  }
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(30, 48),
    new THREE.MeshStandardMaterial({ color: night ? 0x0c0e16 : 0x7c818a, roughness: night ? 0.35 : 0.9, metalness: night ? 0.3 : 0 }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const car = createCarVisual({ loadout });
  scene.add(car.root);

  if (q.get('look') === 'old') {
    // The car as it was before the atlas: the old uvs and the old texture on the same material.
    const body = car.root.getObjectByName('player-car-body') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>;
    applyLengthwiseUVs(body.geometry);
    const tex = createLiveryTexture();
    body.material.map = tex;
    body.material.emissiveMap = tex;
    body.material.needsUpdate = true;
  }

  const views: Record<string, { eye: [number, number, number]; at: [number, number, number]; fov: number }> = {
    q3f: { eye: [-4.6, 2.0, -4.9], at: [0, 0.55, 0], fov: 38 },
    q3r: { eye: [4.6, 2.0, 4.9], at: [0, 0.55, 0], fov: 38 },
    left: { eye: [-7.2, 0.9, 0], at: [0, 0.62, 0], fov: 40 },
    right: { eye: [7.2, 0.9, 0], at: [0, 0.62, 0], fov: 40 },
    rear: { eye: [0, 1.5, 6.6], at: [0, 0.65, 0], fov: 36 },
    front: { eye: [0, 1.6, -6.6], at: [0, 0.6, 0], fov: 36 },
    top: { eye: [0, 8.6, 0.001], at: [0, 0, 0], fov: 36 },
    hood: { eye: [0, 3.2, -4.6], at: [0, 0.7, -0.6], fov: 38 },
    plate: { eye: [0.25, 0.75, 3.5], at: [0, 0.55, 2.1], fov: 22 },
  };
  const v = views[q.get('view') ?? 'q3f'] ?? views.q3f;
  const camera = new THREE.PerspectiveCamera(v.fov, W / H, 0.05, 100);
  camera.position.set(...v.eye);
  camera.lookAt(new THREE.Vector3(...v.at));
  if (q.get('view') === 'top') camera.up.set(0, 0, -1), camera.lookAt(new THREE.Vector3(...v.at));

  const draw = (): void => {
    car.update(1 / 60, 0);
    renderer.render(scene, camera);
  };
  draw();
  // The graffiti art arrives asynchronously and repaints the canvas; give it a moment.
  setTimeout(() => {
    draw();
    window.__ready = true;
  }, 1500);
}
