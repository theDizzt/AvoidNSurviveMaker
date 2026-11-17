import type { LayoutElement, LevelButtonStyle, ScreenLayout, ThemeScreens } from '../core/screen-layout';
import { DEFAULT_BUTTON } from '../core/screen-layout';

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
  ({ id: id('back'), kind: 'back', x, y, w, h, text: 'BACK', ...o });
const start = (x: number, y: number, o: Partial<LayoutElement> = {}): LayoutElement =>
  ({ id: id('start'), kind: 'start', x, y, w: 64, h: 64, text: '√', size: 40, ...o });
const stars = (x: number, y: number, w: number, h: number, o: Partial<LayoutElement> = {}): LayoutElement =>
  ({ id: id('s'), kind: 'stars', x, y, w, h, source: 'difficulty', count: 5, ...o });

/** Credits column on the left of the level select */
const credits = (color: string, font = 'condensed'): LayoutElement[] => [
  text(40, 300, 240, 50, 'CREDITS', { font: 'heavy', size: 30, color }),
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
    name: 'Factory (LCD panels)',
    make: () => ({
      select: {
        background: { color: '#1b2140', color2: '#0b0e1c' },
        elements: [
          text(30, 20, 520, 50, '{author}', { font: 'hand', size: 36, color: '#ff5a5a', glow: '#ff2a2a', align: 'left' }),
          text(20, 60, 640, 100, '{theme}', { font: 'heavy', size: 74, color: '#ffe600', stroke: '#e2361f', italic: true, align: 'left', shadow: true }),
          text(660, 40, 600, 100, 'ALL COMPLETE', { font: 'title', size: 64, color: '#fff7a8', glow: '#ffd400', when: 'allComplete' }),
          text(20, 150, 1240, 120, '{description}', { font: 'heavy', size: 19, color: '#ffffff', align: 'left' }),
          ...credits('#ffffff'),
          grid(300, 285, 900, 370, { shape: 'rounded', fill: '#0a7a10', border: '#1c56b8', borderWidth: 5, font: 'digital', numberSize: 46, numberColor: '#5dff4d', numberGlow: '#2bff2b', showStars: false }),
          back(40, 600, 140, 60, { font: 'digital', size: 44, color: '#5dff4d', glow: '#2bff2b' }),
        ],
      },
      intro: {
        background: { color: '#8a8f97', color2: '#4d5158' },
        elements: [
          box(0, 286, 1280, 26, { fill: '#d01919' }),
          box(990, 0, 26, 720, { fill: '#d01919' }),
          box(460, 238, 300, 116, { fill: '#2a2d33', radius: 18 }),
          box(484, 254, 252, 84, { fill: '#118a1e', radius: 12, border: '#0b0d10', borderWidth: 3 }),
          text(484, 254, 252, 84, '{nn}', { font: 'digital', size: 70, color: '#5dff4d', glow: '#2bff2b' }),
          box(366, 372, 396, 116, { fill: '#2a2d33', radius: 18 }),
          box(388, 388, 352, 84, { fill: '#118a1e', radius: 12, border: '#0b0d10', borderWidth: 3 }),
          text(388, 388, 352, 84, '{title}', { font: 'digital', size: 34, color: '#5dff4d', glow: '#2bff2b' }),
          text(110, 20, 200, 50, '{difficultyLabel}', { font: 'hand', size: 34, color: '#1d1d1d', rotate: -12 }),
          stars(130, 60, 230, 50, { onColor: '#ff9a2e', offColor: '#c9ccd2' }),
          start(122, 312, { fill: '#ffffff', border: '#e0161b', borderWidth: 6, color: '#e0161b', font: 'serif' }),
        ],
      },
    }),
  },
  {
    id: 'wood',
    name: 'Workshop (wood slices)',
    make: () => ({
      select: {
        background: { color: '#d39b5f', color2: '#a86c34' },
        elements: [
          box(30, 40, 470, 150, { fill: '#f1d6a6', border: '#5a3a1a', borderWidth: 4, radius: 14, rotate: -4 }),
          text(30, 40, 470, 150, '{theme}', { font: 'heavy', size: 48, color: '#2a1a0c', rotate: -4 }),
          text(90, 190, 360, 80, 'ALL COMPLETE!', { font: 'hand', size: 50, color: '#1d1209', rotate: -6, when: 'allComplete' }),
          text(540, 40, 700, 230, '{description}', { font: 'hand', size: 26, color: '#1d1209', align: 'left' }),
          box(20, 285, 270, 300, { fill: '#00000066', radius: 8 }),
          ...credits('#ffffff'),
          grid(300, 290, 900, 380, { shape: 'circle', fill: '#f3dfbd', fill2: '#ead2a8', border: '#2a1a0c', borderWidth: 8, font: 'hand', numberSize: 38, numberColor: '#1d1209' }),
          back(40, 600, 140, 60, { font: 'hand', size: 42, color: '#1d1209' }),
        ],
      },
      intro: {
        background: { color: '#5d5d5f', color2: '#2f2f31' },
        elements: [
          box(340, 70, 600, 600, { fill: '#e0a050', border: '#7a4a1c', borderWidth: 18, radius: 300 }),
          box(560, 290, 160, 160, { fill: '#c97a34', border: '#9a5a20', borderWidth: 6, radius: 80 }),
          text(640, 150, 300, 70, 'Level {nn}', { font: 'hand', size: 50, color: '#1d1209', rotate: 35 }),
          text(380, 450, 360, 70, '{title}', { font: 'hand', size: 50, color: '#1d1209', rotate: 35 }),
          text(560, 250, 200, 40, '{difficultyLabel}', { font: 'hand', size: 30, color: '#1d1209' }),
          stars(580, 300, 220, 40, { onColor: '#ff9a2e', offColor: '#9aa0a8' }),
          start(102, 314, { fill: '#ffffff', border: '#8a4a12', borderWidth: 6, color: '#8a4a12', font: 'serif' }),
        ],
      },
    }),
  },
  {
    id: 'botanical',
    name: 'Botanical (leaves and a book)',
    make: () => ({
      select: {
        background: { color: '#1f4a24', color2: '#0b2410' },
        elements: [
          text(30, 30, 380, 110, '{theme}', { font: 'blackletter', size: 64, color: '#8be05a', stroke: '#1d5a1d', shadow: true }),
          text(20, 160, 380, 100, 'ALL COMPLETE!', { font: 'blackletter', size: 54, color: '#ffffff', stroke: '#3a3a3a', when: 'allComplete' }),
          text(420, 20, 820, 260, '{description}', { font: 'heavy', size: 22, color: '#ffffff', align: 'left' }),
          ...credits('#ffffff'),
          grid(300, 290, 920, 380, { shape: 'leaf', fill: '#5fd13a', border: '#2a7a1a', borderWidth: 3, font: 'serif', numberSize: 48, numberColor: '#ffffff', numberGlow: '#1b1b1b', showStars: false }),
          back(20, 590, 180, 80, { font: 'blackletter', size: 54, color: '#ffffff', stroke: '#3a3a3a' }),
        ],
      },
      intro: {
        background: { color: '#1f4a24', color2: '#0b2410' },
        elements: [
          box(200, 100, 840, 480, { fill: '#7a4a1c', radius: 10 }),
          box(214, 108, 404, 460, { fill: '#e9cf9a', radius: 6 }),
          box(622, 108, 404, 460, { fill: '#e9cf9a', radius: 6 }),
          text(214, 130, 404, 50, '#{nn}', { font: 'serif', size: 40, color: '#4a3326' }),
          text(214, 175, 404, 80, '{title}', { font: 'serif', size: 64, color: '#4a3326', bold: true }),
          stars(234, 510, 200, 40, { onColor: '#4a3326', offColor: '#bba684' }),
          text(640, 270, 370, 160, '{description}', { font: 'serif', size: 20, color: '#4a3326', italic: true }),
          start(132, 532, { fill: '#18c218', border: '#0c7a0c', borderWidth: 6, color: '#ffffff', font: 'serif' }),
        ],
      },
    }),
  },
  {
    id: 'gadgets',
    name: 'Gadgets (gauge and ribbon)',
    make: () => ({
      select: {
        background: { color: '#7a5418', color2: '#3a2408' },
        elements: [
          text(40, 20, 420, 50, "{author}'s", { font: 'condensed', size: 30, color: '#f5f0e6', align: 'left' }),
          text(40, 60, 420, 110, '{theme}', { font: 'blackletter', size: 84, color: '#f5f0e6', align: 'left', shadow: true }),
          text(40, 180, 420, 70, 'WELL DONE', { font: 'heavy', size: 48, color: '#ffffff', glow: '#ffd27a', italic: true, align: 'left', when: 'allComplete' }),
          grid(300, 285, 920, 380, { shape: 'drop', fill: '#6b3a0f', fill2: '#8a6512', border: '#ffffff', borderWidth: 4, font: 'serif', numberSize: 40, numberColor: '#ffffff', showStars: false }),
          back(30, 610, 230, 50, { fill: '#5a3410', border: '#1b0f05', borderWidth: 5, radius: 25, font: 'serif', size: 28, color: '#ffffff', italic: true, bold: true }),
        ],
      },
      intro: {
        background: { color: '#5a3c12', color2: '#2a1a06' },
        elements: [
          box(360, 70, 560, 560, { fill: '#ffffff', border: '#d4a017', borderWidth: 26, radius: 280 }),
          box(540, 260, 200, 200, { fill: '#3a3a3a', radius: 100 }),
          box(0, 420, 1280, 140, { fill: '#e8a700' }),
          box(180, 355, 920, 150, { fill: '#ffc000', border: '#111111', borderWidth: 6 }),
          box(500, 370, 280, 46, { fill: '#5a3410', border: '#111111', borderWidth: 4, radius: 23 }),
          text(500, 370, 280, 46, 'Gadget {nn}', { font: 'serif', size: 28, color: '#ffffff', italic: true, bold: true }),
          text(180, 410, 920, 90, '{title}', { font: 'serif', size: 76, color: '#111111', italic: true, bold: true }),
          box(1050, 0, 150, 220, { fill: '#c5f7a0', border: '#111111', borderWidth: 4 }),
          text(1050, 10, 150, 50, '{difficultyLabel}', { font: 'heavy', size: 28, color: '#111111' }),
          stars(1060, 60, 130, 40, { onColor: '#111111', offColor: '#ffffff' }),
          start(102, 162, { fill: '#111111', border: '#ffc000', borderWidth: 6, color: '#ffc000', font: 'serif' }),
        ],
      },
    }),
  },
  {
    id: 'jazz',
    name: 'Night club (diamonds)',
    make: () => ({
      select: {
        background: { color: '#6e0b10', color2: '#200406' },
        elements: [
          text(30, 30, 420, 110, '{theme}', { font: 'serif', size: 60, color: '#ffffff', italic: true, shadow: true }),
          grid(290, 285, 920, 380, { shape: 'diamond', fill: '#00000000', clearedFill: '#111111', border: '#ffffff', borderWidth: 4, font: 'heavy', numberSize: 30, numberColor: '#ffffff', showStars: false }),
          back(40, 610, 140, 60, { font: 'heavy', size: 34, color: '#ffffff' }),
        ],
      },
      intro: {
        background: { color: '#f08a6a', color2: '#7a4ae0' },
        elements: [
          text(340, 60, 600, 50, 'TRACK NO. {n}', { font: 'hand', size: 36, color: '#ffffff', glow: '#ffffff' }),
          text(240, 110, 800, 130, '{title}', { font: 'hand', size: 100, color: '#ffffff', glow: '#ffd6e8', bold: true }),
          box(440, 330, 400, 320, { fill: '#1b1b1d', radius: 200 }),
          box(590, 440, 100, 100, { fill: '#22d3dc', radius: 50 }),
          start(70, 512, { fill: '#ffffff', border: '#111111', borderWidth: 6, color: '#111111', font: 'serif' }),
        ],
      },
    }),
  },
  {
    id: 'lab',
    name: 'Laboratory (white cards)',
    make: () => ({
      select: {
        background: { color: '#0b0b0b' },
        elements: [
          box(0, 0, 580, 720, { fill: '#1c1c1c' }),
          box(30, 20, 420, 140, { fill: '#00000000', border: '#8a8a8a', borderWidth: 6 }),
          text(150, 30, 420, 50, '{author}', { font: 'condensed', size: 34, color: '#9a9a9a', bold: true, align: 'left' }),
          text(150, 70, 420, 70, '{theme}', { font: 'condensed', size: 56, color: '#9a9a9a', bold: true, align: 'left' }),
          text(60, 160, 300, 40, 'ALL COMPLETE!', { font: 'condensed', size: 24, color: '#9a9a9a', bold: true, align: 'left', when: 'allComplete' }),
          grid(300, 295, 920, 380, { shape: 'diamond', fill: '#ffffff', border: '#ffffff', borderWidth: 0, font: 'condensed', numberSize: 40, numberColor: '#111111', showStars: false }),
          back(40, 600, 140, 60, { font: 'condensed', size: 44, color: '#ffffff', bold: true }),
        ],
      },
      intro: {
        background: { color: '#000000' },
        elements: [
          box(860, 70, 310, 570, { fill: '#ffffff', rotate: -2, radius: 4 }),
          text(880, 90, 270, 200, '{nn}', { font: 'condensed', size: 190, color: '#111111', bold: true, rotate: -2 }),
          text(900, 330, 240, 36, '{nn}/{total}', { font: 'condensed', size: 26, color: '#111111', bold: true, align: 'left', rotate: -2 }),
          { id: id('p'), kind: 'progress', x: 900, y: 370, w: 240, h: 30, rotate: -2, onColor: '#111111', offColor: '#e8e8e8' },
          text(900, 440, 240, 40, '{title}', { font: 'condensed', size: 30, color: '#111111', bold: true, align: 'left', rotate: -2 }),
          stars(900, 486, 200, 40, { onColor: '#111111', offColor: '#e3e3e3', rotate: -2 }),
          text(890, 590, 200, 30, '{theme}', { font: 'condensed', size: 18, color: '#111111', align: 'left', rotate: -2 }),
          start(170, 230, { fill: '#000000', border: '#cfcfcf', borderWidth: 6, color: '#ffffff', font: 'serif' }),
        ],
      },
    }),
  },
  {
    id: 'simple',
    name: 'Simple (clean cards)',
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
      intro: {
        background: { color: '#eef5fc', color2: '#d7e6f8' },
        elements: [
          box(340, 160, 600, 400, { fill: '#ffffff', radius: 28 }),
          text(340, 190, 600, 60, 'LEVEL {nn}', { font: 'title', size: 40, color: '#3a9ff0' }),
          text(340, 260, 600, 90, '{title}', { font: 'title', size: 60, color: '#243450' }),
          text(340, 360, 600, 40, '◆ {difficulty} · {difficultyLabel} · best {best}', { font: 'main', size: 22, color: '#465877' }),
          stars(490, 410, 300, 50, { source: 'earned', count: 3, onColor: '#ffc83d', offColor: '#dfe5ee' }),
          start(608, 480, { fill: '#3a9ff0', border: '#ffffff', borderWidth: 4, radius: 32, color: '#ffffff', font: 'title', text: '▶', size: 34 }),
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
