/**
 * carol 자동 동기화 (모드 'auto' 에서만).
 *
 * maimai NET **홈 화면에 들어왔을 때**, 플레이 카운트가 지난 동기화 이후 바뀌었으면
 * 전체 동기화를 1회 자동 실행한다. 바뀌지 않았으면 아무것도 안 한다.
 *
 * 자동이라도 규칙은 지킴:
 *  - 홈 진입 시에만 (매 페이지 이동마다 X)
 *  - 카운트 확인은 playerData **1요청**. 스로틀(기본 10분)로 중복 방지
 *  - 바뀐 게 확인됐을 때만 전체 15요청 수집으로 escalate
 *  - 백그라운드 폴링/타이머 없음 — 콘텐츠 스크립트가 홈에서 뜰 때가 유일한 트리거
 *
 * carol/이 확장 모두 "사용자가 연 페이지 보조" 선을 지키려는 것. 자동 모드는
 * 사용자가 팝업에서 명시적으로 켜야만 동작한다(기본 off).
 */
import { carolSyncState, carolToken } from '@/core/storage'
import { region } from '@/core/selectors'
import { parsePlayCount, runCarolSync } from '@/features/carolSync'

/** 같은 카운트면 이 시간 안엔 다시 확인 안 함 */
const CHECK_THROTTLE_MS = 10 * 60 * 1000
const PLAYER_DATA_PATH = '/maimai-mobile/playerData/'
const FETCH_TIMEOUT = 15_000

let armed = false

/** maimai NET 홈 화면인가. */
function isHomePage(): boolean {
  const p = location.pathname
  // TODO: 실제 페이지에서 확인 — 홈 경로가 이 둘로 충분한지
  return p === '/maimai-mobile/' || p === '/maimai-mobile/home/'
}

async function fetchPlayCount(): Promise<number | null> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT)
  try {
    const res = await fetch(PLAYER_DATA_PATH, { signal: ac.signal })
    if (!res.ok) return null
    return parsePlayCount(await res.text())
  } catch (err) {
    console.warn('[mmp] carol 자동: 플레이 카운트 확인 실패', err)
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function maybeAutoSync(): Promise<void> {
  if (region() === 'unknown' || !isHomePage()) return
  if (document.visibilityState !== 'visible') return

  const token = await carolToken.get()
  if (!token) return

  const state = await carolSyncState.get()
  if (state.checkedAt && Date.now() - state.checkedAt < CHECK_THROTTLE_MS) return

  const playCount = await fetchPlayCount()
  await carolSyncState.patch({ checkedAt: Date.now() })
  if (playCount == null) return

  // 첫 실행이거나(기준 없음) 카운트가 바뀌었으면 전체 동기화
  if (state.playCount != null && state.playCount === playCount) {
    console.info('[mmp] carol 자동: 변화 없음, 건너뜀')
    return
  }
  console.info('[mmp] carol 자동: 플레이 카운트 변화 감지, 동기화 시작')
  await runCarolSync(token, { auto: true })
}

export function initCarolAuto(): void {
  if (armed) return
  armed = true
  void maybeAutoSync()
}

export function destroyCarolAuto(): void {
  // 타이머/리스너가 없으므로 플래그만 내림. 진행 중인 동기화는 carolSync가 관리.
  armed = false
}
