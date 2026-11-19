import { t, type MessageKey } from '../core/i18n';
import {
  drawPointer, drawSkinTrail, onSkinChange, PALETTE, PALETTE_COLUMNS, POINTER_SKINS, resetSkin, setSkin, skin, TRAIL_SKINS, type Skin,
} from './skin';
import { fitRotatedGrid } from './campaign-ui';

const FLOOR = '#f4ecd8';
const WALL = '#8a7a5c';
const PREVIEW = 260;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

/** Diamond tile at a grid cell; its upright content goes in the returned .dtile-in box */
function tile<K extends 'div' | 'button'>(tag: K, className: string, col: string, row: string): [HTMLElementTagNameMap[K], HTMLElement] {
  const node = el(tag, `dtile ${className}`);
  if (node instanceof HTMLButtonElement) node.type = 'button';
  node.style.gridColumn = col;
  node.style.gridRow = row;
  const inner = el('span', 'dtile-in');
  node.append(inner);
  return [node, inner];
}

/** Canvas sized for the device pixel ratio; draw in CSS pixels */
function hiDpiCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = el('canvas');
  const dpr = window.devicePixelRatio || 1;
  c.width = Math.round(w * dpr);
  c.height = Math.round(h * dpr);
  c.style.width = `${w}px`;
  c.style.height = `${h}px`;
  const g = c.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return [c, g];
}

/** A wavy sample trail for the trail tile (CSS px) */
function sampleTrail(w: number, h: number): number[] {
  const pts: number[] = [];
  for (let i = 0; i <= 40; i++) pts.push(6 + ((w - 12) * i) / 40, h / 2 + Math.sin((i / 40) * Math.PI * 2) * (h / 4));
  return pts;
}

function drawSystemCursor(g: CanvasRenderingContext2D, x: number, y: number, k = 1): void {
  g.save();
  g.translate(x, y);
  g.scale(k, k);
  g.fillStyle = '#fff';
  g.strokeStyle = '#111';
  g.lineWidth = 1.2;
  g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(0, 17);
  g.lineTo(4, 13);
  g.lineTo(7, 19.5);
  g.lineTo(9.5, 18.4);
  g.lineTo(6.6, 12.2);
  g.lineTo(12, 12.2);
  g.closePath();
  g.fill();
  g.stroke();
  g.restore();
}

/**
 * Customize screen as a 45°-turned grid like the other menus:
 * live preview (2×2), pointer skin and trail skin pickers, the two color slots, the 64-color palette
 * (2×2, one diamond per color), Reset and Back (static in index.html).
 * Skins are numbered; #0 is "none" for both (system cursor / no trail).
 */
export class CustomizeUI {
  private readonly pctx: CanvasRenderingContext2D;
  private readonly pointerIcon: CanvasRenderingContext2D;
  private readonly trailIcon: CanvasRenderingContext2D;
  private readonly pointerName: HTMLElement;
  private readonly trailName: HTMLElement;
  private readonly slots: Record<'primary' | 'accent', HTMLButtonElement>;
  private readonly swatches: HTMLButtonElement[] = [];
  /** Which color slot the palette sets */
  private target: 'primary' | 'accent' = 'primary';
  private raf = 0;
  private readonly trail: number[] = [];
  private readonly t0 = performance.now();

