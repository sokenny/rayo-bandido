/**
 * Inline SVG glyphs for the HUD. Strings so they can be injected once at HUD construction
 * and never re-created per frame. No external requests: the game must run offline.
 *
 * All glyphs are authored in a 24x24 box (48x48 for the reticle) and inherit `currentColor`,
 * so colour comes from CSS tokens in src/styles.css.
 */

/** Lightning bolt: the drift-charged weapon. */
export const BOLT_ICON = `<svg class="rb-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M13.6 2.2 6.2 13.1h4.4l-1.2 8.7 8.4-11.6h-4.9z"/></svg>`;

/** Flame with an inner lick: nitro / warm exhaust core. */
export const FLAME_ICON = `<svg class="rb-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 2.5c3 3.4 5 6.4 5 9.6a5.5 5.5 0 1 1-11 0c0-2 .8-3.6 2.3-5-.2 1.9.5 3.1 1.8 3.8-.9-3 .2-5.8 1.9-8.4z"/></svg>`;

/** Four corner brackets plus centre ticks. Used for the auto-aim lock indicator. */
export const RETICLE_ICON = `<svg class="rb-reticle__svg" viewBox="0 0 48 48" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"><path d="M2 14V2h12"/><path d="M34 2h12v12"/><path d="M46 34v12H34"/><path d="M14 46H2V34"/></g><g fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.85"><path d="M24 18v5"/><path d="M24 25v5"/><path d="M18 24h5"/><path d="M25 24h5"/></g></svg>`;
