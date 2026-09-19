import { describe, expect, it } from 'vitest';
import { CATEGORIES, GROUPS, PALETTE, categoryDef } from '../src/content/carParts';
import { DECAL_ZONES, MAX_VINYLS, PLATE_MAX_CHARS, STOCK_LOADOUT, loadoutRating, sanitizePlateText } from '../src/core/loadout';
import type { WorkshopDenyReason } from '../src/core/types';
import { hasWorkshopIcon, workshopIcon } from '../src/ui/workshop/icons';
import {
  cycleZone,
  denyMessage,
  filterPlateInput,
  finishLabel,
  formatMoney,
  formatPlate,
  groupLabel,
  installVerb,
  keyAction,
  maxLayers,
  maxLoadoutRating,
  panelKind,
  railFraction,
  ringDelta,
  stepLabel,
  swatchBackground,
  wrapIndex,
  ZONE_LABELS,
} from '../src/ui/workshop/model';

/*
 * The workshop overlay's pure half (`src/ui/workshop/model.ts`, `icons.ts`). The DOM half is
 * checked in the harness (`harness/e-ui.html`, `scripts/harness-shots-e.mjs`): the test
 * environment is node, with no DOM.
 */

describe('workshop icons', () => {
  it('draws every group and category icon the catalogue names', () => {
    const keys = [...GROUPS.map((g) => g.icon), ...CATEGORIES.map((c) => c.icon)];
    const missing = keys.filter((k) => !hasWorkshopIcon(k));
    expect(missing).toEqual([]);
  });

  it('returns a self-contained svg in currentColor, and a fallback for unknown keys', () => {
    for (const c of CATEGORIES) {
      const svg = workshopIcon(c.icon);
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg.endsWith('</svg>')).toBe(true);
      expect(svg).toContain('viewBox="0 0 120 72"');
      expect(svg).toContain('currentColor');
      expect(svg).not.toMatch(/NaN|undefined/);
      // No external references: the game runs offline.
      expect(svg).not.toMatch(/href=|url\(/);
    }
    expect(workshopIcon('no-such-icon')).toContain('<svg');
    expect(hasWorkshopIcon('no-such-icon')).toBe(false);
  });
});

describe('workshop plate field', () => {
  it('keeps [A-Z0-9 ] only, upper-cases, strips accents, caps at seven', () => {
    expect(filterPlateInput('ab-12 3cd9wz')).toBe('AB12 3C');
    expect(filterPlateInput('ñandú 7')).toBe('NANDU 7');
    expect(filterPlateInput('')).toBe('');
    expect(filterPlateInput('!!!')).toBe('');
    expect(filterPlateInput('x'.repeat(100)).length).toBe(PLATE_MAX_CHARS);
  });

  it('agrees with the loadout sanitizer on anything non-blank', () => {
    for (const raw of ['ab 123 cd', 'Rayo99', 'ÁÉÍÓÚ12', 'bandido!', '  zz  ']) {
      const typed = filterPlateInput(raw);
      if (typed.trim() !== '') expect(sanitizePlateText(typed)).toBe(typed);
    }
  });

  it('prints the Mercosur pattern with its spaces, anything else as typed', () => {
    expect(formatPlate('AB123CD')).toBe('AB 123 CD');
    expect(formatPlate('AB 123 CD')).toBe('AB 123 CD');
    expect(formatPlate('BANDIDO')).toBe('BANDIDO');
    expect(formatPlate('A1')).toBe('A1');
  });
});

describe('workshop keys', () => {
  it('maps arrows, WASD, Q/E, Enter, Esc/Backspace and the layer keys', () => {
    expect(keyAction('ArrowLeft')).toBe('left');
    expect(keyAction('KeyD')).toBe('right');
    expect(keyAction('ArrowUp')).toBe('up');
    expect(keyAction('KeyS')).toBe('down');
    expect(keyAction('KeyQ')).toBe('prevCategory');
    expect(keyAction('KeyE')).toBe('nextCategory');
    expect(keyAction('Enter')).toBe('confirm');
    expect(keyAction('Escape')).toBe('back');
    expect(keyAction('Backspace')).toBe('back');
    expect(keyAction('KeyX')).toBe('exit');
    expect(keyAction('Delete')).toBe('layerRemove');
    expect(keyAction('Equal')).toBe('layerAdd');
    expect(keyAction('BracketLeft')).toBe('colorPrev');
    expect(keyAction('BracketRight')).toBe('colorNext');
    expect(keyAction('KeyF')).toBeNull();
  });
});

