/**
 * Diamond dial: a circular-style slider whose thumb travels around a diamond instead of a circle.
 *
 * The native <input type="range"> stays in the page (visually hidden) as the real control, so the
 * keyboard, labels, form state and `input` listeners keep working; the SVG only draws it and turns
 * pointer drags into values. The path starts just left of the bottom corner and runs clockwise
 * (left → top → right) back to just right of the bottom corner; the small gap at the bottom keeps
 * 0 and max apart, like the gap in a volume knob.
 */
const SVG_NS = 'http://www.w3.org/2000/svg';
const SIZE = 180;
const C = SIZE / 2;
const R = 78; // center to corner
const GAP = 0.06; // fraction of the perimeter left empty on each side of the bottom corner

/** Point at perimeter fraction t (0 = bottom corner, clockwise on screen) */
function pointAt(t: number): [number, number] {
  const u = (((t % 1) + 1) % 1) * 4;
  const edge = Math.min(3, Math.floor(u));
  const s = u - edge;
  // Corners in clockwise screen order: bottom, left, top, right
  const corners: [number, number][] = [[C, C + R], [C - R, C], [C, C - R], [C + R, C]];
  const [x0, y0] = corners[edge];
  const [x1, y1] = corners[(edge + 1) % 4];
  return [x0 + (x1 - x0) * s, y0 + (y1 - y0) * s];
}

/** Perimeter fraction (0 = bottom corner, clockwise) of the diamond point in direction (dx, dy) */
function fractionOf(dx: number, dy: number): number {
  const sum = Math.abs(dx) + Math.abs(dy);
  if (!sum) return 0;
  const ax = Math.abs(dx) / sum;
  const ay = Math.abs(dy) / sum;
  if (dx <= 0 && dy >= 0) return (0 + ax) / 4; // bottom → left
  if (dx <= 0 && dy < 0) return (1 + ay) / 4; // left → top
  if (dx > 0 && dy < 0) return (2 + ax) / 4; // top → right
  return (3 + ay) / 4; // right → bottom
}

const toT = (ratio: number) => GAP + ratio * (1 - 2 * GAP);
const fromT = (t: number) => (t - GAP) / (1 - 2 * GAP);

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

let gradientId = 0;

/** Blue → green along the track (left to right), for the dial and the progress fill */
function trackGradient(): { defs: SVGDefsElement; url: string } {
  const id = `ddial-grad-${++gradientId}`;
  const defs = el('defs', {});
  const grad = el('linearGradient', { id, x1: 0, y1: 0, x2: 1, y2: 0 });
  for (const [offset, color] of [[0, '#3a7ff0'], [0.5, '#2a9fe0'], [1, '#3ddc84']] as const) {
    grad.append(el('stop', { offset, 'stop-color': color }));
  }
  defs.append(grad);
  return { defs, url: `url(#${id})` };
}

/** Draw `input` as a diamond dial inside its parent. Returns a refresh for value changes made in code. */
export function installDiamondDial(input: HTMLInputElement): () => void {
  const min = Number(input.min || 0);
  const max = Number(input.max || 100);
  const step = Number(input.step || 1);

  // The open path: from the start of the gap, round through left, top and right, to the end of the gap
  const pts = [pointAt(GAP), pointAt(0.25), pointAt(0.5), pointAt(0.75), pointAt(1 - GAP)];
  const d = `M${pts.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join(' L')}`;

  const svg = el('svg', { class: 'ddial-svg', viewBox: `0 0 ${SIZE} ${SIZE}`, 'aria-hidden': 'true' });
  const { defs, url } = trackGradient();
  const track = el('path', { class: 'ddial-track', d, pathLength: 1 });
  const fill = el('path', { class: 'ddial-fill', d, pathLength: 1, stroke: url });
  const thumb = el('rect', { class: 'ddial-thumb', x: -8, y: -8, width: 16, height: 16, rx: 2 });
  svg.append(defs, track, fill, thumb);
  input.parentElement!.append(svg);

  const ratio = () => (Number(input.value) - min) / (max - min || 1);
  const refresh = () => {
    const r = Math.min(1, Math.max(0, ratio()));
    fill.setAttribute('stroke-dasharray', `${r} 1`);
    const [x, y] = pointAt(toT(r));
    thumb.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(45)`);
  };

  let last = 0; // ratio at the previous drag event, to stop the thumb jumping across the gap
  const setFromPointer = (e: PointerEvent, first: boolean) => {
    const box = svg.getBoundingClientRect(); // the dial ends up upright on screen, so the box is the dial
    const dx = e.clientX - (box.left + box.width / 2);
    const dy = e.clientY - (box.top + box.height / 2);
    let r = fromT(fractionOf(dx, dy));
    if (r < 0 || r > 1) r = first ? (r < 0.5 ? 0 : 1) : last < 0.5 ? 0 : 1; // inside the bottom gap
    else if (!first && Math.abs(r - last) > 0.5) r = last < 0.5 ? 0 : 1; // dragged across the gap
    last = r;
    const value = Math.round((min + r * (max - min)) / step) * step;
    if (String(value) === input.value) return;
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };

  svg.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    input.focus({ preventScroll: true });
    svg.setPointerCapture(e.pointerId);
    svg.classList.add('dragging');
    setFromPointer(e, true);
  });
  svg.addEventListener('pointermove', (e) => {
    if (svg.hasPointerCapture(e.pointerId)) setFromPointer(e, false);
  });
  const end = (e: PointerEvent) => {
    if (svg.hasPointerCapture(e.pointerId)) svg.releasePointerCapture(e.pointerId);
    svg.classList.remove('dragging');
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
  // A click on the tile's <label> would otherwise be forwarded to the hidden range
  svg.addEventListener('click', (e) => e.preventDefault());
  input.addEventListener('input', refresh);
  refresh();
  return refresh;
}

/**
 * Read-only progress in the same diamond: the track (open at the bottom corner) fills clockwise,
 * easing toward each new value. `onFrame` gets the ratio shown, e.g. to
 * print a percentage in the gap. Returns a setter for the target ratio (0–1).
 */
export function installDiamondProgress(host: HTMLElement, onFrame: (shown: number) => void): (ratio: number) => void {
  const pts = [pointAt(GAP), pointAt(0.25), pointAt(0.5), pointAt(0.75), pointAt(1 - GAP)];
  const d = `M${pts.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join(' L')}`;
  const svg = el('svg', { class: 'ddial-svg dprogress-svg', viewBox: `0 0 ${SIZE} ${SIZE}`, 'aria-hidden': 'true' });
  const { defs, url } = trackGradient();
  const track = el('path', { class: 'ddial-track', d, pathLength: 1 });
  const fill = el('path', { class: 'ddial-fill', d, pathLength: 1, stroke: url });
  svg.append(defs, track, fill);
  host.append(svg);

  let shown = 0;
  let target = 0;
  let raf = 0;
  const draw = () => {
    fill.setAttribute('stroke-dasharray', `${shown} 1`);
    onFrame(shown);
  };
  const step = () => {
    // Ease toward the target; snap when close so 100% is reached exactly
    shown += (target - shown) * 0.18;
    if (Math.abs(target - shown) < 0.002) shown = target;
    draw();
    raf = shown === target ? 0 : requestAnimationFrame(step);
  };
  draw();
  return (ratio) => {
    target = Math.min(1, Math.max(0, ratio));
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      shown = target;
      draw();
    } else if (!raf) raf = requestAnimationFrame(step);
  };
}
