/**
 * Floating editor panel: drag it by its title bar, collapse/expand it with the toggle button
 * (or a double-click on the title bar). Position and collapsed state are remembered per panel.
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
  collapsed?: boolean;
}

const STORAGE_PREFIX = 'avoid-n-survive:panel:';
/** Keep at least this much of a panel on screen so it can always be grabbed again */
const MIN_VISIBLE = 48;

export interface FloatingPanel {
  /** Re-apply position after the panel becomes visible or the window is resized */
  refresh(): void;
}

export function floatingPanel(el: HTMLElement, id: string): FloatingPanel {
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
    toggle!.title = collapsed ? 'Expand' : 'Collapse';
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

  const refresh = () => {
    if (state.x !== undefined && state.y !== undefined) place(state.x, state.y);
  };
  window.addEventListener('resize', refresh);

  setCollapsed(!!state.collapsed);
  refresh();
  return { refresh };
}
