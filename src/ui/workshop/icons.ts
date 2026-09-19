/**
 * The workshop's carousel icons: one inline SVG per `CategoryDef.icon` / `WorkshopGroupDef.icon`
 * key in `src/content/carParts.ts`, drawn the NFSU2 way — a white car silhouette, the rest of the
 * car ghosted, and the part the category sells lit up at full strength.
 *
 * Strings, built once at module load, so the carousel can inject them without re-creating
 * anything per frame; no external requests (the game runs offline). Every icon is authored in a
 * 120×72 box and paints in `currentColor`: the carousel colours them from CSS (`workshop.css`),
 * white on the dim tiles, hot white with a glow on the centre one. The few coloured dots on the
 * colour categories are the palette's own colours and stay coloured on purpose.
 *
 * Three base views, so each part is shown from the side it is seen from:
 *   - SIDE  — a JDM fastback coupe in profile, nose to the left (bodywork, stance, paint, neon);
 *   - FRONT — head-on (headlights, front camber and track);
 *   - REAR  — from behind (tail lights, rear camber and track, exhaust).
 * A part is drawn over the ghosted view as its own path, so a new category is one entry below.
 */

/* ------------------------------------------------------------------ building blocks */

const OPEN = `<svg class="rb-ws-icon" viewBox="0 0 120 72" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">`;
const CLOSE = `</svg>`;
/** Ghosted: the car the part belongs to. */
const DIM = `fill="currentColor" fill-opacity="0.3"`;
/** Lit: the part itself. */
const LIT = `fill="currentColor"`;
const LIT_STROKE = `fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"`;

/* Side view. Ground at y 60, wheels at x 32 and 92. The windows are holes (evenodd). */
const SIDE_BODY =
  'M5 49 L5 43.5 Q5.5 39.5 11 38.6 L39 35 Q46 31.5 55 24.6 Q59 21.6 66 21.4 L77 21.4 Q86 21.8 96 28.4 L110 31.4 Q115.5 32.4 115.5 36.5 L115.5 49 L104 49 ' +
  'A12 12 0 0 0 80 49 L44 49 A12 12 0 0 0 20 49 Z ' +
  'M46.5 33.6 Q52 29.6 57.6 25 Q60.6 23.8 66.5 23.8 L66.5 33.6 Z M69.5 33.6 L69.5 23.8 L77 23.8 Q84 24.2 91.5 29.6 L93 33.6 Z';
const SIDE_WINDOWS = 'M46.5 33.6 Q52 29.6 57.6 25 Q60.6 23.8 66.5 23.8 L66.5 33.6 Z M69.5 33.6 L69.5 23.8 L77 23.8 Q84 24.2 91.5 29.6 L93 33.6 Z';
const SIDE_ROOF = 'M54 23.6 Q58.6 20.4 66 20.2 L77 20.2 Q86.4 20.6 96.6 27.4 L95 29 Q85.6 23 77 22.8 L66 22.8 Q59.6 23 55.6 25.6 Z';

function wheel(cx: number, cy: number, attrs: string): string {
  // A tyre ring with a hub: outer r9.5, inner r5.2 (hole), hub r2.4.
  return (
    `<path ${attrs} fill-rule="evenodd" d="M${cx - 9.5} ${cy} a9.5 9.5 0 1 0 19 0 a9.5 9.5 0 1 0 -19 0 Z ` +
    `M${cx - 5.2} ${cy} a5.2 5.2 0 1 0 10.4 0 a5.2 5.2 0 1 0 -10.4 0 Z"/>` +
    `<circle cx="${cx}" cy="${cy}" r="2.4" ${attrs}/>`
  );
}

