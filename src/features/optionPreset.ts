/**
 * carol 게임 옵션 프리셋.
 *
 * team-carol/carol 의 옵션 프리셋 북마클릿(`src/web/optionPreset.ts` 의 `OPTION_CLIENT_JS`,
 * `/option.js`)을 익스텐션 안으로 옮긴 것. 원본은 원격 스크립트라 웹스토어 정책상 그대로 실행할
 * 수 없어, 같은 동작을 번들에 다시 구현했다. carol 쪽이 바뀌면 여기도 맞출 것
 * (`docs/option-preset.md`).
 *
 *  - 지금 DX NET 옵션을 이름 붙여 carol 에 저장 (`POST /api/option-presets`)
 *  - 저장한 프리셋을 DX NET 에 적용 — 옵션 폼이 보내는 것과 똑같은 POST(모든 select + CSRF token)
 *  - 적용 뒤 옵션 페이지를 다시 읽어 실제로 바뀌었는지 확인
 *  - 읽은 옵션 페이지 HTML 을 carol 의 "현재 설정" 스냅샷으로 전송 (`/api/options/snapshot`)
 *
 * maimai NET 요청은 `FetchQueue`(동시성 1, 700ms) 경유. 에러 페이지면 즉시 중단.
 * 모든 동작은 사용자가 패널에서 버튼을 눌렀을 때만 일어난다.
 */
import { color, withAlpha } from '@team-carol/design-system'
import { FetchQueue, QueueAbortedError } from '@/core/fetchQueue'
import { OPTION_PAGE, region } from '@/core/selectors'
import { carolToken } from '@/core/storage'
import { CRL_SCOPE, injectTokens } from '@/core/theme'

const CAROL_ORIGIN = 'https://maimai.team-carol.com'
const NAME_MAX = 30

const BTN_ID = 'mmp-preset-btn'
const OV_ID = 'mmp-preset-ov'
const STYLE_ID = 'mmp-preset-style'

type Server = 'jp' | 'intl'

interface SelectField {
  name: string
  value: string
  label: string
  /** option value → 표시 텍스트 */
  options: Record<string, string>
}

type OrderItem = (SelectField & { hidden?: false }) | { name: string; value: string; hidden: true }

interface OptionForm {
  action: string
  fields: SelectField[]
  /** 폼이 보내는 순서 그대로의 name 있는 입력 전부 (select + hidden token) */
  order: OrderItem[]
  html: string
}

interface Preset {
  id: number
  name: string
  server: Server
  values: Record<string, string>
}

interface Change {
  name: string
  label: string
  from: string
  to: string
}

/* ------------------------------------------------------------------ 상태 */

let btn: HTMLButtonElement | null = null
let ov: HTMLElement | null = null
let queue: FetchQueue | null = null

interface State {
  server: Server
  token: string
  form: OptionForm | null
  presets: Preset[]
  max: number
  /** 펼친 프리셋 id */
  open: number | null
  /** 'apply<id>' | 'del<id>' */
  confirm: string | null
  busy: boolean
}

let state: State | null = null
let msgEl: HTMLElement | null = null
let bodyEl: HTMLElement | null = null

/* ------------------------------------------------------------------ 공개 API */

export function initOptionPreset(): void {
  if (btn || region() === 'unknown') return
  injectTokens()
  injectStyle()

  btn = document.createElement('button')
  btn.id = BTN_ID
  btn.type = 'button'
  btn.className = CRL_SCOPE
  btn.innerHTML = `<span class="mmp-preset-dot"></span><span>옵션 프리셋</span>`
  btn.addEventListener('click', () => void togglePanel())
  document.body.appendChild(btn)
}

export function destroyOptionPreset(): void {
  closePanel()
  btn?.remove()
  btn = null
  document.getElementById(STYLE_ID)?.remove()
}

/* ------------------------------------------------------------------ maimai NET */

function onOptionPage(): boolean {
  return location.pathname.startsWith(OPTION_PAGE.path)
}

/** 동작 하나마다 새 큐. 이전 동작이 에러 페이지로 중단됐어도 다시 시도할 수 있게. */
function newQueue(): FetchQueue {
  queue?.abort('user')
  queue = new FetchQueue()
  return queue
}

function clean(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim()
}

