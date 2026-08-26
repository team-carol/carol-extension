/**
 * 플랫 딕셔너리 기반 텍스트 치환.
 *
 * ko.json은 { "원문": "한국어" } 한 겹짜리 객체. 조회 전 normalize()를 반드시
 * 통과시킴 — 전각 스페이스/&nbsp;/연속 공백이 정리되지 않으면 눈에 똑같아 보여도
 * 키가 안 맞음.
 *
 * 치환은 세 단계를 순서대로 시도하고, 먼저 걸리는 것을 씀:
 *
 *  1. 완전 일치   "Play Record" → "플레이 기록"
 *  2. 조각 치환   &nbsp;로 나뉜 부분만 각각 완전 일치로 치환.
 *                 "Point Period&nbsp; 2026/08/01～2026/08/31" 처럼 고정 라벨과
 *                 유동 값이 한 노드에 붙어 있는 경우. 사전에는 "Point Period"만
 *                 넣으면 되고, &nbsp;는 원본 그대로 보존됨(줄바꿈 동작 유지).
 *  3. 패턴 치환   "Point Period {0}" → "포인트 기간 {0}"
 *                 구분자가 &nbsp;가 아니라 일반 공백일 때 쓰는 수단.
 *                 {0}, {1}… 은 유동 부분을 그대로 옮겨 담고 위치도 바꿀 수 있음.
 *
 * 부분 치환을 무제한 허용하면 "Rating"이 "DX Rating" 안에서 걸리는 식으로 깨지므로,
 * 조각 치환은 &nbsp; 경계에서만, 패턴 치환은 노드 전체 앵커(^…$)로만 동작함.
 */
import ko from '@/i18n/ko.json'
import { normalize } from '@/core/normalize'
import { observe } from '@/core/observer'

/** 원문이 들어갈 수 있는 속성. */
const ATTRS = ['alt', 'title', 'placeholder', 'value'] as const

/** 텍스트를 건드리면 안 되는 태그. */
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'])

const NBSP = ' '
const PLACEHOLDER = /\{(\d+)\}/

