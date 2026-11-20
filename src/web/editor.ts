import { t as tr } from './i18n';
import { pointInPoly } from '../core/geometry';
import type { ZoneShape } from '../core/types';
import { ZoneArea, zoneFromShape, zoneRing } from '../core/zone';
import { CompiledMotion } from '../core/motion';
import { objectLights } from '../core/lighting';
import { compileObject, transformAt, type CompiledObject, type Transform } from '../core/object';
import { objectsBounds, shapeCentroid, tiltObject, tiltObjects, translateObject, type AlignMode, type Turn, type ZOrder } from '../core/arrange';
import { gameplayKey } from './localized/level';
import { formatSeconds } from '../core/simulation';
import { initialChannels } from '../core/switches';
import { type MergeOp } from '../core/merge';
import { flattenShape, normalizeTilt, polyOutline, rotatePoint, shapeBounds, shapeCenter, tiltedBounds, translateShape } from '../core/shape';
import { encodeMap } from './localized/share';
import type { FogKind, MapData, MapObject, Point, PolyPoint, Rect, Shape, TriggerKind } from '../core/types';
import { switchColor } from './localized/colors';
import { boulderShape, spikeShape } from '../core/hazards';
import { BeamCaster } from '../core/laser';
import { createEmptyMap, DEFAULT_BLINK, DEFAULT_FALL, DEFAULT_ICE_GRIP, DEFAULT_GUN, DEFAULT_MISSILE, DEFAULT_PULLEY, DEFAULT_SECRET_RADIUS, DEFAULT_TORCH_LIGHT, defaultRotation, LIMITS, validateMap } from './localized/validate';
import { beginFrame, type Camera, clientToMap, COLORS, drawDarkAreas, drawGlobalDark, drawMap, drawSecretWalls, fittedView, FONT_MAIN, fitCanvas, setCamera, staticPicture, traceObject, unitsPerPx, zonePath } from './render';
import { closeContextMenu, openContextMenu, type MenuItem } from './context-menu';
import { renderThemePanel } from './theme-panel';
import { badgeFor, badgeTitle, bundledThemeById, bundledThemeOptions, chapterMazePresets, subThemeLabel } from './theme-registry';
import { badgeImage, drawLevelBadge } from './badge';
import { DEFAULT_BADGE, DEFAULT_DESIGN } from './localized/theme-pack';

import { checkSymmetry, mirrorPoint, SYMMETRY_MODES, type SymmetryMode, type SymmetryReport } from '../core/symmetry';
import { drawFogAreas } from './fog';
import { Behavior, ObjectTool, Tool, SHAPES, GROUPS, ICONS, isButton, isSquare, toolLabel, objectToolId, zoneToolId, type ZoneTool, sizeText, Hit, Handle, Drag, MAP_SIZES, GRID, HANDLE_PX, PIVOT_SNAP_PX, ROTATE_HANDLE_PX, MIN_ZOOM, MAX_ZOOM, ZOOM_STEP, IDENTITY, newMotion, EditorElements, clone, CommandId, Command, ARROWS, SHORTCUTS, rectFromCorners, rectCorners } from './editor-shared';
import { EditorDocument, type EditorSelection as Selection } from '../core/editor-document';
import * as editCommands from '../core/editor-commands';
import { loadEditorDraft, saveEditorDraft, loadEditorPreference, saveEditorPreference } from './editor-storage';
import { EditorPropertiesPanel } from './editor-properties';
export type { EditorElements } from './editor-shared';

/** "30°" / "-12.5°" */
const tiltText = (deg: number): string => `${Math.round(deg * 10) / 10}°`;

export class Editor {
  onTest: (map: MapData) => void = () => {};
  /** Called after every change to the map (the map pack panel listens) */
  onChange: () => void = () => {};

  private readonly model = new EditorDocument(undefined, tr);
  private readonly properties: EditorPropertiesPanel;
  private get map(): MapData { return this.model.map; }
  private set map(value: MapData) { this.model.map = value; }
  /** Maze colors of the map being edited (picks the editor's music) */
  get mapLook(): Pick<MapData, 'theme' | 'themeId' | 'themeDesign' | 'level'> {
    return { theme: this.map.theme, themeId: this.map.themeId, themeDesign: this.map.themeDesign, level: this.map.level };
  }
  private compiledCache: CompiledObject[] | null = null;
  private readonly routeCache = new WeakMap<CompiledObject, number[]>();
  /** gameplayKey() of the map as last cleared in test play (sharing needs a verified clear) */
  private get verifiedJson(): string | null { return this.model.verifiedJson; }
  private set verifiedJson(value: string | null) { this.model.verifiedJson = value; }
  /** Clear time of that test play, used to suggest star times */
  private get lastClearMs(): number | null { return this.model.lastClearMs; }

  private tool: Tool = { kind: 'select' };
  private get sel(): Selection { return this.model.selection; }
  private set sel(value: Selection) { this.model.selection = value; }
  private drag: Drag | null = null;
  /** Polygon / freeform being drawn */
  private draft: { tool: ObjectTool | ZoneTool; points: PolyPoint[] } | null = null;
  /** Object whose motion markers are being placed by clicking */
  private markerMode: number | null = null;
  private hover: Point | null = null;
  private visible = false;
  private valid = true;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly previewStart = performance.now();
  private readonly paletteButtons: { btn: HTMLButtonElement; tool: Tool }[] = [];
  /** Last object tool used; number keys / W / M / R change one aspect of it */
  private lastObjectTool: ObjectTool = { kind: 'object', role: 'path', behavior: 'static', shape: 'rect' };
  /** Copied objects (Ctrl+C / Ctrl+X) and how many times they have been pasted */
  private get clipboard() { return this.model.clipboard; }
  private set clipboard(value: EditorDocument['clipboard']) { this.model.clipboard = value; }
  /** Consecutive arrow-key nudges of the same selection share one undo step */
  private lastNudge: { key: string; t: number } | null = null;
  private helpBox: HTMLElement | null = null;
  /** Switch color for the next switch / door / link (the last one picked) */
  private lastColor = 0;
  /** Palette button for #42 global darkness (pressed while the map has it) */
  private globalDarkBtn: HTMLButtonElement | null = null;
  /** Align / distribute relative to the map instead of the selection */
  private alignToMap = false;
  /** Members of the last ungrouped group, for "Regroup" (valid while the object list keeps its layout) */
  private get lastUngrouped() { return this.model.lastUngrouped; }
  private set lastUngrouped(value: EditorDocument['lastUngrouped']) { this.model.lastUngrouped = value; }
  /** Short status message shown in the hint bar for a moment */
  private flashMsg: { text: string; until: number } | null = null;
  /** Pivot snap target while dragging a pivot (drawn as a guide) */
  private pivotSnap: { p: Point; label: string } | null = null;

  /** Zoom, and the map point at the middle of the canvas */
  private readonly cam: Camera = { zoom: 1, x: 0, y: 0 };
  /** Map size the camera was last centered for (a new size recenters it) */
  private camFor = '';
  /** Zoom percentage shown over the canvas for a moment after each zoom */
  private readonly zoomHud = document.createElement('div');
  private zoomHudTimer = 0;
  /** Dragging the view (Space + drag or the middle button) */
  private pan: { id: number; x: number; y: number; cx: number; cy: number; u: number } | null = null;
  private spaceHeld = false;
  /** Viewport map in the corner, shown while zoomed in */
  private readonly minimap = document.createElement('canvas');

