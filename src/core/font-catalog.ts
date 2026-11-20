import { t as defaultTranslate, type Translator } from './i18n';
/**
 * Fonts that ship with the game (src/assets/fonts), with their copyright and license.
 *
 * `library` fonts (src/assets/fonts/etc) can be picked by id for theme screens and level badges;
 * `ui` fonts are the app's own (main text, titles, timer). The license data is what the font
 * files themselves state (their name table) — fonts marked `check` don't say, so their
 * distributor's terms apply and must be confirmed before a public release.
 */

export type FontLicense = 'ofl' | 'personal' | 'commercial' | 'check';

export interface CatalogFont {
  /** Id used in theme files (`font: "paperlogy-bold"`) */
  id: string;
  /** Display name */
  name: string;
  /** File name in src/assets/fonts/<folder>/ */
  file: string;
  folder: 'etc' | 'main' | 'title' | 'timer';
  group: 'library' | 'ui';
  /** Script coverage, for the picker */
  script: 'latin' | 'korean' | 'japanese' | 'chinese';
  copyright: string;
  designer?: string;
  license: FontLicense;
  /** What the font file says about its license, when it says something beyond the kind */
  licenseNote?: string;
  url?: string;
}

/** Independent localized API; no process-wide locale or browser dependencies. */
export function createFontCatalogApi(t: Translator = defaultTranslate) {



  const LICENSE_LABELS: Record<FontLicense, string> = {
    ofl: t('fontLicense.ofl'),
    personal: t('fontLicense.personal'),
    commercial: t('fontLicense.commercial'),
    check: t('fontLicense.check'),
  };

  const OFL_URL = 'https://openfontlicense.org';

  const ofl = (id: string, name: string, file: string, script: CatalogFont['script'], copyright: string, designer?: string, url?: string): CatalogFont => ({
    id, name, file, folder: 'etc', group: 'library', script, copyright, designer, license: 'ofl', url: url ?? OFL_URL,
  });

  const other = (id: string, name: string, file: string, script: CatalogFont['script'], license: FontLicense, copyright: string, designer?: string, extra: Partial<CatalogFont> = {}): CatalogFont => ({
    id, name, file, folder: 'etc', group: 'library', script, copyright, designer, license, ...extra,
  });

  const FONT_CATALOG: CatalogFont[] = [
    // ── Open Font License ──
    ofl('barriecito', 'Barriecito', 'Barriecito-Regular.ttf', 'latin', 'Copyright 2018 The Barriecito Project Authors (https://github.com/Omnibus-Type/Barrio/Barriecito)', 'Pablo Cosgaya & Sergio Jiménez'),
    ofl('caesar-dressing', 'Caesar Dressing', 'CaesarDressing-Regular.ttf', 'latin', 'Copyright (c) 2011 by Open Window, with Reserved Font Name "Caesar Dressing"', 'Open Window'),
    ofl('chelsea-market', 'Chelsea Market', 'ChelseaMarket-Regular.ttf', 'latin', 'Copyright (c) 2011 by Font Diner, Inc DBA Tart Workshop, with Reserved Font Name "Chelsea Market"', 'Font Diner, Inc DBA Tart Workshop'),
    ofl('denk-one', 'Denk One', 'DenkOne-Regular.ttf', 'latin', "Copyright 2012 The Denk One Project Authors (https://github.com/SorkinType/Voltaire), with Reserved Font Name 'Denk'", 'Sorkin Type Co.'),
    ofl('galmuri11', 'Galmuri11 Bold', 'Galmuri11-Bold.ttf', 'korean', 'Copyright (c) 2019-2023 Minseo Lee', 'Minseo Lee'),
    ofl('geostar', 'Geostar', 'Geostar-Regular.ttf', 'latin', 'Copyright (c) 2011, Admix Designs (http://www.admixdesigns.com/), with Reserved Font Name Geostar', 'Joe Prince'),
    ofl('kkakdugi-extralight', 'Kkakdugi Drafting ExtraLight', 'KkakdugiDrafting-ExtraLight.ttf', 'korean', 'Copyright 2026 The Kkakdugi Drafting Project Authors (https://github.com/dynamic-potato/kkakdugi-drafting), with Reserved Font Names "Kkakdugi Drafting" and "깍두기 제도체"', 'Dynamic Potato'),
    ofl('kkakdugi-light', 'Kkakdugi Drafting Light', 'KkakdugiDrafting-Light.ttf', 'korean', 'Copyright 2026 The Kkakdugi Drafting Project Authors (https://github.com/dynamic-potato/kkakdugi-drafting), with Reserved Font Names "Kkakdugi Drafting" and "깍두기 제도체"', 'Dynamic Potato'),
    ofl('kkakdugi', 'Kkakdugi Drafting', 'KkakdugiDrafting-Regular.ttf', 'korean', 'Copyright 2026 The Kkakdugi Drafting Project Authors (https://github.com/dynamic-potato/kkakdugi-drafting), with Reserved Font Names "Kkakdugi Drafting" and "깍두기 제도체"', 'Dynamic Potato'),
    ofl('kkakdugi-bold', 'Kkakdugi Drafting Bold', 'KkakdugiDrafting-Bold.ttf', 'korean', 'Copyright 2026 The Kkakdugi Drafting Project Authors (https://github.com/dynamic-potato/kkakdugi-drafting), with Reserved Font Names "Kkakdugi Drafting" and "깍두기 제도체"', 'Dynamic Potato'),
    ofl('monomaniac-one', 'Monomaniac One', 'MonomaniacOne-Regular.ttf', 'japanese', 'Copyright 2020 The Monomaniac Project Authors (https://github.com/ManiackersDesign/monomaniac)'),
    ofl('paperlogy-light', 'Paperlogy Light', 'Paperlogy-3Light.ttf', 'korean', 'Copyright © 2024 PT&', 'PT&'),
    ofl('paperlogy-medium', 'Paperlogy Medium', 'Paperlogy-5Medium.ttf', 'korean', 'Copyright © 2024 PT&', 'PT&'),
    ofl('paperlogy-bold', 'Paperlogy Bold', 'Paperlogy-7Bold.ttf', 'korean', 'Copyright © 2024 PT&', 'PT&'),
    ofl('sail', 'Sail', 'Sail-Regular.ttf', 'latin', 'Copyright (c) 2011 by LatinoType Limitada, with Reserved Font Names "Sail"', 'Miguel Hernandez'),
    ofl('sankofa-display', 'Sankofa Display', 'SankofaDisplay-Regular.ttf', 'latin', 'Copyright 2024 The Sankofa Display Project Authors (https://github.com/batsimadz/Sankofa-Display)', 'Batsirai Madzonga'),
    ofl('stick', 'Stick', 'Stick-Regular.ttf', 'japanese', 'Copyright 2020 The Stick Project Authors (https://github.com/fontworks-fonts/Stick/)', 'Fontworks Inc.'),
ofl('glf-murca', 'GLF Murca', 'GLF-Murca-Regular.ttf', 'latin', 'Copyright © 2026 by Gliftype Foundry', 'Sidiq Kamal Nurmawan'),
    ofl('glf-murca-ultrabold', 'GLF Murca UltraBold', 'GLF-Murca-UltraBold.ttf', 'latin', 'Copyright © 2026 by Gliftype Foundry', 'Sidiq Kamal Nurmawan'),
    ofl('glf-murca-black', 'GLF Murca Black', 'GLF-Murca-Black.ttf', 'latin', 'Copyright © 2026 by Gliftype Foundry', 'Sidiq Kamal Nurmawan'),
    ofl('levelup', 'LevelUp', 'LevelUp-Regular.ttf', 'korean', 'Copyright 2026 Hada Type Foundry. Copyright 2023 Kil Hyung-jin. Copyright 2014-2021 Adobe.', 'Hada Type Foundry'),
    ofl('levelup-italic', 'LevelUp Italic', 'LevelUp-Italic.ttf', 'korean', 'Copyright 2026 Hada Type Foundry. Copyright 2023 Kil Hyung-jin. Copyright 2014-2021 Adobe.', 'Hada Type Foundry'),
    ofl('levelup-semibold', 'LevelUp SemiBold', 'LevelUp-SemiBold.ttf', 'korean', 'Copyright 2026 Hada Type Foundry. Copyright 2023 Kil Hyung-jin. Copyright 2014-2021 Adobe.', 'Hada Type Foundry'),
    ofl('levelup-semibold-italic', 'LevelUp SemiBold Italic', 'LevelUp-SemiBoldItalic.ttf', 'korean', 'Copyright 2026 Hada Type Foundry. Copyright 2023 Kil Hyung-jin. Copyright 2014-2021 Adobe.', 'Hada Type Foundry'),
    ofl('levelup-bold', 'LevelUp Bold', 'LevelUp-Bold.ttf', 'korean', 'Copyright 2026 Hada Type Foundry. Copyright 2023 Kil Hyung-jin. Copyright 2014-2021 Adobe.', 'Hada Type Foundry'),
    ofl('levelup-bold-italic', 'LevelUp Bold Italic', 'LevelUp-BoldItalic.ttf', 'korean', 'Copyright 2026 Hada Type Foundry. Copyright 2023 Kil Hyung-jin. Copyright 2014-2021 Adobe.', 'Hada Type Foundry'),
    ofl('lt-stopwatch', 'LT Stopwatch', 'LTStopwatch-v2.ttf', 'latin', 'Copyright (c) 2024, LyonsType (lyonstype4.wixsite.com/lyonstype-beta), with Reserved Font Name LT Stopwatch', 'Daniel Lyons'),
    ofl('lt-stopwatch-italic', 'LT Stopwatch Italic', 'LTStopwatchItalic-v2.ttf', 'latin', 'Copyright (c) 2024, LyonsType (lyonstype4.wixsite.com/lyonstype-beta), with Reserved Font Name LT Stopwatch', 'Daniel Lyons'),
    ofl('unifraktur-cook', 'UnifrakturCook', 'UnifrakturCook-Bold.ttf', 'latin', "Copyright (c) 2010 j. 'mach' wust, with Reserved Font Name UnifrakturCook. Copyright (c) 2009 Peter Wiegel", "j. 'mach' wust, Peter Wiegel"),

    // ── License not stated in the file ──
    other('paradox-210', '210 Paradox', '4ff025ed0f2f7ff08551ac3a0368c3b3.otf', 'korean', 'check', 'Copyright (c) 2017 Design210. All rights reserved.', 'Design210', { url: 'http://www.design210.com' }),
    other('sogeumjaengi-210', '210 Sogeumjaengi Bold', 'ef5c24bc9a642d8e0431abf54af3ff9b.otf', 'korean', 'check', 'Copyright (c) 2018 Design210. All rights reserved.', 'Design210', { url: 'http://www.design210.com' }),
    other('ggoltong-robot', 'Korean KTLBR (꼴통로봇)', 'a꼴통로봇.otf', 'korean', 'check', 'Copyright © 1992-2014 AsiaSoft Inc. Seoul Korea All Rights Reserved.', 'AsiaSoft Inc.', {
      licenseNote: t('fontLicense.noteVendor'), url: 'http://www.asiasoft.co.kr',
    }),
    other('sounso-quality', 'Sounso Quality', 'No.019-Sounso Quality.ttf', 'latin', 'check', '(c) Copyright Sichuan SounSo Brand Planning Co.,Ltd', 'Sounso Fonts', {
      licenseNote: t('fontLicense.noteSsfonts'), url: 'https://www.ssfonts.com',
    }),
    other('hakgyoansim-namu', 'Hakgyoansim Namu L', 'HakgyoansimNamuL.ttf', 'korean', 'check', 'Copyright © KERIS. All rights reserved.', 'Design210'),
    other('hakgyoansim-tuho', 'Hakgyoansim Tuho R', 'HakgyoansimTuhoR.ttf', 'korean', 'check', 'Copyright © KERIS. All rights reserved.', 'Design210'),
    other('hikr', 'HiKR ExtraBold', 'HiKR-ExtraBold.ttf', 'korean', 'check', '© 2026 Korea Tourism Organization. All rights reserved.', 'Korea Tourism Organization'),
    other('sinchon-rhapsody', 'Sinchon Rhapsody ExtraBold', 'SinchonRhapsodyTTF-ExtraBold.ttf', 'korean', 'check', 'Copyright © 2024 SEODAEMUN-GU Office. All rights reserved.', 'SEODAEMUN-GU Office'),
    other('stellar-serif', 'Stellar Serif Bold Condensed', 'Stellar_Serif_Bold_Condensed.ttf', 'korean', 'check', 'Copyright (c) 2026 DONGSEO UNIVERSITY. All rights reserved.', 'DONGSEO UNIVERSITY'),
    other('napjak-block', 'Gabia Napjak Block', 'gabia_napjakBlock.ttf', 'korean', 'check', 'Copyright 2015 Gabia. All rights reserved.', 'Gabia'),
other('busan-dandi-light', 'Busan Dandi Myeongjo Light', 'BusanDandiMyeongjoL.ttf', 'korean', 'check', 'Copyright © Busan Metropolitan City. All rights reserved.', 'YOONDESIGN Inc. (Jeongeun Lee, Woobin Song)', { url: 'https://www.busan.go.kr/' }),
    other('busan-dandi-medium', 'Busan Dandi Myeongjo Medium', 'BusanDandiMyeongjoM.ttf', 'korean', 'check', 'Copyright © Busan Metropolitan City. All rights reserved.', 'YOONDESIGN Inc. (Jeongeun Lee, Woobin Song)', { url: 'https://www.busan.go.kr/' }),
    other('busan-dandi-bold', 'Busan Dandi Myeongjo Bold', 'BusanDandiMyeongjoB.ttf', 'korean', 'check', 'Copyright © Busan Metropolitan City. All rights reserved.', 'YOONDESIGN Inc. (Jeongeun Lee, Woobin Song)', { url: 'https://www.busan.go.kr/' }),
    other('chai-hwaljjak', 'Chai Hwaljjak', 'ChaiHwaljjak-Regular.ttf', 'korean', 'check', 'Copyright © 2025 CHAI. All rights reserved.', 'Cosmope Type', { url: 'https://www.artistchai.co.kr' }),
    other('chai-hwaljjak-medium', 'Chai Hwaljjak Medium', 'ChaiHwaljjak-Medium.ttf', 'korean', 'check', 'Copyright © 2025 CHAI. All rights reserved.', 'Cosmope Type', { url: 'https://www.artistchai.co.kr' }),
    other('chai-hwaljjak-bold', 'Chai Hwaljjak Bold', 'ChaiHwaljjak-Bold.ttf', 'korean', 'check', 'Copyright © 2025 CHAI. All rights reserved.', 'Cosmope Type', { url: 'https://www.artistchai.co.kr' }),
    other('chai-hwaljjak-heavy', 'Chai Hwaljjak Heavy', 'ChaiHwaljjak-Heavy.ttf', 'korean', 'check', 'Copyright © 2025 CHAI. All rights reserved.', 'Cosmope Type', { url: 'https://www.artistchai.co.kr' }),
    other('bing-boss', 'Bing Boss', 'Bing Boss.otf', 'latin', 'check', 'Copyright (c) 2026 by Khurasan. All rights reserved.', 'Khurasan', { url: 'https://www.khurasanstudio.com' }),
    other('hexadecimal', 'Hexadecimal', 'Hexadecimal.otf', 'latin', 'check', '', undefined, { licenseNote: t('fontLicense.noteNone') }),
    other('led-dot-matrix', 'LED Dot-Matrix', 'LED Dot-Matrix.ttf', 'latin', 'check', '', 'Onur Cem Tan (Krafti Lab)', { licenseNote: t('fontLicense.noteNone'), url: 'http://www.kraftilab.com' }),
    other('minicomputer-light', 'Minicomputer Light', 'Minicomputer Lt.otf', 'latin', 'check', '© 2017-2024 Typodermic Fonts Inc.', 'Raymond Larabie', { url: 'https://typodermicfonts.com' }),
    other('minicomputer-light-italic', 'Minicomputer Light Italic', 'Minicomputer Lt It.otf', 'latin', 'check', '© 2017-2024 Typodermic Fonts Inc.', 'Raymond Larabie', { url: 'https://typodermicfonts.com' }),
    other('pumpkin-haunt', 'Pumpkin Haunt (Demo)', 'Pumpkin Haunt Demo.otf', 'latin', 'check', 'Copyright (c) 2025 by Lettersweet. All rights reserved.', 'Lettersweet', {
      licenseNote: t('fontLicense.noteDemo'), url: 'https://www.behance.net/lettersweetstudio',
    }),
    other('gunhami', 'GFC Gunhami Talks', 'gunham.ttf', 'korean', 'check', 'COPYRIGHT(C) GYEONGNAM FOOTBALL CLUB. ALL RIGHTS RESERVED.', 'YOONDESIGN Inc.', { url: 'https://www.gyeongnamfc.com/' }),

    // ── The app's own fonts ──
    { id: 'ui-mango', name: 'Mango Ddobak (L / R / B)', file: 'MangoDdobak-R(ttf).ttf', folder: 'main', group: 'ui', script: 'korean', copyright: 'Copyright (c) MANGOBOARD. All rights reserved. Font designed by Earlyfont.', designer: 'Earlyfont', license: 'check' },
    { id: 'ui-hyejaroun', name: 'GS Hyejaroun Bold', file: 'GSHYEJAROUNTTF-Bold.ttf', folder: 'title', group: 'ui', script: 'korean', copyright: 'Copyright © 2026 GS Retail Co., Ltd. All Rights Reserved.', designer: 'Tlab Inc.', license: 'check', url: 'http://hyejaroun.com' },
    { id: 'aa-mingxinpian', name: 'Aa ShiGe MingXinPian', file: 'AaShiGeMingXinPian-2.ttf', folder: 'main', group: 'library', script: 'chinese', copyright: 'Copyright (c) 2023 HanMeiHutong (XiaMen) Technology Co. Ltd. All rights reserved.', designer: 'HanMeiHutong (XiaMen) Technology Co. Ltd.', license: 'check' },
    { id: 'aa-yuanheiti', name: 'Aa YuanHeiTi', file: 'AaYuanHeiTi-2.ttf', folder: 'title', group: 'library', script: 'chinese', copyright: 'Copyright (c) 2022 HanMeiHutong (XiaMen) Technology Co. Ltd. All rights reserved.', designer: 'HanMeiHutong (XiaMen) Technology Co. Ltd.', license: 'check' },
    { id: 'ui-duggobi', name: 'HS Duggobi (HS두꺼비체)', file: 'HS두꺼비체.ttf', folder: 'timer', group: 'ui', script: 'korean', copyright: 'Copyright (c) 2017 by Hyun S. Choi. All rights reserved.', designer: 'Hyun S. Choi', license: 'check', url: 'http://hp0.blog.me' },
  ];

  /** Fonts a theme can pick by id */
  const LIBRARY_FONTS = FONT_CATALOG.filter((f) => f.group === 'library');

  const LIBRARY_IDS = new Set(LIBRARY_FONTS.map((f) => f.id));

  function isLibraryFont(id: string | undefined): boolean {
    return !!id && LIBRARY_IDS.has(id);
  }

  function libraryFont(id: string): CatalogFont | undefined {
    return LIBRARY_FONTS.find((f) => f.id === id);
  }
  return { LICENSE_LABELS, FONT_CATALOG, LIBRARY_FONTS, isLibraryFont, libraryFont };
}

export const { LICENSE_LABELS, FONT_CATALOG, LIBRARY_FONTS, isLibraryFont, libraryFont } = createFontCatalogApi();
