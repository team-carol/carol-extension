/**
 * 곡 데이터의 공용 타입 · 메시지 상수 · 검색 정규화.
 * 백그라운드와 콘텐츠 스크립트가 함께 씀.
 */

export const GET_SONG_TRANSLATIONS = 'getSongTranslations'
export const GET_SONG_ALIASES = 'getSongAliases'

/** 원제 → 한국어 곡명. */
export type SongMap = Record<string, string>

/** 원제 → 별명 목록 (번역 포함). */
export type AliasMap = Record<string, string[]>

/**
 * 검색 질의/별명 정규화. carol의 `normalizeQuery`와 같은 규칙이어야
 * 디스코드 봇에서 되던 검색어가 여기서도 똑같이 먹힘.
 *
 *   소문자 + 공백 전부 제거
 *
 * 공백을 없애므로 "천년 살았어"와 "천년살았어"가 같이 걸림.
 */
export function normalizeQuery(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '')
}