function side(parts: string, opts: { body?: 'dim' | 'lit'; wheels?: 'dim' | 'lit' } = {}): string {
  const body = opts.body === 'lit' ? LIT : DIM;
  const wheels = opts.wheels === 'lit' ? LIT : DIM;
  return (
    OPEN +
    `<path ${body} fill-rule="evenodd" d="${SIDE_BODY}"/>` +
    `<path fill="currentColor" fill-opacity="0.08" d="${SIDE_WINDOWS}"/>` +
    wheel(32, 50, wheels) +
    wheel(92, 50, wheels) +
    parts +
    CLOSE
  );
}

/* Front view. Wheels are the two dark blocks under the sills. */
const FRONT_BODY =
  'M16 52 L16 41 Q17 34 26 32.5 L38 31 L46 17 Q48 14.5 53 14.5 L67 14.5 Q72 14.5 74 17 L82 31 L94 32.5 Q103 34 104 41 L104 52 Z ' +
  'M44.5 30.5 L50 18.5 L70 18.5 L75.5 30.5 Z M49 43 L71 43 L69 48.5 L51 48.5 Z';
const FRONT_HEADS = 'M22 37.5 L40 36.5 L38.5 41.5 L22 42.5 Z M98 37.5 L80 36.5 L81.5 41.5 L98 42.5 Z';
const REAR_BODY =
  'M16 52 L16 41 Q17 34 26 32.5 L38 31 L46 17 Q48 14.5 53 14.5 L67 14.5 Q72 14.5 74 17 L82 31 L94 32.5 Q103 34 104 41 L104 52 Z ' +
  'M46 30 L51 19 L69 19 L74 30 Z M50 44 L70 44 L70 49.5 L50 49.5 Z';
const REAR_TAILS = 'M19 37 L42 36.5 L42 40.5 L19 41.5 Z M101 37 L78 36.5 L78 40.5 L101 41.5 Z';

function tyre(x: number, attrs: string, tilt = 0): string {
  // A tyre seen head-on: a rounded block, optionally leaned about its contact patch.
  const t = tilt !== 0 ? ` transform="rotate(${tilt} ${x + 6} 62)"` : '';
  return `<rect x="${x}" y="46" width="12" height="16" rx="3" ${attrs}${t}/>`;
}

function front(parts: string, opts: { tyres?: 'dim' | 'lit'; tilt?: number; heads?: 'dim' | 'lit' } = {}): string {
  const tyres = opts.tyres === 'lit' ? LIT : DIM;
  const tilt = opts.tilt ?? 0;
  return (
    OPEN +
    tyre(18, tyres, tilt) +
    tyre(90, tyres, -tilt) +
    `<path ${DIM} fill-rule="evenodd" d="${FRONT_BODY}"/>` +
    `<path ${opts.heads === 'lit' ? LIT : `fill="currentColor" fill-opacity="0.5"`} d="${FRONT_HEADS}"/>` +
    parts +
    CLOSE
  );
}

function rear(parts: string, opts: { tyres?: 'dim' | 'lit'; tilt?: number; tails?: 'dim' | 'lit' } = {}): string {
  const tyres = opts.tyres === 'lit' ? LIT : DIM;
  const tilt = opts.tilt ?? 0;
  return (
    OPEN +
    tyre(18, tyres, tilt) +
    tyre(90, tyres, -tilt) +
    `<path ${DIM} fill-rule="evenodd" d="${REAR_BODY}"/>` +
    // The wing seen from behind: what tells a rear view from a front one at a glance.
    `<path fill="currentColor" fill-opacity="0.55" d="M14 22 L106 22 L106 26 L14 26 Z M34 26 L38 26 L38 31 L34 31 Z M82 26 L86 26 L86 31 L82 31 Z"/>` +
    `<path ${opts.tails === 'lit' ? LIT : `fill="currentColor" fill-opacity="0.5"`} d="${REAR_TAILS}"/>` +
    parts +
    CLOSE
  );
}

