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
  /** Shadow offset in px (default: grows with the text size) */
  shadowX?: number;
  shadowY?: number;
  /** Shadow blur in px (0 = a hard shadow) */
  shadowBlur?: number;
  /** Glow spread, × the default (0.2–4) */
  glowSize?: number;
  /** Vine color: a leafy stem winding through the letters, in front of some and behind others */
  vine?: string;
  /** Swim ring color: its rear half sits behind the letters and its front half crosses them. */
  tube?: string;
}

const finite = (v: unknown, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : undefined);

const hex6 = (v: unknown) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(v) ? v.toLowerCase() : undefined);

/** Keep the valid effects (a bad value just drops that effect); undefined when none are left */
export function readTextEffects(v: unknown): TextEffects | undefined {
  if (typeof v !== 'object' || v === null) return undefined;
  const o = v as Record<string, unknown>;
  const out: TextEffects = {};
  for (const k of ['outline', 'shadow', 'glow', 'gradient', 'depthColor', 'vine', 'tube'] as const) {
    const c = hex6(o[k]);
    if (c) out[k] = c;
  }
  if (out.outline) out.outlineWidth = typeof o.outlineWidth === 'number' && Number.isFinite(o.outlineWidth) ? Math.max(0.5, Math.min(20, o.outlineWidth)) : 2;
  if (typeof o.depth === 'number' && o.depth >= 1) out.depth = Math.min(30, Math.round(o.depth));
  if (out.shadow) {
    const sx = finite(o.shadowX, -40, 40), sy = finite(o.shadowY, -40, 40), sb = finite(o.shadowBlur, 0, 40);
    if (sx !== undefined) out.shadowX = sx;
    if (sy !== undefined) out.shadowY = sy;
    if (sb) out.shadowBlur = sb;
  }
  const gs = finite(o.glowSize, 0.2, 4);
  if (out.glow && gs !== undefined && gs !== 1) out.glowSize = gs;
  return Object.keys(out).length ? out : undefined;
}
