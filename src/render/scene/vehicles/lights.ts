import * as THREE from 'three';
import { STOCK_LOADOUT, type CarLoadout, type ColorId, type PartId } from '../../../core/loadout';
import { findColor } from '../../../content/carParts';
import { box, mergeParts, part } from './geometryKit';
import { exhaustOutlets, type ExhaustOutlet } from './parts/exhaustTips';

/**
 * THE CAR'S LAMPS: head lights, tail lights, reverse lights and the exhaust flame. OWNED BY
 * agent G (`docs/GARAGE_PLAN.md` §2.7, Ola 1).
 *
 * CONTRACT
 * - `createCarLights(chassis, loadout)` builds four meshes and adds them to `chassis` in this
 *   order: head, tail, reverse, exhaust glow. Four of the car's fourteen draw calls; the order
 *   is the order they have always been added in (`tests/carVisualStock.test.ts` walks it).
 * - `setNitro` / `setBraking` / `setReversing` are the per-frame-safe controls `CarVisual`
 *   forwards; they allocate nothing.
 * - `applyLoadout(loadout)` is workshop-time: it rebuilds the head/tail shapes and the exhaust
 *   flame discs when their part changes (disposing what it replaces), sets the head lamps'
 *   colour from `lights.headColor`, and never creates or drops a mesh or a material.
 * - Whatever the shape, the tail lights are red, go brighter red on the brakes and blend to
 *   magenta with nitro (`AGENTS.md` visual rules): the shapes only change the silhouette and how
 *   much of it is lit, never the hue the tail lamp material is driven to.
 *
 * SHAPES. `buildHeadGeometry(id)` / `buildTailGeometry(id)` draw the lamp silhouettes; each id
 * also has a row in `HEAD_STYLE` / `TAIL_STYLE` (how hard it glows, whether the vertex colours
 * shade the glow). Every shape stays inside the stock lamps' envelope — heads on the nose face
 * at z ≈ -2.2..-2.06, tails at z ≈ 2.08..2.16 above the plate — so any bumper agent A sells
 * fits round them. The one exception is the pop-up set, whose pods stand on the hood's leading
 * edge (z ≈ -2.0, y ≈ 0.66..0.78), clear of the stock hood vents at z ≈ -1.34.
 *
 * LAMP TINT. A `MeshStandardMaterial`'s vertex colours only shade its diffuse, never its
 * emissive, so a lamp mesh glows one flat colour. Every shape but stock wants a lens that is
 * lit unevenly (a smoked lens, a dim projector ring, an amber turn strip, yellow fogs), so the
 * two lamp materials carry a one-line shader patch: `emissive *= mix(1, vColor, lampTint)`.
 * `lampTint` is 0 for the stock shapes — the stock car is the exact same picture as before the
 * workshop — and 1 for the others, whose vertex colours are then the lens's shading.
 */
export interface CarLights {
  readonly head: THREE.Mesh;
  readonly tail: THREE.Mesh;
  readonly reverse: THREE.Mesh;
  readonly exhaustGlow: THREE.Mesh;
  /** 0..1, already clamped by the caller. Brightens the tails toward magenta and grows the flame. */
  setNitro(level: number): void;
  setBraking(on: boolean): void;
  setReversing(on: boolean): void;
  applyLoadout(loadout: CarLoadout): void;
  dispose(): void;
}

const TAIL_RED = new THREE.Color(0xff1a2e);
const TAIL_MAGENTA = new THREE.Color(0xff33d6);

/** Head lamp emissive when `headColor` is the stock `'xenon'`: the colour it has always been. */
const HEAD_XENON = 0xdff2ff;

/**
 * A palette colour as a LAMP: the hex from `PALETTE` (linear), scaled up so its brightest
 * channel is full. A lamp is a light source; "navy" head lights or "crimson" neon mean the hue,
 * not a lamp too dim to see. Colours that already have a full channel (the stock xenon, cyan,
 * magenta) come back unchanged, so stock is exact. Black stays black (lamps visibly off).
 * Allocation-free: writes into `out`.
 */