/** A rim face: tyre ring, rim lip, `spokes` spokes and a centre cap, centred on (cx, cy). */
function rimFace(cx: number, cy: number, r: number, spokes: number, attrs = LIT): string {
  let spokePaths = '';
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2 - Math.PI / 2;
    const w = 0.2;
    const r0 = r * 0.2;
    const r1 = r * 0.7;
    const p = (ang: number, rad: number): string => `${(cx + Math.cos(ang) * rad).toFixed(2)} ${(cy + Math.sin(ang) * rad).toFixed(2)}`;
    spokePaths += `M${p(a - w, r0)} L${p(a - w * 0.45, r1)} L${p(a + w * 0.45, r1)} L${p(a + w, r0)} Z `;
  }
  return (
    // tyre
    `<path ${attrs} fill-opacity="0.35" fill-rule="evenodd" d="M${cx - r} ${cy} a${r} ${r} 0 1 0 ${2 * r} 0 a${r} ${r} 0 1 0 ${-2 * r} 0 Z ` +
    `M${cx - r * 0.78} ${cy} a${r * 0.78} ${r * 0.78} 0 1 0 ${r * 1.56} 0 a${r * 0.78} ${r * 0.78} 0 1 0 ${-r * 1.56} 0 Z"/>` +
    // lip
    `<path ${attrs} fill-rule="evenodd" d="M${cx - r * 0.78} ${cy} a${r * 0.78} ${r * 0.78} 0 1 0 ${r * 1.56} 0 a${r * 0.78} ${r * 0.78} 0 1 0 ${-r * 1.56} 0 Z ` +
    `M${cx - r * 0.68} ${cy} a${r * 0.68} ${r * 0.68} 0 1 0 ${r * 1.36} 0 a${r * 0.68} ${r * 0.68} 0 1 0 ${-r * 1.36} 0 Z"/>` +
    `<path ${attrs} d="${spokePaths}"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${(r * 0.2).toFixed(2)}" ${attrs}/>` +
    `<circle cx="${cx}" cy="${cy}" r="${(r * 0.08).toFixed(2)}" fill="#000" fill-opacity="0.5"/>`
  );
}

/** Palette dots, NFSU2's paint-shop cluster, in the game's own colours. */
function paletteDots(x: number, y: number, s = 1): string {
  const dots: Array<[number, number, string]> = [
    [0, 0, '#ff3df0'],
    [9, -5, '#4ff3ff'],
    [9, 6, '#9b5cff'],
    [0, 11, '#ff2b3d'],
    [18, 1, '#ffffff'],
    [-9, 5, '#fcee0a'],
  ];
  return dots
    .map(([dx, dy, c]) => `<circle cx="${(x + dx * s).toFixed(1)}" cy="${(y + dy * s).toFixed(1)}" r="${(4 * s).toFixed(1)}" fill="${c}" stroke="#0a0a12" stroke-opacity="0.6" stroke-width="1"/>`)
    .join('');
}

/** A double-headed arrow from (x1,y1) to (x2,y2), for the stance and size icons. */
function doubleArrow(x1: number, y1: number, x2: number, y2: number, w = 2.6): string {
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const head = (x: number, y: number, a: number): string => {
    const l = 5.5;
    const s = 0.55;
    const p1 = `${(x - Math.cos(a - s) * l).toFixed(2)} ${(y - Math.sin(a - s) * l).toFixed(2)}`;
    const p2 = `${(x - Math.cos(a + s) * l).toFixed(2)} ${(y - Math.sin(a + s) * l).toFixed(2)}`;
    return `M${p1} L${x} ${y} L${p2}`;
  };
  return (
    `<path ${LIT_STROKE} stroke-width="${w}" d="M${x1} ${y1} L${x2} ${y2} ${head(x2, y2, ang)} ${head(x1, y1, ang + Math.PI)}"/>`
  );
}

