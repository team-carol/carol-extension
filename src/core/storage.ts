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

