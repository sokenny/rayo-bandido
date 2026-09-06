import * as THREE from 'three';
import { THEME } from '../../../config/tuning';
import { box, mergeParts, part, partRGBA } from './geometryKit';

/**
 * The car's cabin: what you see through the rear screen.
 *
 * The chase camera spends the whole game looking down through the back window, so the glass
 * is opened up (see `buildGlassGeometry`'s `rearAlpha`) and this fills what is behind it —
 * dash, wheel, seats, console, parcel shelf — and, dead centre of the dash, the spectrum
 * analyser of the car's sound system, whose bars are driven by the theme song through
 * `ThemeAudio.spectrum`.
 *
 * CONTRACT
 * - Everything is built in the car's local frame (nose toward -Z, y = 0 on the road) and
 *   `group` is added to the sprung `chassis`, so the interior leans with the body like the
 *   rest of the shell.
 * - `setMusic()` takes the live spectrum array (0..1 per bar, low frequencies first) and
 *   `update()` moves the bars toward it. Both are safe to call with no music at all: the
 *   display then rests on its floor line, lit but flat.
 *
 * IMPLEMENTATION NOTES
 * - Three draw calls: the trim (one merged standard-material mesh), the light strips (one
 *   merged additive mesh: dash glow, seat piping, speaker rings, the display's base line) and
 *   the bars (one `InstancedMesh`, one instance per bar).
 * - The cabin is 42 cm tall between the deck at y ~0.89 and the roof at 1.31, so nothing here
 *   is at human scale; the parts are sized to read as a silhouette from three car lengths
 *   back, which is the only place this is ever seen from.
 */
export interface CabinInterior {
  /** Add to the car's `chassis`. */
  group: THREE.Group;
  /**
   * The bar levels to chase: `THEME.spectrum.bars` values in 0..1, low frequencies first.
   * Held by reference — pass `ThemeAudio.spectrum` once per frame or once at setup, either
   * works. A shorter array simply leaves the remaining bars at rest.
   */
  setMusic(spectrum: ArrayLike<number>): void;
  /** Advance the bars and the bass throb of the light strips. Call once per render frame. */
  update(frameDt: number): void;
  dispose(): void;
}

/* Trim colours: dark slate, a shade or two above the night around the car. Any lighter and
 * the cabin reads as a hole in the roof; any darker and the dash, wheel and seats collapse
 * into one silhouette and only the light strips are left. */
const TRIM = 0x242a3c;
const TRIM_LIGHT = 0x39415c;
const SEAT = 0x2b3145;
const SCREEN = 0x04050a;

/** The two colours the car already wears underneath: cyan on the left, magenta on the right. */
const CYAN = 0x22e6ff;
const MAGENTA = 0xff2fd0;

/* The display, in the car's frame. It sits on the dash top, offset toward the passenger side
 * of the wheel and tilted back so its face points up at the chase camera rather than at the
 * rear glass. */
const PANEL_X = 0.09;
const PANEL_Y = 1.1;
const PANEL_Z = -0.33;
const PANEL_TILT = -0.36;
const PANEL_HALF_WIDTH = 0.195;
const PANEL_HALF_HEIGHT = 0.075;

const BAR_COUNT = THEME.spectrum.bars;
const BAR_PITCH = (PANEL_HALF_WIDTH * 2 - 0.03) / BAR_COUNT;
const BAR_WIDTH = BAR_PITCH * 0.68;
const BAR_DEPTH = 0.008;
/** Height of a bar at rest and at full scale (m). */
const BAR_FLOOR = 0.006;
const BAR_FULL = 0.118;
/** How fast a bar climbs and falls (per second), on top of the analyser's own smoothing. */
const BAR_RISE = 26;
const BAR_FALL = 9;

/** Where the driver sits, and so where the wheel and the instrument binnacle go. */
const DRIVER_X = -0.33;

