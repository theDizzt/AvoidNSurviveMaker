# 개발 가이드

## 버전

게임 버전은 [`VERSION`](../VERSION) 파일에 `Update N` 형식(예: `Update 20`)으로 들어 있으며, 로딩 화면과 메인 메뉴에 표시됩니다. 업데이트할 때마다 이 숫자를 올립니다.

## 시작하기

**Windows에서 가장 빠른 방법:** `run-dev.bat` 을 더블클릭합니다. 처음 실행할 때 의존성을 설치하고, 개발 서버를 띄운 뒤 브라우저에서 게임을 엽니다. 파일을 저장하면 페이지가 자동으로 새로고침됩니다(CSS 변경은 새로고침 없이 바로 적용). 콘솔 창에서 Ctrl+C 를 누르면 종료됩니다.

터미널에서 직접 실행하려면:

```bash
npm install
npm run dev       # 개발 서버 (http://localhost:5173)
npm test          # 코어 단위 테스트
npm run build     # dist/ 에 정적 사이트 생성 — GitHub Pages, Vercel 등에 그대로 배포
```

> 입력은 `pointerrawupdate` 를 쓰지 않습니다. 이 이벤트는 하드웨어 샘플마다(게이밍 마우스에서 초당 1000–8000번) 메인 스레드 작업을 하나씩 만들어, 높은 폴링 레이트에서 렌더링이 밀려 렉이 생겼습니다.

## 개발 규칙

- 문서(README, `docs/`, 각 폴더의 README)는 **한국어**로 작성합니다.
- 게임 안의 모든 것은 **영어**로 작성합니다: 코드, 주석, 테스트 이름, 오류 메시지, UI 문구, 레벨 이름, 커밋 메시지.

### 게임 문구 (locale)

- 플레이어에게 보이는 문구(게임 제목 제외)는 코드에 직접 쓰지 않고 `src/locale/<언어>/<영역>.json`에 둡니다. 키는 `"영역.이름"` 형태의 평평한 키입니다.
- 언어 폴더(`en/`, `ko/`, `zh/`)마다 같은 영역 파일을 둡니다. 키의 접두어로 파일을 고릅니다.

  | 파일 | 접두어 |
  | --- | --- |
  | `common.json` | `common`, `difficulty`, `level`, `color`, `fill`, `zone`, `map` |
  | `menu.json` (메인 메뉴·화면) | `menu`, `main`, `customize`, `campaign`, `licenses`, `fontLicense`, `preload`, `music`, `audio` |
  | `options.json` | `options`, `device`, `debug` |
  | `play.json` (플레이·기록) | `play`, `records`, `stats`, `board` |
  | `achievements.json` | `ach` |
  | `account.json` | `auth`, `account`, `captcha`, `net` |
  | `editor.json` | `editor`, `ed`, `sd`, `template`, `pack`, `screen`, `placeholder`, `validate`, `mapError`, `mapWarn`, `share`, `zip`, `cp`, `panel` |
  | `theme.json` (Theme Editor) | `te`, `themePanel`, `themePack`, `themePreset`, `themeRegistry`, `fontPicker`, `pattern`, `fx` |

