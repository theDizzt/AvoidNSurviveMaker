import { t, type MessageKey } from './i18n';

/** A color whose name is looked up in the locale each time it is read */
function color(key: MessageKey, hex: string): { readonly name: string; hex: string } {
  return { get name() { return t(key); }, hex };
}

/** The 16 switch / laser / portal colors: pastels plus gold and black */
export const SWITCH_COLORS: readonly { name: string; hex: string }[] = [
  color('color.pink', '#ffa8c5'),
  color('color.coral', '#ffb09a'),
  color('color.peach', '#ffcf9e'),
  color('color.lemon', '#fff0a0'),
  color('color.lime', '#d3f29c'),
  color('color.mint', '#a6eccb'),
  color('color.aqua', '#9ee8ec'),
  color('color.sky', '#a3d3ff'),
  color('color.periwinkle', '#b5bfff'),
  color('color.lavender', '#d1baff'),
  color('color.lilac', '#ecb8f3'),
  color('color.mauve', '#d9b3c9'),
  color('color.sand', '#e6d3b0'),
  color('color.silver', '#cdd5df'),
  color('color.gold', '#f0bf45'),
  color('color.black', '#2b2d35'),
];

export function switchColor(c: number): { name: string; hex: string } {
  return SWITCH_COLORS[c] ?? SWITCH_COLORS[0];
}
