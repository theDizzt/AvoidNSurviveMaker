import type { MapObject } from './types';

/** Largest object id a map may use */
export const MAX_OBJECT_ID = 1_000_000_000;

const valid = (id: unknown): id is number => typeof id === 'number' && Number.isInteger(id) && id >= 1 && id <= MAX_OBJECT_ID;

/**
 * Give every object a unique id (`MapObject.id`, shown as "#id" in the editor). Objects keep the
 * id they have; one without an id, or repeating an id an earlier object already has (a copy),
 * gets the next number after the highest in use. A map from before ids gets 1, 2, 3… in object
 * order, the numbers it showed before. Returns whether anything changed.
 */
export function assignObjectIds(objects: MapObject[]): boolean {
  let max = 0;
  for (const o of objects) if (valid(o.id)) max = Math.max(max, o.id);
  const seen = new Set<number>();
  let changed = false;
  for (const o of objects) {
    if (valid(o.id) && !seen.has(o.id)) {
      seen.add(o.id);
      continue;
    }
    o.id = ++max;
    seen.add(o.id);
    changed = true;
  }
  return changed;
}

/** "#id" of the object at index i (its position + 1 until it has an id) */
export function objectNumber(objects: readonly MapObject[], i: number): number {
  return objects[i]?.id ?? i + 1;
}
