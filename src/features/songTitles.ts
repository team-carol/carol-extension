/**
 * 곡명 번역.
 *
 * 페이지 전체의 텍스트 노드를 훑어서, 노드 내용이 곡 제목과 "정확히" 일치할 때만 바꿈.
 *
 * 셀렉터로 범위를 좁히지 않는 이유:
 * maimai NET은 페이지마다 곡명을 다른 구조로 뿌림. 곡 목록은 `.music_name_block`,
 * 플레이 기록은 `.basic_block` 안의 텍스트 — 페이지를 새로 볼 때마다 셀렉터를 찾아
 * 붙이는 식이면 계속 빠지는 데가 생김.
 *
 * 대신 사전 자체가 필터 역할을 함. API의 번역 대상 817곡을 확인해보면:
 *   - UI 문구 사전(ko.json)과 겹치는 제목: 0개
 *   - 순수 ASCII 제목: 0개 (전부 일본어 문자를 포함)
 * 국제판 UI는 영어이므로 UI 문구가 곡 제목과 정확히 일치할 일이 없음.
 * 사전에 없는 텍스트는 절대 건드리지 않으므로 전역으로 훑어도 안전함.
 *
 * 데이터는 백그라운드가 API에서 받아 캐시한 것을 메시지로 받아옴.
 */
import { observe } from '@/core/observer'
import type { SongMap } from '@/features/songData'

/** 텍스트를 건드리면 안 되는 태그. */
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'])

/**
 * DOM 텍스트에서 곡 제목 키를 뽑음. carol 스크래퍼와 같은 규칙이어야 매칭됨:
 *
 *   rawTitle.trim() || (/　/.test(rawTitle) ? "　" : "")
 *
 * 두 번째 항이 핵심 — 제목이 전각 스페이스(U+3000) 하나뿐인 곡이 실제로 존재함.
 * UI용 normalize()를 태우면 이 곡이 빈 문자열이 되어 사라짐.
 */
export function songKey(raw: string): string {
  return raw.trim() || (/　/.test(raw) ? '　' : '')
}

let map: SongMap = {}
let stopObserver: (() => void) | null = null

/** 되돌리기용 원본. destroy에서 복원함. */
const original = new Map<Text, string>()

function translateNode(t: Text): void {
  const raw = t.nodeValue
  if (raw == null) return

  const p = t.parentElement
  if (!p || SKIP_TAGS.has(p.tagName)) return

  const key = songKey(raw)
  if (!key) return

  // 사전에 없으면 여기서 끝 — 이 조회 자체가 안전장치임
  const ko = map[key]
  if (ko == null || ko === raw) return

  if (!original.has(t)) original.set(t, raw)

  // 앞뒤 공백/들여쓰기는 보존. 제목이 전각 스페이스뿐인 곡은 그 로직을 태우면 깨짐.
  if (raw.trim() === '') {
    t.nodeValue = ko
    return
  }
  const lead = raw.match(/^\s*/)?.[0] ?? ''
  const trail = raw.match(/\s*$/)?.[0] ?? ''
  t.nodeValue = lead + ko + trail
}

function walk(node: Node): void {
  if (node.nodeType === Node.TEXT_NODE) {
    translateNode(node as Text)
    return
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return

  const walker = document.createTreeWalker(node as Element, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      const p = (n as Text).parentElement
      return !p || SKIP_TAGS.has(p.tagName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    },
  })
  let t: Node | null
  while ((t = walker.nextNode())) translateNode(t as Text)
}

function onMutations(records: MutationRecord[]): void {
  for (const r of records) {
    if (r.type === 'characterData') {
      translateNode(r.target as Text)
    } else {
      r.addedNodes.forEach(walk)
    }
  }
}

export function initSongTitles(songs: SongMap): void {
  if (stopObserver) return
  map = songs
  if (!Object.keys(map).length) return // 데이터 없으면 원제 그대로 두고 끝

  walk(document.body)
  stopObserver = observe(document.body, onMutations, {
    childList: true,
    subtree: true,
    characterData: true,
  })
  console.info(`[mmp] 곡명 번역 ON (${Object.keys(map).length}곡)`)
}

/** 토글 OFF 시 원제로 되돌리고 observer 정리. */
export function destroySongTitles(): void {
  stopObserver?.()
  stopObserver = null
  for (const [node, text] of original) node.nodeValue = text
  original.clear()
}