interface Pattern {
  re: RegExp
  template: string
  /** 자리표시자를 뺀 고정부 길이. 긴(=구체적인) 패턴을 먼저 시도. */
  lit: number
  /** 정규식 그룹 순서 → 자리표시자 번호. "{1} A {0}" 같은 순서 바뀜 대응. */
  order: number[]
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const dict = new Map<string, string>()
const patterns: Pattern[] = []

function build(src: Record<string, string>): void {
  for (const [rawKey, value] of Object.entries(src)) {
    if (!value) continue // 값이 빈 항목(작성 중 스텁)은 무시
    const key = normalize(rawKey)
    if (!key) continue

    if (!PLACEHOLDER.test(key)) {
      // 사전에 적힌 것은 그대로 존중함. glossary의 "번역하지 않는 것"에 해당하면
      // 런타임에서 막지 않고 `pnpm dict`가 경고만 함 — 손으로 쓴 건 의도로 봄.
      dict.set(key, value)
      continue
    }

    const order: number[] = []
    const rx = escapeRe(key).replace(/\\\{(\d+)\\\}/g, (_m, n: string) => {
      order.push(Number(n))
      return '([\\s\\S]+?)'
    })
    // 값에 키에 없는 자리표시자가 있으면 옮겨 담을 게 없음 → 건너뜀
    const used = [...value.matchAll(/\{(\d+)\}/g)].map((m) => Number(m[1]))
    if (used.some((n) => !order.includes(n))) continue

    patterns.push({
      re: new RegExp(`^${rx}$`),
      template: value,
      lit: key.replace(/\{\d+\}/g, '').length,
      order,
    })
  }
  patterns.sort((a, b) => b.lit - a.lit)
}

build(ko as Record<string, string>)

/**
 * 우리가 마지막으로 써넣은 값. 자기 변경이 MutationObserver로 되돌아왔을 때
 * 다시 처리해서 무한 루프가 도는 것을 막음.
 */
const wroteText = new WeakMap<Node, string>()
const wroteAttr = new WeakMap<Element, Record<string, string>>()

/** 되돌리기용 원문. 토글을 끄면 원래 문구로 복원함. */
const originalText = new Map<Text, string>()
const originalAttr = new Map<Element, Record<string, string>>()

let stopObserver: (() => void) | null = null

/** 앞뒤 공백은 살려둠. 인라인 요소 사이 간격이 사라지면 레이아웃이 깨짐. */
function reclothe(raw: string, body: string): string {
  const lead = raw.match(/^\s*/)?.[0] ?? ''
  const trail = raw.match(/\s*$/)?.[0] ?? ''
  return lead + body + trail
}

/** 1단계: 완전 일치. */
function exact(raw: string): string | null {
  if (!raw.trim()) return null
  const hit = dict.get(normalize(raw))
  if (hit == null) return null
  const next = reclothe(raw, hit)
  return next === raw ? null : next
}

/** 2단계: &nbsp; 경계로 잘라 조각별 완전 일치. 구분자는 원본 그대로 둠. */
function segments(raw: string): string | null {
  if (!raw.includes(NBSP)) return null
  let changed = false
  const out = raw.split(NBSP).map((part) => {
    const hit = exact(part)
    if (hit == null) return part
    changed = true
    return hit
  })
  return changed ? out.join(NBSP) : null
}

/** 3단계: {0} 패턴. 노드 전체에 앵커되므로 부분 오매칭이 안 생김. */
function pattern(raw: string): string | null {
  const norm = normalize(raw)
  if (!norm) return null
  for (const p of patterns) {
    const m = p.re.exec(norm)
    if (!m) continue
    const body = p.template.replace(/\{(\d+)\}/g, (_s, n: string) => {
      const g = p.order.indexOf(Number(n))
      return g < 0 ? '' : (m[g + 1] ?? '')
    })
    const next = reclothe(raw, body)
    return next === raw ? null : next
  }
  return null
}

/** 원문 한 덩이를 번역. 못 바꾸면 null. */
function translateValue(raw: string): string | null {
  return exact(raw) ?? segments(raw) ?? pattern(raw)
}

function translateText(t: Text): void {
  const raw = t.nodeValue
  if (raw == null || !raw.trim()) return

  const p = t.parentElement
  if (!p || SKIP_TAGS.has(p.tagName)) return
  if (wroteText.get(t) === raw) return // 우리가 쓴 그대로면 재처리 불필요

  const next = translateValue(raw)
  if (next == null) return

  if (!originalText.has(t)) originalText.set(t, raw)
  t.nodeValue = next
  wroteText.set(t, next)
}

function translateAttrs(el: Element): void {
  for (const name of ATTRS) {
    const raw = el.getAttribute(name)
    if (raw == null || !raw.trim()) continue
    if (wroteAttr.get(el)?.[name] === raw) continue

    const next = translateValue(raw)
    if (next == null) continue

    const orig = originalAttr.get(el) ?? {}
    orig[name] ??= raw
    originalAttr.set(el, orig)

    el.setAttribute(name, next)
    const rec = wroteAttr.get(el) ?? {}
    rec[name] = next
    wroteAttr.set(el, rec)
  }
}

/** 노드(및 하위 트리) 전체 치환. */
function walk(node: Node): void {
  if (node.nodeType === Node.TEXT_NODE) {
    translateText(node as Text)
    return
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return
  const root = node as Element

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      const p = (n as Text).parentElement
      return !p || SKIP_TAGS.has(p.tagName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    },
  })
  let t: Node | null
  while ((t = walker.nextNode())) translateText(t as Text)

  translateAttrs(root)
  root.querySelectorAll('[alt],[title],[placeholder],[value]').forEach(translateAttrs)
}

function onMutations(records: MutationRecord[]): void {
  for (const r of records) {
    if (r.type === 'characterData') {
      translateText(r.target as Text)
    } else if (r.type === 'attributes') {
      translateAttrs(r.target as Element)
    } else {
      r.addedNodes.forEach(walk)
    }
  }
}

/** 사전에 등록된 항목 수 (완전 일치, 패턴). 팝업/디버깅용. */
export function dictSize(): { exact: number; pattern: number } {
  return { exact: dict.size, pattern: patterns.length }
}

export function initTranslate(): void {
  if (stopObserver) return
  walk(document.body)
  stopObserver = observe(document.body, onMutations, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: [...ATTRS],
  })
  console.info(`[mmp] 번역 ON (완전일치 ${dict.size}, 패턴 ${patterns.length})`)
}

/** 토글 OFF 시 원문으로 되돌리고 observer 정리. */
export function destroyTranslate(): void {
  stopObserver?.()
  stopObserver = null
  for (const [node, text] of originalText) node.nodeValue = text
  originalText.clear()
  for (const [el, attrs] of originalAttr) {
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value)
  }
  originalAttr.clear()
}
