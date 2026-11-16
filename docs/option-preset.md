# carol 게임 옵션 프리셋

[team-carol/carol](https://github.com/team-carol/carol)의 **옵션 프리셋 북마클릿**(`/option.js`)을
익스텐션 안으로 옮긴 기능. maimai DX NET의 게임 옵션(속도·판정 표시·SE 등)을 이름 붙여
carol에 저장해 두고, 나중에 한 번에 적용한다.

## 왜 다시 구현했나

원본은 `carol/option.js?code=TOKEN` 원격 스크립트를 페이지에 주입한다. 익스텐션이 원격
스크립트를 받아 실행하면 **웹스토어 정책(원격 코드 실행 금지)** 위반이라, 같은 동작을
`src/features/optionPreset.ts`로 번들에 넣었다. carol 쪽 클라이언트가 바뀌면 여기도 맞춰
다시 배포해야 한다.

(carol 프로필 동기화도 같은 이유로 원본 그대로 실행할 수 없어 제거했다. 기록 갱신은 carol
북마클릿으로 한다.)

## 동작 (원본 `OPTION_CLIENT_JS`와 같음)

1. maimai NET 우하단 **옵션 프리셋** 버튼 → 패널 열기
   - 옵션 페이지(`/home/userOption/updateUserOption/`)를 받아 폼을 읽음
   - carol `GET /api/option-presets`로 저장된 프리셋 목록을 받음
   - 읽은 옵션 페이지 HTML을 `POST /api/options/snapshot`으로 보냄 (carol 게임 설정 페이지의 "현재 설정")
2. **저장** — 지금 옵션 값(`values`)과 표시 이름(`labels`)을 `POST /api/option-presets`.
   옵션 페이지에서 열었으면 화면의 값(아직 DX NET에 저장 안 한 변경 포함)을 저장.
   같은 이름이면 덮어쓰기. 최대 10개(서버가 `limit` 응답).
3. **적용** — 변경 항목 미리보기 → 확인 → 옵션 페이지를 새로 받아(새 CSRF token)
   폼이 보내는 순서 그대로 모든 select + hidden을 `POST`. 프리셋 값이 그 계정의 select에
   없으면(미해금 등) 그 항목은 현재 값 유지. 적용 뒤 다시 읽어 실제로 바뀌었는지 확인.
   옵션 페이지에서 적용했으면 1.2초 뒤 새로고침.
4. **삭제** — 두 번 눌러 확인 → `POST /api/option-presets/delete {id}`.

## 원본과 다른 점

- maimai NET 요청은 `core/fetchQueue.ts`(동시성 1, 700ms) 경유. 에러/점검 페이지면 즉시 중단.
- 토큰 만료(403) 안내가 "디스코드 `/설정`" 대신 "익스텐션 팝업에서 다시 등록".
- 폼 셀렉터·옵션 페이지 경로는 `core/selectors.ts`의 `OPTION_PAGE`.

## 토큰

carol 동기화 토큰(`findUserBySyncToken`)과 같은 값. 팝업 → **게임 옵션 프리셋** 켜기 →
디스코드 `/북마클릿`으로 받은 링크나 북마클릿 주소를 붙여넣으면 `code=` 값만 추출해 저장한다
(`parseCarolToken`). 저장 위치는 `chrome.storage.local`(평문, 이 기기에만).

## 설정 키

- 토글: `optionPreset` (`storage.sync`, 기본 `false`)
- 토큰: `carolToken` (`storage.local`)
- `content.ts`가 토글에 따라 `initOptionPreset()` / `destroyOptionPreset()` 호출.
  끄면 버튼·패널을 지우고 진행 중인 요청을 중단한다.
