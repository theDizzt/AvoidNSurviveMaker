# 테마 (월드)

공식 챕터 16개는 `src/web/theme-registry.ts` 의 `CHAPTER_FOLDERS` 에 적힌 순서대로 선택됩니다. 이 폴더에는 공식 챕터 팩만 있습니다.
원래의 테마 6개와 빈 `_template` 은 저장소 루트의 `custom-themes/` 로 옮겨졌습니다. 이들은 Theme Editor 의 **Start from** 선택기에서 **Custom theme presets** 로 쓸 수 있으며, 맵과 아트워크가 그대로 보존되어 있습니다. 프리셋을 불러온 뒤 **Play as custom pack** 또는 **Export .zip** 을 고르면 커스텀 테마로 쓸 수 있습니다.

챕터 1 은 `chapter-01-workshop` 의 **Tutorial Workshop**(캠페인 id `workshop`)입니다. 기존 `pastel` 진행 상황은 이어집니다. 별도의 원래 커스텀 프리셋은 **Pastel Plains** 로 남아 있으며, 공식 Workshop 파일과는 독립적입니다.

챕터 2–16 은 `chapter-NN-concept/` 에 있습니다. 표지 아트, 맵 색상, 배지, 커스텀 레벨 선택 레이아웃은 있지만 임시 게임 맵은 없습니다. `levels/` 폴더에 맵이 추가될 때까지 **Coming soon** 으로 표시됩니다. 챕터 13, 14, 16 은 의도적으로 중립적인 TBD 아트워크를 쓰며, 이름이 정해지지 않은 나머지 챕터는 받은 콘셉트 이름을 유지합니다.
계획된 디자인의 원본은 `scripts/make-chapter-themes.ps1` 이며, 실행하면 해당 챕터들의 `theme.json` 과 `cover.svg` 를 다시 만듭니다(그 파일의 수정 사항은 덮어씁니다).

커스텀 레벨 팩은 같은 폴더를 zip 으로 묶은 것입니다. 메인 메뉴의 **Theme Editor** 에서 만들고(*Export .zip*), 월드 화면의 **Load pack (.zip)** 으로 불러옵니다. 커스텀 팩을 공식 월드로 만들려면 여기에 폴더로 압축을 풀고 `CHAPTER_FOLDERS` 에 등록하세요.

```
themes/07-my-world/
  theme.json        월드 정보와 모양 (아래 참고)
  cover.png         대표 이미지, 월드 타일에 표시   (이름 자유, "cover" 참고)
  badge.png         레벨 번호 뒤의 그림             (선택, "style.badge.image" 참고)
  levels/
    01.json         파일 이름 순서로 레벨, 최대 21개
    02.json         (Map Editor 의 "Export JSON" 으로 내보낸 맵)
    …
```

이미지는 `.png`, `.jpg`, `.webp`, `.gif`, `.svg` 를 쓸 수 있습니다.

## theme.json

| 필드 | 의미 |
|---|---|
| `format` | 항상 `1` |
| `id` | 고유 id. 진행 상황이 이 id 로 저장됩니다. 영문, 숫자, `-`, `_` |
| `name` | 월드 이름 |
| `description` | 월드에 대한 한두 문장 |
| `author` | 만든 사람 |
| `authorUrl` | 만든 사람 링크 (선택) |
| `released` | 공개일, `YYYY-MM-DD` |
| `unlockStars` | 플레이에 필요한 별 수 (공식 월드 전체 합계). `0` = 처음부터 열림 |
| `colors` | 두 색 `["#rrggbb", "#rrggbb"]`: 월드 타일의 그라데이션 |
| `cover` | 대표 이미지 파일 이름 (선택) |
| `music` | 팩 안의 상대 오디오 경로, 예: `audio/background.mp3` (선택) |
| `style.maze` | 자체 테마가 없는 레벨의 미로 색상: `{ "wall": …, "path": … }`, 맵의 `theme` 과 같은 형식 (Theme Editor 에서 만드는 것이 가장 쉬움) |
| `style.designs` | 하위 테마 목록: `{ "id": "ruins", "name": "Ruins", "levels": [14, 21], "maze": { … } }`. 개수 제한 없음 (아래 "하위 테마" 참고) |
| `style.badge` | 게임 안 레벨 번호 / 제목 배지 (아래 참고) |
| `i18n` | 다른 언어의 문구 (선택, 아래 참고) |

### 언어별 문구 (`i18n`)