  constructor(private readonly grid: HTMLElement) {
    const nodes: HTMLElement[] = [];

    // Preview
    const [previewTile, previewIn] = tile('div', 'cz-preview-tile', '1 / span 2', '1 / span 2');
    const [preview, pctx] = hiDpiCanvas(PREVIEW, PREVIEW);
    preview.className = 'cz-preview';
    preview.setAttribute('role', 'img');
    preview.setAttribute('aria-label', t('customize.preview'));
    previewIn.append(preview);
    this.pctx = pctx;
    nodes.push(previewTile);

    // Pointer and trail skins: icon, number and name, ‹ › to step through
    const picker = (col: string, title: MessageKey, count: number, current: () => number, pick: (n: number) => void, iconW: number): [CanvasRenderingContext2D, HTMLElement] => {
      const [node, inner] = tile('div', 'cz-picker', col, '1');
      const [icon, g] = hiDpiCanvas(iconW, 44);
      const name = el('strong', 'cz-name');
      const arrows = el('span', 'dpill-row');
      for (const [dir, text, label] of [[-1, '‹', 'customize.prev'], [0, '▦', 'customize.showAll'], [1, '›', 'customize.next']] as const) {
        const b = el('button', 'dpill cz-step', text);
        b.type = 'button';
        b.setAttribute('aria-label', `${t(title)}: ${t(label)}`);
        b.title = t(label);
        b.addEventListener('click', () => {
          if (dir === 0) this.openList(title === 'customize.pointerSkin' ? 'pointer' : 'trail', b);
          else pick((current() + dir + count) % count);
        });
        arrows.append(b);
      }
      inner.append(el('small', 'dstat-label', t(title)), icon, name, arrows);
      node.setAttribute('role', 'group');
      node.setAttribute('aria-label', t(title));
      nodes.push(node);
      return [g, name];
    };
    [this.pointerIcon, this.pointerName] = picker('3', 'customize.pointerSkin', POINTER_SKINS.length, () => skin.pointer, (n) => setSkin({ pointer: n }), 44);
    [this.trailIcon, this.trailName] = picker('4', 'customize.trailSkin', TRAIL_SKINS.length, () => skin.trail, (n) => setSkin({ trail: n }), 72);

    // Color slots: pick which one the palette sets
    const slot = (which: 'primary' | 'accent', col: string): HTMLButtonElement => {
      const [node, inner] = tile('button', 'cz-slot', col, '2');
      node.title = t(which === 'primary' ? 'customize.primaryHint' : 'customize.accentHint');
      node.addEventListener('click', () => {
        this.target = which;
        this.sync();
        this.swatches.find((b) => b.getAttribute('aria-checked') === 'true')?.focus();
      });
      inner.append(el('small', 'dstat-label', t(which === 'primary' ? 'customize.primary' : 'customize.accent')), el('span', 'cz-chip'), el('small', 'cz-hex'));
      nodes.push(node);
      return node;
    };
    this.slots = { primary: slot('primary', '3'), accent: slot('accent', '4') };

    // Palette: 8×8 colors laid in the tile's own (turned) frame, so every color is a diamond
    const [palTile] = tile('div', 'cz-palette-tile', '1 / span 2', '3 / span 2');
    palTile.querySelector('.dtile-in')!.remove();
    const pal = el('div', 'cz-palette');
    pal.style.setProperty('--cols', String(PALETTE_COLUMNS));
    pal.setAttribute('role', 'radiogroup');
    PALETTE.forEach((color, i) => {
      const b = el('button', 'cz-swatch');
      b.type = 'button';
      b.style.background = color;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', t('customize.colorN', { n: i + 1 }));
      b.title = `${i + 1} · ${color}`;
      b.addEventListener('click', () => setSkin({ [this.target]: color }));
      b.addEventListener('keydown', (e) => {
        // Arrow keys move on screen: the palette is turned 45°, so each key steps diagonally in the grid
        const step = { ArrowUp: -PALETTE_COLUMNS - 1, ArrowDown: PALETTE_COLUMNS + 1, ArrowLeft: PALETTE_COLUMNS - 1, ArrowRight: 1 - PALETTE_COLUMNS }[e.key];
        if (step === undefined) return;
        e.preventDefault();
        const next = this.swatches[i + step];
        if (!next) return;
        next.focus();
        next.click();
      });
      pal.append(b);
      this.swatches.push(b);
    });
    palTile.append(pal);
    nodes.push(palTile);

    // Reset
    const [reset, resetIn] = tile('button', 'cz-reset', '3', '3');
    resetIn.append(el('span', 'dicon', '↺'), el('strong', '', t('customize.reset')));
    reset.addEventListener('click', resetSkin);
    nodes.push(reset);
    nodes.push(tile('div', 'dtile-deco', '4', '3')[0], tile('div', 'dtile-deco', '3', '4')[0]);
    nodes.at(-1)!.setAttribute('aria-hidden', 'true');
    nodes.at(-2)!.setAttribute('aria-hidden', 'true');

    grid.prepend(...nodes);
    onSkinChange(() => this.sync());
    this.sync();
  }

