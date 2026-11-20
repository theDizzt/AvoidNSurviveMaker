import { t as tr } from './i18n';
import type { LayoutElement, LevelButtonStyle, ScreenLayout, ThemeScreens } from './localized/screen-layout';
import { DEFAULT_BUTTON } from './localized/screen-layout';

/**
 * Starting layouts for custom screens, drawn only with shapes and built-in fonts: swap in your own
 * background, logo and button pictures in the theme editor.
 */

let seq = 0;
const id = (k: string) => `${k}${++seq}`;

const text = (x: number, y: number, w: number, h: number, t: string, o: Partial<LayoutElement> = {}): LayoutElement =>
  ({ id: id('t'), kind: 'text', x, y, w, h, text: t, ...o });
const box = (x: number, y: number, w: number, h: number, o: Partial<LayoutElement> = {}): LayoutElement =>
  ({ id: id('b'), kind: 'box', x, y, w, h, ...o });
const grid = (x: number, y: number, w: number, h: number, button: Partial<LevelButtonStyle>, gap = 18): LayoutElement =>
  ({ id: id('g'), kind: 'levelGrid', x, y, w, h, cols: 7, rows: 3, gap, button: { ...DEFAULT_BUTTON, ...button } });
const back = (x: number, y: number, w: number, h: number, o: Partial<LayoutElement> = {}): LayoutElement =>
  ({ id: id('back'), kind: 'back', x, y, w, h, text: tr('template.back'), ...o });
const start = (x: number, y: number, o: Partial<LayoutElement> = {}): LayoutElement =>
  ({ id: id('start'), kind: 'start', x, y, w: 64, h: 64, text: '√', size: 40, ...o });
const stars = (x: number, y: number, w: number, h: number, o: Partial<LayoutElement> = {}): LayoutElement =>
  ({ id: id('s'), kind: 'stars', x, y, w, h, source: 'difficulty', count: 5, ...o });

/** Credits column on the left of the level select */
const credits = (color: string, font = 'condensed'): LayoutElement[] => [
  text(40, 300, 240, 50, tr('template.credits'), { font: 'heavy', size: 30, color }),
  text(30, 350, 260, 220, '{credits}', { font, size: 20, color }),
];

export interface ScreenTemplate {
  id: string;
  name: string;
  make: () => ThemeScreens;
}

