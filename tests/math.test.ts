import { describe, expect, it } from 'vitest';
import { angleDelta, forwardX, forwardZ, rightX, rightZ, wrapAngle } from '../src/core/math';

describe('heading convention', () => {
  it('heading 0 points toward -Z with +X on the right', () => {
    expect(forwardX(0)).toBeCloseTo(0);
    expect(forwardZ(0)).toBeCloseTo(-1);
    expect(rightX(0)).toBeCloseTo(1);
    expect(rightZ(0)).toBeCloseTo(0);
  });

  it('increasing heading turns right (clockwise from above)', () => {
    const h = Math.PI / 2;
    expect(forwardX(h)).toBeCloseTo(1);
    expect(forwardZ(h)).toBeCloseTo(0);
    expect(rightX(h)).toBeCloseTo(0);
    expect(rightZ(h)).toBeCloseTo(1);
  });

  it('wraps angles into (-PI, PI]', () => {
    expect(wrapAngle(Math.PI * 3)).toBeCloseTo(Math.PI);
    expect(wrapAngle(-Math.PI * 1.5)).toBeCloseTo(Math.PI / 2);
    expect(angleDelta(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2);
  });
});
