/**
 * Seed-based theme generator.
 *
 * A SimpleThemeSeed (5 values) is all a user needs to specify.
 * generatePalette() derives a full ThemePalette (34+ tokens) from it.
 *
 * Color math is pure JS — no external deps.
 */

import type { ThemePalette } from './themes';

// ─── Types ───────────────────────────────────────────────────────────────────

export type SimpleThemeSeed = {
  /** Base page background */
  background: string;
  /** Primary text color */
  text: string;
  /** Accent / interactive color */
  accent: string;
  /** Border / divider color */
  border: string;
  /** Dark or light mode — affects fixed status colors and derivation direction */
  mode: 'dark' | 'light';
  /** Optional per-token overrides applied on top of the generated palette */
  overrides?: Partial<ThemePalette>;
};

export const DEFAULT_SEED: SimpleThemeSeed = {
  background: '#0f172a',
  text: '#f1f5f9',
  accent: '#60a5fa',
  border: '#334155',
  mode: 'dark',
};

// ─── Color Math Utilities ────────────────────────────────────────────────────

type RGB = { r: number; g: number; b: number };
type HSL = { h: number; s: number; l: number };

function hexToRgb(hex: string): RGB {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

function rgbToHex({ r, g, b }: RGB): string {
  return (
    '#' +
    [r, g, b]
      .map((v) =>
        Math.round(Math.max(0, Math.min(255, v)))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}

function rgbToHsl({ r, g, b }: RGB): HSL {
  const rn = r / 255,
    gn = g / 255,
    bn = b / 255;
  const max = Math.max(rn, gn, bn),
    min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return { h: h * 360, s, l };
}

function hslToRgb({ h, s, l }: HSL): RGB {
  const hn = h / 360;
  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue2rgb = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return {
    r: Math.round(hue2rgb(hn + 1 / 3) * 255),
    g: Math.round(hue2rgb(hn) * 255),
    b: Math.round(hue2rgb(hn - 1 / 3) * 255),
  };
}

function clampHsl(hsl: HSL): HSL {
  return {
    h: ((hsl.h % 360) + 360) % 360,
    s: Math.max(0, Math.min(1, hsl.s)),
    l: Math.max(0, Math.min(1, hsl.l)),
  };
}

/** Lighten a hex color by `amount` (0–1 lightness delta) */
export function lighten(hex: string, amount: number): string {
  const hsl = rgbToHsl(hexToRgb(hex));
  return rgbToHex(hslToRgb(clampHsl({ ...hsl, l: hsl.l + amount })));
}

/** Darken a hex color by `amount` (0–1 lightness delta) */
export function darken(hex: string, amount: number): string {
  const hsl = rgbToHsl(hexToRgb(hex));
  return rgbToHex(hslToRgb(clampHsl({ ...hsl, l: hsl.l - amount })));
}

/** Mix two hex colors. weight=0 → all color1, weight=1 → all color2 */
export function mix(hex1: string, hex2: string, weight: number): string {
  const c1 = hexToRgb(hex1),
    c2 = hexToRgb(hex2);
  return rgbToHex({
    r: Math.round(c1.r + (c2.r - c1.r) * weight),
    g: Math.round(c1.g + (c2.g - c1.g) * weight),
    b: Math.round(c1.b + (c2.b - c1.b) * weight),
  });
}

/** Return rgba() string for a hex + alpha */
export function withAlpha(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ─── Fixed Status Colors ─────────────────────────────────────────────────────

const STATUS_DARK = {
  success: '#86efac',
  successText: '#d1fae5',
  warning: '#fbbf24',
  danger: '#fca5a5',
  dangerStrong: '#ef4444',
  info: '#93c5fd',
  infoText: '#dbeafe',
  special: '#c4b5fd',
  highlightFg: '#fef08a',
  highlightCurrentFg: '#ffffff',
  diffAddText: '#aff5b4',
  diffDelText: '#ffdcd7',
  gitAdded: '#73c991',
  gitModified: '#e2c08d',
  gitDeleted: '#e06050',
  gitRenamed: '#4ec9b0',
  gitStagedModified: '#f0d6a0',
  gitStagedRenamed: '#5ee0c8',
};

const STATUS_LIGHT = {
  success: '#16a34a',
  successText: '#166534',
  warning: '#d97706',
  danger: '#dc2626',
  dangerStrong: '#b91c1c',
  info: '#2563eb',
  infoText: '#1e40af',
  special: '#7c3aed',
  highlightFg: '#713f12',
  highlightCurrentFg: '#ffffff',
  diffAddText: '#14532d',
  diffDelText: '#7f1d1d',
  gitAdded: '#2da44e',
  gitModified: '#b08800',
  gitDeleted: '#cf222e',
  gitRenamed: '#0969da',
  gitStagedModified: '#7d4e00',
  gitStagedRenamed: '#0550ae',
};

// ─── Generator ───────────────────────────────────────────────────────────────

export function generatePalette(seed: SimpleThemeSeed): ThemePalette {
  const { background: bg, text, accent, border, mode } = seed;
  const dark = mode === 'dark';
  const s = dark ? STATUS_DARK : STATUS_LIGHT;

  // Derive background scale
  const bgElevated = dark ? darken(bg, 0.04) : lighten(bg, 0.02);
  const bgSurface = dark ? lighten(bg, 0.04) : darken(bg, 0.02);
  const bgHover = dark ? lighten(bg, 0.08) : darken(bg, 0.05);

  // Derive text scale
  const textSecondary = mix(text, bg, 0.12);
  const textMuted = mix(text, bg, 0.4);
  const textSubtle = mix(text, bg, 0.58);

  // Derive border scale
  const borderSubtle = withAlpha(border, 0.5);
  const borderStrong = dark ? lighten(border, 0.08) : darken(border, 0.08);

  // Derive accent variants
  const accentStrong = dark ? darken(accent, 0.1) : darken(accent, 0.1);
  const accentSoft = withAlpha(accent, 0.45);

  // Diff colors derived from status
  const diffAddBg = withAlpha(s.success, dark ? 0.15 : 0.12);
  const diffAddBorder = withAlpha(s.success, 0.5);
  const diffDelBg = withAlpha(s.dangerStrong, dark ? 0.15 : 0.1);
  const diffDelBorder = withAlpha(s.dangerStrong, 0.5);
  const diffHunkBg = withAlpha(accent, 0.15);
  const diffHunkBorder = withAlpha(accent, 0.5);
  const diffHeaderBg = withAlpha(border, 0.2);
  const diffHeaderBorder = withAlpha(border, 0.55);

  const palette: ThemePalette = {
    'bg-base': bg,
    'bg-elevated': bgElevated,
    'bg-surface': bgSurface,
    'bg-overlay': withAlpha(bg, 0.92),
    'bg-hover': bgHover,
    'bg-selected': withAlpha(accent, 0.2),

    'text-primary': text,
    'text-secondary': textSecondary,
    'text-muted': textMuted,
    'text-subtle': textSubtle,
    'text-inverse': dark ? '#ffffff' : '#000000',

    border,
    'border-subtle': borderSubtle,
    'border-strong': borderStrong,

    accent,
    'accent-strong': accentStrong,
    'accent-soft': accentSoft,
    success: s.success,
    warning: s.warning,
    danger: s.danger,
    'danger-strong': s.dangerStrong,
    info: s.info,
    special: s.special,

    'scrollbar-thumb': dark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.18)',

    'highlight-bg': withAlpha(s.warning, dark ? 0.35 : 0.45),
    'highlight-fg': s.highlightFg,
    'highlight-current-bg': withAlpha(accent, 0.55),
    'highlight-current-fg': s.highlightCurrentFg,

    'diff-add-bg': diffAddBg,
    'diff-add-text': s.diffAddText,
    'diff-add-border': diffAddBorder,
    'diff-del-bg': diffDelBg,
    'diff-del-text': s.diffDelText,
    'diff-del-border': diffDelBorder,
    'diff-hunk-bg': diffHunkBg,
    'diff-hunk-border': diffHunkBorder,
    'diff-header-bg': diffHeaderBg,
    'diff-header-border': diffHeaderBorder,

    'success-text': s.successText,
    'info-text': s.infoText,
  };

  // Apply any per-token overrides the user has set
  if (seed.overrides) {
    Object.assign(palette, seed.overrides);
  }

  return palette;
}
