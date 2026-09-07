import type { MinimapData, RaceCourse, RivalCar, TargetState } from '../core/types';
import { MINIMAP } from '../config/tuning';
import { slotCss } from '../core/playerColors';

/**
 * Minimap: a north-up picture of the drivable roads with the player, the activity markers and,
 * on the circuit, the line and the checkpoints. Electric cars are not shown — finding them is
 * the game. The roads are drawn once into an offscreen canvas; each frame only clears, blits it
 * and draws a handful of dots. Hidden ribbons (the shortcuts) are deliberately left off — they
 * are for the player to find.
 *
 * WHAT IS AND IS NOT MARKED. The distinction is whether the thing is a destination. An electric
 * car is quarry: a hundred white dots buried the player's own arrow and gave away a hunt that is
 * the point of the mode. The RAYO RUSH circle is somewhere to GO, and one you cannot find is one
 * that does not exist — so it is drawn, in the chrome's hazard yellow, which nothing else on
 * this map uses. It goes into the base layer with the roads: it never moves, so it costs
 * nothing per frame.
 *
 * Performance contract: no per-frame allocation, one 2D canvas of `MINIMAP.size` CSS pixels.
 */
export interface Minimap {
  /** `targets` is accepted but not drawn; `rivals` is empty outside a multiplayer race. */
  update(
    playerX: number,
    playerZ: number,
    heading: number,
    targets: readonly TargetState[],
    rivals?: readonly RivalCar[],
  ): void;
  dispose(): void;
}

export interface MinimapPose {
  x: number;
  z: number;
  heading: number;
}

/**
 * `selfColour` is the player's own arrow: cyan alone, their slot colour in a match, so the
 * map says the same thing about them as every other screen does.
 */