- 각 언어 폴더의 `index.ts`가 영역 파일을 하나로 합칩니다. 새 영역 파일을 만들면 모든 언어의 `index.ts`에 추가합니다.
- 영어(`src/locale/en/`)가 기준입니다. 웹 UI는 `t('key', { 변수 })`(`src/web/i18n.ts`)를 사용합니다. 코어에서는 `createTranslator(language)` 또는 `translate(language, key, vars)`로 언어를 명시합니다. 키 타입은 `src/locale/en/`에서 만들어지므로 없는 키를 쓰면 타입 오류가 납니다.
- `core`의 기본 API는 항상 영어이며 저장소를 읽지 않습니다. 번역된 검증 메시지·색 이름·프리셋이 필요한 웹 코드는 `web/localized/*` 어댑터를 사용합니다. Node/서버에서는 `createValidateApi(createTranslator('ko'))`처럼 독립된 API를 만들 수 있고, 다른 호출자의 언어에 영향을 주지 않습니다.
- `index.html`의 고정 문구는 `data-i18n="key"`(텍스트), `data-i18n-title` / `-aria-label` / `-placeholder`(속성)로 지정하고, 시작할 때 `applyI18n()`이 채웁니다.
- 다른 언어(`ko/`, `zh/` 등)에 없는 키는 영어로 표시됩니다. `zh/`(중국어 간체)는 아직 영어 문구로 채워져 있어, 값만 번역하면 됩니다. 새 언어는 `en/`과 같은 구성의 폴더를 추가하고 `LANGUAGES`(`src/core/i18n.ts`)에 등록합니다.
- 테마 팩의 문구(이름, 설명, 크레딧, 배지 캡션)는 `theme.json` 의 `i18n` 블록으로 언어별로 둡니다(`themes/README.md` 참고). 게임에는 `localizeThemeInfo()` 로 바뀐 `ThemeEntry.info` 가 쓰이고, Theme Editor 는 모든 언어가 담긴 `ThemeEntry.source` 를 편집합니다.
- 언어는 옵션 화면에서 바꿉니다(기본 영어). 선택은 localStorage에 저장되고, 시작할 때 만들어지는 문구가 많아 페이지를 새로고침해 적용합니다.

## 프로젝트 구조

전체 구조는 [ARCHITECTURE.md](ARCHITECTURE.md) 를 참고하세요.

```
src/
  core/            # DOM 의존성 없음
    types.ts       # schema/ 타입의 호환 진입점 (MapData v2)
    schema/
      common.ts    # 좌표·모양 공통 타입
      motion.ts    # 이동·회전 타입, 기본값, 검증
      object.ts    # MapObject와 순서가 보장된 개별 검증 조합
      map.ts       # MapData·MapPack, 맵 전체 검증·변환·경고
      theme.ts     # 표면 스타일 타입과 검증
      validation.ts # 번역기를 주입받는 공통 필드 판독기
      limits.ts    # 공통 제한값
      objects/     # 오브젝트·기능군별 타입, 기본값, 검증
    geometry.ts    # 선분/다각형 교차, 점-다각형 포함 판정, 사각형 헬퍼
    shape.ts       # 사각형 / 원 / 다각형 / 자유 곡선 → 그리기와 충돌에 함께 쓰는 하나의 다각형
    motion.ts      # 경로(직선, 곡선, 원), 반복, 이징, 회전 — 시간에 대한 닫힌 식
    object.ts      # 컴파일된 오브젝트와 시간 t 에서의 자세 (평행 이동 + 피벗 기준 회전)
    simulation.ts  # 고정 1 ms 틱 시뮬레이션과 리플레이
    account.ts     # 닉네임 / 이메일 / 비밀번호 규칙, Name#0042 형식
    theme.ts       # 테마 프리셋과 색상 헬퍼
    validate.ts    # 외부 맵 검증·경고·기본값 API의 호환 진입점
    share.ts       # 맵 <-> URL 공유 코드 (deflate-raw + base64url)
    levels.ts      # 내장 레벨
  web/
    input.ts       # 고정밀 입력 (pointermove + getCoalescedEvents), 폴링 레이트 측정
    play.ts        # 플레이 화면
    editor.ts      # 맵 에디터 입력·캔버스 조정
    editor-properties.ts # 속성 패널 DOM과 편집 콜백
    editor-storage.ts # 초안 및 편집기 표시 설정 저장
    render.ts      # 캔버스 렌더링
    preload.ts     # 로딩 화면 작업 (폰트, 계정, 공유 맵), 진행률과 타임아웃
    backdrop.ts    # 메뉴 배경: 자동 시연, 그리드, 테마 색상
    theme-panel.ts # 맵 테마 편집 (단색 / 그라데이션 / 패턴 채우기)
    auth/          # Supabase 가입 / 로그인, 이메일 인증, Turnstile CAPTCHA
    options.ts     # 플레이어 옵션 (커서 잔상, 타이머, 디버그 패널), 브라우저별 저장
    main.ts        # 화면 흐름: 로딩 → 메인 메뉴 → 플레이 / 옵션 / 맵 에디터
  assets/
    fonts/         # 웹 폰트
    images/        # 스프라이트, 배경, 아이콘
    sounds/        # 효과음과 음악
```