/** Applies the display's mounting transform to a piece of its housing. */
function ontoPanel(geo: THREE.BufferGeometry, x: number, y: number, z: number): THREE.BufferGeometry {
  geo.translate(x, y, z);
  geo.rotateX(PANEL_TILT);
  geo.translate(PANEL_X, PANEL_Y, PANEL_Z);
  return geo;
}

function buildTrimGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  // Liner. The greenhouse is a single-sided shell, so from in here its roof and side walls do
  // not exist at all and the city shows straight through them; these are the surfaces that
  // close the cabin off. They sit a centimetre inside the paint, following its taper.
  const headliner = box(1.2, 0.02, 0.78);
  headliner.translate(0, 1.285, 0.28);
  parts.push(part(headliner, TRIM));
  for (const sign of [-1, 1]) {
    const wall = box(0.02, 0.46, 1.56);
    wall.rotateZ(sign * 0.25);
    wall.translate(sign * 0.665, 1.07, 0.66);
    parts.push(part(wall, TRIM));
  }

  // Floor pan, just clear of the hull's top face so the two never fight for the same pixels.
  const floor = box(1.34, 0.02, 2.14);
  floor.translate(0, 0.905, 0.34);
  parts.push(part(floor, TRIM));

  // Dash: a block across the front of the cabin, with the cowl lip that meets the windscreen.
  const dash = box(1.26, 0.17, 0.34);
  dash.translate(0, 0.975, -0.5);
  parts.push(part(dash, TRIM));
  const cowl = box(1.22, 0.04, 0.1);
  cowl.rotateX(-0.3);
  cowl.translate(0, 1.05, -0.6);
  parts.push(part(cowl, TRIM_LIGHT));

  // Instrument binnacle in front of the driver.
  const binnacle = box(0.32, 0.06, 0.18);
  binnacle.rotateX(-0.22);
  binnacle.translate(DRIVER_X, 1.055, -0.42);
  parts.push(part(binnacle, TRIM_LIGHT));

  // Steering wheel: rim, hub and a two-spoke cross, raked toward the driver.
  const rim = new THREE.TorusGeometry(0.125, 0.016, 5, 14);
  rim.rotateX(0.42);
  rim.translate(DRIVER_X, 1.035, -0.27);
  parts.push(part(rim, TRIM_LIGHT));
  const spokeH = box(0.2, 0.016, 0.012);
  spokeH.rotateX(0.42);
  spokeH.translate(DRIVER_X, 1.035, -0.27);
  parts.push(part(spokeH, TRIM));
  const hub = box(0.06, 0.05, 0.03);
  hub.rotateX(0.42);
  hub.translate(DRIVER_X, 1.035, -0.27);
  parts.push(part(hub, TRIM_LIGHT));
  const column = box(0.05, 0.05, 0.16);
  column.rotateX(-0.5);
  column.translate(DRIVER_X, 0.995, -0.35);
  parts.push(part(column, TRIM));

  // Centre console and the shifter standing out of it.
  const console_ = box(0.24, 0.09, 0.86);
  console_.translate(0, 0.95, 0.1);
  parts.push(part(console_, TRIM_LIGHT));
  const lever = box(0.035, 0.1, 0.035);
  lever.rotateX(-0.2);
  lever.translate(0, 1.03, -0.13);
  parts.push(part(lever, TRIM));
  const knob = box(0.06, 0.05, 0.06);
  knob.translate(0, 1.085, -0.15);
  parts.push(part(knob, TRIM_LIGHT));

  // Two bucket seats, backs kept low so they never stand between the camera and the dash.
  for (const sign of [-1, 1]) {
    const x = sign * 0.33;
    const squab = box(0.4, 0.05, 0.46);
    squab.translate(x, 0.94, 0.3);
    parts.push(part(squab, SEAT));
    const back = box(0.36, 0.24, 0.07);
    back.rotateX(0.2);
    back.translate(x, 1.02, 0.58);
    parts.push(part(back, SEAT));
    for (const side of [-1, 1]) {
      const bolster = box(0.05, 0.22, 0.1);
      bolster.rotateX(0.2);
      bolster.translate(x + side * 0.165, 1.02, 0.575);
      parts.push(part(bolster, TRIM_LIGHT));
    }
    const headrest = box(0.16, 0.07, 0.07);
    headrest.rotateX(0.2);
    headrest.translate(x, 1.15, 0.605);
    parts.push(part(headrest, SEAT));
  }

  // Bulkhead behind the seats and the parcel shelf carrying the speakers.
  const bulkhead = box(1.2, 0.14, 0.04);
  bulkhead.translate(0, 0.98, 0.85);
  parts.push(part(bulkhead, TRIM));
  const shelf = box(1.16, 0.02, 0.58);
  shelf.translate(0, 0.96, 1.18);
  parts.push(part(shelf, TRIM_LIGHT));
  for (const sign of [-1, 1]) {
    const basket = new THREE.CylinderGeometry(0.12, 0.09, 0.05, 12, 1);
    basket.translate(sign * 0.34, 0.985, 1.16);
    parts.push(part(basket, TRIM));
  }

  // The display housing: a black bezel the bars stand on.
  parts.push(part(ontoPanel(box(PANEL_HALF_WIDTH * 2, PANEL_HALF_HEIGHT * 2, 0.018), 0, 0, 0), SCREEN));
  parts.push(
    part(ontoPanel(box(PANEL_HALF_WIDTH * 2 + 0.02, PANEL_HALF_HEIGHT * 2 + 0.02, 0.01), 0, 0, -0.006), TRIM_LIGHT),
  );

  return mergeParts(parts);
}

