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

/** A rectangular obstacle moving along a path. `path` holds waypoints for the obstacle's center. */
export interface Mover {
  w: number;
  h: number;
  path: Point[];
  /** Pixels per second */
  speed: number;
  /** pingpong: go to the end and come back; loop: continue from the last waypoint back to the first */
  mode: MoverMode;
  /** Phase offset at start (ms). Used to stagger obstacles that share the same path */
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