/** Light rays fanning out of (x, y) towards `dir` radians. */
function rays(x: number, y: number, dir: number, n = 3, len = 12, spread = 0.5): string {
  let d = '';
  for (let i = 0; i < n; i++) {
    const a = dir + (n === 1 ? 0 : (i / (n - 1) - 0.5) * spread * 2);
    const x0 = x + Math.cos(a) * 3;
    const y0 = y + Math.sin(a) * 3;
    const x1 = x + Math.cos(a) * (3 + len);
    const y1 = y + Math.sin(a) * (3 + len);
    d += `M${x0.toFixed(1)} ${y0.toFixed(1)} L${x1.toFixed(1)} ${y1.toFixed(1)} `;
  }
  return `<path ${LIT_STROKE} stroke-width="2.4" d="${d}"/>`;
}

/* ------------------------------------------------------------------ the parts */

const P = {
  frontBumper: `<path ${LIT} d="M5 49 L5 43.5 Q5.5 39.5 11 38.6 L21 37.3 L21 42 Q20 45 19.8 49 Z M2 50.2 L22 50.2 L21 53.4 L4 53.4 Z"/>`,
  rearBumper: `<path ${LIT} d="M104.3 49 Q104 43 103 38.6 L115.5 37.6 L115.5 49 Z M103 50.2 L118 50.2 L117 53.4 L104 53.4 Z"/>`,
  skirts: `<path ${LIT} d="M43.6 44.6 L80.4 44.6 L80.4 52 L44.4 52 Q43.6 48.4 43.6 44.6 Z"/>`,
  hood: `<path ${LIT} d="M11.5 38.4 L39 34.9 Q41.5 33.6 43.4 32.5 L45 35.4 L13.5 39.6 Z M23 36.6 L33 35.4 L32 33.2 L24.6 34.2 Z"/>`,
  trunk: `<path ${LIT} d="M94 27.6 L110 31.2 Q114.6 32.2 115.2 34.6 L101 34.2 L92 30.4 Z"/>`,
  spoiler: `<path ${LIT} d="M94 14 L118 15 L118 18.6 L94 17.8 Z M100.6 18 L103 18 L104 30.6 L101.6 30.2 Z M110.6 18.4 L113 18.4 L113 31.6 L110.6 31.2 Z M115.4 11 L119 11 L119 21.6 L115.4 21.6 Z"/>`,
    roof: `<path ${LIT} d="${SIDE_ROOF}"/>`,
  vinyl: `<path ${LIT} d="M20 44 L40 38 L38 41.6 L62 36 L58 40 L84 34.6 L81 38.4 L106 35 L101 40.6 L78 43 L81 39.6 L56 45.6 L60 41.4 L36 47 L38 43.4 Z"/>`,
  decal:
    `<path ${LIT} d="M58 34.5 L72 34.5 L76 38.5 L76 48 L58 48 Z"/>` +
    `<path fill="#0a0a12" fill-opacity="0.75" d="M65 36.4 L61 42 L64.4 42 L63.2 46.4 L69 40 L65.8 40 L67.6 36.4 Z"/>` +
    `<path fill="currentColor" fill-opacity="0.55" d="M72 34.5 L76 38.5 L72 38.5 Z"/>`,
  neon:
    `<path ${LIT} d="M24 53.5 L100 53.5 L100 55.5 L24 55.5 Z"/>` +
    `<path fill="currentColor" fill-opacity="0.55" d="M16 58 L108 58 L108 60 L16 60 Z"/>` +
    `<path fill="currentColor" fill-opacity="0.25" d="M8 62.5 L116 62.5 L116 64.5 L8 64.5 Z"/>`,
  interior: `<path ${LIT} d="${SIDE_WINDOWS}"/>` + `<circle cx="70" cy="26" r="9" fill="currentColor" fill-opacity="0.18"/>`,
    shine:
    `<path fill="#0a0a12" fill-opacity="0.35" d="M24 49 L44 34 L51 34 L31 49 Z M37 49 L57 34 L60 34 L40 49 Z"/>` +
    `<path ${LIT} d="M104 6 L106 12 L112 14 L106 16 L104 22 L102 16 L96 14 L102 12 Z"/>`,
};

