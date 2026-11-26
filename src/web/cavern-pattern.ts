import type { Fill } from '../core/types';

/** Geological tiles with sparse readable fossils and mineral inclusions. */
export function drawCavernPattern(g: CanvasRenderingContext2D, f: Extract<Fill, { type: 'pattern' }>): boolean {
  if (!['fossilStrata', 'sulfurFloor', 'oilFossil', 'oilStone', 'gemVein', 'mineFloor'].includes(f.pattern)) return false;
  const oil = f.pattern === 'oilFossil' || f.pattern === 'oilStone';
  const gem = f.pattern === 'gemVein' || f.pattern === 'mineFloor';
  const wall = ['fossilStrata', 'oilFossil', 'gemVein'].includes(f.pattern);
  let seed = 11037;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  g.save();
  g.scale(f.size / 200, f.size / 200);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const stroke = (d: string, color: string, width: number) => {
    g.strokeStyle = color; g.lineWidth = width; g.stroke(new Path2D(d));
  };
  const fill = (d: string, color: string) => { g.fillStyle = color; g.fill(new Path2D(d)); };
  // Periodic strata continue through tile edges, with fine mineral grit underneath motifs.
  for (let row = -1; row < 6; row++) {
    g.beginPath();
    const base = row * 40;
    const phase = ((row % 5) + 5) % 5;
    for (let i = 0; i <= 40; i++) {
      const x = i * 5;
      const y = base + 6 * Math.sin(x / 200 * Math.PI * 2 + phase * 1.7) + 2 * Math.cos(x / 200 * Math.PI * 4);
      if (!i) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.globalAlpha = wall ? 0.32 : 0.16;
    g.strokeStyle = f.color; g.lineWidth = phase % 2 ? 2 : 6; g.stroke();
  }
  for (let i = 0; i < 420; i++) {
    g.globalAlpha = 0.08 + random() * 0.17;
    g.fillStyle = i % 3 ? f.color : '#ffffff';
    const x = random() * 200, y = random() * 200;
    g.fillRect(x, y, 0.4 + random() * 1.3, 0.4 + random());
  }
  g.globalAlpha = 1;
  const fossil = (x: number, y: number, scale: number, bone: boolean) => {
    g.save(); g.translate(x, y); g.rotate(-0.35); g.scale(scale, scale);
    const color = oil ? '#b8aa82' : '#e5d6a7';
    if (bone) {
      const shape = 'M-20 -3 C-32 -13 -34 4 -24 6 L22 6 C33 14 36 -3 25 -4 C34 -15 18 -18 18 -7 L-18 -7 C-18 -18 -34 -15 -26 -5 Z';
      stroke(shape, oil ? '#191c1c' : '#655236', 4);
      fill(shape, color);
      stroke('M-17 -2 L17 0', '#fff0cb', 1.5);
    } else {
      // Ammonite impression, including the chamber divisions along the outer coil.
      g.beginPath();
      for (let i = 0; i <= 100; i++) {
        const a = i / 100 * Math.PI * 4.5, r = 2 + i / 100 * 20;
        const px = Math.cos(a) * r, py = Math.sin(a) * r;
        if (!i) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.strokeStyle = color; g.lineWidth = 2.5; g.stroke();
      for (let i = 0; i < 15; i++) {
        const a = Math.PI * 2.5 + i / 14 * Math.PI * 2;
        const r = 2 + a / (Math.PI * 4.5) * 20;
        stroke(`M${Math.cos(a) * (r - 5)} ${Math.sin(a) * (r - 5)} L${Math.cos(a + 0.1) * r} ${Math.sin(a + 0.1) * r}`, color, 1);
      }
    }
    g.restore();
  };
  if (wall && !gem) {
    fossil(51, 56, 0.95, false);
    fossil(143, 140, 0.8, true);
    // A partially exposed rib fossil, still embedded in its bed of rock.
    stroke('M128 30 Q143 48 166 54', oil ? '#928a72' : '#d2bd8a', 2);
    for (let i = 0; i < 5; i++) stroke(`M${132 + i * 6} ${36 + i * 4} q-8 11 -3 17`, oil ? '#928a72' : '#d2bd8a', 1.5);
  }
  if (oil) {
    // Thick pools, not flowing water: almost black bodies and restrained iridescent slicks.
    for (const [x, y, scale] of [[57, 145, 1], [156, 65, 0.7]]) {
      g.save(); g.translate(x, y); g.scale(scale, scale);
      fill('M-37 -5 C-27 -25 -3 -16 10 -23 C34 -32 51 -7 37 10 C25 25 8 15 -8 22 C-31 28 -47 12 -37 -5 Z', '#0d151a');
      stroke('M-25 -8 Q-7 -19 12 -12 T33 -6', '#45615f', 2.4);
      stroke('M-16 10 Q1 15 22 6', '#51475e', 1.6);
      stroke('M-20 -9 Q-10 -14 0 -12', '#7b8a7b', 1);
      g.restore();
    }
  } else if (gem) {
    if (wall) {
      stroke('M-5 23 L33 37 L65 20 L93 43 L132 31 L167 12 L205 23 M31 37 L48 76 L31 110 L58 151 L46 200', '#575468', 4);
      stroke('M-5 23 L33 37 L65 20 L93 43 L132 31 L167 12 L205 23', '#c3c3ce', 1.3);
    }
    const crystal = (x: number, y: number, angle: number, scale: number, color: string) => {
      g.save(); g.translate(x, y); g.rotate(angle); g.scale(scale, scale);
      fill('M0 -30 L10 -17 L9 15 L-8 18 L-11 -15 Z', color);
      fill('M0 -30 L1 12 L-8 18 L-11 -15 Z', '#dce8e9');
      fill('M1 12 L10 -17 L9 15 L-8 18 Z', '#5d7185');
      stroke('M0 -25 L-6 -14 L-5 7', '#ffffff', 1);
      g.restore();
    };
    for (const [x, y] of [[45, 60], [148, 145]]) {
      const s = wall ? 1 : 0.32;
      crystal(x - 10 * s, y + 4 * s, -0.5, s * 0.7, '#b29ad8');
      crystal(x + 9 * s, y + 6 * s, 0.45, s * 0.8, '#66bcae');
      crystal(x, y, 0.1, s, '#8fcacb');
    }
    if (wall) fill('M129 40 L140 32 L152 39 L147 52 L135 55 Z M77 144 L86 137 L94 145 L85 157 Z', '#8c71b5');
  } else {
    // Sulfur deposits collect in the rock's fissures, leaving the walking surface quiet.
    g.globalAlpha = wall ? 0.85 : 0.3;
    stroke('M8 101 L25 96 L37 104 L54 98 M109 184 L129 177 L147 181 L164 171', '#d6bd4b', 3);
  }
  g.restore();
  return true;
}
