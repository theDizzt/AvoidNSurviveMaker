/** Cosmetic only: uses wall-clock time, never changes simulation or replay state. */
export class DeathBurst {
  private readonly particles = Array.from({ length: 24 }, (_, i) => {
    const angle = i / 24 * Math.PI * 2 + (Math.random() - 0.5) * 0.2;
    const speed = 65 + Math.random() * 145;
    return { vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, size: 2 + Math.random() * 3, spin: Math.random() * 8 - 4 };
  });
  private readonly reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor(private readonly x: number, private readonly y: number, private readonly color: string, private readonly born: number) {}

  draw(ctx: CanvasRenderingContext2D, now: number, unit: number): boolean {
    const t = (now - this.born) / 1000;
    const duration = this.reduced ? 0.2 : 0.65;
    if (t >= duration) return false;
    const fade = 1 - t / duration;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.scale(unit, unit);
    ctx.globalAlpha = fade;
    ctx.strokeStyle = this.color;
    ctx.lineWidth = 2 * fade;
    ctx.beginPath();
    ctx.arc(0, 0, this.reduced ? 8 : 5 + 65 * t, 0, Math.PI * 2);
    ctx.stroke();
    if (!this.reduced) {
      for (const [i, p] of this.particles.entries()) {
        ctx.save();
        ctx.translate(p.vx * t, p.vy * t + 90 * t * t);
        ctx.rotate(p.spin * t);
        ctx.fillStyle = i % 4 === 0 ? '#ffffff' : this.color;
        const size = p.size * (0.4 + fade * 0.6);
        ctx.fillRect(-size / 2, -size / 2, size, size);
        ctx.restore();
      }
    }
    ctx.restore();
    return true;
  }
}
