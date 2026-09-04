/**
 * carol bot 프로필 동기화.
 *
 * team-carol/carol 의 북마클릿(`src/web/bookmarklet.ts` 의 `bookmarkletJs`)이 하던 일을
 * 익스텐션 안으로 옮긴 것. 원본은 원격 스크립트(`/bookmarklet.js?code=…`)를 페이지에
 * 주입하는 방식이라 웹스토어 심사(원격 코드 실행 금지)에 걸림. 여기서는 콘텐츠 스크립트
 * (격리 월드)에서 직접 수집·전송한다.
 *
 * 수집 대상 페이지 목록과 POST 페이로드 키(`server,h,p,r,f,a,js,dt,tb4..tb0,rt,m,em`)는
 * carol `/sync` 엔드포인트와 **바이트 단위로 같아야** 함. carol 스크래퍼가 페이지를
 * 늘리거나 키를 바꾸면 여기도 맞출 것.
 *
 * 원본 북마클릿의 프리셋/추가 북마클릿(maishift 등)은 옮기지 않았다 —
 * 그건 서버가 끼워 넣는 코드라 여기서 재현하려면 원격 코드 실행이 됨.
 * carol 코어 동기화만 담당한다.
 *
 * 동시성 1 · 요청 간 800ms. maimai NET은 병렬 요청에 세션이 날아감(CLAUDE.md 참고).
 */
import { region } from '@/core/selectors'

const CAROL_ORIGIN = 'https://maimai.bitworkspace.kr'

const OV_ID = 'mmp-carol-ov'
const STYLE_ID = 'mmp-carol-style'

const MAX_ATTEMPTS = 3
const REQUEST_TIMEOUT = 15_000
const GAP_MS = 800

type Region = 'jp' | 'intl'

/** carol `/sync` 페이로드. 키 이름을 바꾸지 말 것. */
interface SyncPayload {
  server: Region
  h: string
  p: string
  r: string
  f: string
  a: string
  js: unknown[]
  dt: Array<{ idx: string; html: string }>
  tb4: string
  tb3: string
  tb2: string
  tb1: string
  tb0: string
  rt: string
  m: string
  em: string
}

interface CorePage {
  /** 페이로드 키 */
  key: keyof SyncPayload
  /** UI 행 id */
  row: string
  path: string
  /** 없어도 전송은 진행 (실패해도 스킵) */
  optional: boolean
}

/** 수집 순서 = 배열 순서. 원본 `collectCore`의 `_pl`과 동일. */
const CORE_PAGES: CorePage[] = [
  { key: 'h', row: 'hm', path: '/maimai-mobile/home/', optional: false },
  { key: 'p', row: 'pd', path: '/maimai-mobile/playerData/', optional: false },
  { key: 'r', row: 'rc', path: '/maimai-mobile/record/', optional: false },
  { key: 'f', row: 'fc', path: '/maimai-mobile/friend/userFriendCode/', optional: false },
  { key: 'tb4', row: 'tb4', path: '/maimai-mobile/record/musicGenre/search/?genre=99&diff=4', optional: true },
  { key: 'tb3', row: 'tb3', path: '/maimai-mobile/record/musicGenre/search/?genre=99&diff=3', optional: true },
  { key: 'tb2', row: 'tb2', path: '/maimai-mobile/record/musicGenre/search/?genre=99&diff=2', optional: true },
  { key: 'tb1', row: 'tb1', path: '/maimai-mobile/record/musicGenre/search/?genre=99&diff=1', optional: true },
  { key: 'tb0', row: 'tb0', path: '/maimai-mobile/record/musicGenre/search/?genre=99&diff=0', optional: true },
]

/** intl 전용. jp는 클리어 차트에서 레이팅을 산출함. */
const RATING_TARGET: CorePage = {
  key: 'rt',
  row: 'rt',
  path: '/maimai-mobile/home/ratingTargetMusic/',
  optional: true,
}

