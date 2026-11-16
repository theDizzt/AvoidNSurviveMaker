# Avoid N Survive Maker

마우스 피하기 미로 게임 + 맵 에디터. 벽·움직이는 장애물·맵 밖에 닿지 않고 START에서 GOAL까지 가면 클리어.

## 실행

```bash
npm install
npm run dev       # 개발 서버 (http://localhost:5173)
npm test          # core 단위 테스트
npm run build     # dist/ 에 정적 사이트 생성 → GitHub Pages, Vercel 등에 그대로 배포
```

> `pointerrawupdate`는 보안 컨텍스트(HTTPS 또는 localhost)에서만 동작합니다. 배포 시 HTTPS 필수.

## 구조

```
src/
  core/            # DOM 의존성 없음 → 추후 서버(리플레이 검증)에서도 그대로 사용
    types.ts       # 맵 스키마 (MapData v1)
    geometry.ts    # 선분-사각형 교차 (Liang–Barsky)
    mover.ts       # 움직이는 장애물 위치 = 시간의 닫힌 식 (결정적)
    simulation.ts  # 1ms 고정 틱 시뮬레이션, 리플레이
    validate.ts    # 외부 맵 검증 / 경고
    share.ts       # 맵 ↔ URL 공유 코드 (deflate-raw + base64url)
    levels.ts      # 기본 맵
  web/
    input.ts       # 고정밀 입력 (pointerrawupdate + getCoalescedEvents), 폴링 레이트 측정
    play.ts        # 플레이 화면
    editor.ts      # 맵 에디터
    render.ts      # Canvas 렌더링
    main.ts        # 화면 전환, 공유 링크 로딩
```

## 1ms 판정 방식

1. **입력**: `pointerrawupdate`(지원 시) 또는 `pointermove`에서 `getCoalescedEvents()`로 프레임 사이에 묶인 원본 샘플을 전부 받음. 각 샘플의 `timeStamp` 사용.
2. **시뮬레이션**: 샘플 사이 커서 경로를 선분으로 보고 1ms 경계마다 잘라서 검사.
   - 벽: 선분 교차로 정확히 계산 → 아무리 빨리 움직여도 통과 불가
   - 움직이는 장애물: 장애물 기준 상대 운동 선분으로 검사 → 서로 엇갈려 지나가는 충돌도 감지
   - 마우스가 멈춰 있어도 렌더 루프가 시간을 진행시켜 장애물에 부딪히면 실패 (입력 지연 대비 40ms 여유)
3. **결정적**: 같은 입력 샘플 → 항상 같은 결과. `getReplay()` / `runReplay()`로 서버에서 기록을 재검증할 수 있음.

실제 샘플 간격은 마우스 폴링 레이트가 상한입니다 (1000Hz → 1ms, 125Hz → 8ms). 플레이 화면 아래 **입력 정밀도 디버그**에서 확인할 수 있어요.

## 치트 방지

- START 영역을 클릭해야 시작
- 커서가 창 밖으로 나가거나(`pointerout`), 포커스를 잃거나(`blur`, 탭 전환), 터치가 떨어지면 실패
- 공유하려면 제작자가 테스트 플레이로 먼저 클리어해야 함

## 로드맵

- [x] 1ms 시뮬레이션 + 연속 충돌 판정
- [x] 고정밀 입력 + 디버그 표시
- [x] 맵 에디터 (벽/장애물/경로/START/GOAL, 되돌리기, 자동 저장, JSON 입출력)
- [x] URL 공유 (서버 없음)
- [ ] 2단계: Supabase 연동 — 맵 목록/검색/좋아요, 랭킹, 서버 측 리플레이 검증