/* A close-up exhaust tip in perspective, like NFSU2's muffler icon. */
const EXHAUST_TIP =
  `<path fill="currentColor" fill-opacity="0.3" d="M12 30 L64 22 L64 50 L12 44 Z"/>` +
  `<path fill-rule="evenodd" ${LIT} d="M58 36 a18 18 0 1 0 36 0 a18 18 0 1 0 -36 0 Z M64 36 a12 12 0 1 0 24 0 a12 12 0 1 0 -24 0 Z"/>` +
  `<ellipse cx="76" cy="36" rx="9" ry="9" fill="currentColor" fill-opacity="0.18"/>`;

const PLATE =
  `<rect x="14" y="16" width="92" height="42" rx="5" ${LIT}/>` +
  `<rect x="14" y="16" width="92" height="11" rx="5" fill="#1f4fff"/>` +
  `<rect x="14" y="22" width="92" height="5" fill="#1f4fff"/>` +
  `<text x="60" y="51" text-anchor="middle" textLength="78" lengthAdjust="spacingAndGlyphs" font-family="Bahnschrift, 'DIN Alternate', 'Arial Narrow', sans-serif" font-weight="700" font-size="21" fill="#0a0a12">AB 123 CD</text>`;

/* The camber angle: a plumb line beside each leaned tyre and the arc between them. */
const CAMBER_MARKS =
  `<path fill="none" stroke="currentColor" stroke-opacity="0.6" stroke-width="1.6" stroke-dasharray="2.5 2.5" d="M13 40 L13 66 M107 40 L107 66"/>` +
  `<path ${LIT_STROKE} stroke-width="2" d="M13 47 Q17 46.4 20 48.6 M107 47 Q103 46.4 100 48.6"/>`;

/* ------------------------------------------------------------------ the icons */

const ICONS: Record<string, string> = {
  // Groups.
  body: side('', { body: 'lit' }),
  wheels: OPEN + rimFace(60, 36, 33, 5) + CLOSE,
  paint: side(paletteDots(16, 14, 0.95)).replace(`<path ${DIM} fill-rule="evenodd"`, `<path ${LIT} fill-rule="evenodd"`),
  lights: front(rays(19, 40, Math.PI * 1.02, 3, 13, 0.32) + rays(101, 40, -Math.PI * 0.02, 3, 13, 0.32), { heads: 'lit' }),
  exhaust: OPEN + EXHAUST_TIP + CLOSE,
  plate: OPEN + PLATE + CLOSE,

  // Carrocería.
  frontBumper: side(P.frontBumper),
  rearBumper: side(P.rearBumper),
  skirts: side(P.skirts),
  hood: side(P.hood),
  trunk: side(P.trunk),
  spoiler: side(P.spoiler),

  // Llantas y stance.
  rims: OPEN + rimFace(60, 36, 33, 5) + CLOSE,
  rimColor: OPEN + rimFace(66, 36, 28, 6) + paletteDots(16, 22, 0.9) + CLOSE,
  wheelSize: OPEN + rimFace(60, 36, 30, 5, `fill="currentColor" fill-opacity="0.45"`) + doubleArrow(40, 56, 80, 16, 3.2) + CLOSE,
  wheelWidth:
    OPEN +
    `<rect x="44" y="10" width="32" height="52" rx="6" ${LIT}/>` +
    `<path fill="#0a0a12" fill-opacity="0.45" d="M48 16 L72 16 L72 19 L48 19 Z M48 25 L72 25 L72 28 L48 28 Z M48 34 L72 34 L72 37 L48 37 Z M48 43 L72 43 L72 46 L48 46 Z M48 52 L72 52 L72 55 L48 55 Z"/>` +
    doubleArrow(12, 36, 38, 36) +
    doubleArrow(82, 36, 108, 36) +
    CLOSE,
  rideHeight: side(doubleArrow(62, 38, 62, 64, 3)),
  camberFront: front(CAMBER_MARKS, { tyres: 'lit', tilt: 13 }),
  camberRear: rear(CAMBER_MARKS, { tyres: 'lit', tilt: 13 }),
  trackFront: front(doubleArrow(2, 66, 16, 66, 2.4) + doubleArrow(104, 66, 118, 66, 2.4), { tyres: 'lit' }),
  trackRear: rear(doubleArrow(2, 66, 16, 66, 2.4) + doubleArrow(104, 66, 118, 66, 2.4), { tyres: 'lit' }),

  // Pintura.
  roofColor: side(P.roof + paletteDots(16, 14, 0.95)),
  finish: side(P.shine).replace(`<path ${DIM} fill-rule="evenodd"`, `<path ${LIT} fill-rule="evenodd"`),
  vinyls: side(P.vinyl),
  decals: side(P.decal),

  // Luces.
  headlights: front(rays(19, 40, Math.PI * 1.02, 3, 13, 0.32) + rays(101, 40, -Math.PI * 0.02, 3, 13, 0.32), { heads: 'lit' }),
  headlightColor: front(paletteDots(58, 58, 0.8), { heads: 'lit' }),
  taillights: rear(rays(20, 39, Math.PI, 3, 10, 0.35) + rays(100, 39, 0, 3, 10, 0.35), { tails: 'lit' }),
  neon: side(P.neon),
  interiorLight: side(P.interior),

  // Escape.
  exhaustTips: OPEN + EXHAUST_TIP + CLOSE,
  exhaustSound:
    OPEN +
    `<g transform="translate(-10 0)">${EXHAUST_TIP}</g>` +
    `<path ${LIT_STROKE} stroke-width="3" d="M92 22 Q100 36 92 50 M101 16 Q112 36 101 56 M110 10 Q124 36 110 62"/>` +
    CLOSE,
};
// `paint` is both the group's key and the base-colour category's key (`carParts.ts`): one drawing,
// the whole car lit with the palette beside it, serves both.

