import { t as tr } from './i18n';
import { fontPicker } from './font-picker';
import {
  BUILTIN_FONTS, DEFAULT_BUTTON, SCREEN_PLACEHOLDERS,
  type ButtonShape, type ElementKind, type LayoutElement, type LevelButtonStyle, type ScreenLayout, type Visibility,
} from './localized/screen-layout';
import { LEVELS_PER_THEME, themedLevel, type ThemeEntry } from './localized/theme-pack';
import { renderScreen, type ScreenData } from './screen-render';
import { emptyLayout, newElement, SCREEN_TEMPLATES } from './screen-templates';
import type { StoredTheme } from './theme-registry';

/**
 * The theme editor's screen designer: a stage where the custom level select is laid
 * out by dragging elements, and a panel with the background, element list and the selected
 * element's properties.
 */

export type ScreenKind = 'select';

const KIND_NAMES: Record<ElementKind, string> = {
  text: tr('common.text'), image: tr('common.image'), box: tr('sd.box'), levelGrid: tr('sd.levelButtons'), back: tr('sd.backButton'), start: tr('sd.startButton'), stars: tr('common.stars'), progress: tr('sd.progressBar'),
};
/** Elements that make sense on each screen */
const KINDS_FOR: Record<ScreenKind, ElementKind[]> = {
  select: ['text', 'image', 'box', 'levelGrid', 'back'],
};
const SHAPES: [ButtonShape, string][] = [
  ['rounded', tr('sd.roundedSquare')], ['square', tr('sd.square')], ['circle', tr('common.circle')], ['diamond', tr('sd.diamond')], ['drop', tr('sd.teardrop')], ['leaf', tr('sd.leaf')], ['none', tr('sd.numberOnly')],
];
const WHEN: [Visibility, string][] = [
  ['always', tr('sd.always')], ['allComplete', tr('sd.onlyWhenEveryLevelIs')], ['notComplete', tr('sd.untilEveryLevelIsCleared')],
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

  open(kind: ScreenKind): void {
    this.kind = kind;
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
    if (screens.select) info.screens = screens;
    else delete info.screens;
  }

  private data(): ScreenData {
    const d = this.draft();
    const entry: ThemeEntry = { info: d.info, levels: d.levels, assets: d.images, official: false };
    const levels = Array.from({ length: LEVELS_PER_THEME }, (_, i) => {
      const map = themedLevel(entry, i);
      // Sample progress: a few cleared levels, or all of them
      const cleared = !!map && (this.allClear || i < 3);
      return { available: !!map || i < 7, stars: cleared ? 3 - (i % 3) : 0, cleared, difficulty: map?.difficulty ?? 1 + (i % 10) * 0.9, title: map?.title ?? tr('common.levelN', { n: i + 1 }) };
    });
    return { info: d.info, assets: d.images, fontScope: 'th-draft', levels };
  }

  render(): void {
    this.renderStage();
    this.renderPanel();
  }

  private renderStage(): void {
    const layout = this.layout;
    if (!layout) {
      const empty = el('div', 'sd-empty');
      empty.append(el('strong', '', tr('sd.defaultLevelSelect')),
        el('span', '', tr('sd.levelsUseTheStandardDiamond')));
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
    a.title = tr('sd.opacity');
    const none = el('input');
    none.type = 'checkbox';
    none.checked = !value;
    none.title = tr('common.none');
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
      l.append(none, el('span', '', tr('sd.noneLower')));
      row.append(l);
    }
    return row;
  }

  /** Pick a pack file, or upload a new one into `folder/` */
  private asset(value: string | undefined, folder: string, apply: (v: string | undefined) => void, accept = 'image/*'): HTMLElement {
    const row = el('div', 'sd-asset');
    const files = Object.keys(this.draft().images).filter((n) => !/\.(ttf|otf|woff2?)$/i.test(n)).sort();
    const s = el('select');
    s.append(new Option(tr('sd.none'), ''), ...files.map((f) => new Option(f, f, false, f === value)));
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
    const custom = (this.draft().info.fonts ?? []).map((f) => [f.family, tr('sd.packFont', { family: f.family })] as [string, string]);
    const builtin = BUILTIN_FONTS.map((f) => [f, f[0].toUpperCase() + f.slice(1)] as [string, string]);
    return fontPicker(this.sel(value ?? 'title', [...builtin, ...custom], apply), value ?? 'title');
  }

  private renderPanel(): void {
    const parts: HTMLElement[] = [];
    const layout = this.layout;
    const title = tr('sd.levelSelectScreen');
    parts.push(el('h3', '', title));
    parts.push(this.check(tr('sd.useACustomLevelSelect'), !!layout, (on) => {
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
    tpl.append(new Option(tr('sd.applyATemplate'), ''), ...SCREEN_TEMPLATES.map((t) => new Option(t.name, t.id)), new Option(tr('sd.empty'), 'empty'));
    tpl.addEventListener('change', () => {
      const v = tpl.value;
      tpl.value = '';
      if (!v || !confirm(tr('sd.replaceThisScreenSLayout'))) return;
      const t = SCREEN_TEMPLATES.find((x) => x.id === v);
      this.setLayout(t ? t.make()[this.kind] ?? emptyLayout() : emptyLayout());
      this.selected = null;
      this.changed();
      this.renderPanel();
    });
    const previewRow = el('div', 'actions');
    if (this.kind === 'select') previewRow.append(this.check(tr('sd.previewAsAllCleared'), this.allClear, (v) => (this.allClear = v)));
    parts.push(this.group(this.field(tr('sd.template'), tpl, true)), previewRow);

    // Background
    const bg = layout.background;
    parts.push(el('h5', '', tr('common.background')), this.group(
      this.field(tr('common.color'), this.color(bg.color, (v) => (bg.color = v ?? '#000000'), false)),
      this.field(tr('sd.gradientTo'), this.color(bg.color2, (v) => {
        if (v) bg.color2 = v;
        else delete bg.color2;
      })),
      this.field(tr('common.image'), this.asset(bg.image, 'images', (v) => {
        if (v) bg.image = v;
        else delete bg.image;
      }), true),
      this.field(tr('sd.imageFit'), this.sel(bg.fit ?? 'cover', [['cover', tr('common.fill')], ['contain', tr('sd.fit')], ['tile', tr('sd.tile')]], (v) => (bg.fit = v))),
      this.field(tr('sd.darkenImage'), this.num(bg.dim ?? 0, (v) => (bg.dim = Math.min(0.9, Math.max(0, v))), 0.05)),
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
        tool('↑', tr('common.bringForward'), () => ([els[i], els[i + 1]] = [els[i + 1], els[i]]), i === els.length - 1),
        tool('↓', tr('common.sendBackward'), () => ([els[i], els[i - 1]] = [els[i - 1], els[i]]), i === 0),
        tool('⧉', tr('common.duplicate'), () => els.splice(i + 1, 0, { ...structuredClone(e), id: `${e.id}c${Date.now() % 10000}`, x: e.x + 20, y: e.y + 20 })),
        tool('✕', tr('common.delete'), () => {
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
    parts.push(el('h5', '', tr('sd.elements', { n: layout.elements.length })), list, add);

    const e = layout.elements.find((x) => x.id === this.selected);
    if (e) parts.push(...this.elementProps(e));
    else parts.push(el('p', 'muted', tr('sd.clickAnElementOnThe')));

    const help = el('details', 'sd-help');
    const sum = el('summary', '', tr('sd.textPlaceholders'));
    const dl = el('dl');
    for (const [k, v] of SCREEN_PLACEHOLDERS) dl.append(el('dt', '', k), el('dd', '', v));
    help.append(sum, dl);
    parts.push(help);
    this.panel.replaceChildren(...parts);
  }

  private elementProps(e: LayoutElement): HTMLElement[] {
    const out: HTMLElement[] = [el('h5', '', tr('sd.selected', { kind: KIND_NAMES[e.kind] }))];
    out.push(this.group(
      this.field('X', this.num(e.x, (v) => (e.x = v))),
      this.field('Y', this.num(e.y, (v) => (e.y = v))),
      this.field(tr('common.width'), this.num(e.w, (v) => (e.w = Math.max(1, v)))),
      this.field(tr('common.height'), this.num(e.h, (v) => (e.h = Math.max(1, v)))),
      this.field(tr('sd.rotate'), this.num(e.rotate ?? 0, (v) => (e.rotate = v || undefined), 1)),
      this.field(tr('sd.opacity'), this.num(e.opacity ?? 1, (v) => (e.opacity = v >= 1 ? undefined : Math.max(0, v)), 0.05)),
      this.field(tr('sd.shown'), this.sel(e.when ?? 'always', WHEN, (v) => (e.when = v === 'always' ? undefined : v)), true),
    ));

    const hasText = e.kind === 'text' || e.kind === 'back' || e.kind === 'start';
    if (hasText) {
      out.push(this.group(
        this.field(tr('sd.textPlaceholdersAllowed'), this.txt(e.text ?? '', (v) => (e.text = v), true), true),
        this.field(tr('common.font'), this.fontSelect(e.font, (v) => (e.font = v))),
        this.field(tr('common.size'), this.num(e.size ?? 28, (v) => (e.size = Math.max(4, v)))),
        this.field(tr('common.color'), this.color(e.color, (v) => (e.color = v), false)),
        this.field(tr('common.align'), this.sel(e.align ?? 'center', [['left', tr('common.left')], ['center', tr('common.center')], ['right', tr('common.right')]], (v) => (e.align = v))),
        this.field(tr('common.outline'), this.color(e.stroke, (v) => (e.stroke = v))),
        this.field(tr('ed.outlineWidth'), this.num(e.strokeWidth ?? Math.max(1, (e.size ?? 28) / 18), (v) => (e.strokeWidth = Math.min(40, Math.max(0, v))), 0.5)),
        this.field(tr('sd.glow'), this.color(e.glow, (v) => (e.glow = v))),
        this.field(tr('fx.gradientColor'), this.color(e.gradient, (v) => (e.gradient = v))),
        this.field(tr('fx.depthSize'), this.num(e.depth ?? 0, (v) => (e.depth = Math.min(30, Math.max(0, Math.round(v))) || undefined))),
        this.field(tr('fx.depthColor'), this.color(e.depthColor, (v) => (e.depthColor = v))),
        this.field(tr('fx.shadowColor'), this.color(e.shadowColor, (v) => (e.shadowColor = v))),
      ), this.check(tr('common.bold'), !!e.bold, (v) => (e.bold = v || undefined)), this.check(tr('sd.italic'), !!e.italic, (v) => (e.italic = v || undefined)),
      this.check(tr('sd.dropShadow'), !!e.shadow, (v) => (e.shadow = v || undefined)));
    }
    if (e.kind === 'box' || e.kind === 'back' || e.kind === 'start') {
      out.push(this.group(
        this.field(tr('common.fill'), this.color(e.fill, (v) => (e.fill = v))),
        this.field(tr('sd.border'), this.color(e.border, (v) => (e.border = v))),
        this.field(tr('sd.borderWidth'), this.num(e.borderWidth ?? 0, (v) => (e.borderWidth = Math.max(0, v)))),
        this.field(tr('sd.cornerRadius'), this.num(e.radius ?? 0, (v) => (e.radius = Math.max(0, v)))),
      ));
    }
    if (e.kind === 'image') out.push(this.group(this.field(tr('sd.picture'), this.asset(e.src, 'images', (v) => (e.src = v)), true)));
    if (e.kind === 'stars') {
      out.push(this.group(
        this.field(tr('sd.shows'), this.sel(e.source ?? 'difficulty', [['difficulty', tr('sd.difficulty')], ['earned', tr('sd.starsEarned')]], (v) => (e.source = v))),
        this.field(tr('common.stars'), this.num(e.count ?? 5, (v) => (e.count = Math.max(1, Math.min(10, Math.round(v)))))),
        this.field(tr('sd.onColor'), this.color(e.onColor, (v) => (e.onColor = v), false)),
        this.field(tr('sd.offColor'), this.color(e.offColor, (v) => (e.offColor = v), false)),
      ));
    }
    if (e.kind === 'progress') {
      out.push(this.group(
        this.field(tr('sd.doneColor'), this.color(e.onColor, (v) => (e.onColor = v), false)),
        this.field(tr('sd.restColor'), this.color(e.offColor, (v) => (e.offColor = v), false)),
      ));
    }
    if (e.kind === 'levelGrid') {
      e.button ??= { ...DEFAULT_BUTTON };
      const b: LevelButtonStyle = e.button;
      out.push(this.group(
        this.field(tr('sd.columns'), this.num(e.cols ?? 7, (v) => (e.cols = Math.max(1, Math.min(21, Math.round(v)))))),
        this.field(tr('sd.rows'), this.num(e.rows ?? 3, (v) => (e.rows = Math.max(1, Math.min(21, Math.round(v)))))),
        this.field(tr('sd.gap'), this.num(e.gap ?? 16, (v) => (e.gap = Math.max(0, v)))),
        this.field(tr('sd.shape'), this.sel(b.shape, SHAPES, (v) => (b.shape = v))),
        this.field(tr('common.fill'), this.color(b.fill, (v) => (b.fill = v ?? '#00000000'))),
        this.field(tr('sd.everyOtherFill'), this.color(b.fill2, (v) => (b.fill2 = v))),
        this.field(tr('sd.clearedFill'), this.color(b.clearedFill, (v) => (b.clearedFill = v))),
        this.field(tr('sd.border'), this.color(b.border, (v) => (b.border = v ?? '#00000000'))),
        this.field(tr('sd.borderWidth'), this.num(b.borderWidth, (v) => (b.borderWidth = Math.max(0, v)))),
        this.field(tr('sd.buttonPicture'), this.asset(b.image, 'images', (v) => (b.image = v)), true),
        this.field(tr('sd.numberFont'), this.fontSelect(b.font, (v) => (b.font = v))),
        this.field(tr('sd.numberSize'), this.num(b.numberSize, (v) => (b.numberSize = Math.max(6, v)))),
        this.field(tr('common.numberColor'), this.color(b.numberColor, (v) => (b.numberColor = v ?? '#000000'), false)),
        this.field(tr('sd.numberGlow'), this.color(b.numberGlow, (v) => (b.numberGlow = v))),
        this.field(tr('sd.digits'), this.sel(String(b.pad) as '0' | '2' | '3', [['0', '1'], ['2', '01'], ['3', '001']], (v) => (b.pad = Number(v)))),
      ), this.check(tr('sd.starsUnderTheNumber'), b.showStars, (v) => (b.showStars = v)), this.check(tr('sd.difficultyUnderTheNumber'), b.showDifficulty, (v) => (b.showDifficulty = v)));
    }
    return out;
  }
}
