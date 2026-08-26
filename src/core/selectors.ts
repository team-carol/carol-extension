/**
 * 모든 DOM 셀렉터는 여기 한 곳에 모을 것. (사이트 개편 대비)
 * 코드 곳곳에 문자열 셀렉터를 흩뿌리지 말 것.
 *
 * 지금은 대부분 미확인. 실제 페이지 확인 후 채울 것.
 * 확인 전까지 추정 셀렉터는 넣지 않는다 — 수집기는 셀렉터 없이 전체 스캔으로 동작.
 */
/**
 * team-carol/carol 스크래퍼(`src/scraper.ts`)에서 확인된 셀렉터.
 * 실제 운영 중인 파서가 쓰는 것임. 나머지는 docs/site-map.md 참고.
 *
 * 곡 제목이 담기는 DOM은 페이지에 따라 두 가지 형태임:
 *
 *  A. 곡 목록 계열 (레벨별/장르별 목록, 레이팅 대상곡)
 *     → `.music_name_block` 안에 제목만 들어 있음
 *
 *  B. 플레이 기록 계열 (최근 기록, 기록 히스토리, 상위 곡)
 *     → `.basic_block` 안에서 `.w_80`(레벨 아이콘 등)을 뺀 나머지 텍스트가 제목.
 *        `.basic_block`은 홈 화면에서도 쓰이므로 반드시 기록 칸으로 좁혀야 함.
 */
export const SEL = {
  /** A: 곡 목록 계열의 곡 제목 */
  musicNameBlock: '.music_name_block',
  /** B: 플레이 기록 한 칸 */
  playlogRecord: '.p_10.t_l.f_0.v_b',
  /** B: 기록 칸 안에서 제목이 들어 있는 블록 */
  playlogTitleBlock: '.basic_block',
  /** B: 제목 블록 안에서 제목이 '아닌' 부분 (레벨 아이콘 등) */
  playlogTitleExclude: '.w_80',
  /**
   * 곡 목록의 곡 한 칸. class가 `music_<난이도>_score_back` 형태라 부분 일치로 잡음.
   * (carol `parseMusicScore`가 쓰는 것과 동일)
   */
  songBlock: "[class*='music_'][class*='_score_back']",
  /** 곡 블록에 딸린 ST/DX 아이콘. 블록 안에 있기도 하고 형제로 있기도 함. */
  musicKindIcon: '.music_kind_icon',
} as const

/** location.hostname 기준 리전 판별. */
export function region(): 'jp' | 'intl' | 'unknown' {
  const h = location.hostname
  if (h === 'maimaidx.jp') return 'jp'
  if (h === 'maimaidx-eng.com') return 'intl'
  return 'unknown'
}
