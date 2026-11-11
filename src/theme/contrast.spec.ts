import {describe, expect, it} from 'vitest';
import {contrastRatio} from './oklch';
import {THEMES, THEME_NAMES} from './themes';

describe('theme contrast', () => {
  it('meets AA for body, buttons, and muted text', () => {
    for (const name of THEME_NAMES) {
      const t = THEMES[name];
      expect(contrastRatio(t.fg, t.bg), `${name} fg/bg`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(t.accentFg, t.accent), `${name} accent`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(t.fgMuted, t.bg), `${name} muted`).toBeGreaterThanOrEqual(3);
    }
  });
});
