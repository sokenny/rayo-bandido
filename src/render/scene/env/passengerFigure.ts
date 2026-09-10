import * as THREE from 'three';
import type { PassengerStop } from '../../../core/types';
import { createHumanFigure, type HumanFigureVisual, type HumanLook } from './humanFigure';

/**
 * THE PERSON AT THE STOP.
 *
 * The pin and the ring (`passengerMarker.ts`) say a ride is here; this is who is waiting for
 * it. Until now a pickup was a column of violet light with nobody under it, which read as a
 * quest icon rather than as a fare — so every character in the catalogue now has a body, built
 * out of the same object El Búho is built from (`humanFigure.ts`), standing at the kerb.
 *
 * THE SAME PERSON YOU SEE IN THE HUD. Each look below is drawn from that character's portrait
 * (`src/ui/portraits.ts`) — Mika's magenta fringe and her camera, Vera's cap and hi-vis, Nico's
 * hair and his padded case — so the face that appears next to the subtitles is recognisably the
 * one you pulled over for. They are keyed by the same `portrait` id the portrait is, and a
 * character with no look gets a plain one rather than nothing.
 *
 * WHERE THEY STAND. Not in the middle of their own ring: the car parks there. `standAt` walks
 * outward from the stop, across the street, until the road runs out, and puts them a step
 * inside the kerb on whichever side is nearer — facing the road, so you pull up to someone
 * looking at you. At a junction, where there is no kerb either way, and in a world with no road
 * test to ask, they wait at a fixed offset that every stop's own placement rules guarantee is
 * tarmac.
 *
 * BUILT ON DEMAND, KEPT AFTER. A figure is a few hundred triangles of CPU-side geometry and no
 * texture; the first time a character is met theirs is built and cached, and from then on being
 * offered a ride is a `visible` flag and a `position.set`. Only one is ever shown at a time.
 */

/** The looks, by `PassengerDef.portrait`. Adding a character is adding an entry here. */
const LOOKS: Record<string, HumanLook> = {
  /**
   * Mika: cropped jacket, magenta fringe over a black undercut, a headset, and the camera up
   * in one hand while the other flags you down. The only passenger who waves — she has an
   * audience watching her do it.
   */
  mika: {
    height: 0.97,
    build: 0.94,
    skin: 0xe0a184,
    hair: 0x2c1b3e,
    hairAccent: 0xff3df0,
    head: 'fringe',
    coat: 0x3b3352,
    coatLength: 0.1,
    legs: 0x4a4062,
    boots: 0x26222f,
    pose: 'hail',
    eyes: 'eyes',
    eyeColor: 0x4ff3ff,
    band: 0xff3df0,
    aura: 0xd05cff,
    prop: 'camera',
    propColor: 0x2a2a36,
    propAccent: 0xff2b3d,
  },
  /**
   * Vera: twelve hours down, arms folded, work cap, hi-vis over a heavy jacket and her bag on
   * the floor beside her. Nothing about her is in a hurry.
   */
  vera: {
    height: 0.99,
    build: 1.04,
    skin: 0xc4977b,
    hair: 0x3a2418,
    head: 'cap',
    headwear: 0x35485c,
    coat: 0x46586a,
    coatLength: 0.4,
    legs: 0x4a5f72,
    boots: 0x2d343b,
    pose: 'folded',
    band: 0xa8ff3e,
    aura: 0x8a7bff,
    prop: 'toolbag',
    propColor: 0x424951,
    propAccent: 0xa8ff3e,
  },
  /**
   * Nico: a mass of hair, a padded jacket, one hand in a pocket and the other never far from
   * the case — which is the only thing about him with a light on it, and he would rather it
   * did not.
   */
  nico: {
    height: 1.02,
    build: 1.08,
    skin: 0x7a4d36,
    hair: 0x4a3524,
    head: 'mop',
    coat: 0x4b5340,
    coatLength: 0.4,
    legs: 0x3b4437,
    boots: 0x272d22,
    pose: 'pocket',
    aura: 0x9b5cff,
    prop: 'case',
    propColor: 0x3d4534,
    propAccent: 0xa8ff3e,
  },
};

/** Somebody the catalogue has but nobody has drawn yet: a person in a dark coat, waiting. */
const PLAIN: HumanLook = {
  skin: 0xb08a6c,
  hair: 0x241c18,
  head: 'crop',
  coat: 0x474d58,
  legs: 0x3a3e47,
  boots: 0x26282d,
  pose: 'idle',
  aura: 0x9b5cff,
};

/** True when a character has a look of their own. For the tests that hold the catalogue to it. */
export function hasPassengerLook(portrait: string): boolean {
  return Object.prototype.hasOwnProperty.call(LOOKS, portrait);
}

/** The look a character is drawn with, theirs or the plain one. Never null. */
export function passengerLook(portrait: string): HumanLook {
  return LOOKS[portrait] ?? PLAIN;
}

