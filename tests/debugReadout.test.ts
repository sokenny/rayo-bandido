import { describe, expect, it } from 'vitest';
import { clipboardLine, headingLabel, worldText, type WorldReadout } from '../src/ui/debugOverlay';

/**
 * The coordinate readout is a communication tool: its numbers get pasted into world specs and
 * bug reports, so the axes and the compass have to match the world's own convention
 * (x east, z south, heading 0 = north, increasing clockwise).
 */
function readout(over: Partial<WorldReadout> = {}): WorldReadout {
  return {
    carX: -66,
    carY: 0,
    carZ: -20,
    heading: 0,
    camX: -66,
    camY: 2.1,
    camZ: -14.8,
    aimX: -66,
    aimY: 0,
    aimZ: -76.2,
    aimDistance: 61,
    aimWhat: 'ground',
    aimValid: true,
    surface: { x: 0, y: 0, z: 0, distance: 0, what: '', valid: false, taken: false },
    ...over,
  };
}

describe('the debug coordinate readout', () => {
  it('names the compass point the world spec uses', () => {
    expect(headingLabel(0)).toContain('N');
    expect(headingLabel(Math.PI / 2)).toContain('E');
    expect(headingLabel(Math.PI)).toContain('S');
    expect(headingLabel(-Math.PI / 2)).toContain('W');
    // Wraps rather than printing a negative or a fourth-turn overflow.
    expect(headingLabel(-Math.PI / 2)).toContain('270');
    expect(headingLabel(3 * Math.PI)).toContain('180');
  });

  it('asks for F4 until a surface has actually been read', () => {
    expect(worldText(readout(), false)).toContain('press F4');
    const taken = readout({
      surface: { x: -48.2, y: 1, z: -41.2, distance: 30, what: 'blk-38', valid: true, taken: true },
    });
    const text = worldText(taken, false);
    expect(text).toContain('blk-38');
    expect(text).not.toContain('press F4');
  });

  it('copies both readings, because the ground point shoots through the building', () => {
    const line = clipboardLine(
      readout({ surface: { x: -48.2, y: 1, z: -41.2, distance: 30, what: 'blk-38', valid: true, taken: true } }),
    );
    expect(line).toContain('car (-66.0, 0.0, -20.0) heading 0° N');
    expect(line).toContain('ground (-66.0, -76.2)');
    expect(line).toContain('hit (-48.2, 1.0, -41.2) on blk-38');
  });

  it('says so instead of inventing a coordinate above the horizon', () => {
    const text = worldText(readout({ aimValid: false, aimWhat: 'sky' }), false);
    expect(text).toContain('(sky)');
    expect(text).not.toContain('ground x');
  });
});