const AREA_PAGES: CorePage[] = [
  { key: 'm', row: 'mp', path: '/maimai-mobile/map/', optional: true },
  { key: 'em', row: 'em', path: '/maimai-mobile/map/eventMap/', optional: true },
]

let running = false

export function isCarolSyncRunning(): boolean {
  return running
}

/**
 * 동기화 1회 실행. maimai NET 페이지에서 호출.
 * @param token carol 동기화 토큰 (`/북마클릿` 으로 발급)
 */
export async function runCarolSync(token: string): Promise<void> {
  if (running) return
  const region = detectRegion()
  if (!region) {
    alert('maimai DX NET 페이지에서 실행해주세요.')
    return
  }
  if (!token) {
    alert('carol 동기화 토큰이 없습니다. 익스텐션 팝업에서 먼저 등록하세요.')
    return
  }

  running = true
  const ui = openOverlay(region)
  try {
    ui.section('PROFILE')
    ui.row('hm', '홈 데이터')
    ui.row('pd', '플레이어 데이터')
    ui.row('rc', '최근 플레이')
    ui.row('fc', '친구코드')
    ui.section('CLEAR CHART')
    ui.row('tb4', 'Re:MASTER')
    ui.row('tb3', 'MASTER')
    ui.row('tb2', 'EXPERT')
    ui.row('tb1', 'ADVANCED')
    ui.row('tb0', 'BASIC')
    ui.section('RATING')
    ui.row('rt', '레이팅 대상 50곡')
    ui.section('AREA')
    ui.row('mp', '지역 진행도')
    ui.row('em', '이벤트 지역')
    ui.section('PLAY DETAIL')
    ui.row('dt', '플레이 기록 상세')
    ui.section('ASSETS')
    ui.row('av', '아바타')
    ui.section('SERVER')
    ui.row('sv', '서버 저장')

    const pages: CorePage[] = [
      ...CORE_PAGES,
      ...(region === 'intl' ? [RATING_TARGET] : []),
      ...AREA_PAGES,
    ]

    const collected: Partial<Record<keyof SyncPayload, string>> = {}
    for (const [i, page] of pages.entries()) {
      const text = await fetchPage(page, ui)
      collected[page.key] = text
      if (i < pages.length - 1) await sleep(GAP_MS)
    }

    if (region === 'jp') ui.ok('rt', '클리어 차트에서 산출')

    if (!validateCore(collected, ui)) {
      ui.finish('error', 'maimai NET 로그인 상태를 확인해주세요')
      return
    }

    const record = collected.r ?? ''
    let details: SyncPayload['dt'] = []
    try {
      details = await collectDetails(record, ui)
    } catch (err) {
      console.warn('[mmp] carol: 기록 상세 수집 실패', err)
      ui.skip('dt', '실패')
    }

    const avatar = await collectAvatar(collected.h ?? '', ui)

    const payload: SyncPayload = {
      server: region,
      h: collected.h ?? '',
      p: collected.p ?? '',
      r: record,
      f: collected.f ?? '',
      a: avatar,
      js: [],
      dt: details,
      tb4: collected.tb4 ?? '',
      tb3: collected.tb3 ?? '',
      tb2: collected.tb2 ?? '',
      tb1: collected.tb1 ?? '',
      tb0: collected.tb0 ?? '',
      rt: collected.rt ?? '',
      m: collected.m ?? '',
      em: collected.em ?? '',
    }

    const result = await postSync(token, payload, ui)
    if (result === 'no_change') ui.finish('muted', '이미 최신 상태')
    else if (result === 'initialized') ui.finish('muted', '첫 동기화 기준선 설정 완료')
    else if (result === 'ok') ui.finish('ok', '동기화 완료')
    else ui.finish('error', '서버 저장 실패')
  } catch (err) {
    console.error('[mmp] carol 동기화 오류', err)
    ui.finish('error', '오류: ' + errText(err))
  } finally {
    running = false
  }
}

