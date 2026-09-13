import type { ZoneId } from '../../../world/cityPlan';

/**
 * The colour script. Three of them:
 *
 * ARENA — the test block and the circuit, straight from `docs/VISUAL_DIRECTION.md`: a cold
 * teal/cyan family and a hot pink/magenta family, violet as the bridge, a lifted blue-teal
 * haze as the floor. Two hues, nothing else.
 *
 * BAY — the City, taken from Juan's references (2026-09-06, second round): a teal night —
 * teal-grey fog and sky, green-grey pavement, grey-teal concrete — lit by cold white and
 * pale-teal windows and lamps, with red (the corporate billboards, the traffic lights) and a
 * warm sodium amber (lamps, stalls, old-town windows) as the only hot notes. No violet, and
 * the magenta family of the arena becomes red/coral here, so the sign atlas and the
 * holographic screens come out red and teal instead of pink and purple.
 *
 * STACK — the bay, with every window list and accent list re-weighted warm (see
 * `STACK_PALETTE` below).
 *
 * Every builder reads `PAL`, which `applyPalette` fills from one of the three before the
 * environment is built. Zones are told apart by which family dominates, not by adding a
 * third one: corporate = cool cyan/violet, urban = cyan against magenta, JDM = hot and amber.
 */
export interface Palette {
  // Sky and atmosphere. `fog` is the single most important value: it is the floor the whole
  // scene sits on, and lifting it is what keeps the night blue instead of pitch dark.
  night: number;
  fog: number;
  skyTop: number;
  skyHorizon: number;
  skyGlow: number;

  // Surfaces. The road is deliberately the lightest large surface: readability first.
  ground: number;
  asphalt: number;
  sidewalk: number;
  curb: number;
  concrete: number;
  metalDark: number;
  rust: number;

  // Road paint. Cold and worn; the wet asphalt does the talking, not the markings.
  laneWhite: number;
  laneCenter: number;
  laneWorn: number;

  // Facades.
  facadeCorp: number;
  facadeUrban: number;
  facadeJdm: number;

  // Window light.
  winCold: number;
  winCyan: number;
  winWarm: number;
  winViolet: number;
  winAmber: number;
  winOff: number;
  /** Which window lights each zone's facade texture mixes. */
  windowsCorp: number[];
  windowsUrban: number[];
  windowsJdm: number[];

  // Neon. Cold family, hot family, violet where they meet, and the bay's amber.
  neonCyan: number;
  neonBlue: number;
  neonWhite: number;
  neonMagenta: number;
  neonPink: number;
  neonViolet: number;
  neonAmber: number;
  /** The warm lamp head: rose in the arena, amber in the bay. */
  lampWarm: number;

  // How hard the lit things burn, relative to the arena: neon tubes, window emissive, the
  // holographic screens and the additive glow. The bay's night is darker, so its light is not.
  neonGain: number;
  windowGain: number;
  screenGain: number;
  glowGain: number;
  /** Multiplier on the fraction of windows that are lit. */
  litGain: number;
  /** The bay's surface. */
  water: number;
  /** Leaf mass: canopies, fronds, shrubs, weeds. */
  foliage: number;
  /** Dead and dying growth: bleached weeds, bare branches, the thin stuff in a crack. */
  foliageDry: number;
  /** Trunks and branches: kept well above the night floor, or a tree reads as a floating crown. */
  bark: number;
  /**
   * The sky dome's three colours, when the palette wants other than `ATMOSPHERE`'s (the
   * storm sky is tuned once for the bay; the stack's references show a bluer, brighter sky).
   */
  sky?: { zenith: number; middle: number; horizon: number };
  /**
   * Spray-can colours, in the order a writer reaches for them: cold, hot, bleached white,
   * a warm accent and two dirty ones. Graffiti is paint, not neon, so these are read by the
   * scene light like any other surface.
   */
  paint: number[];
  /** Damp, soot, stains and cracks on concrete. */
  grime: number;

  // The two scene lights.
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  keyColor: number;
  keyIntensity: number;

  // Per-zone accent colours, so props pick the right neon without a lookup table everywhere.
  accentCorporate: number[];
  accentUrban: number[];
  accentJdm: number[];
}

