import { describe, expect, it } from 'vitest';
import { EditorDocument } from './editor-document';
import { contentHash } from './record-identity';
import { assignObjectIds } from './object-ids';
import type { MapObject } from './types';
import { createEmptyMap, mapWarnings, validateMap } from './validate';

const box = (x: number, id?: number): MapObject => ({ ...(id !== undefined ? { id } : {}), role: 'wall', shape: { type: 'rect', x, y: 0, w: 10, h: 10 } });

describe('object ids', () => {
  it('numbers a map without ids in object order', () => {
    const m = validateMap({ ...createEmptyMap(), objects: [box(0), box(20), box(40)] });
    expect(m.objects.map((o) => o.id)).toEqual([1, 2, 3]);
  });

  it('keeps ids, and gives copies and new objects the next free number', () => {
    const objects = [box(0, 7), box(20, 3), box(40, 7), box(60)];
    expect(assignObjectIds(objects)).toBe(true);
    expect(objects.map((o) => o.id)).toEqual([7, 3, 8, 9]);
    expect(assignObjectIds(objects)).toBe(false);
  });

  it('stay with their objects when others are removed or reordered in the editor', () => {
    const doc = new EditorDocument({ ...createEmptyMap(), objects: [box(0), box(20), box(40)] });
    expect(doc.map.objects.map((o) => o.id)).toEqual([1, 2, 3]);
    doc.execute((d) => d.map.objects.splice(0, 1));
    doc.execute((d) => d.map.objects.reverse());
    expect(doc.map.objects.map((o) => o.id)).toEqual([3, 2]);
    doc.execute((d) => d.map.objects.push(box(80), JSON.parse(JSON.stringify(d.map.objects[0]))));
    expect(doc.map.objects.map((o) => o.id)).toEqual([3, 2, 4, 5]);
  });

  it('are used in validation messages', () => {
    const m = { ...createEmptyMap(), objects: [box(500, 12), { ...box(0, 40), motion: { type: 'linear' as const, points: [], speed: 100, repeat: 'loop' as const, easing: 'none' as const, delay: 0, clockwise: true } }] };
    expect(mapWarnings(m).some((w) => w.includes('#40'))).toBe(true);
  });

  it("don't change a level's content hash (its records)", () => {
    const a = { ...createEmptyMap(), objects: [box(0), box(20)] };
    expect(contentHash(validateMap(a))).toBe(contentHash(a));
  });
});
