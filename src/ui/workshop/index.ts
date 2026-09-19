/**
 * Loco Mustang's workshop UI (`docs/GARAGE_PLAN.md` §2.6). The integrator imports from here:
 * `createWorkshopOverlay` and the `WorkshopIntent` it emits. Lazy-load this module with the
 * showroom (its CSS comes with it), so the menu never pays for it.
 */
export { createWorkshopOverlay, type WorkshopOverlay, type WorkshopOverlayOptions } from './workshopOverlay';
export type { WorkshopIntent, WorkshopUiLevel, WorkshopUiSnapshot, WorkshopHudExtras, WorkshopLayerView } from './model';
export { workshopIcon, hasWorkshopIcon } from './icons';
