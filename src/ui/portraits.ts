/**
 * Passenger portraits: three original illustrated placeholders, as inline SVG strings keyed by
 * `PassengerDef.portrait`.
 *
 * PLACEHOLDERS THAT READ AS FACES. Nothing here is meant to survive an art pass, but until
 * there is one the HUD needs three people who are recognisably three people — so each is built
 * from the same few shapes (a head, hair, eyes, a mouth, one accessory) with different
 * proportions, colours and expressions, in the flat low-poly manner the rest of the game's
 * chrome uses. Replacing one is replacing the string: the overlay only ever asks
 * `portraitFor(id)` and puts the result in a box.
 *
 * Every one is drawn in a 96x96 box and inherits nothing from CSS: the colours are the
 * character's own, because the HUD is dark and the face has to stay readable over any street.
 */

const BOX = `xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" class="rb-portrait__svg" aria-hidden="true" focusable="false"`;

/**
 * Mika: buzzed undercut with a magenta fringe, a headset mic, a grin. Warm skin, sharp jaw.
 */
const MIKA = `<svg ${BOX}>
<rect width="96" height="96" fill="#160c1f"/>
<circle cx="48" cy="52" r="34" fill="#2a1240" opacity="0.6"/>
<!-- shoulders -->
<path d="M14 96 Q18 72 48 70 Q78 72 82 96 Z" fill="#1f1f2b"/>
<path d="M30 96 Q36 78 48 76 Q60 78 66 96 Z" fill="#ff3df0" opacity="0.55"/>
<!-- neck -->
<rect x="41" y="60" width="14" height="14" rx="4" fill="#c98b6b"/>
<!-- head -->
<path d="M30 40 Q30 18 48 18 Q66 18 66 40 L64 54 Q60 66 48 67 Q36 66 32 54 Z" fill="#e0a184"/>
<!-- hair: undercut sides, fringe -->
<path d="M30 40 Q28 22 48 16 Q68 22 66 40 L62 34 Q54 26 48 30 Q40 26 34 36 Z" fill="#1a0f26"/>
<path d="M34 30 Q46 12 70 24 Q64 26 60 34 Q54 24 46 30 Q40 30 36 40 Z" fill="#ff3df0"/>
<path d="M56 22 Q72 26 68 42 Q66 34 60 30 Z" fill="#ff8af6"/>
<!-- eyes -->
<path d="M37 45 q5 -3 10 0" stroke="#1a0f26" stroke-width="2" fill="none" stroke-linecap="round"/>
<ellipse cx="42" cy="47.5" rx="3.2" ry="2.4" fill="#fff"/>
<circle cx="43" cy="47.5" r="1.7" fill="#1a0f26"/>
<path d="M50 44 q5 -2 9 1" stroke="#1a0f26" stroke-width="2" fill="none" stroke-linecap="round"/>
<ellipse cx="55" cy="47.5" rx="3.2" ry="2.4" fill="#fff"/>
<circle cx="56" cy="47.5" r="1.7" fill="#1a0f26"/>
<!-- nose, grin -->
<path d="M48 50 l-2 6 h4" stroke="#b8704f" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M40 58 Q48 65 57 57" stroke="#8a2f3a" stroke-width="2.2" fill="none" stroke-linecap="round"/>
<path d="M42 59 Q48 62 55 58" fill="#fff"/>
<!-- headset -->
<path d="M28 44 q-4 0 -4 4 v6 q0 4 4 4" stroke="#4ff3ff" stroke-width="2.5" fill="none" stroke-linecap="round"/>
<path d="M26 56 q0 8 12 10" stroke="#4ff3ff" stroke-width="2" fill="none" stroke-linecap="round"/>
<circle cx="39" cy="66" r="2.2" fill="#4ff3ff"/>
<!-- LIVE dot -->
<circle cx="80" cy="16" r="3" fill="#ff2b3d"/>
</svg>`;

/**
 * Vera: hair scraped back under a work cap, glasses, heavy lids, a flat mouth. Cool skin, a
 * hi-vis collar.
 */
