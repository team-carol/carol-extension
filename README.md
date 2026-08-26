# 캐롤익스텐션

maimaiDX NET을 한국어로 보고, 곡을 별명으로 찾는 크롬 확장.

세가 공식과 무관한 **비공식** 확장입니다. 사용자가 직접 연 페이지를 보조할 뿐,
자동 로그인이나 백그라운드 수집은 하지 않습니다.

## 기능

**UI 문구 번역** — 메뉴·버튼·안내 문구를 한국어로 바꿉니다. 현재 사전 418개(패턴 72개 포함).

- 텍스트 노드 전체가 사전 항목과 일치할 때만 치환합니다.
- `Point Period&nbsp; 2026/08/01～2026/08/31`처럼 고정 라벨과 유동 값이 한 덩이로 붙어 있으면,
  `&nbsp;` 경계로 나눠 라벨만 바꿉니다. 날짜는 건드리지 않습니다.
- 구분자가 일반 공백이면 `"Play Count {0}": "플레이 횟수 {0}"` 형태의 패턴을 씁니다.
  `{0}`은 위치를 바꿀 수 있어 `"{0} of {1} songs": "{1}곡 중 {0}곡"`도 됩니다.

**곡명 한국어 표시** — 일본어 곡 제목 817곡을 한국어로 바꿉니다.

**곡 검색** — 곡 목록에 검색창을 넣습니다. 별명 3,486개(곡 1,464개)로 찾을 수 있고,
`저속`처럼 커뮤니티에서 쓰는 별명, 한국어 제목, 원제 모두 걸립니다.
공백은 무시하므로 `천년살았어`와 `천년 살았어`가 같이 검색됩니다.

곡명·별명 데이터는 [team-carol/carol](https://github.com/team-carol/carol)의 API에서 받아옵니다.

## 개발

Node 18+ / pnpm 필요.

```bash
pnpm install
pnpm dev        # 크롬 개발 모드 (HMR)
pnpm build      # 프로덕션 빌드 → .output/chrome-mv3
pnpm zip        # 웹스토어 업로드용
pnpm typecheck
```

`pnpm dev`로 크롬이 안 뜨면 `chrome://extensions`에서 개발자 모드를 켜고
"압축해제된 확장 프로그램 로드"로 `.output/chrome-mv3`를 선택하세요.

## 번역 사전 채우기

`src/i18n/ko.json`에 `{"원문": "한국어"}` 형태로 씁니다.

```json
{
  "Play Record": "플레이 기록",
  "Play Count {0}": "플레이 횟수 {0}"
}
```

- 키는 화면에 보이는 원문 그대로. 앞뒤/연속 공백은 자동 정규화되므로 신경 쓰지 않아도 됩니다.
- 값이 비어 있으면 무시되므로, 나중에 채울 항목을 키만 적어둬도 안전합니다.
- 용어는 [docs/glossary.md](docs/glossary.md)를 따릅니다.

저장 전에 검사하세요. JSON 후행 쉼표 같은 실수는 빌드를 통째로 깨뜨립니다.

```bash
pnpm dict          # 키 충돌·패턴 오류 검사
pnpm dict --write  # 코드포인트 순 정렬 + 공백 정리
```

## 구조

```
src/
  core/
    normalize.ts    문자열 정규화 (전각 공백, &nbsp;, 연속 공백)
    translate.ts    UI 문구 치환 엔진
    observer.ts     MutationObserver 래퍼
    selectors.ts    DOM 셀렉터 모음
    storage.ts      storage.local / sync 래퍼
  entrypoints/
    background.ts   곡 데이터 API 조회 + 캐시
    content.ts      maimai NET 주입 진입점
    popup/          설정 UI (Preact)
  features/
    songData.ts     곡 데이터 공용 타입 · 검색 정규화
    songTitles.ts   곡명 치환
    songSearch.ts   곡 목록 검색창
  i18n/ko.json      UI 문구 사전
```

기술 스택은 WXT(MV3) + TypeScript + Preact. 주입되는 스타일은 모두 `.mmp-` 프리픽스로
원본 사이트 CSS와 분리했습니다.

설계 배경과 주의사항은 [CLAUDE.md](CLAUDE.md), 사이트 구조 메모는
[docs/site-map.md](docs/site-map.md)에 있습니다.

## 대상 사이트

| 리전 | 도메인 |
|---|---|
| 국제판 | `https://maimaidx-eng.com/maimai-mobile/` |
| 일본판 | `https://maimaidx.jp/maimai-mobile/` |

주 대상은 국제판입니다. 곡 데이터 조회를 위해 `maimai.bitworkspace.kr`에도 접근하며,
사용자 정보는 전송하지 않습니다. 수집한 데이터는 전부 브라우저 안에만 저장됩니다.
