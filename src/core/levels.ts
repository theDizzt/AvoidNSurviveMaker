import type { MapData } from './types';

/**
 * Built-in levels: the first official theme's levels, read from themes/chapter-01-workshop/levels/.
 * (All official themes are loaded by src/web/theme-registry.ts; this export is kept for tests.)
 */
const files = import.meta.glob<MapData>('../../themes/chapter-01-workshop/levels/*.json', { eager: true, import: 'default' });

export const BUILTIN_LEVELS: MapData[] = Object.keys(files).sort().map((k) => files[k]);