  /** Draw pointer skin `n` into a 44×44 icon */
  private drawPointerIcon(g: CanvasRenderingContext2D, n: number): void {
    g.clearRect(0, 0, 44, 44);
    if (n === 0) drawSystemCursor(g, 16, 10);
    else if (POINTER_SKINS[n] === 'sword') drawPointer(g, { ...skin, pointer: n }, 10, 8, 1, 10);
    else drawPointer(g, { ...skin, pointer: n }, 22, POINTER_SKINS[n] === 'arrow' ? 12 : 22, 1, 16);
  }

  /** Draw trail skin `n` into a 72×44 icon */
  private drawTrailIcon(g: CanvasRenderingContext2D, n: number): void {
    g.clearRect(0, 0, 72, 44);
    if (n === 0) {
      g.strokeStyle = 'rgba(36,52,80,0.4)';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(36, 22, 11, 0, Math.PI * 2);
      g.moveTo(28, 30);
      g.lineTo(44, 14);
      g.stroke();
      return;
    }
    // At 2× so the thin plain line reads at icon size
    g.save();
    g.scale(2, 2);
    drawSkinTrail(g, { ...skin, trail: n }, sampleTrail(36, 22), 0.5);
    g.restore();
  }

  /** Every pointer or trail skin at once, as a small diamond grid over the screen */
  private openList(kind: 'pointer' | 'trail', opener: HTMLElement): void {
    const names = kind === 'pointer' ? POINTER_SKINS : TRAIL_SKINS;
    const cols = 3;
    const title = t(kind === 'pointer' ? 'customize.pointerSkin' : 'customize.trailSkin');
    const overlay = el('div', 'cz-overlay');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', title);
    const card = el('div', 'cz-overlay-card');
    const head = el('div', 'cz-overlay-head');
    const close = el('button', 'cz-overlay-close');
    close.append(el('span', '', '✕'));
    close.type = 'button';
    close.setAttribute('aria-label', t('common.close'));
    head.append(el('h3', '', title), close);
    const wrap = el('div', 'dia-wrap');
    const grid = el('div', 'dgrid dgrid-panel cz-list');
    grid.style.setProperty('--cols', String(cols));
    const cell = (n: number): [string, string] => [String((n % cols) + 1), String(Math.floor(n / cols) + 1)];
    const buttons: HTMLButtonElement[] = [];
    names.forEach((name, n) => {
      const [b, inner] = tile('button', 'cz-list-item', ...cell(n));
      const [icon, g] = hiDpiCanvas(kind === 'pointer' ? 44 : 72, 44);
      if (kind === 'pointer') this.drawPointerIcon(g, n);
      else this.drawTrailIcon(g, n);
      b.setAttribute('aria-pressed', String((kind === 'pointer' ? skin.pointer : skin.trail) === n));
      inner.append(icon, el('small', 'cz-num', `#${n}`), el('strong', '', t(`customize.${kind}.${name}` as MessageKey)));
      b.addEventListener('click', () => {
        setSkin(kind === 'pointer' ? { pointer: n } : { trail: n });
        done();
      });
      grid.append(b);
      buttons.push(b);
    });
    // Fill the last row so the grid stays a clean diamond
    for (let n = names.length; n % cols; n++) {
      const [deco] = tile('div', 'dtile-deco', ...cell(n));
      deco.setAttribute('aria-hidden', 'true');
      grid.append(deco);
    }
    wrap.append(grid);
    card.append(head, wrap);
    overlay.append(card);

    const fit = () => {
      const flat = window.innerWidth < 640;
      wrap.classList.toggle('dia-flat', flat);
      if (flat) {
        wrap.style.width = wrap.style.height = '';
        grid.style.transform = '';
      } else fitRotatedGrid(wrap, grid, Math.min(720, window.innerWidth * 0.9), window.innerHeight - 160, 1);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Keep Escape from also leaving the Customize screen
      e.preventDefault();
      e.stopPropagation();
      done();
    };
    const done = () => {
      overlay.remove();
      window.removeEventListener('resize', fit);
      window.removeEventListener('keydown', onKey, true);
      opener.focus();
    };
    close.addEventListener('click', done);
    overlay.addEventListener('pointerdown', (e) => {
      if (e.target === overlay) done();
    });
    window.addEventListener('resize', fit);
    window.addEventListener('keydown', onKey, true);
    (this.grid.closest('.screen') ?? document.body).append(overlay);
    fit();
    (buttons.find((b) => b.getAttribute('aria-pressed') === 'true') ?? buttons[0]).focus();
  }