export const ARENA_PALETTE: Palette = {
  night: 0x14232f,
  fog: 0x2e5372,
  skyTop: 0x192f45,
  skyHorizon: 0x36648a,
  skyGlow: 0x4a2b53,

  ground: 0x18262f,
  asphalt: 0x3a4b5c,
  sidewalk: 0x2d3b46,
  curb: 0x4a5a68,
  concrete: 0x3b4854,
  metalDark: 0x33404d,
  rust: 0x3a2c33,

  laneWhite: 0xa9c2d6,
  laneCenter: 0x7e90a2,
  laneWorn: 0x5c6b7a,

  facadeCorp: 0x27333f,
  facadeUrban: 0x28303a,
  facadeJdm: 0x2a3038,

  winCold: 0xcfe6ff,
  winCyan: 0x6fd8f0,
  winWarm: 0xff9db4,
  winViolet: 0x8f5bff,
  // No amber in the arena: its "amber" is the rose it always had.
  winAmber: 0xff9db4,
  winOff: 0x18232e,
  windowsCorp: [0xcfe6ff, 0x6fd8f0, 0xcfe6ff],
  windowsUrban: [0xff9db4, 0x6fd8f0, 0xcfe6ff],
  windowsJdm: [0xff9db4, 0x6fd8f0],

  neonCyan: 0x3fe8ff,
  neonBlue: 0x3f7dff,
  neonWhite: 0xd6f2ff,
  neonMagenta: 0xff2f9b,
  neonPink: 0xff7ac0,
  neonViolet: 0x8f5bff,
  neonAmber: 0xff7ac0,
  lampWarm: 0xff9db4,

  neonGain: 1,
  windowGain: 1,
  screenGain: 1,
  glowGain: 1,
  litGain: 1,
  water: 0x0b1d2e,
  foliage: 0x1b4f52,
  foliageDry: 0x5c5946,
  bark: 0x5a4a50,
  paint: [0x3fe8ff, 0xff2f9b, 0xd8e4ee, 0x8f5bff, 0xc4553f, 0x6c7a72],
  grime: 0x16202a,

  hemiSky: 0x5aa0d4,
  hemiGround: 0x2a3f50,
  hemiIntensity: 2.5,
  keyColor: 0x8fb8e8,
  keyIntensity: 0.5,

  accentCorporate: [0x3fe8ff, 0x3f7dff, 0xd6f2ff],
  accentUrban: [0x3fe8ff, 0xff2f9b, 0x8f5bff],
  // The hot half still needs a cold note or it reads as one flat wash of pink.
  accentJdm: [0xff2f9b, 0xff7ac0, 0x3fe8ff],
};

export const BAY_PALETTE: Palette = {
  night: 0x08151a,
  fog: 0x163a41,
  skyTop: 0x040d14,
  skyHorizon: 0x14424c,
  skyGlow: 0x0f3540,

  ground: 0x0f1e20,
  asphalt: 0x2a3c44,
  sidewalk: 0x22362f,
  curb: 0x3a5049,
  concrete: 0x2b3d42,
  metalDark: 0x1e2c32,
  rust: 0x3a302b,

  laneWhite: 0xb9c9cc,
  // Yellow centre lines and crossings, as in the reference.
  laneCenter: 0xc8b25c,
  laneWorn: 0x5a6b66,

  facadeCorp: 0x141f26,
  facadeUrban: 0x18232a,
  facadeJdm: 0x1c2529,

  winCold: 0xdff1ff,
  winCyan: 0x7fe0ea,
  winWarm: 0xffd9a8,
  // Pale blue-teal where the arena has violet.
  winViolet: 0x9fd0e8,
  winAmber: 0xffc27a,
  winOff: 0x0f1a1e,
  windowsCorp: [0xdff1ff, 0x7fe0ea, 0xdff1ff],
  windowsUrban: [0xdff1ff, 0xffd9a8, 0x7fe0ea],
  windowsJdm: [0xffc27a, 0xffd9a8, 0xdff1ff],

  neonCyan: 0x3ff0e8,
  neonBlue: 0x4fa8ff,
  neonWhite: 0xe6f7ff,
  // The hot family: red and coral, not pink and purple.
  neonMagenta: 0xff3d4a,
  neonPink: 0xff8a5c,
  neonViolet: 0x5fc8d8,
  neonAmber: 0xffb347,
  lampWarm: 0xffd7a0,

  neonGain: 1.1,
  windowGain: 1.25,
  screenGain: 1.05,
  glowGain: 1.2,
  litGain: 1.4,
  water: 0x0b2226,
  foliage: 0x3f8f5a,
  foliageDry: 0x6d6a4c,
  bark: 0x6a5946,
  paint: [0x3ff0e8, 0xff3d4a, 0xd6e2e0, 0xffb347, 0x9a5f3a, 0x64806a],
  grime: 0x0c1a1a,

  hemiSky: 0x2f6f7a,
  hemiGround: 0x0d1a1c,
  hemiIntensity: 1.9,
  keyColor: 0x9fc4cf,
  keyIntensity: 0.42,

  accentCorporate: [0x3ff0e8, 0xe6f7ff, 0x4fa8ff],
  accentUrban: [0x3ff0e8, 0xe6f7ff, 0xff3d4a, 0xffb347],
  accentJdm: [0xffb347, 0xff3d4a, 0xff8a5c, 0x3ff0e8],
};

