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