### 에셋 사용법

`src/assets/` 의 파일은 Vite 를 거칩니다. import 하면 빌드 시 해시가 붙은, 캐시에 안전한 URL 을 얻습니다.

```ts
import hitSound from '../assets/sounds/hit.mp3';
const audio = new Audio(hitSound);
```

```css
@font-face {
  font-family: 'GameFont';
  src: url('../assets/fonts/game-font.woff2') format('woff2');
  font-display: swap;
}
```

URL 이 고정되어야 하는 파일(예: `favicon.ico`, `robots.txt`)만 루트의 `public/` 폴더에 둡니다. 이 파일들은 `dist/` 로 그대로 복사됩니다.

## 맵 에디터 세부 사항

모든 오브젝트는 **모양**(사각형, 원, 다각형, 자유 곡선)에 **역할**과 선택적인 **동작**이 붙은 형태입니다.

- **Path** — 안전한 바닥. 맵에 길이 하나라도 있으면 길 바깥은 모두 벽으로 취급되어 위험하고 벽 스타일로 그려집니다. START 와 GOAL 은 항상 바닥으로 칩니다.
- **Wall** — 어디서든 위험합니다.
- **Moving** — 마커로 이루어진 경로를 따라갑니다: 직선, 곡선(마커를 지나는 부드러운 스플라인), 원(중심 마커 주위 공전). 옵션: 반복(loop / ping-pong / once), 속도, 부드러운 시작/끝(구간별 이징), 시작 지연(음수 = 중간부터 시작).
- **Rotating** — 드래그할 수 있는 피벗을 중심으로 회전합니다. 옵션: 속도, 한 주기당 각도(360 + loop = 연속 회전), 방향, 반복, 부드러운 시작/끝, 시작 지연. 회전 오브젝트에도 경로를 줄 수 있습니다.

게임 화면은 항상 **16:9** 입니다. 플레이 화면은 창 안에서 가장 큰 16:9 영역을 채우고(**F** 또는 Fullscreen 버튼으로 모니터 전체 사용), 도전 중에는 작은 HUD 가 숨겨집니다. 새 맵은 1920×1080 이며, 에디터에서 640×360 부터 1920×1080 까지 고를 수 있습니다. 다른 비율로 만든 맵도 가운데 정렬되어 열립니다.

에디터도 같은 전체 창 16:9 캔버스를 씁니다. **Tools**, **Level**(맵 정보, 레벨 설정, 테마, 공유), **Object**(선택한 오브젝트 옵션) 패널은 위에 떠 있으며, 제목 표시줄을 드래그해 옮기고, −/+ 버튼(또는 제목 표시줄 더블클릭)으로 접고, **H** 로 모두 숨길 수 있습니다. **▶ Test play**(T)는 상단 바에 있습니다. 패널 위치는 저장됩니다.

그리드는 60×60 입니다(1920×1080 맵은 32×18 칸). **Grid on top** 을 켜면 벽과 장애물 위에 그리드를 그립니다. 고정된 길과 벽은 하나의 바닥과 하나의 벽 덩어리로 그려져 이음새가 없고, 벽은 바닥에 부드러운 그림자를 드리웁니다.

편집 조작:

