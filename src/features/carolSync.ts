/**
 * carol bot 프로필 동기화.
 *
 * team-carol/carol 의 "캐롤봇 추가 북마클릿"(`src/web/bookmarklet.ts` 의 `bookmarkletJs`)이
 * 하던 일을 익스텐션 안으로 옮긴 것. 원본은 원격 스크립트(`/bookmarklet.js?code=…`)를
 * 주입하는 방식이라 웹스토어 정책(원격 코드 실행 금지)에 걸림 → 수집 로직을 번들에 포함.
 *
 * 프로필·레이팅·전체 기록은 carol 이 maishift 에서 받는다. 이 동기화는 maishift 에 없는 것만
 * 보낸다: 친구 코드, 최근 플레이, 지방, 게임 설정, 서클, 단위·클래스 이미지.
 *
 * 수집 페이지와 POST 페이로드 키(`server,r,f,dt,m,em,uo,ci,cm,cr,ri`)는 carol `/sync` 와
 * **같아야** 함. carol 이 바꾸면 여기도 맞출 것 (`docs/carol-sync.md`).
 *
 * 원본과 다른 점: 원본은 페이지를 3개씩 병렬로 받지만 여기선 `FetchQueue`(동시성 1, 700ms)로
 * 순차 수집한다 — CLAUDE.md "세션 취급". 에러 페이지면 재시도하지 않고 즉시 중단.
 */
import { color, withAlpha } from '@team-carol/design-system'
import { region } from '@/core/selectors'
import { CRL_SCOPE, injectTokens } from '@/core/theme'
import { carolRankImagesSent, carolSyncState } from '@/core/storage'
import { FetchQueue, QueueAbortedError, sleep } from '@/core/fetchQueue'

const CAROL_ORIGIN = 'https://maimai.team-carol.com'

const OV_ID = 'mmp-carol-ov'
const STYLE_ID = 'mmp-carol-style'

const MAX_ATTEMPTS = 3
const SYNC_UPLOAD_TIMEOUT = 60_000
/** 원본 북마클릿과 같음: 단위·클래스 이미지는 한 번에 최대 4개 */
const MAX_RANK_IMAGES = 4

type Region = 'jp' | 'intl'

/** carol `/sync` 페이로드. 키 이름을 바꾸지 말 것. */
interface SyncPayload {
  server: Region
  r: string
  f: string
  dt: Array<{ idx: string; html: string }>
  m: string
  em: string
  uo: string
  ci: string
  cm: string
  cr: string
  ri: Array<{ url: string; data: string }>
}

type PageKey = 'r' | 'f' | 'm' | 'em' | 'uo' | 'ci' | 'cm' | 'cr'

interface CorePage {
  key: PageKey
  /** UI 행 id (원본 북마클릿과 같은 id) */
  row: string
  path: string
  /** 실패해도 전송은 진행 */
  optional: boolean
}

/** 수집 순서 = 원본 `collectCore`의 `_pl` 순서. */
const PAGES: CorePage[] = [
  { key: 'r', row: 'rc', path: '/maimai-mobile/record/', optional: false },
  { key: 'f', row: 'fc', path: '/maimai-mobile/friend/userFriendCode/', optional: false },
  { key: 'm', row: 'mp', path: '/maimai-mobile/map/', optional: true },
  { key: 'em', row: 'em', path: '/maimai-mobile/map/eventMap/', optional: true },
  { key: 'uo', row: 'uo', path: '/maimai-mobile/home/userOption/updateUserOption/', optional: true },
  { key: 'ci', row: 'ci', path: '/maimai-mobile/circle/', optional: true },
  { key: 'cm', row: 'cm', path: '/maimai-mobile/circle/circleMember/', optional: true },
  { key: 'cr', row: 'cr', path: '/maimai-mobile/circle/circleRanking/', optional: true },
]

