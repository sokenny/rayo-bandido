import * as THREE from 'three';
import { PAL } from './palette';
import { mergeParts, part } from '../vehicles/geometryKit';
import { RUSH } from '../../../config/tuning';

/**
 * The RAYO RUSH marker: what the activity looks like from the driver's seat.
 *
 * WHY IT IS BUILT LIKE THIS. The brief asks for something subtle that belongs to the street
 * rather than a quest icon planted on top of it, so nothing here is an object standing in the
 * road. It is a paint job and a light: a worn hazard ring stencilled on the asphalt, a pair of
 * chevrons pointing into it, and a slow-turning bolt glyph hanging well clear of roof height —
 * read as the sort of thing this city already covers itself in, not as a marker.
 *
 * THE GLYPH IS REAL GEOMETRY. It was a textured plane, and a spinning plane is edge-on twice a
 * turn — the thing vanished at exactly the moment the rotation was meant to be reading. So the
 * bolt is extruded and the ring around it is a broken torus, and the rotation now shows a
 * silhouette changing rather than a picture disappearing. Its solidity is carried by VERTEX
 * COLOUR, not by light: this city is hemisphere-dominated, so a lit material would shade every
 * vertical face identically and the extrusion would read flat anyway. The caps are painted
 * bright and the extruded sides deep, which is what makes the edges turn.
 *
 * The word is a `THREE.Sprite`, so it billboards on its own and stays readable while everything
 * under it spins. That is the whole reason it is no longer part of the plate.
 *
 * THE ONLY STATE IT HAS is how close the player is, which `setProximity` feeds it: far away
 * the ring is barely there, and it warms and quickens as the car comes in. That is the whole
 * interaction cue — the prompt itself is DOM (`src/ui/rushOverlay.ts`), because text pinned to
 * the world reads badly at speed.
 *
 * BUDGET. Eight draw calls, all `MeshBasicMaterial`/`SpriteMaterial` (nothing here should take a
 * shadow or a light), depth-written off on everything that hangs so it never z-fights. The paint
 * on the road is additive except its dark backing, so it burns through the city's haze at a
 * distance the way the neon does. Animation is scalar writes in `update`; nothing allocates per
 * frame.
 */
export interface RushMarkerVisual {
  group: THREE.Group;
  /**
   * How close the player is, 0 (far) .. 1 (standing in it). Drives brightness and the speed
   * of the sweep, so the marker answers the car before the prompt does.
   */
  setProximity(value: number): void;
  /** True while a run is under way: the marker goes quiet rather than shouting over the HUD. */
  setRunning(running: boolean): void;
  update(time: number): void;
  dispose(): void;
}

/**
 * The painted ring IS the trigger, so its radius is the rules' own `promptRadius` rather than a
 * number that merely looks about right next to it. Stand inside the paint and the prompt is up;
 * roll off it and the prompt is gone. Nothing to keep in sync, because there is only one number.
 */
const RING_OUTER = RUSH.marker.promptRadius;
const RING_INNER = RING_OUTER - 1.1;
/** How far the paint floats over the road (m). Enough to clear the asphalt's own lift. */
const PAINT_Y = 0.035;
/** Height the glyph is centred at (m). Well over the tallest thing that drives under it. */
const GLYPH_Y = 6.9;
/**
 * The bolt: how tall it stands, how far it is stretched sideways from the outline's own thin
 * proportions, and how deep it is extruded. The depth is what the whole idea rests on — a
 * shallow extrusion is a plate again by the time it comes side on, so it is nearly a metre.
 */
const BOLT_HEIGHT = 3.8;
const BOLT_WIDEN = 1.3;
const BOLT_DEPTH = 0.95;
/** The broken torus around it: centreline radius and tube radius (m). */
const RING_RADIUS = 2.8;
const RING_TUBE = 0.13;
/** Gap between the four arcs, in radians of the turn each one gives up. */
const RING_GAP = 0.42;
/** How much the ring is tilted off vertical (rad), so a spin never brings it fully edge-on. */
const RING_TILT = 0.34;
/**
 * The wordmark sprite: its width in metres, and how far BELOW the halo it hangs. Below, because
 * the glyph is high and the chase camera looks slightly down — anything above the halo ends up
 * in the very top of the frame, where the controls card already is. Under it, the word reads as
 * a nameplate and stays clear of the roof of the tallest bus that can pass beneath it.
 */
