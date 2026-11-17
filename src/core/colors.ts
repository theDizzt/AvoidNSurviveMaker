/** The 16 switch / laser / portal colors: pastels plus gold and black */
export const SWITCH_COLORS: readonly { name: string; hex: string }[] = [
  { name: 'Pink', hex: '#ffa8c5' },
  { name: 'Coral', hex: '#ffb09a' },
  { name: 'Peach', hex: '#ffcf9e' },
  { name: 'Lemon', hex: '#fff0a0' },
  { name: 'Lime', hex: '#d3f29c' },
  { name: 'Mint', hex: '#a6eccb' },
  { name: 'Aqua', hex: '#9ee8ec' },
  { name: 'Sky', hex: '#a3d3ff' },
  { name: 'Periwinkle', hex: '#b5bfff' },
  { name: 'Lavender', hex: '#d1baff' },
  { name: 'Lilac', hex: '#ecb8f3' },
  { name: 'Mauve', hex: '#d9b3c9' },
  { name: 'Sand', hex: '#e6d3b0' },
  { name: 'Silver', hex: '#cdd5df' },
  { name: 'Gold', hex: '#f0bf45' },
  { name: 'Black', hex: '#2b2d35' },
];

export function switchColor(c: number): { name: string; hex: string } {
  return SWITCH_COLORS[c] ?? SWITCH_COLORS[0];
}