/** 옵션 폼 읽기. carol `parseForm` 과 같은 규칙. */
function parseForm(doc: Document): Omit<OptionForm, 'html'> {
  const f = doc.querySelector<HTMLFormElement>(OPTION_PAGE.form)
  if (!f) throw new Error('옵션 페이지를 읽지 못했습니다. 로그인 상태를 확인해주세요.')
  const action = new URL(f.getAttribute('action') ?? '', location.href)
  if (action.origin !== location.origin) throw new Error('예상과 다른 폼입니다.')

  const fields: SelectField[] = []
  const order: OrderItem[] = []
  for (const e of Array.from(f.elements)) {
    const name = (e as HTMLInputElement).name
    if (!name) continue
    if (e instanceof HTMLSelectElement || e.tagName === 'SELECT') {
      const sel = e as HTMLSelectElement
      const options: Record<string, string> = {}
      for (const o of Array.from(sel.options)) options[o.value] = clean(o.textContent)
      const tr = sel.closest('tr')
      const label = tr?.cells?.[0] ? clean(tr.cells[0].textContent) : name
      const fd: SelectField = { name, value: sel.value, label, options }
      fields.push(fd)
      order.push(fd)
    } else if ((e as HTMLInputElement).type === 'hidden') {
      order.push({ name, value: (e as HTMLInputElement).value, hidden: true })
    }
  }
  if (!fields.length) throw new Error('옵션 항목을 찾지 못했습니다.')
  return { action: action.href, fields, order }
}

async function loadForm(q: FetchQueue): Promise<OptionForm> {
  const res = await q.fetchText(OPTION_PAGE.path)
  if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`)
  const doc = new DOMParser().parseFromString(res.text, 'text/html')
  return { ...parseForm(doc), html: res.text }
}

function diff(form: OptionForm, preset: Preset): { changes: Change[]; missing: string[] } {
  const changes: Change[] = []
  const missing: string[] = []
  for (const fd of form.fields) {
    if (!Object.hasOwn(preset.values, fd.name)) continue
    const pv = preset.values[fd.name]!
    if (!Object.hasOwn(fd.options, pv)) {
      missing.push(fd.label)
      continue
    }
    if (pv !== fd.value) {
      changes.push({
        name: fd.name,
        label: fd.label,
        from: fd.options[fd.value] ?? fd.value,
        to: fd.options[pv] ?? pv,
      })
    }
  }
  return { changes, missing }
}

/** 옵션 폼 제출 재현. 프리셋 값이 이 계정의 select 에 없으면 그 항목은 현재 값 유지. */
async function postForm(q: FetchQueue, form: OptionForm, preset: Preset): Promise<void> {
  const p = new URLSearchParams()
  for (const fd of form.order) {
    let v = fd.value
    if (!fd.hidden && Object.hasOwn(preset.values, fd.name)) {
      const pv = preset.values[fd.name]!
      if (Object.hasOwn(fd.options, pv)) v = pv
    }
    p.append(fd.name, v)
  }
  const res = await q.fetchText(form.action, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: p.toString(),
  })
  if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`)
}

/* ------------------------------------------------------------------ carol API */

function apiUrl(path: string, token: string): string {
  return `${CAROL_ORIGIN}${path}?code=${encodeURIComponent(token)}`
}

async function api<T>(path: string, token: string, data?: unknown): Promise<T> {
  const res = await fetch(apiUrl(path, token), {
    credentials: 'omit',
    ...(data !== undefined
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        }
      : {}),
  })
  let j: (T & { error?: string; max?: number }) | null = null
  try {
    j = (await res.json()) as T & { error?: string; max?: number }
  } catch {
    /* 본문 없음 */
  }
  if (res.status === 403) {
    throw new Error('carol 토큰이 만료됐습니다. 익스텐션 팝업에서 다시 등록해주세요.')
  }
  if (!res.ok || !j) {
    throw new Error(
      j?.error === 'limit'
        ? `프리셋은 최대 ${j.max ?? 10}개까지 저장할 수 있습니다.`
        : `캐롤봇 서버 오류 (${res.status})`,
    )
  }
  return j
}

/** carol 게임 설정 페이지의 '현재 설정'을 최신으로. 실패해도 프리셋 동작엔 영향 없음. */
function pushSnapshot(form: OptionForm | null): void {
  if (!form?.html || !state) return
  void fetch(apiUrl('/api/options/snapshot', state.token), {
    method: 'POST',
    credentials: 'omit',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ server: state.server, html: form.html }),
  }).catch(() => {})
}