export function lampColor(id: ColorId, out: THREE.Color, fallback: THREE.ColorRepresentation = 0xffffff): THREE.Color {
  const def = findColor(id);
  out.set(def ? def.hex : fallback);
  const max = Math.max(out.r, out.g, out.b);
  if (max > 1e-4 && max < 0.999) out.multiplyScalar(1 / max);
  return out;
}

/* --------------------------------------------------------------- shapes */

/** How a shape glows. `intensity` is the head lamps' emissive intensity / the tails' gain. */
interface LampStyle {
  intensity: number;
  /** 0: one flat glow (stock). 1: vertex colours shade the glow (see LAMP TINT above). */
  tint: 0 | 1;
}

/** Head shapes. Stock: 1.5 flat, as it always was. */
const HEAD_STYLE: Readonly<Record<string, LampStyle>> = {
  'headlights.stock': { intensity: 1.5, tint: 0 },
  'headlights.slim': { intensity: 1.9, tint: 1 },
  'headlights.quad': { intensity: 1.6, tint: 1 },
  'headlights.popup': { intensity: 1.6, tint: 1 },
  'headlights.smoked': { intensity: 1.5, tint: 1 },
  'headlights.fog': { intensity: 1.6, tint: 1 },
};

/** Tail shapes. `intensity` multiplies the running/brake/nitro intensity. Stock: 1, flat. */
const TAIL_STYLE: Readonly<Record<string, LampStyle>> = {
  'taillights.stock': { intensity: 1, tint: 0 },
  'taillights.led-bar': { intensity: 1.15, tint: 1 },
  'taillights.quad-round': { intensity: 1.1, tint: 1 },
  'taillights.smoked': { intensity: 1.05, tint: 1 },
  'taillights.split': { intensity: 1.1, tint: 1 },
};

/** Every head / tail shape id `buildHeadGeometry` / `buildTailGeometry` draws, stock first. */
export const HEAD_SHAPES: readonly PartId[] = Object.keys(HEAD_STYLE);
export const TAIL_SHAPES: readonly PartId[] = Object.keys(TAIL_STYLE);

const headStyle = (id: PartId): LampStyle => HEAD_STYLE[id] ?? HEAD_STYLE['headlights.stock'];
const tailStyle = (id: PartId): LampStyle => TAIL_STYLE[id] ?? TAIL_STYLE['taillights.stock'];

/** A round lens facing along Z (a projector, a fog lamp, a Skyline ring). */
function lens(radius: number, depth: number, x: number, y: number, z: number, colour: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(radius, radius, depth, 14, 1);
  g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  return part(g, colour);
}

/** A box lamp at a place, optionally rolled (about Z) and toed (about Y). */
function slab(
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  colour: number,
  roll = 0,
  toe = 0,
): THREE.BufferGeometry {
  const g = box(w, h, d);
  if (roll) g.rotateZ(roll);
  if (toe) g.rotateY(toe);
  g.translate(x, y, z);
  return part(g, colour);
}

