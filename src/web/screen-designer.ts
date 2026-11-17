import { fontPicker } from './font-picker';
import {
  BUILTIN_FONTS, DEFAULT_BUTTON, SCREEN_PLACEHOLDERS,
  type ButtonShape, type ElementKind, type LayoutElement, type LevelButtonStyle, type ScreenLayout, type Visibility,
} from '../core/screen-layout';
import { LEVELS_PER_THEME, themedLevel, type ThemeEntry } from '../core/theme-pack';
import { renderScreen, type ScreenData } from './screen-render';
import { emptyLayout, newElement, SCREEN_TEMPLATES } from './screen-templates';
import type { StoredTheme } from './theme-registry';

/**
 * The theme editor's screen designer: a stage where the custom level select / level intro is laid
 * out by dragging elements, and a panel with the background, element list and the selected
 * element's properties.
 */

export type ScreenKind = 'select' | 'intro';

const KIND_NAMES: Record<ElementKind, string> = {
  text: 'Text', image: 'Image', box: 'Box', levelGrid: 'Level buttons', back: 'Back button', start: 'Start (√) button', stars: 'Stars', progress: 'Progress bar',
};
/** Elements that make sense on each screen */
const KINDS_FOR: Record<ScreenKind, ElementKind[]> = {
  select: ['text', 'image', 'box', 'levelGrid', 'back'],
  intro: ['text', 'image', 'box', 'start', 'back', 'stars', 'progress'],
};
const SHAPES: [ButtonShape, string][] = [
  ['rounded', 'Rounded square'], ['square', 'Square'], ['circle', 'Circle'], ['diamond', 'Diamond'], ['drop', 'Teardrop'], ['leaf', 'Leaf'], ['none', 'Number only'],
];
const WHEN: [Visibility, string][] = [
  ['always', 'Always'], ['allComplete', 'Only when every level is cleared'], ['notComplete', 'Until every level is cleared'],
  ['cleared', 'Intro: only if this level was cleared'], ['notCleared', 'Intro: only if not cleared yet'],
];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export class ScreenDesigner {
  private kind: ScreenKind = 'select';
  private selected: string | null = null;
  private previewLevel = 0;
  /** Preview the select screen as if every level were cleared (shows "ALL COMPLETE" elements) */
  private allClear = false;

  constructor(
    private readonly stageHost: HTMLElement,
    private readonly panel: HTMLElement,
    private readonly draft: () => StoredTheme,
    private readonly save: () => void,
    /** Store an uploaded file in the pack under `folder/`, returning its path */
    private readonly upload: (file: File, folder: string) => Promise<string>,
  ) {}

  open(kind: ScreenKind, previewLevel: number): void {
    this.kind = kind;
    this.previewLevel = previewLevel;
    this.selected = null;
    this.render();
  }

  private get layout(): ScreenLayout | undefined {
    return this.draft().info.screens?.[this.kind];
  }

  private setLayout(l: ScreenLayout | undefined): void {
    const info = this.draft().info;
    const screens = { ...(info.screens ?? {}) };
    if (l) screens[this.kind] = l;
    else delete screens[this.kind];
    if (screens.select || screens.intro) info.screens = screens;
    else delete info.screens;
  }

  private data(): ScreenData {
    const d = this.draft();
    const entry: ThemeEntry = { info: d.info, levels: d.levels, assets: d.images, official: false };
    const levels = Array.from({ length: LEVELS_PER_THEME }, (_, i) => {
      const map = themedLevel(entry, i);
      // Sample progress: a few cleared levels, or all of them
      const cleared = !!map && (this.allClear || i < 3);
      return { available: !!map || i < 7, stars: cleared ? 3 - (i % 3) : 0, cleared, difficulty: map?.difficulty ?? 1 + (i % 10) * 0.9, title: map?.title ?? `Level ${i + 1}` };
    });
    return { info: d.info, assets: d.images, fontScope: 'th-draft', levels, level: this.kind === 'intro' ? this.previewLevel : undefined, best: this.kind === 'intro' ? 12345 : undefined };
  }

  render(): void {
    this.renderStage();
    this.renderPanel();
  }

  private renderStage(): void {
    const layout = this.layout;
    if (!layout) {
      const empty = el('div', 'sd-empty');
      empty.append(el('strong', '', this.kind === 'select' ? 'Default level select' : 'No intro screen'),
        el('span', '', this.kind === 'select' ? 'Levels use the standard diamond screen. Turn on a custom screen below to design your own.' : 'Levels start right away. Turn on an intro screen below to show one before each level.'));
      this.stageHost.replaceChildren(empty);
      return;
    }
    renderScreen(this.stageHost, layout, this.data(), {}, {
      selected: this.selected,
      onSelect: (id) => this.select(id),
      onChange: () => {
        this.save();
        this.renderPanel();
      },
    });
  }

  private select(id: string | null): void {
    this.selected = id;
    this.stageHost.querySelectorAll('.se').forEach((n) => n.classList.toggle('se-selected', (n as HTMLElement).dataset.id === id));
    this.renderPanel();
  }

  /** A change from the panel: save, redraw the stage */
  private changed(): void {
    this.save();
    this.renderStage();
  }

  // ───────────────────────── Panel ─────────────────────────

  private field(label: string, control: HTMLElement, wide = false): HTMLElement {
    const l = el('label', wide ? 'field wide' : 'field');
    l.append(el('span', '', label), control);
    return l;
  }

  private group(...children: HTMLElement[]): HTMLElement {
    const g = el('div', 'fields');
    g.append(...children);
    return g;
  }

  private num(value: number, apply: (v: number) => void, step = 1): HTMLInputElement {
    const i = el('input');
    i.type = 'number';
    i.step = String(step);
    i.value = String(Math.round(value * 100) / 100);
    i.addEventListener('change', () => {
      const v = Number(i.value);
      if (Number.isFinite(v)) {
        apply(v);
        this.changed();
      }
    });
    return i;
  }

  private txt(value: string, apply: (v: string) => void, multiline = false): HTMLElement {
    const i = multiline ? el('textarea') : el('input');
    i.value = value;
    i.addEventListener('change', () => {
      apply(i.value);
      this.changed();
    });
    return i;
  }

  private check(label: string, value: boolean, apply: (v: boolean) => void): HTMLElement {
    const l = el('label', 'toggle');
    const i = el('input');
    i.type = 'checkbox';
    i.checked = value;
    i.addEventListener('change', () => {
      apply(i.checked);
      this.changed();
    });
    l.append(i, el('span', '', label));
    return l;
  }

  private sel<T extends string>(value: T, options: [T, string][], apply: (v: T) => void): HTMLSelectElement {
    const s = el('select');
    s.append(...options.map(([v, t]) => new Option(t, v, false, v === value)));
    s.addEventListener('change', () => {
      apply(s.value as T);
      this.changed();
    });
    return s;
  }

  /** Color with opacity (#rrggbbaa), or none */
  private color(value: string | undefined, apply: (v: string | undefined) => void, allowNone = true): HTMLElement {
    const row = el('div', 'sd-color');
    const c = el('input');
    c.type = 'color';
    c.value = (value ?? '#ffffff').slice(0, 7);
    const a = el('input');
    a.type = 'range';
    a.min = '0';
    a.max = '255';
    a.value = String(value && value.length === 9 ? parseInt(value.slice(7), 16) : 255);
    a.title = 'Opacity';
    const none = el('input');
    none.type = 'checkbox';
    none.checked = !value;
    none.title = 'None';
    const emit = () => {
      if (allowNone && none.checked) apply(undefined);
      else {
        const alpha = Number(a.value);
        apply(alpha >= 255 ? c.value : `${c.value}${alpha.toString(16).padStart(2, '0')}`);
      }
      this.changed();
    };
    c.addEventListener('change', () => {
      none.checked = false;
      emit();
    });
    a.addEventListener('change', () => {
      none.checked = false;
      emit();
    });
    none.addEventListener('change', emit);
    row.append(c, a);
    if (allowNone) {
      const l = el('label', 'sd-none');
      l.append(none, el('span', '', 'none'));
      row.append(l);
    }
    return row;
  }

  /** Pick a pack file, or upload a new one into `folder/` */
  private asset(value: string | undefined, folder: string, apply: (v: string | undefined) => void, accept = 'image/*'): HTMLElement {
    const row = el('div', 'sd-asset');
    const files = Object.keys(this.draft().images).filter((n) => !/\.(ttf|otf|woff2?)$/i.test(n)).sort();
    const s = el('select');
    s.append(new Option('(none)', ''), ...files.map((f) => new Option(f, f, false, f === value)));
    s.addEventListener('change', () => {
      apply(s.value || undefined);
      this.changed();
    });
    const up = el('input');
    up.type = 'file';
    up.accept = accept;
    up.addEventListener('change', async () => {
      const f = up.files?.[0];
      if (!f) return;
      apply(await this.upload(f, folder));
      this.changed();
      this.renderPanel();
    });
    row.append(s, up);
    return row;
  }

  private fontSelect(value: string | undefined, apply: (v: string) => void): HTMLSelectElement {
    const custom = (this.draft().info.fonts ?? []).map((f) => [f.family, `Pack: ${f.family}`] as [string, string]);
    const builtin = BUILTIN_FONTS.map((f) => [f, f[0].toUpperCase() + f.slice(1)] as [string, string]);
    return fontPicker(this.sel(value ?? 'title', [...builtin, ...custom], apply), value ?? 'title');
  }

  private renderPanel(): void {
    const parts: HTMLElement[] = [];
    const layout = this.layout;
    const title = this.kind === 'select' ? 'Level select screen' : 'Level intro screen';
    parts.push(el('h3', '', title));
    parts.push(this.check(this.kind === 'select' ? 'Use a custom level select screen' : 'Show an intro screen before each level', !!layout, (on) => {
      this.setLayout(on ? SCREEN_TEMPLATES[0].make()[this.kind] ?? emptyLayout() : undefined);
      this.selected = null;
      queueMicrotask(() => this.renderPanel());
    }));
    if (!layout) {
      this.panel.replaceChildren(...parts);
      return;
    }

    // Templates
    const tpl = el('select');
    tpl.append(new Option('Apply a template…', ''), ...SCREEN_TEMPLATES.map((t) => new Option(t.name, t.id)), new Option('Empty', 'empty'));
    tpl.addEventListener('change', () => {
      const v = tpl.value;
      tpl.value = '';
      if (!v || !confirm('Replace this screen\'s layout with the template?')) return;
      const t = SCREEN_TEMPLATES.find((x) => x.id === v);
      this.setLayout(t ? t.make()[this.kind] ?? emptyLayout() : emptyLayout());
      this.selected = null;
      this.changed();
      this.renderPanel();
    });
    const previewRow = el('div', 'actions');
    if (this.kind === 'select') previewRow.append(this.check('Preview as all cleared', this.allClear, (v) => (this.allClear = v)));
    parts.push(this.group(this.field('Template', tpl, true)), previewRow);

    // Background
    const bg = layout.background;
    parts.push(el('h5', '', 'Background'), this.group(
      this.field('Color', this.color(bg.color, (v) => (bg.color = v ?? '#000000'), false)),
      this.field('Gradient to', this.color(bg.color2, (v) => {
        if (v) bg.color2 = v;
        else delete bg.color2;
      })),
      this.field('Image', this.asset(bg.image, 'images', (v) => {
        if (v) bg.image = v;
        else delete bg.image;
      }), true),
      this.field('Image fit', this.sel(bg.fit ?? 'cover', [['cover', 'Fill'], ['contain', 'Fit'], ['tile', 'Tile']], (v) => (bg.fit = v))),
      this.field('Darken image', this.num(bg.dim ?? 0, (v) => (bg.dim = Math.min(0.9, Math.max(0, v))), 0.05)),
    ));

    // Elements
    const list = el('ol', 'sd-list');
    layout.elements.forEach((e, i) => {
      const li = el('li', e.id === this.selected ? 'on' : '');
      const name = el('button', 'sd-name', `${KIND_NAMES[e.kind]}${e.text ? `: ${e.text.slice(0, 24)}` : ''}${e.when && e.when !== 'always' ? ' ◐' : ''}`);
      name.type = 'button';
      name.addEventListener('click', () => this.select(e.id));
      const tool = (t: string, tip: string, fn: () => void, disabled = false) => {
        const b = el('button', '', t);
        b.type = 'button';
        b.title = tip;
        b.disabled = disabled;
        b.addEventListener('click', () => {
          fn();
          this.changed();
          this.renderPanel();
        });
        return b;
      };
      const els = layout.elements;
      li.append(name,
        tool('↑', 'Bring forward', () => ([els[i], els[i + 1]] = [els[i + 1], els[i]]), i === els.length - 1),
        tool('↓', 'Send backward', () => ([els[i], els[i - 1]] = [els[i - 1], els[i]]), i === 0),
        tool('⧉', 'Duplicate', () => els.splice(i + 1, 0, { ...structuredClone(e), id: `${e.id}c${Date.now() % 10000}`, x: e.x + 20, y: e.y + 20 })),
        tool('✕', 'Delete', () => {
          els.splice(i, 1);
          if (this.selected === e.id) this.selected = null;
        }));
      list.append(li);
    });
    const add = el('div', 'actions sd-add');
    for (const k of KINDS_FOR[this.kind]) {
      const b = el('button', '', `+ ${KIND_NAMES[k]}`);
      b.type = 'button';
      b.addEventListener('click', () => {
        const e = newElement(k);
        layout.elements.push(e);
        this.selected = e.id;
        this.changed();
        this.renderPanel();
      });
      add.append(b);
    }
    parts.push(el('h5', '', `Elements (${layout.elements.length})`), list, add);

    const e = layout.elements.find((x) => x.id === this.selected);
    if (e) parts.push(...this.elementProps(e));
    else parts.push(el('p', 'muted', 'Click an element on the stage to edit it. Drag to move, drag the blue corner to resize (Alt = no snapping).'));

    const help = el('details', 'sd-help');
    const sum = el('summary', '', 'Text placeholders');
    const dl = el('dl');
    for (const [k, v] of SCREEN_PLACEHOLDERS) dl.append(el('dt', '', k), el('dd', '', v));
    help.append(sum, dl);
    parts.push(help);
    this.panel.replaceChildren(...parts);
  }

  private elementProps(e: LayoutElement): HTMLElement[] {
    const out: HTMLElement[] = [el('h5', '', `Selected: ${KIND_NAMES[e.kind]}`)];
    out.push(this.group(
      this.field('X', this.num(e.x, (v) => (e.x = v))),
      this.field('Y', this.num(e.y, (v) => (e.y = v))),
      this.field('Width', this.num(e.w, (v) => (e.w = Math.max(1, v)))),
      this.field('Height', this.num(e.h, (v) => (e.h = Math.max(1, v)))),
      this.field('Rotate (°)', this.num(e.rotate ?? 0, (v) => (e.rotate = v || undefined), 1)),
      this.field('Opacity', this.num(e.opacity ?? 1, (v) => (e.opacity = v >= 1 ? undefined : Math.max(0, v)), 0.05)),
      this.field('Shown', this.sel(e.when ?? 'always', WHEN, (v) => (e.when = v === 'always' ? undefined : v)), true),
    ));

    const hasText = e.kind === 'text' || e.kind === 'back' || e.kind === 'start';
    if (hasText) {
      out.push(this.group(
        this.field('Text ({placeholders} allowed)', this.txt(e.text ?? '', (v) => (e.text = v), true), true),
        this.field('Font', this.fontSelect(e.font, (v) => (e.font = v))),
        this.field('Size', this.num(e.size ?? 28, (v) => (e.size = Math.max(4, v)))),
        this.field('Color', this.color(e.color, (v) => (e.color = v), false)),
        this.field('Align', this.sel(e.align ?? 'center', [['left', 'Left'], ['center', 'Center'], ['right', 'Right']], (v) => (e.align = v))),
        this.field('Outline', this.color(e.stroke, (v) => (e.stroke = v))),
        this.field('Glow', this.color(e.glow, (v) => (e.glow = v))),
      ), this.check('Bold', !!e.bold, (v) => (e.bold = v || undefined)), this.check('Italic', !!e.italic, (v) => (e.italic = v || undefined)),
      this.check('Drop shadow', !!e.shadow, (v) => (e.shadow = v || undefined)));
    }
    if (e.kind === 'box' || e.kind === 'back' || e.kind === 'start') {
      out.push(this.group(
        this.field('Fill', this.color(e.fill, (v) => (e.fill = v))),
        this.field('Border', this.color(e.border, (v) => (e.border = v))),
        this.field('Border width', this.num(e.borderWidth ?? 0, (v) => (e.borderWidth = Math.max(0, v)))),
        this.field('Corner radius', this.num(e.radius ?? 0, (v) => (e.radius = Math.max(0, v)))),
      ));
    }
    if (e.kind === 'image') out.push(this.group(this.field('Picture', this.asset(e.src, 'images', (v) => (e.src = v)), true)));
    if (e.kind === 'stars') {
      out.push(this.group(
        this.field('Shows', this.sel(e.source ?? 'difficulty', [['difficulty', 'Difficulty'], ['earned', 'Stars earned']], (v) => (e.source = v))),
        this.field('Stars', this.num(e.count ?? 5, (v) => (e.count = Math.max(1, Math.min(10, Math.round(v)))))),
        this.field('On color', this.color(e.onColor, (v) => (e.onColor = v), false)),
        this.field('Off color', this.color(e.offColor, (v) => (e.offColor = v), false)),
      ));
    }
    if (e.kind === 'progress') {
      out.push(this.group(
        this.field('Done color', this.color(e.onColor, (v) => (e.onColor = v), false)),
        this.field('Rest color', this.color(e.offColor, (v) => (e.offColor = v), false)),
      ));
    }
    if (e.kind === 'levelGrid') {
      e.button ??= { ...DEFAULT_BUTTON };
      const b: LevelButtonStyle = e.button;
      out.push(this.group(
        this.field('Columns', this.num(e.cols ?? 7, (v) => (e.cols = Math.max(1, Math.min(21, Math.round(v)))))),
        this.field('Rows', this.num(e.rows ?? 3, (v) => (e.rows = Math.max(1, Math.min(21, Math.round(v)))))),
        this.field('Gap', this.num(e.gap ?? 16, (v) => (e.gap = Math.max(0, v)))),
        this.field('Shape', this.sel(b.shape, SHAPES, (v) => (b.shape = v))),
        this.field('Fill', this.color(b.fill, (v) => (b.fill = v ?? '#00000000'))),
        this.field('Every other fill', this.color(b.fill2, (v) => (b.fill2 = v))),
        this.field('Cleared fill', this.color(b.clearedFill, (v) => (b.clearedFill = v))),
        this.field('Border', this.color(b.border, (v) => (b.border = v ?? '#00000000'))),
        this.field('Border width', this.num(b.borderWidth, (v) => (b.borderWidth = Math.max(0, v)))),
        this.field('Button picture', this.asset(b.image, 'images', (v) => (b.image = v)), true),
        this.field('Number font', this.fontSelect(b.font, (v) => (b.font = v))),
        this.field('Number size', this.num(b.numberSize, (v) => (b.numberSize = Math.max(6, v)))),
        this.field('Number color', this.color(b.numberColor, (v) => (b.numberColor = v ?? '#000000'), false)),
        this.field('Number glow', this.color(b.numberGlow, (v) => (b.numberGlow = v))),
        this.field('Digits', this.sel(String(b.pad) as '0' | '2' | '3', [['0', '1'], ['2', '01'], ['3', '001']], (v) => (b.pad = Number(v)))),
      ), this.check('Stars under the number', b.showStars, (v) => (b.showStars = v)), this.check('Difficulty under the number', b.showDifficulty, (v) => (b.showDifficulty = v)));
    }
    return out;
  }
}
