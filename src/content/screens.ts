/**
 * THE SCREENS — what every LED billboard, blade sign, ticker and hologram in the city shows.
 *
 * Each entry is one CHANNEL: a feed some number of screens in the world are tuned to. A screen
 * never knows what it shows, only which channel (`env/screenBuilder.ts` picks them), so what is
 * on the city's screens is changed here and nowhere else.
 *
 * A channel is a short playlist of FRAMES that the screen cycles through, `seconds` each, with
 * a scan wipe between them (a hologram cuts instead, which is what makes a flipbook of it).
 * Every frame of every channel sits in the one screen atlas (`env/screenAtlas.ts`), so all the
 * screens in the city are still one draw call. The atlas grows taller as frames are added:
 * 2048 x 2048 holds today's, 4096 tall is the ceiling, so keep the frame count honest.
 *
 * WHAT A FRAME IS
 * - `{ design: 'cola', page: 0 }`: one of the procedural placeholder ads in `env/screenArt.ts`.
 * - `{ image: '/screens/my-ad.webp' }`: a file of your own, from `public/`. It is drawn to cover
 *   the frame (cropped, not stretched), in the background: the placeholder `fallback` design
 *   shows until it has loaded, and stays if the file is missing.
 *
 * Shapes, and the pixels a frame gets: `wide` 500 x 276 (16:9, facade boards and hero screens),
 * `tall` 244 x 500 (1:2, blade signs and banners), `strip` 1012 x 116 (a ticker). An image
 * of that aspect at twice those pixels is plenty: the atlas is mipmapped.
 *
 * Video is the next step and fits the same slot: a channel's frame would be redrawn from a
 * `<video>` each tick and only its rectangle re-uploaded (see `env/screenAtlas.ts`).
 *
 * Everything here is invented. Keep it that way: no real brands, no real people.
 */

export type ScreenShape = 'wide' | 'tall' | 'strip';

/**
 * How the picture moves inside the screen. `still` is a plain board; `scrollUp` / `scrollDown`
 * roll a tall panel of data endlessly (the Bay's old holographic columns); `ticker` runs a
 * strip sideways; `holo` is drawn additive, with scan lines, by the hologram material.
 */
export type ScreenMotion = 'still' | 'scrollUp' | 'scrollDown' | 'ticker' | 'holo';

/** The procedural placeholder designs `env/screenArt.ts` can paint. */
export type ScreenDesign =
  | 'cola'
  | 'ramen'
  | 'motors'
  | 'news'
  | 'neuro'
  | 'bank'
  | 'volt'
  | 'idol'
  | 'kanji'
  | 'pills'
  | 'ticker'
  | 'alert'
  | 'holoKoi'
  | 'holoBolt'
  | 'holoData'
  | 'holoColumn';

export type ScreenFrame = { design: ScreenDesign; page?: number } | { image: string; fallback?: { design: ScreenDesign; page?: number } };

export interface ScreenChannel {
  id: string;
  shape: ScreenShape;
  motion: ScreenMotion;
  /** Seconds a frame stays up. A hologram's frames are a flipbook, so fractions of a second. */
  seconds: number;
  frames: ScreenFrame[];
  /**
   * The colour the screen throws on the street and the wall around it (its halo and the pool
   * on the asphalt). The key colour of the ad, not an average of it.
   */
  glow: number;
  /** Where the placement may use it: `facade` boards, `blade` signs, `roof` boards, `holo` projections. Missing: anywhere its shape fits. */
  use?: Array<'facade' | 'blade' | 'roof' | 'holo'>;
}

/**
 * Every channel in the city. The first two are the Bay's old holographic columns, kept
 * exactly as they were for the boards on its perimeter and rooftops; the Stack and the metro's
 * district of screens show the rest.
 */
export const SCREEN_CHANNELS: ScreenChannel[] = [
  // The Bay's two holographic data columns, scrolling in opposite directions.
  { id: 'holo-data', shape: 'tall', motion: 'scrollUp', seconds: 60, frames: [{ design: 'holoData' }], glow: 0x3ff0e8, use: [] },
  { id: 'holo-column', shape: 'tall', motion: 'scrollDown', seconds: 60, frames: [{ design: 'holoColumn' }], glow: 0xff3d4a, use: [] },

  // Wide boards.
  { id: 'rayo-cola', shape: 'wide', motion: 'still', seconds: 6.5, frames: [{ design: 'cola', page: 0 }, { design: 'cola', page: 1 }, { design: 'cola', page: 2 }], glow: 0xff3d2e },
  { id: 'kaiju-ramen', shape: 'wide', motion: 'still', seconds: 7, frames: [{ design: 'ramen', page: 0 }, { design: 'ramen', page: 1 }], glow: 0xffb347 },
  { id: 'bandido-motors', shape: 'wide', motion: 'still', seconds: 5.5, frames: [{ design: 'motors', page: 0 }, { design: 'motors', page: 1 }], glow: 0x3ff0e8 },
  { id: 'noticias-24', shape: 'wide', motion: 'still', seconds: 8, frames: [{ design: 'news', page: 0 }, { design: 'news', page: 1 }], glow: 0xe6f7ff },
  { id: 'neurolink', shape: 'wide', motion: 'still', seconds: 7.5, frames: [{ design: 'neuro', page: 0 }, { design: 'neuro', page: 1 }], glow: 0x3ff0e8 },
  { id: 'hikari-bank', shape: 'wide', motion: 'still', seconds: 9, frames: [{ design: 'bank', page: 0 }], glow: 0xe6f7ff },

  // Tall banners and blades.
  { id: 'volt', shape: 'tall', motion: 'still', seconds: 5, frames: [{ design: 'volt', page: 0 }, { design: 'volt', page: 1 }], glow: 0xffd23f },
  { id: 'aiko-live', shape: 'tall', motion: 'still', seconds: 6, frames: [{ design: 'idol', page: 0 }, { design: 'idol', page: 1 }], glow: 0xff5a4a },
  { id: 'denno-gai', shape: 'tall', motion: 'still', seconds: 4.5, frames: [{ design: 'kanji', page: 0 }, { design: 'kanji', page: 1 }], glow: 0x3ff0e8 },
  { id: 'calmex', shape: 'tall', motion: 'still', seconds: 7, frames: [{ design: 'pills', page: 0 }, { design: 'pills', page: 1 }], glow: 0x9fe8d0 },

  // Tickers.
  { id: 'ticker-metro', shape: 'strip', motion: 'ticker', seconds: 60, frames: [{ design: 'ticker' }], glow: 0xffb347 },
  { id: 'ticker-alerta', shape: 'strip', motion: 'ticker', seconds: 60, frames: [{ design: 'alert' }], glow: 0xff3d4a },

  // Holograms: a flipbook, drawn additive over whatever is behind.
  { id: 'holo-koi', shape: 'tall', motion: 'holo', seconds: 0.22, frames: [{ design: 'holoKoi', page: 0 }, { design: 'holoKoi', page: 1 }, { design: 'holoKoi', page: 2 }], glow: 0x3ff0e8, use: ['holo'] },
  { id: 'holo-bolt', shape: 'tall', motion: 'holo', seconds: 0.16, frames: [{ design: 'holoBolt', page: 0 }, { design: 'holoBolt', page: 1 }, { design: 'holoBolt', page: 2 }], glow: 0xffc247, use: ['holo'] },
];