/** Head light clusters. Stock: a lamp and a DRL strip each side. Unknown ids draw stock. */
export function buildHeadGeometry(partId: PartId = STOCK_LOADOUT.lights.head): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  switch (partId) {
    case 'headlights.slim':
      // Slim angry LEDs: a thin bar slanting up toward the wing, with an eyebrow hooking down
      // at its inner end.
      for (const sign of [-1, 1]) {
        parts.push(slab(0.4, 0.045, 0.08, sign * 0.45, 0.54, -2.125, 0xffffff, sign * 0.15, sign * 0.1));
        parts.push(slab(0.15, 0.03, 0.07, sign * 0.29, 0.495, -2.14, 0xffffff, sign * 0.62));
        // The lower running light, thinner and dimmer than the main bar.
        parts.push(slab(0.26, 0.02, 0.06, sign * 0.47, 0.44, -2.13, 0x8fdcff));
      }
      break;
    case 'headlights.quad':
      // Quad round projectors: two lenses a side, each a bright core in a dim reflector ring.
      for (const sign of [-1, 1]) {
        for (const x of [0.31, 0.52]) {
          parts.push(lens(0.07, 0.05, sign * x, 0.5, -2.115, 0x3a4450));
          parts.push(lens(0.045, 0.05, sign * x, 0.5, -2.14, 0xffffff));
        }
        parts.push(slab(0.36, 0.022, 0.06, sign * 0.42, 0.405, -2.13, 0x9fe8ff));
      }
      break;
    case 'headlights.popup':
      // Pop-ups, up: the lamp faces stand on the hood's leading edge, tipped back a touch.
      // Below them, where the fixed lamps would be, only the amber turn/park strip.
      for (const sign of [-1, 1]) {
        const face = box(0.3, 0.11, 0.03);
        face.rotateX(-0.14);
        face.translate(sign * 0.5, 0.715, -2.0);
        parts.push(part(face, 0xffffff));
        parts.push(slab(0.3, 0.025, 0.1, sign * 0.5, 0.775, -1.95, 0x2a3038));
        parts.push(slab(0.26, 0.04, 0.06, sign * 0.44, 0.45, -2.13, 0xffa030, 0, sign * 0.1));
      }
      break;
    case 'headlights.smoked':
      // The stock clusters behind a tinted lens: same shape, glow pulled well down.
      for (const sign of [-1, 1]) {
        parts.push(slab(0.36, 0.13, 0.1, sign * 0.44, 0.5, -2.13, 0x8a8e96, 0, sign * 0.1));
        parts.push(slab(0.3, 0.035, 0.08, sign * 0.44, 0.38, -2.13, 0x5f7c86));
      }
      break;
    case 'headlights.fog':
      // The stock lamps plus a JDM fog set: round selective-yellow fogs where the DRL was.
      for (const sign of [-1, 1]) {
        parts.push(slab(0.36, 0.13, 0.1, sign * 0.44, 0.5, -2.13, 0xffffff, 0, sign * 0.1));
        parts.push(lens(0.048, 0.05, sign * 0.52, 0.385, -2.145, 0xffc21a));
        parts.push(slab(0.14, 0.03, 0.06, sign * 0.3, 0.38, -2.13, 0x9fe8ff));
      }
      break;
    default:
      // Stock. Written exactly as before the workshop (pinned by `carVisualStock.test.ts`).
      for (const sign of [-1, 1]) {
        const lamp = box(0.36, 0.13, 0.1);
        lamp.rotateY(sign * 0.1);
        lamp.translate(sign * 0.44, 0.5, -2.13);
        parts.push(part(lamp, 0xffffff));
        const drl = box(0.3, 0.035, 0.08);
        drl.translate(sign * 0.44, 0.38, -2.13);
        parts.push(part(drl, 0x9fe8ff));
      }
  }
  return mergeParts(parts);
}

/**
 * Tail light clusters. Shared with the rival cars and the meet (re-exported by `carVisual.ts`):
 * the view of a rival is usually this one. Called with no argument there — the stock shape.
 * Every shape keeps above the plate (`PLATE_MOUNT`, top at y ≈ 0.605) or clear of it in x.
 */
