import { describe, expect, it } from 'vitest';
import { DEFAULT_SEED, darken, generatePalette, lighten, mix, withAlpha } from './themeGenerator';

const COLOR_RE = /^(#[0-9a-f]{6}|rgba?\(.+\))$/i;

describe('colour math', () => {
  it('mixes with weight 0 and 1 returning the endpoints', () => {
    expect(mix('#000000', '#ffffff', 0).toLowerCase()).toBe('#000000');
    expect(mix('#000000', '#ffffff', 1).toLowerCase()).toBe('#ffffff');
    expect(mix('#000000', '#ffffff', 0.5).toLowerCase()).toBe('#808080');
  });
  it('lightens and darkens by lightness delta', () => {
    expect(lighten('#000000', 0.5).toLowerCase()).toBe('#808080');
    expect(darken('#ffffff', 0.5).toLowerCase()).toBe('#808080');
    expect(lighten('#ffffff', 0.5).toLowerCase()).toBe('#ffffff');
  });
  it('produces rgba strings', () => {
    expect(withAlpha('#ff0000', 0.5)).toBe('rgba(255, 0, 0, 0.5)');
  });
});

describe('generatePalette', () => {
  it('fills every token with a colour string', () => {
    const palette = generatePalette(DEFAULT_SEED);
    const keys = Object.keys(palette);
    expect(keys).toEqual(
      expect.arrayContaining(['bg-base', 'bg-surface', 'text-primary', 'accent']),
    );
    for (const key of keys) {
      expect(palette[key as keyof typeof palette], key).toMatch(COLOR_RE);
    }
  });
  it('honours overrides', () => {
    const palette = generatePalette({ ...DEFAULT_SEED, overrides: { 'bg-base': '#123456' } });
    expect(palette['bg-base']).toBe('#123456');
  });
});