const CAPTION_WIDTH = 3.1;
const CAPTION_DROP = 0.55;
/** Chevron dimensions (m): the two arrows on the approach axis. */
const CHEVRON_SPAN = 3.6;
const CHEVRON_DEPTH = 1.5;
const CHEVRON_THICK = 0.42;
/** Distance out from the centre the chevron pair sits (m): just outside the paint, pointing in. */
const CHEVRON_OFFSET = RING_OUTER + 2.4;

/** Canvas the wordmark is rasterised on. 4:1, which is the shape of the word. */
const CAPTION_W = 512;
const CAPTION_H = 128;

/**
 * The bolt, as a closed outline in a unit square with y running DOWN (it started life as a
 * canvas path and the numbers are worth keeping recognisable). `buildBolt` flips and scales it.
 */
const BOLT_OUTLINE: Array<[number, number]> = [
  [0.56, 0.12],
  [0.36, 0.5],
  [0.5, 0.5],
  [0.4, 0.88],
  [0.66, 0.44],
  [0.51, 0.44],
  [0.66, 0.12],
];
/** Extent of `BOLT_OUTLINE` in that unit square, so the shape can be scaled by its real height. */
const BOLT_SPAN_Y = 0.88 - 0.12;

function hex(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`;
}

/** Bright faces of the bolt, and the deep colour its extruded sides are painted. */
const BOLT_CAP = 0xd8feff;
const BOLT_SIDE = 0x114a63;

/**
 * Paint an `ExtrudeGeometry` by its two groups — 0 is the front and back caps, 1 is the
 * extruded sides — and fold the result into a vertex colour so the whole thing draws with one
 * unlit material.
 *
 * This is what gives the glyph its form. Nothing in this scene would shade it: the city's light
 * is hemisphere-dominated, so every vertical face of a lit material comes out the same and an
 * extrusion reads exactly as flat as the plane it replaced. Painting the sides dark and the caps
 * bright puts the contrast in the geometry itself, where a turn can show it.
 */
function paintExtrudeGroups(geo: THREE.BufferGeometry, cap: number, side: number): THREE.BufferGeometry {
  const position = geo.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  const colour = new THREE.Color();
  // `ExtrudeGeometry` is non-indexed, so a group's start/count are vertices.
  const groups = geo.groups.length > 0 ? geo.groups : [{ start: 0, count: position.count, materialIndex: 0 }];
  for (const group of groups) {
    colour.set(group.materialIndex === 1 ? side : cap);
    const last = Math.min(position.count, group.start + group.count);
    for (let i = group.start; i < last; i++) {
      colors[i * 3] = colour.r;
      colors[i * 3 + 1] = colour.g;
      colors[i * 3 + 2] = colour.b;
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.clearGroups();
  return geo;
}

/**
 * The bolt: `BOLT_OUTLINE` extruded and centred on the origin, standing in the XY plane with
 * its depth along Z. Same silhouette as the HUD's charge icon, so the marker and the weapon
 * read as one system without the marker having to say what it is.
 */
function buildBolt(): THREE.BufferGeometry {
  const scale = BOLT_HEIGHT / BOLT_SPAN_Y;
  const shape = new THREE.Shape();
  for (let i = 0; i < BOLT_OUTLINE.length; i++) {
    const [ux, uy] = BOLT_OUTLINE[i];
    // The outline is in canvas space (y down); flip it and put its centre on the origin.
    const x = (ux - 0.51) * scale * BOLT_WIDEN;
    const y = (0.5 - uy) * scale;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: BOLT_DEPTH,
    bevelEnabled: true,
    bevelThickness: 0.05,
    bevelSize: 0.05,
    bevelSegments: 1,
    curveSegments: 1,
  });
  // Extrusion grows along +Z from the shape plane; centre it so it spins about its own body.
  geo.translate(0, 0, -BOLT_DEPTH / 2);
  return paintExtrudeGroups(geo, BOLT_CAP, BOLT_SIDE);
}

/**
 * The halo around the bolt: four arcs of a torus with gaps between them, the city's own signage
 * idiom, merged into one geometry so the whole ring is a single draw. Named apart from the paint
 * ring on the road, which is a different thing at a different height.
 */
function buildHalo(): THREE.BufferGeometry {
  const arc = Math.PI / 2 - RING_GAP;
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    const torus = new THREE.TorusGeometry(RING_RADIUS, RING_TUBE, 6, 14, arc);
    torus.rotateZ((i * Math.PI) / 2 + RING_GAP / 2);
    parts.push(part(torus, PAL.neonCyan));
  }
  return mergeParts(parts);
}

/**
 * The wordmark, rasterised once. It becomes a `THREE.Sprite`, which is the whole point: it
 * billboards itself, so the name stays square to the driver while the bolt and the ring turn.
 */
function makeCaptionTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = CAPTION_W;
  cv.height = CAPTION_H;
  const ctx = cv.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  ctx.clearRect(0, 0, CAPTION_W, CAPTION_H);
  ctx.font = `700 62px "Bahnschrift","DIN Alternate","Arial Narrow",Impact,sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = hex(PAL.neonCyan);
  ctx.shadowBlur = 22;
  ctx.fillStyle = hex(PAL.neonWhite);
  ctx.fillText('RAYO RUSH', CAPTION_W / 2, CAPTION_H / 2);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** One flat chevron (an arrow head lying on the road), pointing toward local -Z. */
function buildChevron(): THREE.BufferGeometry {
  const half = CHEVRON_SPAN / 2;
  const t = CHEVRON_THICK;
  // Two quads meeting at the tip, described as a triangle strip's worth of explicit triangles.
  const outer: Array<[number, number]> = [
    [-half, CHEVRON_DEPTH],
    [0, 0],
    [half, CHEVRON_DEPTH],
  ];
  const inner: Array<[number, number]> = [
    [-half, CHEVRON_DEPTH + t],
    [0, t],
    [half, CHEVRON_DEPTH + t],
  ];
  const pos: number[] = [];
  for (let i = 0; i < 2; i++) {
    const [ax, az] = outer[i];
    const [bx, bz] = outer[i + 1];
    const [cx, cz] = inner[i];
    const [dx, dz] = inner[i + 1];
    pos.push(ax, 0, az, bx, 0, bz, dx, 0, dz);
    pos.push(ax, 0, az, dx, 0, dz, cx, 0, cz);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

export function createRushMarker(site: { x: number; z: number; y: number; heading: number }): RushMarkerVisual {
  const group = new THREE.Group();
  group.name = 'rush-marker';
  group.position.set(site.x, site.y, site.z);
  // Same mapping the rest of the game uses: a heading is a clockwise yaw, Three's is not.
  group.rotation.y = -site.heading;

  /* ------------------------------------------------------------------ paint */

  // The backing: a dark disc that lifts the paint off whatever tarmac it lands on, so the
  // ring reads at night without the road having to be re-lit under it.
  const backingGeo = new THREE.RingGeometry(RING_INNER - 0.5, RING_OUTER + 0.5, 48);
  const backingMat = new THREE.MeshBasicMaterial({
    color: 0x05070c,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
  });
  const backing = new THREE.Mesh(backingGeo, backingMat);
  backing.rotation.x = -Math.PI / 2;
  backing.position.y = PAINT_Y;
  backing.renderOrder = 1;
  group.add(backing);

  const ringGeo = new THREE.RingGeometry(RING_INNER, RING_OUTER, 48, 1);
  const ringMat = new THREE.MeshBasicMaterial({
    color: PAL.neonCyan,
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = PAINT_Y + 0.002;
  ring.renderOrder = 2;
  group.add(ring);

  /* ------------------------------------------------------------------ chevrons */

  // One geometry, two meshes facing each other down the boulevard: whichever way the player
  // arrives from, an arrow is pointing them into the ring.
  const chevronGeo = buildChevron();
  const chevronMat = new THREE.MeshBasicMaterial({
    color: PAL.neonCyan,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const chevrons: THREE.Mesh[] = [];
  for (const sign of [-1, 1]) {
    const mesh = new THREE.Mesh(chevronGeo, chevronMat);
    mesh.position.set(0, PAINT_Y + 0.003, CHEVRON_OFFSET * sign);
    // The far one is spun round so both point inward at the ring.
    if (sign < 0) mesh.rotation.y = Math.PI;
    mesh.renderOrder = 2;
    group.add(mesh);
    chevrons.push(mesh);
  }

  /* ------------------------------------------------------------------ glyph */

  // Everything that hangs turns inside one node, so the whole assembly can be moved, faded or
  // quietened as a unit.
  const glyph = new THREE.Group();
  glyph.position.y = GLYPH_Y;
  group.add(glyph);

  const boltGeo = buildBolt();
  const boltMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    toneMapped: false,
  });
  const bolt = new THREE.Mesh(boltGeo, boltMat);
  bolt.renderOrder = 3;
  glyph.add(bolt);

  // A back-facing shell a little larger than the bolt: it is only ever seen where the core does
  // not cover it, which is the silhouette — so it reads as the neon bleeding off the edge.
  const boltGlowMat = new THREE.MeshBasicMaterial({
    color: PAL.neonCyan,
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const boltGlow = new THREE.Mesh(boltGeo, boltGlowMat);
  boltGlow.scale.setScalar(1.09);
  boltGlow.renderOrder = 2;
  glyph.add(boltGlow);

  const haloGeo = buildHalo();
  const haloMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const halo = new THREE.Mesh(haloGeo, haloMat);
  // Tilted, so a turn never brings it fully edge-on and it always reads as a ring in space.
  halo.rotation.x = RING_TILT;
  halo.renderOrder = 3;
  glyph.add(halo);

  const captionTex = makeCaptionTexture();
  const captionMat = new THREE.SpriteMaterial({
    map: captionTex,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const caption = new THREE.Sprite(captionMat);
  caption.scale.set(CAPTION_WIDTH, (CAPTION_WIDTH * CAPTION_H) / CAPTION_W, 1);
  caption.position.y = -(RING_RADIUS - CAPTION_DROP);
  caption.renderOrder = 4;
  glyph.add(caption);

  let proximity = 0;
  let running = false;

  return {
    group,

    setProximity(value) {
      proximity = value < 0 ? 0 : value > 1 ? 1 : value;
    },

    setRunning(value) {
      running = value;
    },

    update(time) {
      // While a run is on, the marker has done its job: it drops to a trace so it does not
      // compete with the clock and the score for the player's attention.
      const gain = running ? 0.25 : 1;
      // The sweep quickens as the player closes in, which is what makes the marker feel like
      // it has noticed them without anything having to pop.
      const pulse = 0.5 + 0.5 * Math.sin(time * (1.4 + proximity * 3.4));
      ringMat.opacity = (0.22 + proximity * 0.34 + pulse * (0.06 + proximity * 0.2)) * gain;
      backingMat.opacity = (0.34 + proximity * 0.22) * gain;
      chevronMat.opacity = (0.16 + proximity * 0.3 + pulse * 0.06) * gain;

      // The bolt turns one way and the ring the other, at different rates: two speeds read as
      // a mechanism, one speed reads as a decal on a turntable. A shallow bob on the whole
      // assembly so it hangs rather than floats.
      bolt.rotation.y = time * 0.5;
      boltGlow.rotation.y = bolt.rotation.y;
      halo.rotation.y = -time * 0.3;
      glyph.position.y = GLYPH_Y + Math.sin(time * 0.9) * 0.2;
      boltMat.opacity = (0.62 + proximity * 0.3 + pulse * 0.08) * gain;
      boltGlowMat.opacity = (0.18 + proximity * 0.26 + pulse * 0.12) * gain;
      haloMat.opacity = (0.4 + proximity * 0.35 + pulse * 0.12) * gain;
      captionMat.opacity = (0.3 + proximity * 0.5) * gain;
    },

    dispose() {
      group.clear();
      backingGeo.dispose();
      backingMat.dispose();
      ringGeo.dispose();
      ringMat.dispose();
      chevronGeo.dispose();
      chevronMat.dispose();
      // One geometry, two meshes: disposed once.
      boltGeo.dispose();
      boltMat.dispose();
      boltGlowMat.dispose();
      haloGeo.dispose();
      haloMat.dispose();
      captionMat.dispose();
      captionTex.dispose();
    },
  };
}