export function buildTailGeometry(partId: PartId = STOCK_LOADOUT.lights.tail): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  switch (partId) {
    case 'taillights.led-bar':
      // Full-width LED bar across the tail, ending in a compact cluster each side.
      parts.push(slab(1.26, 0.035, 0.05, 0, 0.665, 2.13, 0xd8d8d8));
      for (const sign of [-1, 1]) {
        parts.push(slab(0.2, 0.1, 0.07, sign * 0.56, 0.625, 2.12, 0xffffff));
        parts.push(slab(0.12, 0.03, 0.06, sign * 0.56, 0.56, 2.125, 0x9a9a9a));
      }
      break;
    case 'taillights.quad-round':
      // Round quad, the Skyline way: two rings a side, each a bright ring round a dimmer centre.
      for (const sign of [-1, 1]) {
        for (const x of [0.33, 0.56]) {
          parts.push(lens(0.075, 0.05, sign * x, 0.615, 2.12, 0xffffff));
          parts.push(lens(0.04, 0.05, sign * x, 0.615, 2.135, 0x808080));
        }
      }
      break;
    case 'taillights.smoked':
      // The stock clusters behind a smoked lens: same shape, dark until the brakes light it.
      for (const sign of [-1, 1]) {
        parts.push(slab(0.32, 0.16, 0.08, sign * 0.52, 0.61, 2.12, 0xa0a0a0));
        parts.push(slab(0.18, 0.11, 0.06, sign * 0.29, 0.61, 2.11, 0x909090));
      }
      break;
    case 'taillights.split':
      // Split clusters: a tall lamp on each quarter panel and a slimmer one on the lid, with
      // a clear gap where the lid would open.
      for (const sign of [-1, 1]) {
        parts.push(slab(0.2, 0.15, 0.08, sign * 0.57, 0.615, 2.115, 0xffffff));
        parts.push(slab(0.22, 0.065, 0.06, sign * 0.33, 0.655, 2.125, 0xb0b0b0));
        parts.push(slab(0.18, 0.02, 0.05, sign * 0.33, 0.61, 2.13, 0x707070));
      }
      break;
    default:
      // Stock. Written exactly as before the workshop (pinned by `carVisualStock.test.ts`).
      for (const sign of [-1, 1]) {
        const outer = box(0.32, 0.16, 0.08);
        outer.translate(sign * 0.52, 0.61, 2.12);
        parts.push(part(outer, 0xffffff));
        const inner = box(0.18, 0.11, 0.06);
        inner.translate(sign * 0.29, 0.61, 2.11);
        parts.push(part(inner, 0xffffff));
      }
  }
  return mergeParts(parts);
}

function buildReverseGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const sign of [-1, 1]) {
    const lamp = box(0.15, 0.07, 0.05);
    lamp.translate(sign * 0.46, 0.4, 2.16);
    parts.push(part(lamp, 0xffffff));
  }
  return mergeParts(parts);
}

/** Additive disc with a warm core and a magenta/violet rim, used for the exhaust flame. */
function glowDisc(radius: number, segments: number): THREE.BufferGeometry {
  const geo = new THREE.CircleGeometry(radius, segments).toNonIndexed();
  geo.clearGroups();
  for (const name of Object.keys(geo.attributes)) {
    if (name !== 'position' && name !== 'normal') geo.deleteAttribute(name);
  }
  const position = geo.getAttribute('position');
  const core = new THREE.Color(0xffd8a8);
  const rim = new THREE.Color(0xff2fd0);
  const colors = new Float32Array(position.count * 4);
  for (let i = 0; i < position.count; i++) {
    const centre = Math.hypot(position.getX(i), position.getY(i)) < radius * 0.02;
    const c = centre ? core : rim;
    colors[i * 4] = c.r;
    colors[i * 4 + 1] = c.g;
    colors[i * 4 + 2] = c.b;
    colors[i * 4 + 3] = centre ? 1 : 0.14;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 4));
  return geo;
}

/** One flame disc per exhaust outlet (`exhaustOutlets` in `parts/exhaustTips.ts`). */
export function buildExhaustGlowGeometry(outlets: readonly ExhaustOutlet[]): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const o of outlets) {
    const disc = glowDisc(o.radius, 10);
    disc.translate(o.x, o.y, o.z);
    parts.push(disc);
  }
  return mergeParts(parts);
}

/**
 * Installs the LAMP TINT patch (header) on a lamp material: `emissive *= mix(1, vColor, tint)`.
 * With `tint.value === 0` the result is the unpatched material's to the bit.
 */
function patchLampTint(material: THREE.MeshStandardMaterial, tint: { value: number }): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.lampTint = tint;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float lampTint;')
      .replace(
        '#include <emissivemap_fragment>',
        [
          '#include <emissivemap_fragment>',
          '#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )',
          '  totalEmissiveRadiance *= mix( vec3( 1.0 ), vColor.rgb, lampTint );',
          '#endif',
        ].join('\n'),
      );
  };
  material.customProgramCacheKey = () => 'rb-lamp-tint';
}

