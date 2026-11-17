/**
 * App-styled hover tooltips in place of the browser's native `title` tooltips.
 *
 * Any element with a `title` works, including ones created later: on hover the title moves to
 * `data-tip` (so the native tooltip never appears) and our tooltip shows after a short delay.
 * `aria-label`s are left alone, so screen readers are unaffected.
 */
const SHOW_DELAY = 450;
const GAP = 8;

let tip: HTMLElement | null = null;
let target: HTMLElement | null = null;
let timer = 0;

function element(): HTMLElement {
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'app-tooltip';
    tip.setAttribute('role', 'tooltip');
    tip.hidden = true;
    document.body.append(tip);
  }
  return tip;
}

function hide(): void {
  clearTimeout(timer);
  target = null;
  if (tip) tip.hidden = true;
}

function show(el: HTMLElement): void {
  const text = el.dataset.tip;
  if (!text || !el.isConnected) return;
  const t = element();
  t.textContent = text;
  t.hidden = false;
  // Below the element, centered, kept on screen; above it when there is no room below
  const r = el.getBoundingClientRect();
  const w = t.offsetWidth;
  const h = t.offsetHeight;
  const left = Math.max(6, Math.min(window.innerWidth - w - 6, r.left + r.width / 2 - w / 2));
  let top = r.bottom + GAP;
  if (top + h > window.innerHeight - 6) top = r.top - GAP - h;
  t.style.left = `${left}px`;
  t.style.top = `${Math.max(6, top)}px`;
}

export function installTooltips(): void {
  document.addEventListener('pointerover', (e) => {
    const el = (e.target as Element | null)?.closest?.<HTMLElement>('[title], [data-tip]');
    if (!el) return;
    // Move a (possibly updated) title into data-tip so the browser doesn't show its own
    if (el.hasAttribute('title')) {
      const title = el.getAttribute('title') ?? '';
      el.removeAttribute('title');
      if (title) el.dataset.tip = title;
      else delete el.dataset.tip;
    }
    if (el === target) return;
    hide();
    if (!el.dataset.tip) return;
    target = el;
    timer = window.setTimeout(() => target === el && show(el), SHOW_DELAY);
  });
  document.addEventListener('pointerout', (e) => {
    if (target && !target.contains(e.relatedTarget as Node | null)) hide();
  });
  // Any click, key, scroll or drag hides it
  for (const type of ['pointerdown', 'keydown', 'wheel'] as const) document.addEventListener(type, hide, { capture: true, passive: true });
  window.addEventListener('scroll', hide, { capture: true, passive: true });
  window.addEventListener('blur', hide);
}