- 드래그로 사각형/원 그리기 (Shift = 정사각형/정원)
- 클릭으로 다각형 점 찍기 (자유 곡선: 클릭 = 곡선 점, Shift+클릭 = 뾰족한 모서리). 첫 점을 클릭하거나 Enter 로 닫기
- Select(V): 드래그로 이동, 핸들 드래그로 모양 변경, 꼭짓점 더블클릭으로 곡선 전환, 변 더블클릭으로 꼭짓점 추가, Alt+클릭으로 꼭짓점 삭제
- Ctrl+Z / Ctrl+Y 실행 취소/다시 실행, Ctrl+D 복제, Delete 삭제
- 예전 v1 형식으로 저장된 맵은 자동으로 변환됩니다.

### 맵 테마

맵마다 고유한 모양을 가질 수 있으며(Map Editor → **Theme**), 맵과 함께 저장되고 공유 링크에도 유지됩니다. 두 표면을 따로 꾸밉니다.

- **벽과 장애물** (고정, 이동, 회전 벽)
- **길**

각 표면에는 외곽선 색과 채우기가 있습니다: **단색**, **그라데이션**(각도가 있는 선형 또는 원형, 두 색), **패턴**(stripes, diagonal, dots, grid, checker 등; 색상, 배경, 타일 크기). 그라데이션과 패턴은 각 오브젝트의 로컬 좌표계에 배치되어 오브젝트와 함께 움직이고 회전합니다. 프리셋: Default, Neon, Lava, Forest, Candy, Mono.

## 1 ms 충돌 판정 원리

1. **입력**: 프레임마다 한 번 오는 `pointermove` 를 받고, `getCoalescedEvents()` 로 프레임 사이에 묶인 모든 원시 샘플을 복원합니다. 각 샘플의 `timeStamp` 를 그 샘플의 시간으로 씁니다.
2. **시뮬레이션**: 샘플 사이의 커서 경로를 선분으로 보고, 1 ms 경계마다 나눠 연속적으로 검사합니다.
   - 각 조각을 모든 오브젝트의 로컬 좌표계로 옮깁니다(이동과 회전을 되돌림). 그러면 움직이는 오브젝트는 정지한 다각형이 되고 커서 경로는 상대 운동 선분이 됩니다. 커서나 오브젝트가 아무리 빨라도 건너뛸 수 없습니다.
   - 조각을 따라 생기는 모든 경계 교차를 모으고, 그 사이 구간을 하나씩 검사합니다: 안전 = 길 위(또는 맵에 길이 없음)이고 어떤 벽 안에도 없음.
   - 마우스가 멈춰 있어도 렌더 루프가 시간을 진행시키므로, 장애물이 정지한 커서에 닿으면 실패로 칩니다(입력 지연을 고려한 40 ms 여유).
3. **결정론적**: 같은 입력 샘플은 항상 같은 결과를 냅니다. `getReplay()` / `runReplay()` 로 서버가 기록된 도전을 다시 검증할 수 있습니다.

실제 샘플 간격은 마우스 폴링 레이트로 제한됩니다(1000 Hz → 1 ms, 125 Hz → 8 ms). 플레이 영역 아래의 **input precision debug** 패널에서 확인할 수 있습니다.

## 부정행위 방지

- 도전은 START 영역 안을 클릭해야만 시작됩니다.
- 커서가 브라우저 창을 벗어나거나(`pointerout`), 창이 포커스를 잃거나(`blur`, 탭 전환), 터치/펜 포인터를 떼면 실패합니다.
- 맵은 제작자가 테스트 플레이로 클리어한 뒤에만 공유할 수 있으며, 수정하면 이 검증이 초기화됩니다.

## 로드맵

- [x] 연속 충돌 판정을 갖춘 1 ms 시뮬레이션
- [x] 고정밀 입력과 디버그 표시
- [x] 맵 에디터: 길/벽 × 사각형/원/다각형/자유 곡선 × 고정/이동/회전, START/GOAL, 마커 경로, 이징, 실행 취소/다시 실행, 자동 저장, JSON 가져오기/내보내기
- [x] URL 공유 (서버 불필요)
- [x] 계정: Supabase 가입 / 로그인, 이메일 인증, CAPTCHA, `Nickname#tag`
- [x] 레벨별 순위표
- [ ] 맵 탐색/검색/좋아요