export function createCarLights(chassis: THREE.Object3D, loadout: CarLoadout = STOCK_LOADOUT): CarLights {
  let headPart = loadout.lights.head;
  let headColour = loadout.lights.headColor;
  let tailPart = loadout.lights.tail;
  let tipsPart = loadout.body.exhaustTips;

  /* ----------------------------------------------------------- head lights */
  const headTint = { value: headStyle(headPart).tint as number };
  const headMat = new THREE.MeshStandardMaterial({
    color: 0x0a0d12,
    emissive: HEAD_XENON,
    emissiveIntensity: headStyle(headPart).intensity,
    vertexColors: true,
    roughness: 0.2,
  });
  lampColor(headColour, headMat.emissive, HEAD_XENON);
  patchLampTint(headMat, headTint);
  const head = new THREE.Mesh(buildHeadGeometry(headPart), headMat);
  chassis.add(head);

  /* ----------------------------------------------------------- tail lights */
  const tailTint = { value: tailStyle(tailPart).tint as number };
  let tailGain = tailStyle(tailPart).intensity;
  const tailMat = new THREE.MeshStandardMaterial({
    color: 0x180205,
    emissive: 0xff1a2e,
    emissiveIntensity: 0.9,
    vertexColors: true,
    roughness: 0.3,
  });
  patchLampTint(tailMat, tailTint);
  const tail = new THREE.Mesh(buildTailGeometry(tailPart), tailMat);
  chassis.add(tail);

  /* -------------------------------------------------------- reverse lights */
  const reverseMat = new THREE.MeshStandardMaterial({
    color: 0x0e1014,
    emissive: 0xffffff,
    emissiveIntensity: 0,
    vertexColors: true,
    roughness: 0.4,
  });
  const reverse = new THREE.Mesh(buildReverseGeometry(), reverseMat);
  chassis.add(reverse);

  /* ---------------------------------------------------------- exhaust glow */
  const exhaustMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const exhaustGlow = new THREE.Mesh(buildExhaustGlowGeometry(exhaustOutlets(tipsPart)), exhaustMat);
  exhaustGlow.renderOrder = 3;
  chassis.add(exhaustGlow);

  /* ------------------------------------------------------------- behaviour */
  let nitro = 0;
  let braking = false;
  let reversing = false;

  function refresh(): void {
    let intensity = 0.85 + nitro * 1.9;
    if (braking) intensity = Math.max(intensity, 3.4);
    tailMat.emissiveIntensity = intensity * tailGain;
    tailMat.emissive.lerpColors(TAIL_RED, TAIL_MAGENTA, braking ? 0 : Math.min(1, nitro * 0.85));
    reverseMat.emissiveIntensity = reversing ? 2.6 : 0;
    exhaustMat.opacity = 0.2 + nitro * 1.6;
    const scale = 1 + nitro * 0.7;
    exhaustGlow.scale.set(scale, scale, 1);
  }
  refresh();

  function swap(mesh: THREE.Mesh, geometry: THREE.BufferGeometry): void {
    const old = mesh.geometry;
    mesh.geometry = geometry;
    old.dispose();
  }

  return {
    head,
    tail,
    reverse,
    exhaustGlow,
    setNitro(level) {
      nitro = level;
      refresh();
    },
    setBraking(on) {
      braking = on;
      refresh();
    },
    setReversing(on) {
      reversing = on;
      refresh();
    },
    applyLoadout(l) {
      if (l.lights.head !== headPart) {
        headPart = l.lights.head;
        swap(head, buildHeadGeometry(headPart));
        const style = headStyle(headPart);
        headMat.emissiveIntensity = style.intensity;
        headTint.value = style.tint;
      }
      if (l.lights.headColor !== headColour) {
        headColour = l.lights.headColor;
        lampColor(headColour, headMat.emissive, HEAD_XENON);
      }
      if (l.lights.tail !== tailPart) {
        tailPart = l.lights.tail;
        swap(tail, buildTailGeometry(tailPart));
        const style = tailStyle(tailPart);
        tailGain = style.intensity;
        tailTint.value = style.tint;
        refresh();
      }
      if (l.body.exhaustTips !== tipsPart) {
        tipsPart = l.body.exhaustTips;
        swap(exhaustGlow, buildExhaustGlowGeometry(exhaustOutlets(tipsPart)));
      }
    },
    dispose() {
      for (const mesh of [head, tail, reverse, exhaustGlow]) mesh.geometry.dispose();
      headMat.dispose();
      tailMat.dispose();
      reverseMat.dispose();
      exhaustMat.dispose();
    },
  };
}
