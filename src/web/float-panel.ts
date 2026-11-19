import { t } from './i18n';
/**
 * Floating editor panel: drag it by its title bar, collapse/expand it with the toggle button
 * (or a double-click on the title bar). With `resizable`, its left, right and bottom edges and
 * bottom corners can be dragged to resize it (double-click an edge to restore the default size).
 * Position, size and collapsed state are remembered per panel.
 *
 * Expected markup:
 *   <aside class="editor-float">
 *     <div class="float-head"><span>Title</span><button class="float-toggle"></button></div>
 *     <div class="float-body">…</div>
 *   </aside>
 */

interface PanelState {
  x?: number;
  y?: number;
  /** Size set by resizing; unset = the stylesheet's default */
  w?: number;
  h?: number;
  collapsed?: boolean;
}

const STORAGE_PREFIX = 'avoid-n-survive:panel:';
/** Keep at least this much of a panel on screen so it can always be grabbed again */
const MIN_VISIBLE = 48;
const MIN_W = 160;
const MIN_H = 160;
/** Edges and corners a resizable panel can be dragged by (n = top stays fixed: the title bar moves the panel) */
const EDGES = ['w', 'e', 's', 'sw', 'se'] as const;
type Edge = (typeof EDGES)[number];

export interface FloatingPanel {
  /** Re-apply position after the panel becomes visible or the window is resized */
  refresh(): void;
}

export function floatingPanel(el: HTMLElement, id: string, opts: { resizable?: boolean } = {}): FloatingPanel {
  const head = el.querySelector<HTMLElement>('.float-head');
  const toggle = el.querySelector<HTMLButtonElement>('.float-toggle');
  if (!head || !toggle) throw new Error(`Floating panel "${id}" is missing its title bar`);
  let state = load();

  function load(): PanelState {
    try {
      const v = JSON.parse(localStorage.getItem(STORAGE_PREFIX + id) ?? '{}') as PanelState;
      return typeof v === 'object' && v ? v : {};
    } catch {
      return {};
    }
  }

  function save(): void {
    try {
      localStorage.setItem(STORAGE_PREFIX + id, JSON.stringify(state));
    } catch {
      /* storage unavailable */
    }
  }

  /** Apply the remembered size, clamped to the window */
  function applySize(): void {
    el.style.width = state.w ? `${Math.max(MIN_W, Math.min(state.w, window.innerWidth - 24))}px` : '';
    const top = el.getBoundingClientRect().top;
    el.style.height = state.h ? `${Math.max(MIN_H, Math.min(state.h, window.innerHeight - top - 12))}px` : '';
  }

  function place(x: number, y: number): void {
    const w = el.offsetWidth || MIN_VISIBLE;
    const h = head!.offsetHeight || MIN_VISIBLE;
    const cx = Math.min(Math.max(x, MIN_VISIBLE - w), window.innerWidth - MIN_VISIBLE);
    const cy = Math.min(Math.max(y, 0), window.innerHeight - h);
    el.style.left = `${cx}px`;
    el.style.top = `${cy}px`;
    el.style.right = 'auto';
    // Fit below its new top edge; the body scrolls when it's taller
    el.style.maxHeight = `${Math.max(h, window.innerHeight - cy - 12)}px`;
    state.x = cx;
    state.y = cy;
  }

  function setCollapsed(collapsed: boolean): void {
    state.collapsed = collapsed;
    el.classList.toggle('collapsed', collapsed);
    toggle!.setAttribute('aria-expanded', String(!collapsed));
    toggle!.textContent = collapsed ? '+' : '−';
    toggle!.title = t(collapsed ? 'panel.expand' : 'panel.collapse');
    save();
  }

  toggle.addEventListener('click', () => setCollapsed(!state.collapsed));
  head.addEventListener('dblclick', (e) => {
    if (!(e.target as Element).closest('button')) setCollapsed(!state.collapsed);
  });

  head.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || (e.target as Element).closest('button')) return;
    e.preventDefault();
    const r = el.getBoundingClientRect();
    const dx = e.clientX - r.left;
    const dy = e.clientY - r.top;
    head.setPointerCapture(e.pointerId);
    el.classList.add('dragging');
    const move = (ev: PointerEvent) => place(ev.clientX - dx, ev.clientY - dy);
    const end = () => {
      head.removeEventListener('pointermove', move);
      head.removeEventListener('pointerup', end);
      head.removeEventListener('pointercancel', end);
      el.classList.remove('dragging');
      save();
    };
    head.addEventListener('pointermove', move);
    head.addEventListener('pointerup', end);
    head.addEventListener('pointercancel', end);
  });

  if (opts.resizable) {
    el.classList.add('resizable');
    for (const edge of EDGES) {
      const grip = document.createElement('div');
      grip.className = `float-resize rz-${edge}`;
      grip.setAttribute('aria-hidden', 'true');
      grip.title = t('panel.resizeHint');
      grip.addEventListener('pointerdown', (e) => startResize(e, edge, grip));
      grip.addEventListener('dblclick', () => {
        state.w = state.h = undefined;
        applySize();
        refresh();
        save();
      });
      el.append(grip);
    }
  }

  function startResize(e: PointerEvent, edge: Edge, grip: HTMLElement): void {
    if (e.button !== 0 || state.collapsed) return;
    e.preventDefault();
    const r = el.getBoundingClientRect();
    // Pin the panel by its left/top edge so growing one side doesn't move the other
    place(r.left, r.top);
    grip.setPointerCapture(e.pointerId);
    el.classList.add('resizing');
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - e.clientX;
      const dy = ev.clientY - e.clientY;
      if (edge.includes('w')) {
        const left = Math.min(Math.max(0, r.left + dx), r.right - MIN_W);
        state.w = r.right - left;
        el.style.left = `${left}px`;
        state.x = left;
      }
      if (edge.includes('e')) state.w = Math.min(Math.max(MIN_W, r.width + dx), window.innerWidth - r.left);
      if (edge.includes('s')) state.h = Math.min(Math.max(MIN_H, r.height + dy), window.innerHeight - r.top - 12);
      el.style.maxHeight = 'none';
      applySize();
    };
    const end = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', end);
      grip.removeEventListener('pointercancel', end);
      el.classList.remove('resizing');
      refresh();
      save();
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
  }

  const refresh = () => {
    applySize();
    if (state.x !== undefined && state.y !== undefined) place(state.x, state.y);
    applySize(); // height depends on the (possibly clamped) top
  };
  window.addEventListener('resize', refresh);

  setCollapsed(!!state.collapsed);
  refresh();
  return { refresh };
}
