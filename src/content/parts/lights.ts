import type { PartDef } from '../carParts';

/**
 * Head and tail light shapes. OWNED BY agent G (`docs/GARAGE_PLAN.md`, Ola 1). Every entry
 * needs a shape of the same id in `src/render/scene/vehicles/lights.ts` (`buildHeadGeometry` /
 * `buildTailGeometry`, and a row in `HEAD_STYLE` / `TAIL_STYLE`). Head light colour, neon and
 * cabin light are `color` categories and have no entries here. Prices and ratings are
 * provisional; the economy's word is `PRICING` in `../carParts.ts`.
 */
export const LIGHT_PARTS: PartDef[] = [
  { id: 'headlights.stock', category: 'headlights', name: 'De fábrica', price: 0, rating: 1 },
  { id: 'headlights.slim', category: 'headlights', name: 'LED finos', price: 1800, rating: 3, blurb: 'Barra LED rasgada, mirada de enojado.' },
  { id: 'headlights.quad', category: 'headlights', name: 'Cuatro proyectores', price: 2200, rating: 3, blurb: 'Dos lupas redondas por lado.' },
  { id: 'headlights.popup', category: 'headlights', name: 'Rebatibles', price: 3000, rating: 4, blurb: 'Faros pop-up levantados, a lo AE86.' },
  { id: 'headlights.smoked', category: 'headlights', name: 'Ahumados', price: 900, rating: 2, blurb: 'Los de fábrica tras un vidrio oscuro.' },
  { id: 'headlights.fog', category: 'headlights', name: 'Con antinieblas', price: 1400, rating: 2, blurb: 'Antinieblas amarillos JDM abajo.' },
  { id: 'taillights.stock', category: 'taillights', name: 'De fábrica', price: 0, rating: 1 },
  { id: 'taillights.led-bar', category: 'taillights', name: 'Barra LED', price: 2200, rating: 4, blurb: 'Una línea roja de lado a lado.' },
  { id: 'taillights.quad-round', category: 'taillights', name: 'Cuatro redondas', price: 1800, rating: 3, blurb: 'Dos aros por lado, estilo Skyline.' },
  { id: 'taillights.smoked', category: 'taillights', name: 'Ahumadas', price: 900, rating: 2, blurb: 'Oscuras hasta que frenás.' },
  { id: 'taillights.split', category: 'taillights', name: 'Partidas', price: 1400, rating: 2, blurb: 'Grupo en el guardabarros y otro en la tapa.' },
];
