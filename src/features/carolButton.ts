/**
 * maimai DX NET 페이지에 carol 동기화 버튼을 띄운다. (모드 'manual')
 *
 * 우하단 고정 버튼. 누르면 `runCarolSync`가 프로필/기록을 수집해 carol 서버로 보냄.
 * 토큰은 팝업에서 등록(`carolToken`). 없으면 버튼이 안내만 함.
 * 두 번째 줄에 마지막 동기화 경과 시간을 보여준다.
 *
 * `init()` / `destroy()` 인터페이스 — 팝업 토글로 켜고 끌 때 리스너/DOM 누수 없이 정리.
 */
import { color, withAlpha } from '@team-carol/design-system'
import { carolSyncState, carolToken } from '@/core/storage'
import { CRL_SCOPE, injectTokens } from '@/core/theme'
import { abortCarolSync, isCarolSyncRunning, runCarolSync } from '@/features/carolSync'

const BTN_ID = 'mmp-carol-btn'
const STYLE_ID = 'mmp-carol-btn-style'
const STATE_KEY = 'carolSyncState'

let btn: HTMLButtonElement | null = null
let mainEl: HTMLElement | null = null
let subEl: HTMLElement | null = null
let onStorage: Parameters<typeof browser.storage.onChanged.addListener>[0] | null = null

function injectStyle(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  // 디자인 시스템 primary 버튼: accent 배경 + accentInk 글자
  style.textContent = [
    `#${BTN_ID}{position:fixed;right:16px;bottom:16px;z-index:2147483646;`,
    `  display:flex;align-items:center;gap:var(--crl-space-3);padding:10px 16px;border:none;`,
    `  border-radius:var(--crl-radius-pill);font-family:var(--crl-font-sans);`,
    `  color:var(--crl-accent-ink);background:var(--crl-accent);cursor:pointer;text-align:left;`,
    `  box-shadow:0 8px 24px ${withAlpha(color.accent, 0.35)},0 2px 6px rgba(0,0,0,.25);`,
    `  transition:background var(--crl-motion-fast) var(--crl-motion-easing);}`,
    `#${BTN_ID}:hover{background:var(--crl-accent-hover);}`,
    `#${BTN_ID}:focus-visible{outline:2px solid var(--crl-focus);outline-offset:2px;}`,
    `#${BTN_ID}[disabled]{opacity:.7;cursor:progress;}`,
    `#${BTN_ID} .mmp-carol-btn-dot{flex:none;width:7px;height:7px;border-radius:50%;`,
    `  background:var(--crl-accent-ink);}`,
    `#${BTN_ID} .mmp-carol-btn-tx{display:flex;flex-direction:column;line-height:1.25;}`,
    `#${BTN_ID} .mmp-carol-btn-main{font-weight:var(--crl-weight-semibold);font-size:13px;}`,
    `#${BTN_ID} .mmp-carol-btn-sub{font-size:10px;opacity:.75;}`,
  ].join('')
  document.head.appendChild(style)
}

function relTime(ms: number): string {
  const d = Date.now() - ms
  if (d < 60_000) return '방금 동기화'
  const min = Math.floor(d / 60_000)
  if (min < 60) return `${min}분 전 동기화`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}시간 전 동기화`
  return `${Math.floor(hr / 24)}일 전 동기화`
}

async function refreshSub(): Promise<void> {
  if (!subEl) return
  const [token, state] = await Promise.all([carolToken.get(), carolSyncState.get()])
  if (!token) subEl.textContent = '토큰 미등록 · 팝업에서 설정'
  else if (state.syncedAt) subEl.textContent = relTime(state.syncedAt)
  else subEl.textContent = '아직 동기화 안 함'
}

async function onClick(): Promise<void> {
  if (isCarolSyncRunning() || !btn || !mainEl) return
  const token = await carolToken.get()
  if (!token) {
    alert(
      'carol 동기화 토큰이 없습니다.\n\n' +
        '디스코드에서 /북마클릿 을 실행해 가이드 링크를 받은 뒤,\n' +
        '익스텐션 팝업에 붙여넣어 등록하세요.',
    )
    return
  }
  btn.disabled = true
  mainEl.textContent = '동기화 중…'
  try {
    await runCarolSync(token)
  } finally {
    if (btn && mainEl) {
      btn.disabled = false
      mainEl.textContent = 'carol 동기화'
    }
    void refreshSub()
  }
}

export function initCarolSync(): void {
  if (btn) return
  injectTokens()
  injectStyle()

  btn = document.createElement('button')
  btn.id = BTN_ID
  btn.className = CRL_SCOPE
  btn.type = 'button'

  const dot = document.createElement('span')
  dot.className = 'mmp-carol-btn-dot'

  const tx = document.createElement('span')
  tx.className = 'mmp-carol-btn-tx'
  mainEl = document.createElement('span')
  mainEl.className = 'mmp-carol-btn-main'
  mainEl.textContent = 'carol 동기화'
  subEl = document.createElement('span')
  subEl.className = 'mmp-carol-btn-sub'
  subEl.textContent = ''
  tx.append(mainEl, subEl)

  btn.append(dot, tx)
  btn.addEventListener('click', () => void onClick())
  document.body.appendChild(btn)

  void refreshSub()

  // 다른 탭에서 동기화해 상태가 바뀌면 부제도 따라 갱신
  onStorage = (changes, area) => {
    if (area === 'local' && STATE_KEY in changes) void refreshSub()
  }
  browser.storage.onChanged.addListener(onStorage)

  console.info('[mmp] carol 동기화 버튼 ON')
}

export function destroyCarolSync(): void {
  abortCarolSync()
  if (onStorage) {
    browser.storage.onChanged.removeListener(onStorage)
    onStorage = null
  }
  btn?.remove()
  btn = null
  mainEl = null
  subEl = null
  document.getElementById(STYLE_ID)?.remove()
}
