import type { MapData, MapObject, Motion, Rect } from './types';

const wall = (r: Rect): MapObject => ({ role: 'wall', shape: { type: 'rect', ...r } });

const linear = (points: Motion['points'], speed: number, extra: Partial<Motion> = {}): Motion => ({
  type: 'linear',
  points,
  speed,
  repeat: 'pingpong',
  easing: 'none',
  delay: 0,
  clockwise: true,
  ...extra,
});

export const BUILTIN_LEVELS: MapData[] = [
  {
    v: 2,
    name: '1. Tutorial - Zigzag Corridor',
    author: 'Built-in',
    width: 800,
    height: 500,
    start: { x: 20, y: 220, w: 60, h: 60 },
    goal: { x: 720, y: 220, w: 60, h: 60 },
    objects: [
      { role: 'path', shape: { type: 'rect', x: 0, y: 180, w: 800, h: 140 } },
      wall({ x: 300, y: 180, w: 20, h: 90 }),
      wall({ x: 500, y: 230, w: 20, h: 90 }),
    ],
  },
  {
    v: 2,
    name: '2. Moving Walls',
    author: 'Built-in',
    width: 800,
    height: 500,
    start: { x: 20, y: 20, w: 60, h: 60 },
    goal: { x: 720, y: 420, w: 60, h: 60 },
    objects: [
      wall({ x: 300, y: 0, w: 20, h: 300 }),
      wall({ x: 480, y: 200, w: 20, h: 300 }),
      { ...wall({ x: 208, y: 0, w: 24, h: 140 }), motion: linear([{ x: 220, y: 430 }], 260) },
      { ...wall({ x: 388, y: 0, w: 24, h: 140 }), motion: linear([{ x: 400, y: 430 }], 260, { delay: -700 }) },
      { ...wall({ x: 568, y: 0, w: 24, h: 140 }), motion: linear([{ x: 580, y: 430 }], 260, { delay: -1400 }) },
    ],
  },
  {
    v: 2,
    name: '3. Patrol Zone',
    author: 'Built-in',
    width: 800,
    height: 500,
    start: { x: 15, y: 25, w: 50, h: 50 },
    goal: { x: 730, y: 420, w: 50, h: 50 },
    objects: [
      wall({ x: 0, y: 100, w: 700, h: 60 }),
      wall({ x: 100, y: 260, w: 700, h: 60 }),
      { ...wall({ x: 180, y: 20, w: 40, h: 60 }), motion: linear([{ x: 620, y: 50 }], 250) },
      { ...wall({ x: 242, y: 160, w: 16, h: 60 }), motion: linear([{ x: 250, y: 230 }], 60) },
      { ...wall({ x: 392, y: 160, w: 16, h: 60 }), motion: linear([{ x: 400, y: 230 }], 60, { delay: -333 }) },
      { ...wall({ x: 542, y: 160, w: 16, h: 60 }), motion: linear([{ x: 550, y: 230 }], 60, { delay: -666 }) },
      {
        ...wall({ x: 225, y: 335, w: 50, h: 50 }),
        motion: linear([{ x: 650, y: 360 }, { x: 650, y: 460 }, { x: 250, y: 460 }], 320, { repeat: 'loop' }),
      },
    ],
  },
  {
    v: 2,
    name: '4. Spin Cycle',
    author: 'Built-in',
    width: 800,
    height: 500,
    start: { x: 20, y: 220, w: 60, h: 60 },
    goal: { x: 720, y: 220, w: 60, h: 60 },
    objects: [
      wall({ x: 200, y: 0, w: 100, h: 130 }),
      wall({ x: 200, y: 370, w: 100, h: 130 }),
      {
        ...wall({ x: 240, y: 140, w: 20, h: 220 }),
        rotation: { pivot: { x: 250, y: 250 }, speed: 60, angle: 360, clockwise: true, repeat: 'loop', easing: 'none', delay: 0 },
      },
      {
        role: 'wall',
        shape: { type: 'ellipse', cx: 520, cy: 130, rx: 28, ry: 28 },
        motion: { type: 'circle', points: [{ x: 520, y: 250 }], speed: 240, repeat: 'loop', easing: 'none', delay: 0, clockwise: true },
      },
      {
        ...wall({ x: 540, y: 242, w: 160, h: 16 }),
        rotation: { pivot: { x: 620, y: 250 }, speed: 90, angle: 90, clockwise: false, repeat: 'loop', easing: 'inOut', delay: 0 },
      },
    ],
  },
  {
    v: 2,
    name: '5. Floating Bridge',
    author: 'Built-in',
    width: 800,
    height: 500,
    start: { x: 20, y: 220, w: 60, h: 60 },
    goal: { x: 720, y: 220, w: 60, h: 60 },
    objects: [
      {
        role: 'path',
        shape: {
          type: 'poly',
          points: [
            { x: 0, y: 190 },
            { x: 110, y: 150, smooth: true },
            { x: 220, y: 230, smooth: true },
            { x: 330, y: 190 },
            { x: 330, y: 310 },
            { x: 220, y: 350, smooth: true },
            { x: 110, y: 270, smooth: true },
            { x: 0, y: 310 },
          ],
        },
      },
      {
        role: 'path',
        shape: { type: 'rect', x: 320, y: 200, w: 80, h: 100 },
        // waits 1s at the dock so the player can step on, then shuttles to the island
        motion: linear([{ x: 540, y: 250 }], 120, { easing: 'inOut', delay: 1000 }),
      },
      { role: 'path', shape: { type: 'ellipse', cx: 670, cy: 250, rx: 110, ry: 90 } },
      {
        ...wall({ x: 620, y: 244, w: 100, h: 12 }),
        rotation: { pivot: { x: 670, y: 250 }, speed: 45, angle: 360, clockwise: true, repeat: 'loop', easing: 'none', delay: 0 },
      },
    ],
  },
];