위의 `name`, `description`, `credits`, `style.badge.caption` 은 기본(영어) 문구입니다. 게임 언어가 바뀌면 `i18n` 에 그 언어의 문구가 있을 때 대신 표시되고, 없는 필드는 기본 문구를 그대로 씁니다.

```json
"i18n": {
  "ko": { "name": "영원한 서리", "description": "…", "credits": "…", "caption": "…" }
}
```

**Theme Editor** 의 **Translation: 한국어** 섹션에서도 편집할 수 있으며, ZIP 으로 내보내면 함께 저장됩니다.

### 배경 음악

**Theme Editor → Background music** 에서 MP3, OGG, WAV, M4A, AAC, FLAC 파일(최대 20 MB)을 고릅니다. **Preview music**, **Stop**, **Remove music** 으로 관리합니다.
음악은 레벨 선택과 플레이 내내 반복되며, 레벨 사이에서 다시 시작하지 않습니다. 마스터 볼륨과 배경 음악 볼륨이 미리 듣기와 플레이에 적용됩니다. 형식은 플레이어의 브라우저가 지원해야 합니다. 음악 파일이 없는 테마는 무음입니다.

음악은 테마 ZIP 가져오기/내보내기에 포함됩니다. 공식 테마나 번들 커스텀 테마에서는 오디오 파일을 해당 테마 폴더 안에 두고 `theme.json` 에 `"music": "audio/background.mp3"` 를 설정합니다. 큰 오디오는 브라우저의 초안/커스텀 팩 localStorage 용량을 넘을 수 있습니다. 이 경우 에디터가 알려 주며, 현재 팩은 여전히 ZIP 으로 내보낼 수 있습니다(가져오기 제한 30 MB).

메뉴 음악은 **Options → Main menu music**(이 브라우저에 로컬 저장)을 쓰거나, `src/assets/music/main-menu.mp3` 를 추가해 모든 사람에게 기본값으로 번들할 수 있습니다. **Reset music** 은 로컬 교체를 지웁니다. 재생은 첫 상호 작용 이후에 시작되며 숨겨진 탭에서는 일시 정지됩니다.

### 하위 테마 (레벨별 디자인)

한 테마 안에 여러 모양을 둘 수 있습니다. `style.designs` 의 각 항목이 **하위 테마**이며, Theme Editor 의 **테마** 패널 맨 위 트리에서 기본 테마 아래에 나열됩니다. 트리에서 하위 테마를 고르면 그 하위 테마의 이름·레벨 범위·음악·미로 색을 편집하고, **배지** 패널에서는 그 하위 테마의 배지를 편집합니다.

| 필드 | 의미 |
|---|---|
| `id` | 영문·숫자·`-`·`_` 1–60자, 테마 안에서 중복 불가. `default` 는 예약어 |
| `name` | 이름 (기본 언어) |
| `i18n` | 다른 언어 이름: `{ "ko": "유적" }` (선택) |
| `levels` | `[처음, 끝]` 레벨 번호. 이 번호의 레벨은 따로 고르지 않는 한 이 하위 테마를 입습니다 (선택) |
| `maze` | 미로 색. 생략하면 게임의 기본 모양 |
| `badge` | 전용 레벨 배지 (`style.badge` 와 같은 형식, 선택). 없으면 연결된 테마의 배지, 그것도 없으면 기본 테마의 배지 |
| `music` | 전용 배경 음악 경로 (선택). 없으면 연결된 테마, 그다음 기본 테마의 음악 |
| `themeId` | 연결할 번들 테마 id (선택) |

레벨이 입는 하위 테마는 다음 순서로 정해집니다.

1. 레벨 JSON 의 `"themeDesign"` 이 하위 테마 `id` 이면 그 하위 테마. `"themeDesign": "default"` 이면 범위와 상관없이 기본 테마.
2. 아니면 레벨 번호가 `levels` 범위에 드는 하위 테마.
3. 아니면 레벨 자체의 `theme`, 그다음 테마의 `style.maze`.

Theme Editor 의 **레벨** 패널에서 레벨마다 **자동**(범위에 따름), 기본 테마, 각 하위 테마 중 하나를 고를 수 있습니다. 하위 테마를 직접 고르면 레벨에 들어 있던 미로 색 대신 하위 테마의 색을 씁니다. Map Editor 의 테마 선택기에도 각 테마 아래에 하위 테마가 나오며, 고르면 레벨에 `themeId` 와 `themeDesign` 이 함께 저장됩니다.

예: 챕터 2 는 `desert`(레벨 1–13) 와 `ruins`(레벨 14–21) 두 하위 테마를 가집니다.

### 미로 패턴

