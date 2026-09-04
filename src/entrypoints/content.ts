import { destroyTranslate, initTranslate } from '@/core/translate'
import {
  SETTING_CAROL_SYNC,
  SETTING_SONG_SEARCH,
  SETTING_SONG_TITLES,
  SETTING_UI_TRANSLATE,
  settings,
} from '@/core/storage'
import {
  GET_SONG_ALIASES,
  GET_SONG_TRANSLATIONS,
  type AliasMap,
  type SongMap,
} from '@/features/songData'
import { destroySongTitles, initSongTitles } from '@/features/songTitles'
import { destroySongSearch, initSongSearch } from '@/features/songSearch'
import { destroyCarolSync, initCarolSync } from '@/features/carolButton'

export default defineContentScript({
  matches: [
    'https://maimaidx.jp/maimai-mobile/*',
    'https://maimaidx-eng.com/maimai-mobile/*',
  ],
  runAt: 'document_start',
  main() {
    // document_start 주입이라 아직 body가 없음. DOM이 서면 1차 치환하고,
    // 이후 추가되는 노드는 각 기능 내부의 MutationObserver가 맡음.
    whenReady(() => void setup())
  },
})

/** 백그라운드에 데이터 요청. 실패해도 나머지 기능은 그대로 돌아가야 함. */
async function ask<T>(type: string): Promise<T | null> {
  try {
    return ((await browser.runtime.sendMessage({ type })) as T | undefined) ?? null
  } catch (err) {
    console.warn(`[mmp] ${type} 실패`, err)
    return null
  }
}

async function startTitles(): Promise<void> {
  const map = await ask<SongMap>(GET_SONG_TRANSLATIONS)
  if (map) initSongTitles(map)
}

async function startSearch(): Promise<void> {
  const aliases = await ask<AliasMap>(GET_SONG_ALIASES)
  if (aliases) initSongSearch(aliases)
}

/**
 * 기능 순서가 중요함:
 *  1. UI 번역 — 사전이 번들에 있어 즉시 가능
 *  2. 곡명 번역 — 백그라운드 데이터 필요
 *  3. 곡 검색 — 화면에 뜬 제목을 읽어 색인하므로 곡명 번역 뒤여야 함
 */
async function setup(): Promise<void> {
  const [uiOn, titlesOn, searchOn, carolOn] = await Promise.all([
    settings.get(SETTING_UI_TRANSLATE, true),
    settings.get(SETTING_SONG_TITLES, true),
    settings.get(SETTING_SONG_SEARCH, true),
    settings.get(SETTING_CAROL_SYNC, false), // 외부 전송이라 옵트인
  ])

  if (uiOn) initTranslate()
  if (titlesOn) await startTitles()
  if (searchOn) await startSearch()
  if (carolOn) initCarolSync()

  // 토글 감시는 여기서 한 번만 등록. setup 안에서 재귀적으로 걸면
  // 토글할 때마다 리스너가 쌓임.
  settings.watch<boolean>(SETTING_UI_TRANSLATE, (on) => {
    if (on) initTranslate()
    else destroyTranslate()
  })
  settings.watch<boolean>(SETTING_SONG_TITLES, (on) => {
    if (on) void startTitles()
    else destroySongTitles()
  })
  settings.watch<boolean>(SETTING_SONG_SEARCH, (on) => {
    if (on) void startSearch()
    else destroySongSearch()
  })
  settings.watch<boolean>(SETTING_CAROL_SYNC, (on) => {
    if (on) initCarolSync()
    else destroyCarolSync()
  })
}

/** DOM 준비되면 콜백. */
function whenReady(fn: () => void): void {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fn, { once: true })
  } else {
    fn()
  }
}
