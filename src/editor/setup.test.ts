import { describe, expect, it } from 'vitest';
import { baseKeymap, formatKeymap } from './setup';

describe('keymap', () => {
  it('has no Mod-/ comment toggle, so Ctrl+Shift+7 (Ctrl+/ on Nordic keyboards) makes a list', () => {
    expect(baseKeymap.some((b) => b.key === 'Mod-/')).toBe(false);
    expect(formatKeymap.some((b) => b.key === 'Mod-Shift-7')).toBe(true);
  });
});
