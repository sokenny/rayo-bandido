import * as THREE from 'three';
import { METRO_GARAGE, METRO_MEET, METRO_MEET_LOT, OUTER_ROADS, STACK_RECT, VIADUCT_SPEC } from '../world/metroSpec';
import { buildTrackPath, type TrackSample } from '../world/track';
import type { Rect } from '../world/cityPlan';
import { createMeetVisual } from './scene/meetVisual';

/**
 * THE MENU'S BACKDROP: La Curva, the car meet under the viaduct, behind the menus.
 *
 * Not the city. The metro takes seconds to build and hundreds of draw calls to show, and a menu
 * that did that would be a menu nobody could click for a while. So this is a diorama of the one
 * corner of the map that says what the game is — the meet's sixteen tuned cars and its crowd,
 * which are the real ones (`meetVisual.ts`, seven draw calls) — set inside a HOLOGRAM of the
 * rest: the real road grid and the viaduct's real curve drawn as light, the blocks between
 * them as wireframe massing, and headlights running round the deck overhead. The camera comes
 * down out of the map and settles crouched by one car's front corner, and leans a little with
 * the mouse so the lot slides the other way.
 *
 * It is loaded after the menu is interactive (`ui/menuBackdropLoader.ts`), draws into the game
 * canvas — which a menu never uses — at a reduced resolution and thirty frames a second, stops
 * while the tab is hidden, and steps itself down, then to a still frame, on a machine that
 * cannot keep up. Everything is built once; nothing is allocated per frame.
 */
export interface MenuBackdrop {
  dispose(): void;
}

export interface MenuBackdropOptions {
  /** Called once the first frame is on the canvas, so the page can fade it in. */
  onFirstFrame?(): void;
}

/** Fraction of the device pixel ratio drawn at, and the floor it steps down to. */
const RESOLUTION = 0.85;
const RESOLUTION_LOW = 0.45;
const FRAME_MS = 1000 / 30;
/** How long the camera takes to come down onto the lot (s). */
const DESCENT_S = 7;
/**
 * Where the camera settles: crouched off the front corner of ONE car, the west end of the fan under
 * the mast (lamps on, wheels turned), so the car fills the frame and the rest of the fan, the crowd
 * and the viaduct's curve with its traffic sit behind it. In the hero's own frame (m): `side` along
 * its left, `ahead` along its nose.
 */
const HERO = METRO_MEET.cars.reduce((best, c) => (Math.hypot(c.x + 583.6, c.z - 319.2) < Math.hypot(best.x + 583.6, best.z - 319.2) ? c : best));
const SHOT = { side: 3.1, ahead: 6.3, height: 0.9, lookBack: 0.9, lookUp: 2.3 };
/** How far the mouse moves the camera (m), sideways and up; the scene slides the other way. */
const PARALLAX = { x: 0.55, y: 0.3 };

const HOLO_CYAN = 0x4ff3ff;
const HOLO_YELLOW = 0xfcee0a;
const HOLO_RED = 0xff2b3d;
const NIGHT = 0x06060c;

function hash01(a: number, b: number): number {
  return Math.abs(Math.sin(a * 12.9898 + b * 78.233) * 43758.5453) % 1;
}

function overlaps(a: Rect, b: Rect, pad = 0): boolean {
  return a.minX < b.maxX + pad && a.maxX > b.minX - pad && a.minZ < b.maxZ + pad && a.maxZ > b.minZ - pad;
}

function lineMaterial(color: number, opacity: number): THREE.LineBasicMaterial {
  return new THREE.LineBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
}

