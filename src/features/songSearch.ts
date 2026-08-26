/**
 * 곡 목록에서 별명으로 검색.
 *
 * 곡 목록 페이지(레벨별/장르별, 레이팅 대상곡)에 입력창을 주입하고,
 * 이미 그려져 있는 곡 칸을 클라이언트에서 거름. 네트워크 요청은 하지 않음 —
 * maimai NET에 추가 요청을 보내면 세션이 날아갈 수 있음(CLAUDE.md 참고).
 *
 * 매칭은 carol과 같은 규칙(소문자 + 공백 제거 + 부분 일치)이라,
 * 디스코드 봇에서 쓰던 검색어가 여기서도 그대로 먹힘.
 */
import { SEL } from '@/core/selectors'
import { type AliasMap, normalizeQuery } from '@/features/songData'
import { songKey } from '@/features/songTitles'

/** 이 개수 이상 곡이 있어야 검색창을 넣음 (곡 상세 페이지 등에 안 뜨게) */
const MIN_SONGS = 3

const BOX_ID = 'mmp-song-search'
const HIDDEN = 'mmp-hidden'

interface Row {
  nodes: Element[]
  haystack: string
}

let root: HTMLElement | null = null
let rows: Row[] = []

/**
 * 곡 칸 하나를 숨길 때 같이 숨겨야 하는 노드들.
 *
 * 페이지마다 구조가 달라서 두 경우를 다룸:
 *  - 곡마다 전용 래퍼가 있으면 그 래퍼 하나만 숨기면 됨
 *  - 형제로 평평하게 늘어놓는 구조면 블록 + 붙어 있는 ST/DX 아이콘을 같이 숨김
 *    (아이콘만 남으면 목록에 부스러기가 떠다님)
 */
function rowNodes(block: Element): Element[] {
  // 이 블록 하나만 담고 있는 가장 바깥 조상까지 올라감
  let node: Element = block
  while (node.parentElement && node.parentElement !== document.body) {
    const parent = node.parentElement
    if (parent.querySelectorAll(SEL.songBlock).length !== 1) break
    node = parent
  }
  if (node !== block) return [node]

  const out: Element[] = [block]
  const prev = block.previousElementSibling
  if (prev?.matches(SEL.musicKindIcon)) out.unshift(prev)
  const next = block.nextElementSibling
  if (next?.matches(SEL.musicKindIcon)) out.push(next)
  return out
}

/** 곡 칸에 보이는 제목. 곡명 번역이 적용된 뒤면 한국어일 수 있음. */
function shownTitle(block: Element): string {
  const el = block.querySelector(SEL.musicNameBlock) ?? block
  return songKey(el.textContent ?? '')
}

/**
 * 검색 대상 문자열. 원제 + 모든 별명(번역 포함)을 이어붙임.
 * 화면에 한국어 제목이 떠 있어도 원제로 찾을 수 있어야 하므로,
 * 별명 어느 것으로든 원제를 역추적함.
 */
function buildHaystack(shown: string, aliases: AliasMap, byAlias: Map<string, string>): string {
  const title = byAlias.get(normalizeQuery(shown)) ?? shown
  const parts = [title, ...(aliases[title] ?? [])]
  // 화면에 보이는 문자열도 넣어둠 (DB에 없는 신곡은 이것만으로 검색됨)
  if (!parts.includes(shown)) parts.push(shown)
  return parts.map(normalizeQuery).join(' ')
}

function applyFilter(query: string): number {
  const q = normalizeQuery(query)
  let shown = 0
  for (const row of rows) {
    const hit = !q || row.haystack.includes(q)
    if (hit) shown++
    for (const n of row.nodes) n.classList.toggle(HIDDEN, !hit)
  }
  return shown
}

function injectStyle(): void {
  if (document.getElementById('mmp-search-style')) return
  const style = document.createElement('style')
  style.id = 'mmp-search-style'
  // 원본 사이트 CSS와 안 부딪히게 전부 .mmp- 프리픽스
  style.textContent = [
    `.${HIDDEN} { display: none !important; }`,
    `#${BOX_ID} { margin: 8px 10px; font-family: system-ui, sans-serif; }`,
    `#${BOX_ID} .mmp-row { display: flex; gap: 6px; align-items: center; }`,
    `#${BOX_ID} input { flex: 1; min-width: 0; box-sizing: border-box; padding: 8px 10px;`,
    `  font-size: 14px; border: 1px solid rgba(0,0,0,.25); border-radius: 8px;`,
    `  background: #fff; color: #000; }`,
    `#${BOX_ID} button { padding: 8px 10px; font-size: 13px; cursor: pointer;`,
    `  border: 1px solid rgba(0,0,0,.25); border-radius: 8px; background: #fff; color: #000; }`,
    `#${BOX_ID} .mmp-count { margin-top: 4px; font-size: 11px; color: #555; }`,
  ].join('\n')
  document.head.appendChild(style)
}

function buildBox(total: number): HTMLElement {
  const box = document.createElement('div')
  box.id = BOX_ID

  const row = document.createElement('div')
  row.className = 'mmp-row'

  const input = document.createElement('input')
  input.type = 'search'
  input.placeholder = '곡 검색 (별명·한국어·원제)'
  input.autocomplete = 'off'

  const clear = document.createElement('button')
  clear.type = 'button'
  clear.textContent = '초기화'

  const count = document.createElement('div')
  count.className = 'mmp-count'
  const setCount = (n: number): void => {
    count.textContent = n === total ? `${total}곡` : `${n} / ${total}곡`
  }
  setCount(total)

  input.addEventListener('input', () => setCount(applyFilter(input.value)))
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      input.value = ''
      setCount(applyFilter(''))
    }
  })
  clear.addEventListener('click', () => {
    input.value = ''
    setCount(applyFilter(''))
    input.focus()
  })

  row.append(input, clear)
  box.append(row, count)
  return box
}

export function initSongSearch(aliases: AliasMap): void {
  if (root) return

  const blocks = Array.from(document.querySelectorAll(SEL.songBlock))
  if (blocks.length < MIN_SONGS) return // 곡 목록 페이지가 아님

  // 별명 → 원제 역인덱스 (화면에 한국어 제목이 떠 있어도 원제를 찾기 위함)
  const byAlias = new Map<string, string>()
  for (const [title, list] of Object.entries(aliases)) {
    byAlias.set(normalizeQuery(title), title)
    for (const a of list) byAlias.set(normalizeQuery(a), title)
  }

  rows = blocks.map((block) => ({
    nodes: rowNodes(block),
    haystack: buildHaystack(shownTitle(block), aliases, byAlias),
  }))

  injectStyle()
  root = buildBox(rows.length)

  // 첫 곡 칸 바로 앞에 넣음
  const first = rows[0]?.nodes[0]
  first?.parentElement?.insertBefore(root, first)

  console.info(`[mmp] 곡 검색 ON (${rows.length}곡)`)
}

/** 토글 OFF 시 검색창 제거하고 숨긴 곡 전부 복원. */
export function destroySongSearch(): void {
  applyFilter('')
  root?.remove()
  root = null
  rows = []
}
