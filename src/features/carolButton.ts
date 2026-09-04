/**
 * maimai DX NET 페이지에 carol 동기화 버튼을 띄운다.
 *
 * 우하단 고정 버튼. 누르면 `runCarolSync`가 프로필/기록을 수집해 carol 서버로 보냄.
 * 토큰은 팝업에서 등록(`SETTING_CAROL_TOKEN`). 없으면 버튼이 안내만 함.
 *
 * `init()` / `destroy()` 인터페이스 — 팝업 토글로 켜고 끌 때 observer/DOM 누수 없이 정리.
 */
import { carolToken } from '@/core/storage'
import { isCarolSyncRunning, runCarolSync } from '@/features/carolSync'

const BTN_ID = 'mmp-carol-btn'
const STYLE_ID = 'mmp-carol-btn-style'

let btn: HTMLButtonElement | null = null

function injectStyle(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = [
    `#${BTN_ID}{position:fixed;right:16px;bottom:16px;z-index:2147483646;`,
    `  display:flex;align-items:center;gap:6px;padding:10px 14px;border:none;border-radius:999px;`,
    `  font:600 13px system-ui,-apple-system,sans-serif;color:#fff;cursor:pointer;`,
    `  background:#9333ea;box-shadow:0 6px 20px rgba(147,51,234,.4);}`,
    `#${BTN_ID}:hover{background:#7e22ce;}`,
    `#${BTN_ID}[disabled]{opacity:.6;cursor:progress;}`,
    `#${BTN_ID} .mmp-carol-btn-dot{width:7px;height:7px;border-radius:50%;background:#fff;}`,
  ].join('')
  document.head.appendChild(style)
}

async function onClick(): Promise<void> {
  if (isCarolSyncRunning() || !btn) return
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
  btn.lastChild!.textContent = ' 동기화 중…'
  try {
    await runCarolSync(token)
  } finally {
    if (btn) {
      btn.disabled = false
      btn.lastChild!.textContent = ' carol 동기화'
    }
  }
}

export function initCarolSync(): void {
  if (btn) return
  injectStyle()

  btn = document.createElement('button')
  btn.id = BTN_ID
  btn.type = 'button'
  const dot = document.createElement('span')
  dot.className = 'mmp-carol-btn-dot'
  btn.append(dot, document.createTextNode(' carol 동기화'))
  btn.addEventListener('click', () => void onClick())
  document.body.appendChild(btn)

  // 토큰 유무는 클릭 시점에 확인한다(등록 전에 켜둬도 버튼은 떠 있고, 누르면 안내).
  console.info('[mmp] carol 동기화 버튼 ON')
}

export function destroyCarolSync(): void {
  btn?.remove()
  btn = null
  document.getElementById(STYLE_ID)?.remove()
}
