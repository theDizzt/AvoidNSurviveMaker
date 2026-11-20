/**
 * Resource readings for the debug panel. Browsers don't expose VRAM or real GPU usage, so:
 * - canvas memory is estimated from every live canvas's backing size (width × height × 4 bytes);
 *   2D canvases are usually GPU textures, so this is the bulk of what the game puts in VRAM
 * - the JS heap comes from performance.memory (Chromium only)
 * - the GPU name comes from WebGL's debug renderer info, when the browser shares it
 *
 * Import this module before anything creates a canvas: it registers each one as it is made.
 */

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

const tracked = new Set<WeakRef<AnyCanvas>>();
/** Where each canvas was made: the first function on the stack outside this module and helpers */
const origins = new WeakMap<AnyCanvas, string>();

/** Small helpers that only wrap canvas creation: the caller one level up says more */
const HELPERS = new Set(['offscreen', 'createElement', 'OffscreenCanvas', 'new OffscreenCanvas', 'track', 'creator']);

function creator(): string {
  const stack = new Error().stack ?? '';
  for (const line of stack.split('\n').slice(1)) {
    // Chromium "    at fn (url:line:col)", Firefox / Safari "fn@url:line:col"
    const m = /^\s*at (?:new )?([^\s(]+) \((.+?)(?::\d+){2}\)$/.exec(line) ?? /^(?:new )?([^@\s]*)@(.+?)(?::\d+){2}$/.exec(line);
    if (!m) continue;
    const file = m[2].replace(/[?#].*$/, '').split('/').pop() ?? '';
    if (file.startsWith('resource-monitor')) continue;
    const fn = m[1].split('.').pop() ?? '';
    if (HELPERS.has(fn)) continue;
    return fn ? `${fn} (${file})` : file;
  }
  return '?';
}

function track(c: AnyCanvas): void {
  tracked.add(new WeakRef(c));
  origins.set(c, creator());
}

if (typeof window !== 'undefined' && typeof WeakRef !== 'undefined') {
  const create = Document.prototype.createElement;
  Document.prototype.createElement = function (this: Document, tag: string, opts?: ElementCreationOptions) {
    const el = create.call(this, tag, opts);
    if (el instanceof HTMLCanvasElement) track(el);
    return el;
  } as typeof Document.prototype.createElement;
  const Base = window.OffscreenCanvas;
  if (Base) {
    window.OffscreenCanvas = class extends Base {
      constructor(w: number, h: number) {
        super(w, h);
        track(this);
      }
    };
  }
}

export interface CanvasGroup {
  /** Where these canvases are: their element id / screen, or the function that made them */
  label: string;
  count: number;
  bytes: number;
  /** Largest one's size in pixels */
  w: number;
  h: number;
}

export interface CanvasUsage {
  count: number;
  bytes: number;
  /** Biggest first */
  groups: CanvasGroup[];
}

function labelOf(c: AnyCanvas): string {
  if (typeof HTMLCanvasElement !== 'undefined' && c instanceof HTMLCanvasElement && c.isConnected) {
    const place = c.id ? `#${c.id}` : `${c.className ? `.${c.className.split(/\s+/)[0]} ` : ''}in #${c.parentElement?.closest('[id]')?.id ?? 'page'}`;
    // On a screen that is not showing (hidden attribute or display: none somewhere above it)
    return c.closest('[hidden]') || !c.getClientRects().length ? `${place} · hidden` : place;
  }
  return `${origins.get(c) ?? '?'} · offscreen`;
}

/** Live canvases with a non-empty backing store and their estimated memory */
export function canvasUsage(): CanvasUsage {
  const seen = new Set<AnyCanvas>();
  for (const ref of tracked) {
    const c = ref.deref();
    if (c) seen.add(c);
    else tracked.delete(ref);
  }
  // Canvases written in the page's HTML are not made by createElement
  for (const c of document.querySelectorAll('canvas')) seen.add(c);
  let count = 0;
  let bytes = 0;
  const groups = new Map<string, CanvasGroup>();
  for (const c of seen) {
    const px = c.width * c.height;
    if (px <= 0) continue;
    count++;
    bytes += px * 4;
    const label = labelOf(c);
    const g = groups.get(label);
    if (!g) groups.set(label, { label, count: 1, bytes: px * 4, w: c.width, h: c.height });
    else {
      g.count++;
      g.bytes += px * 4;
      if (px > g.w * g.h) {
        g.w = c.width;
        g.h = c.height;
      }
    }
  }
  return { count, bytes, groups: [...groups.values()].sort((a, b) => b.bytes - a.bytes) };
}

/** JS heap in use and its limit (Chromium only), or null */
export function jsHeap(): { used: number; limit: number } | null {
  const m = (performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
  return m ? { used: m.usedJSHeapSize, limit: m.jsHeapSizeLimit } : null;
}

let gpu: string | null | undefined;

/** The GPU's name as WebGL reports it, or null when hidden; probed once */
export function gpuName(): string | null {
  if (gpu !== undefined) return gpu;
  gpu = null;
  try {
    const probe = document.createElement('canvas');
    probe.width = probe.height = 1;
    const gl = probe.getContext('webgl');
    if (gl) {
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      gpu = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER)) || null;
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch {
    /* no WebGL */
  }
  return gpu;
}

export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