/* ------------------------------------------------------------------ 동작 */

function errMsg(err: unknown): string {
  if (err instanceof QueueAbortedError) return err.message
  if (err instanceof Error) return err.message
  return String(err)
}

async function save(rawName: string): Promise<void> {
  if (!state) return
  const name = clean(rawName)
  if (!name) return msg('프리셋 이름을 입력해주세요.', 'err')
  if (name.length > NAME_MAX) return msg(`프리셋 이름은 ${NAME_MAX}자까지입니다.`, 'err')
  if (state.busy) return
  state.busy = true
  msg('지금 옵션을 읽는 중…')
  try {
    // 옵션 페이지에서 열었으면 화면에 보이는 값(아직 DX NET 에 저장 안 한 변경 포함)을 저장
    const src = onOptionPage() ? parseForm(document) : await loadForm(newQueue())
    const values: Record<string, string> = {}
    const labels: Record<string, [string, string]> = {}
    for (const fd of src.fields) {
      values[fd.name] = fd.value
      labels[fd.name] = [fd.label, fd.options[fd.value] ?? fd.value]
    }
    const j = await api<{ preset: Preset }>('/api/option-presets', state.token, {
      name,
      server: state.server,
      values,
      labels,
    })
    state.presets = state.presets.filter((p) => p.name !== j.preset.name).concat([j.preset])
    msg(`✓ "${name}" 저장됨`, 'ok')
  } catch (err) {
    msg(errMsg(err), 'err')
  }
  state.busy = false
  render()
}

async function remove(p: Preset): Promise<void> {
  if (!state || state.busy) return
  state.busy = true
  state.confirm = null
  try {
    await api('/api/option-presets/delete', state.token, { id: p.id })
    state.presets = state.presets.filter((x) => x.id !== p.id)
    msg(`"${p.name}" 삭제됨`, 'muted')
  } catch (err) {
    msg(errMsg(err), 'err')
  }
  state.busy = false
  render()
}

async function apply(p: Preset): Promise<void> {
  if (!state || state.busy) return
  state.busy = true
  state.confirm = null
  msg('적용 중…', 'warn')
  render()
  try {
    const q = newQueue()
    const form = await loadForm(q) // 새 CSRF token + 최신 값
    if (!diff(form, p).changes.length) {
      state.form = form
      msg('이미 이 프리셋과 같습니다.', 'muted')
    } else {
      await postForm(q, form, p)
      state.form = await loadForm(q) // 실제로 바뀌었는지 다시 읽어 확인
      pushSnapshot(state.form)
      const left = diff(state.form, p).changes
      if (left.length) {
        msg('일부 항목이 적용되지 않았습니다: ' + left.map((c) => c.label).join(', '), 'err')
      } else {
        msg(`✓ "${p.name}" 적용 완료`, 'ok')
        if (onOptionPage()) setTimeout(() => location.reload(), 1200)
      }
    }
  } catch (err) {
    msg(errMsg(err), 'err')
  }
  state.busy = false
  render()
}

async function load(): Promise<void> {
  if (!state) return
  msg('불러오는 중…')
  try {
    // maimai NET(큐)과 carol 서버는 다른 오리진이라 함께 요청해도 세션 문제 없음
    const [form, res] = await Promise.all([
      loadForm(newQueue()),
      api<{ presets?: Preset[]; max?: number }>('/api/option-presets', state.token),
    ])
    state.form = form
    state.presets = res.presets ?? []
    if (res.max) state.max = res.max
    pushSnapshot(form)
    msg('')
  } catch (err) {
    msg(errMsg(err), 'err')
    return
  }
  render()
}

/* ------------------------------------------------------------------ 패널 */

async function togglePanel(): Promise<void> {
  if (ov) {
    closePanel()
    return
  }
  const server = region()
  if (server === 'unknown') return
  const token = await carolToken.get()
  openPanel(server)
  if (!token) {
    msg('carol 토큰이 없습니다. 익스텐션 팝업 → 게임 옵션 프리셋에서 등록하세요.', 'err')
    return
  }
  state = { server, token, form: null, presets: [], max: 10, open: null, confirm: null, busy: false }
  await load()
}

