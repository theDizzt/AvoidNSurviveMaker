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

/** Polygon vertex. `smooth` vertices bend the outline into a curve (freeform shapes). */
export interface PolyPoint extends Point {
  smooth?: boolean;
}

export type Shape =
  | { type: 'rect'; x: number; y: number; w: number; h: number }
  | { type: 'ellipse'; cx: number; cy: number; rx: number; ry: number }
  /** `free`: a freeform shape (drawn with the freeform tool or made by merging shapes), even if it has no curved vertices */
  | { type: 'poly'; points: PolyPoint[]; free?: boolean }
  /**
   * Pie slice: apex (cx, cy), radius r, from angle `start` sweeping `sweep` degrees clockwise on
   * screen (0° = right, 90° = down). sweep 360 = a full circle.
   */
  | { type: 'sector'; cx: number; cy: number; r: number; start: number; sweep: number; /** Ring sector (#53/#54): inner radius, 0 < inner < r */ inner?: number };

/**
 * Shape of a START / GOAL zone (#63–68), laid out inside the zone's rectangle in 0–1 coordinates
 * (0, 0 = its top-left corner, 1, 1 = its bottom-right): a circle / ellipse filling it, or a
 * polygon / freeform (`smooth` vertices bend into curves).
 */
export type ZoneShape = { type: 'ellipse' } | { type: 'poly'; points: PolyPoint[]; free?: boolean };
