/**
 * chrome.storage.local 얇은 래퍼.
 * 사용자 스코어/스냅샷/수집 데이터처럼 용량 큰 것은 전부 local.
 * 설정(기기 간 동기화)은 별도로 sync 래퍼를 두게 되면 여기 확장.
 */
// `browser`는 WXT가 전역으로 자동 임포트(webextension-polyfill 기반, 타입 포함).
export const storage = {
  async get<T>(key: string): Promise<T | undefined> {
    const r = await browser.storage.local.get(key)
    return r[key] as T | undefined
  },
  async set(key: string, value: unknown): Promise<void> {
    await browser.storage.local.set({ [key]: value })
  },
  async remove(key: string): Promise<void> {
    await browser.storage.local.remove(key)
  },
}

/** 설정용. 기기 간 동기화되고 용량이 작음. */
export const settings = {
  async get<T>(key: string, fallback: T): Promise<T> {
    const r = await browser.storage.sync.get(key)
    return (r[key] as T | undefined) ?? fallback
  },
  async set(key: string, value: unknown): Promise<void> {
    await browser.storage.sync.set({ [key]: value })
  },
  /** 값이 바뀔 때 호출. 반환 함수로 해제. */
  watch<T>(key: string, cb: (value: T) => void): () => void {
    const handler = (
      changes: Record<string, { newValue?: unknown }>,
      area: string,
    ): void => {
      if (area !== 'sync' || !(key in changes)) return
      cb(changes[key]?.newValue as T)
    }
    browser.storage.onChanged.addListener(handler)
    return () => browser.storage.onChanged.removeListener(handler)
  },
}

export const SETTING_UI_TRANSLATE = 'uiTranslate'
export const SETTING_SONG_TITLES = 'songTitles'
export const SETTING_SONG_SEARCH = 'songSearch'

/** carol 동기화 버튼 표시 여부. 기본 OFF — 외부 서버로 데이터를 보내는 기능이라 옵트인. */
export const SETTING_CAROL_SYNC = 'carolSync'

/**
 * carol 동기화 토큰(`/북마클릿` 으로 발급되는 bearer 토큰).
 *
 * 확장에는 암호화 at-rest 저장소가 없음. sync에 올리면 Google 클라우드까지 퍼지므로,
 * 이 기기 로컬(storage.local, 평문)에만 둔다. 값은 낮고(그 유저 carol 프로필 캐시
 * 덮어쓰기 + 설정 접근이 전부), 회전 수단이 없으니 유출 시 carol쪽 조치가 필요.
 */
const CAROL_TOKEN_KEY = 'carolToken'

export const carolToken = {
  async get(): Promise<string> {
    return (await storage.get<string>(CAROL_TOKEN_KEY)) ?? ''
  },
  async set(value: string): Promise<void> {
    if (value) await storage.set(CAROL_TOKEN_KEY, value)
    else await storage.remove(CAROL_TOKEN_KEY)
  },
}

/**
 * 사용자가 붙여넣은 값에서 토큰만 추출.
 * 가이드 링크 전체(`https://…/sync?code=abc`)를 붙여넣어도, 토큰만 붙여넣어도 됨.
 */
export function parseCarolToken(input: string): string {
  const s = input.trim()
  if (!s) return ''
  const m = s.match(/[?&]code=([^&\s]+)/)
  if (m?.[1]) return decodeURIComponent(m[1])
  // URL은 아니지만 슬래시가 들어 있으면 잘못 붙여넣은 것으로 보고 마지막 조각을 시도
  if (s.includes('/')) return s.split('/').pop()?.trim() ?? ''
  return s
}

