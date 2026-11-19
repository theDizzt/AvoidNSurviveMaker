import type { Fill } from '../core/types';

export const PATTERN_RES = 4;

/** Shared tile renderer for the game and editor swatches. */
export function createPatternTile(f: Extract<Fill, { type: 'pattern' }>): HTMLCanvasElement {
  const s = f.size;
  const tile = document.createElement('canvas');
  tile.width = tile.height = Math.ceil(s * PATTERN_RES);
  const g = tile.getContext('2d');
  if (!g) return tile;
  g.scale(PATTERN_RES, PATTERN_RES);
  g.fillStyle = f.background;
  g.fillRect(0, 0, s, s);
  g.fillStyle = f.color;
  g.strokeStyle = f.color;
  switch (f.pattern) {
    case 'egyptian': {
      // Decorative ankh, sun and pyramid motifs; no font or image dependency.
      g.lineWidth = s * 0.035;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.globalAlpha = 0.75;
      g.beginPath();
      g.moveTo(0, s * 0.06); g.lineTo(s, s * 0.06);
      g.moveTo(0, s * 0.94); g.lineTo(s, s * 0.94);
      g.stroke();
      g.beginPath();
      g.ellipse(s * 0.27, s * 0.31, s * 0.095, s * 0.13, 0, 0, Math.PI * 2);
      g.moveTo(s * 0.27, s * 0.44); g.lineTo(s * 0.27, s * 0.79);
      g.moveTo(s * 0.12, s * 0.52); g.lineTo(s * 0.42, s * 0.52);
      g.stroke();
      g.beginPath();
      g.arc(s * 0.73, s * 0.28, s * 0.09, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.moveTo(s * 0.53, s * 0.8); g.lineTo(s * 0.73, s * 0.48);
      g.lineTo(s * 0.93, s * 0.8); g.closePath();
      g.moveTo(s * 0.73, s * 0.48); g.lineTo(s * 0.79, s * 0.8);
      g.stroke();
      break;
    }
    case 'sandBrick': {
      // Staggered sandstone courses, with reproducible fine pores.
      let seed = 1957;
      const random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4294967296;
      };
      g.globalAlpha = 0.18;
      for (let i = 0; i < 95; i++) {
        const x = random() * s, y = random() * s;
        g.fillRect(x, y, s * 0.012, s * 0.009);
      }
      g.globalAlpha = 0.65;
      g.lineWidth = s * 0.025;
      g.beginPath();
      for (const y of [0, 0.5, 1]) {
        g.moveTo(0, s * y); g.lineTo(s, s * y);
      }
      g.moveTo(s * 0.25, 0); g.lineTo(s * 0.25, s * 0.5);
      g.moveTo(s * 0.75, s * 0.5); g.lineTo(s * 0.75, s);
      g.stroke();
      g.globalAlpha = 0.12;
      g.fillRect(0, s * 0.025, s, s * 0.035);
      g.fillRect(0, s * 0.525, s, s * 0.035);
      break;
    }
    case 'bark': {
      // Vertical fissures between raised bark plates; every curve is periodic in the tile.
      const TAU = Math.PI * 2;
      const furrows = [[0.1, 0.04, 1, 0.4], [0.43, 0.05, 2, 2.1], [0.72, 0.035, 1, 4.2]];
      const furrowX = (x: number, a: number, k: number, p: number, y: number) =>
        s * (x + a * Math.sin(TAU * k * y + p) + a * 0.4 * Math.sin(TAU * (k + 1) * y + p * 2));
      // Soft highlights along the plate ridges
      g.globalAlpha = 0.14;
      g.lineWidth = s * 0.06;
      for (let i = 0; i < furrows.length; i++) {
        const [x, a, k, p] = furrows[i];
        const [nx, na, nk, np] = furrows[(i + 1) % furrows.length];
        for (const dx of [0, -s]) {
          g.beginPath();
          for (let j = 0; j <= 40; j++) {
            const y = j / 40;
            const left = furrowX(x, a, k, p, y);
            const right = furrowX(nx + (i === furrows.length - 1 ? 1 : 0), na, nk, np, y);
            g.lineTo((left + right) / 2 + dx, s * y);
          }
          g.stroke();
        }
      }
      // Deep fissures
      g.globalAlpha = 0.85;
      g.lineCap = 'round';
      for (const [x, a, k, p] of furrows) {
        g.lineWidth = s * (0.028 + a * 0.3);
        for (const dx of [-s, 0, s]) {
          g.beginPath();
          for (let j = 0; j <= 40; j++) {
            const y = j / 40;
            g.lineTo(furrowX(x, a, k, p, y) + dx, s * y);
          }
          g.stroke();
        }
      }
      // Short horizontal cracks that break the plates up
      g.globalAlpha = 0.55;
      g.lineWidth = s * 0.018;
      for (const [i, y] of [[0, 0.22], [1, 0.63], [2, 0.38], [0, 0.8], [1, 0.12], [2, 0.9]] as const) {
        const [x, a, k, p] = furrows[i];
        const [nx, na, nk, np] = furrows[(i + 1) % furrows.length];
        const x0 = furrowX(x, a, k, p, y);
        const x1 = furrowX(nx + (i === furrows.length - 1 ? 1 : 0), na, nk, np, y);
        for (const dx of [0, -s]) {
          g.beginPath();
          g.moveTo(x0 + dx, s * y);
          g.quadraticCurveTo((x0 + x1) / 2 + dx, s * (y + 0.035), x1 + dx, s * (y - 0.01));
          g.stroke();
        }
      }
      break;
    }
    case 'woodGrain': {
      // Planed heartwood: flowing grain lines that bend around a central knot, plus fine pores.
      const TAU = Math.PI * 2;
      const bump = (x: number) => Math.pow((1 + Math.cos(TAU * (x - 0.5))) / 2, 6);
      const grain = (y0: number, x: number) => {
        const side = y0 < 0.5 ? -1 : 1;
        const near = Math.max(0, 1 - Math.abs(y0 - 0.5) * 3.2);
        return y0 + 0.025 * Math.sin(TAU * x + y0 * 9) + 0.012 * Math.sin(TAU * 3 * x + y0 * 23)
          + side * 0.13 * near * bump(x);
      };
      g.lineCap = 'round';
      const lines = [0.04, 0.12, 0.17, 0.26, 0.33, 0.39, 0.45, 0.55, 0.61, 0.68, 0.76, 0.83, 0.9, 0.96];
      lines.forEach((y0, i) => {
        g.globalAlpha = i % 3 === 0 ? 0.55 : 0.28;
        g.lineWidth = s * (i % 3 === 0 ? 0.022 : 0.012);
        g.beginPath();
        for (let j = 0; j <= 48; j++) {
          const x = j / 48;
          g.lineTo(s * x, s * grain(y0, x));
        }
        g.stroke();
      });
      // Knot
      g.globalAlpha = 0.4;
      g.beginPath();
      g.ellipse(s * 0.5, s * 0.5, s * 0.035, s * 0.022, 0, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 0.22;
      g.lineWidth = s * 0.012;
      g.beginPath();
      g.ellipse(s * 0.5, s * 0.5, s * 0.07, s * 0.045, 0, 0, Math.PI * 2);
      g.stroke();
      // Pores: short dashes following the grain
      let seed = 4111;
      const random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4294967296;
      };
      g.globalAlpha = 0.2;
      g.lineWidth = s * 0.008;
      for (let i = 0; i < 40; i++) {
        const x = random() * 0.92, y0 = random();
        const len = 0.03 + random() * 0.05;
        g.beginPath();
        g.moveTo(s * x, s * grain(y0, x));
        g.lineTo(s * (x + len), s * grain(y0, x + len));
        g.stroke();
      }
      break;
    }
    case 'stripes':
      g.fillRect(0, 0, s, s / 2);
      break;
    case 'diagonal':
      // Three strokes so the band continues seamlessly across tile edges
      g.lineWidth = s * 0.3;
      g.beginPath();
      for (const o of [-s, 0, s]) {
        g.moveTo(o, s);
        g.lineTo(o + s, 0);
      }
      g.stroke();
      break;
    case 'dots':
      g.beginPath();
      g.arc(s / 2, s / 2, s * 0.22, 0, Math.PI * 2);
      g.fill();
      break;
    case 'grid': {
      const w = Math.max(1, s * 0.08);
      g.fillRect(0, 0, s, w);
      g.fillRect(0, 0, w, s);
      break;
    }
    case 'checker':
      g.fillRect(0, 0, s / 2, s / 2);
      g.fillRect(s / 2, s / 2, s / 2, s / 2);
      break;
    case 'wood': {
      // Two staggered boards with subtle grain and a knot; seams repeat at tile edges.
      g.lineWidth = s * 0.045;
      g.beginPath();
      g.moveTo(0, s * 0.02); g.lineTo(s, s * 0.02);
      g.moveTo(0, s * 0.52); g.lineTo(s, s * 0.52);
      g.moveTo(s * 0.23, 0); g.lineTo(s * 0.23, s * 0.5);
      g.moveTo(s * 0.73, s * 0.5); g.lineTo(s * 0.73, s);
      g.stroke();
      g.globalAlpha = 0.35;
      g.lineWidth = s * 0.018;
      for (const y of [0.16, 0.36, 0.68, 0.84]) {
        g.beginPath();
        g.moveTo(0, s * y);
        g.bezierCurveTo(s * 0.3, s * (y - 0.07), s * 0.7, s * (y + 0.07), s, s * y);
        g.stroke();
      }
      g.beginPath();
      g.ellipse(s * 0.57, s * 0.26, s * 0.1, s * 0.04, 0, 0, Math.PI * 2);
      g.stroke();
      break;
    }
    case 'grass': {
      // Offset tufts, each made from three tapered blades.
      for (const [x, y, h] of [[0.2, 0.43, 0.25], [0.7, 0.27, 0.18], [0.58, 0.88, 0.29], [0.12, 0.91, 0.16], [0.88, 0.65, 0.21]]) {
        g.globalAlpha = 0.5 + h;
        g.beginPath();
        g.moveTo(s * x, s * y);
        g.quadraticCurveTo(s * (x - 0.13), s * (y - h), s * (x - 0.14), s * (y - h));
        g.lineTo(s * (x - 0.025), s * (y - 0.06));
        g.lineTo(s * (x + 0.02), s * (y - h - 0.04));
        g.lineTo(s * (x + 0.055), s * (y - 0.07));
        g.lineTo(s * (x + 0.14), s * (y - h * 0.65));
        g.lineTo(s * (x + 0.065), s * y);
        g.closePath();
        g.fill();
      }
      break;
    }
    case 'sand': {
      // Seeded grains stay identical in previews, replays and after reloading.
      let seed = 713;
      const random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4294967296;
      };
      for (let i = 0; i < 65; i++) {
        const x = random() * s, y = random() * s;
        const r = s * (0.007 + random() * 0.012);
        g.globalAlpha = 0.15 + random() * 0.4;
        // Wrap grains that straddle a tile boundary.
        for (const dx of [-s, 0, s]) for (const dy of [-s, 0, s]) {
          g.beginPath();
          g.arc(x + dx, y + dy, r, 0, Math.PI * 2);
          g.fill();
        }
      }
      g.globalAlpha = 0.18;
      g.lineWidth = s * 0.018;
      for (const y of [0.3, 0.75]) {
        g.beginPath();
        g.moveTo(0, s * y);
        g.bezierCurveTo(s / 3, s * (y - 0.12), s * 2 / 3, s * (y + 0.12), s, s * y);
        g.stroke();
      }
      break;
    }
    case 'metal': {
      // Brushed panel, recessed seams and four rivets.
      const shine = g.createLinearGradient(0, 0, s, s);
      shine.addColorStop(0, f.background);
      shine.addColorStop(0.45, f.color);
      shine.addColorStop(0.55, f.color);
      shine.addColorStop(1, f.background);
      g.globalAlpha = 0.3;
      g.fillStyle = shine;
      g.fillRect(0, 0, s, s);
      g.fillStyle = f.color;
      g.globalAlpha = 0.12;
      for (let i = 1; i < 16; i++) g.fillRect(0, s * i / 16, s, s * 0.008);
      g.globalAlpha = 0.8;
      g.lineWidth = s * 0.035;
      g.strokeRect(s * 0.018, s * 0.018, s * 0.964, s * 0.964);
      for (const x of [0.14, 0.86]) for (const y of [0.14, 0.86]) {
        g.beginPath();
        g.arc(s * x, s * y, s * 0.035, 0, Math.PI * 2);
        g.fill();
      }
      break;
    }
  }
  return tile;
}
