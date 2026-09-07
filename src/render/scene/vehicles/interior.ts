import * as THREE from 'three';
import { THEME, VEHICLE } from '../../../config/tuning';
import { box, flipFaces, loft, mergeParts, part, partRGBA } from './geometryKit';

/**
 * The car's cabin: what you see through the rear screen.
 *
 * The chase camera spends the whole game looking down through the back window, so the glass
 * is opened up (see `buildGlassGeometry`'s `glazingAlpha`) and this fills what is behind it —
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
 * - Five draw calls: the trim (one merged standard-material mesh), the light strips (one
 *   merged additive mesh: dash glow, seat piping, speaker rings, the display's base line),
 *   the bars (one `InstancedMesh`, one instance per bar) and the steering wheel's two, which
 *   are separate only because the rim turns and the rest of the cabin does not. The wheel's
 *   meshes share the trim and glow materials rather than making their own.
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
  /**
   * Where the front wheels are pointing (rad, positive = right): `VehicleState.steerAngle`.
   * The steering wheel turns with it on a full 900-degree rack, the way a real rim does — from
   * the driver's seat a rim that sat still while the car turned would be the first thing you
   * saw, and one that only twitched would be the second.
   */
  setSteering(steerAngle: number): void;
  /** Advance the bars and the bass throb of the light strips. Call once per frame. */
  update(frameDt: number): void;
  dispose(): void;
}

/* Trim colours: dark slate, a shade or two above the night around the car. Any lighter and
 * the cabin reads as a hole in the roof; any darker and the dash, wheel and seats collapse
 * into one silhouette and only the light strips are left. */
const TRIM = 0x161b28;
const TRIM_LIGHT = 0x2a3049;
const SEAT = 0x1d2234;
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

/* The steering wheel: hub position, rake, rim size, and how many turns of rim it takes to put
 * the road wheels where `steerAngle` says they are.
 *
 * A real rack, not a shortened one: 900 degrees lock to lock, so the rim comes round two and
 * a half turns end to end and `STEERING_LOCK` — half of that — at full lock either way. The
 * ratio is derived from `VEHICLE.maxSteerAngle` rather than written down, so retuning the
 * rack keeps the rim honest. The road wheels are unaffected; this is the rim alone. */
const WHEEL_HUB_X = DRIVER_X;
const WHEEL_HUB_Y = 1.035;
const WHEEL_HUB_Z = -0.27;
const WHEEL_RAKE = 0.42;
const WHEEL_RADIUS = 0.125;
/** Rim travel from centre to full lock (rad): 450 degrees, i.e. 900 lock to lock. */
const STEERING_LOCK = Math.PI * 2.5;
const STEERING_RATIO = STEERING_LOCK / VEHICLE.maxSteerAngle;

/** Applies the display's mounting transform to a piece of its housing. */
function ontoPanel(geo: THREE.BufferGeometry, x: number, y: number, z: number): THREE.BufferGeometry {
  geo.translate(x, y, z);
  geo.rotateX(PANEL_TILT);
  geo.translate(PANEL_X, PANEL_Y, PANEL_Z);
  return geo;
}

function buildTrimGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  // Liner: headlining, door cards and pillar insides in one piece.
  //
  // The greenhouse is a single-sided shell, so from in here its roof and walls do not exist at
  // all and the city shows straight through them. This is that same hull turned inside out
  // (`flipFaces`) and inset, which is the only shape that follows the roofline everywhere it
  // tapers — flat panels standing in for it poked out through the glass at both ends, where
  // the roof drops away to a lip. Its windscreen and backlight faces are left out for the
  // same reason the paint's are: those two are the windows.
  parts.push(
    part(
      flipFaces(
        loft(
          [
            { z: -0.73, bottomY: 0.82, topY: 0.86, bottomHalfWidth: 0.725, topHalfWidth: 0.725 },
            { z: -0.07, bottomY: 0.86, topY: 1.288, bottomHalfWidth: 0.705, topHalfWidth: 0.585 },
            { z: 0.61, bottomY: 0.86, topY: 1.298, bottomHalfWidth: 0.705, topHalfWidth: 0.585 },
            { z: 1.56, bottomY: 0.86, topY: 0.918, bottomHalfWidth: 0.745, topHalfWidth: 0.685 },
          ],
          { caps: false, openTop: [0, 2] },
        ),
      ),
      TRIM,
    ),
  );

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

  // Steering column. The rim it carries turns, so it is built separately, below.
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
 * The steering wheel's rim, spokes and hub, built flat in the XY plane around the origin so
 * the group that carries it can simply spin it about its own Z.
 */
function buildSteeringGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(part(new THREE.TorusGeometry(WHEEL_RADIUS, 0.016, 5, 14), TRIM_LIGHT));
  parts.push(part(box(WHEEL_RADIUS * 1.6, 0.016, 0.012), TRIM));
  parts.push(part(box(0.06, 0.05, 0.03), TRIM_LIGHT));
  return mergeParts(parts);
}

/** The shift light on the rim's twelve o'clock. Turns with the rim, so it rides its group. */
function buildSteeringGlowGeometry(): THREE.BufferGeometry {
  const mark = box(0.07, 0.014, 0.022);
  mark.translate(0, WHEEL_RADIUS, 0);
  return mergeParts([partRGBA(mark, MAGENTA, 1)]);
}

/**
 * The light strips: everything in the cabin that is a light rather than a surface. One
 * additive mesh, so the whole set can breathe with the bass by moving a single opacity.
 */
function buildGlowGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  // Dash ambient strip: the line of light along the top of the dash that lifts the whole
  // cabin. Wide enough in Z to still read from the driver's seat, where it is seen almost
  // edge-on from less than a metre away.
  const dashStrip = box(1.1, 0.014, 0.05);
  dashStrip.rotateX(-0.3);
  dashStrip.translate(0, 1.063, -0.548);
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
    emissive: 0x0c1322,
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

  /* ------------------------------------------------------------ steering wheel */
  // Two meshes on one pivot: the rim shares the trim material, its shift light the glow
  // material. `rake` holds the column angle, `spin` is the only thing steering touches.
  const rake = new THREE.Group();
  rake.position.set(WHEEL_HUB_X, WHEEL_HUB_Y, WHEEL_HUB_Z);
  rake.rotation.x = WHEEL_RAKE;
  group.add(rake);
  const spin = new THREE.Group();
  rake.add(spin);
  const steeringGeo = buildSteeringGeometry();
  const steering = new THREE.Mesh(steeringGeo, trimMat);
  steering.name = 'player-car-steering';
  spin.add(steering);
  const steeringGlowGeo = buildSteeringGlowGeometry();
  const steeringGlow = new THREE.Mesh(steeringGlowGeo, glowMat);
  steeringGlow.renderOrder = 2;
  spin.add(steeringGlow);
  disposables.push(steeringGeo, steeringGlowGeo);

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
    setSteering(steerAngle) {
      // Positive steer is to the right, which turns the rim clockwise: a negative rotation
      // about the wheel's own axis, the same sign convention the road wheels use.
      spin.rotation.z = -steerAngle * STEERING_RATIO;
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
