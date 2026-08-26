# maimai NET 구조 메모

> **주의: 이 문서의 경로/셀렉터는 전부 추정이며, 실제 사이트에서 확인 후 채워야 함.**
> 확인된 항목은 `✅`, 미확인은 `❓` 표시. 확인하면서 갱신할 것.

## 도메인

| 리전 | 베이스 |
|---|---|
| 일본판 | `https://maimaidx.jp/maimai-mobile/` |
| 국제판 | `https://maimaidx-eng.com/maimai-mobile/` |

두 리전은 DOM 구조가 대체로 같지만 **문구와 이미지 파일이 다를 수 있음**.
`ko.json`을 리전별로 나눌지, 공용으로 갈지는 수집 결과를 보고 결정.
리전 판별은 `location.hostname`으로.

## 주요 경로 (❓ 전부 미확인)

| 경로 | 내용 |
|---|---|
| `/home/` | 홈 |
| `/playerData/` | 플레이어 데이터 / 종합 성적 |
| `/record/` | 플레이 기록 |
| `/record/musicGenre/` | 장르별 곡 목록 |
| `/record/musicLevel/` | 레벨별 곡 목록 |
| `/record/musicDetail/` | 곡 상세 (스코어) |
| `/friend/` | 프렌드 |
| `/collection/` | 컬렉션 |
| `/home/userOption/` | 설정 |

## 페이지별 체크리스트

각 페이지를 방문하면서 아래를 기록:

- [ ] 홈
- [ ] 플레이어 데이터
- [ ] 플레이 기록 (목록)
- [ ] 플레이 기록 (상세)
- [ ] 곡 목록 — 장르별
- [ ] 곡 목록 — 레벨별
- [ ] 곡 상세
- [ ] 난이도별 성적 (BASIC ~ Re:MASTER 각각)
- [ ] 프렌드 목록 / 프렌드 상세 / 라이벌
- [ ] 컬렉션 (칭호/플레이트/프레임/아이콘/파트너)
- [ ] 설정
- [ ] 에러 페이지 (세션 만료 시 어떤 화면이 뜨는지 — 감지 로직에 필요)

## 셀렉터

확정된 것만 `src/core/selectors.ts`에 옮길 것. 여기는 초안 메모용.

### ✅ team-carol/carol 스크래퍼에서 확인된 것

출처: `team-carol/carol` (MIT, 같은 개발자) `src/scraper.ts`.
실제로 동작 중인 파서라 신뢰도가 높음. 다만 **우리가 직접 페이지에서 재확인한 것은 아님.**

| 셀렉터 | 용도 |
|---|---|
| `.music_name_block` | **곡 제목** |
| `.music_img` | 곡 자켓 |
| `.music_lv_block` | 레벨 |
| `.music_score_block` | 스코어 |
| `.music_kind_icon` | ST/DX 구분 아이콘 |
| `.playlog_diff` | 플레이 기록의 난이도 이미지 |
| `.playlog_level_icon` | 플레이 기록 레벨 아이콘 |
| `.playlog_achievement_txt` | 달성률 텍스트 |
| `.playlog_music_kind_icon` | 플레이 기록 ST/DX |
| `.playlog_rating_detail_block` | 레이팅 상세 |
| `.name_block` | 플레이어명 |
| `.rating_block` | 레이팅 |
| `.trophy_block` | 칭호 |
| `.basic_block` | 기본 정보 블록 |
| `.friend_comment_block` | 프렌드 코멘트 |
| `.see_through_block` | (레이아웃) |

난이도 이미지 파일명 → 난이도:
`diff_basic.png` / `diff_advanced.png` / `diff_expert.png` / `diff_master.png` / `diff_remaster.png`

자켓 이미지 경로: `/maimai-mobile/img/Music/`

### ⚠️ 곡 제목의 함정

carol 스크래퍼는 곡 제목을 이렇게 뽑음:

```ts
const rawTitle = block.find(".music_name_block").text();
const title = rawTitle.trim() || (/　/.test(rawTitle) ? "　" : "");
```

두 번째 줄이 핵심 — **제목이 전각 스페이스(`　`) 하나뿐인 곡이 실제로 존재함.**
`trim()`이나 우리 `normalize()`를 그대로 태우면 빈 문자열이 되어 사라짐.
곡명 치환에는 UI 문구용 `normalize()`를 그대로 쓰면 안 됨.

## 이미지 인벤토리

수집 모드의 이미지 갤러리 내보내기로 채울 것.

| 파일명 | 용도 | 번역 필요? | 처리 방법 |
|---|---|---|---|
| | | | |

번역 불필요로 분류되는 것들(참고):
랭크 아이콘, FC/AP/싱크 아이콘, 난이도 배너, 곡 자켓, 캐릭터 이미지, 장식 요소.

## 세션 관련 관찰 기록

동작을 실제로 확인해서 기록할 것. 추측 금지.

- 동시 요청 시 증상: ❓
- 다중 탭 열었을 때 증상: ❓
- 세션 만료 시 응답 (리다이렉트? 에러 페이지? 상태 코드?): ❓
- 안전한 요청 간격: ❓ (일단 700ms로 시작해서 조정)

이 항목들이 채워지기 전까지 대량 요청 기능은 구현하지 말 것.
