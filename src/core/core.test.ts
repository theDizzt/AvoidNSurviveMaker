import { describe, expect, it } from 'vitest';
import { segmentRectEntry } from './geometry';
import { compileMover, moverPos } from './mover';
import { runReplay, Simulation, formatTime } from './simulation';
import { createEmptyMap, mapWarnings, validateMap } from './validate';
import { decodeMap, encodeMap } from './share';
import { BUILTIN_LEVELS } from './levels';
import type { MapData } from './types';

function baseMap(patch: Partial<MapData> = {}): MapData {
  return {
    ...createEmptyMap(),
    start: { x: 0, y: 0, w: 20, h: 20 },
    goal: { x: 700, y: 0, w: 50, h: 50 },
    ...patch,
  };
}

describe('segmentRectEntry', () => {
  it('선분이 사각형에 처음 닿는 비율을 구한다', () => {
    expect(segmentRectEntry(0, 5, 100, 5, 40, 0, 10, 10)).toBeCloseTo(0.4);
  });
  it('닿지 않으면 -1', () => {
    expect(segmentRectEntry(0, 50, 100, 50, 40, 0, 10, 10)).toBe(-1);
    expect(segmentRectEntry(0, 5, 30, 5, 40, 0, 10, 10)).toBe(-1);
  });
  it('시작점이 안쪽이면 0', () => {
    expect(segmentRectEntry(45, 5, 100, 5, 40, 0, 10, 10)).toBe(0);
  });
});

describe('moverPos', () => {
  const cm = compileMover({ w: 10, h: 10, path: [{ x: 0, y: 0 }, { x: 100, y: 0 }], speed: 100, mode: 'pingpong', offset: 0 });
  const p = { x: 0, y: 0 };
  it('pingpong: 갔다가 되돌아온다', () => {
    expect(moverPos(cm, 500, p).x + 5).toBeCloseTo(50);
    expect(moverPos(cm, 1000, p).x + 5).toBeCloseTo(100);
    expect(moverPos(cm, 1500, p).x + 5).toBeCloseTo(50);
    expect(moverPos(cm, 2000, p).x + 5).toBeCloseTo(0);
  });
});

