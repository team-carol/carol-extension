# carol 프로필 동기화

[team-carol/carol](https://github.com/team-carol/carol)(maimai DX NET 프로필을 디스코드에서
보는 봇)은 프로필 갱신을 **북마클릿**으로 한다. 사용자가 maimai DX NET에 로그인된
브라우저에서 북마클릿을 실행하면, 그 북마클릿이 프로필·기록 페이지 HTML을 모아
carol 서버로 POST하고 서버가 파싱해 저장한다. SEGA 계정 정보는 서버로 가지 않는다.

이 익스텐션은 그 북마클릿을 **maimai DX NET 화면 안의 버튼**으로 옮긴 것이다.
북마클릿을 북마크바에 등록하거나 모바일 북마크에 붙여넣는 과정이 없어진다.

## 왜 북마클릿을 그대로 안 쓰고 다시 구현했나

원본 북마클릿은 한 줄짜리 로더다 — `carol/bookmarklet.js?code=TOKEN` 스크립트를
페이지에 주입하고, 실제 수집 코드는 그 원격 스크립트에 있다.

익스텐션이 원격 스크립트를 받아 실행하면 **웹스토어 정책(원격 코드 실행 금지)** 위반이고,
maimai NET의 CSP에 막힐 수도 있다. 그래서 수집 로직(`src/features/carolSync.ts`)을
번들에 포함했다. 콘텐츠 스크립트(격리 월드)에서 같은 오리진으로 `fetch`하므로
세션 쿠키는 그대로 쓰이고, 페이지 CSP와 무관하게 동작한다.

**단, 원본의 프리셋/추가 북마클릿(maishift 등)은 옮기지 않았다.** 그건 carol 서버가
`/bookmarklet.js`에 끼워 넣는 코드라 재현하려면 원격 코드 실행이 된다. maishift를
쓰던 사람은 그 북마클릿을 따로 실행하면 된다.

## 계약 (carol와 맞춰야 하는 부분)

`carolSync.ts`가 수집하는 페이지 목록과 `POST /sync` 페이로드 키는 carol
`src/web/bookmarklet.ts`의 `bookmarkletJs`와 **동일해야 한다**.

| 페이로드 키 | 출처 |
|---|---|
| `server` | `jp` (`maimaidx.jp`) / `intl` (`maimaidx-eng.com`) |
| `h` | `/maimai-mobile/home/` |
| `p` | `/maimai-mobile/playerData/` |
| `r` | `/maimai-mobile/record/` |
| `f` | `/maimai-mobile/friend/userFriendCode/` |
| `tb4`–`tb0` | `/maimai-mobile/record/musicGenre/search/?genre=99&diff=4…0` (Re:MASTER→BASIC) |
| `rt` | `/maimai-mobile/home/ratingTargetMusic/` (intl 전용, jp는 클리어 차트에서 산출) |
| `m` / `em` | `/maimai-mobile/map/` · `/maimai-mobile/map/eventMap/` |
| `a` | 홈 HTML의 아바타 이미지를 data URL로 |
| `dt` | 최근 기록 중 신기록(`.playlog_achievement_newrecord`)의 `playlogDetail` HTML `[{idx, html}]` |
| `js` | 항상 `[]` (원본의 "추가 북마클릿 실행 결과" 자리, carol는 빈 배열 허용) |

전송 형식: `Content-Type: application/json`, `CompressionStream`이 있으면 gzip
(`Content-Encoding: gzip`). 동시성 1, 요청 간 800ms, 페이지당 최대 3회 재시도.

carol 스크래퍼가 페이지를 늘리거나 키를 바꾸면 `carolSync.ts`도 맞춰야 한다.

## 토큰

carol 동기화 토큰은 `crypto.randomBytes(12)` (24 hex), 디스코드 유저당 1개, 고정값이다.

1. 디스코드에서 `/북마클릿` 실행 → "설치 가이드 열기" 링크를 받는다
   (`https://maimai.bitworkspace.kr/sync?code=<토큰>`).
2. 익스텐션 팝업 → **carol 프로필 동기화** 켜기 → 그 링크(또는 토큰만) 붙여넣고 저장.

토큰으로 할 수 있는 일은 그 유저의 carol 프로필 캐시 덮어쓰기와 `/settings` 접근이
전부다. SEGA 계정·결제·DM 접근은 없다. 회전 수단이 없으므로 유출되면 carol 쪽에서
DB를 손봐야 한다.

저장 위치는 `chrome.storage.local` (평문, 이 기기에만). 익스텐션에는 암호화 at-rest
저장소가 없다. sync 스토리지에 올리면 Google 클라우드까지 퍼지므로 local만 쓴다.

## 토글 / 정리

- 설정 키: `carolSync` (`storage.sync`, 기본 `false`)
- 토큰 키: `carolToken` (`storage.local`)
- `features/carolButton.ts`가 `init()` / `destroy()` 제공 — 토글 OFF 시 버튼·스타일 제거.
- 실제 동기화 오버레이는 `carolSync.ts`가 매번 새로 만들고 완료 후 자동으로 사라진다.

## 남은 일

- carol `README` / 개인정보처리방침에 "익스텐션 버튼을 통한 동기화" 경로 추가
- 웹스토어 리스팅의 데이터 사용 항목에 carol 전송 명시
