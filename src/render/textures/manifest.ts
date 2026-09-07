/**
 * Every image file the game loads off disk, in one table.
 *
 * The rest of the renderer draws its textures procedurally (`scene/env/textures.ts`); this is
 * the escape hatch for hand-made art. A slot names a surface, not a file: the loader tries the
 * candidate files in order and takes the first that arrives, so dropping a better
 * `public/textures/road/asphalt.webp` next to the old one is the whole swap — no code change,
 * no cache key, no import. Nothing here is required to exist. Every surface that reads a slot
 * also passes a procedural fallback, so a missing (or slow, or corrupt) file costs the look of
 * that surface and nothing else.
 *
 * WHERE THE FILES LIVE
 *   public/textures/<folder>/<name>.<ext>     served as /textures/<folder>/<name>.<ext>
 * The folder layout and the format/size conventions are documented in
 * `public/textures/README.md`, which is the file to read before adding art.
 */

/** Served path the candidate files below are resolved against. */
export const TEXTURE_ROOT = '/textures/';

export interface TextureSpec {
  /**
   * Candidate files under `public/textures/`, best format first. The first one that loads
   * wins, so a `.webp` shadows a `.png` of the same art without touching this table.
   */
  files: string[];
  /** Repeats across the surface instead of clamping at its edges. Tiles must be seamless. */
  tiling?: boolean;
  /**
   * Repeats mirrored on both axes. Every other tile is flipped, so the edges always meet
   * themselves: a photograph that does not wrap seamlessly still tiles without a visible
   * join. Implies `tiling`.
   */
  mirrored?: boolean;
  /** Non-colour data (normal, roughness, mask). Colour art (the default) is decoded as sRGB. */
  linear?: boolean;
  /** Requested anisotropic filtering; the renderer clamps it to what the GPU supports. */
  anisotropy?: number;
  /**
   * Pulls every pixel this far (0..1) towards `color` before `gain`. Photographic art is lit
   * by whatever daylight it was shot in; this is what carries it into the city's night palette
   * without a trip through an image editor.
   */
  tint?: { color: number; amount: number };
  /** Multiplies every pixel after `tint`. Above 1 lifts dark art, below 1 sits it back down. */
  gain?: number;
  /**
   * Target average brightness (0..1) for a map that multiplies into a vertex colour rather
   * than replacing it — foliage and bark, where the palette already says what colour the thing
   * is and the photograph is only there for detail. Without this, a tile averaging 0.25 makes
   * everything sampling it four times darker than the palette asked for.
   *
   * The lift is a gamma, not a multiply: white stays white, so nothing clips and no highlight
   * is lost — the cost is some contrast in the art, which is the right thing to trade at
   * night. Around 0.6-0.7 keeps a surface close to the brightness it had untextured.
   */
  normalize?: number;
  /**
   * Contrast expansion applied AFTER `normalize`, about the tile's own mean: 1 leaves the art
   * alone, 1.5 pushes every pixel half again as far from the average as it was. The mean is
   * restored afterwards, so this buys grain without moving the surface's brightness.
   *
   * It exists because `normalize` is a gamma, and a gamma that lifts a dark photograph is also
   * a gamma that flattens it — the concrete tile loses about 43% of its contrast on the way to
   * a mean of 0.62, which on a night wall is the difference between visible grain and none.
   * `normalize` sets where the surface sits; this sets how much of the photograph survives
   * getting it there.
   */
  contrast?: number;
}

/**
 * The slots. Add an entry here, drop the file in `public/textures/`, and read the slot from
 * whichever material wants it (see `createEnvironment` for the road).
 */
export const TEXTURES = {
  /**
   * The street surface: wet, patched, cracked asphalt, tiling every `ROAD_TILE` metres
   * (`scene/env/cityBuilder.ts`) across every road, alley and viaduct deck in the city.
   * The art is a neutral dark grey photograph; the tint and gain are what make it belong to
   * the same night as the buildings around it.
   */
  'road/asphalt': {
    files: ['road/asphalt.webp', 'road/asphalt.png', 'road/asphalt.jpg'],
    tiling: true,
    anisotropy: 8,
    tint: { color: 0x3f5a70, amount: 0.28 },
    gain: 1.25,
  },

  /**
   * Leaf mass: the palm fronds and every clipped hedge in the city. Photographed in daylight,
   * so the tint is doing real work here — it takes the green a long way towards the bay's
   * teal night before the hemisphere light ever touches it.
   */
  /**
   * Concrete: every grey slab in the city, read by two surfaces.
   *
   *   - the walls between the windows on a tower facade, as a detail map over the facade atlas
   *     (`scene/env/facadeAtlas.ts`), multiplying only the concrete so the glass keeps the
   *     atlas exactly as it is drawn;
   *   - the big blank walls at street level — ground-floor modules, viaduct skirts and piers,
   *     alley and retaining walls — through `scene/env/wallDetail.ts`, projected in world
   *     space so a wall never has to carry a UV for it.
   *
   * The second is where it earns its keep: those are the surfaces a car drives past at arm's
   * length. The photograph does not wrap, hence `mirrored`; the grade takes the daylight grey
   * down into the bay's night.
   */
  'buildings/concrete': {
    files: ['buildings/concrete.webp', 'buildings/concrete.png', 'buildings/concrete.jpg'],
    tiling: true,
    mirrored: true,
    anisotropy: 8,
    // Graded gently on purpose. The night lighting is doing most of the colour work already,
    // and every step of the grade costs contrast the wall needs: at the old `amount: 0.3` the
    // photograph reached the wall as a +/-13% multiply, which is under what anyone notices at
    // speed. A lighter tint plus the contrast expansion below lands it near +/-21% instead.
    tint: { color: 0x33414e, amount: 0.18 },
    normalize: 0.62,
    contrast: 1.5,
  },

  'nature/foliage': {
    files: ['nature/foliage.webp', 'nature/foliage.png', 'nature/foliage.jpg'],
    tiling: true,
    anisotropy: 4,
    tint: { color: 0x1b4f52, amount: 0.42 },
    normalize: 0.66,
  },

  /**
   * Palm trunks. Warm brown bark under a cold city; tinted back towards the night and dropped
   * a little, so a row of trunks does not glow against the asphalt behind them.
   */
  'nature/bark': {
    files: ['nature/bark.webp', 'nature/bark.png', 'nature/bark.jpg'],
    tiling: true,
    anisotropy: 4,
    tint: { color: 0x2f3a46, amount: 0.36 },
    normalize: 0.78,
  },
} as const satisfies Record<string, TextureSpec>;

export type TextureSlot = keyof typeof TEXTURES;
