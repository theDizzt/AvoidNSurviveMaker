export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type MoverMode = 'pingpong' | 'loop';

/** 경로를 따라 움직이는 사각형 장애물. path는 장애물 "중심"의 경유 지점. */
export interface Mover {
  w: number;
  h: number;
  path: Point[];
  /** 픽셀/초 */
  speed: number;
  /** pingpong: 끝까지 갔다가 되돌아옴, loop: 마지막 지점에서 첫 지점으로 이어서 순환 */
  mode: MoverMode;
  /** 시작 시점 위상 (ms). 같은 경로의 장애물을 어긋나게 배치할 때 사용 */
  offset: number;
}

export const MAP_VERSION = 1;

export interface MapData {
  v: typeof MAP_VERSION;
  name: string;
  author: string;
  width: number;
  height: number;
  start: Rect;
  goal: Rect;
  walls: Rect[];
  movers: Mover[];
}