/**
 * The light strips: everything in the cabin that is a light rather than a surface. One
 * additive mesh, so the whole set can breathe with the bass by moving a single opacity.
 */
function buildGlowGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  // Dash ambient strip: the line of light along the top of the dash that lifts the whole cabin.
  const dashStrip = box(1.1, 0.014, 0.02);
  dashStrip.rotateX(-0.3);
  dashStrip.translate(0, 1.063, -0.556);
  parts.push(partRGBA(dashStrip, CYAN, 1));

  // The tachometer inside the binnacle, and the piping across the top of each seat back.
  const tacho = box(0.22, 0.012, 0.03);
  tacho.rotateX(-0.22);
  tacho.translate(DRIVER_X, 1.076, -0.38);
  parts.push(partRGBA(tacho, MAGENTA, 1));
  for (const sign of [-1, 1]) {
    const piping = box(0.34, 0.012, 0.02);
    piping.rotateX(0.2);
    piping.translate(sign * 0.33, 1.14, 0.55);
    parts.push(partRGBA(piping, sign < 0 ? CYAN : MAGENTA, 1));
  }

  // Speaker rings on the parcel shelf: the sound system the display belongs to.
  for (const sign of [-1, 1]) {
    const ring = new THREE.RingGeometry(0.075, 0.105, 14, 1);
    ring.rotateX(-Math.PI / 2);
    ring.translate(sign * 0.34, 1.013, 1.16);
    parts.push(partRGBA(ring, sign < 0 ? CYAN : MAGENTA, 1));
    const dome = new THREE.CircleGeometry(0.04, 10);
    dome.rotateX(-Math.PI / 2);
    dome.translate(sign * 0.34, 1.014, 1.16);
    parts.push(partRGBA(dome, sign < 0 ? CYAN : MAGENTA, 0.6));
  }

  // The display's base line, so the bar display reads as switched on even in silence.
  const baseLine = ontoPanel(box(PANEL_HALF_WIDTH * 2 - 0.02, 0.006, 0.004), 0, -PANEL_HALF_HEIGHT + 0.012, 0.012);
  parts.push(partRGBA(baseLine, 0x4a4fff, 1));

  return mergeParts(parts);
}

/**
 * The colour of bar `i`: cyan at the bass end, running through violet to magenta at the top.
 * Swept in hue rather than mixed in RGB, because mixing those two ends channel by channel
 * runs the middle of the display through a washed-out white.
 */
