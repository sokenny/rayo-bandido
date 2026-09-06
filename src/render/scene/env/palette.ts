import type { ZoneId } from '../../../world/cityPlan';

/**
 * The colour script. Two of them:
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
 * Every builder reads `PAL`, which `applyPalette` fills from one of the two before the
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
  /** Hedges and palm fronds. */
  foliage: number;
  /** Palm trunks: kept well above the night floor, or the tree reads as a floating crown. */
  bark: number;

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
  bark: 0x5a4a50,

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
  bark: 0x6a5946,

  hemiSky: 0x2f6f7a,
  hemiGround: 0x0d1a1c,
  hemiIntensity: 1.9,
  keyColor: 0x9fc4cf,
  keyIntensity: 0.42,

  accentCorporate: [0x3ff0e8, 0xe6f7ff, 0x4fa8ff],
  accentUrban: [0x3ff0e8, 0xe6f7ff, 0xff3d4a, 0xffb347],
  accentJdm: [0xffb347, 0xff3d4a, 0xff8a5c, 0x3ff0e8],
};

export type PaletteName = 'arena' | 'bay';

/** The live palette every builder reads. Filled by `applyPalette` before a world is built. */
export const PAL: Palette = { ...ARENA_PALETTE };

export function applyPalette(name: PaletteName): void {
  Object.assign(PAL, name === 'bay' ? BAY_PALETTE : ARENA_PALETTE);
}

/** Accent colours for a zone, from the live palette. */
export function zoneAccent(zone: ZoneId): readonly number[] {
  return zone === 'corporate' ? PAL.accentCorporate : zone === 'jdm' ? PAL.accentJdm : PAL.accentUrban;
}
