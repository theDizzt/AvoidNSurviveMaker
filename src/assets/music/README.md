# 메인 메뉴 음악

번들된 기본 음악은 `main-menu.flac` 입니다: **Or4nges** 의 **- Platform**.

- 출처: https://www.newgrounds.com/audio/listen/458694
- 아티스트: https://or4nges.newgrounds.com/
- 라이선스: https://creativecommons.org/licenses/by-nc-sa/3.0/
- 아티스트 설명에 Midimachine 의 *No Homers Club* 에서 영감을 받았다고 적혀 있습니다:
  https://www.newgrounds.com/audio/listen/455170
- 원본은 로컬의 `temp/workshop_map/458694_8_bit.mp3` 로 제공되었습니다.
- 변경 사항: 16비트 스테레오 FLAC 으로 디코딩, 원본 0.0315646–124.854초 구간으로 자름, 클릭음을 줄이기 위해 양 경계에 2 ms 페이드. 이 수정된 오디오는 같은 CC BY-NC-SA 3.0 라이선스로 배포되며, 저작자 표시·비영리·동일조건변경허락 조건이 적용됩니다.

원본은 제작자가 루프용으로 지정한 곡입니다. 자른 트랙은 디코딩된 Web Audio 버퍼로 반복되므로 미디어 요소 탐색이나 MP3 재인코딩 지연이 없습니다. 반복 사이에 페이드아웃하지 않습니다. 원본 MP3 는 수정하지 않았습니다.

번들 음악을 바꾸려면 이 폴더에 `main-menu.mp3`(또는 `.ogg`, `.wav`, `.m4a`, `.aac`, `.flac`) 하나만 두고, 옵션 화면과 이 파일의 저작자 표시를 갱신하세요.

플레이어는 Options → Main menu music 에서 로컬 음악으로 바꿀 수 있습니다. 교체한 음악은 이 브라우저의 IndexedDB 에 저장되며, Reset music 으로 번들 기본값으로 돌아갑니다. 메뉴 음악은 메인 메뉴, 챕터 목록, 설정 화면에서 재생됩니다. 테마 선택/플레이는 테마 자체의 `music` 에셋을 쓰고, 설정되지 않았으면 무음입니다. 맵 에디터(와 테스트 플레이)는 메뉴 음악을 재생하지만, 맵이 음악이 있는 챕터 프리셋을 쓰면 그 음악을 재생합니다. 재생은 사용자 상호 작용 이후 시작되고, 반복되며, 마스터/음악 볼륨을 따릅니다. 숨겨진 탭에서는 일시 정지됩니다.
