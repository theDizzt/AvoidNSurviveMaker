/**
 * Custom screens of a theme (level select, level intro), laid out like a slide: a background and
 * freely placed elements on a 1280×720 stage. The game scales the stage to the window.
 *
 * Text can use placeholders (see SCREEN_PLACEHOLDERS), so one layout works for every level.
 */
export const STAGE_W = 1280;
export const STAGE_H = 720;

/** Built-in font choices; a theme can also bundle its own font files (ThemeFont) */
export const BUILTIN_FONTS = ['title', 'main', 'serif', 'heavy', 'condensed', 'digital', 'hand', 'blackletter', 'mono'] as const;
export type BuiltinFont = (typeof BUILTIN_FONTS)[number];

/** A font file in the pack (e.g. fonts/lcd.ttf), usable by `family` */
export interface ThemeFont {
  family: string;
  file: string;
}

export interface ScreenBackground {
  color: string;
  /** Second color: a top-to-bottom gradient when set */
  color2?: string;
  /** Image file name in the pack */
  image?: string;
  fit?: 'cover' | 'contain' | 'tile';
  /** Darken the image, 0–0.9 */
  dim?: number;
}

export type ElementKind = 'text' | 'image' | 'box' | 'levelGrid' | 'back' | 'start' | 'stars' | 'progress';

/** When an element shows: on every visit, only once every level is cleared, etc. */
export type Visibility = 'always' | 'allComplete' | 'notComplete' | 'cleared' | 'notCleared';

/** Shape of the level buttons in a level grid */
export type ButtonShape = 'rounded' | 'square' | 'circle' | 'diamond' | 'drop' | 'leaf' | 'none';

export interface LevelButtonStyle {
  shape: ButtonShape;
  fill: string;
  /** Every other button uses this fill (like alternating tiles) */
  fill2?: string;
  /** Fill of cleared levels */
  clearedFill?: string;
  border: string;
  borderWidth: number;
  /** Picture used as the button (file name); replaces the shape */
  image?: string;
  font: string;
  numberSize: number;
  numberColor: string;
  /** Glow around the number (e.g. LCD digits) */
  numberGlow?: string;
  /** Zero-pad: 2 → "01" */
  pad: number;
  /** Earned stars under the number */
  showStars: boolean;
  /** Difficulty under the number */
  showDifficulty: boolean;
}

export interface LayoutElement {
  id: string;
  kind: ElementKind;
  /** Top-left corner and size on the 1280×720 stage */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Degrees */
  rotate?: number;
  opacity?: number;
  when?: Visibility;

  // Text (also the label of back / start buttons)
  text?: string;
  font?: string;
  size?: number;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  align?: 'left' | 'center' | 'right';
  /** Outline color around letters */
  stroke?: string;
  /** Neon-like glow color */
  glow?: string;
  /** Drop shadow */
  shadow?: boolean;

  // Box (also the frame of back / start buttons)
  fill?: string;
  border?: string;
  borderWidth?: number;
  radius?: number;

  // Image
  src?: string;

  // Level grid
  cols?: number;
  rows?: number;
  gap?: number;
  button?: LevelButtonStyle;

  // Stars / progress
  /** stars: earned (0–3) or difficulty (1–10 shown as 0–5 stars) */
  source?: 'earned' | 'difficulty';
  count?: number;
  onColor?: string;
  offColor?: string;
}

export interface ScreenLayout {
  background: ScreenBackground;
  elements: LayoutElement[];
}

export interface ThemeScreens {
  /** Replaces the default diamond level select */
  select?: ScreenLayout;
  /** Shown before each level; the start (√) button begins the run */
  intro?: ScreenLayout;
}

/** Placeholders usable in text (shown in the editor's help) */
export const SCREEN_PLACEHOLDERS: [string, string][] = [
  ['{theme}', 'Theme name'],
  ['{description}', 'Theme description'],
  ['{author}', 'Theme author'],
  ['{credits}', 'Credits text of the theme'],
  ['{released}', 'Release date'],
  ['{cleared}', 'Levels cleared'],
  ['{total}', 'Number of levels'],
  ['{stars}', 'Stars collected (select) / earned on this level (intro)'],
  ['{maxStars}', 'Stars available'],
  ['{n}', 'Level number (intro)'],
  ['{nn}', 'Level number, two digits: 01 (intro)'],
  ['{title}', 'Level title (intro)'],
  ['{difficulty}', 'Difficulty 1.00–10.00 (intro)'],
  ['{difficultyLabel}', 'EASY / NORMAL / HARD / EXPERT / INSANE (intro)'],
  ['{best}', 'Best time, or "--" (intro)'],
];

export function difficultyLabel(d: number): string {
  return d < 3 ? 'EASY' : d < 5 ? 'NORMAL' : d < 7 ? 'HARD' : d < 9 ? 'EXPERT' : 'INSANE';
}

export const DEFAULT_BUTTON: Readonly<LevelButtonStyle> = {
  shape: 'rounded',
  fill: '#ffffff',
  border: '#3a9ff0',
  borderWidth: 3,
  font: 'title',
  numberSize: 34,
  numberColor: '#243450',
  pad: 2,
  showStars: true,
  showDifficulty: false,
};

// ───────────────────────── Lenient reading ─────────────────────────