describe('Simulation', () => {
  it('START 밖을 클릭하면 시작하지 않는다', () => {
    const sim = new Simulation(baseMap());
    expect(sim.start(100, 100)).toBe(false);
    expect(sim.status).toBe('ready');
  });

  it('한 번에 멀리 순간이동해도 얇은 벽을 통과하지 못한다', () => {
    const sim = new Simulation(baseMap({ walls: [{ x: 100, y: 0, w: 2, h: 500 }] }));
    sim.start(10, 10);
    sim.feed(10, 600, 10); // 10ms 만에 590px 이동
    expect(sim.status).toBe('dead');
    expect(sim.endReason).toBe('wall');
    expect(sim.x).toBeCloseTo(100);
    // 10ms 동안 590px → x=100 도달 시각 = 90/590*10ms
    expect(sim.endTime).toBeCloseTo((90 / 590) * 10, 9);
  });

  it('1ms 경계마다 틱을 진행한다', () => {
    const sim = new Simulation(baseMap());
    sim.start(10, 10);
    sim.feed(3.4, 12, 10);
    expect(sim.ticks).toBe(3);
    sim.feed(7.9, 14, 10);
    expect(sim.ticks).toBe(7);
    expect(sim.status).toBe('playing');
  });

  it('GOAL에 닿으면 정확한 시각으로 클리어', () => {
    const sim = new Simulation(baseMap());
    sim.start(10, 10);
    sim.feed(1000, 710, 10);
    expect(sim.status).toBe('cleared');
    // x=700 도달: 690/700 지점
    expect(sim.endTime).toBeCloseTo((690 / 700) * 1000, 9);
    expect(formatTime(sim.endTime)).toBe('0.985');
  });

  it('맵 밖으로 나가면 실패', () => {
    const sim = new Simulation(baseMap());
    sim.start(10, 10);
    sim.feed(5, 10, -30);
    expect(sim.status).toBe('dead');
    expect(sim.endReason).toBe('bounds');
    expect(sim.y).toBeCloseTo(0);
  });

  it('마우스가 멈춰 있어도 움직이는 장애물이 와서 부딪히면 실패', () => {
    const sim = new Simulation(baseMap({
      start: { x: 140, y: 40, w: 20, h: 20 },
      movers: [{ w: 10, h: 10, path: [{ x: 100, y: 50 }, { x: 300, y: 50 }], speed: 100, mode: 'pingpong', offset: 0 }],
    }));
    sim.start(150, 50);
    sim.advanceTo(2000);
    expect(sim.status).toBe('dead');
    expect(sim.endReason).toBe('mover');
    // 장애물 중심 x = 100 + 0.1t, 오른쪽 끝(중심+5)이 150에 닿는 시각 = 450ms
    expect(sim.endTime).toBeCloseTo(450, 6);
  });

  it('커서와 장애물이 엇갈려 지나가는 충돌도 잡는다', () => {
    // 장애물은 오른쪽으로, 커서는 왼쪽으로 빠르게 지나감 (프레임 단위 점 검사라면 놓치는 경우)
    const sim = new Simulation(baseMap({
      start: { x: 380, y: 40, w: 20, h: 20 },
      movers: [{ w: 4, h: 40, path: [{ x: 300, y: 50 }, { x: 800, y: 50 }], speed: 20000, mode: 'pingpong', offset: 0 }],
    }));
    sim.start(390, 50);
    sim.feed(1, 300, 50); // t=0, t=1 두 시점 모두 겹치지 않지만 그 사이에 교차함
    expect(sim.status).toBe('dead');
    expect(sim.endReason).toBe('mover');
  });

  it('리플레이를 다시 돌리면 완전히 같은 결과 (결정적)', () => {
    const map = BUILTIN_LEVELS[2];
    const sim = new Simulation(map);
    sim.start(40, 50);
    let t = 0;
    let x = 40;
    let y = 50;
    let seed = 42;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    while (sim.status === 'playing' && t < 20000) {
      t += 0.25 + rand() * 3;
      x += (rand() - 0.3) * 6;
      y += (rand() - 0.5) * 4;
      sim.feed(t, x, y);
    }
    const again = runReplay(map, JSON.parse(JSON.stringify(sim.getReplay())));
    expect(again.status).toBe(sim.status);
    expect(again.endReason).toBe(sim.endReason);
    expect(again.endTime).toBe(sim.endTime);
    expect(again.x).toBe(sim.x);
    expect(again.y).toBe(sim.y);
  });

  it('abort도 리플레이에 기록된다', () => {
    const map = baseMap();
    const sim = new Simulation(map);
    sim.start(10, 10);
    sim.feed(5, 15, 10);
    sim.abort('left');
    const again = runReplay(map, sim.getReplay());
    expect(again.status).toBe('dead');
    expect(again.endReason).toBe('left');
  });
});

describe('validateMap', () => {
  it('기본 맵은 모두 유효하고 경고가 없다', () => {
    for (const m of BUILTIN_LEVELS) {
      expect(validateMap(m)).toEqual(m);
      expect(mapWarnings(m)).toEqual([]);
    }
  });
  it('잘못된 값은 거부', () => {
    expect(() => validateMap({ ...createEmptyMap(), width: 'abc' })).toThrow();
    expect(() => validateMap({ ...createEmptyMap(), v: 99 })).toThrow();
    expect(() => validateMap({ ...createEmptyMap(), walls: [{ x: 0, y: 0, w: -5, h: 10 }] })).toThrow();
  });
  it('알 수 없는 필드는 제거', () => {
    const m = validateMap({ ...createEmptyMap(), evil: '<script>' }) as unknown as Record<string, unknown>;
    expect(m.evil).toBeUndefined();
  });
});

describe('share', () => {
  it('인코딩 → 디코딩하면 같은 맵', async () => {
    for (const m of BUILTIN_LEVELS) {
      const code = await encodeMap(m);
      expect(code).toMatch(/^[zj][A-Za-z0-9_-]+$/);
      expect(await decodeMap(code)).toEqual(m);
    }
  });
  it('깨진 코드는 예외', async () => {
    await expect(decodeMap('zAAAA')).rejects.toThrow();
    await expect(decodeMap('xabc')).rejects.toThrow();
  });
});