function closePanel(): void {
  queue?.abort('user')
  queue = null
  ov?.remove()
  ov = null
  state = null
  msgEl = null
  bodyEl = null
}

function openPanel(server: Server): void {
  ov = document.createElement('div')
  ov.id = OV_ID
  ov.className = CRL_SCOPE
  ov.innerHTML =
    `<div class="mmp-p-hd"><div class="mmp-p-title">` +
    `<span class="mmp-p-brand">캐롤봇</span>` +
    `<span class="mmp-p-tag">OPTION PRESET · ${server === 'jp' ? 'JP' : 'INTL'}</span></div>` +
    `<button type="button" class="mmp-p-x" aria-label="닫기">✕</button></div>` +
    `<div class="mmp-p-msg"></div><div class="mmp-p-body"></div>`
  ov.querySelector('.mmp-p-x')!.addEventListener('click', closePanel)
  msgEl = ov.querySelector('.mmp-p-msg')
  bodyEl = ov.querySelector('.mmp-p-body')
  document.body.appendChild(ov)
}

type Tone = 'ok' | 'err' | 'warn' | 'muted' | 'soft'

function msg(text: string, tone: Tone = 'muted'): void {
  if (!msgEl) return
  msgEl.textContent = text
  msgEl.dataset.tone = tone
  msgEl.style.display = text ? 'block' : 'none'
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text != null) e.textContent = text
  return e
}

function button(label: string, primary: boolean): HTMLButtonElement {
  const b = el('button', primary ? 'mmp-p-btn mmp-p-btn--primary' : 'mmp-p-btn', label)
  b.type = 'button'
  return b
}

function render(): void {
  if (!state || !bodyEl) return
  const s = state
  bodyEl.textContent = ''

  // 저장
  const sv = el('div', 'mmp-p-save')
  sv.appendChild(el('div', 'mmp-p-sec', '지금 설정 저장'))
  const row = el('div', 'mmp-p-row')
  const inp = el('input', 'mmp-p-input')
  inp.placeholder = '프리셋 이름 (예: 평소, 연습용)'
  inp.maxLength = NAME_MAX
  const sb = button('저장', true)
  sb.disabled = s.busy
  inp.addEventListener('input', () => {
    const n = clean(inp.value)
    sb.textContent = s.presets.some((p) => p.name === n) ? '덮어쓰기' : '저장'
  })
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sb.click()
  })
  sb.addEventListener('click', () => void save(inp.value))
  row.append(inp, sb)
  sv.appendChild(row)
  bodyEl.appendChild(sv)

  // 목록
  bodyEl.appendChild(el('div', 'mmp-p-sec mmp-p-sec--list', `저장된 프리셋 ${s.presets.length}/${s.max}`))
  if (!s.presets.length) {
    bodyEl.appendChild(el('div', 'mmp-p-empty', '아직 저장된 프리셋이 없습니다.'))
    return
  }
  if (!s.form) return

  for (const p of s.presets) {
    const d = diff(s.form, p)
    const item = el('div', 'mmp-p-item')
    const top = el('div', 'mmp-p-top')

    const nm = el('div', 'mmp-p-name')
    nm.appendChild(el('div', 'mmp-p-pname', p.name))
    const sub =
      (d.changes.length ? `${d.changes.length}개 항목이 바뀜` : '지금 설정과 같음') +
      (p.server !== s.server ? ` · ${p.server === 'jp' ? 'JP' : 'INTL'}에서 저장` : '')
    const subEl = el('div', 'mmp-p-psub', sub)
    if (d.changes.length) subEl.dataset.tone = 'soft'
    nm.appendChild(subEl)
    nm.addEventListener('click', () => {
      s.open = s.open === p.id ? null : p.id
      s.confirm = null
      render()
    })

    const ab = button('적용', true)
    ab.disabled = s.busy || !d.changes.length
    ab.addEventListener('click', () => {
      s.open = p.id
      s.confirm = s.confirm === `apply${p.id}` ? null : `apply${p.id}`
      render()
    })

    const delConfirm = s.confirm === `del${p.id}`
    const db = button(delConfirm ? '정말 삭제' : '삭제', false)
    db.disabled = s.busy
    if (delConfirm) db.classList.add('mmp-p-btn--danger')
    db.addEventListener('click', () => {
      if (delConfirm) void remove(p)
      else {
        s.confirm = `del${p.id}`
        render()
      }
    })

    top.append(nm, ab, db)
    item.appendChild(top)

    if (s.open === p.id) {
      const box = el('div', 'mmp-p-box')
      if (!d.changes.length) box.appendChild(el('div', 'mmp-p-faint', '바뀌는 항목이 없습니다.'))
      for (const c of d.changes) {
        const line = el('div', 'mmp-p-change')
        line.append(
          el('span', 'mmp-p-clabel', c.label),
          el('span', 'mmp-p-faint', c.from),
          el('span', 'mmp-p-faint', '→'),
          el('span', 'mmp-p-cto', c.to),
        )
        box.appendChild(line)
      }
      if (d.missing.length) {
        box.appendChild(
          el('div', 'mmp-p-warn', '이 계정에서 고를 수 없는 값이라 건너뜀: ' + d.missing.join(', ')),
        )
      }
      if (s.confirm === `apply${p.id}`) {
        const cf = el('div', 'mmp-p-confirm')
        cf.appendChild(el('span', 'mmp-p-cq', 'DX NET 옵션에 적용할까요?'))
        const yes = button('적용하기', true)
        const no = button('취소', false)
        yes.addEventListener('click', () => void apply(p))
        no.addEventListener('click', () => {
          s.confirm = null
          render()
        })
        cf.append(yes, no)
        box.appendChild(cf)
      }
      item.appendChild(box)
    }
    bodyEl.appendChild(item)
  }
}