const VERA = `<svg ${BOX}>
<rect width="96" height="96" fill="#0a1420"/>
<circle cx="48" cy="52" r="34" fill="#12283a" opacity="0.6"/>
<!-- shoulders and hi-vis collar -->
<path d="M12 96 Q16 72 48 70 Q80 72 84 96 Z" fill="#26313a"/>
<path d="M28 96 Q34 80 48 78 Q62 80 68 96 Z" fill="#a8ff3e" opacity="0.7"/>
<path d="M36 96 Q42 82 48 80 Q54 82 60 96 Z" fill="#26313a"/>
<!-- neck -->
<rect x="41" y="60" width="14" height="14" rx="4" fill="#a3785f"/>
<!-- head: longer, thinner -->
<path d="M32 38 Q32 20 48 20 Q64 20 64 38 L63 54 Q60 68 48 69 Q36 68 33 54 Z" fill="#c4977b"/>
<!-- hair line under the cap -->
<path d="M32 38 Q34 30 48 30 Q62 30 64 38 L62 33 Q56 24 48 24 Q40 24 34 33 Z" fill="#3a2418"/>
<!-- cap -->
<path d="M28 34 Q30 14 48 14 Q66 14 68 34 Z" fill="#1f2a35"/>
<path d="M26 34 h44 v4 h-44 z" fill="#2c3a48"/>
<rect x="42" y="20" width="12" height="7" rx="1.5" fill="#fcee0a" opacity="0.85"/>
<!-- tired eyes: heavy lids -->
<path d="M36 44 h12" stroke="#3a2418" stroke-width="2" stroke-linecap="round"/>
<ellipse cx="42" cy="47" rx="3.4" ry="2.2" fill="#fff"/>
<circle cx="42" cy="47.6" r="1.8" fill="#2a1a12"/>
<path d="M37.5 45.6 h9" stroke="#c4977b" stroke-width="2.4" stroke-linecap="round"/>
<path d="M48 44 h12" stroke="#3a2418" stroke-width="2" stroke-linecap="round"/>
<ellipse cx="54" cy="47" rx="3.4" ry="2.2" fill="#fff"/>
<circle cx="54" cy="47.6" r="1.8" fill="#2a1a12"/>
<path d="M49.5 45.6 h9" stroke="#c4977b" stroke-width="2.4" stroke-linecap="round"/>
<!-- shadows under the eyes -->
<path d="M38 50 q4 2 8 0" stroke="#8c5a4a" stroke-width="1.2" fill="none" opacity="0.7"/>
<path d="M50 50 q4 2 8 0" stroke="#8c5a4a" stroke-width="1.2" fill="none" opacity="0.7"/>
<!-- glasses -->
<rect x="35" y="42.5" width="13" height="9" rx="2" stroke="#d6e8ff" stroke-width="1.6" fill="none"/>
<rect x="49" y="42.5" width="13" height="9" rx="2" stroke="#d6e8ff" stroke-width="1.6" fill="none"/>
<path d="M48 46 h1" stroke="#d6e8ff" stroke-width="1.6"/>
<!-- nose, flat mouth -->
<path d="M48 50 l-2 7 h4" stroke="#8c5a4a" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M41 61 h13" stroke="#6e3a3a" stroke-width="2.2" stroke-linecap="round"/>
<!-- a smear of grease -->
<path d="M56 56 q4 1 5 4" stroke="#1f1a16" stroke-width="2" fill="none" stroke-linecap="round" opacity="0.6"/>
</svg>`;

/**
 * Nico: wild hair, a scarf over the chin, big bright eyes, one earpiece with a wire. Dark skin,
 * a green glow on him from something in his lap.
 */
const NICO = `<svg ${BOX}>
<rect width="96" height="96" fill="#07140f"/>
<circle cx="48" cy="52" r="34" fill="#0f2a1d" opacity="0.6"/>
<!-- shoulders and a padded jacket -->
<path d="M10 96 Q14 70 48 68 Q82 70 86 96 Z" fill="#2a2f27"/>
<path d="M30 96 Q34 80 48 78 Q62 80 66 96 Z" fill="#3b4436"/>
<!-- the case's glow, from below -->
<ellipse cx="48" cy="92" rx="30" ry="10" fill="#a8ff3e" opacity="0.25"/>
<!-- neck -->
<rect x="41" y="58" width="14" height="14" rx="4" fill="#5a3a2a"/>
<!-- head: rounder -->
<path d="M29 42 Q29 20 48 20 Q67 20 67 42 L65 54 Q61 66 48 67 Q35 66 31 54 Z" fill="#7a4d36"/>
<!-- hair: a wild mass -->
<path d="M26 40 Q22 22 36 16 Q44 8 56 12 Q70 14 72 30 Q74 40 66 42 L64 36 Q60 26 48 28 Q36 26 32 38 Z" fill="#120a08"/>
<path d="M22 34 q4 -6 10 -4 M70 26 q6 2 6 10 M40 12 q4 -6 10 -2" stroke="#120a08" stroke-width="4" fill="none" stroke-linecap="round"/>
<!-- big eyes -->
<ellipse cx="41" cy="46" rx="4.2" ry="3.6" fill="#fff"/>
<circle cx="42" cy="46.5" r="2.3" fill="#1b1006"/>
<circle cx="43" cy="45.5" r="0.7" fill="#fff"/>
<ellipse cx="55" cy="46" rx="4.2" ry="3.6" fill="#fff"/>
<circle cx="56" cy="46.5" r="2.3" fill="#1b1006"/>
<circle cx="57" cy="45.5" r="0.7" fill="#fff"/>
<!-- raised brow -->
<path d="M36 40 q5 -4 10 -1" stroke="#120a08" stroke-width="2" fill="none" stroke-linecap="round"/>
<path d="M50 38 q5 -3 10 1" stroke="#120a08" stroke-width="2" fill="none" stroke-linecap="round"/>
<!-- nose -->
<path d="M48 49 l-2 6 h4" stroke="#4a2c1e" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
<!-- scarf over the chin, mouth showing above it -->
<path d="M42 58 Q48 62 54 58" stroke="#3a1e14" stroke-width="2" fill="none" stroke-linecap="round"/>
<path d="M30 60 Q48 74 66 60 L68 72 Q48 84 28 72 Z" fill="#a8ff3e" opacity="0.85"/>
<path d="M30 60 Q48 74 66 60 L66 65 Q48 78 30 65 Z" fill="#7fc72a"/>
<!-- earpiece and wire -->
<circle cx="66" cy="50" r="2.6" fill="#4ff3ff"/>
<path d="M66 52 q2 8 -2 14" stroke="#4ff3ff" stroke-width="1.4" fill="none"/>
</svg>`;