/** A soft round spot, for the light cars throw on the ground. */
function glowTexture(): THREE.CanvasTexture {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function startMenuBackdrop(canvas: HTMLCanvasElement, options: MenuBackdropOptions = {}): MenuBackdrop {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'low-power' });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.8;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(NIGHT, 1);
  let resolution = RESOLUTION;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(NIGHT, 0.0024);
  const camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.5, 2400);

  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];
  const own = <T extends THREE.BufferGeometry>(g: T): T => (geometries.push(g), g);
  const mat = <T extends THREE.Material>(m: T): T => (materials.push(m), m);

  /* ---------------------------------------------------------------- light */

  scene.add(new THREE.HemisphereLight(0x6a7ac0, 0x1a0c1c, 2.2));
  const moon = new THREE.DirectionalLight(0x8fd8ff, 1.4);
  moon.position.set(-420, 260, 120);
  scene.add(moon);
  // A cold key light over the lens's shoulder, so the hero's paint and bodywork read up close.
  const key = new THREE.PointLight(0xbfe6ff, 26, 14, 1.4);
  key.position.set(HERO.x + Math.sin(HERO.heading) * 6 - Math.cos(HERO.heading) * 4, 3.2, HERO.z - Math.cos(HERO.heading) * 6 - Math.sin(HERO.heading) * 4);
  scene.add(key);
  // The fan of cars has its lamps on, and the mast over it is sodium.
  const sodium = new THREE.PointLight(0xffb86b, 70, 34, 1.4);
  sodium.position.set(-576, 8, 314);
  scene.add(sodium);
  const neon = new THREE.PointLight(0xff2fb4, 14, 30, 1.4);
  neon.position.set(-534, 6, 326);
  scene.add(neon);

  /* ---------------------------------------------------------------- ground */

  const lotW = METRO_MEET_LOT.maxX - METRO_MEET_LOT.minX;
  const lotD = METRO_MEET_LOT.maxZ - METRO_MEET_LOT.minZ;
  // Wet black asphalt: low roughness so the lamps and the neon smear across it.
  const lot = new THREE.Mesh(
    own(new THREE.PlaneGeometry(lotW + 40, lotD + 40)),
    mat(new THREE.MeshStandardMaterial({ color: 0x0e0f16, roughness: 0.85, metalness: 0.05 })),
  );
  lot.rotation.x = -Math.PI / 2;
  lot.position.set((METRO_MEET_LOT.minX + METRO_MEET_LOT.maxX) / 2, 0, (METRO_MEET_LOT.minZ + METRO_MEET_LOT.maxZ) / 2);
  scene.add(lot);

  // The floor of the hologram: a 20 m grid out to the fog.
  {
    const pts: number[] = [];
    const cx = -560;
    const cz = 300;
    const span = 1400;
    for (let d = -span; d <= span; d += 20) {
      pts.push(cx + d, 0.02, cz - span, cx + d, 0.02, cz + span);
      pts.push(cx - span, 0.02, cz + d, cx + span, 0.02, cz + d);
    }
    const g = own(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    scene.add(new THREE.LineSegments(g, mat(lineMaterial(0x1d3c66, 0.22))));
  }

  /* ---------------------------------------------------------------- the map, in light */

  // The real road grid: every straight outer road's two kerbs, and the blocks between them.
  const xs = new Map<number, number>();
  const zs = new Map<number, number>();
  const roadPts: number[] = [];
  for (const road of OUTER_ROADS) {
    const nodes = road.spec.nodes;
    const a = nodes[0];
    const b = nodes[nodes.length - 1];
    const h = a.width / 2;
    if (Math.abs(a.x - b.x) < 0.01) {
      xs.set(a.x, h);
      roadPts.push(a.x - h, 0.05, a.z, b.x - h, 0.05, b.z, a.x + h, 0.05, a.z, b.x + h, 0.05, b.z);
    } else if (Math.abs(a.z - b.z) < 0.01) {
      zs.set(a.z, h);
      roadPts.push(a.x, 0.05, a.z - h, b.x, 0.05, b.z - h, a.x, 0.05, a.z + h, b.x, 0.05, b.z + h);
    }
  }
  {
    const g = own(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.Float32BufferAttribute(roadPts, 3));
    scene.add(new THREE.LineSegments(g, mat(lineMaterial(HOLO_CYAN, 0.4))));
  }

  // Massing: a few towers a block, taller toward downtown, as edges only. One draw call.
  {
    const gx = [...xs.keys()].sort((p, q) => p - q);
    const gz = [...zs.keys()].sort((p, q) => p - q);
    const keepOut: Rect[] = [METRO_MEET_LOT, METRO_GARAGE.lot];
    const box = new THREE.BoxGeometry(1, 1, 1);
    const edges = new THREE.EdgesGeometry(box);
    box.dispose();
    const unit = edges.getAttribute('position').array as ArrayLike<number>;
    const pts: number[] = [];
    const addTower = (x0: number, x1: number, z0: number, z1: number, height: number): void => {
      const w = x1 - x0;
      const d = z1 - z0;
      for (let i = 0; i < unit.length; i += 3) {
        pts.push(x0 + (unit[i] + 0.5) * w, (unit[i + 1] + 0.5) * height, z0 + (unit[i + 2] + 0.5) * d);
      }
    };
    for (let i = 0; i < gx.length - 1; i++) {
      for (let j = 0; j < gz.length - 1; j++) {
        const block: Rect = {
          minX: gx[i] + xs.get(gx[i])! + 6,
          maxX: gx[i + 1] - xs.get(gx[i + 1])! - 6,
          minZ: gz[j] + zs.get(gz[j])! + 6,
          maxZ: gz[j + 1] - zs.get(gz[j + 1])! - 6,
        };
        const bw = block.maxX - block.minX;
        const bd = block.maxZ - block.minZ;
        if (bw < 12 || bd < 12) continue;
        // Downtown is its own city of towers; drawn below, not as the outer grid's blocks.
        if (overlaps(block, STACK_RECT)) continue;
        const cols = Math.max(1, Math.round(bw / 45));
        const rows = Math.max(1, Math.round(bd / 45));
        for (let c = 0; c < cols; c++) {
          for (let r = 0; r < rows; r++) {
            const x0 = block.minX + (bw / cols) * c + 3;
            const x1 = block.minX + (bw / cols) * (c + 1) - 3;
            const z0 = block.minZ + (bd / rows) * r + 3;
            const z1 = block.minZ + (bd / rows) * (r + 1) - 3;
            const plot: Rect = { minX: x0, maxX: x1, minZ: z0, maxZ: z1 };
            if (keepOut.some((k) => overlaps(plot, k, 4))) continue;
            const seed = hash01(x0, z0);
            if (seed < 0.12) continue;
            const toTown = Math.hypot((x0 + x1) / 2, (z0 + z1) / 2 + 120);
            const base = toTown < 700 ? 42 : 22;
            // Low round the lot, so the blocks next to the camera frame the meet instead of hiding it.
            const toLot = Math.hypot((x0 + x1) / 2 - HERO.x, (z0 + z1) / 2 - HERO.z);
            addTower(x0, x1, z0, z1, toLot < 200 ? 8 + seed * 10 : base + seed * seed * 70);
          }
        }
      }
    }
    // Downtown, The Stack: a crowd of tall thin towers.
    for (let k = 0; k < 70; k++) {
      const u = hash01(k, 3.1);
      const v = hash01(k, 7.7);
      const x = STACK_RECT.minX + 30 + u * (STACK_RECT.maxX - STACK_RECT.minX - 60);
      const z = STACK_RECT.minZ + 30 + v * (STACK_RECT.maxZ - STACK_RECT.minZ - 60);
      const s = 14 + hash01(k, 1.3) * 22;
      addTower(x - s, x + s, z - s, z + s, 80 + hash01(k, 9.2) * 190);
    }
    const g = own(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    edges.dispose();
    scene.add(new THREE.LineSegments(g, mat(lineMaterial(HOLO_CYAN, 0.36))));
  }

  /* ---------------------------------------------------------------- the viaduct */

  const via = buildTrackPath(VIADUCT_SPEC);
  const samples: TrackSample[] = via.samples;
  {
    // The deck: a faint slab, its two edges and its rails in yellow, and a column pair every 36 m.
    const slab: number[] = [];
    const index: number[] = [];
    const edge: number[] = [];
    const column: number[] = [];
    let lastColumn = -Infinity;
    for (let i = 0; i < samples.length; i++) {
      const p = samples[i];
      const nx = -p.tz * p.halfWidth;
      const nz = p.tx * p.halfWidth;
      slab.push(p.x - nx, p.y, p.z - nz, p.x + nx, p.y, p.z + nz);
      const q = samples[(i + 1) % samples.length];
      if (i + 1 < samples.length || via.closed) {
        const a = i * 2;
        const b = ((i + 1) % samples.length) * 2;
        index.push(a, b, a + 1, a + 1, b, b + 1);
        const mx = -q.tz * q.halfWidth;
        const mz = q.tx * q.halfWidth;
        for (const side of [-1, 1]) {
          edge.push(p.x + side * nx, p.y, p.z + side * nz, q.x + side * mx, q.y, q.z + side * mz);
          edge.push(p.x + side * nx, p.y + 1.1, p.z + side * nz, q.x + side * mx, q.y + 1.1, q.z + side * mz);
        }
      }
      if (p.s - lastColumn >= 36) {
        lastColumn = p.s;
        for (const side of [-0.6, 0.6]) {
          const cx = p.x + side * nx;
          const cz = p.z + side * nz;
          column.push(cx, 0, cz, cx, p.y - 1.2, cz);
          column.push(cx - 0.8, p.y - 1.2, cz, cx + 0.8, p.y - 1.2, cz);
        }
      }
    }
    const slabGeo = own(new THREE.BufferGeometry());
    slabGeo.setAttribute('position', new THREE.Float32BufferAttribute(slab, 3));
    slabGeo.setIndex(index);
    scene.add(
      new THREE.Mesh(
        slabGeo,
        mat(new THREE.MeshBasicMaterial({ color: 0x3a1030, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false })),
      ),
    );
    const edgeGeo = own(new THREE.BufferGeometry());
    edgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(edge, 3));
    scene.add(new THREE.LineSegments(edgeGeo, mat(lineMaterial(HOLO_YELLOW, 0.75))));
    const colGeo = own(new THREE.BufferGeometry());
    colGeo.setAttribute('position', new THREE.Float32BufferAttribute(column, 3));
    scene.add(new THREE.LineSegments(colGeo, mat(lineMaterial(HOLO_RED, 0.45))));
  }

  // Traffic on the deck: head lamps one way, tail lamps the other. One instanced mesh.
  const TRAFFIC = 44;
  const traffic = new THREE.InstancedMesh(
    own(new THREE.BoxGeometry(1.7, 0.45, 3.8)),
    mat(new THREE.MeshBasicMaterial({ color: 0xffffff, fog: true, toneMapped: false })),
    TRAFFIC,
  );
  const lanes = Array.from({ length: TRAFFIC }, (_, i) => ({
    station: hash01(i, 5.5) * via.length,
    speed: (i % 2 === 0 ? 1 : -1) * (24 + hash01(i, 2.2) * 12),
    offset: (i % 2 === 0 ? 1 : -1) * (i % 4 < 2 ? 2 : 5.5),
  }));
  {
    const tint = new THREE.Color();
    for (let i = 0; i < TRAFFIC; i++) traffic.setColorAt(i, lanes[i].speed > 0 ? tint.set(0xfff1d6).multiplyScalar(3) : tint.set(HOLO_RED).multiplyScalar(3));
  }
  traffic.frustumCulled = false;
  scene.add(traffic);
  const spacing = via.length / samples.length;
  const trafficMatrix = new THREE.Matrix4();
  const trafficQuat = new THREE.Quaternion();
  const trafficPos = new THREE.Vector3();
  const trafficScale = new THREE.Vector3(1, 1, 1);
  const yAxis = new THREE.Vector3(0, 1, 0);
  function stepTraffic(dt: number): void {
    for (let i = 0; i < TRAFFIC; i++) {
      const lane = lanes[i];
      lane.station = (lane.station + lane.speed * dt + via.length) % via.length;
      const f = lane.station / spacing;
      const a = samples[Math.floor(f) % samples.length];
      const b = samples[(Math.floor(f) + 1) % samples.length];
      const t = f - Math.floor(f);
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      trafficPos.set(x - a.tz * lane.offset, a.y + 0.6, z + a.tx * lane.offset);
      trafficQuat.setFromAxisAngle(yAxis, Math.atan2(a.tx, a.tz));
      traffic.setMatrixAt(i, trafficMatrix.compose(trafficPos, trafficQuat, trafficScale));
    }
    traffic.instanceMatrix.needsUpdate = true;
  }

  /* ---------------------------------------------------------------- the meet */

  const meet = createMeetVisual([METRO_MEET]);
  scene.add(meet.root);

  // The light each car throws on the lot: its underglow, one additive instanced quad.
  {
    const cars = METRO_MEET.cars;
    const tex = glowTexture();
    textures.push(tex);
    const pools = new THREE.InstancedMesh(
      own(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)),
      mat(new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })),
      cars.length,
    );
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const c = new THREE.Color();
    for (let i = 0; i < cars.length; i++) {
      const car = cars[i];
      m.compose(new THREE.Vector3(car.x, 0.04, car.z), q.setFromAxisAngle(yAxis, -car.heading), new THREE.Vector3(3.4, 1, 5.8));
      pools.setMatrixAt(i, m);
      pools.setColorAt(i, c.set(car.glow ?? HOLO_CYAN).multiplyScalar(0.55));
    }
    scene.add(pools);
  }

  // The lot's outline and bay lines, in the same light as the map, so the diorama sits in it.
  {
    const L = METRO_MEET_LOT;
    const pts = [L.minX, 0.06, L.minZ, L.maxX, 0.06, L.minZ, L.maxX, 0.06, L.minZ, L.maxX, 0.06, L.maxZ, L.maxX, 0.06, L.maxZ, L.minX, 0.06, L.maxZ, L.minX, 0.06, L.maxZ, L.minX, 0.06, L.minZ];
    for (let x = -558; x < -515; x += 3.1) pts.push(x, 0.06, L.minZ + 1, x, 0.06, L.minZ + 6.2);
    const g = own(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    scene.add(new THREE.LineSegments(g, mat(lineMaterial(HOLO_YELLOW, 0.4))));
  }

  /* ---------------------------------------------------------------- camera and loop */

  const from = new THREE.Vector3(-260, 330, 60);
  const lookFrom = new THREE.Vector3(-470, 0, 260);
  const eye = new THREE.Vector3();
  const look = new THREE.Vector3();
  // The hero's nose and flanks on the ground (heading 0 is -z, clockwise positive, as in `meetVisual.ts`).
  const heroFwd = new THREE.Vector3(Math.sin(HERO.heading), 0, -Math.cos(HERO.heading));
  const heroRight = new THREE.Vector3(Math.cos(HERO.heading), 0, Math.sin(HERO.heading));
  const heroLeft = heroRight.clone().negate();
  /** Pointer in [-1, 1] from the middle of the window, and where the camera has eased to so far. */
  const pointer = { x: 0, y: 0 };
  const parallax = { x: 0, y: 0 };
  const onPointer = (e: PointerEvent): void => {
    if (e.pointerType !== 'mouse') return;
    pointer.x = (e.clientX / Math.max(1, window.innerWidth)) * 2 - 1;
    pointer.y = (e.clientY / Math.max(1, window.innerHeight)) * 2 - 1;
  };
  window.addEventListener('pointermove', onPointer, { passive: true });
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

  /** Where the camera is at `t` seconds: down out of the map, then a slow drift round the fan of cars. */
  function aim(t: number): void {
    // Low off the hero's front-left corner, breathing a little so the still never looks frozen.
    const side = SHOT.side + Math.sin(t * 0.11) * 0.35;
    const ahead = SHOT.ahead + Math.sin(t * 0.07) * 0.5;
    eye.set(
      HERO.x + heroFwd.x * ahead + heroLeft.x * side,
      SHOT.height + Math.sin(t * 0.09) * 0.12,
      HERO.z + heroFwd.z * ahead + heroLeft.z * side,
    );
    look.set(HERO.x - heroFwd.x * SHOT.lookBack, SHOT.lookUp, HERO.z - heroFwd.z * SHOT.lookBack);
    // The mouse: the camera leans toward it, so the lot behind the car slides the other way.
    eye.addScaledVector(heroRight, -parallax.x * PARALLAX.x);
    eye.y += parallax.y * PARALLAX.y;
    if (!reduced && t < DESCENT_S) {
      const u = t / DESCENT_S;
      const e = 1 - Math.pow(1 - u, 3);
      eye.lerpVectors(from, eye, e);
      look.lerpVectors(lookFrom, look, Math.min(1, e * 1.15));
    }
    camera.position.copy(eye);
    camera.lookAt(look);
  }

  function resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2) * resolution);
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    // A narrow screen needs a wider lens to keep the fan of cars in it.
    camera.fov = camera.aspect < 1 ? 62 : 42;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);

  let raf = 0;
  let disposed = false;
  let started = -1;
  let last = -1;
  let clock = reduced ? DESCENT_S : 0;
  let first = true;
  // Frame budget watch: a machine that cannot hold the rate is stepped down, then stopped on a still.
  let slowFrames = 0;
  let sampled = 0;
  let still = false;

  function frame(now: number): void {
    if (disposed) return;
    raf = requestAnimationFrame(frame);
    if (started < 0) started = last = now;
    const elapsed = now - last;
    if (elapsed < FRAME_MS - 2) return;
    last = now;
    // A hidden tab or a long stall should not jump the camera: at most a tenth of a second a frame.
    const dt = Math.min(elapsed / 1000, 0.1);
    clock += dt;

    const t0 = performance.now();
    // Eased, frame-rate independent: about a third of a second to catch up with the mouse.
    const ease = 1 - Math.exp(-dt * 3.2);
    parallax.x += (pointer.x - parallax.x) * ease;
    parallax.y += (pointer.y - parallax.y) * ease;
    aim(clock);
    stepTraffic(dt);
    meet.update(camera.position.x, camera.position.z, clock, dt, null);
    renderer.render(scene, camera);
    const cost = performance.now() - t0;

    if (first) {
      first = false;
      options.onFirstFrame?.();
    }
    if (clock > 1.5) {
      sampled++;
      if (elapsed > 48 || cost > 22) slowFrames++;
      if (sampled >= 60) {
        if (slowFrames > 20) {
          if (resolution > RESOLUTION_LOW) {
            resolution = RESOLUTION_LOW;
            resize();
          } else {
            still = true;
          }
        }
        sampled = 0;
        slowFrames = 0;
      }
    }
    if (still) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  }

  const onVisibility = (): void => {
    if (disposed || still) return;
    if (document.hidden) {
      cancelAnimationFrame(raf);
      raf = 0;
    } else if (!raf) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  };
  document.addEventListener('visibilitychange', onVisibility);
  raf = requestAnimationFrame(frame);

  // QA (`?debug=1`): the Browser pane pauses rAF while hidden, so a frame can be forced at any clock.
  if (new URLSearchParams(location.search).has('debug')) {
    (window as unknown as { __rbMenu?: unknown }).__rbMenu = {
      scene,
      camera,
      renderer,
      samples,
      at(t: number, mx = 0, my = 0) {
        clock = t;
        parallax.x = pointer.x = mx;
        parallax.y = pointer.y = my;
        aim(clock);
        stepTraffic(1 / 30);
        meet.update(camera.position.x, camera.position.z, clock, 1 / 30, null);
        renderer.render(scene, camera);
        if (first) {
          first = false;
          options.onFirstFrame?.();
        }
      },
    };
  }

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onPointer);
      document.removeEventListener('visibilitychange', onVisibility);
      meet.dispose();
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      for (const t of textures) t.dispose();
      traffic.dispose();
      renderer.dispose();
    },
  };
}