/* ------------------------------------------------------------------ 스타일 */

function injectStyle(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  const O = `#${OV_ID}`
  // 수치는 carol 옵션 프리셋 오버레이와 같음. 색·글꼴은 디자인 시스템 토큰(core/theme.ts 스코프).
  style.textContent = [
    // 떠 있는 버튼 — 디자인 시스템 primary
    `#${BTN_ID}{position:fixed;right:16px;bottom:16px;z-index:2147483646;display:flex;align-items:center;`,
    `  gap:var(--crl-space-3);padding:10px 16px;border:none;border-radius:var(--crl-radius-pill);`,
    `  font:var(--crl-weight-semibold) 13px var(--crl-font-sans);color:var(--crl-accent-ink);`,
    `  background:var(--crl-accent);cursor:pointer;`,
    `  box-shadow:0 8px 24px ${withAlpha(color.accent, 0.35)},0 2px 6px rgba(0,0,0,.25);`,
    `  transition:background var(--crl-motion-fast) var(--crl-motion-easing);}`,
    `#${BTN_ID}:hover{background:var(--crl-accent-hover);}`,
    `#${BTN_ID}:focus-visible{outline:2px solid var(--crl-focus);outline-offset:2px;}`,
    `#${BTN_ID} .mmp-preset-dot{flex:none;width:7px;height:7px;border-radius:50%;background:var(--crl-accent-ink);}`,
    // 패널
    `${O}{position:fixed;top:16px;right:16px;z-index:2147483647;box-sizing:border-box;width:340px;`,
    `  max-width:calc(100vw - 32px);max-height:calc(100vh - 32px);overflow-y:auto;text-align:left;`,
    `  background:var(--crl-surface);border:1px solid var(--crl-border);border-radius:var(--crl-radius-card);`,
    `  padding:16px 18px;font:13px/1.45 var(--crl-font-sans);color:var(--crl-ink-soft);`,
    `  box-shadow:0 12px 36px rgba(0,0,0,.55),0 0 0 1px ${withAlpha(color.accent, 0.14)};}`,
    `${O} *{box-sizing:border-box;}`,
    `${O} .mmp-p-hd{display:flex;justify-content:space-between;align-items:center;padding-bottom:10px;`,
    `  margin-bottom:10px;border-bottom:1px solid var(--crl-surface-2);}`,
    `${O} .mmp-p-title{display:flex;align-items:baseline;}`,
    `${O} .mmp-p-brand{color:var(--crl-ink);font-size:15px;font-weight:var(--crl-weight-semibold);}`,
    `${O} .mmp-p-tag{color:var(--crl-faint);font-size:10px;font-weight:600;letter-spacing:.6px;`,
    `  margin-left:10px;font-family:var(--crl-font-mono);}`,
    `${O} .mmp-p-x{background:none;border:none;color:var(--crl-dim);font-size:14px;cursor:pointer;`,
    `  padding:2px 6px;border-radius:var(--crl-radius-inline);}`,
    `${O} .mmp-p-x:hover{color:var(--crl-ink);background:var(--crl-surface-2);}`,
    `${O} .mmp-p-msg{display:none;font-size:12px;margin-bottom:8px;color:var(--crl-muted);}`,
    `${O} [data-tone="ok"]{color:var(--crl-success);}`,
    `${O} [data-tone="err"]{color:var(--crl-danger);}`,
    `${O} [data-tone="warn"]{color:var(--crl-warning);}`,
    `${O} [data-tone="soft"]{color:var(--crl-accent-soft);}`,
    `${O} .mmp-p-save{padding-bottom:12px;margin-bottom:6px;border-bottom:1px solid var(--crl-surface-2);}`,
    `${O} .mmp-p-sec{color:var(--crl-muted);font-size:10px;font-weight:700;letter-spacing:.6px;`,
    `  font-family:var(--crl-font-mono);margin-bottom:6px;}`,
    `${O} .mmp-p-sec--list{padding:6px 0 4px;margin:0;}`,
    `${O} .mmp-p-row{display:flex;gap:6px;}`,
    `${O} .mmp-p-input{flex:1;min-width:0;background:var(--crl-canvas);border:1px solid var(--crl-border);`,
    `  border-radius:var(--crl-radius-control);padding:7px 10px;color:var(--crl-ink);font:inherit;`,
    `  font-size:13px;outline:none;}`,
    `${O} .mmp-p-input::placeholder{color:var(--crl-faint);}`,
    `${O} .mmp-p-input:focus-visible{border-color:var(--crl-accent);}`,
    `${O} .mmp-p-btn{flex:none;border:0;border-radius:var(--crl-radius-control);padding:6px 12px;`,
    `  font:inherit;font-size:12px;font-weight:600;cursor:pointer;background:var(--crl-surface-2);`,
    `  color:var(--crl-ink-soft);box-shadow:0 0 0 1px var(--crl-border-strong);}`,
    `${O} .mmp-p-btn:hover:not(:disabled){background:var(--crl-surface-hover);}`,
    `${O} .mmp-p-btn--primary{background:var(--crl-accent);color:var(--crl-accent-ink);box-shadow:none;}`,
    `${O} .mmp-p-btn--primary:hover:not(:disabled){background:var(--crl-accent-hover);}`,
    `${O} .mmp-p-btn--danger{color:var(--crl-danger);}`,
    `${O} .mmp-p-btn:disabled{opacity:.4;cursor:default;}`,
    `${O} .mmp-p-btn:focus-visible,${O} .mmp-p-x:focus-visible{outline:2px solid var(--crl-focus);outline-offset:2px;}`,
    `${O} .mmp-p-empty{color:var(--crl-faint);font-size:12px;padding:6px 0;}`,
    `${O} .mmp-p-item{padding:8px 0;border-top:1px solid var(--crl-surface-2);}`,
    `${O} .mmp-p-top{display:flex;align-items:center;gap:8px;}`,
    `${O} .mmp-p-name{flex:1;min-width:0;cursor:pointer;}`,
    `${O} .mmp-p-pname{color:var(--crl-ink);font-size:13.5px;font-weight:600;overflow:hidden;`,
    `  text-overflow:ellipsis;white-space:nowrap;}`,
    `${O} .mmp-p-psub{color:var(--crl-faint);font-size:11px;}`,
    `${O} .mmp-p-box{margin-top:8px;padding:8px 10px;background:var(--crl-canvas);`,
    `  border-radius:var(--crl-radius-control);font-size:11.5px;}`,
    `${O} .mmp-p-change{display:flex;gap:8px;padding:2px 0;}`,
    `${O} .mmp-p-clabel{flex:1;color:var(--crl-muted);}`,
    `${O} .mmp-p-faint{color:var(--crl-faint);}`,
    `${O} .mmp-p-cto{color:var(--crl-ink);font-weight:600;}`,
    `${O} .mmp-p-warn{color:var(--crl-warning);margin-top:6px;}`,
    `${O} .mmp-p-confirm{display:flex;align-items:center;gap:6px;margin-top:8px;}`,
    `${O} .mmp-p-cq{flex:1;color:var(--crl-ink-soft);}`,
  ].join('')
  document.head.appendChild(style)
}
