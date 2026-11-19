# 편집기와 번역 경계

`core/editor-document.ts`는 맵, 선택, 복사한 오브젝트, 검증 상태, 실행 취소·다시 실행 히스토리를 소유합니다. `execute(command)`는 편집 하나를 히스토리 하나로 묶습니다. 포인터 드래그는 시작 시 `snapshot()`을 기록하고 움직이는 동안 맵을 갱신하여 기존의 한 번에 실행 취소 동작을 유지합니다. 저장소, DOM, 타이머, 캔버스는 사용하지 않습니다.

`core/editor-commands.ts`는 정렬, 분배, 순서 변경, 회전·뒤집기, 그룹, 삭제, 복제, 도형 병합을 처리합니다. 명령은 `EditorDocument`를 받아 상태만 변경하며 병합 실패 같은 결과는 데이터로 반환합니다. 브라우저 없이 문서와 명령을 직접 조합할 수 있습니다.

`web/editor.ts`는 포인터·키보드 입력, 화면 좌표 변환, 캔버스 그리기와 화면 갱신을 조정합니다. `changed()`는 문서의 검증 결과를 받아 저장과 화면 갱신을 호출하는 조정자입니다. 편집 규칙과 검증을 사용하기 위해 이 클래스를 생성할 필요는 없습니다.

- `web/editor-properties.ts`: 속성 패널 DOM 생성. `EditorPropertiesHost`를 통해 현재 문서와 편집·선택 콜백만 받습니다. `Editor` 클래스를 import하지 않습니다.
- `web/editor-storage.ts`: 초안 직렬화/복원, 표시 설정, localStorage 예외 처리. 기존 저장 키와 형식을 유지합니다.
- `web/editor-shared.ts`: 도구 표시 이름, 단축키, UI 타입 등 편집기 표시 정의.

번역 코어 `core/i18n.ts`는 `translate(language, key, vars)`와 `createTranslator(language)`를 제공합니다. 전역 언어 설정을 변경하지 않으며 저장소를 읽지 않습니다. 기본 코어 함수는 영어를 사용합니다. 번역이 필요한 코어 API는 `createValidateApi(translator)` 같은 팩토리로 생성할 수 있어 영어와 한국어 검증기를 동시에 사용할 수 있습니다. 언어에 따라 달라지는 UI 상수도 각 API 인스턴스에서 생성합니다.

`web/i18n.ts`만 브라우저의 언어 설정을 읽고 저장합니다. `web/localized/*`는 이 번역기를 코어 API에 연결하는 어댑터입니다. 기존의 언어 변경 후 새로고침 방식은 유지합니다. ZIP 워커는 메시지로 언어를 전달받아 독립된 번역기를 만듭니다.

회귀 테스트 소스는 `editor-document.test.ts`, `i18n.test.ts`, `record-identity.test.ts`에 추가했습니다. 테스트 실행은 요청에 따라 사용자에게 맡깁니다. 수동 확인 시 실행 취소·다시 실행, 드래그와 연속 방향키 이동, 그룹/복제/병합, 속성 변경, 초안 재로딩, 한국어 표시, ID 없는 맵 가져오기를 확인합니다.