export const SCREEN_TEMPLATES: ScreenTemplate[] = [
  {
    id: 'factory',
    name: tr('template.factory'),
    make: () => ({
      select: {
        background: { color: '#1b2140', color2: '#0b0e1c' },
        elements: [
          text(30, 20, 520, 50, '{author}', { font: 'hand', size: 36, color: '#ff5a5a', glow: '#ff2a2a', align: 'left' }),
          text(20, 60, 640, 100, '{theme}', { font: 'heavy', size: 74, color: '#ffe600', stroke: '#e2361f', italic: true, align: 'left', shadow: true }),
          text(660, 40, 600, 100, tr('template.allComplete'), { font: 'title', size: 64, color: '#fff7a8', glow: '#ffd400', when: 'allComplete' }),
          text(20, 150, 1240, 120, '{description}', { font: 'heavy', size: 19, color: '#ffffff', align: 'left' }),
          ...credits('#ffffff'),
          grid(300, 285, 900, 370, { shape: 'rounded', fill: '#0a7a10', border: '#1c56b8', borderWidth: 5, font: 'digital', numberSize: 46, numberColor: '#5dff4d', numberGlow: '#2bff2b', showStars: false }),
          back(40, 600, 140, 60, { font: 'digital', size: 44, color: '#5dff4d', glow: '#2bff2b' }),
        ],
      },
    }),
  },
  {
    id: 'wood',
    name: tr('template.workshop'),
    make: () => ({
      select: {
        background: { color: '#d39b5f', color2: '#a86c34' },
        elements: [
          box(30, 40, 470, 150, { fill: '#f1d6a6', border: '#5a3a1a', borderWidth: 4, radius: 14, rotate: -4 }),
          text(30, 40, 470, 150, '{theme}', { font: 'heavy', size: 48, color: '#2a1a0c', rotate: -4 }),
          text(90, 190, 360, 80, tr('template.allCompleteBang'), { font: 'hand', size: 50, color: '#1d1209', rotate: -6, when: 'allComplete' }),
          text(540, 40, 700, 230, '{description}', { font: 'hand', size: 26, color: '#1d1209', align: 'left' }),
          box(20, 285, 270, 300, { fill: '#00000066', radius: 8 }),
          ...credits('#ffffff'),
          grid(300, 290, 900, 380, { shape: 'circle', fill: '#f3dfbd', fill2: '#ead2a8', border: '#2a1a0c', borderWidth: 8, font: 'hand', numberSize: 38, numberColor: '#1d1209' }),
          back(40, 600, 140, 60, { font: 'hand', size: 42, color: '#1d1209' }),
        ],
      },
    }),
  },
  {
    id: 'botanical',
    name: tr('template.botanical'),
    make: () => ({
      select: {
        background: { color: '#1f4a24', color2: '#0b2410' },
        elements: [
          text(30, 30, 380, 110, '{theme}', { font: 'blackletter', size: 64, color: '#8be05a', stroke: '#1d5a1d', shadow: true }),
          text(20, 160, 380, 100, tr('template.allCompleteBang'), { font: 'blackletter', size: 54, color: '#ffffff', stroke: '#3a3a3a', when: 'allComplete' }),
          text(420, 20, 820, 260, '{description}', { font: 'heavy', size: 22, color: '#ffffff', align: 'left' }),
          ...credits('#ffffff'),
          grid(300, 290, 920, 380, { shape: 'leaf', fill: '#5fd13a', border: '#2a7a1a', borderWidth: 3, font: 'serif', numberSize: 48, numberColor: '#ffffff', numberGlow: '#1b1b1b', showStars: false }),
          back(20, 590, 180, 80, { font: 'blackletter', size: 54, color: '#ffffff', stroke: '#3a3a3a' }),
        ],
      },
    }),
  },
  {
    id: 'gadgets',
    name: tr('template.gadgets'),
    make: () => ({
      select: {
        background: { color: '#7a5418', color2: '#3a2408' },
        elements: [
          text(40, 20, 420, 50, tr('template.authors'), { font: 'condensed', size: 30, color: '#f5f0e6', align: 'left' }),
          text(40, 60, 420, 110, '{theme}', { font: 'blackletter', size: 84, color: '#f5f0e6', align: 'left', shadow: true }),
          text(40, 180, 420, 70, tr('template.wellDone'), { font: 'heavy', size: 48, color: '#ffffff', glow: '#ffd27a', italic: true, align: 'left', when: 'allComplete' }),
          grid(300, 285, 920, 380, { shape: 'drop', fill: '#6b3a0f', fill2: '#8a6512', border: '#ffffff', borderWidth: 4, font: 'serif', numberSize: 40, numberColor: '#ffffff', showStars: false }),
          back(30, 610, 230, 50, { fill: '#5a3410', border: '#1b0f05', borderWidth: 5, radius: 25, font: 'serif', size: 28, color: '#ffffff', italic: true, bold: true }),
        ],
      },
    }),
  },
  {
    id: 'jazz',
    name: tr('template.nightClub'),
    make: () => ({
      select: {
        background: { color: '#6e0b10', color2: '#200406' },
        elements: [
          text(30, 30, 420, 110, '{theme}', { font: 'serif', size: 60, color: '#ffffff', italic: true, shadow: true }),
          grid(290, 285, 920, 380, { shape: 'diamond', fill: '#00000000', clearedFill: '#111111', border: '#ffffff', borderWidth: 4, font: 'heavy', numberSize: 30, numberColor: '#ffffff', showStars: false }),
          back(40, 610, 140, 60, { font: 'heavy', size: 34, color: '#ffffff' }),
        ],
      },
    }),
  },
  {
    id: 'lab',
    name: tr('template.laboratory'),
    make: () => ({
      select: {
        background: { color: '#0b0b0b' },
        elements: [
          box(0, 0, 580, 720, { fill: '#1c1c1c' }),
          box(30, 20, 420, 140, { fill: '#00000000', border: '#8a8a8a', borderWidth: 6 }),
          text(150, 30, 420, 50, '{author}', { font: 'condensed', size: 34, color: '#9a9a9a', bold: true, align: 'left' }),
          text(150, 70, 420, 70, '{theme}', { font: 'condensed', size: 56, color: '#9a9a9a', bold: true, align: 'left' }),
          text(60, 160, 300, 40, tr('template.allCompleteBang'), { font: 'condensed', size: 24, color: '#9a9a9a', bold: true, align: 'left', when: 'allComplete' }),
          grid(300, 295, 920, 380, { shape: 'diamond', fill: '#ffffff', border: '#ffffff', borderWidth: 0, font: 'condensed', numberSize: 40, numberColor: '#111111', showStars: false }),
          back(40, 600, 140, 60, { font: 'condensed', size: 44, color: '#ffffff', bold: true }),
        ],
      },
    }),
  },
  {
    id: 'simple',
    name: tr('template.simple'),
    make: () => ({
      select: {
        background: { color: '#eef5fc', color2: '#d7e6f8' },
        elements: [
          text(40, 30, 760, 80, '{theme}', { font: 'title', size: 56, color: '#243450', align: 'left' }),
          text(40, 110, 900, 120, '{description}', { font: 'main', size: 22, color: '#465877', align: 'left' }),
          text(900, 40, 340, 60, '★ {stars} / {maxStars}', { font: 'title', size: 34, color: '#d48f00', align: 'right' }),
          grid(80, 260, 1120, 380, { shape: 'rounded', fill: '#ffffff', clearedFill: '#d6ecff', border: '#3a9ff0', borderWidth: 3, font: 'title', numberSize: 36, numberColor: '#243450', showDifficulty: true }),
          back(40, 650, 140, 50, { fill: '#ffffff', border: '#3a9ff0', borderWidth: 2, radius: 25, font: 'title', size: 24, color: '#243450' }),
        ],
      },
    }),
  },
];

export function emptyLayout(): ScreenLayout {
  return { background: { color: '#1d2027' }, elements: [] };
}

/** A fresh element of a kind, placed in the middle of the stage */
export function newElement(kind: LayoutElement['kind']): LayoutElement {
  switch (kind) {
    case 'text': return text(440, 320, 400, 80, 'Text {theme}', { size: 40, color: '#ffffff' });
    case 'image': return { id: id('i'), kind: 'image', x: 490, y: 210, w: 300, h: 300 };
    case 'box': return box(490, 260, 300, 200, { fill: '#ffffffcc', radius: 16 });
    case 'levelGrid': return grid(180, 200, 920, 380, {});
    case 'back': return back(40, 640, 140, 60, { size: 34, color: '#ffffff' });
    case 'start': return start(608, 600, { fill: '#ffffff', border: '#111111', borderWidth: 6, color: '#111111', font: 'serif' });
    case 'stars': return stars(490, 340, 300, 50, { onColor: '#ff9a2e', offColor: '#b9bec7' });
    case 'progress': return { id: id('p'), kind: 'progress', x: 440, y: 340, w: 400, h: 30, onColor: '#111111', offColor: '#e5e5e5' };
  }
}
