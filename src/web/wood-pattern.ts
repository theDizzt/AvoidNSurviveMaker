import type { Fill } from '../core/types';

const TAU = Math.PI * 2;
const smooth = (v: number) => v * v * (3 - 2 * v);
const fract = (v: number) => v - Math.floor(v);
const hash = (x: number, y: number) => {
  let n = Math.imul(x + 71, 374761393) ^ Math.imul(y + 137, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
};

/** Periodic value noise: every octave joins across both tile boundaries. */
function noise(u: number, v: number, nx: number, ny: number): number {
  const x = fract(u) * nx, y = fract(v) * ny;
  const ix = Math.floor(x), iy = Math.floor(y);
  const sx = smooth(x - ix), sy = smooth(y - iy);
  const a = hash(ix, iy), b = hash((ix + 1) % nx, iy);
  const c = hash(ix, (iy + 1) % ny), d = hash((ix + 1) % nx, (iy + 1) % ny);
  return a + (b - a) * sx + (c - a + (a - b - c + d) * sx) * sy;
}

/** Detailed timber textures generated once per cached tile; no per-frame noise work. */
export function drawWoodPattern(tile: HTMLCanvasElement, f: Extract<Fill, { type: 'pattern' }>): boolean {
  if (f.pattern !== 'realisticBark' && f.pattern !== 'realisticGrain') return false;
  const g = tile.getContext('2d');
  if (!g) return true;
  const size = tile.width;
  const image = g.createImageData(size, size);
  const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const base = rgb(f.background), dark = rgb(f.color);
  const bark = f.pattern === 'realisticBark';
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const coarse = noise(u, v, 7, 9);
      const rough = noise(u, v, 91, 113) - 0.5;
      let shade: number, light: number;
      if (bark) {
        // Uneven vertical plates: deep fissures, raised lit lips and small transverse splits.
        const warp = u + (noise(u, v, 5, 11) - 0.5) * 0.11;
        const phase = warp * 13 + (noise(u, v, 17, 19) - 0.5) * 0.35;
        const ridge = fract(phase);
        const fissure = Math.exp(-Math.pow(Math.min(ridge, 1 - ridge) / 0.07, 2));
        const lip = Math.exp(-Math.pow((ridge - 0.16) / 0.1, 2));
        const split = Math.pow(Math.max(0, 1 - Math.abs(noise(warp, v, 18, 27) - 0.5) * 32), 3);
        const fibers = noise(warp, v, 145, 23);
        shade = Math.min(1, 0.12 + fissure * 0.85 + split * 0.3 + (1 - fibers) * 0.2);
        light = lip * 25 + (coarse - 0.5) * 35 + rough * 26;
      } else {
        // Long, fine growth rings bend around an elongated knot, rather than drawn stripes.
        const dx = Math.sin(Math.PI * (u - 0.43)) / Math.PI;
        const dy = Math.sin(Math.PI * (v - 0.54)) / Math.PI;
        const envelope = Math.exp(-(dx * dx * 30 + dy * dy * 150));
        const warp = v + 0.028 * Math.sin(TAU * u) + (noise(u, v, 4, 8) - 0.5) * 0.035;
        const rings = warp * 43 + envelope * 3.2;
        const latewood = Math.pow(0.5 + 0.5 * Math.sin(TAU * rings), 12);
        const fine = Math.pow(0.5 + 0.5 * Math.sin(TAU * (warp * 171 + noise(u, v, 9, 15))), 18);
        const knotRadius = Math.sqrt(dx * dx * 2 + dy * dy * 19);
        const knot = Math.exp(-knotRadius * knotRadius * 950);
        const knotRings = Math.pow(0.5 + 0.5 * Math.sin(knotRadius * 260), 8) * Math.exp(-knotRadius * knotRadius * 140);
        const pores = Math.max(0, noise(u, v, 110, 220) - 0.68) * 1.3;
        shade = Math.min(1, 0.08 + latewood * 0.34 + fine * 0.1 + knot * 0.8 + knotRings * 0.4 + pores);
        light = (coarse - 0.5) * 17 + rough * 9;
      }
      const at = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) image.data[at + c] = base[c] + (dark[c] - base[c]) * shade + light;
      image.data[at + 3] = 255;
    }
  }
  // putImageData ignores the context transform, so it writes at the tile's actual resolution.
  g.putImageData(image, 0, 0);
  return true;
}
