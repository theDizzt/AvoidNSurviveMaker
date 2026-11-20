import { t as defaultTranslate, type Translator } from './i18n';
import type { Fill, Theme } from './types';

/** Independent localized API; no process-wide locale or browser dependencies. */
export function createThemeApi(t: Translator = defaultTranslate) {



  /** Starting point when a map with the default look is customized */
  const BASE_THEME: Theme = {
    wall: { fill: { type: 'solid', color: '#56667d' }, edge: '#7f93ad' },
    path: { fill: { type: 'solid', color: '#253246' }, edge: '#4d6382' },
  };

  const THEME_PRESETS: { id: string; name: string; theme: Theme | undefined }[] = [
    { id: 'default', name: t('themePreset.default'), theme: undefined },
    {
      id: 'neon',
      name: t('themePreset.neon'),
      theme: {
        wall: { fill: { type: 'gradient', style: 'linear', from: '#ff2bd6', to: '#7a2bff', angle: 45 }, edge: '#ffc2f3' },
        path: { fill: { type: 'pattern', pattern: 'grid', color: '#1f4a6e', background: '#0b1a2a', size: 16 }, edge: '#3ad7ff' },
      },
    },
    {
      id: 'lava',
      name: t('themePreset.lava'),
      theme: {
        wall: { fill: { type: 'gradient', style: 'radial', from: '#ffb000', to: '#e0002b', angle: 0 }, edge: '#ffd29a' },
        path: { fill: { type: 'pattern', pattern: 'diagonal', color: '#3d2a20', background: '#2e1f18', size: 14 }, edge: '#9a6440' },
      },
    },
    {
      id: 'forest',
      name: t('themePreset.forest'),
      theme: {
        wall: { fill: { type: 'pattern', pattern: 'diagonal', color: '#3f7a4b', background: '#244a2d', size: 12 }, edge: '#8fd694' },
        path: { fill: { type: 'gradient', style: 'linear', from: '#4a3b28', to: '#2f2619', angle: 90 }, edge: '#9b8460' },
      },
    },
    {
      id: 'candy',
      name: t('themePreset.candy'),
      theme: {
        wall: { fill: { type: 'pattern', pattern: 'stripes', color: '#ff6fae', background: '#ffd1e6', size: 14 }, edge: '#ffffff' },
        path: { fill: { type: 'pattern', pattern: 'dots', color: '#bfe2ff', background: '#7fb6e6', size: 14 }, edge: '#ffffff' },
      },
    },
    {
      id: 'mono',
      name: t('themePreset.mono'),
      theme: {
        wall: { fill: { type: 'solid', color: '#e8e8e8' }, edge: '#ffffff' },
        path: { fill: { type: 'pattern', pattern: 'checker', color: '#2b2b2b', background: '#1e1e1e', size: 20 }, edge: '#6a6a6a' },
      },
    },
  ];

  /** The color that best represents a fill (used when switching fill types) */
  function primaryColor(f: Fill): string {
    return f.type === 'solid' ? f.color : f.type === 'gradient' ? f.from : f.color;
  }

  /** A second color for gradients / pattern backgrounds */
  function secondaryColor(f: Fill): string {
    if (f.type === 'gradient') return f.to;
    if (f.type === 'pattern') return f.background;
    return shade(f.color, -0.35);
  }

  /** Lighten (amount > 0) or darken (amount < 0) a #rrggbb color */
  function shade(hex: string, amount: number): string {
    const n = parseInt(hex.slice(1), 16);
    const ch = (v: number) => {
      const out = amount >= 0 ? v + (255 - v) * amount : v * (1 + amount);
      return Math.round(Math.max(0, Math.min(255, out))).toString(16).padStart(2, '0');
    };
    return `#${ch((n >> 16) & 255)}${ch((n >> 8) & 255)}${ch(n & 255)}`;
  }
  return { BASE_THEME, THEME_PRESETS, primaryColor, secondaryColor, shade };
}

export const { BASE_THEME, THEME_PRESETS, primaryColor, secondaryColor, shade } = createThemeApi();
