# CLAUDE.md

maimai NET(세가 maimai DX 공식 스코어 열람 사이트)에 한국어 번역과 부가 기능을 붙이는 크롬 익스텐션.
`exqt/donder-hiroba-plus`(태고의 달인 돈다 히로바용)와 같은 접근을 maimai NET에 적용함.

## 응답 규칙

- 한국어로 답할 것. 임/함체, 간결하게.
- 불필요한 서론/요약 금지. 코드와 근거 위주로.
- 확신 없는 DOM 구조나 URL은 추측해서 단정하지 말 것. `// TODO: 실제 페이지에서 확인` 주석을 남기고 넘어갈 것.

## 스택

- **WXT** (Vite 기반 MV3 프레임워크) + TypeScript
- UI는 **Preact** (번들 크기 때문에 React 대신)
- 스타일은 CSS Modules 또는 plain CSS. 주입되는 스타일은 전부 `.mmp-` 프리픽스로 네임스페이스 분리 (원본 사이트 CSS와 충돌 방지)
- 패키지 매니저: pnpm

```bash
pnpm dev          # 크롬 개발 모드 (HMR)
pnpm build        # 프로덕션 빌드 → .output/chrome-mv3
pnpm zip          # 웹스토어 업로드용
pnpm typecheck
```

## 대상 사이트

| 리전 | 도메인 |
|---|---|
| 일본판 | `https://maimaidx.jp/maimai-mobile/` |
| 국제판 | `https://maimaidx-eng.com/maimai-mobile/` |

`host_permissions`는 이 두 개만. 와일드카드 금지 (웹스토어 심사에서 불리함).

주요 경로는 `docs/site-map.md` 참고. **모든 경로/셀렉터는 실제 확인 전까지 추정임.**

## 디렉토리

```
src/
  entrypoints/
    content.ts            # maimai-net 주입 진입점
    popup/                # 설정 UI (번역 on/off, 기능 토글, 사전 내보내기)
  i18n/
    ko.json               # 일본어 원문 → 한국어 (플랫 딕셔너리)
    images.json           # 이미지 파일명 → 한국어
  core/
    normalize.ts          # 문자열 정규화 (전각공백, 연속공백, &nbsp;)
    translate.ts          # 텍스트 노드/속성 치환
    translateImage.ts     # 이미지 치환
    observer.ts           # MutationObserver 래퍼
    storage.ts            # chrome.storage.local 래퍼
    fetchQueue.ts         # 직렬 요청 큐 (아래 "세션" 참고)
  features/
    collector.ts          # 개발용 문자열 수집 모드
    rating.ts             # B35/B15 레이팅 계산
    export.ts             # 스코어 CSV/JSON 내보내기
    snapshot.ts           # 기록 스냅샷 + 성장 diff
  data/
    constants.json        # 곡별 보면 상수 (외부 DB에서 가져와 번들)
docs/
  site-map.md
  glossary.md             # 번역 용어 통일 규칙
```

## 핵심 설계

### 1. 번역은 "플랫 딕셔너리 + 완전 일치"

문법 파싱 없음. `ko.json`은 `{"일본어 원문": "한국어"}` 한 겹짜리 객체.

```json
{
  "称号を選ぶ": "칭호 선택",
  "スコアを見る": "스코어 보기"
}
```

규칙:

- **조회 전 반드시 `normalize()`** 를 통과시킬 것. 전각 스페이스(`\u3000`), `&nbsp;`, 연속 공백, 앞뒤 공백을 정리하지 않으면 키가 안 맞음.
- 기본은 **텍스트 노드 전체 일치**. 부분 치환이 꼭 필요하면 **키를 길이 내림차순으로 정렬**해서 순회할 것. (`スコア`가 `スコアを見る`보다 먼저 걸리면 깨짐)
- 텍스트 노드뿐 아니라 `placeholder` / `alt` / `title` / `input[value]` 속성도 처리.
- 치환한 노드는 `WeakSet`에 기록해서 재처리 방지. 안 하면 MutationObserver와 물려 무한 루프 가능.

### 2. 동적 렌더링 대응

`content_scripts.run_at`은 `document_start`. 사전을 먼저 로드해두고 `document_idle`에 1차 치환 → 이후 `MutationObserver`로 추가분 처리.

`observe(document.body, { childList: true, subtree: true, characterData: true })`.
콜백 안에서 DOM을 수정하므로 반드시 재진입 가드를 둘 것 (`isTranslating` 플래그 또는 `disconnect()` → 수정 → `observe()` 재등록).

### 3. 이미지 치환

maimai NET은 텍스트가 이미지로 박힌 곳이 많음. 단, **번역이 필요한 건 소수**임:

- 번역 대상 아님: 랭크(SSS+/SS/S…), FC·AP·싱크 아이콘, 난이도 배너(BASIC/EXPERT/MASTER) — 원래 영문/기호라 그대로 두는 게 맞음
- 번역 대상: 일본어가 박힌 메뉴 헤더 배너, 일부 버튼, 안내 이미지

전략 우선순위:

1. **텍스트 대체** (기본) — `img`를 `<span class="mmp-img-text">한국어</span>`로 `replaceWith`
2. **오버레이** — 배경 디자인이 중요할 때. `position:relative` 래퍼 안에 원본 이미지 + `position:absolute; inset:0` 라벨
3. **한국어 이미지 교체** — `img.src = chrome.runtime.getURL(...)`. 퀄리티는 최상이지만 사이트가 이미지 갱신하면 전부 다시 만들어야 함. 배너 2~3개 정도로 제한할 것

CSS 스프라이트(`background-position`으로 잘라 쓰는 것)는 개별 교체가 어려움. 발견하면 해당 엘리먼트의 `background-image` 통째 교체 또는 스킵.