/* ------------------------------------------------------------------ 수집 */

function detectRegion(): Region | null {
  const r = region()
  return r === 'unknown' ? null : r
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms))
}

function errText(err: unknown): string {
  if (err instanceof Error) return err.name === 'AbortError' ? '시간 초과' : err.message
  return String(err)
}

function fetchWithTimeout(url: string, opt?: RequestInit): Promise<Response> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT)
  return fetch(url, { ...opt, signal: ac.signal }).finally(() => clearTimeout(timer))
}

function sizeLabel(len: number): string {
  if (len <= 0) return '없음'
  return len > 1024 ? `${(len / 1024).toFixed(1)}KB` : `${len}B`
}

/** 한 페이지를 재시도까지 포함해 가져옴. 실패 시 optional이면 '' 반환. */
async function fetchPage(page: CorePage, ui: Overlay): Promise<string> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetchWithTimeout(page.path)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const text = await res.text()
      ui.ok(page.row, sizeLabel(text.length))
      return text
    } catch (err) {
      if (attempt < MAX_ATTEMPTS) {
        ui.pending(page.row, `재시도 ${attempt + 1}/${MAX_ATTEMPTS}`)
        await sleep(400 * attempt)
        continue
      }
      if (page.optional) {
        ui.skip(page.row, '실패')
        return ''
      }
      ui.fail(page.row, errText(err))
      return ''
    }
  }
  return ''
}

function parseHtml(text: string): Document {
  return new DOMParser().parseFromString(text, 'text/html')
}

function hasScoreBlocks(text: string): boolean {
  if (!text) return false
  return (
    parseHtml(text).querySelectorAll(
      "[class*='music_'][class*='_score_back'], .music_name_block",
    ).length > 0
  )
}

/**
 * 로그인/세션 확인. carol `validateCore` 축약판.
 * 세션 쿠키가 HttpOnly면 `document.cookie`엔 안 보이므로 DOM 마커로 판정.
 */
function validateCore(
  got: Partial<Record<keyof SyncPayload, string>>,
  ui: Overlay,
): boolean {
  try {
    const home = parseHtml(got.h ?? '')
    const player = parseHtml(got.p ?? '')
    const record = parseHtml(got.r ?? '')
    const friend = parseHtml(got.f ?? '')

    const checks: Record<string, boolean> = {
      hm: !!(home.querySelector('.name_block') || home.querySelector("img[src*='Icon']")),
      pd: /プレイ回数|play[^a-z0-9]*count/i.test(player.body?.textContent ?? ''),
      rc: !!(
        record.querySelector("[class*='playlog'], [class*='record']") ||
        /playlog|record/i.test(record.body?.textContent ?? '')
      ),
      fc: /[0-9]{13}/.test((friend.body?.textContent ?? '').replace(/[^0-9]/g, '')),
      tb3: hasScoreBlocks(got.tb3 ?? ''),
      tb2: hasScoreBlocks(got.tb2 ?? ''),
    }

    const bad = Object.keys(checks).filter((id) => !checks[id])
    if (bad.length) {
      for (const id of bad) ui.fail(id, '로그인 필요')
      console.warn('[mmp] carol: 세션 검증 실패', bad)
      return false
    }
    return true
  } catch (err) {
    console.warn('[mmp] carol: 세션 검증 오류', err)
    return false
  }
}

