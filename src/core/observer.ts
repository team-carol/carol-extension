/**
 * MutationObserver 얇은 래퍼.
 *
 * 주의: 콜백 안에서 DOM을 수정하는 소비자(번역기)는 반드시 재진입 가드를 둘 것.
 * 수집기는 읽기 전용이므로 가드가 필요 없음.
 */
export type ObserveCallback = (records: MutationRecord[]) => void

const DEFAULT_OPTIONS: MutationObserverInit = {
  childList: true,
  subtree: true,
  characterData: true,
}

/** target 관찰 시작. 반환된 함수를 호출하면 해제(destroy 시 누수 방지). */
export function observe(
  target: Node,
  cb: ObserveCallback,
  options: MutationObserverInit = DEFAULT_OPTIONS,
): () => void {
  const mo = new MutationObserver(cb)
  mo.observe(target, options)
  return () => mo.disconnect()
}
