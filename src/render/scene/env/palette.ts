/**
 * The arena colour script, straight from `docs/VISUAL_DIRECTION.md`.
 *
 * TWO HUES, NOTHING ELSE. The whole arena is built from a cold teal/cyan family and a hot
 * pink/magenta family, with violet as the only bridge between them. There is no green, no
 * amber, no red: a night street reads as *atmosphere* when the eye has two colours to place,
 * and as noise when it has six.
 *
 * The base is never black. Every shadow bottoms out in a blue-teal haze (`fog`), which is
 * also where the sky, the ground plane and the far skyline all settle, so distance dissolves
 * into colour instead of into void.
 *
 * Zones are told apart by which family dominates, not by adding a third one:
 * corporate = cool cyan/blue, urban = cyan against magenta, JDM = hot magenta/pink.
 */
export const PAL = {
  // Sky and atmosphere. `fog` is the single most important value here: it is the floor the
  // whole scene sits on, and lifting it is what keeps the night blue instead of pitch dark.
  night: 0x14232f,
  fog: 0x2e5372,
  skyTop: 0x192f45,
  skyHorizon: 0x36648a,
  skyGlow: 0x4a2b53,

  // Surfaces. The road is deliberately the lightest large surface: readability first.
  ground: 0x18262f,
  asphalt: 0x3a4b5c,
  sidewalk: 0x2d3b46,
  curb: 0x4a5a68,
  concrete: 0x3b4854,
  metalDark: 0x33404d,
  rust: 0x3a2c33,

  // Road paint. Cold and worn; the wet asphalt does the talking, not the markings.
  laneWhite: 0xa9c2d6,
  laneCenter: 0x7e90a2,
  laneWorn: 0x5c6b7a,

  // Facades.
  facadeCorp: 0x27333f,
  facadeUrban: 0x28303a,
  facadeJdm: 0x2a3038,

  // Window light. Three values only: icy, teal, rose.
  winCold: 0xcfe6ff,
  winCyan: 0x6fd8f0,
  winWarm: 0xff9db4,
  winOff: 0x18232e,

  // Neon. Cold family, hot family, and violet where they meet.
  neonCyan: 0x3fe8ff,
  neonBlue: 0x3f7dff,
  neonWhite: 0xd6f2ff,
  neonMagenta: 0xff2f9b,
  neonPink: 0xff7ac0,
  neonViolet: 0x8f5bff,
} as const;

/** Per-zone accent colours, so props pick the right neon without a lookup table everywhere. */
export const ZONE_ACCENT = {
  corporate: [PAL.neonCyan, PAL.neonBlue, PAL.neonWhite],
  urban: [PAL.neonCyan, PAL.neonMagenta, PAL.neonViolet],
  // The hot half still needs a cold note or it reads as one flat wash of pink.
  jdm: [PAL.neonMagenta, PAL.neonPink, PAL.neonCyan],
} as const;