/**
 * STACK — The Stack (`src/world/stackSpec.ts`, Phase 3 of `docs/CITY_V2_BRIEF.md`): the bay's
 * night with the light shifted the way the two reference images have it. Sodium amber leads
 * every window list, cold white is second and teal third; the accents that go on crowns,
 * skybridges, shopfronts and corner strips are warm-first with one cold note, and the only
 * hot colour is the red the passages and portal frames place by hand, one bar to a view. The
 * old town keeps its coral. Everything else — fog, sky, asphalt, concrete, the two lights —
 * is the bay's, so the two cities read as one night.
 */
export const STACK_PALETTE: Palette = {
  ...BAY_PALETTE,
  // Teal third, but the references' teal is a cyan-white, and a tower tinted the bay's
  // saturated teal through a big-paned style was the last strong green in the frame.
  windowsCorp: [0xffc27a, 0xffd9a8, 0xdff1ff, 0xffc27a, 0xc4ecf2, 0xffd9a8],
  windowsUrban: [0xffc27a, 0xffd9a8, 0xffc27a, 0xdff1ff, 0xc4ecf2, 0xffd9a8],
  windowsJdm: [0xffc27a, 0xffd9a8, 0xffc27a, 0xffb347, 0xdff1ff],
  accentCorporate: [0xffb347, 0xffd7a0, 0xe6f7ff, 0x3ff0e8],
  accentUrban: [0xffb347, 0xffd7a0, 0xffb347, 0xe6f7ff, 0x3ff0e8],
  accentJdm: [0xffb347, 0xffd7a0, 0xff8a5c, 0xffb347, 0x3ff0e8],
  // The bounce off the wet streets, lifted and warmed. It is the ONLY light a downward face
  // ever gets under a hemisphere, and the Stack is a city of ceilings: the passage soffits,
  // the deck undersides over every stacked crossing. The bay's ground term reads them as a
  // black lid (Phase 2 measured a passage ceiling at 16, 29, 29). A vertical wall takes half
  // of this and the road none, so the asphalt keeps its contrast with the structure over it.
  hemiGround: 0x25292b,
  // MEASURED AGAINST THE REFERENCES (2026-09-12, mean sRGB of patches): the sky is a blue-teal
  // (36,80,93) and (29,61,75), the far towers in the haze (34,68,80) and (23,49,58), but the
  // near structure is DARK and NEUTRAL — piers (32,48,53), a slab (39,43,39), a ceiling
  // (15,14,12), the walls at the driver's shoulder (25,20,15) and (38,29,31), the road
  // (39,35,29). The bay's greens (its teal fog, its green kerb and concrete, its teal
  // hemisphere) were putting that far-haze colour onto everything near. So: the air stays
  // blue-teal, the concrete goes neutral grey, and the light that falls on it goes blue-grey.
  fog: 0x1a3d4b,
  skyTop: 0x061523,
  skyHorizon: 0x2a5d70,
  skyGlow: 0x1a4050,
  ground: 0x121517,
  sidewalk: 0x2c3032,
  curb: 0x45494a,
  concrete: 0x33383a,
  metalDark: 0x1c2124,
  hemiSky: 0x3d6478,
  keyColor: 0xa9c6d4,
  sky: { zenith: 0x040c16, middle: 0x122f3d, horizon: 0x2c5e72 },
  // The cold windows are cyan-WHITE in the references, not teal: a whole tower tinted teal
  // through the big `panels` cell was the last strong green in the frame.
  winCyan: 0xc4ecf2,
  // The concrete between the panes, as the facade atlas draws it. The bay's is near-black so
  // its windows carry the light; the references' towers are mid-grey concrete with holes of
  // light in them. Still well under the atlas shader's glass threshold (linear 0.08).
  facadeUrban: 0x24292c,
  facadeCorp: 0x23282b,
  facadeJdm: 0x272a2a,
  // More of the panes lit and burning harder: the references' towers are walls of warm
  // light with concrete between, and the first pass read dimmer than the Bay.
  litGain: 1.8,
  windowGain: 1.5,
  neonGain: 1.15,
  glowGain: 1.3,
};

export type PaletteName = 'arena' | 'bay' | 'stack';

/** The live palette every builder reads. Filled by `applyPalette` before a world is built. */
export const PAL: Palette = { ...ARENA_PALETTE };

export function applyPalette(name: PaletteName): void {
  Object.assign(PAL, name === 'bay' ? BAY_PALETTE : name === 'stack' ? STACK_PALETTE : ARENA_PALETTE);
}

/** Accent colours for a zone, from the live palette. */
export function zoneAccent(zone: ZoneId): readonly number[] {
  return zone === 'corporate' ? PAL.accentCorporate : zone === 'jdm' ? PAL.accentJdm : PAL.accentUrban;
}