export function createMinimap(root: HTMLElement, data: MinimapData, race: RaceCourse | null, selfColour = '#4ff3ff'): Minimap {
  const size = MINIMAP.size;
  const pad = MINIMAP.padding;
  const dpr = Math.min(2, typeof devicePixelRatio === 'number' ? devicePixelRatio : 1);

  const wrap = document.createElement('div');
  wrap.className = 'rb-minimap';
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  wrap.appendChild(canvas);
  root.appendChild(wrap);

  const ctx = canvas.getContext('2d');
  const base = document.createElement('canvas');
  base.width = canvas.width;
  base.height = canvas.height;
  const bctx = base.getContext('2d');

  // World -> canvas: fit the bounds inside the padded square, north up (z grows downward).
  const b = data.bounds;
  const spanX = b.maxX - b.minX;
  const spanZ = b.maxZ - b.minZ;
  const scale = ((size - pad * 2) / Math.max(spanX, spanZ)) * dpr;
  const offX = (canvas.width - spanX * scale) / 2;
  const offZ = (canvas.height - spanZ * scale) / 2;
  const px = (x: number): number => offX + (x - b.minX) * scale;
  const pz = (z: number): number => offZ + (z - b.minZ) * scale;

  if (bctx) drawBase(bctx, data, race, px, pz, scale, dpr);

  const dotR = 2.2 * dpr;

  return {
    update(playerX, playerZ, heading, _targets, rivals) {
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(base, 0, 0);

      // Electric cars are deliberately not drawn: a hundred-odd white dots buried the
      // player's own arrow and the route. Hunting them is the game.

      // Rivals: a slightly bigger dot in each player's own colour, so a glance at the map
      // says who is where. Drawn under the player arrow, which always stays on top.
      if (rivals) {
        for (let i = 0; i < rivals.length; i++) {
          const r = rivals[i];
          if (!r.present) continue;
          ctx.fillStyle = slotCss(r.slot);
          ctx.beginPath();
          ctx.arc(px(r.x), pz(r.z), dotR * 1.35, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Player: an arrow in their own colour. Heading 0 faces -Z, which is up on the map;
      // positive = clockwise.
      const cx = px(playerX);
      const cz = pz(playerZ);
      ctx.save();
      ctx.translate(cx, cz);

      // A soft halo behind the arrow: on a busy grid the eye finds the glow first, then
      // reads the heading off the arrow inside it.
      const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, 13 * dpr);
      halo.addColorStop(0, 'rgba(255, 255, 255, 0.32)');
      halo.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(0, 0, 13 * dpr, 0, Math.PI * 2);
      ctx.fill();

      ctx.rotate(heading);
      ctx.fillStyle = selfColour;
      ctx.strokeStyle = 'rgba(8, 12, 20, 0.95)';
      ctx.lineWidth = 1.6 * dpr;
      ctx.lineJoin = 'round';
      ctx.shadowColor = selfColour;
      ctx.shadowBlur = 10 * dpr;
      ctx.beginPath();
      ctx.moveTo(0, -9 * dpr);
      ctx.lineTo(6.4 * dpr, 7.2 * dpr);
      ctx.lineTo(0, 3.8 * dpr);
      ctx.lineTo(-6.4 * dpr, 7.2 * dpr);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.stroke();
      ctx.restore();
    },
    dispose() {
      wrap.remove();
    },
  };
}

/**
 * One activity marker: a ringed bolt in hazard yellow, on a dark disc so it reads over a road.
 *
 * Drawn at a FIXED PIXEL SIZE rather than to world scale. The circle it stands for is 7.5 m
 * across in a city about 540 m wide, which on a 176 px map is under three pixels — a mark the
 * player has to be able to spot has to be sized for the eye, not for the ground.
 *
 * The bolt is a stroked zigzag rather than the filled silhouette the HUD and the world marker
 * share, because at ten pixels a filled bolt is a blob and three strokes still read as lightning.
 */
function drawActivity(ctx: CanvasRenderingContext2D, cx: number, cz: number, dpr: number): void {
  const r = 6.6 * dpr;
  const YELLOW = '#fcee0a';

  ctx.save();
  ctx.translate(cx, cz);

  // Dark disc, so the mark never has to compete with the road under it.
  ctx.fillStyle = 'rgba(5, 7, 13, 0.85)';
  ctx.beginPath();
  ctx.arc(0, 0, r + 1.6 * dpr, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = YELLOW;
  ctx.shadowColor = YELLOW;
  ctx.shadowBlur = 6 * dpr;
  ctx.lineWidth = 1.5 * dpr;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();

  ctx.lineWidth = 1.7 * dpr;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(1.4 * dpr, -3.4 * dpr);
  ctx.lineTo(-1.3 * dpr, -0.2 * dpr);
  ctx.lineTo(1.3 * dpr, 0.2 * dpr);
  ctx.lineTo(-1.4 * dpr, 3.4 * dpr);
  ctx.stroke();

  ctx.restore();
}

function drawBase(
  ctx: CanvasRenderingContext2D,
  data: MinimapData,
  race: RaceCourse | null,
  px: (x: number) => number,
  pz: (z: number) => number,
  scale: number,
  dpr: number,
): void {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // The bay, under everything.
  if (data.water) {
    const w = data.water;
    ctx.fillStyle = 'rgba(36, 92, 140, 0.35)';
    ctx.fillRect(px(w.minX), pz(w.minZ), (w.maxX - w.minX) * scale, (w.maxZ - w.minZ) * scale);
  }

  // Road body, then a thin cold outline so the network reads against the dark panel.
  // Viaducts and the skyway are drawn last, in magenta, so they read as a layer above.
  const passes: Array<{ stroke: string; widen: number }> = [
    { stroke: 'rgba(79, 243, 255, 0.35)', widen: 1.6 * dpr },
    { stroke: 'rgba(214, 232, 255, 0.55)', widen: 0 },
  ];
  for (const pass of passes) {
    ctx.strokeStyle = pass.stroke;
    ctx.fillStyle = pass.stroke;
    for (const r of data.rects) {
      const x = px(r.minX);
      const z = pz(r.minZ);
      const w = (r.maxX - r.minX) * scale;
      const h = (r.maxZ - r.minZ) * scale;
      ctx.fillRect(x - pass.widen / 2, z - pass.widen / 2, w + pass.widen, h + pass.widen);
    }
    for (const rb of data.ribbons) {
      if (rb.hidden || rb.elevated || rb.points.length < 2) continue;
      ctx.lineWidth = Math.max(1.5 * dpr, rb.width * scale + pass.widen);
      ctx.beginPath();
      ctx.moveTo(px(rb.points[0].x), pz(rb.points[0].z));
      for (let i = 1; i < rb.points.length; i++) ctx.lineTo(px(rb.points[i].x), pz(rb.points[i].z));
      if (rb.closed) ctx.closePath();
      ctx.stroke();
    }
  }
  for (const rb of data.ribbons) {
    if (rb.hidden || !rb.elevated || rb.points.length < 2) continue;
    ctx.strokeStyle = 'rgba(255, 61, 240, 0.85)';
    ctx.lineWidth = Math.max(1.5 * dpr, rb.width * scale * 0.7);
    ctx.beginPath();
    ctx.moveTo(px(rb.points[0].x), pz(rb.points[0].z));
    for (let i = 1; i < rb.points.length; i++) ctx.lineTo(px(rb.points[i].x), pz(rb.points[i].z));
    if (rb.closed) ctx.closePath();
    ctx.stroke();
  }

  if (race) {
    // Checkpoints in cyan, the line in magenta, both drawn a little longer than the road.
    race.gates.forEach((g, i) => {
      ctx.strokeStyle = i === 0 ? '#ff3df0' : 'rgba(79, 243, 255, 0.9)';
      ctx.lineWidth = (i === 0 ? 2.4 : 1.6) * dpr;
      ctx.beginPath();
      ctx.moveTo(px(g.ax), pz(g.az));
      ctx.lineTo(px(g.bx), pz(g.bz));
      ctx.stroke();
    });
  }

  // Last, so nothing is drawn over the one mark on this map that is meant to be looked for.
  if (data.activities) {
    for (const a of data.activities) drawActivity(ctx, px(a.x), pz(a.z), dpr);
  }
}
