import { elecEffect, isLightRole } from './electric';
import { pointInPoly } from './geometry';
import { toWorld, transformAt, type CompiledObject } from './object';
import { shapeCenter } from './shape';
import { auraRadius } from './radiation';
import type { MapObject } from './types';

/**
 * A light clearing global darkness: a soft disc of radius `r`, or a cone (spotlight #88–90) along
 * `dir` (radians, 0 = right, clockwise on screen) `sweep` radians wide.
 */
export interface LightSource { x: number; y: number; r: number; intensity?: number; dir?: number; sweep?: number }

/** Run state the lights depend on (all optional: before a run, everything is as placed) */
export interface LightState {
  hidden?: ArrayLike<number | boolean>; clock?: ArrayLike<number>;
  /** Per object: 1 while the cursor carries it (#58 torch); it then lights from `cursor` */
  carried?: ArrayLike<number>; cursor?: { x: number; y: number };
  /** Switch colors that are ON (a spotlight linked with 'remove' is dark while its color is ON) */
  channels?: ArrayLike<number>;
  /** Per object: powered by a wire (#91) */
  power?: ArrayLike<number>;
  /** Per object: 1 when a wire ends on it */
  wired?: ArrayLike<number>;
}

/** Spacing (map units) of the glow along a live wire, and its radius */
const WIRE_GLOW_GAP = 40;
const WIRE_GLOW_R = 55;
/** Radioactive water (#87) glows from points this far apart inside it */
const TOXIC_GLOW_GAP = 90;

/** Is this light (spotlight, torch) shining? A switch link or a wire can turn it off */
export function lightLit(m: MapObject, i: number, state: LightState): boolean {
  if (m.link?.action === 'remove' && m.role === 'spot' && state.channels?.[m.link.color]) return false;
  if (isLightRole(m) && state.wired?.[i]) {
    const e = elecEffect(m);
    const on = !!state.power?.[i];
    if ((e === 'show' && !on) || (e === 'remove' && on)) return false;
  }
  return true;
}

/** Shared by the editor and play renderer: every light source on the map at `time` */
export function objectLights(objects: readonly CompiledObject[], time: number, state: LightState = {}): LightSource[] {
  const lights: LightSource[] = [];
  const pose = { dx: 0, dy: 0, cos: 1, sin: 0 };
  const p = { x: 0, y: 0 };
  objects.forEach((o, i) => {
    const m = o.src;
    if (!m || state.hidden?.[i]) return;
    // A live wire glows along its length
    if (m.role === 'wire' && m.wire) {
      if (!state.power?.[i]) return;
      const pts = m.wire.points;
      for (let k = 0; k + 1 < pts.length; k++) {
        const a = pts[k];
        const b = pts[k + 1];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        const steps = Math.max(1, Math.ceil(len / WIRE_GLOW_GAP));
        for (let s = k === 0 ? 0 : 1; s <= steps; s++) {
          lights.push({ x: a.x + ((b.x - a.x) * s) / steps, y: a.y + ((b.y - a.y) * s) / steps, r: WIRE_GLOW_R, intensity: 70 });
        }
      }
      return;
    }
    // Radioactive water glows all over
    if (m.role === 'liquid' && m.liquid?.kind === 'toxic') {
      const tf = transformAt(o, state.clock?.[i] ?? time, pose);
      for (let y = o.minY + TOXIC_GLOW_GAP / 2; y < o.maxY; y += TOXIC_GLOW_GAP) {
        for (let x = o.minX + TOXIC_GLOW_GAP / 2; x < o.maxX; x += TOXIC_GLOW_GAP) {
          if (!pointInPoly(x, y, o.poly)) continue;
          toWorld(o, tf, x, y, p);
          lights.push({ x: p.x, y: p.y, r: TOXIC_GLOW_GAP * 1.1, intensity: 55 });
        }
      }
      return;
    }
    // Radioactive zones glow all over (#115); waste glows as far as its aura reaches now (#116 / #117)
    if (m.role === 'rad' && m.rad) {
      const at = state.clock?.[i] ?? time;
      const tf = transformAt(o, at, pose);
      if (m.rad.aura) {
        toWorld(o, tf, o.cx, o.cy, p);
        lights.push({ x: p.x, y: p.y, r: Math.max(40, auraRadius(m.rad.aura, at) * 1.15), intensity: 55 });
        return;
      }
      for (let y = o.minY + TOXIC_GLOW_GAP / 2; y < o.maxY; y += TOXIC_GLOW_GAP) {
        for (let x = o.minX + TOXIC_GLOW_GAP / 2; x < o.maxX; x += TOXIC_GLOW_GAP) {
          if (!pointInPoly(x, y, o.poly)) continue;
          toWorld(o, tf, x, y, p);
          lights.push({ x: p.x, y: p.y, r: TOXIC_GLOW_GAP * 1.1, intensity: 50 });
        }
      }
      return;
    }
    if (!lightLit(m, i, state)) return;
    if (m.role === 'spot' && m.spot) {
      const s = m.spot;
      if (s.range <= 0 || s.intensity === 0) return;
      const tf = transformAt(o, state.clock?.[i] ?? time, pose);
      const c = shapeCenter(m.shape);
      toWorld(o, tf, c.x, c.y, p);
      lights.push({
        x: p.x, y: p.y, r: s.range, intensity: s.intensity,
        dir: (s.angle * Math.PI) / 180 + Math.atan2(tf.sin, tf.cos), sweep: (Math.min(360, s.sweep) * Math.PI) / 180,
      });
      return;
    }
    const source = m.light;
    if (!source || source.radius <= 0 || source.intensity === 0) return;
    if (state.carried?.[i] && state.cursor) {
      lights.push({ x: state.cursor.x, y: state.cursor.y, r: source.radius, intensity: source.intensity });
      return;
    }
    const center = shapeCenter(m.shape);
    const position = toWorld(o, transformAt(o, state.clock?.[i] ?? time, pose), center.x, center.y, { x: 0, y: 0 });
    lights.push({ ...position, r: source.radius, intensity: source.intensity });
  });
  return lights;
}
