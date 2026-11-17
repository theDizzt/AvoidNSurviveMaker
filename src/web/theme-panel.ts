import { createPatternTile } from './theme-pattern';
import { BASE_THEME, primaryColor, secondaryColor, shade, THEME_PRESETS } from '../core/theme';
import type { Fill, PatternKind, SurfaceStyle, Theme } from '../core/types';

const FILL_TYPES: [Fill['type'], string][] = [['solid', 'Solid'], ['gradient', 'Gradient'], ['pattern', 'Pattern']];
const PATTERNS: [PatternKind, string][] = [
  ['stripes', 'Stripes'],
  ['diagonal', 'Diagonal'],
  ['dots', 'Dots'],
  ['grid', 'Grid'],
  ['checker', 'Checker'],
  ['wood', 'Wood planks'],
  ['grass', 'Grass'],
  ['sand', 'Sand'],
  ['metal', 'Metal'],
];
const CATEGORIES: [keyof Theme, string][] = [['wall', 'Walls & obstacles'], ['path', 'Paths']];

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Convert a fill to another type, carrying its colors over */
function convertFill(f: Fill, type: Fill['type']): Fill {
  const a = primaryColor(f);
  const b = secondaryColor(f);
  if (type === 'solid') return { type, color: a };
  if (type === 'gradient') return { type, style: 'linear', from: a, to: b === a ? shade(a, -0.35) : b, angle: 90 };
  return { type, pattern: 'stripes', color: a, background: b === a ? shade(a, -0.35) : b, size: 12 };
}

function label(text: string, control: HTMLElement, wide = false): HTMLElement {
  const wrap = document.createElement('label');
  wrap.className = wide ? 'field wide' : 'field';
  const span = document.createElement('span');
  span.textContent = text;
  wrap.append(span, control);
  return wrap;
}

function select<T extends string>(value: T, options: [T, string][], onChange: (v: T) => void): HTMLSelectElement {
  const s = document.createElement('select');
  for (const [v, t] of options) s.append(new Option(t, v, false, v === value));
  s.addEventListener('change', () => onChange(s.value as T));
  return s;
}

function colorInput(value: string, onChange: (v: string) => void): HTMLInputElement {
  const i = document.createElement('input');
  i.type = 'color';
  i.value = value;
  // 'change' fires once the picker closes → one undo step per color pick
  i.addEventListener('change', () => onChange(i.value));
  return i;
}

function numberInput(value: number, min: number, max: number, step: number, onChange: (v: number) => void): HTMLInputElement {
  const i = document.createElement('input');
  i.type = 'number';
  i.min = String(min);
  i.max = String(max);
  i.step = String(step);
  i.value = String(value);
  i.addEventListener('change', () => {
    const v = Number(i.value);
    if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)));
    else i.value = String(value);
  });
  return i;
}

/** Small fill swatch; patterns use the same tile as the game */
function swatch(f: Fill): HTMLElement {
  const d = document.createElement('div');
  d.className = 'theme-swatch';
  if (f.type === 'solid') d.style.background = f.color;
  else if (f.type === 'gradient') {
    d.style.background = f.style === 'radial'
      ? `radial-gradient(circle, ${f.from}, ${f.to})`
      : `linear-gradient(${f.angle + 90}deg, ${f.from}, ${f.to})`;
  } else {
    const tile = createPatternTile(f);
    d.style.backgroundImage = `url("${tile.toDataURL()}")`;
    d.style.backgroundSize = `${f.size}px ${f.size}px`;
  }
  return d;
}

/**
 * Theme editor: preset picker + per-category fill/outline controls.
 * `apply` receives the next theme (undefined = default look) and is responsible for undo + redraw.
 */
export function renderThemePanel(
  box: HTMLElement,
  theme: Theme | undefined,
  apply: (next: Theme | undefined) => void,
  extraPresets: readonly { id: string; name: string; theme: Theme }[] = [],
): void {
  const json = JSON.stringify(theme ?? null);
  const presets = [...THEME_PRESETS, ...extraPresets];
  // Chapter presets win a tie so their music is recognised
  const preset = [...extraPresets, ...THEME_PRESETS].find((p) => JSON.stringify(p.theme ?? null) === json);
  const presetOptions: [string, string][] = presets.map((p) => [p.id, p.name]);
  if (!preset) presetOptions.push(['custom', 'Custom']);

  const parts: HTMLElement[] = [
    label('Preset', select(preset?.id ?? 'custom', presetOptions, (id) => {
      const p = presets.find((x) => x.id === id);
      if (p) apply(p.theme ? clone(p.theme) : undefined);
    }), true),
  ];

  // Editing anything while on the default look starts from an equivalent custom theme
  const base: Theme = clone(theme ?? BASE_THEME);
  const update = (key: keyof Theme, fn: (s: SurfaceStyle) => void) => {
    const next = clone(base);
    fn(next[key]);
    apply(next);
  };

  for (const [key, title] of CATEGORIES) {
    const style = base[key];
    const f = style.fill;
    const head = document.createElement('div');
    head.className = 'theme-head';
    const h = document.createElement('h5');
    h.textContent = title;
    head.append(h, swatch(f));
    parts.push(head);

    const fields: HTMLElement[] = [
      label('Fill', select(f.type, FILL_TYPES, (type) => update(key, (s) => (s.fill = convertFill(s.fill, type))))),
      label('Outline', colorInput(style.edge, (v) => update(key, (s) => (s.edge = v)))),
    ];
    if (f.type === 'solid') {
      fields.push(label('Color', colorInput(f.color, (v) => update(key, (s) => (s.fill = { type: 'solid', color: v })))));
    } else if (f.type === 'gradient') {
      const set = (patch: Partial<typeof f>) => update(key, (s) => (s.fill = { ...f, ...patch }));
      fields.push(
        label('Style', select(f.style, [['linear', 'Linear'], ['radial', 'Radial']], (style) => set({ style }))),
        label('From', colorInput(f.from, (from) => set({ from }))),
        label('To', colorInput(f.to, (to) => set({ to }))),
      );
      if (f.style === 'linear') fields.push(label('Angle (°)', numberInput(f.angle, -360, 360, 15, (angle) => set({ angle }))));
    } else {
      const set = (patch: Partial<typeof f>) => update(key, (s) => (s.fill = { ...f, ...patch }));
      fields.push(
        label('Pattern', select(f.pattern, PATTERNS, (pattern) => set({ pattern }))),
        label('Size (px)', numberInput(f.size, 4, 64, 2, (size) => set({ size }))),
        label('Color', colorInput(f.color, (color) => set({ color }))),
        label('Background', colorInput(f.background, (background) => set({ background }))),
      );
    }
    const grid = document.createElement('div');
    grid.className = 'fields';
    grid.append(...fields);
    parts.push(grid);
  }

  box.replaceChildren(...parts);
}
