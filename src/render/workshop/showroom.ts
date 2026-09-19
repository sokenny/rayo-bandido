import * as THREE from 'three';
import { categoryDef, type CameraShot, type CameraShotKey, type CategoryId } from '../../content/carParts';
import { LOCO_MUSTANG_SHOP, type ShopDef } from '../../content/shops';
import type { CarVisual } from '../scene/carVisual';
import { createHumanFigure, type HumanFigureVisual } from '../scene/env/humanRig';
import { LOCO_MUSTANG_LOOK } from '../scene/env/garageFigure';
import type { CrowdSubject } from '../scene/env/humanActs';
import { buildRoom } from './showroomRoom';
import { CAMERA_BOUNDS, ROOM, TABLE } from './showroomLayout';
import { floorTextures, FLOOR_TILE_REPEAT_M, glowTexture, shadowTexture, signSheet, turntableTexture } from './showroomTextures';
import { createFloorReflection } from './floorReflection';
import { createWorkshopCamera, type WorkshopCamera, type WorkshopCameraInput } from './workshopCamera';

/**
 * THE SHOWROOM: Loco Mustang's workshop at night, where the player's car stands on a turntable
 * while it is modded (`docs/GARAGE_PLAN.md` §2.4). A scene of its own, like the menu's backdrop
 * (`menuBackdrop.ts`): the city is not drawn while the workshop is open, so this has the frame to
 * itself. Loaded lazily (`import('./render/workshop/showroom')`) when the player presses the key
 * at the garage; everything is built once in `createShowroom` and freed in `dispose`.
 *
 * INTEGRATOR'S CONTRACT
 *
 *   const showroom = createShowroom(renderer);          // builds the room (~170 ms, once)
 *   showroom.setShop(shop);                              // optional, default Loco Mustang's
 *   showroom.attach(car);                                // re-parents car.root onto the turntable
 *   await showroom.warmUp();                             // shaders compiled under the black fade
 *   showroom.setCategory(firstCategory);                 // the first shot…
 *   showroom.introShot();                                // …swooped into (fade in over it)
 *   // every frame, INSTEAD of rendering the city:
 *   showroom.update(dt, input);                          // table, lights, figure, camera, AND car.update
 *   showroom.render();                                   // reflection pass + main pass
 *   // on every category change:            showroom.setCategory(cat)
 *   // on resize:                           showroom.resize(width, height)
 *   // leaving:  showroom.outroShot(); fade out; showroom.detach(); …; showroom.dispose()
 *
 * - `attach(car)` takes `car.root` from wherever it is (the city scene) and stands it on the
 *   plate, level and centred; `detach()` gives it back to that same parent. While attached, the
 *   showroom OWNS the car's transform and calls `car.update(dt, time)` itself, so the game must
 *   not `syncCar`/`car.update` it too (it would put the root back at its street position). The
 *   body is settled with `resetBody()` on attach. Lamps, neon charge etc. stay the caller's.
 * - It never touches the car's materials. The paint keeps its own env map (`paintEnv.ts`); the
 *   showroom flatters it with real lights (a warm key, a cyan rim, four work lamps) and gives
 *   everything else (glass, rims, floor) a studio `scene.environment`.
 * - `input` is the free look (`WorkshopCameraInput`): per-frame drag in radians, zoom steps, and
 *   whether the player is holding on. Pass `NO_INPUT` when there is none.
 * - `render()` draws into whatever render target is current (the canvas). It reads/sets the
 *   renderer's clear colour and restores `info.autoReset`, so `renderer.info` after it counts
 *   BOTH passes.
 *
 * BUDGET (measured with `scripts/harness-shots-d.mjs`, 1600×900, stock car): the main pass is
 * 28–30 draw calls and ~18k triangles WITH the car (the room alone: 12 batches + the figure's
 * 2); the reflection pass redraws the room's layer-0 batches and the car at half resolution,
 * for 48–55 calls and ~36k triangles in all. Room alone, both passes: 23 calls, 27k triangles.
 * Eight lights, no shadow maps; ~0.5 ms a frame on an M-series GPU.
 */

export interface ShowroomOptions {
  /** The planar floor reflection. On by default; off, the floor is simply glossy. */
  reflections?: boolean;
  /** Its resolution, as a fraction of the drawing buffer (0.5 = a quarter of the pixels). */
  reflectionScale?: number;
  /** Loco Mustang standing by his bench. On by default (two draw calls). */
  figure?: boolean;
}

