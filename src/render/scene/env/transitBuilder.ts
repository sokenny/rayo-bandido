import type { BusStopDef } from '../../../world/cityPlan';
import { BUS_STOP } from '../../../world/cityPlan';
import { PAL } from './palette';
import { groundGlow, halo, type EnvBuilders } from './builders';
import { transitCell, type TransitCell } from './textures';

/**
 * The city's bus shelters. The buses themselves are not here: they drive routes, so they are
 * simulated (`src/sim/buses.ts`) and drawn as their own objects (`scene/busVisual.ts`).
 *
 * A shelter is the one family of street prop that does NOT live inside a block collider, so
 * it does not follow the props builder's "only where `isSolid()`" house rule. It keeps it
 * honest the other way round instead: `cityWorld.ts` puts an exact box round each shelter in
 * the layout, cut from the same `BUS_STOP` numbers this file draws from, and stops are only
 * ever placed on the straight, axis-aligned boulevards so that box is the shape of the thing
 * and not a fattened guess. Drive into a shelter and you hit the shelter.
 *
 * Everything reads in the bay's amber: the fascia band and the light spill on the pavement
 * here, the light bars and the route plate on the bus. That amber is the network's livery —
 * it is how you tell a stop from a shopfront at a distance, and why the two match.
 */
export function buildTransit(b: EnvBuilders): void {
  const stops = b.plan.busStops;
  if (!stops) return;
  // Every other shelter along the list carries the BADKALA WANTED ad in its poster bay
  // instead of a transit poster: half the network, and alternating rather than random so a
  // driver never passes two of the same ad in a row on one street.
  stops.forEach((st, i) => buildShelter(b, st, i % 2 === 1));
}

/** X of the point `a` metres along the street and `o` metres out toward the road. */
function px(st: BusStopDef, a: number, o: number): number {
  return st.x + st.tx * a + st.nx * o;
}

function pz(st: BusStopDef, a: number, o: number): number {
  return st.z + st.tz * a + st.nz * o;
}

/** Yaw for a panel facing the road (`out` 1) or facing back into the shelter (`out` -1). */
function facing(st: BusStopDef, out: number): number {
  return Math.atan2(st.nx * out, st.nz * out);
}

/** A named transit panel, sized `w` x `h`, at (a, o) in the stop's frame. */
function transitPanel(b: EnvBuilders, st: BusStopDef, cell: TransitCell, a: number, o: number, y: number, w: number, h: number, out: number): void {
  const uv = transitCell(cell);
  b.transit.panel(px(st, a, o), y, pz(st, a, o), w, h, facing(st, out), uv.u0, uv.v0, uv.u1, uv.v1);
}

/* ------------------------------------------------------------------ the shelter */

const L = BUS_STOP.length;
const D = BUS_STOP.depth;
/** Where the side bay (poster and timetable) starts, measured from the far end (m). */
const BAY = 2.8;
/** Top of the posts and the back wall: the roof sits on this. */
const EAVE = 2.78;

