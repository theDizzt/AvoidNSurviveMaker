import { type ValidationContext } from './validation';

export type PatternKind = 'stripes' | 'diagonal' | 'dots' | 'grid' | 'checker' | 'wood' | 'grass' | 'sand' | 'metal' | 'egyptian' | 'sandBrick' | 'bark' | 'woodGrain' | 'thicket' | 'mud' | 'soil' | 'snow' | 'snowDirt' | 'snowPile' | 'ice' | 'iceCrystal' | 'concrete' | 'epoxy' | 'clouds' | 'cloudBank' | 'waves' | 'caustics' | 'pittedStone' | 'floodedRock' | 'basalt' | 'hotrock' | 'magma';

/** Colors are '#rrggbb'. Gradients and patterns are laid out in the object's own frame, so they move and rotate with it. */
export type Fill =
  | { type: 'solid'; color: string }
  | { type: 'gradient'; style: 'linear' | 'radial'; from: string; to: string; /** degrees, linear only */ angle: number }
  | { type: 'pattern'; pattern: PatternKind; color: string; background: string; /** tile size in px */ size: number };

export interface SurfaceStyle {
  fill: Fill;
  /** Outline color */
  edge: string;
  /** Paths: omitted preserves the original recessed appearance. */
  relief?: 'raised' | 'recessed';
  /** Paths: animated surf on the surrounding water. */
  surf?: boolean;
  /** Animated look (drawn over the surface every frame) */
  anim?: SurfaceAnim;
  /**
   * Paths only: a line painted on the floor along its edge with the walls, `inset` px in from the
   * wall and `width` px wide (like the safety lines on a factory floor)
   */
  line?: { color: string; width: number; inset: number };
  /**
   * Walls only: a glow inside the wall mass along its edge with the floor, strongest at the edge
   * and fading out `width` map units in (like rock heated by the paths it borders)
   */
  glow?: { color: string; width: number };
}

/**
 * Surface animation: 'pulse' brightens and dims (toward `color`, white by default), 'color' fades
 * to `color` and back, 'scroll' slides a pattern fill along `angle` (degrees).
 */
export interface SurfaceAnim {
  type: 'pulse' | 'color' | 'scroll';
  /** Cycles per second (pulse, color) or px per second (scroll) */
  speed: number;
  /** Strength 0–1 (pulse, color) */
  amount: number;
  color?: string;
  angle?: number;
}

/** Per-map look. `wall` covers walls and all moving/rotating walls (obstacles); `path` covers all paths. */
export interface Theme {
  wall: SurfaceStyle;
  path: SurfaceStyle;
}

export function createThemeSchema(context: ValidationContext) {
  const { obj, num, oneOf, color } = context;

  const PATTERNS = ['stripes', 'diagonal', 'dots', 'grid', 'checker', 'wood', 'grass', 'sand', 'metal', 'egyptian', 'sandBrick', 'bark', 'woodGrain', 'thicket', 'mud', 'soil', 'snow', 'snowDirt', 'snowPile', 'ice', 'iceCrystal', 'concrete', 'epoxy', 'clouds', 'cloudBank', 'waves', 'caustics', 'pittedStone', 'floodedRock', 'basalt', 'hotrock', 'magma'] as const satisfies readonly PatternKind[];

  function fill(v: unknown, name: string): Fill {
    const o = obj(v, name);
    const type = oneOf(o.type, `${name}.type`, ['solid', 'gradient', 'pattern'] as const);
    if (type === 'solid') return { type, color: color(o.color, `${name}.color`) };
    if (type === 'gradient') {
      return {
        type,
        style: oneOf(o.style, `${name}.style`, ['linear', 'radial'] as const),
        from: color(o.from, `${name}.from`),
        to: color(o.to, `${name}.to`),
        angle: num(o.angle, `${name}.angle`, -360, 360),
      };
    }
    return {
      type,
      pattern: oneOf(o.pattern, `${name}.pattern`, PATTERNS),
      color: color(o.color, `${name}.color`),
      background: color(o.background, `${name}.background`),
      size: num(o.size, `${name}.size`, 4, 256),
    };
  }

  function surface(v: unknown, name: string): SurfaceStyle {
    const o = obj(v, name);
    const out: SurfaceStyle = { fill: fill(o.fill, `${name}.fill`), edge: color(o.edge, `${name}.edge`) };
    if (o.relief !== undefined) out.relief = oneOf(o.relief, `${name}.relief`, ['raised', 'recessed'] as const);
    if (o.surf === true) out.surf = true;
    const anim = surfaceAnim(o.anim);
    if (anim) out.anim = anim;
    if (o.line !== undefined) {
      const l = obj(o.line, `${name}.line`);
      out.line = { color: color(l.color, `${name}.line.color`), width: num(l.width, `${name}.line.width`, 1, 40), inset: num(l.inset, `${name}.line.inset`, 0, 80) };
    }
    if (o.glow !== undefined) {
      const gl = obj(o.glow, `${name}.glow`);
      out.glow = { color: color(gl.color, `${name}.glow.color`), width: num(gl.width, `${name}.glow.width`, 1, 200) };
    }
    return out;
  }

  /** A surface animation, read leniently (unknown = none) */
  function surfaceAnim(v: unknown): SurfaceAnim | undefined {
    if (typeof v !== 'object' || v === null) return undefined;
    const a = v as Record<string, unknown>;
    if (a.type !== 'pulse' && a.type !== 'color' && a.type !== 'scroll') return undefined;
    const n = (x: unknown, min: number, max: number, d: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : d);
    const out: SurfaceAnim = {
      type: a.type,
      speed: a.type === 'scroll' ? n(a.speed, 1, 400, 30) : n(a.speed, 0.05, 5, 0.5),
      amount: n(a.amount, 0, 1, 0.5),
    };
    if (typeof a.color === 'string' && /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(a.color)) out.color = a.color.toLowerCase();
    if (a.type === 'scroll') out.angle = n(a.angle, -360, 360, 0);
    return out;
  }

  function theme(v: unknown, name: string): Theme {
    const o = obj(v, name);
    return { wall: surface(o.wall, `${name}.wall`), path: surface(o.path, `${name}.path`) };
  }


  return { theme };
}
