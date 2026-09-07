/**
 * One colour per slot, so a player is the same colour everywhere they appear: the marker strip
 * and beacon on their car, their dot on the minimap, their name tag, their row in the standings
 * and the results, and their name in the open world's roster.
 *
 * A slot is a grid position in a race and a seat in the open world, but it means the same thing
 * either way — it is how you tell one car from another at a glance. There are exactly
 * `MAX_WORLD_PLAYERS` of these, because the city cannot hold more players than there are
 * colours to tell them apart with.
 *
 * Drawn from the game's own palette (`src/styles.css`) rather than the usual red/blue/green,
 * and ordered so the two most common cases — a 1v1 — get the two signature colours of the
 * game, with the versus grid's four first and the rest of the city behind them. Values are
 * plain numbers and strings: this module is shared by the Three.js scene and the DOM UI, so
 * like everything in `src/core` it imports neither.
 */

/** Slot 0..7. Cyan and magenta first: a 1v1 is then the game's own two colours. */
export const SLOT_COLORS = [
  0x4ff3ff, // cyan
  0xff3df0, // magenta
  0xa8ff3e, // lime
  0xffa53d, // amber
  0x8c6bff, // violet
  0xff5566, // hot red
  0x3dffb0, // mint
  0xffe94d, // sodium yellow
] as const;

/** Hex colour for a grid slot. Wraps, so an out-of-range slot still gets something. */
export function slotColor(slot: number): number {
  const index = ((slot % SLOT_COLORS.length) + SLOT_COLORS.length) % SLOT_COLORS.length;
  return SLOT_COLORS[index];
}

/** The same colour as a CSS string, for the HUD and the lobby. */
export function slotCss(slot: number): string {
  return `#${slotColor(slot).toString(16).padStart(6, '0')}`;
}
