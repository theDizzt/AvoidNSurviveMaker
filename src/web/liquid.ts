/**
 * Pastel liquid pouring down the screen and pooling at the bottom.
 *
 * Metaballs on a low-resolution field (1 cell = SCALE css px): every droplet adds r²/d² to the field,
 * and pixels above a threshold are painted with the field-weighted mix of droplet colors. Droplets
 * that touch merge into streams and puddles like real liquid. The canvas is scaled up with CSS,
 * which also softens the edges.
 */

type RGB = [number, number, number];

/** Cool pastels: mint, sky, lilac, periwinkle, aqua, a touch of pink */
const PALETTE: RGB[] = [
  [158, 232, 210],
  [150, 210, 245],
  [196, 180, 238],
  [170, 186, 255],
  [148, 228, 236],
  [255, 189, 218],
];

const SCALE = 6;
const THRESHOLD = 0.6;
const GRAVITY = 70; // field cells / s²
const FPS = 30;

interface Drop {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  color: RGB;
  /** settled in the pool: shrinking away */
  pooled: boolean;
}

interface Stream {
  x: number;
  color: RGB;
  rate: number;
  acc: number;
  phase: number;
  /** pours in bursts so the streams aren't all identical */
  period: number;
}

interface Puddle {
  x: number;
  r: number;
  color: RGB;
  phase: number;
}

