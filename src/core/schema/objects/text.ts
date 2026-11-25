import { type MapObject } from '../object';
import { type ValidationContext } from '../validation';
import { shapeBounds } from '../../shape';

/** Text box (#47): `shape` is its rectangle */
export interface TextBox {
  text: string;
  /** '#rrggbb' */
  color: string;
  /** Font name (title, main, serif, heavy, timer, mono, hand) or a library font id */
  font: string;
  size: number;
  bold: boolean;
  align: 'left' | 'center' | 'right';
  /** Outline color '#rrggbb' (none when omitted) */
  outline?: string;
  outlineWidth: number;
  /** Box color with opacity, '#rrggbbaa' (transparent when omitted) */
  background?: string;
  /** Drop shadow color '#rrggbb' (none when omitted) */
  shadow?: string;
  /** Neon glow color '#rrggbb' (none when omitted) */
  glow?: string;
  /** Gradient: the letters fade from `color` at the top to this color at the bottom */
  gradient?: string;
  /** 3D extrusion depth in px toward the bottom right (none when omitted) */
  depth?: number;
  /** Color of the 3D sides '#rrggbb' */
  depthColor?: string;
}

export function createTextSchema(context: ValidationContext) {
  const { obj, num, color } = context;

  function validateText(o: Record<string, unknown>, out: MapObject, name: string): void {
    if (out.role === 'text') {
      const t = obj(o.text, `${name}.text`);
      if (out.shape.type !== 'rect') out.shape = { type: 'rect', ...shapeBounds(out.shape) };
      const hex8 = (v: unknown) => (typeof v === 'string' && /^#[0-9a-fA-F]{8}$/.test(v) ? v.toLowerCase() : undefined);
      out.text = {
        text: typeof t.text === 'string' ? t.text.slice(0, 500) : '',
        color: color(t.color, `${name}.text.color`),
        font: typeof t.font === 'string' && /^[\w -]{1,40}$/.test(t.font) ? t.font : 'main',
        size: num(t.size, `${name}.text.size`, 6, 200),
        bold: t.bold === true,
        align: t.align === 'left' || t.align === 'right' ? t.align : 'center',
        outlineWidth: typeof t.outlineWidth === 'number' ? Math.max(0, Math.min(20, t.outlineWidth)) : 3,
      };
      if (t.outline !== undefined) out.text.outline = color(t.outline, `${name}.text.outline`);
      const bg = hex8(t.background);
      if (bg) out.text.background = bg;
      // Effects are optional: a bad value just drops the effect
      const hex6 = (v: unknown) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : undefined);
      for (const k of ['shadow', 'glow', 'gradient', 'depthColor'] as const) {
        const c = hex6(t[k]);
        if (c) out.text[k] = c;
      }
      if (typeof t.depth === 'number' && t.depth >= 1) out.text.depth = Math.min(30, Math.round(t.depth));
    }
  }

  return { validateText };
}