  constructor(private readonly el: EditorElements) {
    this.ctx = el.canvas.getContext('2d')!;
    const editor = this;
    this.properties = new EditorPropertiesPanel(el.props, {
      get map() { return editor.map; },
      get selection() { return editor.sel; },
      get lastColor() { return editor.lastColor; },
      set lastColor(value) { editor.lastColor = value; },
      get alignToMap() { return editor.alignToMap; },
      set alignToMap(value) { editor.alignToMap = value; },
      edit: fn => editor.edit(fn),
      selectedZone: () => editor.selectedZone(),
      selectedObject: () => editor.selectedObject(),
      selIds: () => editor.selIds(),
      startMarkers: i => editor.startMarkers(i),
      duplicateSelected: () => editor.duplicateSelected(),
      deleteSelected: () => editor.deleteSelected(),
      commands: () => editor.commands(),
    });
    this.restore();
    this.buildPalette();

    el.canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    el.canvas.addEventListener('pointermove', (e) => this.onMove(e));
    el.canvas.addEventListener('pointerup', (e) => this.onUp(e));
    el.canvas.addEventListener('pointerleave', () => (this.hover = null));
    el.canvas.addEventListener('dblclick', (e) => this.onDoubleClick(e));
    el.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.onContextMenu(e);
    });
    window.addEventListener('keydown', (e) => this.onKey(e));
    this.setupZoom();
    const refit = () => fitCanvas(el.canvas, this.map);
    new ResizeObserver(refit).observe(el.canvas.parentElement!);
    window.addEventListener('resize', refit);

    // "Grid on top" is a per-browser preference
    try {
      el.gridTop.checked = loadEditorPreference('gridTop') === '1';
    } catch {
      /* storage unavailable */
    }
    el.gridTop.addEventListener('change', () => {
      try {
        saveEditorPreference('gridTop', el.gridTop.checked ? '1' : '0');
      } catch {
        /* storage unavailable */
      }
    });
    // Center lines and the symmetry check are per-browser preferences too
    for (const mode of SYMMETRY_MODES) {
      const opt = document.createElement('option');
      opt.value = mode;
      opt.textContent = tr(`editor.sym.${mode}`);
      el.symmetry.append(opt);
    }
    try {
      el.center.checked = loadEditorPreference('center') === '1';
      const saved = loadEditorPreference('symmetry') as SymmetryMode | null;
      if (saved && SYMMETRY_MODES.includes(saved)) el.symmetry.value = saved;
    } catch {
      /* storage unavailable */
    }
    el.center.addEventListener('change', () => {
      try {
        saveEditorPreference('center', el.center.checked ? '1' : '0');
      } catch {
        /* storage unavailable */
      }
    });
    el.symmetry.addEventListener('change', () => {
      this.symmetryCache = null;
      el.symmetry.blur();
      try {
        saveEditorPreference('symmetry', el.symmetry.value);
      } catch {
        /* storage unavailable */
      }
      this.updateHint();
    });
    el.undo.addEventListener('click', () => this.undo());
    el.redo.addEventListener('click', () => this.redo());
    el.shortcuts.addEventListener('click', () => this.toggleHelp());

    const textField = (input: HTMLInputElement, key: 'name' | 'author') =>
      input.addEventListener('change', () => this.edit(() => (this.map[key] = input.value.slice(0, LIMITS.maxText))));
    textField(el.name, 'name');
    textField(el.author, 'author');
    el.size.addEventListener('change', () => {
      const [w, h] = el.size.value.split('x').map(Number);
      if (!(w > 0 && h > 0)) return this.syncInputs();
      this.edit(() => {
        this.map.width = w;
        this.map.height = h;
      });
      fitCanvas(el.canvas, this.map);
    });

    el.test.addEventListener('click', () => {
      this.finishModes();
      this.onTest(clone(this.map));
    });
    el.share.addEventListener('click', () => void this.share());
    el.exportBtn.addEventListener('click', () => this.exportJson());
    el.importBtn.addEventListener('click', () => el.importFile.click());
    el.importFile.addEventListener('change', () => void this.importJson());
    el.newBtn.addEventListener('click', () => {
      if (!confirm(tr('ed.clearTheCurrentMapAnd'))) return;
      this.edit(() => (this.map = createEmptyMap()));
      this.clearSelection();
      fitCanvas(el.canvas, this.map);
    });

    this.setTool({ kind: 'select' });
    this.changed();

    // Schedule the next frame first: one frame that throws must not freeze the editor canvas
    const loop = () => {
      requestAnimationFrame(loop);
      this.draw();
    };
    requestAnimationFrame(loop);
  }

  private setupZoom(): void {
    const { canvas } = this.el;
    canvas.addEventListener('wheel', (e) => {
      if (!this.visible) return;
      e.preventDefault();
      const step = e.deltaMode === 1 ? e.deltaY * 0.05 : e.deltaMode === 2 ? e.deltaY : e.deltaY * 0.0015;
      this.zoomAt(this.pointer(e), Math.exp(-Math.max(-1, Math.min(1, step))));
    }, { passive: false });
    // Middle button pans instead of starting the browser's autoscroll
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 1) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      if (e.code !== 'Space' || !this.spaceHeld) return;
      this.spaceHeld = false;
      this.updateCursor();
    });
    window.addEventListener('blur', () => {
      this.spaceHeld = false;
      this.updateCursor();
    });
    this.el.zoomIn.addEventListener('click', () => this.zoomAt({ x: this.cam.x, y: this.cam.y }, ZOOM_STEP));
    this.el.zoomOut.addEventListener('click', () => this.zoomAt({ x: this.cam.x, y: this.cam.y }, 1 / ZOOM_STEP));
    this.el.zoomReset.addEventListener('click', () => this.resetZoom());

    this.zoomHud.className = 'editor-zoom-hud';
    this.zoomHud.setAttribute('aria-hidden', 'true');
    (canvas.closest('.editor-view') ?? canvas.parentElement!).append(this.zoomHud);

    const mini = this.minimap;
    mini.className = 'editor-minimap';
    mini.hidden = true;
    mini.title = tr('ed.minimapHint');
    (canvas.closest('.editor-view') ?? canvas.parentElement!).append(mini);
    const centerOn = (e: PointerEvent) => {
      const r = mini.getBoundingClientRect();
      this.cam.x = ((e.clientX - r.left) / r.width) * this.map.width;
      this.cam.y = ((e.clientY - r.top) / r.height) * this.map.height;
      this.applyCamera();
    };
    mini.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      mini.setPointerCapture(e.pointerId);
      centerOn(e);
    });
    mini.addEventListener('pointermove', (e) => {
      if (mini.hasPointerCapture(e.pointerId)) centerOn(e);
    });
    mini.addEventListener('pointerup', (e) => {
      if (mini.hasPointerCapture(e.pointerId)) mini.releasePointerCapture(e.pointerId);
    });
  }

  /**
   * Keep the zoom in range and the middle of the view on the map (it can be panned freely up to
   * the map's edges at any zoom), then hand the camera to the renderer
   */
  private applyCamera(): void {
    const c = this.cam;
    const { width: w, height: h } = this.map;
    if (this.camFor !== `${w}x${h}`) {
      this.camFor = `${w}x${h}`;
      c.x = w / 2;
      c.y = h / 2;
    }
    c.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, c.zoom));
    c.x = Math.min(w, Math.max(0, c.x));
    c.y = Math.min(h, Math.max(0, c.y));
    const fitted = c.zoom === 1 && Math.abs(c.x - w / 2) < 1e-6 && Math.abs(c.y - h / 2) < 1e-6;
    setCamera(this.el.canvas, fitted ? null : c);
    const label = `${Math.round(c.zoom * 100)}%`;
    if (this.el.zoomReset.textContent !== label) this.el.zoomReset.textContent = label;
  }

  /** Zoom by `factor`, keeping map point `p` where it is on screen */
  private zoomAt(p: Point, factor: number): void {
    const c = this.cam;
    const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, c.zoom * factor));
    if (z === c.zoom) return;
    c.x = p.x - ((p.x - c.x) * c.zoom) / z;
    c.y = p.y - ((p.y - c.y) * c.zoom) / z;
    c.zoom = z;
    this.applyCamera();
    this.flashZoom();
  }

  /** Back to 100%, the whole map centered */
  private resetZoom(): void {
    this.cam.zoom = 1;
    this.cam.x = this.map.width / 2;
    this.cam.y = this.map.height / 2;
    this.applyCamera();
    this.flashZoom();
  }

  /** Show the zoom percentage over the canvas, fading out shortly after the last change */
  private flashZoom(): void {
    const hud = this.zoomHud;
    hud.textContent = `${Math.round(this.cam.zoom * 100)}%`;
    hud.classList.add('show');
    clearTimeout(this.zoomHudTimer);
    this.zoomHudTimer = window.setTimeout(() => hud.classList.remove('show'), 900);
  }

  private updateCursor(): void {
    const tool = this.tool;
    this.el.canvas.style.cursor = this.pan ? 'grabbing' : this.spaceHeld ? 'grab' : tool.kind === 'select' ? 'default' : 'crosshair';
  }

  /** The viewport map: the whole map, moving objects at rest, START/GOAL, and the visible area */
  private drawMinimap(): void {
    const mini = this.minimap;
    const show = this.visible && this.cam.zoom > 1;
    if (mini.hidden === show) mini.hidden = !show;
    if (!show) return;
    const { map } = this;
    const cssW = 200;
    const cssH = Math.max(40, Math.round((cssW * map.height) / map.width));
    const dpr = window.devicePixelRatio || 1;
    if (mini.width !== Math.round(cssW * dpr) || mini.height !== Math.round(cssH * dpr)) {
      mini.width = Math.round(cssW * dpr);
      mini.height = Math.round(cssH * dpr);
      mini.style.width = `${cssW}px`;
      mini.style.height = `${cssH}px`;
    }
    const g = mini.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = COLORS.bg;
    g.fillRect(0, 0, mini.width, mini.height);
    const k = mini.width / map.width;
    g.setTransform(k, 0, 0, mini.height / map.height, 0, 0);
    const pic = staticPicture(this.compiled);
    if (pic) g.drawImage(pic, 0, 0, map.width, map.height);
    g.fillStyle = 'rgba(36,52,80,0.35)';
    g.beginPath();
    for (const o of this.compiled) if (o.dynamic) traceObject(g, o, IDENTITY);
    g.fill();
    g.fillStyle = COLORS.startEdge;
    g.fill(zonePath(map.start, map.startShape));
    g.fillStyle = COLORS.goalEdge;
    g.fill(zonePath(map.goal, map.goalShape));
    const { cssW: vw, cssH: vh, s } = fittedView(this.el.canvas, map);
    const hw = vw / 2 / (s * this.cam.zoom);
    const hh = vh / 2 / (s * this.cam.zoom);
    g.fillStyle = 'rgba(58,159,240,0.14)';
    g.fillRect(this.cam.x - hw, this.cam.y - hh, hw * 2, hh * 2);
    g.strokeStyle = '#3a9ff0';
    g.lineWidth = 2 / k;
    g.strokeRect(this.cam.x - hw, this.cam.y - hh, hw * 2, hh * 2);
  }

  show(): void {
    this.visible = true;
    fitCanvas(this.el.canvas, this.map);
  }

  hide(): void {
    this.visible = false;
    this.minimap.hidden = true;
    closeContextMenu();
    this.finishModes();
    this.toggleHelp(false);
  }

  /** Bring a map from the play screen into the editor (remix). Previous work can be restored with Undo */
  loadMap(map: MapData): void {
    this.finishModes();
    this.edit(() => (this.map = clone(map)));
    this.clearSelection();
    fitCanvas(this.el.canvas, this.map);
  }

  /** If the map cleared in test play matches the one being edited, mark it shareable */
  markVerified(map: MapData, timeMs?: number): void {
    if (this.model.markVerified(map, timeMs)) this.changed();
  }

  /** The map being edited (a copy) */
  getMap(): MapData {
    return clone(this.map);
  }

  /** Has this map (by its gameplay) been cleared in test play? Defaults to the map being edited */
  isVerified(map: MapData = this.map): boolean { return this.model.isVerified(map); }

  /** Open a map; `verified` carries over a clear made earlier (e.g. a level stored in a map pack) */
  openMap(map: MapData, verified: boolean): void {
    this.loadMap(map);
    if (verified) {
      this.verifiedJson = gameplayKey(map);
      this.changed();
    }
  }

  /** Symmetry check of the current map, recomputed when the map or the mode changes */
  private symmetryCache: { mode: SymmetryMode; objects: MapObject[]; start: string; goal: string; size: string; report: SymmetryReport } | null = null;

  private get symmetryMode(): SymmetryMode {
    const v = this.el.symmetry.value as SymmetryMode;
    return SYMMETRY_MODES.includes(v) ? v : 'off';
  }

  private get symmetry(): SymmetryReport | null {
    const mode = this.symmetryMode;
    if (mode === 'off') return null;
    const m = this.map;
    const c = this.symmetryCache;
    const start = JSON.stringify(m.start);
    const goal = JSON.stringify(m.goal);
    const size = `${m.width}x${m.height}`;
    // Edits replace the objects array or call dirty(); compare the cheap parts too
    if (c && c.mode === mode && c.objects === m.objects && !this.symmetryStale && c.start === start && c.goal === goal && c.size === size) return c.report;
    const report = checkSymmetry(m, mode);
    this.symmetryCache = { mode, objects: m.objects, start, goal, size, report };
    this.symmetryStale = false;
    return report;
  }

  private symmetryStale = true;

  private get compiled(): CompiledObject[] {
    if (!this.compiledCache) {
      this.compiledCache = this.map.objects.map(compileObject);
      this.beamCaster = null;
    }
    return this.compiledCache;
  }

  /** Laser preview; rebuilt with the compiled objects */
  private beamCaster: BeamCaster | null = null;

  /** Call after any in-place change to map objects */
  private dirty(): void {
    this.compiledCache = null;
    this.symmetryStale = true;
  }

  // ───────────────────────── Palette ─────────────────────────

  private buildPalette(): void {
    const box = this.el.palette;
    const addButton = (parent: HTMLElement, tool: Tool, html: string, title: string, cls: string) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `pal-btn ${cls}`;
      b.title = title;
      b.setAttribute('aria-label', title);
      b.innerHTML = html;
      b.addEventListener('click', () => this.setTool(tool));
      parent.append(b);
      this.paletteButtons.push({ btn: b, tool });
    };

    const selectRow = document.createElement('div');
    selectRow.className = 'pal-row';
    addButton(
      selectRow,
      { kind: 'select' },
      `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3 L19 12 L12 13.5 L9 20 Z"/></svg><span class="pal-text">${tr('ed.select')}</span>`,
      tr('ed.palSelect'),
      'pal-select',
    );
    box.append(selectRow);

    for (const g of GROUPS) {
      const h = document.createElement('h4');
      h.className = 'pal-title';
      h.textContent = g.title;
      const row = document.createElement('div');
      row.className = 'pal-row';
      if ('zones' in g) {
        addButton(row, { kind: 'zone', zone: 'start' }, '<span class="pal-zone">S</span><span class="pal-num">9</span>', tr('ed.palStartAreaS'), 'pal-start');
        addButton(row, { kind: 'zone', zone: 'goal' }, '<span class="pal-zone">G</span><span class="pal-num">10</span>', tr('ed.palGoalAreaG'), 'pal-goal');
        // Round, polygon and freeform START / GOAL (#63–68): the #9 / #10 badge, outlined in that shape
        const zoneOutline = {
          poly: '<polygon points="12,1.5 22.5,9.2 18.5,22 5.5,22 1.5,9.2"/>',
          free: '<path d="M3.5 18.5 C0.8 10 6.5 1.5 12.5 3.2 C18.5 1.2 23.6 7.5 21.6 14 C20 20.5 9 23.6 3.5 18.5 Z"/>',
        };
        const zoneIcon = (shape: 'ellipse' | 'poly' | 'free', letter: string) => shape === 'ellipse'
          ? `<span class="pal-zone pal-zone-round">${letter}</span>`
          : `<span class="pal-zone pal-zone-svg"><svg viewBox="0 0 24 24" aria-hidden="true">${zoneOutline[shape]}</svg><b>${letter}</b></span>`;
        ([['ellipse', 63], ['poly', 65], ['free', 67]] as const).forEach(([shape, num]) => {
          addButton(row, { kind: 'zone', zone: 'start', shape }, `${zoneIcon(shape, 'S')}<span class="pal-num">${num}</span>`, tr(`ed.palStart_${shape}`), 'pal-start');
          addButton(row, { kind: 'zone', zone: 'goal', shape }, `${zoneIcon(shape, 'G')}<span class="pal-num">${num + 1}</span>`, tr(`ed.palGoal_${shape}`), 'pal-goal');
        });
      } else {
        SHAPES.forEach(([shape], k) => {
          const tool: ObjectTool = { kind: 'object', role: g.role, behavior: g.behavior, shape };
          const num = g.first + k;
          const badge = g.behavior === 'moving' ? '<span class="pal-badge">⇄</span>' : g.behavior === 'rotating' ? '<span class="pal-badge">↻</span>' : g.behavior === 'blinking' ? '<span class="pal-badge">◐</span>' : '';
          addButton(
            row,
            tool,
            `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[shape]}</svg>${badge}<span class="pal-num">${num}</span>`,
            `#${num} ${toolLabel(tool)} (${k + 1})`,
            `pal-${g.role} pal-${g.behavior}`,
          );
        });
      }
      box.append(h, row);
    }

    // Special objects, by category
    const section = (title: string): HTMLElement => {
      const h = document.createElement('h4');
      h.className = 'pal-title';
      h.textContent = title;
      const row = document.createElement('div');
      row.className = 'pal-row';
      box.append(h, row);
      return row;
    };
    const svg = (inner: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${inner}</svg>`;

    // Special terrain: sector / ring sector paths and walls, ice, safe zone, secret walls
    let row = section(tr('ed.catTerrain'));
    const sectorPath: ObjectTool = { kind: 'object', role: 'path', behavior: 'static', shape: 'sector' };
    const sectorWall: ObjectTool = { kind: 'object', role: 'wall', behavior: 'static', shape: 'sector' };
    addButton(row, sectorPath, `${svg(ICONS.sector)}<span class="pal-num">27</span>`, tr('ed.palSectorPath'), 'pal-path pal-static');
    addButton(row, sectorWall, `${svg(ICONS.sector)}<span class="pal-num">28</span>`, tr('ed.palSectorWall'), 'pal-wall pal-static');
    const ringIcon = '<path d="M4 20 L4 4 A16 16 0 0 1 20 20 L13 20 A9 9 0 0 0 4 11 Z"/>';
    const ringPath: ObjectTool = { kind: 'object', role: 'path', behavior: 'static', shape: 'sector', ring: true };
    const ringWall: ObjectTool = { kind: 'object', role: 'wall', behavior: 'static', shape: 'sector', ring: true };
    addButton(row, ringPath, `${svg(ringIcon)}<span class="pal-num">53</span>`, tr('ed.palRingPath'), 'pal-path pal-static');
    addButton(row, ringWall, `${svg(ringIcon)}<span class="pal-num">54</span>`, tr('ed.palRingWall'), 'pal-wall pal-static');
    // Ice floors (#71–74): rectangle, circle, polygon, freeform
    SHAPES.forEach(([shape], k) => {
      const tool: ObjectTool = { kind: 'object', role: 'path', behavior: 'static', shape, ice: true };
      addButton(row, tool, `${svg(ICONS[shape])}<span class="pal-badge">❄</span><span class="pal-num">${71 + k}</span>`, `#${71 + k} ${toolLabel(tool)}${shape === 'poly' || shape === 'free' ? ` — ${tr('ed.clickPointsEnter')}` : ''}`, 'pal-ice');
    });
    const safeTool: ObjectTool = { kind: 'object', role: 'safe', behavior: 'static', shape: 'rect' };
    addButton(row, safeTool, `${svg('<rect x="3" y="3" width="18" height="18" rx="2" fill-opacity="0.45"/><path d="M12 6.5 L16.5 8.3 L16.2 12.4 C15.8 15 14 16.6 12 17.6 C10 16.6 8.2 15 7.8 12.4 L7.5 8.3 Z" fill="#fff"/>')}<span class="pal-num">48</span>`, tr('ed.palSafeZone'), 'pal-safe');
    const secretTool: ObjectTool = { kind: 'object', role: 'secret', behavior: 'static', shape: 'rect' };
    addButton(row, secretTool, `${svg('<rect x="3" y="4" width="18" height="16" rx="1.5"/><circle cx="12" cy="12" r="4.5" fill="#fff" fill-opacity="0.9"/><circle cx="12" cy="12" r="1.6"/>')}<span class="pal-num">55</span>`, tr('ed.palSecretWall'), 'pal-wall pal-static');
    const secretFreeTool: ObjectTool = { kind: 'object', role: 'secret', behavior: 'static', shape: 'free' };
    addButton(row, secretFreeTool, `${svg('<path d="M4 18 C3 9 9 3 13 7 S 21 8 20 15 S 9 21 4 18 Z"/><circle cx="12" cy="12.5" r="4" fill="#fff" fill-opacity="0.9"/><circle cx="12" cy="12.5" r="1.4"/>')}<span class="pal-num">56</span>`, tr('ed.palSecretWallFree'), 'pal-wall pal-static');

    // Traps: spike, boulder, falling rock, grinders and saw blades
    row = section(tr('ed.catTraps'));
    const spike: ObjectTool = { kind: 'object', role: 'wall', behavior: 'static', shape: 'poly', special: 'spike' };
    const boulder: ObjectTool = { kind: 'object', role: 'wall', behavior: 'moving', shape: 'poly', special: 'boulder' };
    addButton(row, spike, `${svg('<path d="M3 21 L18 6 L21 3 L17 7 Z" stroke-linejoin="round"/><path d="M5 19 L8 22 M2 16 L5 19" />')}<span class="pal-num">29</span>`, tr('ed.palSpikeStake'), 'pal-wall pal-moving');
    // Same rock outline as a placed boulder
    const rock = boulderShape(12, 12, 9.5).map((p) => `${p.x},${p.y}`).join(' ');
    addButton(row, boulder, `${svg(`<polygon points="${rock}"/>`)}<span class="pal-num">30</span>`, tr('ed.palRollingBoulder'), 'pal-wall pal-moving');
    const sawTool = (special: 'disc' | 'blade', behavior: Behavior): ObjectTool => ({ kind: 'object', role: 'wall', behavior, shape: special === 'disc' ? 'ellipse' : 'rect', special });
    const discIcon = '<path d="M12 2 L14 5 L17.6 4.2 L18 7.9 L21.4 9.5 L19.6 12.7 L21.4 15.9 L18 17.4 L17.6 21.1 L14 20.3 L12 23 L10 20.3 L6.4 21.1 L6 17.4 L2.6 15.9 L4.4 12.7 L2.6 9.5 L6 7.9 L6.4 4.2 L10 5 Z" transform="scale(0.92) translate(1 0)"/><circle cx="12" cy="12.5" r="2.6" fill="#fff"/>';
    const bladeIcon = '<path d="M2 9 L4 7 L6 9 L8 7 L10 9 L12 7 L14 9 L16 7 L18 9 L20 7 L22 9 L22 15 L20 17 L18 15 L16 17 L14 15 L12 17 L10 15 L8 17 L6 15 L4 17 L2 15 Z"/>';
    const route = '<path d="M15 21 L22 21 M19.5 18.5 L22 21 L19.5 23.5" stroke-width="1.6" fill="none"/>';
    addButton(row, sawTool('disc', 'static'), `${svg(discIcon)}<span class="pal-num">43</span>`, tr('ed.palCircularGrinder'), 'pal-saw');
    addButton(row, sawTool('blade', 'static'), `${svg(bladeIcon)}<span class="pal-num">44</span>`, tr('ed.palSawBlade'), 'pal-saw');
    addButton(row, sawTool('disc', 'moving'), `${svg(discIcon + route)}<span class="pal-num">45</span>`, tr('ed.palMovingCircularGrinder'), 'pal-saw');
    addButton(row, sawTool('blade', 'moving'), `${svg(bladeIcon + route)}<span class="pal-num">46</span>`, tr('ed.palMovingSawBlade'), 'pal-saw');
    // A saw blade turning around a pivot (#62)
    addButton(row, sawTool('blade', 'rotating'), `${svg(`<g transform="rotate(-30 12 12)">${bladeIcon}</g><circle cx="12" cy="12" r="2.2" fill="#fff"/>`)}<span class="pal-badge">↻</span><span class="pal-num">62</span>`, tr('ed.palRotatingSaw'), 'pal-saw');
    const fallTool: ObjectTool = { kind: 'object', role: 'wall', behavior: 'static', shape: 'poly', special: 'fall' };
    const fallRock = boulderShape(12, 9, 6.5).map((p) => `${p.x},${p.y}`).join(' ');
    addButton(row, fallTool, `${svg(`<polygon points="${fallRock}"/><path d="M12 17 L12 23 M9.5 20.5 L12 23 L14.5 20.5" stroke-width="1.6" fill="none" stroke-linecap="round"/>`)}<span class="pal-num">51</span>`, tr('ed.palFall'), 'pal-wall pal-moving');

    // Shooters: laser and mirror, turret and homing missile launcher
    row = section(tr('ed.catShooters'));
    const laser: ObjectTool = { kind: 'object', role: 'laser', behavior: 'static', shape: 'rect' };
    const mirror: ObjectTool = { kind: 'object', role: 'mirror', behavior: 'static', shape: 'poly' };
    addButton(row, laser, `${svg('<rect x="3" y="8" width="8" height="8" rx="1.5"/><path d="M11 12 L22 12" stroke="#e2486c" stroke-width="2.4"/>')}<span class="pal-num">37</span>`, tr('ed.palLaser'), 'pal-laser');
    addButton(row, mirror, `${svg('<path d="M4 20 L20 4" stroke-width="4" stroke="#8fa3bf"/><path d="M4 20 L20 4" stroke-width="1.4" stroke="#fff"/>')}<span class="pal-num">38</span>`, tr('ed.palMirror'), 'pal-mirror');
    const turretTool = (kind: 'gun' | 'missile'): ObjectTool => ({ kind: 'object', role: 'turret', behavior: 'static', shape: 'rect', turret: kind });
    addButton(row, turretTool('gun'), `${svg('<rect x="3" y="3" width="18" height="18" rx="2.5"/><circle cx="11" cy="12" r="5" fill="#fff"/><path d="M11 12 L22 12" stroke-width="3.2" stroke-linecap="round"/><circle cx="11" cy="12" r="2.2"/>')}<span class="pal-num">60</span>`, tr('ed.palTurret'), 'pal-turret');
    addButton(row, turretTool('missile'), `${svg('<rect x="3" y="3" width="18" height="18" rx="2.5"/><path d="M12 4.5 C14 6.5 14.4 9 14.4 12 L14.4 16 L9.6 16 L9.6 12 C9.6 9 10 6.5 12 4.5 Z" fill="#fff"/><path d="M10.2 17 L12 20.5 L13.8 17 Z" fill="#ff8a1f"/>')}<span class="pal-num">61</span>`, tr('ed.palMissile'), 'pal-turret');

    // Switches and devices: switches, event zones, portal, door, pulley
    row = section(tr('ed.catDevices'));
    const trig = (kind: TriggerKind): ObjectTool => ({ kind: 'object', role: 'trigger', behavior: 'static', shape: 'rect', trigger: kind });
    const btn = '<rect x="4" y="4" width="16" height="16" rx="3"/><rect x="7.5" y="7.5" width="9" height="9" rx="2" fill="#fff" fill-opacity="0.55"/>';
    addButton(row, trig('switch'), `${svg(btn)}<span class="pal-num">32</span>`, tr('ed.palSwitch'), 'pal-switch');
    addButton(row, trig('timer'), `${svg(`${btn}<path d="M12 12 L12 8 A4 4 0 0 1 16 12 Z" fill="#243450" fill-opacity="0.5"/>`)}<span class="pal-num">33</span>`, tr('ed.palTimerSwitch'), 'pal-switch');
    addButton(row, trig('hold'), `${svg(`${btn}<circle cx="12" cy="12" r="2" fill="#243450"/>`)}<span class="pal-num">34</span>`, tr('ed.palHoldSwitch'), 'pal-switch');
    addButton(row, trig('startZone'), `${svg('<rect x="3" y="5" width="18" height="14" rx="2" stroke-dasharray="3 2"/><path d="M10 9 L15 12 L10 15 Z" fill="#c2577b"/>')}<span class="pal-num">35</span>`, tr('ed.palEventStartZone'), 'pal-zone-ev');
    addButton(row, trig('stopZone'), `${svg('<rect x="3" y="5" width="18" height="14" rx="2" stroke-dasharray="3 2"/><rect x="9.5" y="9.5" width="5" height="5" fill="#c2577b"/>')}<span class="pal-num">36</span>`, tr('ed.palEventStopZone'), 'pal-zone-ev');
    const portal: ObjectTool = { kind: 'object', role: 'portal', behavior: 'static', shape: 'rect' };
    addButton(row, portal, `${svg('<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="12" cy="12" r="5" fill="none"/><circle cx="12" cy="12" r="1.6"/>')}<span class="pal-num">39</span>`, tr('ed.palTeleportPortal'), 'pal-portal');
    const door: ObjectTool = { kind: 'object', role: 'door', behavior: 'static', shape: 'rect' };
    addButton(row, door, `${svg('<rect x="2" y="9" width="9" height="6"/><rect x="13" y="9" width="9" height="6"/><path d="M8 6 L5 6 M16 6 L19 6" />')}<span class="pal-num">40</span>`, tr('ed.palAutoDoor'), 'pal-door');
    const pulleyTool: ObjectTool = { kind: 'object', role: 'pulley', behavior: 'static', shape: 'ellipse' };
    addButton(row, pulleyTool, `${svg('<circle cx="12" cy="12" r="9" fill="#fff"/><path d="M12 5 L12 19 M5.9 8.5 L18.1 15.5 M5.9 15.5 L18.1 8.5" stroke-width="1.6"/><circle cx="12" cy="12" r="2.4"/>')}<span class="pal-num">52</span>`, tr('ed.palPulley'), 'pal-switch');

    // Collectibles: coin and crystal star
    row = section(tr('ed.catCollect'));
    const coin: ObjectTool = { kind: 'object', role: 'coin', behavior: 'static', shape: 'ellipse' };
    addButton(row, coin, `${svg('<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="4" fill="none"/>')}<span class="pal-num">31</span>`, tr('ed.palCoin'), 'pal-coin');
    const crystalTool: ObjectTool = { kind: 'object', role: 'crystal', behavior: 'static', shape: 'rect' };
    addButton(row, crystalTool, `${svg('<path d="M12 2 L14.9 8.6 L22 9.3 L16.6 14 L18.2 21 L12 17.3 L5.8 21 L7.4 14 L2 9.3 L9.1 8.6 Z"/>')}<span class="pal-num">59</span>`, tr('ed.palCrystal'), 'pal-crystal');

    // Sight and light: darkness, fog, sand dust, torches
    row = section(tr('ed.catSight'));
    const dark: ObjectTool = { kind: 'object', role: 'dark', behavior: 'static', shape: 'rect' };
    addButton(row, dark, `${svg('<rect x="4" y="4" width="16" height="16" rx="2"/>')}<span class="pal-num">41</span>`, tr('ed.palDarknessArea'), 'pal-dark');
    // #42 is a map setting, not an object: the button toggles it
    const g = document.createElement('button');
    g.type = 'button';
    g.className = 'pal-btn pal-global-dark';
    g.title = tr('ed.42GlobalDarknessToggle');
    g.setAttribute('aria-label', g.title);
    g.innerHTML = `${svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4" fill="#fff"/>')}<span class="pal-num">42</span>`;
    g.addEventListener('click', () => this.edit(() => {
      if (this.map.darkness) delete this.map.darkness;
      else this.map.darkness = { light: 60, intensity: 100 };
    }));
    this.globalDarkBtn = g;
    row.append(g);
    // Fog and sand dust: freeform areas
    const fogTool = (kind: FogKind): ObjectTool => ({ kind: 'object', role: 'fog', behavior: 'static', shape: 'free', fog: kind });
    const cloudIcon = '<path d="M6 17 C2.5 17 2.5 12 6 12 C6 8 11 7 12.5 10 C14 7 19.5 8 18.5 12 C22 12 22 17 18 17 Z"/>';
    addButton(row, fogTool('fog'), `${svg(`${cloudIcon}<path d="M4 20 L20 20" stroke-width="1.6" fill="none" stroke-linecap="round"/>`)}<span class="pal-num">49</span>`, tr('ed.palFog'), 'pal-fog');
    addButton(row, fogTool('sand'), `${svg(`${cloudIcon}<circle cx="5" cy="20.5" r="1"/><circle cx="10" cy="21" r="1"/><circle cx="15" cy="20.5" r="1"/><circle cx="20" cy="21" r="1"/>`)}<span class="pal-num">50</span>`, tr('ed.palSandDust'), 'pal-sand');
    const torchIcon = '<path d="M10 12 L14 12 L13 22 L11 22 Z" fill="#8a5a2b"/><path d="M12 2.5 C15.5 6.5 16 9 14.6 11.5 L9.4 11.5 C8 9 8.5 6.5 12 2.5 Z" fill="#ff8a1f"/><path d="M12 6 C13.6 8 13.8 9.6 13 11 L11 11 C10.2 9.6 10.4 8 12 6 Z" fill="#ffd45e"/>';
    const torchTool = (carry: boolean): ObjectTool => ({ kind: 'object', role: 'torch', behavior: 'static', shape: 'rect', ...(carry ? { carry: true } : {}) });
    addButton(row, torchTool(false), `${svg(torchIcon)}<span class="pal-num">57</span>`, tr('ed.palTorch'), 'pal-torch');
    addButton(row, torchTool(true), `${svg(`${torchIcon}<path d="M16 14 L22.5 17 L19.4 18 L18.4 21.2 Z" fill="#2b86e0"/>`)}<span class="pal-num">58</span>`, tr('ed.palCarryTorch'), 'pal-torch');

    // Decoration: text box
    row = section(tr('ed.catDecor'));
    const textTool: ObjectTool = { kind: 'object', role: 'text', behavior: 'static', shape: 'rect' };
    addButton(row, textTool, `${svg('<path d="M5 6 L19 6 M12 6 L12 19 M9 19 L15 19" stroke-width="2.6" fill="none" stroke-linecap="round"/>')}<span class="pal-num">47</span>`, tr('ed.palTextBox'), 'pal-text');
  }

  private setTool(tool: Tool): void {
    this.finishModes();
    this.tool = tool;
    if (tool.kind === 'object' && (tool.role === 'path' || tool.role === 'wall') && tool.shape !== 'sector' && !tool.special) this.lastObjectTool = tool;
    for (const { btn, tool: t } of this.paletteButtons) {
      btn.setAttribute('aria-pressed', String(JSON.stringify(t) === JSON.stringify(tool)));
    }
    this.updateCursor();
    this.updateHint();
  }

  /** Leave polygon drafting / marker placement */
  private finishModes(): void {
    this.draft = null;
    this.markerMode = null;
    this.updateHint();
  }

  // ───────────────────────── State ─────────────────────────

  private snapshot(json = JSON.stringify(this.map)): void {
    this.lastNudge = null;
    this.model.snapshot(json);
  }

  private edit(fn: () => void): void {
    this.lastNudge = null;
    this.model.execute(fn);
    this.changed();
  }

  private undo(): void { if (this.model.undo()) this.afterHistoryJump(); }

  private redo(): void { if (this.model.redo()) this.afterHistoryJump(); }

  private afterHistoryJump(): void {
    this.lastNudge = null;
    this.finishModes();
    fitCanvas(this.el.canvas, this.map);
    this.changed();
  }

  /** After the map changes: save, validate, refresh panels */
  private changed(): void {
    this.model.reconcileSelection();
    this.dirty();
    this.save();
    this.syncInputs();
    this.renderProps();
    this.renderTheme();
    this.renderLevel();
    this.globalDarkBtn?.setAttribute('aria-pressed', String(!!this.map.darkness));

    const validation = this.model.validate();
    this.valid = validation.valid;
    this.el.messages.replaceChildren(
      ...validation.messages.map((m) => {
        const li = document.createElement('li');
        li.textContent = m.text;
        li.className = m.error ? 'error' : 'warn';
        return li;
      }),
    );

    const verified = this.isVerified();
    this.el.share.disabled = !verified || !this.valid;
    this.el.verify.textContent = verified ? tr('ed.verified') : tr('ed.unverified');
    this.el.verify.className = verified ? 'verify ok' : 'verify';
    if (!verified) this.el.shareUrl.value = '';
    this.el.undo.disabled = !this.model.canUndo;
    this.el.redo.disabled = !this.model.canRedo;
    this.updateHint();
    this.onChange();
  }

  private save(): void { saveEditorDraft(this.model.draft()); }

  private restore(): void {
    const draft = loadEditorDraft();
    if (draft) this.model.restore(draft);
  }

  private syncInputs(): void {
    const set = (input: HTMLInputElement, v: string) => {
      if (document.activeElement !== input) input.value = v;
    };
    set(this.el.name, this.map.name);
    set(this.el.author, this.map.author);
    // 16:9 sizes; a map made in another ratio keeps its size as a "custom" entry
    const current = `${this.map.width}x${this.map.height}`;
    const sizes = MAP_SIZES.map(([w, h]) => [`${w}x${h}`, `${w} × ${h}${w === 1920 ? ' (default)' : ''}`]);
    if (!sizes.some(([v]) => v === current)) sizes.push([current, tr('ed.sizeNot169', { w: this.map.width, h: this.map.height })]);
    this.el.size.replaceChildren(...sizes.map(([v, t]) => new Option(t, v, false, v === current)));
  }

  private updateHint(): void {
    let text: string;
    const n = this.selIds().length;
    if (this.flashMsg && performance.now() < this.flashMsg.until) {
      text = this.flashMsg.text;
    } else if (this.markerMode !== null) {
      const m = this.map.objects[this.markerMode]?.motion;
      text = m?.type === 'circle'
        ? tr('ed.hintOrbit')
        : tr('ed.hintMarkers', { n: m?.points.length ?? 0 });
    } else if (this.draft) {
      text = this.draft.tool.shape === 'free'
        ? tr('ed.hintFree', { n: this.draft.points.length })
        : tr('ed.hintPoly', { n: this.draft.points.length });
    } else if (this.tool.kind === 'select' && n > 1) {
      text = tr('ed.hintMulti', { n });
    } else if (this.tool.kind === 'select') {
      text = tr('ed.hintSelect');
    } else if (this.tool.kind === 'zone') {
      text = tr(this.tool.zone === 'start' ? 'ed.hintZoneStart' : 'ed.hintZoneGoal');
      if (this.tool.shape === 'poly' || this.tool.shape === 'free') text = `${text} ${tr('ed.hintZonePoints')}`;
    } else {
      const t = this.tool;
      const how = tr(t.special === 'spike' ? 'ed.howSpike'
        : t.special === 'boulder' ? 'ed.howBoulder'
          : t.role === 'torch' || t.role === 'crystal' || t.role === 'turret' || t.special === 'fall' ? 'ed.howTorch'
          : t.role === 'mirror' ? 'ed.howMirror'
            : t.role === 'laser' ? 'ed.howLaser'
              : t.role === 'portal' ? 'ed.howPortal' : t.shape === 'sector' ? 'ed.howSector' : t.role === 'coin' ? 'ed.howCoin' : t.shape === 'poly' || t.shape === 'free' ? 'ed.howPoints' : t.shape === 'ellipse' ? 'ed.howEllipse' : 'ed.howRect');
      const after = t.behavior === 'moving' ? tr('ed.afterMoving') : t.behavior === 'rotating' ? tr('ed.afterRotating') : t.behavior === 'blinking' ? tr('ed.afterBlinking') : '';
      text = tr('ed.hintTool', { tool: toolLabel(t), how, after });
    }
    this.el.hint.textContent = text;
  }

  // ───────────────────────── Pointer input ─────────────────────────

  private snapv(v: number): number {
    return this.el.snap.checked ? Math.round(v / GRID) * GRID : Math.round(v);
  }

  private snapPoint(p: Point): Point {
    return { x: this.snapv(p.x), y: this.snapv(p.y) };
  }

  private pointer(e: MouseEvent): Point {
    return clientToMap(this.el.canvas, this.map, e.clientX, e.clientY);
  }

  private hitTest(p: Point): Hit {
    const objs = this.compiled;
    const zoneTrigger = (i: number) => !isButton(this.map.objects[i]?.trigger?.kind);
    // Text boxes are drawn over everything, so they are picked first
    for (const role of ['text', 'coin', 'crystal', 'torch', 'pulley', 'portal', 'laser', 'turret', 'trigger', 'wall', 'door', 'mirror'] as const) {
      for (let i = objs.length - 1; i >= 0; i--) {
        if (role === 'trigger' && zoneTrigger(i)) continue;
        if (objs[i].role === role && pointInPoly(p.x, p.y, objs[i].poly)) return { kind: 'object', i };
      }
    }
    if (new ZoneArea(this.map.goal, this.map.goalShape).contains(p.x, p.y)) return { kind: 'goal' };
    if (new ZoneArea(this.map.start, this.map.startShape).contains(p.x, p.y)) return { kind: 'start' };
    // Darkness and fog areas last, so whatever lies under one can still be clicked
    for (const role of ['safe', 'path', 'trigger', 'dark', 'fog', 'secret'] as const) {
      for (let i = objs.length - 1; i >= 0; i--) {
        if (role === 'trigger' && !zoneTrigger(i)) continue;
        if (objs[i].role === role && pointInPoly(p.x, p.y, objs[i].poly)) return { kind: 'object', i };
      }
    }
    return null;
  }

  /** Selected object indices in pick order (empty for zones / nothing) */
  private selIds(): number[] { return this.model.selectedIds(); }

  /** The selected object when exactly one is selected */
  private selectedObject(): MapObject | null { return this.model.selectedObject(); }

  private selectedIndex(): number {
    const ids = this.selIds();
    return ids.length === 1 ? ids[0] : -1;
  }

  /** Every object index that shares a group with any of `ids` (keeping `ids` first, in order) */
  private withGroups(ids: readonly number[]): number[] { return this.model.withGroups(ids); }

  /** Select objects (indices are expanded to whole groups unless `exact`) */
  private selectObjects(ids: readonly number[], exact = false): void {
    this.model.selectObjects(ids, exact);
    this.renderProps();
  }

  private selectZone(zone: 'start' | 'goal'): void {
    this.sel = { kind: zone };
    this.renderProps();
  }

  private clearSelection(): void {
    this.sel = null;
    this.renderProps();
  }

  /** Selected objects split into units that move / align together: each group, and each loose object */
  private selUnits(): number[][] { return this.model.selectionUnits(); }

  /** Show a short message in the hint bar */
  private flash(text: string): void {
    this.flashMsg = { text, until: performance.now() + 2500 };
    this.updateHint();
    setTimeout(() => this.updateHint(), 2600);
  }

  private selectedZone(): Rect | null { return this.model.selectedZone(); }

  /** Handles for the current selection, in priority order */
  private handles(): { h: Handle; p: Point }[] {
    const out: { h: Handle; p: Point }[] = [];
    const zone = this.selectedZone();
    if (zone) {
      rectCorners(zone).forEach((p, j) => out.push({ h: { kind: 'corner', j }, p }));
      return out;
    }
    const o = this.selectedObject();
    if (!o) {
      // Multi-selection: one tilt handle above the whole selection
      const g = this.groupRotate();
      if (g) out.push({ h: { kind: 'rotate' }, p: g.p });
      return out;
    }
    if (o.rotation) out.push({ h: { kind: 'pivot' }, p: o.rotation.pivot });
    o.motion?.points.forEach((p, j) => out.push({ h: { kind: 'marker', j }, p }));
    out.push({ h: { kind: 'rotate' }, p: this.rotateHandlePoint(o) });
    const s = o.shape;
    if (o.turret) {
      // Fixed size: route markers, pivot, tilt and the barrel / launch direction
      const b = shapeBounds(o.shape);
      const a = (o.turret.angle * Math.PI) / 180;
      const r = Math.max(b.w, b.h) / 2 + 22;
      out.unshift({ h: { kind: 'aim' }, p: { x: b.x + b.w / 2 + Math.cos(a) * r, y: b.y + b.h / 2 + Math.sin(a) * r } });
      return out;
    }
    if (o.role === 'coin' || o.role === 'crystal') return out; // fixed size: only route markers / pivot / tilt
    // Shape handles sit on the tilted outline
    const shapeStart = out.length;
    if (o.laser) {
      const b = shapeBounds(o.shape);
      const a = (o.laser.angle * Math.PI) / 180;
      const r = Math.max(b.w, b.h) / 2 + 22;
      out.unshift({ h: { kind: 'aim' }, p: { x: b.x + b.w / 2 + Math.cos(a) * r, y: b.y + b.h / 2 + Math.sin(a) * r } });
    }
    if (s.type === 'poly') s.points.forEach((p, j) => out.push({ h: { kind: 'vertex', j }, p }));
    else if (s.type === 'sector') {
      const at = (deg: number) => ({ x: s.cx + Math.cos((deg * Math.PI) / 180) * s.r, y: s.cy + Math.sin((deg * Math.PI) / 180) * s.r });
      out.push({ h: { kind: 'arc', part: 'radius' }, p: at(s.start + s.sweep / 2) });
      if (s.inner) {
        const mid = ((s.start + s.sweep / 2) * Math.PI) / 180;
        out.push({ h: { kind: 'arc', part: 'inner' }, p: { x: s.cx + Math.cos(mid) * s.inner, y: s.cy + Math.sin(mid) * s.inner } });
      }
      if (s.sweep < 360) {
        out.push({ h: { kind: 'arc', part: 'start' }, p: at(s.start) });
        out.push({ h: { kind: 'arc', part: 'end' }, p: at(s.start + s.sweep) });
      }
    } else rectCorners(shapeBounds(s)).forEach((p, j) => out.push({ h: { kind: 'corner', j }, p }));
    if (o.tilt) {
      const c = shapeCenter(s);
      for (let k = shapeStart; k < out.length; k++) if (out[k].h.kind !== 'aim') out[k].p = rotatePoint(out[k].p, c, o.tilt);
    }
    return out;
  }

  /** The tilt handle: above the object's center, turned with its tilt */
  private rotateHandlePoint(o: MapObject): Point {
    const b = shapeBounds(o.shape);
    const c = shapeCenter(o.shape);
    const u = unitsPerPx(this.el.canvas, this.map);
    return rotatePoint({ x: c.x, y: b.y - ROTATE_HANDLE_PX * u }, c, o.tilt ?? 0);
  }

  /**
   * The multi-selection tilt handle: center of the selection, the knob above its box and the angle
   * turned so far. While turning, the center stays put and the knob turns around it.
   */
  private groupRotate(): { c: Point; p: Point; deg: number } | null {
    const d = this.drag;
    if (d?.type === 'handle' && d.group) {
      const { c, r, deg } = d.group;
      return { c, p: rotatePoint({ x: c.x, y: c.y - r }, c, deg), deg };
    }
    const ids = this.selIds();
    if (ids.length < 2) return null;
    const members = ids.map((i) => this.map.objects[i]).filter(Boolean);
    if (!members.length) return null;
    const b = objectsBounds(members);
    const u = unitsPerPx(this.el.canvas, this.map);
    const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    return { c, p: { x: c.x, y: b.y - 4 * u - ROTATE_HANDLE_PX * u }, deg: 0 };
  }

  /** Pointer angle around an object's center, degrees clockwise from straight up */
  private static angleAround(c: Point, p: Point): number {
    return (Math.atan2(p.y - c.y, p.x - c.x) * 180) / Math.PI + 90;
  }

  private hitHandle(p: Point): Handle | null {
    const r = HANDLE_PX * unitsPerPx(this.el.canvas, this.map);
    for (const { h, p: q } of this.handles()) {
      if (Math.hypot(q.x - p.x, q.y - p.y) <= r) return h;
    }
    return null;
  }

  private onDown(e: PointerEvent): void {
    if (e.button === 1 || (e.button === 0 && this.spaceHeld)) {
      e.preventDefault();
      this.el.canvas.setPointerCapture(e.pointerId);
      this.pan = { id: e.pointerId, x: e.clientX, y: e.clientY, cx: this.cam.x, cy: this.cam.y, u: unitsPerPx(this.el.canvas, this.map) };
      this.updateCursor();
      return;
    }
    if (e.button !== 0) return;
    this.el.canvas.setPointerCapture(e.pointerId);
    const raw = this.pointer(e);
    const p = this.snapPoint(raw);

    // Placing route markers
    if (this.markerMode !== null) {
      const o = this.map.objects[this.markerMode];
      if (!o) return this.finishModes();
      this.edit(() => {
        o.motion ??= newMotion(o);
        if (o.motion.type === 'circle') o.motion.points = [p];
        else if (o.motion.points.length < LIMITS.maxMarkers) {
          if (o.motion.segmentTypes) {
            o.motion.segmentTypes = Array.from({ length: o.motion.points.length + 1 }, (_, j) =>
              o.motion!.segmentTypes?.[j] ?? (o.motion!.type === 'curve' ? 'curve' : 'linear'));
            o.motion.segmentTypes.splice(o.motion.points.length, 0, o.motion.type);
          }
          o.motion.points.push(p);
        }
      });
      if (o.motion?.type === 'circle') this.finishModes();
      return;
    }

    // Drawing a polygon / freeform
    if (this.draft) {
      const pts = this.draft.points;
      const first = pts[0];
      const r = HANDLE_PX * 1.5 * unitsPerPx(this.el.canvas, this.map);
      if (pts.length >= 3 && Math.hypot(first.x - raw.x, first.y - raw.y) <= r) {
        this.closeDraft();
      } else if (pts.length < LIMITS.maxPolyPoints) {
        pts.push(this.draft.tool.shape === 'free' && !e.shiftKey ? { ...p, smooth: true } : p);
        this.updateHint();
      }
      return;
    }

    const tool = this.tool;
    if (tool.kind === 'select') {
      const h = this.hitHandle(raw);
      const o = this.selectedObject();
      if (h && e.altKey && h.kind === 'vertex' && o?.shape.type === 'poly' && o.shape.points.length > 3) {
        const shape = o.shape;
        this.edit(() => shape.points.splice(h.j, 1));
        return;
      }
      if (h?.kind === 'rotate' && !o && !this.selectedZone()) {
        const g = this.groupRotate();
        if (!g) return;
        const objs = this.selIds().filter((i) => this.map.objects[i]).map((i) => ({ i, o: clone(this.map.objects[i]) }));
        this.drag = {
          type: 'handle', h, before: JSON.stringify(this.map), moved: false, orig: objs[0].o,
          a0: Editor.angleAround(g.c, raw), group: { objs, c: g.c, r: Math.hypot(g.p.x - g.c.x, g.p.y - g.c.y), deg: 0 },
        };
        return;
      }
      if (h) {
        const orig = clone(this.selectedZone() ?? this.selectedObject()!);
        const a0 = h.kind === 'rotate' && 'shape' in orig ? Editor.angleAround(shapeCenter(orig.shape), raw) : undefined;
        this.drag = { type: 'handle', h, before: JSON.stringify(this.map), moved: false, orig, a0 };
        return;
      }
      const hit = this.hitTest(raw);
      const toggle = e.shiftKey || e.ctrlKey || e.metaKey;
      if (hit?.kind === 'object') {
        const ids = this.selIds();
        if (toggle) {
          // Add or remove the clicked object (with its group)
          const unit = this.withGroups([hit.i]);
          if (ids.includes(hit.i)) this.selectObjects(ids.filter((i) => !unit.includes(i)), true);
          else this.selectObjects([...ids, ...unit], true);
          return;
        }
        const already = ids.includes(hit.i);
        if (!already) this.selectObjects([hit.i]);
        this.startMove(raw, already ? hit.i : null);
        return;
      }
      if (hit) {
        if (toggle) return;
        this.selectZone(hit.kind);
        this.startMove(raw, null);
        return;
      }
      // Empty space: rubber-band selection
      const base = toggle ? this.selIds() : [];
      if (!toggle) this.clearSelection();
      this.drag = { type: 'marquee', x0: raw.x, y0: raw.y, x1: raw.x, y1: raw.y, add: toggle, base };
      return;
    }

    // Polygon / freeform tools place points one by one (spike, boulder and mirror tools drag instead)
    if (((tool.kind === 'object' && !tool.special && tool.role !== 'mirror') || tool.kind === 'zone') && (tool.shape === 'poly' || tool.shape === 'free')) {
      this.draft = { tool, points: [tool.shape === 'free' && !e.shiftKey ? { ...p, smooth: true } : p] };
      this.clearSelection();
      this.updateHint();
      return;
    }

    this.drag = { type: 'box', x0: p.x, y0: p.y, x1: p.x, y1: p.y, square: e.shiftKey };
  }

  private startMove(p0: Point, clicked: number | null): void {
    const zone = this.selectedZone();
    this.drag = {
      type: 'move', p0, before: JSON.stringify(this.map), moved: false, clicked,
      zone: zone ? clone(zone) : undefined,
      objs: this.selIds().map((i) => ({ i, o: clone(this.map.objects[i]) })),
    };
  }

  /** Points a dragged pivot snaps to: center of the bounds, center of mass, and the outline's corners */
  private pivotTargets(o: MapObject): { p: Point; label: string }[] {
    const s = o.shape;
    const out = [{ p: shapeCenter(s), label: tr('common.center') }];
    const c = shapeCentroid(s);
    if (Math.hypot(c.x - out[0].p.x, c.y - out[0].p.y) > 0.5) out.push({ p: c, label: tr('ed.centerOfMass') });
    if (s.type === 'poly') s.points.forEach((v) => out.push({ p: { x: v.x, y: v.y }, label: tr('ed.vertex') }));
    else if (s.type === 'sector') out.push({ p: { x: s.cx, y: s.cy }, label: tr('ed.apex') });
    else {
      const b = shapeBounds(s);
      rectCorners(b).forEach((v) => out.push({ p: v, label: tr('ed.corner') }));
      for (const [fx, fy] of [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]]) {
        out.push({ p: { x: b.x + b.w * fx, y: b.y + b.h * fy }, label: tr('ed.edgeMiddle') });
      }
    }
    return out;
  }

  private onMove(e: PointerEvent): void {
    const pan = this.pan;
    if (pan && e.pointerId === pan.id) {
      this.cam.x = pan.cx - (e.clientX - pan.x) * pan.u;
      this.cam.y = pan.cy - (e.clientY - pan.y) * pan.u;
      this.applyCamera();
      return;
    }
    let raw = this.pointer(e);
    this.hover = raw;
    const d = this.drag;
    if (!d) return;
    let p = this.snapPoint(raw);

    if (d.type === 'box') {
      d.x1 = p.x;
      d.y1 = p.y;
      d.square = e.shiftKey || (this.tool.kind === 'object' && (this.tool.role === 'coin' || this.tool.role === 'portal' || isButton(this.tool.trigger)));
      return;
    }
    if (d.type === 'marquee') {
      d.x1 = raw.x;
      d.y1 = raw.y;
      return;
    }
    if (!d.moved) {
      // A tiny wobble while clicking isn't a move
      if (d.type === 'move' && Math.hypot(raw.x - d.p0.x, raw.y - d.p0.y) < 2 * unitsPerPx(this.el.canvas, this.map)) return;
      d.moved = true;
      this.snapshot(d.before);
    }

    if (d.type === 'move') {
      const zone = this.selectedZone();
      if (zone && d.zone) {
        zone.x = this.snapv(d.zone.x + raw.x - d.p0.x);
        zone.y = this.snapv(d.zone.y + raw.y - d.p0.y);
      } else if (d.objs?.length) {
        // Snap the combined bounds, so a multi-selection keeps its layout
        const b = objectsBounds(d.objs.map((x) => x.o));
        const dx = this.snapv(b.x + raw.x - d.p0.x) - b.x;
        const dy = this.snapv(b.y + raw.y - d.p0.y) - b.y;
        for (const { i, o } of d.objs) this.map.objects[i] = translateObject(o, dx, dy);
      }
      this.dirty();
      return;
    }

    // Handle drag
    const h = d.h;
    const zone = this.selectedZone();
    if (zone && h.kind === 'corner' && !('shape' in d.orig)) {
      const opposite = rectCorners(d.orig)[(h.j + 2) % 4];
      const r = rectFromCorners(opposite, p);
      Object.assign(zone, { ...r, w: Math.max(10, r.w), h: Math.max(10, r.h) });
      this.dirty();
      return;
    }
    if (h.kind === 'rotate' && d.group) {
      const g = d.group;
      let deg = Editor.angleAround(g.c, raw) - (d.a0 ?? 0);
      if ((this.el.snap.checked || e.shiftKey) && !e.altKey) deg = Math.round(deg / 15) * 15;
      else deg = Math.round(deg);
      deg = normalizeTilt(deg);
      g.deg = deg;
      const turned = tiltObjects(g.objs.map((x) => x.o), deg, g.c);
      g.objs.forEach(({ i }, k) => { this.map.objects[i] = turned[k]; });
      this.dirty();
      return;
    }
    const o = this.selectedObject();
    if (!o || !('shape' in d.orig)) return;
    if (h.kind === 'rotate') {
      const c = shapeCenter(d.orig.shape);
      const from = d.orig.tilt ?? 0;
      let deg = from + Editor.angleAround(c, raw) - (d.a0 ?? 0);
      // 15° steps while Snap is on or Shift is held (Alt places freely)
      if ((this.el.snap.checked || e.shiftKey) && !e.altKey) deg = Math.round(deg / 15) * 15;
      else deg = Math.round(deg);
      this.map.objects[this.selectedIndex()] = tiltObject(d.orig, deg - from);
      this.dirty();
      return;
    }
    // A tilted shape is edited in its own (untilted) frame, from where the drag started, then
    // shifted so the parts that didn't change stay where they were
    const tilt = d.orig.tilt ?? 0;
    const shapeHandle = h.kind === 'corner' || h.kind === 'vertex' || h.kind === 'arc';
    const c0 = shapeCenter(d.orig.shape);
    if (tilt && shapeHandle) {
      o.shape = clone(d.orig.shape);
      raw = rotatePoint(raw, c0, -tilt);
      p = rotatePoint(p, c0, -tilt);
    }
    if (h.kind === 'pivot' && o.rotation) {
      // Snap to the exact center / corners when close (hold Alt to place freely)
      const reach = PIVOT_SNAP_PX * unitsPerPx(this.el.canvas, this.map);
      let best: { p: Point; label: string } | null = null;
      let bestD = reach;
      if (!e.altKey) {
        for (const t of this.pivotTargets(o)) {
          const dist = Math.hypot(t.p.x - raw.x, t.p.y - raw.y);
          if (dist <= bestD) {
            bestD = dist;
            best = t;
          }
        }
      }
      this.pivotSnap = best;
      o.rotation.pivot = best ? { x: Math.round(best.p.x * 100) / 100, y: Math.round(best.p.y * 100) / 100 } : p;
    } else if (h.kind === 'aim' && (o.laser || o.turret)) {
      const b = shapeBounds(o.shape);
      const deg = (Math.atan2(raw.y - (b.y + b.h / 2), raw.x - (b.x + b.w / 2)) * 180) / Math.PI;
      const ang = ((Math.round(this.el.snap.checked ? Math.round(deg / 15) * 15 : deg) % 360) + 360) % 360;
      if (o.laser) o.laser.angle = ang;
      else o.turret!.angle = ang > 180 ? ang - 360 : ang;
    } else if (h.kind === 'arc' && o.shape.type === 'sector') {
      const s = o.shape;
      const deg = (Math.atan2(raw.y - s.cy, raw.x - s.cx) * 180) / Math.PI;
      // Angles snap to 15° steps while Snap is on
      const ang = this.el.snap.checked ? Math.round(deg / 15) * 15 : Math.round(deg);
      const norm = (a: number) => ((a % 360) + 360) % 360;
      if (h.part === 'radius') {
        s.r = Math.max(4, this.snapv(Math.hypot(raw.x - s.cx, raw.y - s.cy)));
        if (s.inner && s.inner >= s.r) s.inner = Math.max(1, s.r - 2);
      } else if (h.part === 'inner') s.inner = Math.min(s.r - 2, Math.max(1, this.snapv(Math.hypot(raw.x - s.cx, raw.y - s.cy))));
      else if (h.part === 'start') {
        const end = s.start + s.sweep;
        s.sweep = norm(end - ang) || 360;
        s.start = norm(ang);
      } else {
        s.sweep = norm(ang - s.start) || 360;
      }
    } else if (h.kind === 'marker' && o.motion) o.motion.points[h.j] = p;
    else if (h.kind === 'vertex' && o.shape.type === 'poly') o.shape.points[h.j] = { ...o.shape.points[h.j], x: p.x, y: p.y };
    else if (h.kind === 'corner') {
      const opposite = rectCorners(shapeBounds(d.orig.shape))[(h.j + 2) % 4];
      let r = rectFromCorners(opposite, p);
      r.w = Math.max(2, r.w);
      r.h = Math.max(2, r.h);
      if (isSquare(o)) {
        // Switch buttons, portals and laser emitters stay square
        const s = Math.max(r.w, r.h);
        r = { x: p.x < opposite.x ? opposite.x - s : opposite.x, y: p.y < opposite.y ? opposite.y - s : opposite.y, w: s, h: s };
      }
      if (o.shape.type === 'rect') o.shape = { type: 'rect', ...r };
      else if (o.shape.type === 'ellipse') o.shape = { type: 'ellipse', cx: r.x + r.w / 2, cy: r.y + r.h / 2, rx: r.w / 2, ry: r.h / 2 };
    }
    if (tilt && shapeHandle) {
      const c1 = shapeCenter(o.shape);
      const at = rotatePoint(c1, c0, tilt);
      o.shape = translateShape(o.shape, Math.round((at.x - c1.x) * 100) / 100, Math.round((at.y - c1.y) * 100) / 100);
    }
    this.dirty();
  }

  private onUp(e: PointerEvent): void {
    if (this.pan && e.pointerId === this.pan.id) {
      this.pan = null;
      if (this.el.canvas.hasPointerCapture(e.pointerId)) this.el.canvas.releasePointerCapture(e.pointerId);
      this.updateCursor();
      return;
    }
    const d = this.drag;
    this.drag = null;
    this.pivotSnap = null;
    if (this.el.canvas.hasPointerCapture(e.pointerId)) this.el.canvas.releasePointerCapture(e.pointerId);
    if (!d) return;
    if (d.type === 'marquee') {
      const r = rectFromCorners({ x: d.x0, y: d.y0 }, { x: d.x1, y: d.y1 });
      if (r.w < 2 && r.h < 2) return;
      // Objects entirely inside the box (PowerPoint style)
      const hits: number[] = [];
      this.map.objects.forEach((o, i) => {
        const b = tiltedBounds(o.shape, o.tilt);
        if (b.x >= r.x && b.y >= r.y && b.x + b.w <= r.x + r.w && b.y + b.h <= r.y + r.h) hits.push(i);
      });
      this.selectObjects([...d.base, ...hits]);
      return;
    }
    if (d.type === 'move') {
      if (d.moved) return this.changed();
      // A click without dragging inside a multi-selection narrows it to the clicked group,
      // or from a whole group down to the clicked member
      if (d.clicked !== null && this.selIds().length > 1) {
        const unit = this.withGroups([d.clicked]);
        const ids = this.selIds();
        const same = unit.length === ids.length && unit.every((i) => ids.includes(i));
        if (same && unit.length > 1) this.selectObjects([d.clicked], true);
        else if (!same) this.selectObjects(unit, true);
      }
      return;
    }
    if (d.type !== 'box') {
      if (d.moved) this.changed();
      return;
    }

    let r = rectFromCorners({ x: d.x0, y: d.y0 }, { x: d.x1, y: d.y1 });
    if (d.square) {
      const s = Math.max(r.w, r.h);
      r = { x: d.x1 < d.x0 ? d.x0 - s : d.x0, y: d.y1 < d.y0 ? d.y0 - s : d.y0, w: s, h: s };
    }
    const tool = this.tool;

    if (tool.kind === 'zone') {
      if (r.w < 10 || r.h < 10) return;
      this.setZone(tool.zone, r, tool.shape === 'ellipse' ? { type: 'ellipse' } : undefined);
      return;
    }
    if (tool.kind !== 'object') return;

    if (tool.shape === 'sector') return this.addObject(tool, this.sectorFromDrag(d, tool.ring));
    if (tool.special === 'spike' || tool.role === 'mirror') return this.addObject(tool, this.lineShapeFromDrag(tool, d));
    if (tool.special === 'boulder' || tool.special === 'fall') return this.addObject(tool, { type: 'poly', points: boulderShape(d.x0, d.y0, 26) });
    // Pulleys: an 80 px wheel centered on the click (a drag sets its size)
    if (tool.role === 'pulley' && r.w < 4 && r.h < 4) r = { x: d.x0 - 40, y: d.y0 - 40, w: 80, h: 80 };
    // Lasers 24×24 and portals 40×40, square, centered on the click
    if (tool.role === 'laser' || tool.role === 'portal') {
      const size = tool.role === 'laser' ? 24 : 40;
      r = { x: d.x0 - size / 2, y: d.y0 - size / 2, w: size, h: size };
    }
    // Crystal stars are always 48×48, centered on the click, and a map has only one
    if (tool.role === 'crystal') {
      if (this.map.objects.some((o) => o.role === 'crystal')) return this.flash(tr('ed.oneCrystal'));
      r = { x: d.x0 - LIMITS.crystalSize / 2, y: d.y0 - LIMITS.crystalSize / 2, w: LIMITS.crystalSize, h: LIMITS.crystalSize };
    }
    // Turrets and missile launchers are always 60×60, centered on the click
    if (tool.role === 'turret') r = { x: d.x0 - LIMITS.turretSize / 2, y: d.y0 - LIMITS.turretSize / 2, w: LIMITS.turretSize, h: LIMITS.turretSize };
    // Torches 24×40, centered on the click
    if (tool.role === 'torch' && r.w < 4 && r.h < 4) r = { x: d.x0 - 12, y: d.y0 - 20, w: 24, h: 40 };
    // Coins are always 24×24, centered on the click
    if (tool.role === 'coin') r = { x: d.x0 - LIMITS.coinSize / 2, y: d.y0 - LIMITS.coinSize / 2, w: LIMITS.coinSize, h: LIMITS.coinSize };
    // A plain click drops a switch 40×40, an event zone 80×80, a door 120×20
    if (r.w < 4 && r.h < 4 && (tool.role === 'trigger' || tool.role === 'door')) {
      const [w, h] = tool.role === 'door' ? [120, 20] : isButton(tool.trigger) ? [40, 40] : [80, 80];
      r = { x: d.x0 - w / 2, y: d.y0 - h / 2, w, h };
    }
    // Grinders 48×48, saw blades 120×20, text boxes 200×50, safe zones 100×100
    if (r.w < 4 && r.h < 4 && (tool.special === 'disc' || tool.special === 'blade' || tool.role === 'text' || tool.role === 'safe' || tool.role === 'secret')) {
      const [w, h] = tool.special === 'disc' ? [48, 48] : tool.special === 'blade' ? [120, 20] : tool.role === 'text' ? [200, 50] : [100, 100];
      r = { x: d.x0 - w / 2, y: d.y0 - h / 2, w, h };
    }
    if (tool.special === 'disc') {
      // Always round
      const s = Math.max(r.w, r.h);
      r = { x: r.x + r.w / 2 - s / 2, y: r.y + r.h / 2 - s / 2, w: s, h: s };
    }
    // A plain click (no drag) drops a default-sized shape
    if (r.w < 4 && r.h < 4) r = { x: d.x0 - 30, y: d.y0 - 30, w: 60, h: 60 };
    if (r.w < 2 || r.h < 2) return;
    const shape: Shape = tool.shape === 'ellipse'
      ? { type: 'ellipse', cx: r.x + r.w / 2, cy: r.y + r.h / 2, rx: r.w / 2, ry: r.h / 2 }
      : { type: 'rect', ...r };
    this.addObject(tool, shape);
  }

  /** Spike: drag from the base to the tip. Mirror: drag from one end to the other */
  private lineShapeFromDrag(tool: ObjectTool, d: { x0: number; y0: number; x1: number; y1: number }): Shape {
    const a = { x: d.x0, y: d.y0 };
    let b = { x: d.x1, y: d.y1 };
    if (Math.hypot(b.x - a.x, b.y - a.y) < 6) b = tool.special === 'spike' ? { x: a.x, y: a.y - 60 } : { x: a.x + 80, y: a.y };
    if (tool.special === 'spike') return { type: 'poly', points: spikeShape(a, b, 16) };
    // A thin plate along the line
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const nx = (-(b.y - a.y) / len) * 3;
    const ny = ((b.x - a.x) / len) * 3;
    const r = (v: number) => Math.round(v * 100) / 100;
    return {
      type: 'poly',
      points: [
        { x: r(a.x + nx), y: r(a.y + ny) }, { x: r(b.x + nx), y: r(b.y + ny) },
        { x: r(b.x - nx), y: r(b.y - ny) }, { x: r(a.x - nx), y: r(a.y - ny) },
      ],
    };
  }

  /**
   * Sector tool: drag from the apex outward; the drag direction is the middle of a 90° slice.
   * A ring sector (#53/#54) starts with its inner radius at half the outer one.
   */
  private sectorFromDrag(d: { x0: number; y0: number; x1: number; y1: number }, ring = false): Shape {
    let r = Math.hypot(d.x1 - d.x0, d.y1 - d.y0);
    let dir = (Math.atan2(d.y1 - d.y0, d.x1 - d.x0) * 180) / Math.PI;
    if (r < 4) {
      r = 60;
      dir = -90; // a plain click: a slice pointing up
    }
    if (this.el.snap.checked) dir = Math.round(dir / 15) * 15;
    const out: Shape = { type: 'sector', cx: d.x0, cy: d.y0, r: Math.round(r), start: (((dir - 45) % 360) + 360) % 360, sweep: 90 };
    if (ring) out.inner = Math.max(1, Math.round(r * 0.5));
    return out;
  }

  private closeDraft(): void {
    const draft = this.draft;
    this.draft = null;
    if (!draft || draft.points.length < 3) return this.updateHint();
    const shape: Shape = draft.tool.shape === 'free'
      ? { type: 'poly', points: draft.points, free: true }
      : { type: 'poly', points: draft.points };
    if (draft.tool.kind === 'zone') {
      const z = zoneFromShape(shape);
      if (z.rect.w < 10 || z.rect.h < 10) return this.updateHint();
      return this.setZone(draft.tool.zone, z.rect, z.shape);
    }
    this.addObject(draft.tool, shape);
  }

  /** Place START or GOAL: its rectangle, and its shape inside it (none = the rectangle itself) */
  private setZone(zone: 'start' | 'goal', r: Rect, shape: ZoneShape | undefined): void {
    const key = zone === 'start' ? 'startShape' : 'goalShape';
    this.edit(() => {
      this.map[zone] = r;
      if (shape) this.map[key] = shape;
      else delete this.map[key];
    });
    this.selectZone(zone);
    this.updateHint();
  }

  private addObject(tool: ObjectTool, shape: Shape): void {
    if (this.map.objects.length >= LIMITS.maxObjects) return;
    const o: MapObject = { role: tool.role, shape };
    if (tool.behavior === 'rotating') o.rotation = defaultRotation(o);
    if (tool.behavior === 'blinking') o.blink = { ...DEFAULT_BLINK };
    if (tool.ice) o.ice = { grip: DEFAULT_ICE_GRIP };
    if (tool.special === 'boulder') o.boulder = true;
    if (tool.behavior === 'moving') o.motion = newMotion(o);
    if (tool.role === 'trigger') {
      const kind = tool.trigger ?? 'switch';
      o.trigger = { kind, color: this.lastColor };
      if (kind === 'timer') o.trigger.duration = 3000;
      if (kind === 'hold') o.trigger.duration = 1000;
    }
    if (tool.role === 'door') o.door = { mode: 'auto', color: this.lastColor, moveMs: 600, waitMs: 1000 };
    if (tool.special === 'disc') o.saw = { kind: 'disc', clockwise: true, spin: 720, stroke: 0, strokeMs: 0 };
    if (tool.special === 'blade') o.saw = { kind: 'blade', clockwise: true, spin: 0, stroke: 24, strokeMs: 400 };
    if (tool.role === 'text') o.text = { text: tr('common.text'), color: '#243450', font: 'main', size: 24, bold: true, align: 'center', outlineWidth: 3, background: '#ffffffb3' };
    if (tool.special === 'spike' && shape.type === 'poly') {
      const [tip, b1, b2] = shape.points;
      const base = { x: (b1.x + b2.x) / 2, y: (b1.y + b2.y) / 2 };
      const reach = Math.round(Math.hypot(tip.x - base.x, tip.y - base.y));
      o.spike = { angle: Math.round((Math.atan2(tip.y - base.y, tip.x - base.x) * 180) / Math.PI), reach, thrustMs: 120, returnMs: 900, waitMs: 900, delay: 0 };
    }
    if (tool.role === 'fog') o.fog = { kind: tool.fog ?? 'fog', density: 70 };
    if (tool.role === 'torch') {
      o.light = { radius: DEFAULT_TORCH_LIGHT };
      if (tool.carry) o.torch = { carry: true };
    }
    if (tool.role === 'secret') o.secret = { radius: DEFAULT_SECRET_RADIUS };
    if (tool.special === 'fall') o.fall = { ...DEFAULT_FALL };
    if (tool.role === 'pulley') o.pulley = { color: this.lastColor, ...DEFAULT_PULLEY };
    if (tool.role === 'turret') o.turret = { ...(tool.turret === 'missile' ? DEFAULT_MISSILE : DEFAULT_GUN) };
    if (tool.role === 'laser') o.laser = { color: this.lastColor, angle: 0, on: true };
    if (tool.role === 'portal') {
      const same = this.map.objects.filter((m) => m.portal?.color === this.lastColor).length;
      o.portal = { color: this.lastColor, order: same, mode: 'both' };
    }
    this.edit(() => this.map.objects.push(o));
    const i = this.map.objects.length - 1;
    if (tool.behavior === 'moving') this.markerMode = i;
    this.selectObjects([i], true);
    this.updateHint();
  }

  private onDoubleClick(e: MouseEvent): void {
    if (this.tool.kind !== 'select' || this.draft || this.markerMode !== null) return;
    const o = this.selectedObject();
    if (!o || o.shape.type !== 'poly') return;
    const shape = o.shape;
    const raw = this.pointer(e);
    const h = this.hitHandle(raw);
    if (h?.kind === 'vertex') {
      this.edit(() => {
        const v = shape.points[h.j];
        shape.points[h.j] = v.smooth ? { x: v.x, y: v.y } : { ...v, smooth: true };
      });
      return;
    }
    // Insert a vertex on the nearest edge
    const pts = shape.points;
    let best = -1;
    let bestD = 8 * unitsPerPx(this.el.canvas, this.map);
    for (let j = 0; j < pts.length; j++) {
      const a = pts[j];
      const b = pts[(j + 1) % pts.length];
      const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2 || 1;
      const t = Math.max(0, Math.min(1, ((raw.x - a.x) * (b.x - a.x) + (raw.y - a.y) * (b.y - a.y)) / len2));
      const dist = Math.hypot(a.x + (b.x - a.x) * t - raw.x, a.y + (b.y - a.y) * t - raw.y);
      if (dist < bestD) {
        bestD = dist;
        best = j;
      }
    }
    if (best >= 0 && pts.length < LIMITS.maxPolyPoints) {
      const p = this.snapPoint(raw);
      this.edit(() => shape.points.splice(best + 1, 0, p));
    }
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.visible) return;
    const t = e.target;
    if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement) return;
    if (e.altKey) return;
    const mod = e.ctrlKey || e.metaKey;
    // Letters by physical key (e.code), so shortcuts also work with a non-Latin IME such as Korean
    const code = e.code;
    const letter = code.startsWith('Key') ? code.slice(3).toLowerCase() : e.key.toLowerCase();

    if (this.helpBox && !this.helpBox.hidden) {
      if (e.key === 'Escape' || e.key === '?' || code === 'Slash') {
        e.preventDefault();
        this.toggleHelp(false);
      }
      return;
    }

    if (code === 'Space' && !mod) {
      // Held: drag to pan. preventDefault also keeps a focused button from being pressed
      e.preventDefault();
      if (!this.spaceHeld) {
        this.spaceHeld = true;
        this.updateCursor();
      }
      return;
    }

    const arrow = ARROWS[e.key];
    if (arrow && !mod) {
      if (this.draft || this.markerMode !== null || !this.sel) return;
      e.preventDefault();
      const step = (this.el.snap.checked ? GRID : 1) * (e.shiftKey ? 10 : 1);
      this.nudge(arrow[0] * step, arrow[1] * step);
      return;
    }

    if (mod) {
      const cmds = this.commands();
      const run = (c: Command) => {
        e.preventDefault();
        if (c.enabled) c.run();
      };
      if (code === 'BracketRight') return run(e.shiftKey ? cmds.front : cmds.forward);
      if (code === 'BracketLeft') return run(e.shiftKey ? cmds.back : cmds.backward);
      if (!['z', 'y', 'd', 'c', 'x', 'v', 'a', 'g'].includes(letter)) return;
      // Leave the browser's own copy / paste alone when there is nothing of ours to act on
      if ((letter === 'c' || letter === 'x') && !cmds.copy.enabled) return;
      if (letter === 'v' && !cmds.paste.enabled) return;
      e.preventDefault();
      if (letter === 'z') {
        if (e.shiftKey) this.redo();
        else this.undo();
      } else if (letter === 'y') this.redo();
      else if (letter === 'd') run(cmds.duplicate);
      else if (letter === 'c') run(cmds.copy);
      else if (letter === 'x') run(cmds.cut);
      else if (letter === 'v') run(cmds.paste);
      else if (letter === 'a') run(cmds.selectAll);
      else if (letter === 'g') run(e.shiftKey ? cmds.ungroup : cmds.group);
      return;
    }

    if (e.key === '?' || (code === 'Slash' && e.shiftKey)) {
      e.preventDefault();
      this.toggleHelp(true);
    } else if (e.key === 'Tab') {
      if (this.draft || this.markerMode !== null) return;
      e.preventDefault();
      this.cycleSelection(e.shiftKey ? -1 : 1);
    } else if (e.key === 'Enter') {
      if (this.draft) this.closeDraft();
      else this.finishModes();
    } else if (e.key === 'Escape') {
      if (this.draft || this.markerMode !== null) this.finishModes();
      else this.clearSelection();
    } else if (e.key === 'Backspace' && this.draft) {
      this.draft.points.pop();
      if (this.draft.points.length === 0) this.draft = null;
      this.updateHint();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      this.deleteSelected();
    } else if (e.key === '+' || e.key === '=' || code === 'NumpadAdd') {
      this.zoomAt(this.hover ?? { x: this.cam.x, y: this.cam.y }, ZOOM_STEP);
    } else if (e.key === '-' || code === 'NumpadSubtract') {
      this.zoomAt(this.hover ?? { x: this.cam.x, y: this.cam.y }, 1 / ZOOM_STEP);
    } else if (code === 'Digit0' || code === 'Numpad0') {
      this.resetZoom();
    } else if (e.repeat) {
      // Tool and toggle keys shouldn't fire repeatedly while held
    } else if (letter === 'v') {
      this.setTool({ kind: 'select' });
    } else if (code >= 'Digit1' && code <= 'Digit4') {
      this.setTool({ ...this.lastObjectTool, shape: SHAPES[Number(code.slice(5)) - 1][0] });
    } else if (letter === 'w') {
      const t = this.lastObjectTool;
      this.setTool({ ...t, role: t.role === 'path' ? 'wall' : 'path' });
    } else if (letter === 'm' || letter === 'r') {
      const t = this.lastObjectTool;
      const want: Behavior = letter === 'm' ? 'moving' : 'rotating';
      // Pressing again while that tool is active returns to a static object
      const active = this.tool.kind === 'object' && t.behavior === want;
      this.setTool({ ...t, behavior: active ? 'static' : want });
    } else if (letter === 's') {
      this.setTool({ kind: 'zone', zone: 'start' });
    } else if (letter === 'g') {
      this.setTool({ kind: 'zone', zone: 'goal' });
    } else if (letter === 'n') {
      this.el.snap.click();
    } else if (letter === 'p') {
      this.el.preview.click();
    } else if (letter === 'c') {
      this.el.center.click();
    } else if (letter === 'y') {
      const modes = SYMMETRY_MODES;
      const next = modes[(modes.indexOf(this.symmetryMode) + (e.shiftKey ? modes.length - 1 : 1)) % modes.length];
      this.el.symmetry.value = next;
      this.el.symmetry.dispatchEvent(new Event('change'));
      this.flash(tr('editor.symmetryNow', { mode: tr(`editor.sym.${next}`) }));
    } else if (letter === 't') {
      this.el.test.click();
    }
  }

  /** Move the selection by (dx, dy); a burst of nudges is one undo step */
  private nudge(dx: number, dy: number): void {
    const s = this.sel;
    if (!s) return;
    const key = JSON.stringify(s);
    const now = performance.now();
    const coalesce = this.lastNudge && this.lastNudge.key === key && now - this.lastNudge.t < 1000;
    if (!coalesce) this.snapshot();
    if (s.kind === 'objects') {
      for (const i of s.ids) this.map.objects[i] = translateObject(this.map.objects[i], dx, dy);
    } else {
      const zone = this.selectedZone()!;
      zone.x += dx;
      zone.y += dy;
    }
    this.lastNudge = { key, t: now };
    this.changed();
  }

  /** Tab / Shift+Tab: step through START, GOAL and every object */
  private cycleSelection(dir: 1 | -1): void {
    const all: Selection[] = [{ kind: 'start' }, { kind: 'goal' }, ...this.map.objects.map((_, i) => ({ kind: 'objects' as const, ids: [i] }))];
    const cur = all.findIndex((s) => JSON.stringify(s) === JSON.stringify(this.sel));
    const next = cur < 0 ? (dir > 0 ? 0 : all.length - 1) : (cur + dir + all.length) % all.length;
    if (this.tool.kind !== 'select') this.setTool({ kind: 'select' });
    this.sel = all[next];
    this.renderProps();
  }

  private copySelected(): boolean {
    const ids = [...this.selIds()].sort((a, b) => a - b);
    if (!ids.length) return false;
    this.clipboard = { objs: ids.map((i) => clone(this.map.objects[i])), pastes: 0 };
    return true;
  }

  /** Append copies of objects (offset), with fresh group ids, and select them */
  private insertCopies(objs: readonly MapObject[], off: number): void {
    if (this.map.objects.length >= LIMITS.maxObjects) return this.flash(tr('ed.tooManyObjects', { max: LIMITS.maxObjects }));
    this.finishModes();
    editCommands.insertCopies(this.model, objs, off);
    this.lastNudge = null;
    if (this.tool.kind !== 'select') this.setTool({ kind: 'select' });
    this.changed();
  }

  private paste(): void {
    const c = this.clipboard;
    if (!c) return;
    c.pastes++;
    this.insertCopies(c.objs, GRID * 2 * c.pastes);
  }

  private nextGroupId(): number { return editCommands.nextGroupId(this.model); }

  // ───────────────────────── Arrange commands ─────────────────────────

  /** Everything the context menu, shortcuts and properties panel can do with the selection */
  private commands(): Record<CommandId, Command> {
    const ids = this.selIds();
    const objs = this.map.objects;
    const n = ids.length;
    const units = this.selUnits();
    const zone = this.selectedZone();
    const groupedSel = ids.some((i) => objs[i].group !== undefined);
    const oneGroup = n > 1 && objs[ids[0]].group !== undefined && ids.every((i) => objs[i].group === objs[ids[0]].group);
    const rotating = ids.filter((i) => objs[i].rotation);
    const lu = this.lastUngrouped;
    const canRegroup = !!lu && lu.count === objs.length && lu.ids.every((i) => objs[i] && objs[i].group === undefined);
    const toMap = this.alignToMap || (zone ? true : units.length < 2);
    const cmd = (label: string, enabled: boolean, run: () => void, keys?: string): Command => ({ label, enabled, run, keys });
    const align = (mode: AlignMode, label: string) => cmd(label, n > 0 || !!zone, () => this.align(mode));
    const mergeable = ids.every((i) => (objs[i].role === 'path' || objs[i].role === 'wall' || objs[i].role === 'dark') && !objs[i].spike && !objs[i].boulder && !objs[i].saw && !objs[i].fall);
    const merge = (op: MergeOp, label: string) => cmd(label, n >= 2 && mergeable, () => this.merge(op));
    return {
      cut: cmd(tr('ed.cut'), n > 0, () => this.copySelected() && this.deleteSelected(), 'Ctrl+X'),
      copy: cmd(tr('ed.copy'), n > 0, () => this.copySelected(), 'Ctrl+C'),
      paste: cmd(tr('ed.paste'), !!this.clipboard, () => this.paste(), 'Ctrl+V'),
      duplicate: cmd(tr('common.duplicate'), n > 0, () => this.duplicateSelected(), 'Ctrl+D'),
      delete: { ...cmd(tr('common.delete'), n > 0, () => this.deleteSelected(), 'Del'), danger: true },

      selectAll: cmd(tr('common.selectAll'), objs.length > 0, () => this.selectObjects(objs.map((_, i) => i), true), 'Ctrl+A'),
      selectPaths: cmd(tr('ed.allPaths'), objs.some((o) => o.role === 'path'), () => this.selectObjects(this.indicesWhere((o) => o.role === 'path'), true)),
      selectWalls: cmd(tr('ed.allWalls'), objs.some((o) => o.role === 'wall'), () => this.selectObjects(this.indicesWhere((o) => o.role === 'wall'), true)),
      selectSame: cmd(tr('ed.sameKindAsThis'), n > 0, () => {
        const id = objectToolId(objs[ids[0]]);
        this.selectObjects(this.indicesWhere((o) => objectToolId(o) === id), true);
      }),

      front: cmd(tr('ed.bringToFront'), n > 0, () => this.order('front'), 'Ctrl+Shift+]'),
      forward: cmd(tr('common.bringForward'), n > 0, () => this.order('forward'), 'Ctrl+]'),
      backward: cmd(tr('common.sendBackward'), n > 0, () => this.order('backward'), 'Ctrl+['),
      back: cmd(tr('ed.sendToBack'), n > 0, () => this.order('back'), 'Ctrl+Shift+['),

      alignLeft: align('left', tr('ed.alignLeft')),
      alignCenter: align('center', tr('ed.alignCenter')),
      alignRight: align('right', tr('ed.alignRight')),
      alignTop: align('top', tr('ed.alignTop')),
      alignMiddle: align('middle', tr('ed.alignMiddle')),
      alignBottom: align('bottom', tr('ed.alignBottom')),
      distH: cmd(tr('ed.distributeHorizontally'), toMap ? n > 0 : units.length >= 3, () => this.distribute('x')),
      distV: cmd(tr('ed.distributeVertically'), toMap ? n > 0 : units.length >= 3, () => this.distribute('y')),
      alignToMap: { ...cmd(tr('ed.alignToMap'), true, () => (this.alignToMap = !this.alignToMap)), checked: this.alignToMap },

      rotCW: cmd(tr('ed.rotateRight90'), n > 0, () => this.turn('cw')),
      rotCCW: cmd(tr('ed.rotateLeft90'), n > 0, () => this.turn('ccw')),
      flipV: cmd(tr('ed.flipVertical'), n > 0, () => this.turn('flipV')),
      flipH: cmd(tr('ed.flipHorizontal'), n > 0, () => this.turn('flipH')),

      group: cmd(tr('ed.group'), n >= 2 && !oneGroup, () => this.groupSelected(), 'Ctrl+G'),
      ungroup: cmd(tr('ed.ungroup'), groupedSel, () => this.ungroupSelected(), 'Ctrl+Shift+G'),
      regroup: cmd(tr('ed.regroup'), canRegroup, () => this.regroup()),

      union: merge('union', tr('ed.union')),
      combine: merge('combine', tr('ed.combine')),
      fragment: merge('fragment', tr('ed.fragment')),
      intersect: merge('intersect', tr('ed.intersect')),
      subtract: merge('subtract', tr('ed.subtract')),

      pivotCenter: cmd(tr('ed.pivotToCenter'), rotating.length > 0, () => this.setPivots(false)),
      pivotCentroid: cmd(tr('ed.pivotToCenterOfMass'), rotating.length > 0 && rotating.some((i) => objs[i].shape.type === 'poly'), () => this.setPivots(true)),

      makePath: cmd(tr('ed.makePath'), ids.some((i) => objs[i].role === 'wall' && !objs[i].saw), () => this.edit(() => ids.forEach((i) => objs[i].role === 'wall' && !objs[i].saw && (objs[i].role = 'path')))),
      makeWall: cmd(tr('ed.makeWall'), ids.some((i) => objs[i].role === 'path'), () => this.edit(() => ids.forEach((i) => objs[i].role === 'path' && (objs[i].role = 'wall')))),
    };
  }

  private indicesWhere(f: (o: MapObject) => boolean): number[] {
    const out: number[] = [];
    this.map.objects.forEach((o, i) => f(o) && out.push(i));
    return out;
  }

  private order(op: ZOrder): void {
    editCommands.reorderSelection(this.model, op);
    this.lastUngrouped = null;
    this.lastNudge = null;
    this.changed();
  }

  private align(mode: AlignMode): void { editCommands.alignSelection(this.model, mode, this.alignToMap); this.lastNudge = null; this.changed(); }

  private distribute(axis: 'x' | 'y'): void { editCommands.distributeSelection(this.model, axis, this.alignToMap); this.lastNudge = null; this.changed(); }

  /** Rotate / flip each unit (a group, or a loose object) about its own center */
  private turn(t: Turn): void { editCommands.turnSelection(this.model, t); this.lastNudge = null; this.changed(); }

  private groupSelected(): void {
    editCommands.groupSelection(this.model);
    this.lastUngrouped = null;
    this.lastNudge = null;
    this.changed();
  }

  private ungroupSelected(): void {
    const ids = editCommands.ungroupSelection(this.model);
    if (!ids.length) return;
    this.lastUngrouped = { ids, count: this.map.objects.length };
    this.lastNudge = null;
    this.changed();
  }

  private regroup(): void {
    const lu = this.lastUngrouped;
    if (!lu) return;
    const id = this.nextGroupId();
    this.edit(() => lu.ids.forEach((i) => (this.map.objects[i].group = id)));
    this.lastUngrouped = null;
    if (this.tool.kind !== 'select') this.setTool({ kind: 'select' });
    this.selectObjects(lu.ids, true);
  }

  private setPivots(centroid: boolean): void { editCommands.setSelectionPivots(this.model, centroid); this.lastNudge = null; this.changed(); }

  /**
   * PowerPoint-style merge. The result takes its type, movement and rotation from the first
   * selected object, and is always a freeform shape. Several separate pieces are grouped
   * (except for Fragment, which is meant to break shapes apart).
   */
  private merge(op: MergeOp): void {
    const result = editCommands.mergeSelection(this.model, op);
    if (!result.ok) {
      if (result.reason === 'invalid') return this.flash(tr('ed.theseShapesCouldNotBe'));
      if (result.reason === 'limit') return this.flash(tr('ed.tooManyObjects', { max: LIMITS.maxObjects }));
      return this.flash(op === 'intersect' ? tr('ed.noOverlap') : tr('ed.nothingLeft'));
    }
    this.finishModes();
    this.lastNudge = null;
    this.changed();
    if (op === 'fragment') this.flash(tr('ed.splitInto', { n: result.count }));
  }

  // ───────────────────────── Context menu ─────────────────────────

  private onContextMenu(e: MouseEvent): void {
    if (!this.visible) return;
    const x = e.clientX;
    const y = e.clientY;
    if (this.draft) {
      const pts = this.draft.points.length;
      return openContextMenu(x, y, [
        { label: tr('ed.finishShape'), keys: 'Enter', disabled: pts < 3, action: () => this.closeDraft() },
        { label: tr('ed.removeLastPoint'), keys: 'Backspace', action: () => {
          this.draft?.points.pop();
          if (this.draft && !this.draft.points.length) this.draft = null;
          this.updateHint();
        } },
        { label: tr('ed.cancel'), keys: 'Esc', action: () => this.finishModes() },
      ]);
    }
    if (this.markerMode !== null) {
      return openContextMenu(x, y, [{ label: tr('ed.donePlacingMarkers'), keys: 'Enter', action: () => this.finishModes() }]);
    }

    // Right-clicking something outside the selection selects it first
    const hit = this.hitTest(this.pointer(e));
    if (hit?.kind === 'object') {
      if (!this.selIds().includes(hit.i)) {
        if (this.tool.kind !== 'select') this.setTool({ kind: 'select' });
        this.selectObjects([hit.i]);
      }
    } else if (hit) {
      if (this.tool.kind !== 'select') this.setTool({ kind: 'select' });
      this.selectZone(hit.kind);
    } else {
      this.clearSelection();
    }

    const c = this.commands();
    const item = (k: CommandId): MenuItem => ({
      label: c[k].label, keys: c[k].keys, disabled: !c[k].enabled, action: c[k].run, checked: c[k].checked, danger: c[k].danger,
    });
    const sub = (label: string, items: MenuItem[]): MenuItem => ({
      label, submenu: items, disabled: items.every((it) => it === 'sep' || it.disabled),
    });
    const alignMenu = sub(tr('common.align'), [
      item('alignLeft'), item('alignCenter'), item('alignRight'), 'sep',
      item('alignTop'), item('alignMiddle'), item('alignBottom'), 'sep',
      item('distH'), item('distV'), 'sep', item('alignToMap'),
    ]);
    const selectMenu = sub(tr('ed.select'), [item('selectAll'), item('selectPaths'), item('selectWalls'), item('selectSame')]);
    const help: MenuItem = { label: tr('ed.keyboardShortcuts'), keys: '?', action: () => this.toggleHelp(true) };

    if (this.selectedZone()) {
      return openContextMenu(x, y, [alignMenu, 'sep', selectMenu, item('paste'), 'sep', help]);
    }
    if (!this.selIds().length) {
      return openContextMenu(x, y, [item('paste'), selectMenu, 'sep', help]);
    }
    openContextMenu(x, y, [
      item('cut'), item('copy'), item('paste'), item('duplicate'), 'sep',
      sub(tr('ed.bringToFront'), [item('front'), item('forward')]),
      sub(tr('ed.sendToBack'), [item('back'), item('backward')]),
      alignMenu,
      sub(tr('ed.rotate'), [item('rotCW'), item('rotCCW'), 'sep', item('flipV'), item('flipH')]),
      sub(tr('ed.group'), [item('group'), item('ungroup'), item('regroup')]),
      sub(tr('ed.mergeShapes'), [item('union'), item('combine'), item('fragment'), item('intersect'), item('subtract')]),
      'sep',
      sub(tr('ed.rotationPivot'), [item('pivotCenter'), item('pivotCentroid')]),
      sub(tr('ed.type'), [item('makePath'), item('makeWall')]),
      selectMenu,
      'sep',
      item('delete'),
    ]);
  }

  /** Shortcut list overlay (?); built on first use */
  private toggleHelp(show?: boolean): void {
    if (!this.helpBox) {
      if (show === false) return;
      const box = document.createElement('div');
      box.className = 'shortcut-help';
      box.hidden = true;
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-label', tr('ed.keyboardShortcuts'));
      const card = document.createElement('div');
      card.className = 'shortcut-card';
      const head = document.createElement('div');
      head.className = 'shortcut-head';
      const h = document.createElement('h3');
      h.textContent = tr('ed.keyboardShortcuts');
      const close = document.createElement('button');
      close.type = 'button';
      close.textContent = '×';
      close.title = tr('ed.closeEsc');
      close.addEventListener('click', () => this.toggleHelp(false));
      head.append(h, close);
      card.append(head);
      for (const [title, rows] of SHORTCUTS) {
        const sec = document.createElement('section');
        const h4 = document.createElement('h4');
        h4.textContent = title;
        const dl = document.createElement('dl');
        for (const [keys, what] of rows) {
          const dt = document.createElement('dt');
          keys.split(' / ').forEach((k, n) => {
            if (n) dt.append(' / ');
            k.split('+').forEach((part, m) => {
              if (m) dt.append('+');
              const kbd = document.createElement('kbd');
              kbd.textContent = part;
              dt.append(kbd);
            });
          });
          const dd = document.createElement('dd');
          dd.textContent = what;
          dl.append(dt, dd);
        }
        sec.append(h4, dl);
        card.append(sec);
      }
      box.append(card);
      box.addEventListener('pointerdown', (e) => {
        if (e.target === box) this.toggleHelp(false);
      });
      (this.el.canvas.closest('.editor-view') ?? document.body).append(box);
      this.helpBox = box;
    }
    const open = show ?? this.helpBox.hidden;
    this.helpBox.hidden = !open;
    this.el.shortcuts.setAttribute('aria-pressed', String(open));
  }

  private deleteSelected(): void {
    if (!this.selIds().length) return;
    this.finishModes();
    editCommands.deleteSelection(this.model);
    this.lastUngrouped = null;
    this.lastNudge = null;
    this.changed();
  }

  private duplicateSelected(): void {
    const ids = [...this.selIds()].sort((a, b) => a - b);
    if (!ids.length) return;
    this.insertCopies(ids.map((i) => this.map.objects[i]), GRID * 2);
  }

  // ───────────────────────── Properties panel ─────────────────────────

  /** 16 color swatches */

  /** Falling rock (#51): drop height and timing */

  /** Pulley (#52): color, what happens when it isn't turned, and how far a turn winds */

  /** Fog / sand dust: which one, and how thick */

  /** A button that runs an arrange command (disabled when it can't apply) */

  private renderProps(): void { this.properties.renderProps(); }

  /** Rebuild the theme panel only when the theme actually changed, so open controls keep focus */
  private renderedTheme: string | null = null;
  private renderTheme(): void {
    const json = JSON.stringify(this.map.theme ?? null);
    if (json === this.renderedTheme) return;
    this.renderedTheme = json;
    renderThemePanel(this.el.theme, this.map.theme, (next) =>
      this.edit(() => {
        if (next) this.map.theme = next;
        else delete this.map.theme;
      }),
      chapterMazePresets(),
    );
  }

  /**
   * The bundled theme (official chapter or custom preset) the map wears when shared on its own:
   * its badge and music, and its maze colors (one of its designs can be picked for those).
   */
  private themePicker(m: MapData): HTMLElement {
    const sel = document.createElement('select');
    sel.append(new Option(tr('ed.themeNone'), ''));
    const picked = m.themeId ? bundledThemeById(m.themeId) : null;
    const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
    let current = '';
    // Each theme as a group: the theme itself, then its sub-themes under it
    for (const { id, name, entry } of bundledThemeOptions()) {
      const style = entry.info.style;
      const designs = style.designs ?? [];
      if (designs.length) {
        const group = document.createElement('optgroup');
        group.label = name;
        group.append(new Option(name, id), ...designs.map((d) => new Option(subThemeLabel(d.name), `${id}#${d.id}`)));
        sel.append(group);
      } else sel.append(new Option(name, id));
      if (picked === entry) {
        const design = (m.themeDesign ? designs.find((d) => d.id === m.themeDesign) : undefined)
          ?? designs.find((d) => same(d.maze, m.theme) && !same(style.maze, m.theme));
        current = design ? `${id}#${design.id}` : id;
      }
    }
    sel.value = current;
    sel.addEventListener('change', () => this.edit(() => {
      const [id, designId] = sel.value.split('#');
      const entry = id ? bundledThemeById(id) : null;
      if (!entry) {
        delete m.themeId;
        delete m.themeDesign;
        return;
      }
      m.themeId = id;
      const design = designId ? entry.info.style.designs?.find((d) => d.id === designId) : undefined;
      // The sub-theme (or the theme's own look) the level wears, also once it's in a pack
      if (design) m.themeDesign = design.id;
      else if (entry.info.style.designs?.length) m.themeDesign = DEFAULT_DESIGN;
      else delete m.themeDesign;
      const maze = design ? design.maze : entry.info.style.maze;
      if (maze) m.theme = clone(maze);
      else delete m.theme;
    }));
    const wrap = document.createElement('div');
    wrap.append(
      this.properties.group(this.properties.field(tr('ed.mapTheme'), sel, true)),
      this.properties.note(tr('ed.mapThemeNote')),
    );
    return wrap;
  }

  /**
   * Rebuild the level settings only when they changed, so a field being typed in keeps focus.
   * The fields write into the map object they were built for, so a replaced map (loaded from the
   * menu, undo / redo, new map) always rebuilds them, even when its settings look the same.
   */
  private renderedLevel: string | null = null;
  private renderedLevelMap: MapData | null = null;
  private renderLevel(): void {
    const m = this.map;
    const json = JSON.stringify([m.title, m.name, m.level, m.stars, this.lastClearMs, m.darkness, m.difficulty, m.themeId, m.themeDesign, m.theme]);
    if (json === this.renderedLevel && m === this.renderedLevelMap) return;
    this.renderedLevel = json;
    this.renderedLevelMap = m;

    const title = document.createElement('input');
    title.maxLength = LIMITS.maxText;
    title.placeholder = m.name;
    title.value = m.title ?? '';
    title.addEventListener('change', () => this.edit(() => {
      const v = title.value.trim().slice(0, LIMITS.maxText);
      if (v) m.title = v;
      else delete m.title;
    }));

    const level = document.createElement('input');
    level.type = 'number';
    level.min = '1';
    level.max = String(LIMITS.maxLevel);
    level.step = '1';
    level.placeholder = tr('common.none');
    level.value = m.level !== undefined ? String(m.level) : '';
    level.addEventListener('change', () => this.edit(() => {
      const v = Math.round(Number(level.value));
      if (level.value.trim() && v >= 1) m.level = Math.min(LIMITS.maxLevel, v);
      else delete m.level;
    }));

    const difficulty = document.createElement('input');
    difficulty.type = 'number';
    difficulty.min = '1';
    difficulty.max = '10';
    difficulty.step = '0.25';
    difficulty.placeholder = '1.00';
    difficulty.value = m.difficulty !== undefined ? m.difficulty.toFixed(2) : '';
    difficulty.addEventListener('change', () => this.edit(() => {
      const v = Number(difficulty.value);
      if (difficulty.value.trim() && Number.isFinite(v)) m.difficulty = Math.round(Math.min(10, Math.max(1, v)) * 100) / 100;
      else delete m.difficulty;
    }));

    const parts: HTMLElement[] = [
      this.properties.group(
        this.properties.field(tr('ed.levelTitle'), title, true),
        this.properties.field(tr('ed.levelNumber'), level),
        this.properties.field(tr('ed.difficulty110'), difficulty),
      ),
      this.properties.note(tr('ed.theTitleAndNumberAre')),
    ];

    parts.push(this.themePicker(m));
    parts.push(this.properties.toggle(tr('ed.starRatings'), !!m.stars, (on) => {
      if (!on) return void delete m.stars;
      // Suggest times from the last test clear, else 10 / 20 / 30 s
      const t = this.lastClearMs;
      const round = (ms: number) => Math.max(100, Math.ceil(ms / 100) * 100);
      m.stars = t !== null
        ? { three: round(t * 1.1), two: round(t * 1.5), one: round(t * 2) }
        : { three: 10_000, two: 20_000, one: 30_000 };
    }));
    const s = m.stars;
    if (s) {
      const sec = (key: 'three' | 'two' | 'one', label: string) =>
        this.properties.numField(label, s[key] / 1000, (v) => (s[key] = Math.round(Math.min(LIMITS.maxStarTime, Math.max(0.1, v) * 1000))), 0.1);
      parts.push(
        this.properties.group(sec('three', tr('ed.star3')), sec('two', tr('ed.star2')), sec('one', tr('ed.star1'))),
        this.properties.note(this.lastClearMs !== null
          ? tr('ed.lastClear', { time: formatSeconds(this.lastClearMs) })
          : tr('ed.starHelp')),
      );
    }
    parts.push(this.properties.toggle(tr('ed.globalDarkness42'), !!m.darkness, (on) => {
      if (on) m.darkness = { light: 60, intensity: 100 };
      else delete m.darkness;
    }));
    const dk = m.darkness;
    if (dk) {
      parts.push(
        this.properties.group(
          this.properties.numField(tr('ed.darknessIntensity'), dk.intensity ?? 100, (v) => (dk.intensity = Math.round(Math.min(100, Math.max(0, v)))), 5),
          this.properties.numField(tr('ed.lightRadius'), dk.light, (v) => (dk.light = Math.round(Math.min(LIMITS.maxLight, Math.max(LIMITS.minLight, v)))), 4),
        ),
        this.properties.note(tr('ed.darknessNote', { min: LIMITS.minLight })),
      );
    }
    this.el.level.replaceChildren(...parts);
  }

  private startMarkers(i: number): void {
    this.draft = null;
    this.markerMode = i;
    this.updateHint();
  }

  // ───────────────────────── Sharing / files ─────────────────────────

  private async share(): Promise<void> {
    if (this.el.share.disabled) return;
    const code = await encodeMap(validateMap(this.map));
    const url = `${location.origin}${location.pathname}#m=${code}`;
    this.el.shareUrl.value = url;
    this.el.shareUrl.select();
    try {
      await navigator.clipboard.writeText(url);
      this.el.verify.textContent = tr('ed.linkCopied', { n: url.length });
    } catch {
      this.el.verify.textContent = tr('ed.linkManual', { n: url.length });
    }
  }

  private exportJson(): void {
    const blob = new Blob([JSON.stringify(this.map, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${this.map.name.replace(/[\\/:*?"<>|]/g, '_') || 'map'}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  private async importJson(): Promise<void> {
    const file = this.el.importFile.files?.[0];
    this.el.importFile.value = '';
    if (!file) return;
    try {
      this.loadMap(validateMap(JSON.parse(await file.text())));
    } catch (err) {
      alert(tr('ed.loadFailed', { message: (err as Error).message }));
    }
  }

  // ───────────────────────── Drawing ─────────────────────────

  /** Small pill with object info, placed just above-right of (x, y) and kept inside the map */
  /** The tilt handle: a stem from the object's center, a round knob with a turn arrow, and the angle while turning */
  private drawRotateHandle(c: Point, angle: number, p: Point, u: number, active: boolean): void {
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = COLORS.select;
    ctx.lineWidth = 1.2 * u;
    if (active) {
      // Guide: straight up (0°) and the current direction, with the swept arc between them
      const r = Math.hypot(p.x - c.x, p.y - c.y);
      const tilt = (angle * Math.PI) / 180;
      ctx.setLineDash([3 * u, 3 * u]);
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(c.x, c.y - r);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      if (tilt) {
        ctx.fillStyle = 'rgba(58,159,240,0.15)';
        ctx.beginPath();
        ctx.moveTo(c.x, c.y);
        ctx.arc(c.x, c.y, Math.min(r, 40 * u), -Math.PI / 2, -Math.PI / 2 + tilt, tilt < 0);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    // Center (the axis)
    ctx.fillStyle = COLORS.select;
    ctx.beginPath();
    ctx.arc(c.x, c.y, 2.5 * u, 0, Math.PI * 2);
    ctx.fill();
    // Knob
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = COLORS.ink;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 6.5 * u, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3.2 * u, -Math.PI * 0.9, Math.PI * 0.4);
    ctx.stroke();
    const tip = { x: p.x + Math.cos(Math.PI * 0.4) * 3.2 * u, y: p.y + Math.sin(Math.PI * 0.4) * 3.2 * u };
    ctx.beginPath();
    ctx.moveTo(tip.x - 2.2 * u, tip.y + 0.4 * u);
    ctx.lineTo(tip.x, tip.y);
    ctx.lineTo(tip.x + 0.4 * u, tip.y - 2.2 * u);
    ctx.stroke();
    ctx.restore();
    if (active) this.drawInfoLabel(tiltText(angle), p.x + 10 * u, p.y - 6 * u, u);
  }

  private drawInfoLabel(text: string, x: number, y: number, u: number): void {
    const { ctx, map } = this;
    ctx.font = `600 ${12 * u}px ${FONT_MAIN}`;
    const padX = 7 * u;
    const w = ctx.measureText(text).width + padX * 2;
    const h = 20 * u;
    const lx = Math.max(2 * u, Math.min(x + 6 * u, map.width - w - 2 * u));
    const ly = Math.max(2 * u, Math.min(y - h - 6 * u, map.height - h - 2 * u));
    ctx.save();
    ctx.shadowColor = 'rgba(36,52,80,0.25)';
    ctx.shadowBlur = 6 * u * ctx.getTransform().a;
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath();
    ctx.roundRect(lx, ly, w, h, h / 2);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(36,52,80,0.25)';
    ctx.lineWidth = 1 * u;
    ctx.stroke();
    ctx.fillStyle = COLORS.ink;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, lx + padX, ly + h / 2 + 0.5 * u);
  }

  /**
   * Center lines (the map's middle, for lining things up) and the symmetry check: the mirror image
   * of every object as a faint outline, objects without a mirrored counterpart marked in red.
   */
  private drawSymmetry(u: number): void {
    const { ctx, map } = this;
    const mode = this.symmetryMode;
    const report = this.symmetry;
    const w = map.width;
    const h = map.height;
    const vertical = this.el.center.checked || mode === 'mirrorX' || mode === 'both' || mode === 'rotate';
    const horizontal = this.el.center.checked || mode === 'mirrorY' || mode === 'both' || mode === 'rotate';
    if (vertical || horizontal) {
      ctx.save();
      ctx.strokeStyle = COLORS.centerLine;
      ctx.lineWidth = 1.5 * u;
      ctx.setLineDash([10 * u, 6 * u]);
      ctx.beginPath();
      if (vertical) {
        ctx.moveTo(w / 2, 0);
        ctx.lineTo(w / 2, h);
      }
      if (horizontal) {
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w, h / 2);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      if (mode === 'rotate') {
        ctx.fillStyle = COLORS.centerLine;
        ctx.beginPath();
        ctx.arc(w / 2, h / 2, 4 * u, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    if (!report || mode === 'off') return this.setSymmetryStatus('');

    // Mirror images (faint), so you can see where each counterpart should go
    const steps = mode === 'both' ? (['mirrorX', 'mirrorY'] as const) : [mode];
    ctx.save();
    ctx.strokeStyle = COLORS.mirrorGhost;
    ctx.lineWidth = 1 * u;
    ctx.setLineDash([3 * u, 3 * u]);
    ctx.beginPath();
    const ghost = (poly: ArrayLike<number>) => {
      for (const step of steps) {
        for (let i = 0; i < poly.length; i += 2) {
          const [x, y] = mirrorPoint(step, w, h, poly[i], poly[i + 1]);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
      }
    };
    for (const o of this.compiled) ghost(o.poly);
    ghost(zoneRing(map.start, map.startShape));
    ghost(zoneRing(map.goal, map.goalShape));
    ctx.stroke();
    ctx.setLineDash([]);

    // Objects that break the symmetry
    ctx.fillStyle = COLORS.asymmetricFill;
    ctx.strokeStyle = COLORS.asymmetric;
    ctx.lineWidth = 2 * u;
    ctx.beginPath();
    for (const i of report.objects) {
      const o = this.compiled[i];
      if (o) traceObject(ctx, o, IDENTITY);
    }
    const zones = new Path2D();
    if (report.start) zones.addPath(zonePath(map.start, map.startShape));
    if (report.goal) zones.addPath(zonePath(map.goal, map.goalShape));
    ctx.fill('evenodd');
    ctx.stroke();
    ctx.fill(zones, 'evenodd');
    ctx.stroke(zones);
    ctx.restore();

    const broken = report.objects.length + (report.start ? 1 : 0) + (report.goal ? 1 : 0);
    this.setSymmetryStatus(broken ? tr('editor.symmetryBroken', { n: broken }) : tr('editor.symmetryOk'), broken > 0);
  }

  /** Result of the symmetry check, next to the mode picker ('' hides it) */
  private setSymmetryStatus(text: string, bad = false): void {
    const el = this.el.symmetryStatus;
    if (el.textContent === text && el.classList.contains('bad') === bad) return;
    el.textContent = text;
    el.hidden = !text;
    el.classList.toggle('bad', bad);
  }

  private draw(): void {
    if (!this.visible) return;
    const { ctx, map } = this;
    this.applyCamera();
    this.drawMinimap();
    const u = unitsPerPx(this.el.canvas, map);
    const objs = this.compiled;
    const preview = this.el.preview.checked;
    beginFrame(ctx, map);
    const t = preview ? performance.now() - this.previewStart : 0;
    this.beamCaster ??= new BeamCaster(map, objs);
    const beams = this.beamCaster.any ? this.beamCaster.beams({ timeOf: () => t, channels: initialChannels(map) }) : [];
    drawMap(ctx, map, objs, t, { gridOnTop: this.el.gridTop.checked, beams, now: performance.now(), sawGhost: 0.3 });
    // Spikes: how far they thrust
    ctx.setLineDash([4 * u, 3 * u]);
    ctx.strokeStyle = 'rgba(226,72,108,0.7)';
    ctx.lineWidth = 1.2 * u;
    for (const o of map.objects) {
      if (!o.spike || o.shape.type !== 'poly') continue;
      const tip = o.tilt ? rotatePoint(o.shape.points[0], shapeCenter(o.shape), o.tilt) : o.shape.points[0];
      const a = (o.spike.angle * Math.PI) / 180;
      ctx.beginPath();
      ctx.moveTo(tip.x, tip.y);
      ctx.lineTo(tip.x + Math.cos(a) * o.spike.reach, tip.y + Math.sin(a) * o.spike.reach);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // The map is drawn as one seamless floor and one wall mass, so overlapping pieces (or a wall
    // on the wall-colored area outside the paths) would be invisible while editing. Outline each one.
    ctx.lineWidth = 1.2 * u;
    ctx.setLineDash([5 * u, 4 * u]);
    const pose: Transform = { dx: 0, dy: 0, cos: 1, sin: 0 };
    for (const role of ['path', 'wall'] as const) {
      ctx.strokeStyle = role === 'path' ? COLORS.outlinePath : COLORS.outlineWall;
      ctx.beginPath();
      for (const o of objs) if (o.role === role) traceObject(ctx, o, transformAt(o, t, pose));
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Falling rocks (#51): a dashed drop line from where each one starts falling, with its outline there
    ctx.setLineDash([4 * u, 4 * u]);
    ctx.strokeStyle = 'rgba(226,72,108,0.65)';
    ctx.lineWidth = 1.2 * u;
    for (const o of objs) {
      const f = o.src?.fall;
      if (!f) continue;
      const cx = o.cx;
      const cy = o.cy;
      ctx.beginPath();
      ctx.moveTo(cx, cy - f.height);
      ctx.lineTo(cx, cy);
      traceObject(ctx, o, { dx: 0, dy: -f.height, cos: 1, sin: 0 });
      ctx.stroke();
    }
    ctx.setLineDash([]);
    // Secret walls see-through (the reveal follows the mouse), outlined like the other areas
    drawSecretWalls(ctx, map, objs, t, this.hover, 0.5);
    ctx.setLineDash([5 * u, 4 * u]);
    ctx.strokeStyle = COLORS.outlineWall;
    ctx.beginPath();
    for (const o of objs) if (o.role === 'secret') traceObject(ctx, o, transformAt(o, t, pose));
    ctx.stroke();
    ctx.setLineDash([]);
    // Fog / sand dust and darkness areas see-through, so what's under them stays editable
    drawFogAreas(ctx, map, objs, t, performance.now(), 0.6);
    ctx.setLineDash([5 * u, 4 * u]);
    ctx.strokeStyle = 'rgba(120,130,145,0.8)';
    ctx.beginPath();
    for (const o of objs) if (o.role === 'fog') traceObject(ctx, o, transformAt(o, t, pose));
    ctx.stroke();
    ctx.setLineDash([]);
    drawDarkAreas(ctx, objs, t, 0.55);
    ctx.setLineDash([5 * u, 4 * u]);
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.beginPath();
    for (const o of objs) if (o.role === 'dark') traceObject(ctx, o, transformAt(o, t, pose));
    ctx.stroke();
    ctx.setLineDash([]);
    // Global darkness: a light preview around the mouse
    if (map.darkness) {
      const lights = objectLights(objs, t);
      if (this.hover && map.darkness.light > 0) lights.push({ x: this.hover.x, y: this.hover.y, r: map.darkness.light });
      drawGlobalDark(ctx, map, lights, 0.3);
    }
    // Level number and title as they'll appear in game, in the chapter preset's badge design
    const badge = badgeFor(map);
    ctx.save();
    ctx.globalAlpha = 0.92;
    drawLevelBadge(ctx, map.level === undefined && !map.title ? { ...map, title: badgeTitle(map) } : map,
      badge?.style ?? { ...DEFAULT_BADGE, numberColor: COLORS.cursor }, badgeImage(badge?.imageUrl), performance.now());
    ctx.restore();

    // While previewing, show where dynamic objects rest (their editing position)
    if (preview) {
      ctx.setLineDash([4 * u, 3 * u]);
      ctx.strokeStyle = 'rgba(36,52,80,0.45)';
      ctx.lineWidth = 1.2 * u;
      for (const o of objs) {
        if (!o.dynamic) continue;
        ctx.beginPath();
        traceObject(ctx, o, IDENTITY);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    const selIndex = this.selectedIndex();
    const selIds = new Set(this.selIds());

    // Routes and pivots of every dynamic object (faint), the selected ones highlighted
    map.objects.forEach((o, i) => {
      const selected = selIds.has(i);
      if (o.motion) {
        const compiled = objs[i];
        let route = this.routeCache.get(compiled);
        if (!route) {
          route = new CompiledMotion(o.motion, shapeCenter(o.shape)).route();
          this.routeCache.set(compiled, route);
        }
        if (route.length >= 4) {
          ctx.strokeStyle = selected ? COLORS.routeSelected : COLORS.route;
          ctx.lineWidth = (selected ? 2 : 1.2) * u;
          ctx.setLineDash(selected ? [] : [6 * u, 4 * u]);
          ctx.beginPath();
          ctx.moveTo(route[0], route[1]);
          for (let k = 2; k < route.length; k += 2) ctx.lineTo(route[k], route[k + 1]);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
      if (o.rotation && i !== selIndex) {
        ctx.fillStyle = COLORS.pivot;
        ctx.beginPath();
        ctx.arc(o.rotation.pivot.x, o.rotation.pivot.y, 2.5 * u, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    // Switch links: a colored dot at the top-left of every linked object / switch-operated door
    map.objects.forEach((o) => {
      const c = o.link?.color ?? (o.door?.mode === 'switch' ? o.door.color : o.laser?.switchColor);
      if (c === undefined) return;
      const b = tiltedBounds(o.shape, o.tilt);
      ctx.fillStyle = switchColor(c).hex;
      ctx.strokeStyle = COLORS.ink;
      ctx.lineWidth = 1.2 * u;
      ctx.beginPath();
      ctx.arc(b.x + 2 * u, b.y + 2 * u, 5 * u, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });

    this.drawSymmetry(u);

    // Selection outline
    const zone = this.selectedZone();
    const selObj = selIndex >= 0 ? objs[selIndex] : undefined;
    if (zone || selObj) {
      ctx.strokeStyle = COLORS.select;
      ctx.lineWidth = 1.5 * u;
      ctx.setLineDash([5 * u, 4 * u]);
      ctx.beginPath();
      if (zone) ctx.rect(zone.x, zone.y, zone.w, zone.h);
      else traceObject(ctx, selObj!, IDENTITY);
      ctx.stroke();
      ctx.setLineDash([]);

      // "#4 · ID 5 · 120×40" at the top-right of the selection (group members: the group's box too)
      const o = this.selectedObject();
      const b = zone ?? (o ? tiltedBounds(o.shape, o.tilt) : null);
      if (b) {
        const kind = this.sel?.kind;
        const size = o ? shapeBounds(o.shape) : b;
        const label = o
          ? `#${selIndex + 1} · ID ${objectToolId(o)} · ${sizeText(size.w, size.h)}${o.tilt ? ` · ${tiltText(o.tilt)}` : ''}`
          : `${tr(kind === 'start' ? 'zone.start' : 'zone.goal')} · ID ${kind === 'start' ? zoneToolId('start', map.startShape) : zoneToolId('goal', map.goalShape)} · ${sizeText(b.w, b.h)}`;
        this.drawInfoLabel(label, b.x + b.w, b.y, u);
      }
    }

    // A selected turret (#60 / #61): its detection range, and the arc the barrel can swing through
    const st = selIndex >= 0 ? map.objects[selIndex] : undefined;
    if (st?.turret) {
      const c = shapeCenter(st.shape);
      const tu = st.turret;
      ctx.save();
      ctx.strokeStyle = 'rgba(224,72,72,0.75)';
      ctx.fillStyle = 'rgba(224,72,72,0.06)';
      ctx.lineWidth = 1.2 * u;
      ctx.setLineDash([6 * u, 4 * u]);
      ctx.beginPath();
      ctx.arc(c.x, c.y, tu.range, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      if (tu.kind === 'gun' && tu.arc < 360) {
        const a = (tu.angle * Math.PI) / 180;
        const half = (tu.arc * Math.PI) / 360;
        ctx.fillStyle = 'rgba(224,72,72,0.12)';
        ctx.beginPath();
        ctx.moveTo(c.x, c.y);
        ctx.arc(c.x, c.y, tu.range, a - half, a + half);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }

    // Multi-selection: every member outlined, plus one box around them all
    if (selIds.size > 1) {
      ctx.strokeStyle = COLORS.select;
      ctx.lineWidth = 1.5 * u;
      ctx.setLineDash([5 * u, 4 * u]);
      ctx.beginPath();
      for (const i of selIds) if (objs[i]) traceObject(ctx, objs[i], IDENTITY);
      ctx.stroke();
      const members = [...selIds].map((i) => map.objects[i]).filter(Boolean);
      const b = objectsBounds(members);
      const pad = 4 * u;
      ctx.setLineDash([2 * u, 3 * u]);
      ctx.lineWidth = 1 * u;
      ctx.strokeRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2);
      ctx.setLineDash([]);
      // Small squares at the box corners, like a selection frame
      ctx.fillStyle = '#fff';
      for (const c of rectCorners({ x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 })) {
        ctx.fillRect(c.x - 3 * u, c.y - 3 * u, 6 * u, 6 * u);
        ctx.strokeRect(c.x - 3 * u, c.y - 3 * u, 6 * u, 6 * u);
      }
      const g = members[0].group;
      const grouped = g !== undefined && members.every((o) => o.group === g);
      this.drawInfoLabel(`${grouped ? `${tr('ed.groupN', { n: g! })} · ` : ''}${tr('ed.objectsN', { n: members.length })} · ${sizeText(b.w, b.h)}`, b.x + b.w + pad, b.y - pad, u);
    } else if (selIndex >= 0 && map.objects[selIndex]?.group !== undefined) {
      // A single member picked out of its group: show the group's extent faintly
      const g = map.objects[selIndex].group;
      const b = objectsBounds(map.objects.filter((o) => o.group === g));
      ctx.strokeStyle = COLORS.select;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1 * u;
      ctx.setLineDash([2 * u, 3 * u]);
      ctx.strokeRect(b.x - 4 * u, b.y - 4 * u, b.w + 8 * u, b.h + 8 * u);
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    // Pivot snap targets while dragging a pivot: the exact center is easy to find
    const dr = this.drag;
    const so = this.selectedObject();
    if (dr?.type === 'handle' && dr.h.kind === 'pivot' && so) {
      for (const t of this.pivotTargets(so)) {
        const center = t.label !== tr('ed.vertex') && t.label !== tr('ed.corner') && t.label !== tr('ed.edgeMiddle');
        ctx.strokeStyle = center ? COLORS.pivot : 'rgba(36,52,80,0.55)';
        ctx.lineWidth = 1.2 * u;
        const r = (center ? 6 : 3.5) * u;
        ctx.beginPath();
        ctx.moveTo(t.p.x - r, t.p.y);
        ctx.lineTo(t.p.x + r, t.p.y);
        ctx.moveTo(t.p.x, t.p.y - r);
        ctx.lineTo(t.p.x, t.p.y + r);
        ctx.stroke();
      }
      if (this.pivotSnap) {
        const p = this.pivotSnap.p;
        ctx.strokeStyle = COLORS.pivot;
        ctx.lineWidth = 2 * u;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 10 * u, 0, Math.PI * 2);
        ctx.stroke();
        this.drawInfoLabel(`${this.pivotSnap.label} (${Math.round(p.x * 10) / 10}, ${Math.round(p.y * 10) / 10})`, p.x + 8 * u, p.y - 4 * u, u);
      }
    }

    // Rubber-band selection box
    if (dr?.type === 'marquee') {
      const r = rectFromCorners({ x: dr.x0, y: dr.y0 }, { x: dr.x1, y: dr.y1 });
      ctx.fillStyle = 'rgba(58,159,240,0.1)';
      ctx.strokeStyle = COLORS.select;
      ctx.lineWidth = 1 * u;
      ctx.setLineDash([4 * u, 3 * u]);
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      ctx.setLineDash([]);
    }

    // Handles
    const o = this.selectedObject();
    let markerNo = 0;
    for (const { h, p } of this.handles()) {
      ctx.lineWidth = 1.2 * u;
      ctx.strokeStyle = COLORS.ink;
      if (h.kind === 'rotate') {
        const active = dr?.type === 'handle' && dr.h.kind === 'rotate';
        if (o) this.drawRotateHandle(shapeCenter(o.shape), o.tilt ?? 0, p, u, active);
        else {
          const g = this.groupRotate();
          if (g) this.drawRotateHandle(g.c, g.deg, p, u, active);
        }
        continue;
      }
      if (h.kind === 'pivot') {
        ctx.fillStyle = COLORS.pivot;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 6 * u, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = '#fff';
        ctx.beginPath();
        ctx.moveTo(p.x - 4 * u, p.y);
        ctx.lineTo(p.x + 4 * u, p.y);
        ctx.moveTo(p.x, p.y - 4 * u);
        ctx.lineTo(p.x, p.y + 4 * u);
        ctx.stroke();
      } else if (h.kind === 'aim') {
        ctx.fillStyle = COLORS.routeSelected;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - 7 * u);
        ctx.lineTo(p.x + 7 * u, p.y);
        ctx.lineTo(p.x, p.y + 7 * u);
        ctx.lineTo(p.x - 7 * u, p.y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else if (h.kind === 'marker') {
        markerNo++;
        ctx.fillStyle = COLORS.routeSelected;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 7 * u, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#1a1206';
        ctx.font = `700 ${9 * u}px ${FONT_MAIN}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(o?.motion?.type === 'circle' ? 'C' : String(markerNo), p.x, p.y + 0.5 * u);
      } else if (h.kind === 'vertex' && o?.shape.type === 'poly' && o.shape.points[h.j].smooth) {
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4.5 * u, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.fillStyle = '#fff';
        ctx.fillRect(p.x - 4 * u, p.y - 4 * u, 8 * u, 8 * u);
        ctx.strokeRect(p.x - 4 * u, p.y - 4 * u, 8 * u, 8 * u);
      }
    }

    // Polygon / freeform in progress
    if (this.draft) {
      const pts = this.hover ? [...this.draft.points, this.snapPoint(this.hover)] : this.draft.points;
      if (pts.length >= 3) {
        const ring = polyOutline(pts);
        ctx.fillStyle = 'rgba(58,159,240,0.1)';
        ctx.beginPath();
        for (let k = 0; k < ring.length; k += 2) ctx.lineTo(ring[k], ring[k + 1]);
        ctx.closePath();
        ctx.fill();
      }
      ctx.strokeStyle = COLORS.ink;
      ctx.lineWidth = 1.2 * u;
      ctx.beginPath();
      pts.forEach((p, k) => (k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
      this.draft.points.forEach((p, k) => {
        ctx.fillStyle = k === 0 ? COLORS.routeSelected : COLORS.ink;
        ctx.beginPath();
        ctx.arc(p.x, p.y, (k === 0 ? 6 : 3.5) * u, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    // Box being dragged
    const d = this.drag;
    if (d?.type === 'box') {
      let r = rectFromCorners({ x: d.x0, y: d.y0 }, { x: d.x1, y: d.y1 });
      if (d.square) {
        const s = Math.max(r.w, r.h);
        r = { x: d.x1 < d.x0 ? d.x0 - s : d.x0, y: d.y1 < d.y0 ? d.y0 - s : d.y0, w: s, h: s };
      }
      ctx.fillStyle = 'rgba(58,159,240,0.12)';
      ctx.strokeStyle = COLORS.ink;
      ctx.lineWidth = 1 * u;
      ctx.beginPath();
      let label = `${r.w}×${r.h}`;
      const tl = this.tool.kind === 'object' ? this.tool : null;
      if (tl && (tl.special === 'spike' || tl.role === 'mirror')) {
        const s = this.lineShapeFromDrag(tl, d);
        if (s.type === 'poly') {
          s.points.forEach((q, k) => (k ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
          ctx.closePath();
          label = `${Math.round(Math.hypot(d.x1 - d.x0, d.y1 - d.y0))}`;
        }
      } else if (this.tool.kind === 'object' && this.tool.shape === 'sector') {
        const s = this.sectorFromDrag(d, this.tool.ring);
        if (s.type === 'sector') {
          const ring = flattenShape(s).poly;
          ctx.moveTo(ring[0], ring[1]);
          for (let k = 2; k < ring.length; k += 2) ctx.lineTo(ring[k], ring[k + 1]);
          ctx.closePath();
          label = `r ${s.r}`;
        }
      } else if (this.tool.kind === 'object' && this.tool.shape === 'ellipse') {
        ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
      } else {
        ctx.rect(r.x, r.y, r.w, r.h);
      }
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = COLORS.ink;
      ctx.font = `600 ${12 * u}px ${FONT_MAIN}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(label, r.x, r.y - 3 * u);
    }

    // Marker placement preview
    if (this.markerMode !== null && this.hover) {
      const p = this.snapPoint(this.hover);
      ctx.strokeStyle = COLORS.routeSelected;
      ctx.lineWidth = 1.5 * u;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 7 * u, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}