  show(): void {
    this.sync();
    cancelAnimationFrame(this.raf);
    const tick = () => {
      if (this.grid.closest('[hidden]')) return;
      this.drawPreview(performance.now());
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private sync(): void {
    const name = (kind: 'pointer' | 'trail', n: number) =>
      `#${n} ${t(`customize.${kind}.${kind === 'pointer' ? POINTER_SKINS[n] : TRAIL_SKINS[n]}` as MessageKey)}`;
    this.pointerName.textContent = name('pointer', skin.pointer);
    this.trailName.textContent = name('trail', skin.trail);

    this.drawPointerIcon(this.pointerIcon, skin.pointer);
    this.drawTrailIcon(this.trailIcon, skin.trail);

    for (const which of ['primary', 'accent'] as const) {
      const b = this.slots[which];
      b.setAttribute('aria-pressed', String(this.target === which));
      b.querySelector<HTMLElement>('.cz-chip')!.style.background = skin[which];
      b.querySelector('.cz-hex')!.textContent = `${PALETTE.indexOf(skin[which]) + 1} · ${skin[which]}`;
    }
    const current = skin[this.target];
    this.swatches.forEach((b, i) => {
      const on = PALETTE[i] === current;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    this.swatches[0].parentElement!.setAttribute('aria-label', t(this.target === 'primary' ? 'customize.primary' : 'customize.accent'));
    this.drawPreview(performance.now());
  }

  /** The cursor tracing a loop over a diamond of floor, with its trail */
  private drawPreview(now: number): void {
    const g = this.pctx;
    const S = PREVIEW;
    const c = S / 2;
    g.clearRect(0, 0, S, S);
    g.fillStyle = WALL;
    g.beginPath();
    g.moveTo(c, 0);
    g.lineTo(S, c);
    g.lineTo(c, S);
    g.lineTo(0, c);
    g.closePath();
    g.fill();
    const f = c - 16;
    g.fillStyle = FLOOR;
    g.beginPath();
    g.moveTo(c, c - f);
    g.lineTo(c + f, c);
    g.lineTo(c, c + f);
    g.lineTo(c - f, c);
    g.closePath();
    g.fill();
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const a = reduced ? 1 : (now - this.t0) / 1000;
    const x = c + Math.sin(a * 1.3) * f * 0.55;
    const y = c + Math.sin(a * 2.6) * f * 0.35;
    this.trail.push(x, y);
    if (this.trail.length > 240) this.trail.splice(0, this.trail.length - 240);
    drawSkinTrail(g, skin as Skin, this.trail, 1);
    if (skin.pointer === 0) drawSystemCursor(g, x, y);
    else drawPointer(g, skin as Skin, x, y, 1, 10);
  }
}
