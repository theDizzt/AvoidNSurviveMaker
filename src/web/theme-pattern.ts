import type { Fill } from '../core/types';

export const PATTERN_RES = 4;

/** Reproducible random numbers: tiles look the same in previews, replays and after reloading */
function seeded(seed: number): () => number {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

/** Draw `fn` at the 9 tile offsets, so motifs that cross an edge continue on the other side */
function wrapped(s: number, fn: (dx: number, dy: number) => void): void {
  for (const dx of [-s, 0, s]) for (const dy of [-s, 0, s]) fn(dx, dy);
}

/** Mix of two #rrggbb colors, k = 0 → a, 1 → b */
function mix(a: string, b: string, k: number): string {
  const pa = parseInt(a.slice(1, 7), 16);
  const pb = parseInt(b.slice(1, 7), 16);
  const ch = (shift: number) => Math.round(((pa >> shift) & 255) * (1 - k) + ((pb >> shift) & 255) * k).toString(16).padStart(2, '0');
  return `#${ch(16)}${ch(8)}${ch(0)}`;
}

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
    case 'thicket': {
      // Dense undergrowth (chapter 4 walls): layers of arching blades and small leaves, darker
      // underneath and lit at the tips. Seeded and wrapped, so the tile repeats seamlessly.
      const random = seeded(4242);
      const TAU = Math.PI * 2;
      const deep = mix(f.background, f.color, 0.35);
      const lit = mix(f.color, '#ffffff', 0.35);
      const layers: [string, number, number][] = [[deep, 26, 0.9], [f.color, 22, 0.85], [lit, 12, 0.55]];
      for (const [col, count, alpha] of layers) {
        g.fillStyle = col;
        g.globalAlpha = alpha;
        for (let i = 0; i < count; i++) {
          const x = random() * s, y = random() * s;
          const h = s * (0.16 + random() * 0.22);
          const lean = (random() - 0.5) * 1.1;
          const w = s * (0.018 + random() * 0.02);
          const tipX = Math.sin(lean) * h, tipY = -Math.cos(lean) * h;
          wrapped(s, (dx, dy) => {
            const bx = x + dx, by = y + dy;
            g.beginPath();
            g.moveTo(bx - w, by);
            g.quadraticCurveTo(bx - w + tipX * 0.3, by + tipY * 0.6, bx + tipX, by + tipY);
            g.quadraticCurveTo(bx + w + tipX * 0.35, by + tipY * 0.55, bx + w, by);
            g.closePath();
            g.fill();
          });
        }
      }
      // Small round leaves among the blades
      g.fillStyle = lit;
      for (let i = 0; i < 9; i++) {
        const x = random() * s, y = random() * s, a = random() * TAU;
        const r = s * (0.025 + random() * 0.025);
        g.globalAlpha = 0.35 + random() * 0.35;
        wrapped(s, (dx, dy) => {
          g.beginPath();
          g.ellipse(x + dx, y + dy, r * 1.7, r, a, 0, TAU);
          g.fill();
        });
      }
      break;
    }
    case 'mud': {
      // Muddy track (chapter 4 paths): mottled earth, two wavy wheel ruts, wet puddles with a sheen
      // and a scatter of pebbles. `color` is the wet, dark mud; `background` the drier ground.
      const random = seeded(9091);
      const TAU = Math.PI * 2;
      const dry = mix(f.background, '#ffffff', 0.15);
      for (let i = 0; i < 18; i++) {
        const x = random() * s, y = random() * s;
        const rx = s * (0.06 + random() * 0.1), ry = rx * (0.45 + random() * 0.4), a = random() * 0.6 - 0.3;
        g.fillStyle = random() < 0.6 ? f.color : dry;
        g.globalAlpha = 0.12 + random() * 0.14;
        wrapped(s, (dx, dy) => {
          g.beginPath();
          g.ellipse(x + dx, y + dy, rx, ry, a, 0, TAU);
          g.fill();
        });
      }
      // Ruts: waves whose period fits the tile, dark in the groove with a lighter lip above
      g.lineCap = 'round';
      for (const [y0, phase] of [[0.3, 0], [0.72, 2.1]]) {
        const rut = (k: number) => s * (y0 + 0.035 * Math.sin(TAU * k + phase) + 0.015 * Math.sin(TAU * 2 * k + phase * 1.7));
        const strokes: [string, number, number, number][] = [[dry, 0.075, 0.3, -0.03], [f.color, 0.06, 0.6, 0]];
        for (const [col, width, alpha, off] of strokes) {
          g.strokeStyle = col;
          g.globalAlpha = alpha;
          g.lineWidth = s * width;
          for (const dx of [-s, 0, s]) {
            g.beginPath();
            for (let j = 0; j <= 48; j++) g.lineTo(s * (j / 48) + dx, rut(j / 48) + s * off);
            g.stroke();
          }
        }
      }
      // Puddles with a soft reflection
      for (const [x, y, rx, ry] of [[0.22, 0.52, 0.12, 0.05], [0.78, 0.12, 0.09, 0.04], [0.6, 0.9, 0.07, 0.03]]) {
        wrapped(s, (dx, dy) => {
          g.globalAlpha = 0.75;
          g.fillStyle = f.color;
          g.beginPath();
          g.ellipse(s * x + dx, s * y + dy, s * rx, s * ry, 0, 0, TAU);
          g.fill();
          g.globalAlpha = 0.22;
          g.fillStyle = '#ffffff';
          g.beginPath();
          g.ellipse(s * (x - rx * 0.3) + dx, s * (y - ry * 0.3) + dy, s * rx * 0.45, s * ry * 0.3, -0.15, 0, TAU);
          g.fill();
        });
      }
      // Pebbles
      const pebble = mix(f.background, '#ffffff', 0.35);
      for (let i = 0; i < 14; i++) {
        const x = random() * s, y = random() * s, r = s * (0.01 + random() * 0.014);
        const col = random() < 0.5 ? pebble : f.color;
        g.globalAlpha = 0.5;
        g.fillStyle = col;
        wrapped(s, (dx, dy) => {
          g.beginPath();
          g.arc(x + dx, y + dy, r, 0, TAU);
          g.fill();
        });
      }
      break;
    }
    case 'snow': {
      // Snowfield (chapter 5 walls): soft drifts shaded in `color` on the white `background`, with
      // fine flakes and a few glints.
      const random = seeded(5151);
      const TAU = Math.PI * 2;
      for (const [y0, phase, depth] of [[0.18, 0.4, 0.12], [0.5, 2.6, 0.15], [0.83, 4.4, 0.1]]) {
        const crest = (k: number) => s * (y0 + 0.05 * Math.sin(TAU * k + phase) + 0.02 * Math.sin(TAU * 3 * k + phase));
        // Drift shadow under the crest
        const grad = g.createLinearGradient(0, s * (y0 - 0.07), 0, s * (y0 + depth));
        grad.addColorStop(0, f.color);
        grad.addColorStop(1, f.background);
        g.fillStyle = grad;
        g.globalAlpha = 0.6;
        g.beginPath();
        g.moveTo(0, s * (y0 + depth));
        for (let j = 0; j <= 48; j++) g.lineTo(s * (j / 48), crest(j / 48));
        g.lineTo(s, s * (y0 + depth));
        g.closePath();
        g.fill();
        // Bright crest line
        g.globalAlpha = 0.8;
        g.strokeStyle = '#ffffff';
        g.lineWidth = s * 0.012;
        g.beginPath();
        for (let j = 0; j <= 48; j++) g.lineTo(s * (j / 48), crest(j / 48) - s * 0.006);
        g.stroke();
      }
      // Flakes
      g.fillStyle = f.color;
      for (let i = 0; i < 30; i++) {
        const x = random() * s, y = random() * s, r = s * (0.005 + random() * 0.008);
        g.globalAlpha = 0.25 + random() * 0.35;
        wrapped(s, (dx, dy) => {
          g.beginPath();
          g.arc(x + dx, y + dy, r, 0, TAU);
          g.fill();
        });
      }
      // Glints: tiny four-point stars
      g.fillStyle = '#ffffff';
      g.globalAlpha = 0.95;
      for (const [x, y, r] of [[0.34, 0.33, 0.03], [0.82, 0.62, 0.025], [0.12, 0.74, 0.02]]) {
        wrapped(s, (dx, dy) => {
          const cx = s * x + dx, cy = s * y + dy, R = s * r, q = R * 0.22;
          g.beginPath();
          g.moveTo(cx, cy - R); g.lineTo(cx + q, cy - q); g.lineTo(cx + R, cy); g.lineTo(cx + q, cy + q);
          g.lineTo(cx, cy + R); g.lineTo(cx - q, cy + q); g.lineTo(cx - R, cy); g.lineTo(cx - q, cy - q);
          g.closePath();
          g.fill();
        });
      }
      break;
    }
    case 'ice': {
      // Frozen path (chapter 5 paths): glassy sheen bands, a branching crack network in `color`,
      // and small trapped air bubbles.
      const random = seeded(7373);
      const TAU = Math.PI * 2;
      // Sheen: soft diagonal bands, drawn three times so they continue across the tile edges
      g.strokeStyle = '#ffffff';
      for (const [o, w, a] of [[0.15, 0.16, 0.08], [0.32, 0.05, 0.14], [0.62, 0.1, 0.07]]) {
        g.globalAlpha = a;
        g.lineWidth = s * w;
        g.beginPath();
        for (const k of [-1, 0, 1]) {
          g.moveTo(s * (o + k), s);
          g.lineTo(s * (o + k + 1), 0);
        }
        g.stroke();
      }
      // Cracks: jagged random walks with a few side branches
      g.strokeStyle = f.color;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      const crack = (x: number, y: number, a: number, steps: number, width: number, branch: boolean): void => {
        const pts: [number, number][] = [[x, y]];
        for (let i = 0; i < steps; i++) {
          a += (random() - 0.5) * 0.9;
          const len = s * (0.04 + random() * 0.05);
          x += Math.cos(a) * len;
          y += Math.sin(a) * len;
          pts.push([x, y]);
        }
        g.lineWidth = s * width;
        wrapped(s, (dx, dy) => {
          g.beginPath();
          for (const [px, py] of pts) g.lineTo(px + dx, py + dy);
          g.stroke();
        });
        if (branch) for (let i = 2; i < pts.length - 1; i += 3) {
          crack(pts[i][0], pts[i][1], a + (random() < 0.5 ? 1 : -1) * (0.8 + random() * 0.6), 2 + Math.floor(random() * 2), width * 0.6, false);
        }
      };
      g.globalAlpha = 0.8;
      crack(s * 0.08, s * 0.18, 0.55, 15, 0.016, true);
      g.globalAlpha = 0.55;
      crack(s * 0.6, s * 0.55, 2.5, 11, 0.012, true);
      // Bubbles
      g.strokeStyle = '#ffffff';
      g.lineWidth = s * 0.006;
      g.globalAlpha = 0.45;
      for (let i = 0; i < 10; i++) {
        const x = random() * s, y = random() * s, r = s * (0.008 + random() * 0.014);
        wrapped(s, (dx, dy) => {
          g.beginPath();
          g.arc(x + dx, y + dy, r, 0, TAU);
          g.stroke();
        });
      }
      break;
    }
    case 'iceCrystal': {
      // Ice cave walls (chapter 5, second design): faceted crystal. A jittered grid that repeats
      // with the tile is split into triangles, each facet a different brightness, with lit edges.
      const random = seeded(6262);
      const n = 4;
      const jitter: [number, number][] = [];
      for (let k = 0; k < n * n; k++) jitter.push([(random() - 0.5) * 0.6, (random() - 0.5) * 0.6]);
      const pt = (i: number, j: number): [number, number] => {
        const [jx, jy] = jitter[(((j % n) + n) % n) * n + (((i % n) + n) % n)];
        return [(s * (i + 0.5 + jx)) / n, (s * (j + 0.5 + jy)) / n];
      };
      const lit = mix(f.color, '#ffffff', 0.5);
      g.lineJoin = 'round';
      g.lineWidth = s * 0.008;
      g.strokeStyle = lit;
      for (let j = -1; j < n; j++) for (let i = -1; i < n; i++) {
        const a = pt(i, j), b = pt(i + 1, j), c = pt(i + 1, j + 1), d = pt(i, j + 1);
        const tris = (((i + j) % 2) + 2) % 2 === 0 ? [[a, b, c], [a, c, d]] : [[a, b, d], [b, c, d]];
        for (const tri of tris) {
          // Shade from the facet's place in the repeating grid, so wrapped copies match
          const shade = (Math.sin((((i % n) + n) % n) * 12.9898 + (((j % n) + n) % n) * 78.233 + (tri === tris[0] ? 0 : 3.1)) * 43758.5453) % 1;
          const k = Math.abs(shade);
          g.fillStyle = k > 0.7 ? lit : f.color;
          g.globalAlpha = 0.12 + k * 0.45;
          g.beginPath();
          g.moveTo(tri[0][0], tri[0][1]);
          g.lineTo(tri[1][0], tri[1][1]);
          g.lineTo(tri[2][0], tri[2][1]);
          g.closePath();
          g.fill();
          g.globalAlpha = 0.35;
          g.stroke();
        }
      }
      // A few bright glints on facet corners
      g.fillStyle = '#ffffff';
      g.globalAlpha = 0.8;
      for (const [i, j] of [[1, 1], [3, 2], [0, 3]]) {
        const [x, y] = pt(i, j);
        g.beginPath();
        g.arc(x, y, s * 0.012, 0, Math.PI * 2);
        g.fill();
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
