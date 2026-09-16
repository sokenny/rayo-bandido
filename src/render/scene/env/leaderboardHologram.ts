import * as THREE from 'three';
import { PAL } from './palette';
import type { MarkerGround } from './activityMarker';
import { formatLeaderboardValue, type LeaderboardBoardSpec, type LeaderboardRow } from '../../../content/leaderboards';

/**
 * THE HOLOGRAM LEADERBOARD: a tall projected board of high scores standing beside an activity's
 * ring, in that activity's neon (`src/content/leaderboards.ts` says what is on it and where).
 *
 * WHAT MAKES IT READ AS A HOLOGRAM rather than a sign: nothing about it is solid. The panel is
 * additive light with no backing, so the city shows through it; a band of brighter light sweeps
 * down it; it stutters now and then like a projection losing lock; and it stands on a beam of
 * light rising from an emitter on the ground instead of on a post.
 *
 * IT TURNS TO FACE THE CAMERA, about the vertical only. A flat board beside a boulevard is
 * edge-on to a car driving along it (`stack-screens-head-on`), and a projection has no back to
 * show, so the panel and its sweep yaw to the camera every frame and the beam — which is round —
 * does not need to.
 *
 * BUDGET. Four draw calls, all unlit `MeshBasicMaterial`, depth-write off. The text is one
 * canvas, painted once and again only when `setRows` is called; animation is scalar writes.
 */

export interface LeaderboardHologramVisual {
  group: THREE.Group;
  /** Repaint the rows (the database, when there is one). */
  setRows(rows: readonly LeaderboardRow[]): void;
  setHidden(hidden: boolean): void;
  update(time: number, camX?: number, camZ?: number): void;
  dispose(): void;
}

const LATIN = '"Bahnschrift","DIN Alternate","Arial Narrow",Impact,sans-serif';
/** The panel (m): tall enough to read over the traffic from a block away. */
const BOARD_W = 7.6;
const BOARD_H = 11.4;
/** Where the panel's bottom edge floats (m). The beam fills the gap under it. */
const BOARD_LIFT = 2.6;
const CANVAS_W = 800;
const CANVAS_H = 1200;
const ROWS = 10;

