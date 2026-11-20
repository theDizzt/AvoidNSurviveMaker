import { describe, expect, it } from 'vitest';
import { averageDifficulty, crystalSlots, localizeThemeInfo, maxStars, themedLevel, validateThemeInfo } from './localized/theme-pack';
import { OFFICIAL_THEMES, CUSTOM_THEME_PRESETS, levelThemeIn } from './theme-registry';
import { DEFAULT_DESIGN, levelDesign } from '../core/theme-pack';
import { readThemeZip, writeThemeZip } from './theme-zip';

describe('theme packs', () => {
  it('sub-themes: a level wears the one it picks, else the one whose range holds its number', () => {
    const info = validateThemeInfo({
      format: 1,
      style: {
        maze: { wall: { fill: { type: 'solid', color: '#111111' }, edge: '#000000' }, path: { fill: { type: 'solid', color: '#eeeeee' }, edge: '#000000' } },
        badge: { kind: 'pill', numberColor: '#123456' },
        designs: [
          { id: 'a', name: 'A', levels: [21, 14], i18n: { ko: '에이', xx_bad: 'no' }, music: 'audio/a.mp3', badge: { kind: 'disc' } },
          { id: 'b', name: 'B', music: '../escape.mp3' },
        ],
      },
    });
    const [a, b] = info.style.designs!;
    expect(a.levels).toEqual([14, 21]);
    expect(a.i18n).toEqual({ ko: '에이' });
    expect(a.badge?.kind).toBe('disc');
    expect(b.music).toBeUndefined();
    expect(levelDesign(info.style, { level: 13 })).toBeUndefined();
    expect(levelDesign(info.style, { level: 14 })?.id).toBe('a');
    expect(levelDesign(info.style, { level: 15, themeDesign: 'b' })?.id).toBe('b');
    expect(levelDesign(info.style, { level: 15, themeDesign: DEFAULT_DESIGN })).toBeUndefined();
    expect(localizeThemeInfo(info, 'ko').style.designs![0].name).toBe('에이');
    // Own badge and music where it has them, the pack's otherwise
    const pack = { info, levels: [], assets: { 'audio/a.mp3': 'data:a' }, official: false };
    const worn = levelThemeIn(pack, { level: 20 });
    expect(worn.info.style.badge.kind).toBe('disc');
    expect(worn.assets[worn.info.music!]).toBe('data:a');
    expect(levelThemeIn(pack, { level: 3 })).toBe(pack);
    expect(() => validateThemeInfo({ format: 1, style: { designs: [{ id: 'default' }] } })).toThrow();
  });

  it('colors may carry opacity (#rrggbbaa)', () => {
    const info = validateThemeInfo({ format: 1, colors: ['#11223380', '#445566'], style: { badge: { primary: '#ffffff80', titleFx: { glow: '#00ff0040' } } } });
    expect(info.colors[0]).toBe('#11223380');
    expect(info.style.badge.primary).toBe('#ffffff80');
    expect(info.style.badge.titleFx?.glow).toBe('#00ff0040');
  });

  it('chapter 2: levels 1-13 wear the desert sub-theme, 14-21 the ruins', () => {
    const desert = OFFICIAL_THEMES[1];
    expect(desert.info.id).toBe('desert');
    for (let n = 1; n <= 21; n++) expect(levelDesign(desert.info.style, { level: n })?.id, `level ${n}`).toBe(n <= 13 ? 'desert' : 'ruins');
    // The desert sub-theme has no maze of its own: it wears the chapter's
    expect(themedLevel({ ...desert, levels: [{ ...desert.levels[0], level: 3, theme: undefined }], slots: [2] }, 2)!.theme).toEqual(desert.info.style.maze);
    const ruins = desert.info.style.designs!.find((d) => d.id === 'ruins')!;
    expect(themedLevel({ ...desert, levels: [{ ...desert.levels[0], level: 14 }], slots: [13] }, 13)!.theme).toEqual(ruins.maze);
  });

  it('reads badge placement, lettering and the extra text effects leniently', () => {
    const info = validateThemeInfo({
      format: 1,
      style: {
        badge: {
          kind: 'disc',
          layout: { graphic: { x: 12, y: -4, scale: 9, rotate: 0 }, number: { hidden: true, x: 'no' }, title: { scale: 1 }, junk: { x: 1 } },
          numberFormat: { weight: 640, italic: false, spacing: 2.25, transform: 'upper' },
          titleFormat: { transform: 'sideways' },
          titlePlate: false,
          titleFx: { shadow: '#000000', shadowX: 3, shadowY: -99, shadowBlur: 6, glow: '#ff00ff', glowSize: 2.5 },
        },
      },
    });
    const b = info.style.badge;
    expect(b.layout).toEqual({ graphic: { x: 12, y: -4, scale: 5 }, number: { hidden: true } });
    expect(b.numberFormat).toEqual({ weight: 600, italic: false, spacing: 2.3, transform: 'upper' });
    expect(b.titleFormat).toBeUndefined();
    expect(b.titlePlate).toBe(false);
    expect(b.titleFx).toMatchObject({ shadowX: 3, shadowY: -40, shadowBlur: 6, glowSize: 2.5 });
  });

  it('an official theme is worth 66 stars (21 levels x 3 + 3 crystal stars), 1056 in all', () => {
    for (const t of OFFICIAL_THEMES) {
      expect(maxStars(t), t.info.id).toBe(66);
      // No more crystal stars than a theme can count
      const placed = t.levels.filter((m) => m.objects.some((o) => o.role === 'crystal')).length;
      expect(placed, t.info.id).toBeLessThanOrEqual(3);
    }
    expect(OFFICIAL_THEMES.reduce((s, t) => s + maxStars(t), 0)).toBe(1056);
  });

  it('a custom pack counts crystal stars only on levels that have one, up to 3', () => {
    const pack = CUSTOM_THEME_PRESETS[0];
    expect(crystalSlots(pack)).toBe(Math.min(3, pack.levels.filter((m) => m.objects.some((o) => o.role === 'crystal')).length));
  });

  // These tests check rules, not content: adding, removing or renaming levels and chapters
  // must not break them. Use synthetic maps for exact expectations.
  it('loads the official themes from themes/', () => {
    const ids = OFFICIAL_THEMES.map((t) => t.info.id);
    expect(ids.length).toBe(16);
    expect(new Set(ids).size).toBe(ids.length);
    // Saved progress is keyed by theme id; chapter 1 keeps the id it shipped with
    expect(ids[0]).toBe('workshop');
    for (const t of OFFICIAL_THEMES) {
      expect(t.official, t.info.id).toBe(true);
      expect(t.assets[t.info.cover!], `${t.info.id} cover`).toBeTruthy();
      expect(t.levels.length, t.info.id).toBeLessThanOrEqual(21);
      for (const m of t.levels) expect(m.name, t.info.id).toBeTruthy();
    }
    const presets = CUSTOM_THEME_PRESETS.map((t) => t.info.id);
    expect(presets).toContain('pastel');
    expect(new Set(presets).size).toBe(presets.length);
    expect(CUSTOM_THEME_PRESETS.every((t) => !t.official)).toBe(true);
  });

  it('averages difficulty, counting levels without one as 1.00', async () => {
    const { createEmptyMap } = await import('./localized/validate');
    const { difficulty: _difficulty, ...withoutDifficulty } = createEmptyMap();
    expect(averageDifficulty([])).toBe(1);
    expect(averageDifficulty([{ ...createEmptyMap(), difficulty: 5 }, withoutDifficulty])).toBe(3);
  });

  it('places official levels by their level number', async () => {
    const { assignSlots, levelAt } = await import('./localized/theme-pack');
    const { createEmptyMap } = await import('./localized/validate');
    const at = (level?: number, name = 'm') => ({ ...createEmptyMap(), name, ...(level !== undefined ? { level } : {}) });
    // Levels 1, 2, 3, 9: level 9 goes to slot 8, not slot 3
    expect(assignSlots([at(1), at(2), at(3), at(9)])).toEqual([0, 1, 2, 8]);
    // No number, a taken number or one past the chapter: first free slot
    expect(assignSlots([at(2), at(), at(2), at(99)])).toEqual([1, 0, 2, 3]);

    const levels = [at(1, 'a'), at(2, 'b'), at(3, 'c'), at(9, 'i')];
    const entry = { ...OFFICIAL_THEMES[0], levels, slots: assignSlots(levels) };
    expect(themedLevel(entry, 8)?.name).toBe('i');
    expect(themedLevel(entry, 3)).toBeNull();
    const first = themedLevel(entry, 0)!;
    expect(first.level).toBe(1);
    expect(first.title).toBe('a');

    // Real chapters: every numbered level sits in the slot of its number. A failure here means
    // two level files share a number, or a number is above 21: fix the level file, not this test.
    for (const t of OFFICIAL_THEMES) {
      for (let i = 0; i < 21; i++) {
        const m = levelAt(t, i);
        if (m?.level !== undefined) expect(m.level, `${t.info.id} ${m.name}`).toBe(i + 1);
      }
    }
  });

  it('reads theme.json leniently', () => {
    const info = validateThemeInfo({ format: 1, id: 'a b!', name: 'X', colors: ['#fff', 'nope'], style: { badge: { kind: 'weird', pad: 9 } } });
    expect(info.id).toBe('ab');
    expect(info.style.badge.kind).toBe('pill');
    expect(info.style.badge.pad).toBe(4);
    expect(() => validateThemeInfo({ format: 2 })).toThrow();
  });

  it('shows translated theme text in its language and keeps the default elsewhere', () => {
    const info = validateThemeInfo({
      format: 1, id: 't', name: 'Frost', description: 'Cold', style: { badge: { caption: 'ICE' } },
      i18n: { ko: { name: '서리', caption: '얼음', bogus: 1 }, 'not a lang': { name: 'x' }, fr: {} },
    });
    expect(Object.keys(info.i18n ?? {})).toEqual(['ko']);
    const ko = localizeThemeInfo(info, 'ko');
    expect([ko.name, ko.description, ko.style.badge.caption]).toEqual(['서리', 'Cold', '얼음']);
    expect(localizeThemeInfo(info, 'en')).toBe(info);
    expect(info.name).toBe('Frost'); // the source text is never overwritten
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
    const { FONT_CATALOG } = await import('./localized/font-catalog');
    const ids = new Set<string>();
    for (const f of FONT_CATALOG) {
      expect(files.has(`../assets/fonts/${f.folder}/${f.file}`), f.file).toBe(true);
      expect(ids.has(f.id), f.id).toBe(false);
      expect(f.id).toMatch(/^[\w -]{1,40}$/);
      ids.add(f.id);
    }
  });

  it('accepts library fonts for the level badge', async () => {
    const { validateThemeInfo, blankThemeInfo } = await import('./localized/theme-pack');
    const base = blankThemeInfo();
    const withFont = (font: string) => validateThemeInfo({ ...base, style: { ...base.style, badge: { ...base.style.badge, font } } }).style.badge.font;
    expect(withFont('paperlogy-bold')).toBe('paperlogy-bold');
    expect(withFont('no-such-font')).toBe(base.style.badge.font);
    const withTitleFont = (titleFont: string) => validateThemeInfo({ ...base, style: { ...base.style, badge: { ...base.style.badge, titleFont } } }).style.badge.titleFont;
    expect(withTitleFont('serif')).toBe('serif');
    expect(withTitleFont('paperlogy-bold')).toBe('paperlogy-bold');
    expect(withTitleFont('no-such-font')).toBeUndefined();
    const withFx = (numberFx: unknown) => validateThemeInfo({ ...base, style: { ...base.style, badge: { ...base.style.badge, numberFx } } } as never).style.badge.numberFx;
    expect(withFx({ outline: '#FFFFFF', glow: '#3ae8ff', depth: 99, depthColor: '#000000' })).toEqual({ outline: '#ffffff', outlineWidth: 2, glow: '#3ae8ff', depth: 30, depthColor: '#000000' });
    expect(withFx({ shadow: 'black', depth: 0 })).toBeUndefined();
    expect(withFx('nope')).toBeUndefined();
  });
});