const HOME_PATH = '/maimai-mobile/home/'
const RANK_IMG_RX = /src="(https:[^"]*\/img\/(?:course\/course_rank_|class\/class_rank_s_)[^"]*[.]png)"/g

let running = false
let activeQueue: FetchQueue | null = null

export function isCarolSyncRunning(): boolean {
  return running
}

/** 진행 중인 동기화 중단 (오버레이 ✕ / destroy 시). */
export function abortCarolSync(): void {
  activeQueue?.abort('user')
}

/**
 * 동기화 1회 실행. 사용자가 버튼을 눌렀을 때만 호출됨.
 * @param token carol 동기화 토큰 (`/북마클릿` 으로 발급)
 */
export async function runCarolSync(token: string): Promise<void> {
  if (running) return
  const server = detectRegion()
  if (!server) {
    alert('maimai DX NET 페이지에서 실행해주세요.')
    return
  }
  if (!token) {
    alert('carol 동기화 토큰이 없습니다. 익스텐션 팝업에서 먼저 등록하세요.')
    return
  }

  running = true
  const queue = new FetchQueue()
  activeQueue = queue
  const ui = openOverlay(server, () => queue.abort('user'))
  try {
    ui.section('PROFILE')
    ui.row('rc', '최근 플레이')
    ui.row('fc', '친구코드')
    ui.row('ri', '단위·클래스 이미지')
    ui.section('AREA')
    ui.row('mp', '지역 진행도')
    ui.row('em', '이벤트 지역')
    ui.section('OPTION')
    ui.row('uo', '게임 설정')
    ui.section('CIRCLE')
    ui.row('ci', '서클 정보')
    ui.row('cm', '서클 멤버')
    ui.row('cr', '서클 랭킹')
    ui.section('SERVER')
    ui.row('sv', '서버 저장')

    const got: Partial<Record<PageKey, string>> = {}
    for (const page of PAGES) {
      got[page.key] = await fetchPage(queue, page, ui)
    }

    const missing = PAGES.filter((p) => !p.optional && !got[p.key])
    if (missing.length) {
      for (const p of missing) ui.fail(p.row, '수집 실패')
      ui.skip('sv', '수집 실패')
      ui.finish('error', '일부 항목 실패')
      return
    }
    if (!validateCore(got, ui)) {
      ui.skip('sv', '수집 실패')
      ui.finish('error', '일부 항목 실패')
      return
    }

    // 원본도 플레이 상세(dt) 수집은 꺼져 있음(COLLECT_PLAY_DETAILS=false) — 빈 배열 전송
    const ri = await collectRankImages(queue, server, ui)

    const payload: SyncPayload = {
      server,
      r: got.r ?? '',
      f: got.f ?? '',
      dt: [],
      m: got.m ?? '',
      em: got.em ?? '',
      uo: got.uo ?? '',
      ci: got.ci ?? '',
      cm: got.cm ?? '',
      cr: got.cr ?? '',
      ri,
    }

    ui.phase('동기화 저장 중...')
    const result = await postSync(token, payload, ui)
    if (result !== 'fail') {
      await carolSyncState.patch({ syncedAt: Date.now() })
      if (ri.length) await carolRankImagesSent.add(server, ri.map((x) => fileName(x.url)))
    }

    if (result === 'no_change' && !ui.hadError()) {
      ui.phase('')
      ui.finish('muted', '이미 최신 상태')
    } else if (result === 'initialized' && !ui.hadError()) {
      ui.phase('첫 동기화는 기준선으로 저장 · 이후부터 플레이 기록 수집')
      ui.finish('init', '첫 동기화 기준선 설정 완료 · 다음부터 플레이 기록 수집')
    } else if (result === 'ok' && !ui.hadError()) {
      ui.phase('동기화 저장 완료')
      ui.finish('ok', '동기화 완료')
    } else {
      ui.finish('error', '일부 항목 실패')
    }
  } catch (err) {
    if (err instanceof QueueAbortedError) {
      if (err.reason !== 'user') ui.finish('error', err.message)
    } else {
      console.error('[mmp] carol 동기화 오류', err)
      ui.finish('error', '오류: ' + errText(err))
    }
  } finally {
    running = false
    if (activeQueue === queue) activeQueue = null
  }
}

/* ------------------------------------------------------------------ 수집 */

function detectRegion(): Region | null {
  const r = region()
  return r === 'unknown' ? null : r
}

function errText(err: unknown): string {
  if (err instanceof Error) return err.name === 'AbortError' ? '시간 초과' : err.message
  return String(err)
}

function sizeLabel(len: number): string {
  if (len <= 0) return '없음'
  return len > 1024 ? `${(len / 1024).toFixed(1)}KB` : `${len}B`
}

function fileName(url: string): string {
  return url.split('/').pop() ?? url
}

/**
 * 한 페이지를 큐로 받음. 네트워크 오류만 재시도(최대 3회).
 * 에러/점검 페이지는 큐가 중단시키므로 `QueueAbortedError`가 그대로 위로 올라감.
 */
async function fetchPage(queue: FetchQueue, page: CorePage, ui: Overlay): Promise<string> {
  ui.pending(page.row, '받는 중')
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await queue.fetchText(page.path)
      if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`)
      ui.ok(page.row, sizeLabel(res.text.length))
      return res.text
    } catch (err) {
      if (err instanceof QueueAbortedError) {
        ui.fail(page.row, err.reason === 'user' ? '중단' : '에러 페이지')
        throw err
      }
      if (attempt < MAX_ATTEMPTS) {
        ui.pending(page.row, `재시도 ${attempt}/${MAX_ATTEMPTS - 1}`)
        await sleep(400 * attempt)
        continue
      }
      if (page.optional) ui.skip(page.row, '실패')
      else ui.fail(page.row, errText(err) === '시간 초과' ? '시간 초과' : '네트워크 오류')
    }
  }
  return ''
}

function parseHtml(text: string): Document {
  return new DOMParser().parseFromString(text, 'text/html')
}

function pageText(doc: Document): string {
  return doc.body?.textContent ?? ''
}

/**
 * 로그인/세션 확인. carol `validateCore` 와 같은 기준 (최근 플레이 · 친구코드).
 * 세션 쿠키가 HttpOnly면 `document.cookie`엔 안 보이므로 DOM 마커로 판정.
 */
function validateCore(got: Partial<Record<PageKey, string>>, ui: Overlay): boolean {
  const label = (document.cookie || '').length > 0 ? '세션 만료' : '로그인 필요'
  try {
    const record = parseHtml(got.r ?? '')
    const friend = parseHtml(got.f ?? '')
    const checks: Record<string, boolean> = {
      rc: !!(
        record.querySelector("[class*='playlog'],[class*='record']") ||
        /playlog|record/i.test(pageText(record))
      ),
      fc: /[0-9]{13}/.test(pageText(friend).replace(/[^0-9]/g, '')),
    }
    const bad = Object.keys(checks).filter((id) => !checks[id])
    if (bad.length) {
      for (const id of bad) ui.fail(id, label)
      console.warn('[mmp] carol: 세션 검증 실패', bad)
      return false
    }
    return true
  } catch (err) {
    for (const id of ['rc', 'fc']) ui.fail(id, label)
    console.warn('[mmp] carol: 세션 검증 오류', err)
    return false
  }
}

/**
 * 홈 HTML의 단위(course_rank_)·클래스(class_rank_s_) 이미지 중 carol 에 아직 안 보낸 것만
 * data URL 로. 원본은 서버가 "이미 저장된 파일명" 목록을 북마클릿에 끼워 주지만, 익스텐션은
 * 원격 스크립트를 안 받으므로 이 기기에서 보낸 파일명을 기억해 대신함 (서버도 중복은 거름).
 */
async function collectRankImages(
  queue: FetchQueue,
  server: Region,
  ui: Overlay,
): Promise<SyncPayload['ri']> {
  try {
    ui.pending('ri', '확인 중')
    const known = await carolRankImagesSent.get(server)
    const home = await queue.fetchText(HOME_PATH)
    const urls: string[] = []
    for (const m of home.text.matchAll(RANK_IMG_RX)) {
      const url = m[1]
      if (!url) continue
      if (known.includes(fileName(url)) || urls.includes(url)) continue
      urls.push(url)
    }
    if (!urls.length) {
      ui.ok('ri', '저장됨')
      return []
    }
    const out: SyncPayload['ri'] = []
    for (const url of urls.slice(0, MAX_RANK_IMAGES)) {
      const blob = await queue.fetchBlob(url)
      out.push({ url, data: await toDataUrl(blob) })
    }
    ui.ok('ri', `${out.length}개`)
    return out
  } catch (err) {
    if (err instanceof QueueAbortedError) throw err
    ui.skip('ri', '건너뜀')
    return []
  }
}

function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result))
    fr.onerror = () => reject(fr.error ?? new Error('read error'))
    fr.readAsDataURL(blob)
  })
}

type PostResult = 'ok' | 'no_change' | 'initialized' | 'fail'

async function postSync(token: string, payload: SyncPayload, ui: Overlay): Promise<PostResult> {
  const json = JSON.stringify(payload)
  const url = `${CAROL_ORIGIN}/sync?code=${encodeURIComponent(token)}`
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  let body: BodyInit = json
  if (typeof CompressionStream !== 'undefined') {
    try {
      body = await new Response(
        new Blob([json]).stream().pipeThrough(new CompressionStream('gzip')),
      ).arrayBuffer()
      headers['Content-Encoding'] = 'gzip'
    } catch {
      body = json
    }
  }

  ui.pending('sv', '전송 중')
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), SYNC_UPLOAD_TIMEOUT)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body,
        credentials: 'omit',
        signal: ac.signal,
      })
      const text = (await res.text()).trim()
      if (res.ok) {
        if (text === 'no_change') {
          ui.skip('sv', '이미 최신 상태')
          return 'no_change'
        }
        if (text === 'initialized') {
          ui.ok('sv', '기준선 설정')
          return 'initialized'
        }
        ui.ok('sv')
        return 'ok'
      }
      if (attempt < MAX_ATTEMPTS) {
        ui.pending('sv', `재시도 ${attempt + 1}/${MAX_ATTEMPTS}`)
        await sleep(800 * attempt)
        continue
      }
      ui.fail('sv', `HTTP ${res.status}${text ? ': ' + text.slice(0, 40) : ''}`)
      return 'fail'
    } catch (err) {
      if (attempt < MAX_ATTEMPTS) {
        ui.pending('sv', `재시도 ${attempt + 1}/${MAX_ATTEMPTS}`)
        await sleep(800 * attempt)
        continue
      }
      ui.fail('sv', errText(err) === '시간 초과' ? '서버 응답 시간 초과' : '연결 실패')
      return 'fail'
    } finally {
      clearTimeout(timer)
    }
  }
  return 'fail'
}

/* ------------------------------------------------------------------ 오버레이 */

interface Overlay {
  section(label: string): void
  row(id: string, label: string): void
  phase(text: string): void
  pending(id: string, note?: string): void
  ok(id: string, note?: string): void
  fail(id: string, note?: string): void
  skip(id: string, note?: string): void
  hadError(): boolean
  finish(kind: 'ok' | 'error' | 'muted' | 'init', text: string): void
}

function injectStyle(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  // 수치는 carol 북마클릿 오버레이와 같음. 색·글꼴은 디자인 시스템 토큰(core/theme.ts 스코프).
  style.textContent = [
    `#${OV_ID}{position:fixed;top:16px;right:16px;z-index:2147483647;box-sizing:border-box;`,
    `  background:var(--crl-surface);border:1px solid var(--crl-border);`,
    `  border-radius:var(--crl-radius-card);padding:16px 18px;text-align:left;`,
    `  font:13px var(--crl-font-sans);color:var(--crl-ink-soft);min-width:300px;max-width:340px;`,
    `  max-height:calc(100vh - 32px);overflow-y:auto;`,
    `  box-shadow:0 12px 36px rgba(0,0,0,.55),0 0 0 1px ${withAlpha(color.accent, 0.14)};}`,
    `#${OV_ID} .mmp-carol-hd{display:flex;justify-content:space-between;align-items:center;`,
    `  padding-bottom:10px;margin-bottom:4px;border-bottom:1px solid var(--crl-surface-2);}`,
    `#${OV_ID} .mmp-carol-brand{font-weight:var(--crl-weight-semibold);font-size:15px;`,
    `  color:var(--crl-ink);}`,
    `#${OV_ID} .mmp-carol-rg{color:var(--crl-faint);font-size:10px;font-weight:600;`,
    `  letter-spacing:.6px;margin-left:10px;font-family:var(--crl-font-mono);text-transform:uppercase;}`,
    `#${OV_ID} .mmp-carol-x{background:none;border:none;color:var(--crl-dim);font-size:14px;`,
    `  cursor:pointer;line-height:1;padding:2px 6px;border-radius:var(--crl-radius-inline);`,
    `  transition:background var(--crl-motion-fast),color var(--crl-motion-fast);}`,
    `#${OV_ID} .mmp-carol-x:hover{color:var(--crl-ink);background:var(--crl-surface-2);}`,
    `#${OV_ID} .mmp-carol-x:focus-visible{outline:2px solid var(--crl-focus);outline-offset:2px;}`,
    `#${OV_ID} .mmp-carol-phase{display:none;color:var(--crl-accent-soft);font-size:11px;`,
    `  line-height:1.4;padding:8px 0 2px;margin-bottom:4px;border-bottom:1px solid var(--crl-surface-2);}`,
    `#${OV_ID} .mmp-carol-sec{padding:8px 0 4px;margin-top:6px;border-bottom:1px solid var(--crl-surface-2);`,
    `  color:var(--crl-muted);font-size:10px;font-weight:700;letter-spacing:.6px;`,
    `  font-family:var(--crl-font-mono);text-transform:uppercase;}`,
    `#${OV_ID} .mmp-carol-row{display:flex;align-items:center;gap:10px;padding:3px 0;}`,
    `#${OV_ID} .mmp-carol-ic{display:inline-block;width:14px;text-align:center;font-size:11px;`,
    `  color:var(--crl-faint);}`,
    `#${OV_ID} .mmp-carol-lb{flex:1;font-size:13px;color:var(--crl-ink-soft);}`,
    `#${OV_ID} .mmp-carol-nt{color:var(--crl-faint);font-size:10px;letter-spacing:.3px;`,
    `  font-family:var(--crl-font-mono);}`,
    `#${OV_ID} .mmp-carol-fin{display:flex;align-items:center;gap:8px;margin-top:12px;`,
    `  padding-top:12px;border-top:1px solid var(--crl-surface-2);font-weight:700;font-size:13px;`,
    `  letter-spacing:.2px;}`,
    `#${OV_ID} .mmp-carol-fin-init{font-family:var(--crl-font-mono);font-size:10px;}`,
  ].join('')
  document.head.appendChild(style)
}