미로 표면 채우기는 다음 패턴 id 를 지원합니다: `stripes`, `diagonal`, `dots`, `grid`, `checker`, `wood`(엇갈린 판자와 나뭇결), `grass`(풀잎), `sand`(모래알과 물결), `metal`(브러시드 패널과 리벳), `egyptian`(고대 이집트 문양), `sandBrick`(모래 벽돌), `bark`(갈라진 나무 껍질), `woodGrain`(옹이를 감싸 흐르는 나무 속 결). 에디터에서 채우기 종류로 **Pattern** 을 고른 뒤 재질을 선택하세요. 모든 패턴은 벽과 길 모두에서 선택한 `color`, `background`, 타일 `size`(4–64 픽셀)를 사용합니다.

### style.badge

| 필드 | 의미 |
|---|---|
| `kind` | `pill` 둥근 판 · `disc` 레코드판 · `emblem` 눈꽃 엠블럼 · `plate` 톱니 판 · `slant` 기울어진 띠 · `ring` 나무 단면 · `image` 직접 넣은 그림 |
| `primary`, `secondary` | 디자인의 주 색상과 보조 색상 |
| `numberColor`, `titleColor` | 레벨 번호와 제목 색상 |
| `font` | `title`, `main`, `serif`, `heavy`, `timer`, 또는 라이브러리 폰트 id (*커스텀 화면과 폰트* 참고) |
| `pad` | 번호 앞을 0 으로 채우기: `0` → `7`, `2` → `07`, `3` → `007` |
| `showTitle` | 번호 옆에 레벨 제목 표시 |
| `caption` | 제목 위의 작은 글자, 예: `"♫ Now Playing"` (선택) |
| `image` | `kind: "image"` 에 쓸 그림 파일 이름 (선택) |

## 레벨

각 레벨은 일반 맵 파일입니다. 월드에서 중요한 필드(모두 Map Editor 의 **Level settings** 에서 설정):

- `title`, `level` — 배지에 표시 (레벨 번호의 기본값은 순서)
- `difficulty` — 1.00 ~ 10.00, 레벨 선택에 표시. 월드 타일에는 평균이 표시됨 (값이 없는 레벨은 1.00 으로 계산)
- `stars` — 별 3 / 2 / 1개 기준 클리어 시간. 없으면 클리어하기만 해도 별 3개

## 커스텀 화면과 폰트

테마는 레벨 선택 화면(`screens.select`)을 1280×720 스테이지로 바꿀 수 있습니다. **Theme Editor**(*Level select* 탭)에서 디자인하면 그 형식이 theme.json 에 기록됩니다. 레벨은 선택하면 바로 시작됩니다.

- `screens.<name>.background`: `color`, 선택적 `color2`(그라데이션), `image`(파일), `fit`
  (`cover` / `contain` / `tile`), `dim` (0–0.9)
- `screens.<name>.elements`: `text`, `image`, `box`, `levelGrid`(레벨 버튼. 칸보다 레벨이 많으면 페이지를 넘김), `back`, `stars`, `progress`. 각 요소는 `x`, `y`, `w`, `h` 와 선택적인 `rotate`, `opacity`, `when`
  (`allComplete`, `notComplete`, `cleared`, `notCleared`)을 가집니다.
- 텍스트 자리 표시자: `{theme}`, `{description}`, `{author}`, `{credits}`, `{released}`,
  `{cleared}`, `{total}`, `{stars}`, `{maxStars}`.
- `credits`: `{credits}` 로 표시되는 자유 텍스트 (디자이너, 음악 등).
- `fonts`: `[{ "family": "LCD", "file": "fonts/lcd.ttf" }]` — 팩 안의 폰트 파일. 텍스트와 레벨 버튼에서 `family` 로 고릅니다. 내장 폰트: `title`, `main`, `serif`, `heavy`,
  `condensed`, `digital`, `hand`, `blackletter`, `mono`.
- 라이브러리 폰트: `src/assets/fonts/etc` 의 폰트는 폰트를 고르는 모든 곳(텍스트, 레벨 버튼, `style.badge.font`)에서 id 로 쓸 수 있습니다. 예: `"font": "paperlogy-bold"`. id, 저작권, 라이선스는 `src/assets/fonts/LICENSES.md` 와 게임 안 **Options → Font licenses** 에 나와 있습니다. 파일에 라이선스가 명시되지 않은 폰트는 선택기에서 ⓘ 로 표시됩니다.

공식 테마는 레벨 슬롯이 21개입니다. 커스텀 팩은 레벨 수에 제한이 없습니다.
