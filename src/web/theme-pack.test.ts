import { describe, expect, it } from 'vitest';
import { averageDifficulty, themedLevel, validateThemeInfo } from '../core/theme-pack';
import { OFFICIAL_THEMES, CUSTOM_THEME_PRESETS } from './theme-registry';
import { readThemeZip, writeThemeZip } from './theme-zip';

describe('theme packs', () => {
  it('loads the official themes from themes/', () => {
    expect(OFFICIAL_THEMES.map((t) => t.info.id)).toEqual([
      'workshop', 'desert', 'wood', 'botany', 'frost', 'factory', 'sky', 'magma',
      'optics', 'ocean', 'cavern', 'galaxy', 'chapter-13', 'chapter-14', 'cyberfunk', 'chapter-16',
    ]);
    expect(OFFICIAL_THEMES[0].info.name).toBe('Tutorial Workshop');
    expect(OFFICIAL_THEMES[0].levels.map((level) => level.name)).toEqual(
      Array.from({ length: 16 }, (_, i) => `workshop${String(i + 1).padStart(2, '0')}`),
    );
    expect(OFFICIAL_THEMES[4].info.style.badge.kind).toBe('emblem');
    // Chapter 2 (desert) is being built; the chapters after it have no levels yet
    expect(OFFICIAL_THEMES[1].levels.length).toBeGreaterThan(0);
    expect(OFFICIAL_THEMES.slice(2).every((t) => t.levels.length === 0)).toBe(true);
    expect(CUSTOM_THEME_PRESETS.map((t) => t.info.id)).toEqual(['pastel', 'forest', 'candy', 'neon', 'lava', 'mono']);
    expect(CUSTOM_THEME_PRESETS.every((t) => !t.official)).toBe(true);
    expect(CUSTOM_THEME_PRESETS[0].info.name).toBe('Pastel Plains');
    for (const t of OFFICIAL_THEMES) {
      expect(t.assets[t.info.cover!], t.info.id).toBeTruthy();
    }
    const lvl = themedLevel(OFFICIAL_THEMES[0], 0)!;
    expect(lvl.level).toBe(1);
    expect(lvl.title).toBe('Linear');
  });

  it('averages difficulty, counting levels without one as 1.00', () => {
    const lv = OFFICIAL_THEMES[0].levels;
    expect(averageDifficulty([])).toBe(1);
    const { difficulty: _difficulty, ...withoutDifficulty } = lv[1];
    expect(averageDifficulty([{ ...lv[0], difficulty: 5 }, withoutDifficulty])).toBe(3);
  });

  it('places official levels by their level number', async () => {
    const { assignSlots } = await import('../core/theme-pack');
    const { createEmptyMap } = await import('../core/validate');
    const at = (level?: number) => ({ ...createEmptyMap(), ...(level !== undefined ? { level } : {}) });
    // desert01, 02, 03, 09: level 9 goes to slot 8, not slot 3
    expect(assignSlots([at(1), at(2), at(3), at(9)])).toEqual([0, 1, 2, 8]);
    // No number, a taken number or one past the chapter: first free slot
    expect(assignSlots([at(2), at(), at(2), at(99)])).toEqual([1, 0, 2, 3]);
    const desert = OFFICIAL_THEMES.find((t) => t.info.id === 'desert')!;
    expect(themedLevel(desert, 8)?.name).toBe('desert09');
    expect(themedLevel(desert, 3)).toBeNull();
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
    const pack = { info: { ...t.info, cover: 'cover.png', music: 'audio/background.wav' }, levels: t.levels, images: {
      'cover.png': 'data:image/png;base64,iVBORw0KGgo=',
      'audio/background.wav': 'data:audio/wav;base64,UklGRg==',
    } };
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