/** How far across the street to look for the kerb, and how finely. Metres. */
const SWEEP_MAX = 12;
const SWEEP_STEP = 0.5;
/** How far inside the kerb they stand, once it is found: on the tarmac, about to step off it. */
const KERB_INSET = 1;
/**
 * How far out they stand at the least and at the most.
 *
 * The floor is what makes this safe. Every stop is placed with the whole of a 4.2 m disc on the
 * road (`tests/passenger.test.ts` holds the city to it), so 4 m across the street is tarmac at
 * any stop, whatever the sweep finds — and it is well clear of a car parked on the mark, which
 * is half of the point of not standing them in the middle of their own ring.
 */
const STAND_MIN = 4;
const STAND_MAX = 9.5;
/** Where they wait when there is no road test to ask: up the street, inside the stop's own zone. */
const FALLBACK_ALONG = 3.8;

/** Where one person stands, and which way they are looking, in world space. */
export interface StandingSpot {
  x: number;
  z: number;
  /** Group rotation about Y that turns the figure's local -z to face the road. */
  yaw: number;
}

/**
 * The spot at a stop where somebody would actually stand: at the kerb, looking at the traffic.
 *
 * `isRoad` is the world's own test (`CityPlan.isRoad`) and is optional — without it this falls
 * back to standing up the street, which the stop's placement rules already guarantee is tarmac.
 * Pure arithmetic either way: called when a ride is offered, never per frame.
 */
export function standAt(stop: PassengerStop, isRoad?: (x: number, z: number, pad?: number) => boolean): StandingSpot {
  const h = stop.heading;
  // The marker's own facing (local -z under `rotation.y = -heading`), and across it.
  const fx = Math.sin(h);
  const fz = -Math.cos(h);
  const px = Math.cos(h);
  const pz = Math.sin(h);

  if (isRoad) {
    // Walk out across the street both ways until the road runs out. A stop at a junction has
    // no edge either way inside the sweep; one on a normal street has two, and the nearer of
    // them is the pavement the stop was put beside.
    let side = 1;
    let edge = Infinity;
    for (const s of [1, -1]) {
      for (let d = SWEEP_STEP; d <= SWEEP_MAX; d += SWEEP_STEP) {
        if (isRoad(stop.x + px * s * d, stop.z + pz * s * d, 0)) continue;
        if (d < edge) {
          edge = d;
          side = s;
        }
        break;
      }
    }
    // A step inside whichever kerb that was, and never nearer the middle of the road than the
    // floor — which is also where somebody waits when the sweep found no kerb at all.
    const out = Number.isFinite(edge) ? Math.min(STAND_MAX, Math.max(STAND_MIN, edge - KERB_INSET)) : STAND_MIN;
    return {
      x: stop.x + px * side * out,
      z: stop.z + pz * side * out,
      // Facing back across the road at the car: the reverse of the way they stepped out.
      yaw: Math.atan2(side * px, side * pz),
    };
  }

  return {
    x: stop.x + fx * FALLBACK_ALONG,
    z: stop.z + fz * FALLBACK_ALONG,
    // Looking back down the street at the ring they are waiting beside.
    yaw: Math.atan2(fx, fz),
  };
}

/**
 * The one passenger standing in the world right now: whoever it is, wherever the ride has them.
 *
 * One of these exists for the whole session. `show` swaps which character's figure is visible
 * and stands them at a stop; `hide` puts them all away, which is the state most of the time.
 */
export interface PassengerFigureVisual {
  group: THREE.Group;
  /** Stand this character at this stop. Builds their figure the first time they are seen. */
  show(portrait: string, stop: PassengerStop): void;
  hide(): void;
  update(time: number): void;
  dispose(): void;
}

export function createPassengerFigure(isRoad?: (x: number, z: number, pad?: number) => boolean): PassengerFigureVisual {
  const group = new THREE.Group();
  group.name = 'passenger-figure';
  group.visible = false;
  const built = new Map<string, HumanFigureVisual>();
  let current: HumanFigureVisual | null = null;

  return {
    group,
    show(portrait, stop) {
      let figure = built.get(portrait);
      if (!figure) {
        // The phase comes off the name, so two characters never sway in step.
        let phase = 0;
        for (let i = 0; i < portrait.length; i++) phase += portrait.charCodeAt(i);
        figure = createHumanFigure(passengerLook(portrait), { phase: phase % 7, name: `passenger-${portrait}` });
        built.set(portrait, figure);
        group.add(figure.group);
      }
      if (current && current !== figure) current.group.visible = false;
      current = figure;
      figure.group.visible = true;
      const spot = standAt(stop, isRoad);
      figure.group.position.set(spot.x, stop.y, spot.z);
      figure.group.rotation.y = spot.yaw;
      group.visible = true;
    },
    hide() {
      group.visible = false;
    },
    update(time) {
      if (!group.visible || !current) return;
      current.update(time);
    },
    dispose() {
      for (const figure of built.values()) figure.dispose();
      built.clear();
      current = null;
      group.clear();
    },
  };
}
