import { t } from './i18n';
import { createPatternTile } from './theme-pattern';
import { BASE_THEME, primaryColor, secondaryColor, shade, THEME_PRESETS } from './localized/theme';
import type { Fill, PatternKind, SurfaceStyle, Theme } from '../core/types';

const FILL_TYPES: [Fill['type'], string][] = [['solid', t('fill.solid')], ['gradient', t('fill.gradient')], ['pattern', t('common.pattern')]];
const PATTERNS: [PatternKind, string][] = [
  ['stripes', t('pattern.stripes')],
  ['diagonal', t('pattern.diagonal')],
  ['dots', t('pattern.dots')],
  ['grid', t('pattern.grid')],
  ['checker', t('pattern.checker')],
  ['wood', t('pattern.wood')],
  ['grass', t('pattern.grass')],
  ['sand', t('pattern.sand')],
  ['metal', t('pattern.metal')],
  ['egyptian', t('pattern.egyptian')],
  ['sandBrick', t('pattern.sandBrick')],
  ['bark', t('pattern.bark')],
  ['woodGrain', t('pattern.woodGrain')],
  ['thicket', t('pattern.thicket')],
  ['mud', t('pattern.mud')],
  ['snow', t('pattern.snow')],
  ['ice', t('pattern.ice')],
  ['iceCrystal', t('pattern.iceCrystal')],
];
const CATEGORIES: [keyof Theme, string][] = [['wall', t('themePanel.walls')], ['path', t('common.paths')]];

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
  /** false: only the default look plus `extraPresets` (no built-in color sets) */
  builtIn = true,
): void {
  const json = JSON.stringify(theme ?? null);
  const listed = builtIn ? THEME_PRESETS : THEME_PRESETS.filter((p) => !p.theme);
  const presets = [...listed, ...extraPresets];
  // Chapter presets win a tie so their music is recognised
  const preset = [...extraPresets, ...listed].find((p) => JSON.stringify(p.theme ?? null) === json);
  const presetOptions: [string, string][] = presets.map((p) => [p.id, p.name]);
  if (!preset) presetOptions.push(['custom', t('themePanel.custom')]);

  const parts: HTMLElement[] = [
    label(t('themePanel.preset'), select(preset?.id ?? 'custom', presetOptions, (id) => {
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
      label(t('common.fill'), select(f.type, FILL_TYPES, (type) => update(key, (s) => (s.fill = convertFill(s.fill, type))))),
      label(t('common.outline'), colorInput(style.edge, (v) => update(key, (s) => (s.edge = v)))),
    ];
    if (f.type === 'solid') {
      fields.push(label(t('common.color'), colorInput(f.color, (v) => update(key, (s) => (s.fill = { type: 'solid', color: v })))));
    } else if (f.type === 'gradient') {
      const set = (patch: Partial<typeof f>) => update(key, (s) => (s.fill = { ...f, ...patch }));
      fields.push(
        label(t('themePanel.style'), select(f.style, [['linear', t('themePanel.linear')], ['radial', t('themePanel.radial')]], (style) => set({ style }))),
        label(t('themePanel.from'), colorInput(f.from, (from) => set({ from }))),
        label(t('themePanel.to'), colorInput(f.to, (to) => set({ to }))),
      );
      if (f.style === 'linear') fields.push(label(t('common.angle'), numberInput(f.angle, -360, 360, 15, (angle) => set({ angle }))));
    } else {
      const set = (patch: Partial<typeof f>) => update(key, (s) => (s.fill = { ...f, ...patch }));
      fields.push(
        label(t('common.pattern'), select(f.pattern, PATTERNS, (pattern) => set({ pattern }))),
        label(t('themePanel.size'), numberInput(f.size, 4, 64, 2, (size) => set({ size }))),
        label(t('common.color'), colorInput(f.color, (color) => set({ color }))),
        label(t('common.background'), colorInput(f.background, (background) => set({ background }))),
      );
    }
    const grid = document.createElement('div');
    grid.className = 'fields';
    grid.append(...fields);
    parts.push(grid);
  }

  box.replaceChildren(...parts);
}
