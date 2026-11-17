import type { Door, MapData, Point, Rect } from './types';

/** Channels (switch colors) that start ON: any switch or hold switch of that color set to start ON */
export function initialChannels(map: MapData): Uint8Array {
  const on = new Uint8Array(16);
  for (const o of map.objects) if (o.trigger?.initial) on[o.trigger.color] = 1;
  return on;
}

/** How far an automatic door is open (0–1) at time t: closed wait → opening → open wait → closing */
export function autoDoorOpen(d: Door, t: number): number {
  const cycle = 2 * (d.moveMs + d.waitMs);
  let p = ((t % cycle) + cycle) % cycle;
  if (p < d.waitMs) return 0;
  p -= d.waitMs;
  if (p < d.moveMs) return p / d.moveMs;
  p -= d.moveMs;
  if (p < d.waitMs) return 1;
  p -= d.waitMs;
  return 1 - p / d.moveMs;
}

/**
 * The two halves of a door, split across its long side, and how far each slides when fully open
 * (each half slides out by its own length, so the doorway clears completely).
 */
export function doorPanels(r: Rect): { rect: Rect; slide: Point }[] {
  if (r.w >= r.h) {
    const hw = r.w / 2;
    return [
      { rect: { x: r.x, y: r.y, w: hw, h: r.h }, slide: { x: -hw, y: 0 } },
      { rect: { x: r.x + hw, y: r.y, w: hw, h: r.h }, slide: { x: hw, y: 0 } },
    ];
  }
  const hh = r.h / 2;
  return [
    { rect: { x: r.x, y: r.y, w: r.w, h: hh }, slide: { x: 0, y: -hh } },
    { rect: { x: r.x, y: r.y + hh, w: r.w, h: hh }, slide: { x: 0, y: hh } },
  ];
}
