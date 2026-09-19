import { loft, part } from '../geometryKit';
import { BODY_COLORS, type SlotModule } from './common';

/**
 * Greenhouse: raked windshield, short cabin set back, fastback into a short deck. Fixed: not sold.
 *
 * `ctx.openCabin` leaves the windscreen and backlight panels out, so those two are real holes
 * with the cabin behind them (`vehicles/interior.ts`) rather than paint under a pane of glass.
 * Only the player's own car takes it: a rival carries no cabin, and an empty opening would be a
 * window straight through the car.
 */
export const greenhouseSlot: SlotModule = {
  slot: 'greenhouse',
  variants: ['greenhouse.stock'],
  build(_partId, ctx) {
    return [
      part(
        loft(
          [
            { z: -0.74, bottomY: 0.8, topY: 0.87, bottomHalfWidth: 0.76, topHalfWidth: 0.76 },
            { z: -0.06, bottomY: 0.84, topY: 1.3, bottomHalfWidth: 0.74, topHalfWidth: 0.62 },
            { z: 0.62, bottomY: 0.84, topY: 1.31, bottomHalfWidth: 0.74, topHalfWidth: 0.62 },
            { z: 1.58, bottomY: 0.84, topY: 0.93, bottomHalfWidth: 0.78, topHalfWidth: 0.72 },
          ],
          { openTop: ctx.openCabin ? [0, 2] : [] },
        ),
        BODY_COLORS.PAINT_ROOF,
      ),
    ];
  },
};