const HEX = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;
const KINDS: ElementKind[] = ['text', 'image', 'box', 'levelGrid', 'back', 'start', 'stars', 'progress'];
const SHAPES: ButtonShape[] = ['rounded', 'square', 'circle', 'diamond', 'drop', 'leaf', 'none'];
const VIS: Visibility[] = ['always', 'allComplete', 'notComplete', 'cleared', 'notCleared'];

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, min: number, max: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d);
const str = (v: unknown, max = 2000) => (typeof v === 'string' ? v.slice(0, max) : undefined);
const color = (v: unknown) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : undefined);
const font = (v: unknown) => (typeof v === 'string' && /^[\w -]{1,40}$/.test(v) ? v : undefined);

function clean<T extends Obj>(o: T): T {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
}

function readButton(v: unknown): LevelButtonStyle {
  const b = isObj(v) ? v : {};
  return clean({
    shape: SHAPES.includes(b.shape as ButtonShape) ? (b.shape as ButtonShape) : DEFAULT_BUTTON.shape,
    fill: color(b.fill) ?? DEFAULT_BUTTON.fill,
    fill2: color(b.fill2),
    clearedFill: color(b.clearedFill),
    border: color(b.border) ?? DEFAULT_BUTTON.border,
    borderWidth: num(b.borderWidth, 0, 20, DEFAULT_BUTTON.borderWidth),
    image: str(b.image, 200),
    font: font(b.font) ?? DEFAULT_BUTTON.font,
    numberSize: num(b.numberSize, 8, 200, DEFAULT_BUTTON.numberSize),
    numberColor: color(b.numberColor) ?? DEFAULT_BUTTON.numberColor,
    numberGlow: color(b.numberGlow),
    pad: Math.round(num(b.pad, 0, 4, DEFAULT_BUTTON.pad)),
    showStars: b.showStars !== false,
    showDifficulty: b.showDifficulty === true,
  });
}

function readElement(v: unknown, i: number): LayoutElement | null {
  if (!isObj(v) || !KINDS.includes(v.kind as ElementKind)) return null;
  const e: LayoutElement = clean({
    id: str(v.id, 40) || `e${i}`,
    kind: v.kind as ElementKind,
    x: num(v.x, -2000, 4000, 0),
    y: num(v.y, -2000, 4000, 0),
    w: num(v.w, 1, 4000, 100),
    h: num(v.h, 1, 4000, 40),
    rotate: typeof v.rotate === 'number' ? num(v.rotate, -360, 360, 0) : undefined,
    opacity: typeof v.opacity === 'number' ? num(v.opacity, 0, 1, 1) : undefined,
    when: VIS.includes(v.when as Visibility) && v.when !== 'always' ? (v.when as Visibility) : undefined,
    text: str(v.text),
    font: font(v.font),
    size: typeof v.size === 'number' ? num(v.size, 4, 400, 24) : undefined,
    color: color(v.color),
    bold: v.bold === true ? true : undefined,
    italic: v.italic === true ? true : undefined,
    align: v.align === 'left' || v.align === 'right' || v.align === 'center' ? (v.align as 'left' | 'right' | 'center') : undefined,
    stroke: color(v.stroke),
    glow: color(v.glow),
    shadow: v.shadow === true ? true : undefined,
    fill: color(v.fill),
    border: color(v.border),
    borderWidth: typeof v.borderWidth === 'number' ? num(v.borderWidth, 0, 40, 0) : undefined,
    radius: typeof v.radius === 'number' ? num(v.radius, 0, 400, 0) : undefined,
    src: str(v.src, 200),
    cols: typeof v.cols === 'number' ? Math.round(num(v.cols, 1, 21, 7)) : undefined,
    rows: typeof v.rows === 'number' ? Math.round(num(v.rows, 1, 21, 3)) : undefined,
    gap: typeof v.gap === 'number' ? num(v.gap, 0, 200, 16) : undefined,
    button: v.kind === 'levelGrid' ? readButton(v.button) : undefined,
    source: v.source === 'difficulty' || v.source === 'earned' ? (v.source as 'difficulty' | 'earned') : undefined,
    count: typeof v.count === 'number' ? Math.round(num(v.count, 1, 21, 5)) : undefined,
    onColor: color(v.onColor),
    offColor: color(v.offColor),
  });
  return e;
}

export function readLayout(v: unknown): ScreenLayout | undefined {
  if (!isObj(v)) return undefined;
  const bg = isObj(v.background) ? v.background : {};
  return {
    background: clean({
      color: color(bg.color) ?? '#1d2027',
      color2: color(bg.color2),
      image: str(bg.image, 200),
      fit: bg.fit === 'contain' || bg.fit === 'tile' || bg.fit === 'cover' ? (bg.fit as 'contain' | 'tile' | 'cover') : undefined,
      dim: typeof bg.dim === 'number' ? num(bg.dim, 0, 0.9, 0) : undefined,
    }),
    elements: (Array.isArray(v.elements) ? v.elements : []).slice(0, 200).map(readElement).filter((e): e is LayoutElement => e !== null),
  };
}

export function readScreens(v: unknown): ThemeScreens | undefined {
  if (!isObj(v)) return undefined;
  const out: ThemeScreens = {};
  const select = readLayout(v.select);
  const intro = readLayout(v.intro);
  if (select) out.select = select;
  if (intro) out.intro = intro;
  return select || intro ? out : undefined;
}

export function readFonts(v: unknown): ThemeFont[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v
    .filter(isObj)
    .map((f) => ({ family: font(f.family) ?? '', file: str(f.file, 200) ?? '' }))
    .filter((f) => f.family && f.file)
    .slice(0, 16);
  return out.length ? out : undefined;
}
