import { t as tr } from './i18n';

/**
 * Color picker used by the theme panels: a swatch that opens a popover with a saturation /
 * brightness square, hue and opacity bars, a hex field (#rrggbb or #rrggbbaa) and recent colors.
 * The value is reported once a drag or edit is finished, so callers can save / record undo per pick.
 */

export interface ColorPickerOptions {
  /** Offer the opacity bar (values become #rrggbbaa when not fully opaque). Default true */
  alpha?: boolean;
  /** Offer "none" (reports undefined) */
  none?: boolean;
  /** Tooltip / accessible name */
  label?: string;
}

const RECENT_KEY = 'avoid-n-survive:recent-colors';
const RECENT_MAX = 14;

interface Hsva { h: number; s: number; v: number; a: number }

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** '#rgb', '#rrggbb' or '#rrggbbaa' → HSVA (null when unreadable) */
export function parseColor(hex: string | undefined): Hsva | null {
  if (!hex) return null;
  let m = /^#?([0-9a-f]{3})$/i.exec(hex.trim());
  let s = m ? m[1].split('').map((c) => c + c).join('') : '';
  if (!s) {
    m = /^#?([0-9a-f]{6}|[0-9a-f]{8})$/i.exec(hex.trim());
    if (!m) return null;
    s = m[1];
  }
  const r = parseInt(s.slice(0, 2), 16) / 255;
  const g = parseInt(s.slice(2, 4), 16) / 255;
  const b = parseInt(s.slice(4, 6), 16) / 255;
  const a = s.length === 8 ? parseInt(s.slice(6, 8), 16) / 255 : 1;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s: max ? d / max : 0, v: max, a };
}

function rgbOf({ h, s, v }: Hsva): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [f(5), f(3), f(1)].map((c) => Math.round(c * 255)) as [number, number, number];
}

const hex2 = (n: number) => Math.round(n).toString(16).padStart(2, '0');

/** HSVA → '#rrggbb', or '#rrggbbaa' when not fully opaque */
export function formatColor(c: Hsva, alpha = true): string {
  const [r, g, b] = rgbOf(c);
  const base = `#${hex2(r)}${hex2(g)}${hex2(b)}`;
  return alpha && c.a < 0.998 ? `${base}${hex2(c.a * 255)}` : base;
}

function recent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!parseColor(x)).slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

function remember(color: string): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([color, ...recent().filter((c) => c !== color)].slice(0, RECENT_MAX)));
  } catch {
    /* not remembered */
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

/** Drag on `area`: `fn` gets the pointer position as 0–1 fractions; `end` once released */
function dragArea(area: HTMLElement, fn: (x: number, y: number) => void, end: () => void): void {
  area.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    area.setPointerCapture(e.pointerId);
    const at = (ev: PointerEvent) => {
      const r = area.getBoundingClientRect();
      fn(clamp01((ev.clientX - r.left) / r.width), clamp01((ev.clientY - r.top) / r.height));
    };
    at(e);
    const move = (ev: PointerEvent) => at(ev);
    const up = () => {
      area.removeEventListener('pointermove', move);
      area.removeEventListener('pointerup', up);
      area.removeEventListener('pointercancel', up);
      end();
    };
    area.addEventListener('pointermove', move);
    area.addEventListener('pointerup', up);
    area.addEventListener('pointercancel', up);
  });
}

/** The open popover (only one at a time) */
let openPop: { el: HTMLElement; close: () => void } | null = null;

/**
 * A color swatch button; clicking it opens the picker. `onChange` gets the new color
 * (or undefined for "none").
 */
