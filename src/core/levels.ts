import type { MapData } from './types';

export const BUILTIN_LEVELS: MapData[] = [
  {
    v: 1,
    name: '1. 튜토리얼 - 지그재그 복도',
    author: '기본 맵',
    width: 800,
    height: 500,
    start: { x: 20, y: 220, w: 60, h: 60 },
    goal: { x: 720, y: 220, w: 60, h: 60 },
    walls: [
      { x: 100, y: 0, w: 600, h: 180 },
      { x: 100, y: 320, w: 600, h: 180 },
      { x: 300, y: 180, w: 20, h: 90 },
      { x: 500, y: 230, w: 20, h: 90 },
    ],
    movers: [],
  },
  {
    v: 1,
    name: '2. 움직이는 벽',
    author: '기본 맵',
    width: 800,
    height: 500,
    start: { x: 20, y: 20, w: 60, h: 60 },
    goal: { x: 720, y: 420, w: 60, h: 60 },
    walls: [
      { x: 300, y: 0, w: 20, h: 300 },
      { x: 480, y: 200, w: 20, h: 300 },
    ],
    movers: [
      { w: 24, h: 140, path: [{ x: 220, y: 70 }, { x: 220, y: 430 }], speed: 260, mode: 'pingpong', offset: 0 },
      { w: 24, h: 140, path: [{ x: 400, y: 70 }, { x: 400, y: 430 }], speed: 260, mode: 'pingpong', offset: 700 },
      { w: 24, h: 140, path: [{ x: 580, y: 70 }, { x: 580, y: 430 }], speed: 260, mode: 'pingpong', offset: 1400 },
    ],
  },
  {
    v: 1,
    name: '3. 순찰 구역',
    author: '기본 맵',
    width: 800,
    height: 500,
    start: { x: 15, y: 25, w: 50, h: 50 },
    goal: { x: 730, y: 420, w: 50, h: 50 },
    walls: [
      { x: 0, y: 100, w: 700, h: 60 },
      { x: 100, y: 260, w: 700, h: 60 },
    ],
    movers: [
      { w: 40, h: 60, path: [{ x: 200, y: 50 }, { x: 620, y: 50 }], speed: 250, mode: 'pingpong', offset: 0 },
      { w: 16, h: 60, path: [{ x: 250, y: 190 }, { x: 250, y: 230 }], speed: 60, mode: 'pingpong', offset: 0 },
      { w: 16, h: 60, path: [{ x: 400, y: 190 }, { x: 400, y: 230 }], speed: 60, mode: 'pingpong', offset: 333 },
      { w: 16, h: 60, path: [{ x: 550, y: 190 }, { x: 550, y: 230 }], speed: 60, mode: 'pingpong', offset: 666 },
      {
        w: 50, h: 50,
        path: [{ x: 250, y: 360 }, { x: 650, y: 360 }, { x: 650, y: 460 }, { x: 250, y: 460 }],
        speed: 320, mode: 'loop', offset: 0,
      },
    ],
  },
];