/**
 * El Búho: a hood up, big round amber lenses (the nickname), a week of stubble, one corner of
 * the mouth up. Deep teal behind him, a strip of the viaduct's sodium light along the top.
 */
const BUHO = `<svg ${BOX}>
<rect width="96" height="96" fill="#061410"/>
<circle cx="48" cy="54" r="34" fill="#0c2a24" opacity="0.6"/>
<rect x="0" y="0" width="96" height="6" fill="#f0b34a" opacity="0.35"/>
<!-- shoulders: a big parka -->
<path d="M8 96 Q12 66 48 64 Q84 66 88 96 Z" fill="#3a3f2c"/>
<path d="M30 96 Q34 78 48 76 Q62 78 66 96 Z" fill="#2a2e20"/>
<!-- neck -->
<rect x="41" y="58" width="14" height="14" rx="4" fill="#8a5e42"/>
<!-- hood: a wide, deep shape round the head -->
<path d="M18 62 Q14 20 48 12 Q82 20 78 62 Q70 44 48 40 Q26 44 18 62 Z" fill="#4a5236"/>
<path d="M22 60 Q20 26 48 18 Q76 26 74 60 Q66 46 48 44 Q30 46 22 60 Z" fill="#2c3122"/>
<!-- head -->
<path d="M31 42 Q31 22 48 22 Q65 22 65 42 L63 54 Q60 66 48 67 Q36 66 33 54 Z" fill="#a8785a"/>
<!-- stubble -->
<path d="M36 54 Q48 70 60 54 Q58 64 48 65 Q38 64 36 54 Z" fill="#6b4a36" opacity="0.55"/>
<!-- the lenses -->
<circle cx="41" cy="46" r="7.2" fill="#0b0c08"/>
<circle cx="55" cy="46" r="7.2" fill="#0b0c08"/>
<circle cx="41" cy="46" r="6" fill="#f0b34a" opacity="0.9"/>
<circle cx="55" cy="46" r="6" fill="#f0b34a" opacity="0.9"/>
<circle cx="39" cy="44" r="2" fill="#fff2c8" opacity="0.8"/>
<circle cx="53" cy="44" r="2" fill="#fff2c8" opacity="0.8"/>
<path d="M48 46 h1" stroke="#0b0c08" stroke-width="2"/>
<path d="M34 45 l-3 -1 M62 45 l3 -1" stroke="#0b0c08" stroke-width="1.6" stroke-linecap="round"/>
<!-- nose, and one corner of the mouth up -->
<path d="M48 50 l-2 6 h4" stroke="#6b4a36" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M42 59 Q48 61 56 57" stroke="#3a2418" stroke-width="2" fill="none" stroke-linecap="round"/>
<!-- a small pin on the parka: an owl, if you like -->
<circle cx="70" cy="80" r="3.2" fill="#0b0c08"/>
<circle cx="69" cy="79.4" r="1" fill="#f0b34a"/>
<circle cx="71.2" cy="79.4" r="1" fill="#f0b34a"/>
</svg>`;

/** A stranger: the fallback for a portrait id the HUD does not know. Still a face. */
const UNKNOWN = `<svg ${BOX}>
<rect width="96" height="96" fill="#0d0f16"/>
<path d="M14 96 Q18 72 48 70 Q78 72 82 96 Z" fill="#1f2430"/>
<rect x="41" y="60" width="14" height="14" rx="4" fill="#7c8496"/>
<path d="M31 40 Q31 18 48 18 Q65 18 65 40 L63 54 Q60 66 48 67 Q36 66 33 54 Z" fill="#9aa3b6"/>
<circle cx="42" cy="47" r="2.2" fill="#0d0f16"/>
<circle cx="54" cy="47" r="2.2" fill="#0d0f16"/>
<path d="M42 59 h12" stroke="#0d0f16" stroke-width="2" stroke-linecap="round"/>
</svg>`;

const PORTRAITS: Record<string, string> = { mika: MIKA, vera: VERA, nico: NICO, buho: BUHO };

/** The portrait for a catalogue id, or a stranger for one the HUD has no art for. */
export function portraitFor(id: string): string {
  return PORTRAITS[id] ?? UNKNOWN;
}

/** Which ids have art. For the catalogue test: a passenger without a face is a bug. */
export function hasPortrait(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(PORTRAITS, id);
}
