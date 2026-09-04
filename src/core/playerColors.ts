/**
 * One colour per grid slot, so a player is the same colour everywhere they appear: the marker
 * strip and beacon on their car, their dot on the minimap, their name tag, their row in the
 * standings and the results.
 *
 * Drawn from the game's own palette (`src/styles.css`) rather than the usual red/blue/green,
 * and ordered so the two most common cases — a 1v1 — get the two signature colours of the
 * game. Values are plain numbers and strings: this module is shared by the Three.js scene and
 * the DOM UI, so like everything in `src/core` it imports neither.
 */

/** Slot 0..3. Cyan and magenta first: a 1v1 is then the game's own two colours. */
export const SLOT_COLORS = [0x4ff3ff, 0xff3df0, 0xa8ff3e, 0xffa53d] as const;

/** Hex colour for a grid slot. Wraps, so an out-of-range slot still gets something. */
export function slotColor(slot: number): number {
  const index = ((slot % SLOT_COLORS.length) + SLOT_COLORS.length) % SLOT_COLORS.length;
  return SLOT_COLORS[index];
}

/** The same colour as a CSS string, for the HUD and the lobby. */
export function slotCss(slot: number): string {
  return `#${slotColor(slot).toString(16).padStart(6, '0')}`;
}
