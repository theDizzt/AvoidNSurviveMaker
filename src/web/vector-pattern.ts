import type { Fill } from '../core/types';

/** Flat, seamless vector motifs. Coordinates use a 100-unit tile, independent of resolution. */
export function drawVectorPattern(g: CanvasRenderingContext2D, f: Extract<Fill, { type: 'pattern' }>): boolean {
  if (!f.pattern.startsWith('vector')) return false;
  g.save();
  g.scale(f.size / 100, f.size / 100);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const path = (d: string, color = f.color, stroke = 0) => {
    g.fillStyle = g.strokeStyle = color;
    g.lineWidth = stroke;
    const p = new Path2D(d);
    if (stroke) g.stroke(p); else g.fill(p);
  };
  const motifs = () => {
    switch (f.pattern) {
      case 'vectorBark':
        path('M12 -10 Q32 15 16 43 T18 110 M59 -10 Q40 22 58 54 T60 110 M91 -10 Q75 25 87 48 T91 110', f.color, 6);
        path('M32 12 Q46 24 34 38 Q25 26 32 12 M69 68 Q82 82 70 94 Q61 82 69 68');
        break;
      case 'vectorGrain':
        path('M-10 18 Q15 5 42 20 T110 18 M-10 48 Q20 35 38 51 Q53 67 70 50 T110 48 M-10 82 Q23 69 48 84 T110 82', f.color, 3);
        path('M43 42 Q54 30 66 42 Q54 53 43 42', f.color, 2);
        break;
      case 'vectorLeaves':
        path('M10 78 Q9 26 44 17 Q51 53 10 78 M55 105 Q48 61 86 47 Q98 79 55 105 M64 22 Q63 -8 92 -12 Q96 12 64 22');
        path('M10 78 L35 31 M55 105 L78 62 M64 22 L84 0', f.background, 2);
        break;
      case 'vectorSoil':
        path('M8 29 Q24 15 36 28 Q27 39 8 29 M58 72 Q78 56 94 70 Q75 82 58 72 M48 14 L57 10 L61 16 L53 20 Z');
        path('M10 68 Q22 62 33 67 M65 35 Q75 30 87 34', f.color, 2);
        break;
      case 'vectorSnow':
        path('M-10 74 Q10 48 36 65 T78 61 Q94 48 110 66 L110 110 L-10 110 Z');
        path('M15 25 L15 39 M8 32 L22 32 M67 16 L67 24 M63 20 L71 20', f.color, 2);
        break;
      case 'vectorIce':
        path('M0 0 L35 14 L21 57 L0 69 Z M35 14 L77 0 L68 48 L21 57 Z M68 48 L100 30 L100 83 L55 100 Z');
        path('M35 14 L21 57 L55 100 M21 57 L68 48 L100 30', f.background, 3);
        path('M40 26 L30 48 M76 64 L85 55', f.background, 2);
        break;
      case 'vectorRock':
      case 'vectorLava':
        path('M4 8 L39 3 L49 28 L32 49 L3 38 Z M48 4 L88 -4 L105 26 L89 45 L59 33 Z M4 49 L30 57 L43 88 L19 103 L-7 82 Z M43 51 L66 40 L96 54 L91 88 L53 98 L47 73 Z');
        path('M12 17 L33 13 M55 59 L65 53 L83 61', f.background, 3);
        break;
    }
  };
  for (const x of [-100, 0, 100]) for (const y of [-100, 0, 100]) {
    g.save(); g.translate(x, y); motifs(); g.restore();
  }
  g.restore();
  return true;
}
