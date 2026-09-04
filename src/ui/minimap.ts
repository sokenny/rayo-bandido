import type { MinimapData, RaceCourse, RivalCar, TargetState } from '../core/types';
import { MINIMAP } from '../config/tuning';
import { slotCss } from '../core/playerColors';

/**
 * Minimap: a north-up picture of the drivable roads with the player, the electric cars and,
 * on the circuit, the line and the checkpoints. The roads are drawn once into an offscreen
 * canvas; each frame only clears, blits it and draws a handful of dots. Hidden ribbons (the
 * shortcuts) are deliberately left off — they are for the player to find.
 *
 * Performance contract: no per-frame allocation, one 2D canvas of `MINIMAP.size` CSS pixels.
 */
export interface Minimap {
  /** `rivals` is empty outside a multiplayer race; each one is drawn in its slot colour. */
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
    update(playerX, playerZ, heading, targets, rivals) {
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(base, 0, 0);

      // Electric cars: white dots, dimmed when disabled.
      for (let i = 0; i < targets.length; i++) {
        const t = targets[i];
        if (t.status === 'destroyed') continue;
        ctx.fillStyle = t.status === 'active' ? 'rgba(240, 248, 255, 0.95)' : 'rgba(240, 248, 255, 0.35)';
        ctx.beginPath();
        ctx.arc(px(t.x), pz(t.z), dotR, 0, Math.PI * 2);
        ctx.fill();
      }

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
      ctx.rotate(heading);
      ctx.fillStyle = selfColour;
      ctx.shadowColor = selfColour;
      ctx.shadowBlur = 6 * dpr;
      ctx.beginPath();
      ctx.moveTo(0, -5.5 * dpr);
      ctx.lineTo(4 * dpr, 4.5 * dpr);
      ctx.lineTo(0, 2.4 * dpr);
      ctx.lineTo(-4 * dpr, 4.5 * dpr);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    },
    dispose() {
      wrap.remove();
    },
  };
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

  // Road body, then a thin cold outline so the network reads against the dark panel.
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
      if (rb.hidden || rb.points.length < 2) continue;
      ctx.lineWidth = Math.max(1.5 * dpr, rb.width * scale + pass.widen);
      ctx.beginPath();
      ctx.moveTo(px(rb.points[0].x), pz(rb.points[0].z));
      for (let i = 1; i < rb.points.length; i++) ctx.lineTo(px(rb.points[i].x), pz(rb.points[i].z));
      if (rb.closed) ctx.closePath();
      ctx.stroke();
    }
  }

  if (!race) return;
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