function hex(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`;
}

function rgba(c: number, a: number): string {
  return `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},${a})`;
}

function paintBoard(ctx: CanvasRenderingContext2D, spec: LeaderboardBoardSpec, rows: readonly LeaderboardRow[], tint: number): void {
  const W = CANVAS_W;
  const H = CANVAS_H;
  const t = hex(tint);
  ctx.clearRect(0, 0, W, H);

  // The field of the projection: a faint wash, brighter at the top, and the scanlines through it.
  // Additive, so black is "no light" — everything here is light added, never paint laid down.
  const wash = ctx.createLinearGradient(0, 0, 0, H);
  wash.addColorStop(0, rgba(tint, 0.2));
  wash.addColorStop(0.5, rgba(tint, 0.08));
  wash.addColorStop(1, rgba(tint, 0.14));
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = rgba(tint, 0.07);
  for (let y = 0; y < H; y += 6) ctx.fillRect(0, y, W, 2);

  // The frame: a thin edge and heavy corner brackets.
  ctx.strokeStyle = rgba(tint, 0.55);
  ctx.lineWidth = 3;
  ctx.strokeRect(12, 12, W - 24, H - 24);
  ctx.strokeStyle = rgba(0xffffff, 0.9);
  ctx.shadowColor = t;
  ctx.shadowBlur = 18;
  ctx.lineWidth = 8;
  const b = 70;
  for (const [x, y, dx, dy] of [
    [14, 14, 1, 1],
    [W - 14, 14, -1, 1],
    [14, H - 14, 1, -1],
    [W - 14, H - 14, -1, -1],
  ]) {
    ctx.beginPath();
    ctx.moveTo(x, y + dy * b);
    ctx.lineTo(x, y);
    ctx.lineTo(x + dx * b, y);
    ctx.stroke();
  }

  const text = (s: string, x: number, y: number, size: number, fill: string, align: CanvasTextAlign, glow = 0, weight = 700): void => {
    ctx.font = `${weight} ${size}px ${LATIN}`;
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    ctx.shadowColor = t;
    ctx.shadowBlur = glow;
    ctx.fillStyle = fill;
    ctx.fillText(s, x, y);
  };

  // The header.
  text('HIGH SCORES', W / 2, 92, 34, rgba(tint, 0.95), 'center', 10);
  text(spec.title, W / 2, 180, 92, '#ffffff', 'center', 34);
  text(spec.title, W / 2, 180, 92, rgba(0xffffff, 0.5), 'center', 0);
  text(spec.subtitle, W / 2, 232, 32, rgba(tint, 0.95), 'center', 8);

  ctx.shadowBlur = 14;
  ctx.fillStyle = t;
  ctx.fillRect(60, 262, W - 120, 4);

  // The column heads.
  const left = 64;
  const nameX = 170;
  const right = W - 64;
  text('#', left, 316, 26, rgba(tint, 0.8), 'left', 0);
  text('PILOTO', nameX, 316, 26, rgba(tint, 0.8), 'left', 0);
  text(spec.column, right, 316, 26, rgba(tint, 0.8), 'right', 0);

  // The rows. The podium is lit hotter than the rest, and the leader hottest.
  const top = 348;
  const rowH = 76;
  for (let i = 0; i < ROWS; i++) {
    const y = top + i * rowH;
    const row = rows[i];
    if (i < 3) {
      ctx.shadowBlur = 0;
      ctx.fillStyle = rgba(tint, i === 0 ? 0.3 : 0.16);
      ctx.fillRect(40, y, W - 80, rowH - 10);
    }
    ctx.shadowBlur = 0;
    ctx.fillStyle = rgba(tint, 0.22);
    ctx.fillRect(40, y + rowH - 6, W - 80, 2);
    const base = y + rowH / 2 + 16;
    const hot = i === 0 ? '#ffffff' : i < 3 ? rgba(0xffffff, 0.92) : rgba(0xffffff, 0.72);
    text(String(i + 1).padStart(2, '0'), left, base, 42, i < 3 ? '#ffffff' : t, 'left', i < 3 ? 16 : 6);
    text(row ? row.name : '———', nameX, base, 42, hot, 'left', i === 0 ? 14 : 4);
    text(row ? formatLeaderboardValue(row.value, spec.format) : '—', right, base, 42, hot, 'right', i === 0 ? 14 : 4);
  }

  // The footer.
  ctx.shadowBlur = 0;
  ctx.fillStyle = rgba(tint, 0.5);
  ctx.fillRect(60, H - 104, W - 120, 2);
  text('RANKING GLOBAL', W / 2, H - 56, 28, rgba(tint, 0.85), 'center', 8);
  ctx.shadowBlur = 0;
}

/** The sweep: one soft bright band on a transparent strip, tiled vertically and scrolled. */
function makeSweepTexture(tint: number): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 4;
  cv.height = 256;
  const ctx = cv.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, rgba(tint, 0));
  g.addColorStop(0.78, rgba(tint, 0));
  g.addColorStop(0.9, rgba(tint, 0.55));
  g.addColorStop(0.93, rgba(0xffffff, 0.8));
  g.addColorStop(0.95, rgba(tint, 0));
  g.addColorStop(1, rgba(tint, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 0.5);
  return tex;
}

/** The beam: an open cone, bright at the emitter and gone by the time it reaches the panel. */
function buildBeam(tint: number): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(BOARD_W * 0.42, 0.45, BOARD_LIFT + 0.6, 32, 1, true);
  geo.translate(0, (BOARD_LIFT + 0.6) / 2, 0);
  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color(tint);
  for (let i = 0; i < pos.count; i++) {
    const k = 1 - pos.getY(i) / (BOARD_LIFT + 0.6);
    colors[i * 3] = c.r * k;
    colors[i * 3 + 1] = c.g * k;
    colors[i * 3 + 2] = c.b * k;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

/**
 * `site` is the ring the board belongs to; the board stands `spec.lateral` metres off the ring's
 * own axis, on `spec.side`, on whatever ground is under that point.
 */
export function createLeaderboardHologram(
  site: { x: number; z: number; y: number; heading: number },
  spec: LeaderboardBoardSpec,
  tint: number,
  ground: MarkerGround | null = null,
): LeaderboardHologramVisual {
  // The ring's lateral axis: its local +X under the marker's own yaw (`-heading`).
  const yaw = -site.heading;
  const ox = Math.cos(yaw) * spec.side * spec.lateral;
  const oz = -Math.sin(yaw) * spec.side * spec.lateral;
  const x = site.x + ox;
  const z = site.z + oz;
  const y = ground ? ground(x, z, site.y, 1) : site.y;

  const group = new THREE.Group();
  group.name = `leaderboard-${spec.title.toLowerCase().replace(/\s+/g, '-')}`;
  group.position.set(x, y, z);

  /* ------------------------------------------------------------------ emitter + beam */

  const emitterGeo = new THREE.RingGeometry(0.35, 1.1, 32);
  const emitterMat = new THREE.MeshBasicMaterial({
    color: tint,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const emitter = new THREE.Mesh(emitterGeo, emitterMat);
  emitter.rotation.x = -Math.PI / 2;
  emitter.position.y = 0.05;
  emitter.renderOrder = 2;
  group.add(emitter);

  const beamGeo = buildBeam(tint);
  const beamMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
    side: THREE.DoubleSide,
    forceSinglePass: true,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.renderOrder = 2;
  group.add(beam);

  /* ------------------------------------------------------------------ the panel */

  // Yawed to the camera as a unit.
  const face = new THREE.Group();
  face.position.y = BOARD_LIFT + BOARD_H / 2;
  group.add(face);

  const cv = document.createElement('canvas');
  cv.width = CANVAS_W;
  cv.height = CANVAS_H;
  const ctx = cv.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  paintBoard(ctx, spec, spec.rows, tint);
  const boardTex = new THREE.CanvasTexture(cv);
  boardTex.colorSpace = THREE.SRGBColorSpace;
  boardTex.anisotropy = 8;

  const panelGeo = new THREE.PlaneGeometry(BOARD_W, BOARD_H);
  const boardMat = new THREE.MeshBasicMaterial({
    map: boardTex,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    forceSinglePass: true,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const board = new THREE.Mesh(panelGeo, boardMat);
  board.renderOrder = 3;
  face.add(board);

  const sweepTex = makeSweepTexture(tint);
  const sweepMat = new THREE.MeshBasicMaterial({
    map: sweepTex,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    side: THREE.DoubleSide,
    forceSinglePass: true,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const sweep = new THREE.Mesh(panelGeo, sweepMat);
  sweep.position.z = 0.02;
  sweep.renderOrder = 4;
  face.add(sweep);

  /* ------------------------------------------------------------------ animation */

  let glitchSlot = -1;
  let glitch = 0;

  return {
    group,
    setRows(rows) {
      paintBoard(ctx, spec, rows, tint);
      boardTex.needsUpdate = true;
    },
    setHidden(hidden) {
      group.visible = !hidden;
    },
    update(time, camX, camZ) {
      if (!group.visible) return;
      if (camX !== undefined && camZ !== undefined) face.rotation.y = Math.atan2(camX - x, camZ - z);

      // A projection losing lock now and then: a dip, a sideways slip and a squash, one slot long.
      const slot = Math.floor(time * 4);
      if (slot !== glitchSlot) {
        glitchSlot = slot;
        const h = Math.abs(Math.sin(slot * 91.345 + x) * 43758.5453) % 1;
        glitch = h < 0.04 ? 1 : h < 0.1 ? 0.4 : 0;
      }
      const breath = 0.9 + 0.1 * Math.sin(time * 2.3);
      boardMat.color.setScalar(PAL.neonGain * breath * (1 - 0.45 * glitch));
      board.position.x = glitch > 0.5 ? 0.12 * Math.sin(time * 90) : 0;
      board.scale.y = 1 - 0.02 * glitch;
      sweepTex.offset.y = -time * 0.18;
      beamMat.opacity = 0.3 + 0.06 * Math.sin(time * 3.1) - 0.15 * glitch;
      emitterMat.opacity = 0.7 + 0.2 * Math.sin(time * 5.2);
    },
    dispose() {
      emitterGeo.dispose();
      emitterMat.dispose();
      beamGeo.dispose();
      beamMat.dispose();
      panelGeo.dispose();
      boardMat.dispose();
      boardTex.dispose();
      sweepMat.dispose();
      sweepTex.dispose();
    },
  };
}
