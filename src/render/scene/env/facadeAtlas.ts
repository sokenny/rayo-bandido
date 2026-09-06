import * as THREE from 'three';
import { PAL } from './palette';
import { makeRng } from './meshBuilder';
import type { WindowActivity } from './windowActivity';
import { WINDOW_ACTIVITY_CACHE_KEY } from './windowActivity';

/**
 * The facade atlas: every window pattern in the city on one texture, one material.
 *
 * Before this, each zone had its own 256 px window tile and its own material, and every wall
 * in the zone repeated that one tile: the same lit fraction, the same grid, the same colour
 * on every building, which is what made the city read as one box stamped over and over.
 *
 * Now the texture is a 4 x 4 atlas of facade STYLES (ribbon windows, vertical strips, lit
 * clusters, dark service bands, sparse groups, lit corners, inset panels, near-dark, ...).
 * Every wall quad carries `aFacadeCell`: which cell it samples, plus how bright the concrete
 * between its windows is. The shader tiles the wall's UVs inside that one cell (`fract`), so
 * a 60 m wall still repeats its 12 m tile without ever reading a neighbouring style, and it
 * samples with explicit derivatives so the wrap leaves no mip seam.
 *
 * Colour is not in the atlas at all. Panes are drawn white with baked per-pane brightness
 * and a hint of warm/cool spread, and each building tints its glass through the vertex
 * colour, chosen from the zone's palette of window lights. So one texture and one material
 * give every combination of pattern x colour x wall brightness, and the whole city's facades
 * are still a single draw call.
 *
 * `windowActivity` (the life behind the panes) is layered on the same material; it reads the
 * tiled UV, not the atlas UV, so its per-window ids keep working unchanged.
 */

/** Metres covered by one atlas cell on a wall, horizontally and vertically. */
export const FACADE_TILE = 12;
/** Window grid inside a cell: 1.5 m wide panes, 3 m floors. `windowActivity` must use the same. */
export const FACADE_GRID = { cols: 8, rows: 4 };
/** Storey height (m), so band edges and roofs can land between floors. */
export const FLOOR = FACADE_TILE / FACADE_GRID.rows;

const ATLAS_COLS = 4;
const ATLAS_ROWS = 4;
const CELL_PX = 256;
/** Size of a cell in UV space. */
export const FACADE_CELL_UV = 1 / ATLAS_COLS;

export type FacadeStyle =
  | 'grid'
  | 'ribbon'
  | 'strips'
  | 'cluster'
  | 'service'
  | 'sparse'
  | 'corner'
  | 'inset'
  | 'dark'
  | 'curtain'
  | 'louvre'
  | 'mixed'
  | 'stripe'
  | 'stack'
  | 'deck'
  | 'panels';

/** Cell index of each style in the atlas, row-major from the top left. */
export const FACADE_STYLES: readonly FacadeStyle[] = [
  'grid',
  'ribbon',
  'strips',
  'cluster',
  'service',
  'sparse',
  'corner',
  'inset',
  'dark',
  'curtain',
  'louvre',
  'mixed',
  'stripe',
  'stack',
  'deck',
  'panels',
];

/** UV origin of a style's cell. Canvas rows grow downward, texture v grows upward. */
export function facadeCell(style: FacadeStyle): { u0: number; v0: number } {
  const i = FACADE_STYLES.indexOf(style);
  const col = i % ATLAS_COLS;
  const row = Math.floor(i / ATLAS_COLS);
  return { u0: col / ATLAS_COLS, v0: 1 - (row + 1) / ATLAS_ROWS };
}

/* ------------------------------------------------------------------ drawing */

