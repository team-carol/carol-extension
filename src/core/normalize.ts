/**
 * 문자열 정규화. 딕셔너리 조회 전 반드시 통과시킬 것.
 * 전각 스페이스(U+3000), &nbsp;(U+00A0), 연속 공백, 앞뒤 공백을 정리하지 않으면 키가 안 맞음.
 */
export function normalize(s: string): string {
  return s
    .replace(/　/g, ' ') // 전각 스페이스
    .replace(/ /g, ' ') // &nbsp;
    .replace(/\s+/g, ' ') // 연속 공백 → 단일 공백 (줄바꿈/탭 포함)
    .trim()
}