export function colorPicker(value: string | undefined, onChange: (v: string | undefined) => void, opts: ColorPickerOptions = {}): HTMLButtonElement {
  const alpha = opts.alpha !== false;
  let current = value;
  const swatch = el('button', 'cp-swatch');
  swatch.type = 'button';
  const well = el('span', 'cp-swatch-fill');
  const fill = el('span', 'cp-swatch-color');
  well.append(fill);
  swatch.append(well);
  if (opts.label) {
    swatch.title = opts.label;
    swatch.setAttribute('aria-label', opts.label);
  }
  const paint = () => {
    fill.style.background = current ?? 'transparent';
    swatch.classList.toggle('cp-none', !current);
    swatch.dataset.value = current ?? '';
  };
  paint();

  const commit = (v: string | undefined) => {
    if (v === current) return;
    current = v;
    paint();
    if (v) remember(v);
    onChange(v);
  };

  swatch.addEventListener('click', () => {
    if (openPop?.el.dataset.owner === swatch.dataset.cpId && swatch.dataset.cpId) {
      openPop?.close();
      return;
    }
    open();
  });

  function open(): void {
    openPop?.close();
    swatch.dataset.cpId = String(Math.random());
    const c: Hsva = parseColor(current) ?? { h: 210, s: 0.7, v: 0.9, a: 1 };
    const start = current;
    const pop = el('div', 'cp-pop');
    pop.dataset.owner = swatch.dataset.cpId;
    pop.setAttribute('role', 'dialog');

    const sv = el('div', 'cp-sv');
    const svThumb = el('span', 'cp-thumb');
    sv.append(svThumb);
    const hue = el('div', 'cp-bar cp-hue');
    const hueThumb = el('span', 'cp-bar-thumb');
    hue.append(hueThumb);
    const alphaBar = el('div', 'cp-bar cp-alpha');
    const alphaFill = el('span', 'cp-alpha-fill');
    const alphaThumb = el('span', 'cp-bar-thumb');
    alphaBar.append(alphaFill, alphaThumb);

    const row = el('div', 'cp-row');
    const compare = el('span', 'cp-compare');
    const was = el('span', 'cp-was');
    const now = el('span', 'cp-now');
    was.style.background = start ?? 'transparent';
    was.title = tr('cp.previous');
    was.addEventListener('click', () => {
      commit(start);
      Object.assign(c, parseColor(start) ?? c);
      sync();
    });
    compare.append(was, now);
    const hex = el('input', 'cp-hex');
    hex.spellcheck = false;
    hex.maxLength = 9;
    hex.setAttribute('aria-label', 'HEX');
    const pct = el('input', 'cp-pct');
    pct.type = 'number';
    pct.min = '0';
    pct.max = '100';
    pct.title = tr('cp.opacity');
    row.append(compare, hex);
    if (alpha) {
      const l = el('label', 'cp-pct-wrap');
      l.append(pct, document.createTextNode('%'));
      row.append(l);
    }

    const sync = (skipHex = false) => {
      const solid = formatColor({ ...c, a: 1 }, false);
      sv.style.background = `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent), hsl(${c.h} 100% 50%)`;
      svThumb.style.left = `${c.s * 100}%`;
      svThumb.style.top = `${(1 - c.v) * 100}%`;
      svThumb.style.background = solid;
      hueThumb.style.left = `${(c.h / 360) * 100}%`;
      alphaFill.style.background = `linear-gradient(to right, transparent, ${solid})`;
      alphaThumb.style.left = `${c.a * 100}%`;
      now.style.background = formatColor(c, alpha);
      if (!skipHex) hex.value = formatColor(c, alpha);
      pct.value = String(Math.round(c.a * 100));
    };
    const live = () => {
      sync();
      // Shown on the swatch while dragging; reported once released
      fill.style.background = formatColor(c, alpha);
      swatch.classList.remove('cp-none');
    };
    const done = () => commit(formatColor(c, alpha));

    dragArea(sv, (x, y) => {
      c.s = x;
      c.v = 1 - y;
      live();
    }, done);
    dragArea(hue, (x) => {
      c.h = x * 359.9;
      live();
    }, done);
    dragArea(alphaBar, (x) => {
      c.a = x;
      live();
    }, done);
    hex.addEventListener('input', () => {
      const p = parseColor(hex.value);
      if (!p) return;
      Object.assign(c, alpha ? p : { ...p, a: 1 });
      sync(true);
    });
    hex.addEventListener('change', () => {
      sync();
      done();
    });
    pct.addEventListener('change', () => {
      c.a = clamp01((Number(pct.value) || 0) / 100);
      sync();
      done();
    });

    pop.append(sv, hue);
    if (alpha) pop.append(alphaBar);
    pop.append(row);

    const swatches = recent();
    if (swatches.length || opts.none) {
      const list = el('div', 'cp-recent');
      if (opts.none) {
        const n = el('button', 'cp-chip cp-none');
        n.type = 'button';
        n.title = tr('common.none');
        n.addEventListener('click', () => {
          commit(undefined);
          close();
        });
        list.append(n);
      }
      for (const v of swatches) {
        const b = el('button', 'cp-chip');
        b.type = 'button';
        b.title = v;
        const f = el('span');
        f.style.background = v;
        b.append(f);
        b.addEventListener('click', () => {
          Object.assign(c, parseColor(v)!);
          if (!alpha) c.a = 1;
          sync();
          done();
        });
        list.append(b);
      }
      pop.append(list);
    }

    document.body.append(pop);
    // Below the swatch, kept on screen
    const r = swatch.getBoundingClientRect();
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    let left = Math.min(r.left, window.innerWidth - pw - 8);
    let top = r.bottom + 6;
    if (top + ph > window.innerHeight - 8) top = Math.max(8, r.top - ph - 6);
    left = Math.max(8, left);
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
    sync();

    const outside = (e: PointerEvent) => {
      if (!pop.contains(e.target as Node) && e.target !== swatch && !swatch.contains(e.target as Node)) close();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    function close(): void {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', key, true);
      pop.remove();
      if (openPop?.el === pop) openPop = null;
      paint();
    }
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', key, true);
    openPop = { el: pop, close };
    hex.focus();
    hex.select();
  }

  return swatch;
}
