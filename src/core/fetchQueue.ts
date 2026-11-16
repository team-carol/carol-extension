/**
 * maimai NET 요청 직렬 큐. CLAUDE.md "세션 취급" 규칙의 구현체.
 *
 *  - 동시성 1, 요청 간 최소 700ms
 *  - 응답이 에러/점검 페이지면 큐 전체를 즉시 중단 (이후 요청은 전부 거부)
 *  - 사용자가 중단 버튼을 누르면 `abort()` — 진행 중 요청도 끊음
 *
 * maimai NET이 아닌 오리진(carol 서버 등)은 이 큐를 거치지 않는다. 세션 문제와 무관.
 * 병렬화 금지 — 성능이 아니라 동작 여부의 문제임.
 */

const MIN_GAP_MS = 700
const REQUEST_TIMEOUT = 15_000

/** 점검 / 에러 코드 페이지 판정. carol 북마클릿 `isErrorPage` + maishift 클라이언트 정규식 합본. */
const MAINTENANCE_RX = /Sorry, servers are under maintenance|ただいまメンテナンス中です/
const ERROR_RX = /ERROR CODE|エラーコード|NET－Error－/

export class QueueAbortedError extends Error {
  constructor(readonly reason: 'user' | 'error-page' | 'maintenance') {
    super(
      reason === 'user'
        ? '사용자가 중단함'
        : reason === 'maintenance'
          ? 'maimai NET 점검 중'
          : 'maimai NET 에러 페이지 — 다시 로그인해주세요',
    )
    this.name = 'QueueAbortedError'
  }
}

export function isMaintenancePage(text: string): boolean {
  return MAINTENANCE_RX.test(text)
}

export function isErrorPage(text: string): boolean {
  // 정상 페이지 본문에 "ERROR"가 섞일 수 있어 짧은 페이지만 에러로 봄 (carol 북마클릿과 같은 기준)
  return text.length < 15_000 && ERROR_RX.test(text)
}

export interface FetchedPage {
  /** 리다이렉트 후 최종 URL */
  url: string
  status: number
  text: string
}

export class FetchQueue {
  private tail: Promise<unknown> = Promise.resolve()
  private lastAt = 0
  private aborted: QueueAbortedError | null = null
  private inflight: AbortController | null = null

  get abortReason(): QueueAbortedError | null {
    return this.aborted
  }

  abort(reason: QueueAbortedError['reason'] = 'user'): void {
    if (!this.aborted) this.aborted = new QueueAbortedError(reason)
    this.inflight?.abort()
  }

  /**
   * maimai NET 페이지를 텍스트로 받음. 큐 순서대로 하나씩.
   * 에러/점검 페이지면 큐를 중단시키고 `QueueAbortedError`를 던짐.
   */
  fetchText(url: string): Promise<FetchedPage> {
    const run = this.tail.then(async () => {
      if (this.aborted) throw this.aborted
      const wait = this.lastAt + MIN_GAP_MS - Date.now()
      if (wait > 0) await sleep(wait)
      if (this.aborted) throw this.aborted

      const ac = new AbortController()
      this.inflight = ac
      const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT)
      try {
        const res = await fetch(url, { credentials: 'include', signal: ac.signal })
        const text = await res.text()
        if (isMaintenancePage(text)) {
          this.abort('maintenance')
          throw this.aborted!
        }
        if (isErrorPage(text)) {
          this.abort('error-page')
          throw this.aborted!
        }
        return { url: res.url, status: res.status, text }
      } catch (err) {
        if (this.aborted) throw this.aborted
        throw err
      } finally {
        clearTimeout(timer)
        this.inflight = null
        this.lastAt = Date.now()
      }
    })
    this.tail = run.catch(() => undefined)
    return run
  }

  /** 이미지 등 바이너리. 같은 큐/간격을 따르지만 에러 페이지 판정은 안 함. */
  fetchBlob(url: string): Promise<Blob> {
    const run = this.tail.then(async () => {
      if (this.aborted) throw this.aborted
      const wait = this.lastAt + MIN_GAP_MS - Date.now()
      if (wait > 0) await sleep(wait)
      if (this.aborted) throw this.aborted
      const ac = new AbortController()
      this.inflight = ac
      const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT)
      try {
        const res = await fetch(url, { signal: ac.signal })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return await res.blob()
      } catch (err) {
        if (this.aborted) throw this.aborted
        throw err
      } finally {
        clearTimeout(timer)
        this.inflight = null
        this.lastAt = Date.now()
      }
    })
    this.tail = run.catch(() => undefined)
    return run
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms))
}