describe('workshop carousel maths', () => {
  it('wraps indices both ways', () => {
    expect(wrapIndex(-1, 6)).toBe(5);
    expect(wrapIndex(6, 6)).toBe(0);
    expect(wrapIndex(13, 6)).toBe(1);
    expect(wrapIndex(3, 0)).toBe(0);
  });

  it('takes the short way round the ring', () => {
    expect(ringDelta(0, 1, 6)).toBe(1);
    expect(ringDelta(0, 5, 6)).toBe(-1);
    expect(ringDelta(5, 0, 6)).toBe(1);
    expect(ringDelta(2, 2, 6)).toBe(0);
  });

  it('puts the progress dot at the ends and in between', () => {
    expect(railFraction(0, 6)).toBe(0);
    expect(railFraction(5, 6)).toBe(1);
    expect(railFraction(1, 3)).toBeCloseTo(0.5);
    expect(railFraction(0, 1)).toBe(0);
    expect(railFraction(9, 3)).toBe(1);
  });
});

describe('workshop labels', () => {
  it('has a Spanish shout for every refusal', () => {
    const reasons: WorkshopDenyReason[] = ['funds', 'locked', 'police', 'race', 'invalid'];
    for (const r of reasons) {
      const m = denyMessage(r);
      expect(m.title.length).toBeGreaterThan(0);
      expect(m.sub.length).toBeGreaterThan(0);
    }
    expect(denyMessage('funds', 5500).sub).toContain('¥5,500');
  });

  it('writes money like the HUD does', () => {
    expect(formatMoney(18450)).toBe('¥18,450');
    expect(formatMoney(0)).toBe('¥0');
    expect(formatMoney(-3)).toBe('¥0');
  });

  it('picks the verb for the install button by category', () => {
    expect(installVerb(categoryDef('frontBumper'))).toBe('INSTALAR');
    expect(installVerb(categoryDef('paint'))).toBe('PINTAR');
    expect(installVerb(categoryDef('finish'))).toBe('PINTAR');
    expect(installVerb(categoryDef('rimColor'))).toBe('PINTAR');
    expect(installVerb(categoryDef('vinyls'))).toBe('APLICAR');
    expect(installVerb(categoryDef('plate'))).toBe('GRABAR');
    expect(installVerb(categoryDef('neon'))).toBe('INSTALAR');
  });

  it('signs steps with a real minus and names finishes and groups', () => {
    expect(stepLabel(0)).toBe('0');
    expect(stepLabel(2)).toBe('+2');
    expect(stepLabel(-3)).toBe('−3');
    expect(finishLabel('pearl')).toBe('Perlado');
    expect(finishLabel('odd')).toBe('odd');
    expect(groupLabel('wheels')).toBe('Llantas y stance');
  });

  it('draws each category with the panel its kind calls for', () => {
    expect(panelKind('frontBumper')).toBe('part');
    expect(panelKind('plate')).toBe('plate');
    expect(panelKind('paint')).toBe('color');
    expect(panelKind('rideHeight')).toBe('step');
    expect(panelKind('finish')).toBe('finish');
    expect(panelKind('vinyls')).toBe('layers');
  });
});

describe('workshop layers', () => {
  it('knows how many layers each list holds', () => {
    expect(maxLayers('vinyls')).toBe(MAX_VINYLS);
    expect(maxLayers('decals')).toBe(DECAL_ZONES.length);
  });

  it('cycles decal zones round the list and names every zone', () => {
    expect(cycleZone(DECAL_ZONES[0], -1)).toBe(DECAL_ZONES[DECAL_ZONES.length - 1]);
    expect(cycleZone(DECAL_ZONES[DECAL_ZONES.length - 1], 1)).toBe(DECAL_ZONES[0]);
    for (const z of DECAL_ZONES) expect(ZONE_LABELS[z].length).toBeGreaterThan(0);
  });
});

describe('workshop swatches and rating', () => {
  it('splits a two-colour palette entry and slashes off / none', () => {
    const rayo = PALETTE.find((c) => c.accent)!;
    const bg = swatchBackground(rayo.id, rayo.hex);
    expect(bg).toContain(rayo.hex);
    expect(bg).toContain(rayo.accent!);
    expect(swatchBackground('red', '#d11a2a')).toBe('#d11a2a');
    expect(swatchBackground('off', null)).toBe('none');
    expect(swatchBackground('none', null)).toBe('none');
  });

  it('scales the meter so the stock car sits inside it', () => {
    const max = maxLoadoutRating();
    expect(max).toBeGreaterThanOrEqual(loadoutRating(STOCK_LOADOUT));
    expect(max).toBeGreaterThan(0);
  });
});