export interface Showroom {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  /** The rig, for the harness and for anyone who wants `setFraming` or a raw `setShot`. */
  readonly rig: WorkshopCamera;
  attach(car: CarVisual): void;
  detach(): void;
  /** Ease the camera to this category's shot; dims the shop for the neon and light categories. */
  setCategory(category: CategoryId): void;
  /** A shot by key or by value, bypassing the catalogue (the harness, a cutscene). */
  setShot(shot: CameraShotKey | CameraShot, immediate?: boolean): void;
  setShop(shop: ShopDef): void;
  /** Turn the table slowly all the time, whatever the shot (an attract mode). */
  setIdleSpin(on: boolean): void;
  /** The planar floor reflection on or off (a quality step for a slow machine). */
  setReflections(on: boolean): void;
  /** Swoop in from wide onto the current shot (the entry). */
  introShot(): void;
  /** Pull back and up (under the exit fade). */
  outroShot(): void;
  resize(width: number, height: number): void;
  /**
   * Compile every shader the room and the attached car need, off the frame: the first frame
   * otherwise stalls ~200 ms compiling. Call after `attach`, while the entry fade is black.
   */
  warmUp(): Promise<void>;
  update(dt: number, input?: WorkshopCameraInput): void;
  render(): void;
  /** 0 (lit) .. 1 (dimmed for neon), where the lights are now. */
  readonly dim: number;
  dispose(): void;
}

/** No drag, no zoom, not held. */
export const NO_INPUT: Readonly<WorkshopCameraInput> = Object.freeze({ dragYaw: 0, dragPitch: 0, zoom: 0, dragging: false });

/** The lights, by intensity at full and at dimmed. */
const LIGHT = {
  hemi: { sky: 0xffe0bd, ground: 0x2a1e20, on: 0.5, off: 0.1 },
  key: { color: 0xffe3bf, on: 1.9, off: 0.12 },
  rim: { color: 0x6fd6ff, on: 1.6, off: 0.45 },
  fill: { color: 0xffb070, on: 0.45, off: 0.06 },
  lamp: { color: 0xffc27a, on: 6.5, off: 0.5, distance: 10, decay: 1.5 },
  sign: { color: 0xff3b2e, on: 5, off: 5 },
};
/** How the unlit lamp batches dim (colour multiplier). */
const LAMP_DIM = 0.3;
/** Turntable: how fast the idle spin turns, and how briskly it spins up, stops and comes home. */
const IDLE_SPIN = 0.16;
const SPIN_EASE = 1.4;
const HOME_SMOOTH = 0.9;
const DIM_RATE = 3.2;
const BACKGROUND = 0x060608;
/** How strongly everything but the paint reflects the room (`scene.environmentIntensity`), lit and dimmed. */
const ENV_ON = 0.6;
const ENV_OFF = 0.25;