function hex(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`;
}

/** A lit pane: white, at `bright`, nudged warm or cool so a tinted wall is never flat. */
function paneColor(bright: number, warmth: number): string {
  const r = Math.round(255 * Math.min(1, bright * (1 + 0.06 * warmth)));
  const g = Math.round(255 * Math.min(1, bright));
  const b = Math.round(255 * Math.min(1, bright * (1 - 0.08 * warmth)));
  return `rgb(${r},${g},${b})`;
}

interface Cell {
  ctx: CanvasRenderingContext2D;
  x: number;
  y: number;
  rng: () => number;
}

const COL_W = CELL_PX / FACADE_GRID.cols;
const ROW_H = CELL_PX / FACADE_GRID.rows;
/** Pane inside its grid cell: a margin of concrete on every side. */
const PANE_W = COL_W * 0.56;
const PANE_H = ROW_H * 0.4;
/** Where the lit strips and corners fall, so the styles follow the grid rather than a number. */
const COLS = FACADE_GRID.cols;
const LAST = COLS - 1;
const STRIP_A = Math.round(COLS * 0.25);
const STRIP_B = Math.round(COLS * 0.7);
/** Lit panes are never pure white: the building's tint has to survive the emissive gain. */
const LIT: [number, number] = [0.42, 0.8];
const LIT_SOFT: [number, number] = [0.35, 0.65];
const PANE_X = (COL_W - PANE_W) / 2;
const PANE_Y = ROW_H * 0.3;

/** Concrete with the floor slabs and pilasters that give a flat wall some read at distance. */
function concrete(c: Cell, slabs = true, pilasters = true): void {
  const { ctx, x, y } = c;
  ctx.fillStyle = hex(PAL.facadeUrban);
  ctx.fillRect(x, y, CELL_PX, CELL_PX);
  if (slabs) {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    for (let r = 0; r < FACADE_GRID.rows; r++) ctx.fillRect(x, y + r * ROW_H, CELL_PX, ROW_H * 0.14);
  }
  if (pilasters) {
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    for (let k = 0; k < COLS; k++) ctx.fillRect(x + k * COL_W, y, COL_W * 0.1, CELL_PX);
  }
}

/** Dark glass: the pane is there, nobody is in. */
function darkPane(c: Cell, col: number, row: number, w = PANE_W, px = PANE_X): void {
  c.ctx.fillStyle = hex(PAL.winOff);
  c.ctx.fillRect(c.x + col * COL_W + px, c.y + row * ROW_H + PANE_Y, w, PANE_H);
}

/** A lit pane with a soft halo bled around it, so neighbours smear together at distance. */
function litPane(c: Cell, col: number, row: number, bright: number, w = PANE_W, px = PANE_X): void {
  const { ctx, rng } = c;
  const x = c.x + col * COL_W + px;
  const y = c.y + row * ROW_H + PANE_Y;
  const warmth = rng() * 2 - 1;
  const cx = x + w / 2;
  const cy = y + PANE_H / 2;
  const rad = Math.max(w, PANE_H) * 1.4;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
  g.addColorStop(0, paneColor(bright, warmth));
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = g;
  ctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
  ctx.globalAlpha = 1;
  ctx.fillStyle = paneColor(bright, warmth);
  ctx.fillRect(x, y, w, PANE_H);
}

/** Every pane of the grid, lit with probability `p` (per row when `rows` is given). */
function panes(c: Cell, p: number | ((col: number, row: number) => number), bright: [number, number] = LIT): void {
  for (let r = 0; r < FACADE_GRID.rows; r++) {
    for (let k = 0; k < COLS; k++) {
      const chance = typeof p === 'number' ? p : p(k, r);
      if (c.rng() < chance) litPane(c, k, r, bright[0] + c.rng() * (bright[1] - bright[0]));
      else darkPane(c, k, r);
    }
  }
}

/** A continuous lit ribbon across the whole row, its brightness varying pane to pane. */
function ribbonRow(c: Cell, row: number, bright: [number, number]): void {
  for (let k = 0; k < COLS; k++) litPane(c, k, row, bright[0] + c.rng() * (bright[1] - bright[0]), COL_W * 0.96, COL_W * 0.02);
}

/** A continuous dark ribbon across the row. */
function darkRow(c: Cell, row: number): void {
  for (let k = 0; k < COLS; k++) darkPane(c, k, row, COL_W * 0.96, COL_W * 0.02);
}

/** A lit strip the full height of a column. */
function litColumn(c: Cell, col: number, bright: [number, number], w = PANE_W * 0.7): void {
  const { ctx, rng } = c;
  const x = c.x + col * COL_W + (COL_W - w) / 2;
  for (let r = 0; r < FACADE_GRID.rows; r++) {
    const b = bright[0] + rng() * (bright[1] - bright[0]);
    ctx.fillStyle = paneColor(b, 0);
    ctx.fillRect(x, c.y + r * ROW_H, w, ROW_H);
  }
  const g = ctx.createLinearGradient(x - w, 0, x + w * 2, 0);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.16)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(x - w, c.y, w * 3, CELL_PX);
}

/** Horizontal fins: a louvred service floor, no glass at all. */
function louvres(c: Cell, rows: number[]): void {
  c.ctx.fillStyle = 'rgba(255,255,255,0.05)';
  for (const r of rows) {
    for (let i = 0; i < 4; i++) c.ctx.fillRect(c.x, c.y + r * ROW_H + ROW_H * (0.22 + i * 0.18), CELL_PX, ROW_H * 0.06);
  }
}

/**
 * Draw the whole atlas. Sixteen styles, in the order of `FACADE_STYLES`. Each cell is 12 m
 * square on a wall: eight 1.5 m panes across, four 3 m floors up. The cell borders are always
 * concrete or the dark slab line, so the mip chain can bleed into a neighbour unnoticed.
 */
export function makeFacadeAtlas(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = CELL_PX * ATLAS_COLS;
  cv.height = CELL_PX * ATLAS_ROWS;
  const ctx = cv.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');

  const cellOf = (style: FacadeStyle): Cell => {
    const i = FACADE_STYLES.indexOf(style);
    return { ctx, x: (i % ATLAS_COLS) * CELL_PX, y: Math.floor(i / ATLAS_COLS) * CELL_PX, rng: makeRng(1000 + i * 77) };
  };

  // 0 grid: the classic, but uneven: one floor in four is mostly out.
  {
    const c = cellOf('grid');
    concrete(c);
    panes(c, (_, r) => (r === 2 ? 0.1 : 0.38));
  }
  // 1 ribbon: continuous horizontal bands, two lit, two dark glass.
  {
    const c = cellOf('ribbon');
    concrete(c, true, false);
    ribbonRow(c, 0, LIT_SOFT);
    darkRow(c, 1);
    ribbonRow(c, 2, LIT);
    darkRow(c, 3);
  }
  // 2 strips: two lit vertical strips, the rest blank concrete.
  {
    const c = cellOf('strips');
    concrete(c, false, true);
    for (let r = 0; r < 4; r++) for (let k = 0; k < COLS; k++) if (k !== STRIP_A && k !== STRIP_B) (c.rng() < 0.1 ? litPane(c, k, r, LIT_SOFT[0] + c.rng() * 0.25) : darkPane(c, k, r));
    litColumn(c, STRIP_A, LIT_SOFT);
    litColumn(c, STRIP_B, LIT_SOFT);
  }
  // 3 cluster: two floors nearly full, two floors nearly out.
  {
    const c = cellOf('cluster');
    concrete(c);
    panes(c, (_, r) => (r === 1 || r === 2 ? 0.82 : 0.06));
  }
  // 4 service: half the height is a blank louvred band, the rest sparse.
  {
    const c = cellOf('service');
    concrete(c, true, false);
    louvres(c, [0, 1]);
    for (let r = 2; r < 4; r++) for (let k = 0; k < COLS; k++) (c.rng() < 0.22 ? litPane(c, k, r, LIT[0] + c.rng() * (LIT[1] - LIT[0])) : darkPane(c, k, r));
  }
  // 5 sparse: a few lit panes, in twos and threes.
  {
    const c = cellOf('sparse');
    concrete(c);
    for (let r = 0; r < 4; r++) {
      let run = 0;
      for (let k = 0; k < COLS; k++) {
        if (run > 0) {
          run--;
          litPane(c, k, r, LIT_SOFT[0] + c.rng() * (LIT_SOFT[1] - LIT_SOFT[0]));
        } else if (c.rng() < 0.08) {
          run = 1 + Math.floor(c.rng() * 2);
          litPane(c, k, r, LIT[0] + c.rng() * (LIT[1] - LIT[0]));
        } else darkPane(c, k, r);
      }
    }
  }
  // 6 corner: both outer columns lit their full height, the middle mostly dark.
  {
    const c = cellOf('corner');
    concrete(c, true, false);
    for (let r = 0; r < 4; r++) for (let k = 1; k < LAST; k++) (c.rng() < 0.14 ? litPane(c, k, r, LIT_SOFT[0] + c.rng() * 0.3) : darkPane(c, k, r));
    litColumn(c, 0, [0.45, 0.75], PANE_W * 0.8);
    litColumn(c, LAST, [0.45, 0.75], PANE_W * 0.8);
  }
  // 7 inset: one big recessed glass panel with a thin lit frame, two lit panes at its foot.
  {
    const c = cellOf('inset');
    concrete(c, false, false);
    const { x, y } = c;
    const px0 = x + CELL_PX * 0.12;
    const pw = CELL_PX * 0.76;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(px0, y + ROW_H * 0.35, pw, ROW_H * 3.3);
    ctx.fillStyle = hex(PAL.winOff);
    ctx.fillRect(px0 + CELL_PX * 0.025, y + ROW_H * 0.5, pw - CELL_PX * 0.05, ROW_H * 3);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillRect(px0, y + ROW_H * 0.35, pw, 3);
    ctx.fillRect(px0, y + ROW_H * 0.35, 3, ROW_H * 3.3);
    ctx.fillRect(px0 + pw - 3, y + ROW_H * 0.35, 3, ROW_H * 3.3);
    for (let r = 0; r < 3; r++) for (let k = 1; k < LAST; k++) if (c.rng() < 0.12) litPane(c, k, r, LIT_SOFT[0] + c.rng() * 0.25, PANE_W * 0.8);
    for (let k = 1; k < LAST; k++) if (c.rng() < 0.45) litPane(c, k, 3, LIT_SOFT[0] + c.rng() * 0.3);
  }
  // 8 dark: an unlit building. Slabs only; one pane in thirty.
  {
    const c = cellOf('dark');
    concrete(c);
    panes(c, 0.03, [0.3, 0.5]);
  }
  // 9 curtain: dense office glass, cool and even, thin mullions.
  {
    const c = cellOf('curtain');
    concrete(c, true, true);
    panes(c, 0.6, [0.4, 0.65]);
  }
  // 10 louvre: no glass, horizontal fins the whole height: podiums, plant floors, car parks.
  {
    const c = cellOf('louvre');
    concrete(c, true, false);
    louvres(c, [0, 1, 2, 3]);
  }
  // 11 mixed: residential, uneven, roughly half lit at every brightness.
  {
    const c = cellOf('mixed');
    concrete(c);
    panes(c, 0.45, [0.3, 0.8]);
  }
  // 12 stripe: one lit floor band through the middle, dark above and below: lobbies, sky lounges.
  {
    const c = cellOf('stripe');
    concrete(c, true, false);
    darkRow(c, 0);
    ribbonRow(c, 1, [0.55, 0.85]);
    ribbonRow(c, 2, [0.55, 0.85]);
    darkRow(c, 3);
  }
  // 13 stack: three lit strips, close: the vertical light lines of the reference towers.
  {
    const c = cellOf('stack');
    concrete(c, false, false);
    for (let r = 0; r < 4; r++) for (let k = 0; k < COLS; k += 2) if (c.rng() < 0.12) litPane(c, k, r, LIT_SOFT[0] + c.rng() * 0.2, PANE_W * 0.7);
    for (let k = 1; k < COLS; k += 2) litColumn(c, k, [0.38, 0.66], PANE_W * 0.4);
  }
  // 14 deck: balconies (a light slab line on every floor) with sparse warm rooms behind.
  {
    const c = cellOf('deck');
    concrete(c, false, false);
    ctx.fillStyle = 'rgba(255,255,255,0.09)';
    for (let r = 0; r < 4; r++) ctx.fillRect(c.x, c.y + r * ROW_H + ROW_H * 0.86, CELL_PX, ROW_H * 0.12);
    panes(c, 0.28, [0.35, 0.75]);
  }
  // 15 panels: two big lit panels per floor pair, like shop lots or studio windows.
  {
    const c = cellOf('panels');
    concrete(c, true, false);
    const half = COLS / 2;
    for (let r = 0; r < 4; r++) {
      for (const k of [0, half]) {
        if (c.rng() < 0.4) litPane(c, k, r, LIT_SOFT[0] + c.rng() * 0.3, COL_W * (half - 0.6), COL_W * 0.3);
        else darkPane(c, k, r, COL_W * (half - 0.6), COL_W * 0.3);
      }
    }
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  // The shader wraps inside a cell itself; the texture must never wrap across cells.
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/* ------------------------------------------------------------------ material */

export const FACADE_CACHE_KEY = `${WINDOW_ACTIVITY_CACHE_KEY}-atlas-v1`;

const VERTEX_PARS = `
attribute vec3 aFacadeCell;
varying vec3 vFacadeCell;
`;

const VERTEX_BODY = `
  vFacadeCell = aFacadeCell;
`;

const FRAGMENT_PARS = `
varying vec3 vFacadeCell;
`;

/**
 * Tile the wall's UV inside its atlas cell. Derivatives come from the untiled UV so the mip
 * level is continuous across the wrap; `fract` alone would put a seam every tile.
 */
const MAP_FRAGMENT = `
#ifdef USE_MAP
  vec2 rbTileUv = vMapUv;
  vec2 rbAtlasUv = vFacadeCell.xy + fract(rbTileUv) * ${FACADE_CELL_UV.toFixed(4)};
  // Gradients from the untiled UV, so the mip level is continuous across the wrap; fract()
  // alone would leave a seam every tile.
  vec2 rbAtlasDx = dFdx(rbTileUv) * ${FACADE_CELL_UV.toFixed(4)};
  vec2 rbAtlasDy = dFdy(rbTileUv) * ${FACADE_CELL_UV.toFixed(4)};
  vec4 sampledDiffuseColor = texture2DGradEXT( map, rbAtlasUv, rbAtlasDx, rbAtlasDy );
  // Lit glass is the only bright thing in the atlas. Its diffuse takes the building's tint
  // and drops, so the emissive carries the colour; the concrete takes the wall brightness.
  float rbGlass = smoothstep(0.08, 0.3, max(sampledDiffuseColor.r, max(sampledDiffuseColor.g, sampledDiffuseColor.b)));
  sampledDiffuseColor.rgb *= mix(vec3(vFacadeCell.z), vColor * 0.3, rbGlass);
  diffuseColor *= sampledDiffuseColor;
#endif
`;

const EMISSIVE_FRAGMENT = `
#ifdef USE_EMISSIVEMAP
  vec4 emissiveColor = texture2DGradEXT( emissiveMap, rbAtlasUv, rbAtlasDx, rbAtlasDy );
  totalEmissiveRadiance *= emissiveColor.rgb * vColor;
#endif
`;

/**
 * The one facade material: the atlas as map and emissive map, the window activity on top,
 * and the atlas patch that makes `aFacadeCell` and the vertex colour do the rest.
 */
export function createFacadeMaterial(atlas: THREE.Texture, windows: WindowActivity, intensity: number, seed = 2.7): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    map: atlas,
    emissive: 0xffffff,
    emissiveMap: atlas,
    emissiveIntensity: intensity,
    roughness: 0.82,
    metalness: 0.08,
    vertexColors: true,
  });
  windows.apply(material, FACADE_GRID.cols, FACADE_GRID.rows, seed);
  const inner = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    inner(shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERTEX_BODY}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
      .replace('#include <map_fragment>', MAP_FRAGMENT)
      // The vertex colour is the glass tint, not a diffuse multiplier: the stock chunk is dropped.
      .replace('#include <color_fragment>', '')
      .replace('#include <emissivemap_fragment>', EMISSIVE_FRAGMENT);
  };
  material.customProgramCacheKey = () => FACADE_CACHE_KEY;
  return material;
}
