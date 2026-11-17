/** A viewport-sized colored curtain with a circular opening. */
export class IrisTransition {
  private active = false;
  private pending: { change: () => void; colors: readonly [string, string] } | null = null;

  constructor() {
    const block = (event: Event) => {
      if (!this.active) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    for (const name of ['pointerdown', 'pointerup', 'click', 'dblclick', 'keydown', 'keyup', 'wheel', 'touchstart']) {
      window.addEventListener(name, block, { capture: true, passive: false });
    }
  }

  run(change: () => void, colors: readonly [string, string]): void {
    if (this.active) {
      this.pending = { change, colors };
      return;
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      change();
      return;
    }
    this.active = true;
    void this.animate(change, colors);
  }

  private async animate(change: () => void, colors: readonly [string, string]): Promise<void> {
    const ns = 'http://www.w3.org/2000/svg';
    const curtain = document.createElementNS(ns, 'svg');
    curtain.setAttribute('aria-hidden', 'true');
    curtain.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:2147483647;pointer-events:all';
    const defs = document.createElementNS(ns, 'defs');
    const gradient = document.createElementNS(ns, 'linearGradient');
    gradient.id = 'screen-iris-gradient';
    gradient.setAttribute('x2', '1');
    gradient.setAttribute('y2', '1');
    colors.forEach((color, index) => {
      const stop = document.createElementNS(ns, 'stop');
      stop.setAttribute('offset', String(index));
      stop.setAttribute('stop-color', color);
      gradient.append(stop);
    });
    defs.append(gradient);
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('fill', 'url(#screen-iris-gradient)');
    path.setAttribute('fill-rule', 'evenodd');
    curtain.append(defs, path);
    const draw = (opening: number) => {
      const w = window.innerWidth, h = window.innerHeight;
      const x = w / 2, y = h / 2;
      const r = (Math.hypot(w, h) / 2 + 2) * opening;
      curtain.setAttribute('viewBox', `0 0 ${w} ${h}`);
      path.setAttribute('d', `M0 0H${w}V${h}H0Z` + (r > 0
        ? ` M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z` : ''));
    };
    const phase = (opening: boolean) => new Promise<void>((resolve) => {
      const start = performance.now();
      const frame = (now: number) => {
        const t = Math.min(1, (now - start) / 260);
        const eased = t * t * (3 - 2 * t);
        draw(opening ? eased : 1 - eased);
        if (t < 1) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
    draw(1);
    document.body.append(curtain);
    try {
      await phase(false);
      change();
      // Give screen layout and canvas rendering a frame under the closed curtain.
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await phase(true);
    } finally {
      curtain.remove();
      this.active = false;
      const pending = this.pending;
      this.pending = null;
      if (pending) this.run(pending.change, pending.colors);
    }
  }
}