function buildShelter(b: EnvBuilders, st: BusStopDef, badkala: boolean): void {
  const y0 = st.y;
  const tx = st.tx;
  const tz = st.tz;
  const back = -D / 2 + 0.07;
  const front = D / 2 - 0.12;

  // Back wall, roof and its shallow gable.
  b.props.color(PAL.metalDark, 0.95);
  b.props.orientedBox(px(st, 0, back), pz(st, 0, back), tx, tz, L, 0.14, y0 + 0.12, y0 + EAVE);
  b.props.color(PAL.metalDark, 1.25);
  b.props.orientedBox(px(st, 0, 0.15), pz(st, 0, 0.15), tx, tz, L + 0.5, D + 0.6, y0 + EAVE, y0 + 2.96, { bottom: true });
  b.props.color(PAL.metalDark, 1.05);
  b.props.orientedBox(px(st, 0, 0), pz(st, 0, 0), tx, tz, L + 0.2, 0.9, y0 + 2.96, y0 + BUS_STOP.height);

  // Corner posts, and the one that divides the waiting bay from the poster bay.
  b.props.color(PAL.metalDark, 0.8);
  for (const a of [-L / 2 + 0.12, L / 2 - 0.12, L / 2 - BAY]) {
    b.props.orientedBox(px(st, a, front), pz(st, a, front), tx, tz, 0.18, 0.18, y0, y0 + EAVE);
  }

  // The row of strip lights under the front edge of the roof.
  b.neon.color(PAL.winCold, 1);
  for (let i = 0; i < 6; i++) {
    const a = -L / 2 + 0.9 + i * ((L - 1.8) / 5);
    b.neon.tube(px(st, a - 0.5, front), y0 + 2.66, pz(st, a - 0.5, front), px(st, a + 0.5, front), y0 + 2.66, pz(st, a + 0.5, front), 0.13);
  }
  halo(b, px(st, 0, D / 2 + 0.4), y0 + 2.6, pz(st, 0, D / 2 + 0.4), L * 1.1, 2.4, facing(st, 1), PAL.winCold, 0.09);

  // The amber fascia band: the network's livery, and what reads as "bus stop" from a street away.
  transitPanel(b, st, 'band', 0, D / 2 + 0.06, y0 + 2.42, L, 0.36, 1);
  transitPanel(b, st, 'band', 0, -D / 2 - 0.06, y0 + 2.42, L, 0.36, -1);
  halo(b, px(st, 0, D / 2 + 0.5), y0 + 2.42, pz(st, 0, D / 2 + 0.5), L * 1.2, 3.2, facing(st, 1), PAL.neonAmber, 0.16);

  // Behind the bench: the route map and the name board.
  const inner = back + 0.09;
  const waiting = -BAY / 2;
  transitPanel(b, st, 'map', waiting, inner, y0 + 1.42, 4, 1.4, 1);
  transitPanel(b, st, `board${st.route}` as TransitCell, waiting, inner, y0 + 2.44, 4, 0.75, 1);
  halo(b, px(st, waiting, inner + 0.3), y0 + 1.7, pz(st, waiting, inner + 0.3), 6.4, 3.4, facing(st, 1), PAL.neonCyan, 0.1);

  // The bench, lit from underneath.
  b.props.color(PAL.concrete, 1.1);
  b.props.orientedBox(px(st, waiting, back + 0.62), pz(st, waiting, back + 0.62), tx, tz, 3.6, 0.44, y0 + 0.4, y0 + 0.5);
  b.props.color(PAL.metalDark, 0.7);
  for (const a of [waiting - 1.5, waiting + 1.5]) {
    b.props.orientedBox(px(st, a, back + 0.62), pz(st, a, back + 0.62), tx, tz, 0.12, 0.4, y0, y0 + 0.4);
  }
  b.neon.color(PAL.neonAmber, 0.85);
  b.neon.tube(px(st, waiting - 1.7, back + 0.62), y0 + 0.3, pz(st, waiting - 1.7, back + 0.62), px(st, waiting + 1.7, back + 0.62), y0 + 0.3, pz(st, waiting + 1.7, back + 0.62), 0.1);

  // The side bay: a back-lit poster and the timetable beside it. The ad is either one of the
  // two transit posters on the atlas or, on half the network, the BADKALA WANTED board — a
  // 1:2 portrait panel off its own texture, so it is placed rather than atlassed.
  const poster = (st.route % 2 === 0 ? 'ad0' : 'ad1') as TransitCell;
  const posterA = L / 2 - 1.2;
  if (badkala) {
    b.badkala.panel(px(st, posterA, inner), y0 + 1.62, pz(st, posterA, inner), 0.84, 1.68, facing(st, 1));
  } else {
    transitPanel(b, st, poster, posterA, inner, y0 + 1.6, 1.3, 1.56, 1);
  }
  transitPanel(b, st, 'times', L / 2 - 2.3, inner, y0 + 1.66, 0.8, 1.2, 1);
  const posterGlow = badkala ? PAL.neonMagenta : poster === 'ad0' ? PAL.neonCyan : PAL.neonAmber;
  halo(b, px(st, posterA, inner + 0.4), y0 + 1.6, pz(st, posterA, inner + 0.4), 4.4, 4, facing(st, 1), posterGlow, 0.2);
  groundGlow(b, px(st, posterA, D / 2 + 1.6), pz(st, posterA, D / 2 + 1.6), 8, 8, posterGlow, 0.13);

  // The amber pool the shelter throws across the pavement and out onto the asphalt.
  const spill = D / 2 + 1.9;
  groundGlow(b, px(st, 0, spill), pz(st, 0, spill), Math.abs(tx) > 0.5 ? L + 4 : 6.5, Math.abs(tx) > 0.5 ? 6.5 : L + 4, PAL.neonAmber, 0.2);
  groundGlow(b, px(st, 0, 0), pz(st, 0, 0), Math.abs(tx) > 0.5 ? L : D + 1.5, Math.abs(tx) > 0.5 ? D + 1.5 : L, PAL.neonAmber, 0.14, 0.05);
}