/** 최근 기록 중 신기록(newrecord)만 상세 페이지까지 받아옴. carol `collectDetails`. */
async function collectDetails(recordHtml: string, ui: Overlay): Promise<SyncPayload['dt']> {
  const doc = parseHtml(recordHtml)
  const reqs: Array<{ idx: string; url: string }> = []
  for (const block of Array.from(doc.querySelectorAll('.p_10.t_l.f_0.v_b'))) {
    if (!block.querySelector('.playlog_achievement_newrecord')) continue
    const form = block.querySelector("form[action*='playlogDetail']")
    if (!form) continue
    const input = form.querySelector<HTMLInputElement>("input[name='idx']")
    const idx = input?.value.trim() ?? ''
    const action = form.getAttribute('action') ?? ''
    if (!idx || !action) continue
    const sep = action.includes('?') ? '&' : '?'
    reqs.push({ idx, url: `${action}${sep}idx=${encodeURIComponent(idx)}` })
  }

  if (reqs.length === 0) {
    ui.skip('dt', '확인할 기록 없음')
    return []
  }
  ui.pending('dt', '확인 중')

  const out: SyncPayload['dt'] = []
  for (const [i, req] of reqs.entries()) {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const res = await fetchWithTimeout(req.url)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        out.push({ idx: req.idx, html: await res.text() })
        break
      } catch (err) {
        if (attempt < MAX_ATTEMPTS) await sleep(400 * attempt)
        else console.warn('[mmp] carol: 상세 실패', req.idx, errText(err))
      }
    }
    if (i < reqs.length - 1) await sleep(GAP_MS)
  }
  ui.ok('dt', `${out.length}개`)
  return out
}

/** 홈 HTML에서 아바타 이미지를 data URL로. carol와 동일한 정규식. */
async function collectAvatar(homeHtml: string, ui: Overlay): Promise<string> {
  try {
    const match = homeHtml.match(/src="(https:[^"]*Icon[^"]*)"/)
    if (!match?.[1]) {
      ui.skip('av', '이미지 없음')
      return ''
    }
    const blob = await fetch(match[1]).then((r) => r.blob())
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader()
      fr.onload = () => resolve(String(fr.result))
      fr.onerror = () => reject(fr.error ?? new Error('read error'))
      fr.readAsDataURL(blob)
    })
    ui.ok('av')
    return dataUrl
  } catch {
    ui.fail('av')
    return ''
  }
}

type PostResult = 'ok' | 'no_change' | 'initialized' | 'fail'

async function postSync(
  token: string,
  payload: SyncPayload,
  ui: Overlay,
): Promise<PostResult> {
  const json = JSON.stringify(payload)
  const url = `${CAROL_ORIGIN}/sync?code=${encodeURIComponent(token)}`

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
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

      const res = await fetchWithTimeout(url, {
        method: 'POST',
        headers,
        body,
        credentials: 'omit',
      })
      const text = (await res.text()).trim()
      if (res.ok) {
        if (text === 'no_change') {
          ui.skip('sv', '이미 최신')
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
        await sleep(500 * attempt)
        continue
      }
      ui.fail('sv', `HTTP ${res.status}${text ? ': ' + text.slice(0, 40) : ''}`)
      return 'fail'
    } catch (err) {
      if (attempt < MAX_ATTEMPTS) {
        ui.pending('sv', `재시도 ${attempt + 1}/${MAX_ATTEMPTS}`)
        await sleep(500 * attempt)
        continue
      }
      ui.fail('sv', errText(err))
      return 'fail'
    }
  }
  return 'fail'
}

/* ------------------------------------------------------------------ 오버레이 */

interface Overlay {
  section(label: string): void
  row(id: string, label: string): void
  pending(id: string, note?: string): void
  ok(id: string, note?: string): void
  fail(id: string, note?: string): void
  skip(id: string, note?: string): void
  finish(kind: 'ok' | 'error' | 'muted', text: string): void
}