/** A generic spanner, for any key without its own drawing (a category added before its icon). */
const FALLBACK =
  OPEN +
  `<path ${LIT} d="M30 54 L66 26 A12 12 0 0 1 84 12 L76 22 L82 30 L92 22 A12 12 0 0 1 76 40 L40 64 Z"/>` +
  CLOSE;

/** The SVG for an icon key. Never throws: an unknown key draws a spanner. */
export function workshopIcon(key: string): string {
  return ICONS[key] ?? FALLBACK;
}

/** Whether a key has its own drawing. `tests/workshopUi.test.ts` checks the whole catalogue. */
export function hasWorkshopIcon(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(ICONS, key);
}

/* ------------------------------------------------------------------ chrome glyphs */

/** Chevron pointing right; rotate it in CSS for the other three directions. */
export const CHEVRON = `<svg class="rb-ws-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 3.5 19 12 8 20.5 8 15.2 12.4 12 8 8.8Z" fill="currentColor"/></svg>`;

/** The visual rating's star. */
export const STAR = `<svg class="rb-ws-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 1.8 14.9 8.6 22.2 9.2 16.6 14 18.3 21.2 12 17.4 5.7 21.2 7.4 14 1.8 9.2 9.1 8.6Z" fill="currentColor"/></svg>`;

/** A plus, for "add a layer". */
export const PLUS = `<svg class="rb-ws-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M10.5 4h3v6.5H20v3h-6.5V20h-3v-6.5H4v-3h6.5Z" fill="currentColor"/></svg>`;

/** A cross, for "remove a layer". */
export const CROSS = `<svg class="rb-ws-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6.3 4.2 12 9.9l5.7-5.7 2.1 2.1L14.1 12l5.7 5.7-2.1 2.1L12 14.1l-5.7 5.7-2.1-2.1L9.9 12 4.2 6.3Z" fill="currentColor"/></svg>`;