export function createShowroom(renderer: THREE.WebGLRenderer, options: ShowroomOptions = {}): Showroom {
  const scene = new THREE.Scene();
  scene.name = 'workshop-showroom';
  scene.background = new THREE.Color(BACKGROUND);
  scene.fog = new THREE.Fog(BACKGROUND, 16, 34);

  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];
  const own = <T extends THREE.BufferGeometry>(g: T): T => (geometries.push(g), g);
  const mat = <T extends THREE.Material>(m: T): T => (materials.push(m), m);
  const tex = <T extends THREE.Texture>(t: T): T => (textures.push(t), t);

  let shop: ShopDef = LOCO_MUSTANG_SHOP;

  /* ---------------------------------------------------------------- the room */
  const sheet = signSheet();
  tex(sheet.texture);
  const room = buildRoom(sheet.cells, 'LOCO MUSTANG');
  const glow = tex(glowTexture());

  const litMat = mat(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.05, side: THREE.DoubleSide, envMapIntensity: 0.4 }));
  const neonMat = mat(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  const lampMat = mat(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  const additive = (): THREE.MeshBasicMaterial =>
    mat(new THREE.MeshBasicMaterial({ map: glow, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  const neonGlowMat = additive();
  const lampGlowMat = additive();
  const beamMat = mat(
    new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }),
  );
  const signMat = mat(
    new THREE.MeshStandardMaterial({ map: sheet.texture, emissive: 0xffffff, emissiveMap: sheet.texture, emissiveIntensity: 0.28, roughness: 0.55, side: THREE.DoubleSide }),
  );
  const rimMat = mat(new THREE.MeshStandardMaterial({ color: 0x8a9099, roughness: 0.32, metalness: 0.85, side: THREE.DoubleSide, envMapIntensity: 1.4 }));

  const add = (g: THREE.BufferGeometry, m: THREE.Material, name: string, order = 0): THREE.Mesh => {
    const mesh = new THREE.Mesh(own(g), m);
    mesh.name = name;
    mesh.renderOrder = order;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    scene.add(mesh);
    return mesh;
  };
  add(room.lit, litMat, 'showroom-room');
  add(room.signs, signMat, 'showroom-signs');
  add(room.neon, neonMat, 'showroom-neon');
  add(room.lamps, lampMat, 'showroom-lamps');
  add(room.rim, rimMat, 'showroom-turntable-rim');
  add(room.neonGlow, neonGlowMat, 'showroom-neon-glow', 3);
  add(room.lampGlow, lampGlowMat, 'showroom-lamp-glow', 3);
  const beams = add(room.beams, beamMat, 'showroom-beams', 5);
  // The shafts are atmosphere in the air, not objects: not reflected (layer 1 only).
  beams.layers.set(1);

  /* ---------------------------------------------------------------- floor and turntable */
  const reflection = createFloorReflection(TABLE.top, options.reflectionScale ?? 0.5);
  reflection.enabled = options.reflections !== false;

  const floorTex = floorTextures();
  tex(floorTex.map);
  tex(floorTex.roughness);
  const floorW = ROOM.maxX - ROOM.minX;
  const floorD = ROOM.maxZ - ROOM.minZ;
  floorTex.map.repeat.set(floorW / FLOOR_TILE_REPEAT_M, floorD / FLOOR_TILE_REPEAT_M);
  floorTex.roughness.repeat.copy(floorTex.map.repeat);
  const floorMat = mat(
    new THREE.MeshStandardMaterial({ map: floorTex.map, roughnessMap: floorTex.roughness, roughness: 0.5, metalness: 0.1, envMapIntensity: 0.5 }),
  );
  reflection.reflective(floorMat, 0.45, 2.2);
  const floor = add(new THREE.PlaneGeometry(floorW, floorD).rotateX(-Math.PI / 2).translate((ROOM.minX + ROOM.maxX) / 2, 0, (ROOM.minZ + ROOM.maxZ) / 2), floorMat, 'showroom-floor');

  // The plate turns; the car rides on it.
  const table = new THREE.Group();
  table.name = 'showroom-turntable';
  scene.add(table);
  const plateTex = tex(turntableTexture('LOCO MUSTANG'));
  const plateMat = mat(new THREE.MeshStandardMaterial({ map: plateTex, roughness: 0.28, metalness: 0.3, envMapIntensity: 0.12 }));
  reflection.reflective(plateMat, 0.75, 1.3);
  const plate = new THREE.Mesh(own(new THREE.CircleGeometry(TABLE.radius, 72).rotateX(-Math.PI / 2)), plateMat);
  plate.name = 'showroom-turntable-plate';
  plate.position.y = TABLE.top;
  table.add(plate);

  // The car's contact shadow on the plate: soft, turning with it.
  const shadowMat = mat(new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: tex(shadowTexture()), transparent: true, opacity: 0.8, depthWrite: false }));
  const shadow = new THREE.Mesh(own(new THREE.PlaneGeometry(2.5, 5.2).rotateX(-Math.PI / 2)), shadowMat);
  shadow.name = 'showroom-car-shadow';
  shadow.position.y = TABLE.top + 0.004;
  shadow.renderOrder = 1;
  table.add(shadow);

  // Where the car stands: on the plate, above the shadow.
  const mount = new THREE.Group();
  mount.name = 'showroom-car-mount';
  mount.position.y = TABLE.top;
  table.add(mount);

  /* ---------------------------------------------------------------- lights */
  const hemi = new THREE.HemisphereLight(LIGHT.hemi.sky, LIGHT.hemi.ground, LIGHT.hemi.on);
  scene.add(hemi);
  // Key: warm, high off the front-left, the long highlight down the bonnet and the flank.
  const key = new THREE.DirectionalLight(LIGHT.key.color, LIGHT.key.on);
  key.position.set(-4.5, 7.5, -4);
  scene.add(key);
  // Rim: cyan from behind and to the right, to cut the car's outline out of the dark back wall.
  const rim = new THREE.DirectionalLight(LIGHT.rim.color, LIGHT.rim.on);
  rim.position.set(5.5, 3.2, 7);
  scene.add(rim);
  // Fill: low and warm from the other side, so the shadow side is never black.
  const fill = new THREE.DirectionalLight(LIGHT.fill.color, LIGHT.fill.on);
  fill.position.set(6, 1.2, -5);
  scene.add(fill);
  const lamps: THREE.PointLight[] = room.lampsOverTable.map((l) => {
    const p = new THREE.PointLight(LIGHT.lamp.color, LIGHT.lamp.on, LIGHT.lamp.distance, LIGHT.lamp.decay);
    p.position.set(l.x, l.y - 0.1, l.z);
    scene.add(p);
    return p;
  });
  const signLight = new THREE.PointLight(LIGHT.sign.color, LIGHT.sign.on, 7, 1.6);
  signLight.position.set(-1.5, 3.2, ROOM.maxZ - 1.2);
  scene.add(signLight);

  /* ---------------------------------------------------------------- the room, as its own reflection */
  // Everything that is not the paint (which has its own map: glass, rims, floor, plate, cabs)
  // reflects the room itself, captured once from a metre above the table. A studio map (three's
  // RoomEnvironment) was tried first: its big white ceiling panels put a grey haze on every
  // polished surface seen from above, which no garage at night has.
  const envTarget = (() => {
    const pmrem = new THREE.PMREMGenerator(renderer);
    reflection.enabled = false;
    table.visible = false;
    beams.visible = false;
    scene.position.y = -1.3; // PMREM captures from the origin: lift it off the floor.
    scene.updateMatrixWorld(true);
    const target = pmrem.fromScene(scene, 0.03, 0.1, 60);
    scene.position.y = 0;
    scene.updateMatrixWorld(true);
    beams.visible = true;
    table.visible = true;
    reflection.enabled = options.reflections !== false;
    pmrem.dispose();
    return target;
  })();
  scene.environment = envTarget.texture;
  scene.environmentIntensity = ENV_ON;

  /* ---------------------------------------------------------------- the man */
  let figure: HumanFigureVisual | null = null;
  const watch: CrowdSubject = { x: 0, z: 0, speed: 0, drifting: false };
  if (options.figure !== false) {
    figure = createHumanFigure(LOCO_MUSTANG_LOOK, { name: 'showroom-loco-mustang', phase: 0.99 });
    figure.group.position.set(room.figure.x, 0, room.figure.z);
    figure.group.rotation.y = room.figure.rotY;
    scene.add(figure.group);
  }

  /* ---------------------------------------------------------------- camera */
  const rig = createWorkshopCamera({ bounds: CAMERA_BOUNDS });
  const camera = rig.camera;
  camera.layers.enable(1);
  {
    const size = renderer.getSize(new THREE.Vector2());
    camera.aspect = size.x / Math.max(1, size.y);
  }

  /* ---------------------------------------------------------------- state */
  let car: CarVisual | null = null;
  let carParent: THREE.Object3D | null = null;
  let time = 0;
  let turn = 0;
  let spin = 0;
  const homeVel = new Float64Array(1);
  let idleSpin = false;
  let dimTarget = 0;
  let dim = 0;
  let disposed = false;
  const rigState = { originY: TABLE.top, turntableYaw: 0 };
  const hideInReflection: THREE.Object3D[] = [floor, plate, shadow];
  const lampBase = new THREE.Color(1, 1, 1);

  function applyDim(): void {
    const k = dim;
    const lerp = (a: number, b: number): number => a + (b - a) * k;
    hemi.intensity = lerp(LIGHT.hemi.on, LIGHT.hemi.off);
    key.intensity = lerp(LIGHT.key.on, LIGHT.key.off);
    rim.intensity = lerp(LIGHT.rim.on, LIGHT.rim.off);
    fill.intensity = lerp(LIGHT.fill.on, LIGHT.fill.off);
    // One of the work lamps is an old bulb: a faint flutter, never a strobe.
    const flutter = 1 - 0.06 * Math.max(0, Math.sin(time * 13.7) * Math.sin(time * 3.1));
    for (let i = 0; i < lamps.length; i++) lamps[i].intensity = lerp(LIGHT.lamp.on, LIGHT.lamp.off) * (i === 2 ? flutter : 1);
    const lampK = lerp(1, LAMP_DIM);
    lampMat.color.copy(lampBase).multiplyScalar(lampK);
    lampGlowMat.color.copy(lampBase).multiplyScalar(lampK);
    beamMat.color.copy(lampBase).multiplyScalar(lerp(1, 0.15));
    signMat.emissiveIntensity = lerp(0.28, 0.12);
    scene.environmentIntensity = lerp(ENV_ON, ENV_OFF);
  }
  applyDim();

  function pinCar(): void {
    if (!car) return;
    const r = car.root;
    r.position.set(0, 0, 0);
    r.rotation.set(0, 0, 0);
  }

  const api: Showroom = {
    scene,
    camera,
    rig,
    get dim() {
      return dim;
    },
    attach(next) {
      if (car) api.detach();
      car = next;
      carParent = next.root.parent;
      mount.add(next.root);
      pinCar();
      next.resetBody();
    },
    detach() {
      if (!car) return;
      mount.remove(car.root);
      if (carParent) carParent.add(car.root);
      car = null;
      carParent = null;
    },
    setCategory(category) {
      const def = categoryDef(category);
      rig.setShot(def.cameraShot);
      dimTarget = def.dimShowroom ? 1 : 0;
    },
    setShot(shot, immediate) {
      rig.setShot(shot, immediate);
    },
    setShop(next) {
      shop = next;
      // Only his own shop has him in it; another workshop would bring its own person.
      if (figure) figure.group.visible = shop.npc === 'loco-mustang';
    },
    setIdleSpin(on) {
      idleSpin = on;
    },
    setReflections(on) {
      reflection.enabled = on;
    },
    introShot() {
      rig.intro();
    },
    outroShot() {
      rig.outro();
    },
    resize(width, height) {
      camera.aspect = width / Math.max(1, height);
    },
    async warmUp() {
      await renderer.compileAsync(scene, camera);
    },
    update(dt, input = NO_INPUT) {
      if (disposed) return;
      dt = dt > 0.1 ? 0.1 : dt < 0 ? 0 : dt;
      time += dt;

      // The table: spun by an orbit shot or idle spin, otherwise brought to a stop and home.
      const want = idleSpin ? IDLE_SPIN : rig.orbitSpeed;
      spin += (want - spin) * (1 - Math.exp(-dt * SPIN_EASE));
      if (want !== 0 || Math.abs(spin) > 0.02) {
        turn += spin * dt;
        homeVel[0] = 0;
      } else {
        spin = 0;
        // Home by the short way round.
        let rest = turn % (Math.PI * 2);
        if (rest > Math.PI) rest -= Math.PI * 2;
        if (rest < -Math.PI) rest += Math.PI * 2;
        turn = rest;
        const omega = 2 / HOME_SMOOTH;
        const x = omega * dt;
        const k = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
        const temp = (homeVel[0] + omega * turn) * dt;
        homeVel[0] = (homeVel[0] - omega * temp) * k;
        turn = (turn + temp) * k;
      }
      if (turn > Math.PI * 64 || turn < -Math.PI * 64) turn %= Math.PI * 2;
      table.rotation.y = turn;

      dim += (dimTarget - dim) * (1 - Math.exp(-dt * DIM_RATE));
      applyDim();

      rigState.turntableYaw = turn;
      rig.update(dt, input, rigState);

      if (car) {
        pinCar();
        car.update(dt, time);
      }
      if (figure && figure.group.visible) figure.update(time, watch);
    },
    render() {
      const autoReset = renderer.info.autoReset;
      renderer.info.autoReset = false;
      renderer.info.reset();
      table.updateMatrixWorld();
      reflection.render(renderer, scene, camera, hideInReflection);
      renderer.render(scene, camera);
      renderer.info.autoReset = autoReset;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      api.detach();
      if (figure) figure.dispose();
      reflection.dispose();
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      for (const t of textures) t.dispose();
      envTarget.dispose();
      scene.environment = null;
      scene.clear();
    },
  };
  return api;
}