매핑 키는 **URL 전체가 아니라 파일명**(`src.split('/').pop()`)으로. CDN 도메인이나 쿼리스트링이 바뀔 수 있음.

### 4. 세션 취급 — 가장 중요

maimai NET은 동시 요청 / 다중 탭에 매우 취약함. 병렬 `fetch`를 날리면 세션이 무효화되고 에러 페이지로 튕긴 뒤 재로그인해야 함.

**규칙:**

- 네트워크 요청은 전부 `core/fetchQueue.ts`를 경유. **동시성 1, 요청 간 최소 700ms 딜레이.**
- 백그라운드 자동 폴링 금지. 데이터 수집은 **사용자가 버튼을 눌렀을 때만** 시작.
- 수집 중 진행률 UI를 반드시 표시하고 중단 버튼 제공.
- 응답이 에러/로그인 페이지면 즉시 큐 전체 중단하고 사용자에게 알림.

이건 성능 최적화 이슈가 아니라 **동작 여부**의 문제임. "빠르게 하려고 Promise.all로 바꾸자"는 제안은 하지 말 것.

### 5. 개발용 수집 모드

번역 사전은 손으로 만들지 않음. 익스텐션에 수집 모드를 넣고, 개발자가 사이트를 평소처럼 돌아다니는 동안 미번역 일본어를 자동으로 쌓음.

- 일본어 판별: `/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/`
- 이미 `ko.json`에 있는 키는 스킵
- 각 항목에 `count`(등장 횟수)와 `seen`(등장 경로 목록)을 함께 기록 — `確認` 같은 애매한 단어의 문맥 판단에 필수
- 팝업의 "내보내기"로 `harvest.json` 다운로드. **등장 빈도 내림차순** 정렬 (자주 보이는 것부터 번역해야 체감이 빠름)
- 이미지도 같이 수집해서 `<img>` 갤러리 HTML로 내보내기 — 눈으로 봐야 뭐가 번역 대상인지 판단 가능
- 이 기능은 프로덕션 빌드에서 제외 (`import.meta.env.DEV` 가드)

## 부가 기능

번역은 진입점이고, 실제 가치는 여기서 나옴. 우선순위 순:

1. **기록 스냅샷** — `chrome.storage.local`에 주기 저장 후 성장 그래프/diff. maimai NET은 과거 기록을 안 보여주므로 이게 킬러 기능
2. **레이팅 계산기** — B35/B15 실시간 계산 + "이 곡을 X점까지 올리면 레이팅 +N" 시뮬레이션. 보면 상수는 `data/constants.json`에 번들
3. **스코어 필터/정렬** — 곡 목록에 "AP 미달성만", "레이팅 효율 순" 필터 주입
4. **CSV/JSON 내보내기**
5. **친구 스코어 비교 오버레이**

## 데이터 저장

- 사용자 스코어/스냅샷: `chrome.storage.local` (용량 큼)
- 설정: `chrome.storage.sync` (기기 간 동기화)
- 스냅샷은 날짜별 키로 분리 저장. 통짜 객체 하나에 몰아넣으면 쓰기마다 전체 직렬화라 느려짐
- 외부 서버로 데이터 전송 금지. 전부 로컬.
  - **예외: carol 프로필 동기화** (`features/carolButton.ts` + `carolSync.ts`). team-carol/carol
    (디스코드 봇)의 북마클릿을 익스텐션 버튼으로 옮긴 것. 사용자가 팝업에서 명시적으로 켜고
    토큰을 등록해야만 동작하며(기본 OFF), 켠 뒤 버튼을 눌렀을 때만 maimai NET HTML을
    carol 서버(`maimai.bitworkspace.kr`)로 전송함. 자동 전송·백그라운드 폴링 없음.
    토큰은 `storage.local`에만 저장(sync 클라우드로 안 보냄). carol 서버 URL은 곡 별명
    API와 같은 오리진이라 `host_permissions` 추가 없음. `docs/carol-sync.md` 참고.

## 경계

- 세가 ToS상 회색지대임. **사용자가 직접 연 페이지를 보조**하는 선을 지킬 것
- 자동 로그인, 백그라운드 크롤링, 계정 정보 수집, 자동 외부 전송 전부 금지
  - carol 프로필 동기화만 예외 — 옵트인 + 버튼 클릭 시에만 전송. "데이터 저장" 절 참고
- 웹스토어 심사 대비: 권한 최소화, 원격 코드 실행 없음, 프라이버시 정책 명시
  - carol 동기화는 원격 `/bookmarklet.js`를 주입하지 않고 수집 로직을 번들에 포함해 이 원칙을 지킴

## 번역 톤

`docs/glossary.md`의 용어표를 따를 것. 요약:

- 게임 고유명사는 커뮤니티 통용어 우선 (기계 번역식 직역 금지)
- 영문/약어로 굳어진 것(FC, AP, DX, SSS+, RATING)은 번역하지 않음
- UI 버튼은 명사형으로 짧게 (`설정하기` → `설정`)
- 존댓말/반말은 원문 톤 유지. maimai NET은 대체로 평서체

## 작업 시 주의

- `ko.json`은 **키를 알파벳/유니코드 순으로 정렬** 상태로 유지. diff 가독성 때문. 저장 전 정렬 스크립트를 돌릴 것
- 새 기능은 반드시 팝업에서 토글 가능하게. 하나가 사이트를 깨뜨려도 나머지가 살아야 함
- 각 feature는 `init()` / `destroy()` 인터페이스를 갖출 것. 토글 시 정리 없이 죽으면 observer가 누수됨
- 사이트 개편에 대비해 셀렉터는 `core/selectors.ts` 한 곳에 모을 것. 코드 곳곳에 흩뿌리지 말 것
