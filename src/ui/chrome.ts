/**
 * Shared menu chrome: the slashed wordmark, the yellow stamp under it and the decorative
 * frame that sits behind every full-screen menu (main menu, room browser, lobby).
 *
 * Markup only — every visual decision lives in `src/styles.css`. Kept in one place so the
 * three screens cannot drift apart: arriving at the lobby from the menu has to feel like the
 * same terminal, one screen deeper.
 */

export const TITLE = 'RAYO BANDIDO';

/** The wordmark. `data-text` feeds the misregistered red/cyan layers drawn by CSS. */
export function wordmark(): string {
  return `<h1 class="rb-title" data-text="${TITLE}"><span class="rb-title__txt">${TITLE}</span></h1>`;
}

/**
 * Wordmark plus the stamp line under it. `subRole` is set when a screen rewrites the stamp
 * later (the lobby fills in the room name once the server has answered).
 */
export function menuHeader(sub: string, subRole?: string): string {
  const role = subRole ? ` data-role="${subRole}"` : '';
  return (
    `<div class="rb-head">` +
    wordmark() +
    `<div class="rb-stamp rb-menu__sub"${role}>${sub}</div>` +
    `</div>`
  );
}

/**
 * Corner brackets and the tiny system readouts around the edge of the screen. Pure decoration,
 * `aria-hidden`, and never in the way of a click.
 */
export function frameDecor(screen: string): string {
  return (
    `<div class="rb-frame" aria-hidden="true">` +
    `<span class="rb-frame__corner rb-frame__corner--tl"></span>` +
    `<span class="rb-frame__corner rb-frame__corner--tr"></span>` +
    `<span class="rb-frame__corner rb-frame__corner--bl"></span>` +
    `<span class="rb-frame__corner rb-frame__corner--br"></span>` +
    `<span class="rb-frame__read rb-frame__read--tl">RB//OS 0.9 · NIGHT BUILD · ${screen}</span>` +
    `<span class="rb-frame__read rb-frame__read--tr"><i class="rb-blink"></i>SYS LINK</span>` +
    `<span class="rb-frame__read rb-frame__read--bl">0x4F52 · 0xB1D0 · JDM/CYB 50:50</span>` +
    `<span class="rb-frame__read rb-frame__read--br">NO ACCOUNTS · NO COPS · NO MERCY</span>` +
    `</div>`
  );
}
