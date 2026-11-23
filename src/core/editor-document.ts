import type { MapData, MapObject } from './types';
import { gameplayKey } from './level';
import { createValidateApi } from './validate';
import { t, type Translator } from './i18n';
import { assignObjectIds } from './object-ids';

export type EditorSelection = { kind: 'objects'; ids: number[] } | { kind: 'start' | 'goal' } | null;
export interface EditorDraft { map: MapData; verifiedJson: string | null }
export interface EditorValidation { valid: boolean; messages: { text: string; error: boolean }[] }
export type EditorCommand = (document: EditorDocument) => void;
export const cloneMapValue = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Editable domain state. No DOM, storage, timers or rendering callbacks. */
export class EditorDocument {
  map: MapData;
  selection: EditorSelection = null;
  verifiedJson: string | null = null;
  lastClearMs: number | null = null;
  clipboard: { objs: MapObject[]; pastes: number } | null = null;
  lastUngrouped: { ids: number[]; count: number } | null = null;
  private history: string[] = [];
  private future: string[] = [];
  private readonly validation;

  constructor(map?: MapData, translate: Translator = t, private readonly historyLimit = 200) {
    this.validation = createValidateApi(translate);
    this.map = cloneMapValue(map ?? this.validation.createEmptyMap());
    assignObjectIds(this.map.objects);
  }

  get canUndo(): boolean { return this.history.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }

  /** Pointer gestures can snapshot before mutating, then commit on pointer-up. */
  snapshot(json = JSON.stringify(this.map)): void {
    this.history.push(json);
    if (this.history.length > this.historyLimit) this.history.shift();
    this.future = [];
  }

  execute(command: EditorCommand): void {
    const before = JSON.stringify(this.map);
    const selection = cloneMapValue(this.selection);
    try { command(this); }
    catch (error) { this.map = JSON.parse(before) as MapData; this.selection = selection; throw error; }
    // New objects (placed, pasted, duplicated, merged) get their own number
    assignObjectIds(this.map.objects);
    this.snapshot(before);
    this.reconcileSelection();
  }

  undo(): boolean {
    const prev = this.history.pop();
    if (prev === undefined) return false;
    this.future.push(JSON.stringify(this.map));
    this.map = JSON.parse(prev) as MapData;
    this.reconcileSelection();
    return true;
  }

  redo(): boolean {
    const next = this.future.pop();
    if (next === undefined) return false;
    this.history.push(JSON.stringify(this.map));
    this.map = JSON.parse(next) as MapData;
    this.reconcileSelection();
    return true;
  }

  reconcileSelection(): void {
    if (this.selection?.kind !== 'objects') return;
    const ids = this.selection.ids.filter(i => i >= 0 && i < this.map.objects.length);
    this.selection = ids.length ? { kind: 'objects', ids } : null;
  }

  selectedIds(): number[] { return this.selection?.kind === 'objects' ? this.selection.ids : []; }
  selectedObject(): MapObject | null {
    const ids = this.selectedIds();
    return ids.length === 1 ? this.map.objects[ids[0]] ?? null : null;
  }
  selectedZone() {
    const s = this.selection;
    return s && s.kind !== 'objects' ? this.map[s.kind] : null;
  }
  withGroups(ids: readonly number[]): number[] {
    const groups = new Set(ids.map(i => this.map.objects[i]?.group).filter(g => g !== undefined));
    const out = [...ids];
    this.map.objects.forEach((o, i) => {
      if (o.group !== undefined && groups.has(o.group) && !out.includes(i)) out.push(i);
    });
    return out;
  }
  selectObjects(ids: readonly number[], exact = false): void {
    const valid = [...new Set(ids)].filter(i => i >= 0 && i < this.map.objects.length);
    const all = exact ? valid : this.withGroups(valid);
    this.selection = all.length ? { kind: 'objects', ids: all } : null;
  }
  selectionUnits(): number[][] {
    const units = new Map<string, number[]>();
    for (const i of this.selectedIds()) {
      const group = this.map.objects[i]?.group;
      const key = group === undefined ? `o${i}` : `g${group}`;
      const unit = units.get(key);
      if (unit) unit.push(i); else units.set(key, [i]);
    }
    return [...units.values()];
  }

  isVerified(map = this.map): boolean { return this.verifiedJson === gameplayKey(map); }
  markVerified(map: MapData, timeMs?: number): boolean {
    const key = gameplayKey(map);
    if (key !== gameplayKey(this.map)) return false;
    this.verifiedJson = key;
    if (timeMs !== undefined) this.lastClearMs = timeMs;
    return true;
  }
  validate(): EditorValidation {
    const messages: EditorValidation['messages'] = [];
    try {
      this.validation.validateMap(this.map);
      const errors = this.validation.mapErrors(this.map);
      messages.push(...errors.map(text => ({ text, error: true })));
      messages.push(...this.validation.mapWarnings(this.map).map(text => ({ text, error: false })));
      return { valid: errors.length === 0, messages };
    } catch (error) {
      return { valid: false, messages: [{ text: (error as Error).message, error: true }] };
    }
  }
  draft(): EditorDraft { return { map: cloneMapValue(this.map), verifiedJson: this.verifiedJson }; }
  restore(draft: EditorDraft): void {
    this.map = cloneMapValue(draft.map);
    assignObjectIds(this.map.objects);
    this.verifiedJson = draft.verifiedJson;
    this.lastClearMs = null;
    this.selection = null;
    this.history = []; this.future = [];
  }
}