function barColor(i: number, out: THREE.Color): THREE.Color {
  const t = BAR_COUNT > 1 ? i / (BAR_COUNT - 1) : 0;
  return out.setHSL(0.52 + t * 0.36, 0.95, 0.58);
}

export function createCabinInterior(): CabinInterior {
  const group = new THREE.Group();
  group.name = 'player-car-interior';
  const disposables: Array<{ dispose(): void }> = [];

  /* ------------------------------------------------------------------ trim */
  const trimGeo = buildTrimGeometry();
  const trimMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.85,
    metalness: 0.1,
    // A touch of self-illumination: the cabin has no light of its own, and without this the
    // trim collapses into one flat black shape behind the glass.
    emissive: 0x141d33,
    emissiveIntensity: 1,
  });
  const trim = new THREE.Mesh(trimGeo, trimMat);
  trim.name = 'player-car-interior-trim';
  group.add(trim);
  disposables.push(trimGeo, trimMat);

  /* ----------------------------------------------------------- light strips */
  const glowGeo = buildGlowGeometry();
  const glowMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const glow = new THREE.Mesh(glowGeo, glowMat);
  glow.name = 'player-car-interior-glow';
  glow.renderOrder = 2;
  group.add(glow);
  disposables.push(glowGeo, glowMat);

  /* -------------------------------------------------------- spectrum display */
  const panel = new THREE.Group();
  panel.position.set(PANEL_X, PANEL_Y, PANEL_Z);
  panel.rotation.x = PANEL_TILT;
  group.add(panel);

  // One unit-tall bar standing on its own base, so an instance's height is just its y scale.
  const barGeo = box(BAR_WIDTH, 1, BAR_DEPTH);
  barGeo.translate(0, 0.5, 0);
  const barMat = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const bars = new THREE.InstancedMesh(barGeo, barMat, BAR_COUNT);
  bars.name = 'player-car-eq';
  bars.renderOrder = 3;
  bars.frustumCulled = false;
  panel.add(bars);
  disposables.push(barGeo, barMat, bars);

  const colour = new THREE.Color();
  for (let i = 0; i < BAR_COUNT; i++) bars.setColorAt(i, barColor(i, colour));
  if (bars.instanceColor) bars.instanceColor.needsUpdate = true;

  const heights = new Float32Array(BAR_COUNT);
  heights.fill(BAR_FLOOR);
  let levels: ArrayLike<number> = new Float32Array(BAR_COUNT);

  const matrix = new THREE.Matrix4();
  const barX = (i: number): number => (i - (BAR_COUNT - 1) / 2) * BAR_PITCH;
  const barBaseY = -PANEL_HALF_HEIGHT + 0.014;

  function writeBars(): void {
    for (let i = 0; i < BAR_COUNT; i++) {
      matrix.makeScale(1, heights[i], 1);
      matrix.setPosition(barX(i), barBaseY, 0.014);
      bars.setMatrixAt(i, matrix);
    }
    bars.instanceMatrix.needsUpdate = true;
  }
  writeBars();

  return {
    group,
    setMusic(spectrum) {
      levels = spectrum;
    },
    update(frameDt) {
      let bass = 0;
      for (let i = 0; i < BAR_COUNT; i++) {
        const level = i < levels.length ? levels[i] : 0;
        const target = BAR_FLOOR + (level > 1 ? 1 : level < 0 ? 0 : level) * (BAR_FULL - BAR_FLOOR);
        const rate = target > heights[i] ? BAR_RISE : BAR_FALL;
        // Framerate-independent approach, clamped so a long frame cannot overshoot the target.
        heights[i] += (target - heights[i]) * Math.min(1, frameDt * rate);
        if (i < 3) bass += heights[i];
      }
      writeBars();
      // The strips lift with the bottom of the display, so the cabin pulses with the kick.
      const throb = (bass / 3 - BAR_FLOOR) / (BAR_FULL - BAR_FLOOR);
      glowMat.opacity = 0.5 + (throb > 0 ? throb : 0) * 0.45;
    },
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