function injectStyle(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = [
    `#${OV_ID}{position:fixed;top:16px;right:16px;z-index:2147483647;`,
    `  background:#1a1a1a;border:1px solid #2a2a2a;border-radius:12px;padding:14px 16px;`,
    `  font:13px system-ui,-apple-system,sans-serif;color:#ccc;min-width:280px;max-width:340px;`,
    `  max-height:calc(100vh - 32px);overflow-y:auto;box-shadow:0 12px 36px rgba(0,0,0,.55);}`,
    `#${OV_ID} .mmp-carol-hd{display:flex;justify-content:space-between;align-items:center;`,
    `  padding-bottom:8px;margin-bottom:4px;border-bottom:1px solid #1e1e1e;}`,
    `#${OV_ID} .mmp-carol-brand{font-weight:800;font-size:14px;color:#fff;}`,
    `#${OV_ID} .mmp-carol-brand b{color:#9333ea;}`,
    `#${OV_ID} .mmp-carol-rg{color:#666;font-size:10px;font-weight:600;letter-spacing:.6px;`,
    `  margin-left:8px;font-family:ui-monospace,Menlo,monospace;}`,
    `#${OV_ID} .mmp-carol-x{background:none;border:none;color:#888;font-size:14px;cursor:pointer;`,
    `  line-height:1;padding:2px 6px;border-radius:6px;}`,
    `#${OV_ID} .mmp-carol-x:hover{color:#fff;background:#252525;}`,
    `#${OV_ID} .mmp-carol-sec{padding:8px 0 4px;margin-top:4px;border-bottom:1px solid #202020;`,
    `  color:#aaa;font-size:10px;font-weight:700;letter-spacing:.6px;`,
    `  font-family:ui-monospace,Menlo,monospace;}`,
    `#${OV_ID} .mmp-carol-row{display:flex;align-items:center;gap:10px;padding:3px 0;}`,
    `#${OV_ID} .mmp-carol-ic{width:14px;text-align:center;font-size:11px;color:#666;}`,
    `#${OV_ID} .mmp-carol-lb{flex:1;font-size:13px;color:#ccc;}`,
    `#${OV_ID} .mmp-carol-nt{color:#666;font-size:10px;font-family:ui-monospace,Menlo,monospace;}`,
    `#${OV_ID} .mmp-carol-fin{display:flex;align-items:center;gap:8px;margin-top:12px;`,
    `  padding-top:12px;border-top:1px solid #1e1e1e;font-weight:700;font-size:13px;}`,
  ].join('')
  document.head.appendChild(style)
}

function openOverlay(region: Region): Overlay {
  injectStyle()
  document.getElementById(OV_ID)?.remove()

  const ov = document.createElement('div')
  ov.id = OV_ID
  ov.innerHTML =
    `<div class="mmp-carol-hd">` +
    `<div><span class="mmp-carol-brand">carol<b>bot</b></span>` +
    `<span class="mmp-carol-rg">${region === 'jp' ? 'JP' : 'INTERNATIONAL'}</span></div>` +
    `<button type="button" class="mmp-carol-x" aria-label="닫기">✕</button></div>` +
    `<div class="mmp-carol-body"></div>`
  document.body.appendChild(ov)
  ov.querySelector('.mmp-carol-x')?.addEventListener('click', () => ov.remove())
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
    pending(id, note) {
      setRow(id, '↻', '#facc15', note)
    },
    ok(id, note) {
      setRow(id, '✓', '#4ade80', note ?? '')
    },
    fail(id, note) {
      setRow(id, '✕', '#f87171', note ?? '오류')
    },
    skip(id, note) {
      setRow(id, '—', '#666', note ?? '건너뜀')
    },
    finish(kind, text) {
      const color = kind === 'ok' ? '#4ade80' : kind === 'error' ? '#f87171' : '#aaa'
      const mark = kind === 'ok' ? '✓' : kind === 'error' ? '⚠' : '✨'
      const fin = document.createElement('div')
      fin.className = 'mmp-carol-fin'
      fin.style.color = color
      fin.innerHTML = `<span>${mark}</span><span></span>`
      fin.querySelector('span:last-child')!.textContent = text
      body.appendChild(fin)
      if (kind !== 'error') {
        setTimeout(() => {
          ov.style.transition = 'opacity .3s'
          ov.style.opacity = '0'
          setTimeout(() => ov.remove(), 300)
        }, 2500)
      }
    },
  }
}
