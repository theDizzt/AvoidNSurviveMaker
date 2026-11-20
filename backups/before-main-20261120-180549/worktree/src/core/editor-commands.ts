import { alignOffset, distributeOffsets, objectsBounds, reorder, shapeCentroid, translateObject, turnObjects, unionRect,
  type AlignMode, type Turn, type ZOrder } from './arrange';
import { bakeTilt, shapeCenter } from './shape';
import { cloneMapValue, type EditorDocument } from './editor-document';
import { mergeShapes, type MergeOp } from './merge';
import { LIMITS } from './validate';
import type { MapObject, Shape } from './types';

/** Domain commands mutate through EditorDocument.execute(), producing one undo step each. */
export function reorderSelection(doc: EditorDocument, op: ZOrder): void {
  const ids = doc.selectedIds(), old = doc.map.objects;
  const order = reorder(old.length, ids, op);
  if (!ids.length || order.every((k, i) => k === i)) return;
  doc.execute(d => {
    d.map.objects = order.map(k => old[k]);
    d.selectObjects(ids.map(i => order.indexOf(i)), true);
  });
}

export function alignSelection(doc: EditorDocument, mode: AlignMode, toMap: boolean): void {
  const full = { x: 0, y: 0, w: doc.map.width, h: doc.map.height };
  const zone = doc.selectedZone();
  if (zone) {
    const offset = alignOffset(zone, full, mode);
    doc.execute(() => { zone.x = Math.round(zone.x + offset.x); zone.y = Math.round(zone.y + offset.y); });
    return;
  }
  const units = doc.selectionUnits(), objects = doc.map.objects;
  if (!units.length) return;
  const bounds = units.map(u => objectsBounds(u.map(i => objects[i])));
  const target = toMap || units.length < 2 ? full : unionRect(bounds);
  doc.execute(() => units.forEach((unit, k) => {
    const offset = alignOffset(bounds[k], target, mode);
    for (const i of unit) objects[i] = translateObject(objects[i], offset.x, offset.y);
  }));
}

export function distributeSelection(doc: EditorDocument, axis: 'x' | 'y', toMap: boolean): void {
  const units = doc.selectionUnits(), objects = doc.map.objects;
  if (!units.length) return;
  const bounds = units.map(u => objectsBounds(u.map(i => objects[i])));
  const offsets = distributeOffsets(bounds, axis, toMap || units.length < 3
    ? { x: 0, y: 0, w: doc.map.width, h: doc.map.height } : undefined);
  doc.execute(() => units.forEach((unit, k) => {
    for (const i of unit) objects[i] = translateObject(objects[i], offsets[k].x, offsets[k].y);
  }));
}

export function turnSelection(doc: EditorDocument, turn: Turn): void {
  const units = doc.selectionUnits(), objects = doc.map.objects;
  if (!units.length) return;
  doc.execute(() => units.forEach(unit => {
    const result = turnObjects(unit.map(i => objects[i]), turn);
    unit.forEach((i, k) => objects[i] = result[k]);
  }));
}

export const nextGroupId = (doc: EditorDocument): number => doc.map.objects.reduce((m, o) => Math.max(m, o.group ?? 0), 0) + 1;
export function groupSelection(doc: EditorDocument, ids = doc.selectedIds()): void {
  if (ids.length < 2) return;
  const group = nextGroupId(doc);
  doc.execute(d => ids.forEach(i => d.map.objects[i].group = group));
}
export function ungroupSelection(doc: EditorDocument): number[] {
  const ids = doc.selectedIds().filter(i => doc.map.objects[i].group !== undefined);
  if (ids.length) doc.execute(d => ids.forEach(i => delete d.map.objects[i].group));
  return ids;
}
export function setSelectionPivots(doc: EditorDocument, centroid: boolean): void {
  doc.execute(d => d.selectedIds().forEach(i => {
    const object = d.map.objects[i];
    if (!object.rotation) return;
    const center = centroid ? shapeCentroid(object.shape) : shapeCenter(object.shape);
    object.rotation.pivot = { x: Math.round(center.x * 100) / 100, y: Math.round(center.y * 100) / 100 };
  }));
}
export function deleteSelection(doc: EditorDocument): void {
  const ids = new Set(doc.selectedIds());
  if (!ids.size) return;
  doc.execute(d => { d.map.objects = d.map.objects.filter((_, i) => !ids.has(i)); d.selection = null; });
}

export function insertCopies(doc: EditorDocument, objects: readonly MapObject[], offset: number): number[] {
  const room = LIMITS.maxObjects - doc.map.objects.length;
  if (room <= 0) return [];
  const groups = new Map<number, number>();
  let next = nextGroupId(doc);
  const copies = objects.slice(0, room).map(object => {
    const copy = translateObject(object, offset, offset);
    if (copy.group !== undefined) {
      if (!groups.has(copy.group)) groups.set(copy.group, next++);
      copy.group = groups.get(copy.group);
    }
    return copy;
  });
  const start = doc.map.objects.length;
  const ids = copies.map((_, i) => start + i);
  doc.execute(d => { d.map.objects.push(...copies); d.selectObjects(ids, true); });
  return ids;
}

export type MergeResult = { ok: true; count: number } | { ok: false; reason: 'invalid' | 'empty' | 'limit' };
export function mergeSelection(doc: EditorDocument, op: MergeOp): MergeResult {
  const ids = doc.selectedIds(), objects = doc.map.objects;
  if (ids.length < 2) return { ok: false, reason: 'empty' };
  const first = objects[ids[0]];
  let results: Shape[][];
  try { results = mergeShapes(op, ids.map(i => bakeTilt(objects[i].shape, objects[i].tilt)), LIMITS.maxPolyPoints); }
  catch { return { ok: false, reason: 'invalid' }; }
  if (!results.length) return { ok: false, reason: 'empty' };
  const made: MapObject[] = [];
  let groupId = nextGroupId(doc);
  const oldCenter = shapeCenter(first.shape);
  for (const shapes of results) {
    const group = op !== 'fragment' && shapes.length > 1 ? groupId++ : undefined;
    for (const shape of shapes) {
      const object: MapObject = { role: first.role, shape };
      if (first.motion) {
        const center = shapeCenter(shape), motion = cloneMapValue(first.motion);
        motion.points = motion.points.map(p => ({ x: p.x + center.x - oldCenter.x, y: p.y + center.y - oldCenter.y }));
        object.motion = motion;
      }
      if (first.rotation) object.rotation = cloneMapValue(first.rotation);
      if (group !== undefined) object.group = group;
      made.push(object);
    }
  }
  const remove = new Set(ids), kept = objects.filter((_, i) => !remove.has(i));
  if (kept.length + made.length > LIMITS.maxObjects) return { ok: false, reason: 'limit' };
  const at = objects.slice(0, ids[0]).filter((_, i) => !remove.has(i)).length;
  doc.execute(d => {
    d.map.objects = [...kept.slice(0, at), ...made, ...kept.slice(at)];
    d.selectObjects(made.map((_, i) => at + i), true);
  });
  doc.lastUngrouped = null;
  return { ok: true, count: made.length };
}
