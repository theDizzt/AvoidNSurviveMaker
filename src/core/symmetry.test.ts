import { describe, expect, it } from 'vitest';
import { checkSymmetry } from './symmetry';
import type { MapData, MapObject, Shape } from './types';
import { createEmptyMap } from './validate';

const rect = (x: number, y: number, w: number, h: number): Shape => ({ type: 'rect', x, y, w, h });
const wall = (shape: Shape): MapObject => ({ role: 'wall', shape });

function map(objects: MapObject[]): MapData {
  const m = createEmptyMap();
  m.width = 640;
  m.height = 360;
  m.start = { x: 0, y: 140, w: 80, h: 80 };
  m.goal = { x: 560, y: 140, w: 80, h: 80 };
  m.objects = objects;
  return m;
}

describe('checkSymmetry', () => {
  it('matches mirrored pairs and objects centered on the axis', () => {
    const m = map([wall(rect(100, 50, 40, 20)), wall(rect(500, 50, 40, 20)), wall(rect(300, 200, 40, 40))]);
    expect(checkSymmetry(m, 'mirrorX')).toEqual({ objects: [], start: false, goal: false });
  });

  it('reports objects without a counterpart', () => {
    const m = map([wall(rect(100, 50, 40, 20)), wall(rect(490, 50, 40, 20))]);
    expect(checkSymmetry(m, 'mirrorX').objects).toEqual([0, 1]);
  });

  it('needs the same role', () => {
    const m = map([wall(rect(100, 50, 40, 20)), { role: 'path', shape: rect(500, 50, 40, 20) }]);
    expect(checkSymmetry(m, 'mirrorX').objects).toEqual([0, 1]);
  });

  it('compares the outline, not just the bounds', () => {
    const tri = (pts: [number, number][]): Shape => ({ type: 'poly', points: pts.map(([x, y]) => ({ x, y })) });
    const left = wall(tri([[100, 50], [140, 50], [100, 90]]));
    const goodRight = wall(tri([[540, 50], [500, 50], [540, 90]]));
    const badRight = wall(tri([[500, 50], [540, 50], [500, 90]]));
    expect(checkSymmetry(map([left, goodRight]), 'mirrorX').objects).toEqual([]);
    expect(checkSymmetry(map([left, badRight]), 'mirrorX').objects).toEqual([0, 1]);
  });

  it('handles ellipses, vertical mirror, rotation and both axes', () => {
    const e = (cx: number, cy: number): MapObject => wall({ type: 'ellipse', cx, cy, rx: 30, ry: 15 });
    expect(checkSymmetry(map([e(100, 80), e(100, 280)]), 'mirrorY').objects).toEqual([]);
    expect(checkSymmetry(map([e(100, 80), e(540, 280)]), 'rotate').objects).toEqual([]);
    expect(checkSymmetry(map([e(100, 80), e(540, 280)]), 'mirrorX').objects).toEqual([0, 1]);
    expect(checkSymmetry(map([e(100, 80), e(540, 80), e(100, 280), e(540, 280)]), 'both').objects).toEqual([]);
    expect(checkSymmetry(map([e(100, 80), e(540, 80), e(100, 280)]), 'both').objects).toEqual([1, 2]);
  });

  it('lets START and GOAL mirror each other', () => {
    const m = map([]);
    expect(checkSymmetry(m, 'mirrorX')).toMatchObject({ start: false, goal: false });
    expect(checkSymmetry(m, 'mirrorY')).toMatchObject({ start: false, goal: false });
    m.goal = { x: 560, y: 20, w: 80, h: 80 };
    expect(checkSymmetry(m, 'mirrorX')).toMatchObject({ start: true, goal: true });
  });
});
