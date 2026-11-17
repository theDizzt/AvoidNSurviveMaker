import { describe, expect, it } from 'vitest';
import { averageDifficulty, themedLevel, validateThemeInfo } from '../core/theme-pack';
import { OFFICIAL_THEMES } from './theme-registry';
import { readThemeZip, writeThemeZip } from './theme-zip';

describe('theme packs', () => {
  it('loads the official themes from themes/', () => {
    expect(OFFICIAL_THEMES.map((t) => t.info.id)).toEqual(['pastel', 'forest', 'candy', 'neon', 'lava', 'mono']);
    expect(OFFICIAL_THEMES[0].levels.length).toBe(5);
    expect(OFFICIAL_THEMES[3].info.style.badge.kind).toBe('disc');
    const lvl = themedLevel(OFFICIAL_THEMES[0], 0)!;
    expect(lvl.level).toBe(1);
    expect(lvl.title).toBe('Tutorial - Zigzag Corridor');
  });

  it('averages difficulty, counting levels without one as 1.00', () => {
    const lv = OFFICIAL_THEMES[0].levels;
    expect(averageDifficulty([])).toBe(1);
    expect(averageDifficulty([{ ...lv[0], difficulty: 5 }, lv[1]])).toBe(3);
  });

  it('reads theme.json leniently', () => {
    const info = validateThemeInfo({ format: 1, id: 'a b!', name: 'X', colors: ['#fff', 'nope'], style: { badge: { kind: 'weird', pad: 9 } } });
    expect(info.id).toBe('ab');
    expect(info.style.badge.kind).toBe('pill');
    expect(info.style.badge.pad).toBe(4);
    expect(() => validateThemeInfo({ format: 2 })).toThrow();
  });

  it('round-trips a pack through a zip', async () => {
    const t = OFFICIAL_THEMES[0];
    const pack = { info: { ...t.info, cover: 'cover.png' }, levels: t.levels, images: { 'cover.png': 'data:image/png;base64,iVBORw0KGgo=' } };
    const blob = writeThemeZip(pack);
    const file = new File([await blob.arrayBuffer()], 'p.zip');
    const back = await readThemeZip(file);
    expect(back.info).toEqual(pack.info);
    expect(back.levels).toEqual(t.levels);
    expect(back.images['cover.png']).toBe('data:image/png;base64,iVBORw0KGgo=');
  });
});

describe('font catalog', () => {
  it('lists only font files that exist, with unique ids', async () => {
    const files = new Set(Object.keys(import.meta.glob('../assets/fonts/*/*.{ttf,otf}')));
    const { FONT_CATALOG } = await import('../core/font-catalog');
    const ids = new Set<string>();
    for (const f of FONT_CATALOG) {
      expect(files.has(`../assets/fonts/${f.folder}/${f.file}`), f.file).toBe(true);
      expect(ids.has(f.id), f.id).toBe(false);
      expect(f.id).toMatch(/^[\w -]{1,40}$/);
      ids.add(f.id);
    }
  });

  it('accepts library fonts for the level badge', async () => {
    const { validateThemeInfo, blankThemeInfo } = await import('../core/theme-pack');
    const base = blankThemeInfo();
    const withFont = (font: string) => validateThemeInfo({ ...base, style: { ...base.style, badge: { ...base.style.badge, font } } }).style.badge.font;
    expect(withFont('paperlogy-bold')).toBe('paperlogy-bold');
    expect(withFont('no-such-font')).toBe(base.style.badge.font);
  });
});
