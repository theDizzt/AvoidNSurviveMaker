/**
 * A small custom right-click menu with nested submenus and keyboard navigation.
 * Only one menu is open at a time.
 */
export type MenuItem =
  | 'sep'
  | {
      label: string;
      /** Shortcut hint shown on the right */
      keys?: string;
      disabled?: boolean;
      /** Shows a check mark (toggle options) */
      checked?: boolean;
      danger?: boolean;
      action?: () => void;
      submenu?: MenuItem[];
    };

let root: HTMLElement | null = null;
let cleanup: (() => void) | null = null;
/** Per menu: closes its open submenu */
const subClosers = new WeakMap<HTMLElement, () => void>();

export function closeContextMenu(): void {
  cleanup?.();
  cleanup = null;
  root?.remove();
  root = null;
}

export function isContextMenuOpen(): boolean {
  return root !== null;
}

function place(menu: HTMLElement, x: number, y: number, flipX?: number): void {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const r = menu.getBoundingClientRect();
  let left = x;
  if (left + r.width > vw - 4) left = flipX !== undefined ? flipX - r.width : vw - 4 - r.width;
  const top = Math.min(y, vh - 4 - r.height);
  menu.style.left = `${Math.max(4, left)}px`;
  menu.style.top = `${Math.max(4, top)}px`;
}

function buildMenu(items: MenuItem[], level: number): HTMLElement {
  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  menu.setAttribute('role', 'menu');
  menu.dataset.level = String(level);
  subClosers.set(menu, () => closeSub());
  let openSub: { item: HTMLElement; sub: HTMLElement } | null = null;
  let timer = 0;

  const closeSub = () => {
    if (!openSub) return;
    subClosers.get(openSub.sub)?.();
    openSub.sub.remove();
    openSub.item.classList.remove('open');
    openSub.item.setAttribute('aria-expanded', 'false');
    openSub = null;
  };

  const openSubmenu = (el: HTMLElement, sub: MenuItem[], focusFirst: boolean) => {
    if (openSub?.item === el) return;
    closeSub();
    const m = buildMenu(sub, level + 1);
    document.body.append(m);
    const r = el.getBoundingClientRect();
    place(m, r.right - 2, r.top - 5, r.left + 2);
    el.classList.add('open');
    el.setAttribute('aria-expanded', 'true');
    openSub = { item: el, sub: m };
    if (focusFirst) (m.querySelector('.ctx-item:not([aria-disabled="true"])') as HTMLElement | null)?.focus();
  };

  for (const it of items) {
    if (it === 'sep') {
      const s = document.createElement('div');
      s.className = 'ctx-sep';
      s.setAttribute('role', 'separator');
      menu.append(s);
      continue;
    }
    const el = document.createElement('div');
    el.className = `ctx-item${it.danger ? ' danger' : ''}`;
    el.setAttribute('role', it.checked !== undefined ? 'menuitemcheckbox' : 'menuitem');
    el.tabIndex = -1;
    if (it.disabled) el.setAttribute('aria-disabled', 'true');
    if (it.checked !== undefined) el.setAttribute('aria-checked', String(it.checked));
    const check = document.createElement('span');
    check.className = 'ctx-check';
    check.textContent = it.checked ? '✓' : '';
    const label = document.createElement('span');
    label.className = 'ctx-label';
    label.textContent = it.label;
    const keys = document.createElement('span');
    keys.className = 'ctx-keys';
    keys.textContent = it.submenu ? '▸' : (it.keys ?? '');
    el.append(check, label, keys);

    if (it.submenu) {
      el.setAttribute('aria-haspopup', 'menu');
      el.setAttribute('aria-expanded', 'false');
      const sub = it.submenu;
      el.addEventListener('pointerenter', () => {
        clearTimeout(timer);
        if (!it.disabled) timer = window.setTimeout(() => openSubmenu(el, sub, false), 120);
      });
      el.addEventListener('click', () => !it.disabled && openSubmenu(el, sub, false));
      el.addEventListener('keydown', (e) => {
        if ((e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') && !it.disabled) {
          e.preventDefault();
          openSubmenu(el, sub, true);
        }
      });
    } else {
      el.addEventListener('pointerenter', () => {
        clearTimeout(timer);
        timer = window.setTimeout(closeSub, 200);
      });
      const run = () => {
        if (it.disabled) return;
        closeContextMenu();
        it.action?.();
      };
      el.addEventListener('click', run);
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          run();
        }
      });
    }
    el.addEventListener('pointermove', () => el.focus({ preventScroll: true }));
    menu.append(el);
  }

  menu.addEventListener('keydown', (e) => {
    const list = [...menu.querySelectorAll<HTMLElement>(':scope > .ctx-item:not([aria-disabled="true"])')];
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const d = e.key === 'ArrowDown' ? 1 : -1;
      list[(i + d + list.length) % list.length]?.focus();
    } else if (e.key === 'ArrowLeft' && level > 0) {
      e.preventDefault();
      // Back to the parent item
      const parentMenu = document.querySelector<HTMLElement>(`.ctx-menu[data-level="${level - 1}"]`);
      const parent = parentMenu?.querySelector<HTMLElement>('.ctx-item.open');
      if (parentMenu) subClosers.get(parentMenu)?.();
      parent?.focus();
    }
    e.stopPropagation();
  });
  return menu;
}

/** Open a menu at viewport position (x, y) */
export function openContextMenu(x: number, y: number, items: MenuItem[]): void {
  closeContextMenu();
  const menu = buildMenu(items, 0);
  root = menu;
  document.body.append(menu);
  place(menu, x, y);
  (menu.querySelector('.ctx-item') as HTMLElement | null)?.focus({ preventScroll: true });

  const inside = (t: EventTarget | null) => t instanceof Node && [...document.querySelectorAll('.ctx-menu')].some((m) => m.contains(t));
  const onDown = (e: PointerEvent) => {
    if (!inside(e.target)) closeContextMenu();
  };
  // Capture phase, so the page's own shortcuts don't fire while the menu is open. Keys aimed at
  // the menu reach its items and stop at the menu element (see buildMenu).
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      closeContextMenu();
    } else if (!inside(e.target)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      (menu.querySelector('.ctx-item:not([aria-disabled="true"])') as HTMLElement | null)?.focus();
    }
  };
  const onClose = () => closeContextMenu();
  window.addEventListener('pointerdown', onDown, true);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('blur', onClose);
  window.addEventListener('resize', onClose);
  cleanup = () => {
    window.removeEventListener('pointerdown', onDown, true);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('blur', onClose);
    window.removeEventListener('resize', onClose);
    document.querySelectorAll('.ctx-menu').forEach((m) => m.remove());
  };
}
