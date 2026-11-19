import { expect, it } from 'vitest';
import { EditorDocument } from './editor-document';
import { alignSelection, deleteSelection, groupSelection, insertCopies, mergeSelection, reorderSelection } from './editor-commands';
import { createEmptyMap } from './validate';
import type { MapData } from './types';

const fixture = (): MapData => ({ ...createEmptyMap(), objects: [
  { role: 'wall', shape: { type: 'rect', x: 200, y: 100, w: 50, h: 50 } },
  { role: 'wall', shape: { type: 'rect', x: 400, y: 200, w: 50, h: 50 } },
] });

it('edits and restores history without DOM, invalidating redo after a new command', () => {
  const doc = new EditorDocument(fixture());
  const before = doc.draft();
  doc.selectObjects([0, 1]);
  groupSelection(doc);
  expect(doc.map.objects[0].group).toBe(doc.map.objects[1].group);
  expect(doc.undo()).toBe(true);
  expect(doc.map).toEqual(before.map);
  expect(doc.redo()).toBe(true);
  doc.undo();
  deleteSelection(doc);
  expect(doc.map.objects).toHaveLength(0);
  expect(doc.canRedo).toBe(false);
  expect(doc.undo()).toBe(true);
  expect(doc.map).toEqual(before.map);
});

it('preserves grouped offsets during alignment and assigns fresh groups to copies', () => {
  const doc = new EditorDocument(fixture());
  doc.selectObjects([0, 1]);
  groupSelection(doc);
  alignSelection(doc, 'left', true);
  expect(doc.map.objects.map(o => o.shape.type === 'rect' ? o.shape.x : -1)).toEqual([0, 200]);
  const oldGroup = doc.map.objects[0].group;
  expect(insertCopies(doc, doc.map.objects, 20)).toEqual([2, 3]);
  expect(doc.map.objects[2].group).not.toBe(oldGroup);
  expect(doc.map.objects[2].group).toBe(doc.map.objects[3].group);
  doc.undo();
  expect(doc.map.objects).toHaveLength(2);
});

it('keeps the selected object when reordering and can undo a merge', () => {
  const doc = new EditorDocument(fixture());
  const object = doc.map.objects[0];
  doc.selectObjects([0]);
  reorderSelection(doc, 'front');
  expect(doc.selectedObject()).toBe(object);
  doc.undo();
  doc.selectObjects([0, 1]);
  const before = doc.draft();
  expect(mergeSelection(doc, 'union').ok).toBe(true);
  doc.undo();
  expect(doc.map).toEqual(before.map);
});

it('retains gameplay verification through cosmetic edits and restores it through undo', () => {
  const doc = new EditorDocument(fixture());
  expect(doc.markVerified(doc.map, 1234)).toBe(true);
  doc.execute(d => { d.map.name = 'Renamed'; });
  expect(doc.isVerified()).toBe(true);
  doc.execute(d => { d.map.goal.x -= 10; });
  expect(doc.isVerified()).toBe(false);
  doc.undo();
  expect(doc.isVerified()).toBe(true);
  const restored = new EditorDocument();
  restored.restore(doc.draft());
  expect(restored.isVerified()).toBe(true);
  expect(restored.canUndo).toBe(false);
});