/** 행 상태색. 오버레이가 `.mmp-crl` 스코프 안이라 CSS 변수로 지정 가능. */
const COLOR = {
  pending: 'var(--crl-warning)',
  ok: 'var(--crl-success)',
  fail: 'var(--crl-danger)',
  faint: 'var(--crl-faint)',
  muted: 'var(--crl-muted)',
  soft: 'var(--crl-accent-soft)',
}

function openOverlay(server: Region, onAbort: () => void): Overlay {
  injectTokens()
  injectStyle()
  document.getElementById(OV_ID)?.remove()

  const ov = document.createElement('div')
  ov.id = OV_ID
  ov.className = CRL_SCOPE
  ov.innerHTML =
    `<div class="mmp-carol-hd">` +
    `<div><span class="mmp-carol-brand">캐롤봇 추가 북마클릿</span>` +
    `<span class="mmp-carol-rg">${server === 'jp' ? 'JP' : 'INTERNATIONAL'}</span></div>` +
    `<button type="button" class="mmp-carol-x" aria-label="닫기">✕</button></div>` +
    `<div class="mmp-carol-phase"></div>` +
    `<div class="mmp-carol-body"></div>`
  document.body.appendChild(ov)

  let done = false
  let hadErr = false
  ov.querySelector('.mmp-carol-x')?.addEventListener('click', () => {
    // 진행 중에 닫으면 수집도 중단 (CLAUDE.md: 중단 버튼 필수)
    if (!done) onAbort()
    ov.remove()
  })
  const phaseEl = ov.querySelector<HTMLElement>('.mmp-carol-phase')!
  const body = ov.querySelector<HTMLElement>('.mmp-carol-body')!

  const setRow = (id: string, icon: string, color: string, note?: string): void => {
    const ic = body.querySelector<HTMLElement>(`[data-ic="${id}"]`)
    const nt = body.querySelector<HTMLElement>(`[data-nt="${id}"]`)
    if (ic) {
      ic.textContent = icon
      ic.style.color = color
    }
    if (nt) {
      if (note !== undefined) nt.textContent = note
      nt.style.color = color
    }
  }

  const fadeOut = (): void => {
    setTimeout(() => {
      ov.style.transition = 'opacity .3s'
      ov.style.opacity = '0'
      setTimeout(() => ov.remove(), 300)
    }, 2500)
  }

  return {
    section(label) {
      const el = document.createElement('div')
      el.className = 'mmp-carol-sec'
      el.textContent = label
      body.appendChild(el)
    },
    row(id, label) {
      const el = document.createElement('div')
      el.className = 'mmp-carol-row'
      el.innerHTML =
        `<span class="mmp-carol-ic" data-ic="${id}">·</span>` +
        `<span class="mmp-carol-lb"></span>` +
        `<span class="mmp-carol-nt" data-nt="${id}"></span>`
      el.querySelector('.mmp-carol-lb')!.textContent = label
      body.appendChild(el)
    },
    phase(text) {
      phaseEl.textContent = text
      phaseEl.style.display = text ? 'block' : 'none'
    },
    pending(id, note) {
      setRow(id, '↻', COLOR.pending, note)
    },
    ok(id, note) {
      setRow(id, '✓', COLOR.ok, note ?? '')
    },
    fail(id, note) {
      hadErr = true
      setRow(id, '✕', COLOR.fail, note ?? '오류')
    },
    skip(id, note) {
      setRow(id, '—', COLOR.faint, note ?? '건너뜀')
    },
    hadError() {
      return hadErr
    },
    finish(kind, text) {
      done = true
      const color =
        kind === 'ok' ? COLOR.ok : kind === 'error' ? COLOR.fail : kind === 'init' ? COLOR.soft : COLOR.muted
      const mark = kind === 'ok' ? '✓' : kind === 'error' ? '⚠' : kind === 'init' ? 'INIT' : '✨'
      const fin = document.createElement('div')
      fin.className = 'mmp-carol-fin'
      fin.style.color = color
      fin.innerHTML = `<span></span><span></span>`
      const markEl = fin.querySelector<HTMLElement>('span:first-child')!
      markEl.textContent = mark
      if (kind === 'init') markEl.className = 'mmp-carol-fin-init'
      else markEl.style.fontSize = '14px'
      fin.querySelector('span:last-child')!.textContent = text
      body.appendChild(fin)
      // 원본과 같음: 완료·최신이면 자동으로 닫힘, 기준선 설정·실패는 남겨 둠
      if (kind === 'ok' || kind === 'muted') fadeOut()
    },
  }
}
