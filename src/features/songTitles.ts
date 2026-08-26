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

/**
 * 첫 글자 → 그 글자로 시작하는 곡명 목록(길이 내림차순).
 *
 * 접두 매칭을 곡 817개 전부와 대조하면 텍스트 노드마다 비용이 큼.
 * 첫 글자가 색인에 없으면 즉시 건너뛰게 해서 대부분의 노드를 O(1)로 걸러냄.
 * 길이 내림차순인 이유는 "최장 일치"가 필요하기 때문 —
 * `ココロ` ⊂ `ココロスキャンのうた` 처럼 다른 곡명의 접두사인 곡명이 13개 있어서,
 * 짧은 쪽이 먼저 걸리면 엉뚱하게 바뀜.
 */
const byFirstChar = new Map<string, string[]>()

function buildIndex(): void {
  byFirstChar.clear()
  for (const title of Object.keys(map)) {
    const c = title[0]
    if (!c) continue
    const list = byFirstChar.get(c)
    if (list) list.push(title)
    else byFirstChar.set(c, [title])
  }
  for (const list of byFirstChar.values()) list.sort((a, b) => b.length - a.length)
}

/**
 * 곡명 바로 뒤에 올 수 있는 문자.
 *
 * 칭호·네임플레이트 획득 조건은 `곡명[でらっくす]/MASTER/RANK A` 형태로,
 * 곡명이 항상 맨 앞에 오고 뒤에 보면 정보가 붙음.
 *
 * 구분자로 문자열을 자르는 대신 "곡명이 먼저 일치하는지"를 보고,
 * 그 다음 글자가 구분자인지로 확인함. 제목 자체에 `[`나 `/`가 들어간 곡이
 * 실제로 있어서(`セガサターン起動音[H.][Remix]`, `有明/Ariake`) 단순 분리는 깨짐.
 *
 * 이 검사가 없으면 `ココロ`가 `ココロの中で` 같은 무관한 문장에서도 걸림.
 */
const AFTER_TITLE = /[[［/／\s]/

/** 곡명으로 시작하면 [곡명, 나머지]. 아니면 null. 최장 일치. */
function matchTitlePrefix(text: string): [string, string] | null {
  const first = text[0]
  if (first == null) return null
  const list = byFirstChar.get(first)
  if (!list) return null

  for (const title of list) {
    // 전체 일치는 앞 단계에서 이미 처리함
    if (title.length >= text.length) continue
    if (!text.startsWith(title)) continue
    const next = text[title.length]
    if (next != null && AFTER_TITLE.test(next)) return [title, text.slice(title.length)]
  }
  return null
}

/** 되돌리기용 원본. destroy에서 복원함. */
const original = new Map<Text, string>()

function translateNode(t: Text): void {
  const raw = t.nodeValue
  if (raw == null) return

  const p = t.parentElement
  if (!p || SKIP_TAGS.has(p.tagName)) return

  const key = songKey(raw)
  if (!key) return

  // 1) 노드 전체가 곡명 — 곡 목록, 플레이 기록 등
  // 2) 곡명으로 시작 — 칭호·네임플레이트 획득 조건 (`곡명[でらっくす]/MASTER/RANK A`)
  // 둘 다 사전에 있는 곡명과 일치할 때만 바꾸므로, 사전에 없는 텍스트는 건드리지 않음
  let body: string
  const whole = map[key]
  if (whole != null) {
    body = whole
  } else {
    const hit = matchTitlePrefix(key)
    if (!hit) return
    body = map[hit[0]] + hit[1]
  }
  if (body === raw) return

  if (!original.has(t)) original.set(t, raw)

  // 앞뒤 공백/들여쓰기는 보존. 제목이 전각 스페이스뿐인 곡은 그 로직을 태우면 깨짐.
  if (raw.trim() === '') {
    t.nodeValue = body
    return
  }
  const lead = raw.match(/^\s*/)?.[0] ?? ''
  const trail = raw.match(/\s*$/)?.[0] ?? ''
  t.nodeValue = lead + body + trail
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
  buildIndex()

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
