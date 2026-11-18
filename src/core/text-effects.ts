/**
 * Optional text effects, shared by text boxes and the theme's level number and title:
 * outline, drop shadow, neon glow, top-to-bottom gradient and 3D extrusion.
 */
export interface TextEffects {
  /** Outline color '#rrggbb' */
  outline?: string;
  /** Outline thickness (px each side) */
  outlineWidth?: number;
  /** Drop shadow color '#rrggbb' */
  shadow?: string;
  /** Neon glow color '#rrggbb' */
  glow?: string;
  /** Gradient: the letters fade from their color at the top to this color at the bottom */
  gradient?: string;
  /** 3D extrusion depth in px toward the bottom right */
  depth?: number;
  /** Color of the 3D sides '#rrggbb' */
  depthColor?: string;
}

const hex6 = (v: unknown) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : undefined);

/** Keep the valid effects (a bad value just drops that effect); undefined when none are left */
export function readTextEffects(v: unknown): TextEffects | undefined {
  if (typeof v !== 'object' || v === null) return undefined;
  const o = v as Record<string, unknown>;
  const out: TextEffects = {};
  for (const k of ['outline', 'shadow', 'glow', 'gradient', 'depthColor'] as const) {
    const c = hex6(o[k]);
    if (c) out[k] = c;
  }
  if (out.outline) out.outlineWidth = typeof o.outlineWidth === 'number' && Number.isFinite(o.outlineWidth) ? Math.max(0.5, Math.min(20, o.outlineWidth)) : 2;
  if (typeof o.depth === 'number' && o.depth >= 1) out.depth = Math.min(30, Math.round(o.depth));
  return Object.keys(out).length ? out : undefined;
}
