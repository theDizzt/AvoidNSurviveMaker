# 번들 폰트: 저작권과 라이선스

게임은 이 목록을 **Options → Licenses** 에 표시합니다. 데이터는
`src/core/font-catalog.ts` 에 있으므로, 폰트를 추가하거나 뺄 때 두 곳을 함께 맞춰 주세요.

개인 사용 전용이거나 유료로 판매되는 폰트는 번들하지 않습니다. 라이선스 종류는 각 폰트 파일이 자체 메타데이터(name 테이블)에 적어 둔 내용을 따릅니다.

- **OFL** — SIL Open Font License 1.1 (전문: [OFL.txt](OFL.txt)). 저작권 고지와 라이선스를 함께
  제공하면 게임에 자유롭게 번들하고 재배포할 수 있습니다.
- **Check** — 파일에 라이선스가 명시되어 있지 않습니다. 공개 출시 전에 배포처의 약관을 확인하세요.

## 인터페이스 (`main/`, `title/`, `timer/`)

| 폰트 | 파일 | 저작권 | 라이선스 |
|---|---|---|---|
| Mango Ddobak L / R / B | `main/MangoDdobak-*.ttf` | © MANGOBOARD. Font designed by Earlyfont | Check |
| GS Hyejaroun Bold | `title/GSHYEJAROUNTTF-Bold.ttf` | © 2026 GS Retail Co., Ltd. (Tlab Inc.) — hyejaroun.com | Check |
| HS Duggobi | `timer/HS두꺼비체.ttf` | © 2017 Hyun S. Choi — hp0.blog.me | Check |

## 라이브러리 (`etc/`) — 테마에서 id 로 사용 가능

| Id | 폰트 | 파일 | 저작권 | 라이선스 |
|---|---|---|---|---|
| `barriecito` | Barriecito | `Barriecito-Regular.ttf` | © 2018 The Barriecito Project Authors (Pablo Cosgaya & Sergio Jiménez) | OFL |
| `caesar-dressing` | Caesar Dressing | `CaesarDressing-Regular.ttf` | © 2011 Open Window, RFN "Caesar Dressing" | OFL |
| `chelsea-market` | Chelsea Market | `ChelseaMarket-Regular.ttf` | © 2011 Font Diner, Inc DBA Tart Workshop, RFN "Chelsea Market" | OFL |
| `denk-one` | Denk One | `DenkOne-Regular.ttf` | © 2012 The Denk One Project Authors (Sorkin Type), RFN 'Denk' | OFL |
| `galmuri11` | Galmuri11 Bold | `Galmuri11-Bold.ttf` | © 2019-2023 Minseo Lee | OFL |
| `geostar` | Geostar | `Geostar-Regular.ttf` | © 2011 Admix Designs (Joe Prince), RFN Geostar | OFL |
| `kkakdugi-extralight` `kkakdugi-light` `kkakdugi` `kkakdugi-bold` | Kkakdugi Drafting | `KkakdugiDrafting-*.ttf` | © 2026 The Kkakdugi Drafting Project Authors (Dynamic Potato), RFN "Kkakdugi Drafting", "깍두기 제도체" | OFL |
| `monomaniac-one` | Monomaniac One | `MonomaniacOne-Regular.ttf` | © 2020 The Monomaniac Project Authors | OFL |
| `paperlogy-light` `paperlogy-medium` `paperlogy-bold` | Paperlogy | `Paperlogy-*.ttf` | © 2024 PT& | OFL |
| `sail` | Sail | `Sail-Regular.ttf` | © 2011 LatinoType Limitada (Miguel Hernandez), RFN "Sail" | OFL |
| `sankofa-display` | Sankofa Display | `SankofaDisplay-Regular.ttf` | © 2024 The Sankofa Display Project Authors (Batsirai Madzonga) | OFL |
| `stick` | Stick | `Stick-Regular.ttf` | © 2020 The Stick Project Authors (Fontworks Inc.) | OFL |
| `unifraktur-cook` | UnifrakturCook | `UnifrakturCook-Bold.ttf` | © 2010 j. 'mach' wust, RFN UnifrakturCook; © 2009 Peter Wiegel | OFL |
| `paradox-210` | 210 Paradox | `4ff025ed0f2f7ff08551ac3a0368c3b3.otf` | © 2017 Design210 | Check |
| `sogeumjaengi-210` | 210 Sogeumjaengi Bold | `ef5c24bc9a642d8e0431abf54af3ff9b.otf` | © 2018 Design210 | Check |
| `ggoltong-robot` | Korean KTLBR (꼴통로봇) | `a꼴통로봇.otf` | © 1992-2014 AsiaSoft Inc. | Check |
| `sounso-quality` | Sounso Quality | `No.019-Sounso Quality.ttf` | © Sichuan SounSo Brand Planning Co., Ltd — ssfonts.com | Check |
| `hakgyoansim-namu` `hakgyoansim-tuho` | Hakgyoansim Namu L / Tuho R | `HakgyoansimNamuL.ttf`, `HakgyoansimTuhoR.ttf` | © KERIS (Design210) | Check |
| `hikr` | HiKR ExtraBold | `HiKR-ExtraBold.ttf` | © 2026 Korea Tourism Organization | Check |
| `sinchon-rhapsody` | Sinchon Rhapsody ExtraBold | `SinchonRhapsodyTTF-ExtraBold.ttf` | © 2024 SEODAEMUN-GU Office | Check |
| `stellar-serif` | Stellar Serif Bold Condensed | `Stellar_Serif_Bold_Condensed.ttf` | © 2026 DONGSEO UNIVERSITY | Check |
| `napjak-block` | Gabia Napjak Block | `gabia_napjakBlock.ttf` | © 2015 Gabia | Check |
| `gunhami` | GFC Gunhami Talks | `gunham.ttf` | © Gyeongnam Football Club (YoonDesign Inc.) | Check |
| `aa-mingxinpian` | Aa ShiGe MingXinPian (중국어 본문 fallback 겸용) | `main/AaShiGeMingXinPian-2.ttf` | © 2023 HanMeiHutong (XiaMen) Technology Co. Ltd. | Check |
| `aa-yuanheiti` | Aa YuanHeiTi (중국어 제목 fallback 겸용) | `title/AaYuanHeiTi-2.ttf` | © 2022 HanMeiHutong (XiaMen) Technology Co. Ltd. | Check |

RFN = Reserved Font Name (예약 폰트 이름).
