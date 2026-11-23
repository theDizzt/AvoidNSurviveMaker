import type { Magnet } from './types';

/** Magnet (#99) as placed: pulls the cursor and metal boxes (#98) within 260 px */
export const DEFAULT_MAGNET: Readonly<Magnet> = { range: 260, strength: 320, cursor: true, metal: true };