export class LiquidBackground {
  private readonly ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private image: ImageData | null = null;
  private field = new Float32Array(0);
  private cr = new Float32Array(0);
  private cg = new Float32Array(0);
  private cb = new Float32Array(0);
  private drops: Drop[] = [];
  private streams: Stream[] = [];
  private puddles: Puddle[] = [];
  private time = 0;
  private running = false;
  private raf = 0;
  private last = 0;
  private readonly reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.resize();
    window.addEventListener('resize', () => {
      this.resize();
      if (!this.running) this.render();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) cancelAnimationFrame(this.raf);
      else if (this.running) this.loop();
    });
  }

  /** Animate (menus) or freeze on the current frame (gameplay, editor) */
  setActive(active: boolean): void {
    if (active === this.running) return;
    this.running = active;
    cancelAnimationFrame(this.raf);
    if (active && !this.reduceMotion.matches) {
      this.last = performance.now();
      this.loop();
    } else {
      this.render();
    }
  }

  private resize(): void {
    this.w = Math.max(40, Math.ceil(window.innerWidth / SCALE));
    this.h = Math.max(40, Math.ceil(window.innerHeight / SCALE));
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    this.image = this.ctx.createImageData(this.w, this.h);
    const n = this.w * this.h;
    this.field = new Float32Array(n);
    this.cr = new Float32Array(n);
    this.cg = new Float32Array(n);
    this.cb = new Float32Array(n);

    const count = Math.max(3, Math.min(7, Math.round(this.w / 42)));
    this.streams = Array.from({ length: count }, (_, i) => ({
      x: ((i + 0.5) / count) * this.w + (Math.random() - 0.5) * (this.w / count) * 0.5,
      color: PALETTE[i % PALETTE.length],
      rate: 24 + Math.random() * 10,
      acc: 0,
      phase: Math.random() * Math.PI * 2,
      period: 5 + Math.random() * 4,
    }));
    const puddles = Math.max(4, Math.round(this.w / 26));
    this.puddles = Array.from({ length: puddles }, (_, i) => ({
      x: ((i + 0.5) / puddles) * this.w,
      r: this.h * (0.07 + Math.random() * 0.04),
      color: PALETTE[(i * 2 + 1) % PALETTE.length],
      phase: Math.random() * Math.PI * 2,
    }));
    this.drops = [];
    // Pre-warm so the streams have already reached the pool on the first frame
    for (let i = 0; i < FPS * 6; i++) this.step(1 / FPS);
    this.render();
  }

  private loop = (): void => {
    this.raf = requestAnimationFrame((now) => {
      const dt = (now - this.last) / 1000;
      if (dt >= 1 / FPS - 0.002) {
        this.last = now;
        this.step(Math.min(dt, 0.1));
        this.render();
      }
      if (this.running) this.loop();
    });
  };

  private step(dt: number): void {
    this.time += dt;
    const poolTop = this.h * 0.86;

    for (const s of this.streams) {
      // Bursty pour: rate swells and fades over each stream's period
      const swell = 0.2 + 0.8 * Math.max(0, Math.sin((this.time / s.period) * Math.PI * 2 + s.phase));
      s.acc += s.rate * swell * dt;
      while (s.acc >= 1) {
        s.acc -= 1;
        this.drops.push({
          x: s.x + Math.sin(this.time * 1.7 + s.phase) * 1.5,
          y: -4,
          vx: (Math.random() - 0.5) * 1.2,
          vy: 12 + Math.random() * 6,
          r: 3.4 + Math.random() * 1.6,
          color: s.color,
          pooled: false,
        });
      }
    }

    for (const d of this.drops) {
      if (!d.pooled) {
        d.vy += GRAVITY * dt;
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        if (d.y > poolTop) {
          d.pooled = true;
          d.vx = (Math.random() - 0.5) * 30;
          d.vy *= 0.15;
        }
      } else {
        // Spread out along the pool surface and dissolve into it
        d.vx *= 0.96;
        d.vy *= 0.9;
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        d.r -= dt * 1.4;
      }
    }
    this.drops = this.drops.filter((d) => d.r > 0.6 && d.y < this.h + 10);
  }

  private splat(x: number, y: number, r: number, color: RGB): void {
    const { w, h, field, cr, cg, cb } = this;
    const reach = r * 2.6;
    const x0 = Math.max(0, Math.floor(x - reach));
    const x1 = Math.min(w - 1, Math.ceil(x + reach));
    const y0 = Math.max(0, Math.floor(y - reach));
    const y1 = Math.min(h - 1, Math.ceil(y + reach));
    const r2 = r * r;
    for (let py = y0; py <= y1; py++) {
      const dy = py + 0.5 - y;
      const row = py * w;
      for (let px = x0; px <= x1; px++) {
        const dx = px + 0.5 - x;
        const v = r2 / (dx * dx + dy * dy + 0.25);
        const i = row + px;
        field[i] += v;
        cr[i] += v * color[0];
        cg[i] += v * color[1];
        cb[i] += v * color[2];
      }
    }
  }

  private render(): void {
    const { h, field, cr, cg, cb, image } = this;
    if (!image) return;
    field.fill(0);
    cr.fill(0);
    cg.fill(0);
    cb.fill(0);

    // Pour sources peeking in from the top edge
    for (const s of this.streams) this.splat(s.x, -3, 5.5, s.color);
    // Gently rolling pool along the bottom
    for (const p of this.puddles) {
      const y = h + p.r * 0.35 + Math.sin(this.time * 0.8 + p.phase) * 1.5;
      this.splat(p.x + Math.sin(this.time * 0.4 + p.phase) * 3, y, p.r, p.color);
    }
    // A pour thins out as it speeds up, so falling drops shrink with velocity
    for (const d of this.drops) {
      const thin = d.pooled ? 1 : Math.max(0.55, 1.1 - d.vy / 320);
      this.splat(d.x, d.y, d.r * thin, d.color);
    }

    const px = image.data;
    for (let i = 0, j = 0; i < field.length; i++, j += 4) {
      const f = field[i];
      if (f < THRESHOLD) {
        px[j + 3] = 0;
        continue;
      }
      // Soft edge: fade in just above the threshold, slightly brighter at the rim
      const edge = Math.min(1, (f - THRESHOLD) / 0.5);
      const rim = 1 + (1 - edge) * 0.08;
      px[j] = Math.min(255, (cr[i] / f) * rim);
      px[j + 1] = Math.min(255, (cg[i] / f) * rim);
      px[j + 2] = Math.min(255, (cb[i] / f) * rim);
      px[j + 3] = 90 + edge * 140;
    }
    this.ctx.putImageData(image, 0, 0);
  }
}
